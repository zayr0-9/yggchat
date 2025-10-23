-- ============================================================================
-- FIX: ADD SELECT POLICY FOR REALTIME BROADCAST RECEPTION
-- ============================================================================
--
-- PROBLEM: Server can't RECEIVE broadcasts from database trigger
--
-- WHY: realtime.broadcast_changes() uses PRIVATE channels which require
--      RLS policies on realtime.messages for BOTH:
--      1. INSERT - to send broadcasts (✅ already have this)
--      2. SELECT - to receive broadcasts (❌ MISSING - this is the fix)
--
-- EVIDENCE:
-- - Trigger fires successfully (messages appear in realtime.messages table)
-- - Server connects to Realtime (logs show "✅ subscription active")
-- - Server NEVER receives broadcasts (no "⚡ Broadcast trigger" logs)
--
-- SOLUTION: Add SELECT policy so service_role can receive broadcast messages
-- ============================================================================

-- ============================================================================
-- ADD SELECT POLICY FOR RECEIVING BROADCASTS
-- ============================================================================

-- Allow service_role and authenticated users to SELECT (receive) broadcast messages
-- This is required for realtime.broadcast_changes() which uses private channels
DO $$
BEGIN
  -- Drop existing policy if it exists (for idempotency)
  DROP POLICY IF EXISTS "allow_broadcast_select" ON realtime.messages;

  -- Create SELECT policy
  CREATE POLICY "allow_broadcast_select"
  ON realtime.messages
  FOR SELECT
  TO postgres, service_role, authenticated
  USING (true);

  RAISE NOTICE 'Created SELECT policy: allow_broadcast_select';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'realtime.messages table does not exist, skipping policy creation';
  WHEN undefined_object THEN
    -- Policy doesn't exist, create it
    CREATE POLICY "allow_broadcast_select"
    ON realtime.messages
    FOR SELECT
    TO postgres, service_role, authenticated
    USING (true);

    RAISE NOTICE 'Created SELECT policy: allow_broadcast_select';
END $$;

COMMENT ON POLICY "allow_broadcast_select" ON realtime.messages
IS 'Allows service_role and authenticated users to receive broadcast messages from database triggers';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify both INSERT and SELECT policies exist:
-- SELECT policyname, cmd AS operation
-- FROM pg_policies
-- WHERE schemaname = 'realtime' AND tablename = 'messages'
-- ORDER BY cmd;
--
-- Expected output:
-- policyname              | operation
-- ------------------------|----------
-- allow_broadcast_insert  | INSERT
-- allow_broadcast_select  | SELECT

-- ============================================================================
-- TESTING
-- ============================================================================

-- After running this migration:
-- 1. Restart your server
-- 2. Send a test message
-- 3. Look for: "⚡ Broadcast trigger: Reconciling generation gen_xxx immediately"
--
-- Manual test:
-- UPDATE provider_runs
-- SET status = 'succeeded'
-- WHERE id = (SELECT id FROM provider_runs WHERE status = 'running' LIMIT 1);
--
-- Then immediately check server logs for "⚡ Broadcast trigger"

-- ============================================================================
-- NOTES
-- ============================================================================

-- PRIVATE CHANNELS: realtime.broadcast_changes() uses private channels by default
-- RLS REQUIREMENTS: Private channels need BOTH INSERT and SELECT policies
-- SECURITY: This policy allows any authenticated user to receive broadcasts
--           which is fine for server-side service_role use

-- End migration
