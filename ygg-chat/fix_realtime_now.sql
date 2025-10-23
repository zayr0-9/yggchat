-- ============================================================================
-- QUICK FIX: Enable Realtime Broadcast Reception
-- ============================================================================
-- This script ensures your server can receive broadcast messages from triggers
-- Run this in Supabase SQL Editor RIGHT NOW to fix the issue
-- ============================================================================

-- STEP 1: Ensure realtime.messages has RLS enabled
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- STEP 2: Create INSERT policy (allows trigger to send broadcasts)
DROP POLICY IF EXISTS "allow_broadcast_insert" ON realtime.messages;

CREATE POLICY "allow_broadcast_insert"
ON realtime.messages
FOR INSERT
TO postgres, service_role
WITH CHECK (true);

-- STEP 3: Create SELECT policy (allows server to receive broadcasts) ⚠️ CRITICAL
DROP POLICY IF EXISTS "allow_broadcast_select" ON realtime.messages;

CREATE POLICY "allow_broadcast_select"
ON realtime.messages
FOR SELECT
TO postgres, service_role, authenticated
USING (true);

-- STEP 4: Verify trigger function uses realtime.broadcast_changes()
CREATE OR REPLACE FUNCTION public.notify_provider_run_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only broadcast when ready for reconciliation
  IF NEW.status IN ('succeeded', 'aborted')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('succeeded', 'aborted'))
     AND NEW.generation_id IS NOT NULL
     AND NEW.actual_credits IS NULL
  THEN
    -- Use realtime.broadcast_changes() to send message
    PERFORM realtime.broadcast_changes(
      'reconciliation',    -- channel/topic name (must match server subscription)
      TG_OP,              -- event type ('UPDATE')
      TG_OP,              -- operation ('UPDATE')
      TG_TABLE_NAME,      -- table name ('provider_runs')
      TG_TABLE_SCHEMA,    -- schema ('public')
      NEW,                -- new record data (full row after UPDATE)
      OLD                 -- old record data (full row before UPDATE)
    );

    -- Log success (visible in Postgres logs)
    RAISE NOTICE 'Broadcast sent: generation_id=%, run_id=%', NEW.generation_id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Check policies exist:
SELECT policyname, cmd AS operation
FROM pg_policies
WHERE schemaname = 'realtime' AND tablename = 'messages'
ORDER BY cmd;

-- Expected output:
-- policyname              | operation
-- ------------------------|----------
-- allow_broadcast_insert  | INSERT
-- allow_broadcast_select  | SELECT

-- Check trigger function source:
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'notify_provider_run_ready';

-- ============================================================================
-- TESTING
-- ============================================================================

-- After running this script:
-- 1. Restart your Node.js server
-- 2. Send a test message through your chat UI
-- 3. Watch server logs for: "⚡ Broadcast trigger: Reconciling generation gen_xxx immediately"
-- 4. Check that reconciliation happens within 1 second (not 5 minutes)

-- Manual test (optional):
-- Find a test run:
-- SELECT id, status, generation_id FROM provider_runs
-- WHERE status = 'running' LIMIT 1;

-- Then update it to trigger the broadcast:
-- UPDATE provider_runs
-- SET status = 'succeeded'
-- WHERE id = 'YOUR-RUN-ID-HERE';

-- Immediately check server logs for "⚡ Broadcast trigger" message

-- ============================================================================
-- WHAT THIS FIXES
-- ============================================================================

-- PROBLEM: Trigger fires successfully, but server never receives the broadcast
--
-- ROOT CAUSE: realtime.broadcast_changes() uses PRIVATE channels which need
--             RLS SELECT policy for clients to receive messages
--
-- SOLUTION: The SELECT policy above allows service_role to receive broadcasts
--
-- EVIDENCE OF FIX: Server logs will show:
-- - "⚡ Broadcast trigger: Reconciling generation gen_xxx immediately"
-- - Reconciliation happens in <1 second instead of 5+ minutes
-- - API calls reduced from 60/hour to ~12/hour (80% reduction)

-- ============================================================================
-- NOTES
-- ============================================================================

-- If this doesn't work after restarting the server, check:
-- 1. Server is using SUPABASE_SERVICE_ROLE_KEY (not SUPABASE_ANON_KEY)
-- 2. Server shows "✅ Realtime Broadcast subscription active" on startup
-- 3. realtime.messages table exists (check with: SELECT * FROM realtime.messages LIMIT 1)
-- 4. Supabase project is up to date (older projects may not support broadcast_changes)

-- If realtime.messages doesn't exist, your Supabase project is too old
-- and you'll need to use the postgres_changes approach instead of broadcast
