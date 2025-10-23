-- ============================================================================
-- CLEANUP: REMOVE REALTIME BROADCAST TRIGGER AND POLICIES
-- ============================================================================
--
-- This migration removes the Realtime broadcast trigger and related policies
-- since we've switched to a simple polling approach instead.
--
-- REMOVES:
-- 1. Trigger on provider_runs table
-- 2. Trigger function notify_provider_run_ready()
-- 3. RLS policies on realtime.messages (if they exist)
--
-- SAFE TO RUN: This migration is idempotent and won't error if items don't exist
-- ============================================================================

-- ============================================================================
-- PART 1: REMOVE TRIGGER
-- ============================================================================

-- Drop the trigger from provider_runs table
DROP TRIGGER IF EXISTS trigger_notify_provider_run_ready ON public.provider_runs;

-- Drop the trigger function
DROP FUNCTION IF EXISTS public.notify_provider_run_ready();

-- ============================================================================
-- PART 2: REMOVE RLS POLICIES ON REALTIME.MESSAGES (OPTIONAL)
-- ============================================================================

-- These policies are safe to leave in place if other features use them
-- But we'll remove them to clean up completely

DO $$
BEGIN
  -- Drop SELECT policy
  DROP POLICY IF EXISTS "allow_broadcast_select" ON realtime.messages;
  RAISE NOTICE 'Dropped policy: allow_broadcast_select';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'realtime.messages table does not exist, skipping policy removal';
  WHEN undefined_object THEN
    RAISE NOTICE 'Policy allow_broadcast_select does not exist, skipping';
END $$;

DO $$
BEGIN
  -- Drop INSERT policy
  DROP POLICY IF EXISTS "allow_broadcast_insert" ON realtime.messages;
  RAISE NOTICE 'Dropped policy: allow_broadcast_insert';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'realtime.messages table does not exist, skipping policy removal';
  WHEN undefined_object THEN
    RAISE NOTICE 'Policy allow_broadcast_insert does not exist, skipping';
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify trigger was removed:
-- SELECT tgname FROM pg_trigger WHERE tgname = 'trigger_notify_provider_run_ready';
-- (Should return 0 rows)

-- Verify function was removed:
-- SELECT proname FROM pg_proc WHERE proname = 'notify_provider_run_ready';
-- (Should return 0 rows)

-- Verify policies were removed:
-- SELECT policyname FROM pg_policies
-- WHERE schemaname = 'realtime' AND tablename = 'messages'
--   AND policyname IN ('allow_broadcast_insert', 'allow_broadcast_select');
-- (Should return 0 rows)

-- ============================================================================
-- NOTES
-- ============================================================================

-- REASON FOR REMOVAL: Switched to simple polling approach (every 60s)
-- IMPACT: None - the polling worker handles reconciliations now
-- ROLLBACK: If you need to restore, run migrations 003, 004, and 005 again

-- End migration
