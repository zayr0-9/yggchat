-- Migration: Prevent Duplicate Active Subscriptions
-- Date: 2025-11-24
-- Description: Adds database constraint to ensure a user can only have one active
--              or trialing subscription at a time, preventing duplicate charges

-- ============================================================================
-- STEP 1: Create partial unique index for active/trialing subscriptions
-- ============================================================================

-- This constraint ensures that a user can only have ONE subscription with
-- status 'active' or 'trialing' at any given time
--
-- How it works:
-- - The WHERE clause makes this a "partial index" that only applies to rows
--   where status is 'active' or 'trialing'
-- - Multiple canceled/expired subscriptions per user are allowed (historical data)
-- - Attempts to insert a second active subscription will fail with a unique violation
--
-- Benefits:
-- - Defense in depth: Prevents duplicates even if application logic fails
-- - Protects against race conditions and concurrent requests
-- - Catches orphaned Stripe subscriptions that bypass our checks
--
-- Example scenarios blocked:
-- ✓ User double-clicks subscribe button → Only first succeeds
-- ✓ User has active subscription, tries to checkout again → Blocked at DB
-- ✓ Concurrent API calls create two subscriptions → Second fails
--
-- Example scenarios allowed:
-- ✓ User had active subscription, canceled it → Can subscribe again
-- ✓ User has multiple historical canceled subscriptions → All kept for records

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_subscription_per_user
  ON subscriptions(user_id)
  WHERE status IN ('active', 'trialing');

-- ============================================================================
-- STEP 2: Add comment to subscriptions table for documentation
-- ============================================================================

COMMENT ON INDEX idx_one_active_subscription_per_user IS
  'Ensures a user can only have one active or trialing subscription. Multiple canceled/expired subscriptions are allowed for historical records.';

-- ============================================================================
-- VERIFICATION QUERIES (for manual testing)
-- ============================================================================

-- To verify the constraint works, try these queries after applying migration:

-- 1. Check if index was created:
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'subscriptions' AND indexname = 'idx_one_active_subscription_per_user';

-- 2. Test the constraint (should fail if user already has active subscription):
-- INSERT INTO subscriptions (user_id, stripe_subscription_id, stripe_customer_id,
--                            stripe_price_id, status, current_period_start,
--                            current_period_end, billing_cycle_anchor)
-- VALUES ('existing-user-id', 'test_sub_123', 'test_cus_123', 'price_test',
--         'active', NOW(), NOW() + INTERVAL '1 month', NOW());
-- Expected: ERROR - duplicate key value violates unique constraint

-- 3. Verify existing data doesn't violate constraint (should return 0 rows):
-- SELECT user_id, COUNT(*) as active_count
-- FROM subscriptions
-- WHERE status IN ('active', 'trialing')
-- GROUP BY user_id
-- HAVING COUNT(*) > 1;
