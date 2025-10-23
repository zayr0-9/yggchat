# Supabase Realtime Setup Guide (Broadcast Approach)

This document explains how to enable and configure Supabase Realtime Broadcast for the Yggdrasil Chat application.

## What is Supabase Realtime Broadcast?

Supabase Realtime allows your application to subscribe to database changes and receive instant notifications when data changes, eliminating the need for constant polling.

**We use the Broadcast approach** instead of Postgres Changes because:
- ✅ **Works immediately** - No waiting for Replication feature (Early Access)
- ✅ **Recommended by Supabase** - Better performance at scale
- ✅ **Full control** - Custom triggers send exactly the data we need
- ✅ **Same benefits** - Instant notifications, 80% reduction in API calls

## Current Implementation

### Server-Side: Provider Runs Reconciliation

**Location:** `server/src/workers/openrouter-reconciliation.ts`

**How it works:**
1. Postgres trigger detects when `provider_runs` status changes to 'succeeded' or 'aborted'
2. Trigger broadcasts a message to the 'reconciliation' channel
3. Server receives broadcast and immediately reconciles the cost
4. Backup polling every 5 minutes catches any missed events

**Benefits:**
- **80% reduction in API calls** (from 60/hour to 12/hour)
- **Instant reconciliation** (< 1 second instead of up to 60 seconds)
- **Automatic failover** - backup polling ensures no events are missed
- **No replication required** - works immediately

## Required Setup

### Step 1: Run Database Migration

**⚠️ IMPORTANT:** You must run the Postgres trigger migration for Realtime to work.

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Click **New query**
4. Copy the contents of `supabase-migrations/003_realtime_broadcast_trigger.sql`
5. Paste into the editor
6. Click **Run** or press `Ctrl+Enter`

**Expected output:**
```
Success. No rows returned
```

**What this migration does:**
- Creates a Postgres trigger function `notify_provider_run_ready()`
- Attaches trigger to `provider_runs` table
- Broadcasts to 'reconciliation' channel when status changes to succeeded/aborted

### Step 2: Restart Your Server

After running the migration, restart your Node.js server to activate the Realtime subscription.

**No other setup required** - The trigger and subscription will work immediately!

## How It Works

### Architecture Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                  Realtime Broadcast Flow                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Chat message completes                                   │
│     ↓                                                        │
│  2. Server UPDATEs provider_runs (status = 'succeeded')      │
│     ↓                                                        │
│  3. Postgres Trigger fires: notify_provider_run_ready()      │
│     ↓                                                        │
│  4. Trigger calls: realtime.send(                            │
│       topic: 'reconciliation',                               │
│       event: 'provider_run_ready',                           │
│       payload: { id, generation_id, ... }                    │
│     )                                                        │
│     ↓                                                        │
│  5. Supabase Realtime broadcasts message                     │
│     ↓                                                        │
│  6. Server receives broadcast event                          │
│     ↓                                                        │
│  7. reconcileProviderRun() executes immediately              │
│     ↓                                                        │
│  8. Credits adjusted within <1 second                        │
│                                                              │
│  BACKUP: Polling every 5 minutes catches missed events       │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Trigger Logic

The Postgres trigger only broadcasts when ALL conditions are met:
- ✅ Status changes to 'succeeded' OR 'aborted'
- ✅ Status was previously NOT 'succeeded' or 'aborted' (prevents duplicate broadcasts)
- ✅ generation_id exists (required for OpenRouter API)
- ✅ actual_credits is NULL (not yet reconciled)

This ensures we only broadcast when reconciliation is actually needed.

## Monitoring and Debugging

### Check if Trigger is Installed

Run this query in Supabase SQL Editor:

```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trigger_notify_provider_run_ready';
```

**Expected output:**
```
tgname                              | tgenabled
------------------------------------|----------
trigger_notify_provider_run_ready  | O
```

`tgenabled = 'O'` means the trigger is enabled.

### Check if Broadcast is Working

Look for these console logs when the server starts:

```
🚀 Starting OpenRouter reconciliation worker with Realtime Broadcast
✅ Realtime Broadcast subscription active (no replication required)
🔄 Backup polling enabled (every 300s)
```

### When a Broadcast Event is Triggered

```
⚡ Broadcast trigger: Reconciling generation gen_abc123 immediately
🔄 Reconciling generation gen_abc123 (run uuid-here)
💰 Credit calculation for gen_abc123: { reserved: 0.05, actual: 0.03, delta: 0.02, type: 'refund' }
✅ Applied refund of 0.02 credits for gen_abc123
```

### Manual Testing

Test the trigger manually with this SQL:

```sql
-- Find a test provider_run
SELECT id, status, generation_id
FROM provider_runs
WHERE status = 'running'
LIMIT 1;

-- Update it to trigger the broadcast
UPDATE provider_runs
SET status = 'succeeded'
WHERE id = 'YOUR-TEST-UUID-HERE';

-- Check server logs for broadcast event
```

### Error Handling

The worker handles these scenarios gracefully:

- **CHANNEL_ERROR:** Falls back to polling only
- **TIMED_OUT:** Attempts automatic reconnect
- **Missed events:** Backup polling catches them within 5 minutes

## Performance Impact

### Before Realtime

| Metric | Value |
|--------|-------|
| Polling frequency | Every 60 seconds |
| API calls per hour | 60 |
| API calls per day | 1,440 |
| Average reconciliation delay | 30 seconds |

### After Realtime Broadcast

| Metric | Value |
|--------|-------|
| Broadcast events | As needed (only when data changes) |
| Backup polling | Every 5 minutes |
| API calls per hour | 12 (backup only) |
| API calls per day | 288 |
| Average reconciliation delay | <1 second |

**Savings:**
- **80% reduction in API calls** (1,152 calls/day saved)
- **30x faster reconciliation**
- **Better user experience** (instant credit updates)

## Comparison: Broadcast vs Postgres Changes

| Feature | Postgres Changes | Broadcast + Trigger |
|---------|------------------|---------------------|
| **Requires Replication** | ✅ Yes (Early Access) | ❌ No (Works now!) |
| **Setup complexity** | Easy (enable replication) | Medium (run SQL migration) |
| **Performance** | Good | Better (recommended) |
| **Customization** | Limited (sends full row) | Full (send only needed fields) |
| **Scaling** | RLS check per subscriber | Better at scale |
| **Supabase recommendation** | Simple apps | Scaling apps |

**Our choice:** Broadcast + Trigger because it works immediately and is recommended for production apps.

## Supabase Realtime Limits

### Free Tier
- 200 concurrent Realtime connections
- 2GB bandwidth per month

### Pro Tier
- 500 concurrent Realtime connections
- 250GB bandwidth per month

### Current Usage Estimate

With your current setup:
- 1 server = 1 connection to 'reconciliation' channel
- Each broadcast event is very small (~500 bytes)
- Estimated monthly bandwidth: <50MB

**Conclusion:** Well within limits, even with 100+ users.

## Security Considerations

### Trigger Security

The trigger function is `SECURITY DEFINER`, meaning it runs with the privileges of the user who created it (postgres). This is necessary to call `realtime.send()`.

### Server-Side Subscription

The server uses `supabaseAdmin` (service role) to subscribe:
- Can receive all provider_run broadcasts
- Can process reconciliations for all users
- Secure because it runs server-side only

### No Client Access

Regular users cannot subscribe to the 'reconciliation' channel because:
- It's used server-side only
- No RLS policies expose this data to clients
- Clients use separate mechanisms for their own data

## Troubleshooting

### Broadcast Not Working?

1. **Check trigger is installed:**
   ```sql
   SELECT * FROM pg_trigger
   WHERE tgname = 'trigger_notify_provider_run_ready';
   ```

2. **Check trigger function exists:**
   ```sql
   SELECT proname FROM pg_proc
   WHERE proname = 'notify_provider_run_ready';
   ```

3. **Check server logs:**
   - Look for "✅ Realtime Broadcast subscription active"
   - If missing, check for error logs

4. **Test trigger manually:**
   ```sql
   UPDATE provider_runs
   SET status = 'succeeded'
   WHERE id = 'test-uuid';
   ```
   - Check server logs for "⚡ Broadcast trigger"

5. **Check realtime.send is available:**
   ```sql
   SELECT proname FROM pg_proc
   WHERE proname = 'send'
   AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');
   ```

### Still Polling Frequently?

The backup polling is expected and beneficial:
- Runs every 5 minutes (12 times/hour)
- Ensures reliability
- Minimal API usage

If you see 60 calls/hour, the broadcast may not be active:
- Check the logs for subscription status
- Verify trigger is installed with queries above

### Trigger Not Firing?

Check the trigger conditions:
- Status must change TO 'succeeded' or 'aborted'
- Status must change FROM something other than 'succeeded' or 'aborted'
- generation_id must exist
- actual_credits must be NULL

Add logging to debug:
```sql
-- Check trigger logs (if NOTICE messages are visible)
-- Or check what would trigger:
SELECT id, status, generation_id, actual_credits
FROM provider_runs
WHERE status IN ('succeeded', 'aborted')
  AND generation_id IS NOT NULL
  AND actual_credits IS NULL
LIMIT 10;
```

## Migration Rollback

If you need to remove the trigger:

```sql
-- Remove trigger
DROP TRIGGER IF EXISTS trigger_notify_provider_run_ready ON public.provider_runs;

-- Remove trigger function
DROP FUNCTION IF EXISTS public.notify_provider_run_ready();
```

The server will automatically fall back to polling-only mode (every 5 minutes).

## Future Enhancements

### Phase 2: Client-Side Credit Balance (Planned)

Use the same Broadcast approach for live credit balance:

1. Create trigger on `profiles` table
2. Broadcast when `cached_current_credits` changes
3. Client subscribes to `credits-${userId}` channel
4. Live balance updates across all tabs

**Benefits:**
- Live credit balance everywhere
- No manual refresh after Stripe checkout
- Instant feedback when credits are spent/refunded

### Phase 3: Conversation Sync (Optional)

Subscribe to new conversations/messages for multi-tab sync and collaborative features.

## References

- [Supabase Realtime Broadcast](https://supabase.com/docs/guides/realtime/broadcast)
- [Broadcast from Database](https://supabase.com/blog/realtime-broadcast-from-database)
- [Postgres Triggers](https://supabase.com/docs/guides/database/postgres/triggers)
- [Realtime Architecture](https://supabase.com/docs/guides/realtime/architecture)
