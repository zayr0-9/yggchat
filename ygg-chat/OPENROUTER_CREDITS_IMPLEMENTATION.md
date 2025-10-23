# OpenRouter Credits Implementation Guide

## Overview

This document describes the **two-phase credit reservation system** implemented for OpenRouter API usage. This system ensures users never exceed their credit balance and handles the asynchronous nature of OpenRouter cost reporting.

## Architecture

### Two-Phase Commit Pattern

The system uses a **reserve → reconcile** pattern:

1. **Reserve Phase (Upfront)**: Before calling OpenRouter API, estimate and reserve credits
2. **Generation Phase**: Stream OpenRouter response, capture generation ID
3. **Reconcile Phase (Background)**: Fetch final cost from OpenRouter, adjust credits accordingly

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Request Flow                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. User sends message                                          │
│       ↓                                                         │
│  2. Reserve credits (finance_reserve_credits)                   │
│       ↓                                                         │
│  3. Create provider_runs entry (status: running)                │
│       ↓                                                         │
│  4. Call OpenRouter API                                         │
│       ↓                                                         │
│  5. Capture generation_id from first chunk                      │
│       ↓                                                         │
│  6. Stream response to user                                     │
│       ↓                                                         │
│  7. Mark provider_run as succeeded/aborted/failed               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│              Background Reconciliation Worker                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Every 60 seconds:                                              │
│  1. Query provider_runs_pending_reconciliation view             │
│       ↓                                                         │
│  2. For each pending run:                                       │
│       ↓                                                         │
│  3. GET https://openrouter.ai/api/v1/generation?id=GEN_ID      │
│       ↓                                                         │
│  4. If cost ready:                                              │
│       - Calculate delta = reserved - actual                     │
│       - Call finance_adjust_credits with delta                  │
│       - Mark provider_run as reconciled                         │
│       ↓                                                         │
│  5. If cost not ready:                                          │
│       - Schedule retry with exponential backoff                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Database Schema

### New Tables

#### `provider_runs`
Tracks each OpenRouter generation step (including tool call follow-ups).

```sql
CREATE TABLE provider_runs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  conversation_id uuid,
  message_id uuid,
  model text NOT NULL,
  generation_id text UNIQUE,              -- From OpenRouter (set after first chunk)
  reservation_ref_id text NOT NULL,       -- Local UUID for reservation
  step_index int NOT NULL DEFAULT 1,
  status text NOT NULL,                   -- 'running' | 'succeeded' | 'aborted' | 'failed' | 'reconciled'
  reserved_credits numeric NOT NULL,      -- Upfront reservation
  actual_credits numeric,                 -- Final cost (NULL until reconciled)
  raw_usage jsonb,                        -- Full OpenRouter /generation response
  created_at timestamptz NOT NULL,
  finished_at timestamptz,
  reconciled_at timestamptz,
  next_reconcile_at timestamptz           -- For retry backoff
);
```

### Extended Enums

Added to `ledger_entry_kind`:
- `generation_reservation` - Upfront credit hold (negative delta)
- `generation_refund` - Refund when actual < reserved (positive delta)
- `generation_adjustment` - Additional charge when actual > reserved (negative delta)

### New Functions

#### `finance_reserve_credits(user_id, ref_type, ref_id, amount, metadata)`
Atomically reserves credits before generation starts.

**Behavior:**
- Locks user's profile row (`FOR UPDATE`)
- Checks balance >= amount
- Inserts negative ledger entry
- Decrements `cached_current_credits`
- **Idempotent**: Returns existing entry if already reserved

**Throws:**
- `insufficient_credits` if balance too low
- `profile_not_found` if user doesn't exist

#### `finance_adjust_credits(user_id, ref_type, ref_id, delta, kind, metadata, allow_negative)`
Applies credit adjustment after reconciliation.

**Parameters:**
- `delta`: Positive = refund, Negative = charge
- `kind`: `generation_refund` or `generation_adjustment`
- `allow_negative`: Allow user balance to go negative (default: false)

**Behavior:**
- Locks user's profile row
- Inserts ledger entry with delta
- Updates `cached_current_credits`
- **Idempotent**: Returns existing entry if already adjusted

## Implementation Details

### Credit Estimation

The reservation amount is calculated conservatively:

```typescript
// Estimate tokens (rough: 4 chars per token)
const estimatedPromptTokens = Math.ceil(totalChars / 4)
const estimatedCompletionTokens = Math.ceil(estimatedPromptTokens * 0.3)

// Calculate cost
const estimatedCost =
  (estimatedPromptTokens / 1000) * pricing.prompt +
  (estimatedCompletionTokens / 1000) * pricing.completion

// Apply 2x safety multiplier
const reservedCredits = estimatedCost * 2
```

**Why 2x multiplier?**
- Completion length is unpredictable
- Reasoning tokens (for O1/O3) can be significant
- Better to over-reserve and refund than under-reserve and fail

### Tool Call Handling

Each tool call iteration creates a **separate reservation**:

```
Step 1: Reserve → Call OpenRouter → Tool call needed
  ↓
Step 2: Reserve → Execute tool → Call OpenRouter with result → Tool call needed
  ↓
Step 3: Reserve → Execute tool → Call OpenRouter with result → Done
```

**Rationale:**
- Don't pre-reserve for unknown tool chains (could be 1 step or 400 steps)
- Each step is independently reconciled
- Prevents locking up large amounts of credits speculatively

### Reconciliation Worker

Located: `/server/src/workers/openrouter-reconciliation.ts`

**Configuration:**
```typescript
RECONCILE_BATCH_SIZE = 10       // Process 10 runs per batch
RECONCILE_INTERVAL_MS = 60000   // Run every 60 seconds
MAX_RETRIES = 10                // Give up after 10 attempts
INITIAL_BACKOFF_MS = 120000     // Start with 2 minute backoff
MAX_BACKOFF_MS = 3600000        // Cap at 1 hour
STALE_THRESHOLD_MS = 30 days    // Auto-reconcile stale generations
```

**Exponential Backoff:**
```
Attempt 1: 2 minutes
Attempt 2: 4 minutes
Attempt 3: 8 minutes
Attempt 4: 16 minutes
Attempt 5: 32 minutes
Attempt 6+: 1 hour (capped)
```

**Worker Lifecycle:**
- Starts automatically in web mode (see `/server/src/index.ts`)
- Skipped in local/Electron modes (no Supabase)
- Can be manually triggered via `triggerReconciliation()`

### Error Handling

#### Insufficient Credits at Reservation
```typescript
try {
  await reserveCreditsForGeneration(...)
} catch (error) {
  if (error.message.includes('insufficient_credits')) {
    // Block request, show error to user
    onChunk(JSON.stringify({
      part: 'error',
      delta: 'Insufficient credits. Please add more credits.'
    }))
    throw error
  }
}
```

#### Generation Aborted
```typescript
// Mark provider_run as aborted
await finishProviderRun(currentProviderRunId, 'aborted', finalUsage)

// Credits remain reserved until reconciliation
// Worker will refund based on partial usage
```

#### OpenRouter API Errors
```typescript
// Mark provider_run as failed
await finishProviderRun(currentProviderRunId, 'failed', finalUsage)

// Reconciliation worker will retry fetching cost
// If max retries exceeded, mark as reconciled with reserved amount
```

## Migration Guide

### Running the Migration

1. **Ensure existing migration is applied:**
   ```bash
   # Apply supabase_billing_migration.sql first if not already done
   psql $DATABASE_URL < supabase_billing_migration.sql
   ```

2. **Apply the additive migration:**
   ```bash
   psql $DATABASE_URL < supabase-migrations/002_openrouter_generation_tracking.sql
   ```

3. **Verify tables exist:**
   ```sql
   SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public'
   AND table_name IN ('provider_runs', 'credits_ledger');
   ```

4. **Check enum values:**
   ```sql
   SELECT enumlabel FROM pg_enum
   WHERE enumtypid = 'ledger_entry_kind'::regtype;
   ```

### Environment Variables

Ensure these are set in your `.env`:

```bash
# OpenRouter API
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_REFERER=https://yoursite.com
OPENROUTER_TITLE="Your App Name"

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Mode
VITE_ENVIRONMENT=web
```

### Backward Compatibility

The implementation is **backward compatible**:

- ✅ Old `ProviderCostService` still works (writes to `provider_cost` table)
- ✅ New system runs in parallel (writes to `provider_runs` table)
- ✅ No breaking changes to existing API endpoints
- ✅ Reconciliation worker only runs in web mode

**Future:** Consider migrating `ProviderCostService` to use `provider_runs` table.

## Monitoring & Debugging

### Check Pending Reconciliations

```sql
SELECT * FROM provider_runs_pending_reconciliation;
```

### View User's Recent Generations

```sql
SELECT
  pr.id,
  pr.model,
  pr.status,
  pr.reserved_credits,
  pr.actual_credits,
  pr.created_at,
  pr.reconciled_at
FROM provider_runs pr
WHERE pr.user_id = 'USER_UUID'
ORDER BY pr.created_at DESC
LIMIT 20;
```

### Check Credit Ledger

```sql
SELECT
  kind,
  delta_credits,
  external_ref_type,
  external_ref_id,
  metadata,
  created_at
FROM credits_ledger
WHERE user_id = 'USER_UUID'
ORDER BY created_at DESC
LIMIT 20;
```

### Identify Stale Generations

```sql
SELECT
  id,
  generation_id,
  model,
  status,
  created_at,
  EXTRACT(EPOCH FROM (now() - created_at))/3600 as hours_old
FROM provider_runs
WHERE status IN ('succeeded', 'aborted')
  AND actual_credits IS NULL
  AND created_at < now() - interval '24 hours';
```

### Manual Reconciliation

```typescript
// In server console or via API endpoint
import { triggerReconciliation } from './workers/openrouter-reconciliation'

// Manually trigger a reconciliation batch
await triggerReconciliation()
```

## Testing Checklist

- [ ] **Insufficient Credits**: User with 0 credits attempts generation → blocked
- [ ] **Reservation Idempotency**: Same ref_id reserved twice → same ledger entry returned
- [ ] **Generation Success**: Normal generation → reserved → succeeded → reconciled → refund
- [ ] **Generation Abort**: User cancels mid-stream → reserved → aborted → reconciled → partial refund
- [ ] **Generation Error**: OpenRouter API error → reserved → failed → reconciled → refund
- [ ] **Tool Calls**: Multi-step tool chain → separate reservations per step → all reconciled
- [ ] **Reconciliation Backoff**: Cost not ready → retries with increasing intervals
- [ ] **Stale Generation**: 30-day old generation → auto-reconciled
- [ ] **Max Retries**: 10 failed reconciliation attempts → marked as failed, credits remain reserved

## Performance Considerations

### Database Load

- **Reservations**: 1 RPC call + 2 inserts per generation step
- **Reconciliation**: 1 select + 1 API call + 1 RPC + 2 updates per run
- **Indexes**: Optimized for reconciliation queue queries

**Expected Load:**
- 1000 generations/day = ~17 reservations/hour = negligible load
- Reconciliation worker: 10 runs/minute max = 1 query + 10 API calls/minute

### Credit Locking

Credits are **locked** during generation:
- Reserved at start (balance decremented)
- Refunded/charged at reconciliation
- Typical lock duration: 1-5 minutes

**Impact:**
- Users with low balances may need to wait for reconciliation before next generation
- Consider showing "pending reconciliation" credits in UI

### OpenRouter API Rate Limits

OpenRouter `/generation` endpoint has rate limits:
- **Recommended**: 1-2 requests/second
- **Current**: 10 requests/minute max (well within limits)

**Scaling:**
- If volume increases, add rate limiting to worker
- Consider batching generation ID lookups (if API supports)

## Future Enhancements

### Opportunistic Reconciliation

Add endpoint to trigger reconciliation after user messages:

```typescript
// After user sends message, reconcile their pending runs
app.post('/api/messages', async (req, res) => {
  // ... save message ...

  // Opportunistically reconcile user's pending runs
  reconcileUserPendingRuns(req.user.id)

  res.json({ message })
})
```

### Proactive Cost Display

Show estimated vs. actual costs in UI:

```typescript
// Fetch user's provider_runs with metadata
const runs = await supabase
  .from('provider_runs')
  .select('*')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })

// Display: "Estimated: 0.05 credits, Actual: 0.03 credits (refunded 0.02)"
```

### Credit Balance Alerts

Notify users when balance is low:

```sql
-- View already exists: users_low_credits
SELECT * FROM users_low_credits;
```

### Advanced Reconciliation

- **Webhooks**: If OpenRouter adds webhooks for cost finalization
- **Batch API**: If OpenRouter adds batch generation cost lookup
- **Predictive Refunds**: Refund based on usage patterns before final cost

## Support

**Questions?** Check:
1. This document
2. [ledger_migration.md](server/ledger_migration.md) - Original migration plan
3. [paymentplan.md](paymentplan.md) - Overall billing architecture
4. [supabase_billing_migration.sql](supabase_billing_migration.sql) - Complete schema

**Issues?** File at: https://github.com/your-org/ygg-chat/issues
