# Fix Billing Foreign Key Constraints Migration

## Purpose
This migration removes foreign key constraints from billing-related tables to preserve financial records when user accounts are deleted. Currently, these tables use CASCADE delete, which would permanently destroy billing history.

## Critical Issue
Three billing tables have CASCADE delete constraints that violate financial record-keeping requirements:
- `credits_ledger` - Credit transaction audit trail
- `subscriptions` - Stripe subscription history
- `provider_runs` - API usage billing reconciliation

## Impact
After this migration:
- Deleting a user will NOT affect billing tables - `user_id` remains intact
- All billing history will be preserved with original user_id for audit purposes
- User content (messages, projects, etc.) will still be cascade deleted
- The `user_id` UUID remains for transaction grouping (UUID is not PII, GDPR compliant)

## SQL Migration

```sql
-- =====================================================
-- Remove foreign key constraint from credits_ledger
-- =====================================================
ALTER TABLE credits_ledger
  DROP CONSTRAINT IF EXISTS credits_ledger_user_id_fkey;

-- =====================================================
-- Remove foreign key constraint from subscriptions
-- =====================================================
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;

-- =====================================================
-- Remove foreign key constraint from provider_runs
-- =====================================================
ALTER TABLE provider_runs
  DROP CONSTRAINT IF EXISTS provider_runs_user_id_fkey;
```

## Why Remove Instead of SET NULL?

**Better Approach:** We remove the foreign key constraints entirely rather than setting them to ON DELETE SET NULL because:

1. **UUID is not PII** - The user_id UUID contains no personal information, fully GDPR compliant
2. **Better audit trail** - Can distinguish between different users' transactions even after account deletion
3. **Easier reconciliation** - Can group all transactions from the same user for refunds/disputes
4. **No NULL constraint issues** - Avoids the "null value violates not-null constraint" error
5. **Financial compliance** - Maintains proper transaction grouping for tax/accounting requirements

The `user_id` column remains as a regular UUID column with the user's ID preserved for billing records.

## Verification Queries

After running the migration, verify the constraints were removed:

```sql
-- Verify NO foreign key constraints exist on billing tables' user_id columns
-- These queries should return ZERO rows

-- Check credits_ledger - should return no rows
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'credits_ledger'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';
-- Expected: Empty result (no rows)

-- Check subscriptions - should return no rows
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'subscriptions'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';
-- Expected: Empty result (no rows)

-- Check provider_runs - should return no rows
SELECT
  tc.constraint_name,
  tc.table_name,
  kcu.column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'provider_runs'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND kcu.column_name = 'user_id';
-- Expected: Empty result (no rows)
```

## Manual Execution Steps

1. **Backup Database** (recommended before any schema changes)
2. **Open Supabase SQL Editor**
3. **Copy and paste the SQL Migration code above**
4. **Execute the migration**
5. **Run verification queries** to confirm changes
6. **Test account deletion** with a test user (see Test Plan below)

## Test Plan

After migration, test account deletion with a test user:

```sql
-- 1. Create test user and add billing data
-- (Create via application or manually)

-- 2. Verify test user has billing records
SELECT COUNT(*) FROM credits_ledger WHERE user_id = '<test-user-id>';
SELECT COUNT(*) FROM subscriptions WHERE user_id = '<test-user-id>';

-- 3. Delete test user (via API endpoint or manually)
-- DELETE FROM profiles WHERE id = '<test-user-id>';

-- 4. Verify billing records STILL EXIST with SAME user_id
SELECT * FROM credits_ledger WHERE user_id = '<test-user-id>';
-- Should return rows with user_id intact

SELECT * FROM subscriptions WHERE user_id = '<test-user-id>';
-- Should return rows with user_id intact

-- 5. Verify user content was deleted
SELECT COUNT(*) FROM profiles WHERE id = '<test-user-id>'; -- Should be 0
SELECT COUNT(*) FROM messages WHERE owner_id = '<test-user-id>'; -- Should be 0
SELECT COUNT(*) FROM conversations WHERE owner_id = '<test-user-id>'; -- Should be 0
```

## Rollback Plan (if needed)

If you need to restore the foreign key constraints (NOT RECOMMENDED):

```sql
-- WARNING: This will restore CASCADE delete behavior!
-- Billing history will be deleted when users are deleted.
-- Only use if you fully understand the implications.

ALTER TABLE credits_ledger
  ADD CONSTRAINT credits_ledger_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;

ALTER TABLE provider_runs
  ADD CONSTRAINT provider_runs_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES profiles(id)
  ON DELETE CASCADE;
```

**Note:** You should NOT need to rollback this migration. Removing foreign keys from billing tables is the correct approach for:
- Financial compliance
- Audit trail preservation
- GDPR compliance (UUID is not PII)
- Better data retention policies

## Notes

- This migration has no performance impact
- No data is modified, only constraint behavior changes
- This is a prerequisite for implementing account deletion
- Execute this BEFORE deploying account deletion code
