-- ============================================================================
-- FIX: REALTIME BROADCAST TRIGGER (Use realtime.broadcast_changes)
-- ============================================================================
--
-- This migration fixes the broken realtime.send() call by using
-- realtime.broadcast_changes() instead - a purpose-built function
-- for broadcasting database changes.
--
-- FIXES:
-- 1. Replaces realtime.send() with realtime.broadcast_changes()
-- 2. Adds required RLS policy for realtime.messages table
-- 3. Uses native Postgres trigger variables (TG_OP, NEW, OLD)
--
-- DEPENDENCIES: Requires 003_realtime_broadcast_trigger.sql to be run first
-- ============================================================================

-- ============================================================================
-- PART 1: REPLACE TRIGGER FUNCTION
-- ============================================================================

-- Updated function using realtime.broadcast_changes()
CREATE OR REPLACE FUNCTION public.notify_provider_run_ready()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only broadcast when:
  -- 1. Status changes to 'succeeded' or 'aborted' (from any other status)
  -- 2. Generation ID exists (needed for OpenRouter API call)
  -- 3. Not yet reconciled (actual_credits is NULL)
  IF NEW.status IN ('succeeded', 'aborted')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('succeeded', 'aborted'))
     AND NEW.generation_id IS NOT NULL
     AND NEW.actual_credits IS NULL
  THEN
    -- Use realtime.broadcast_changes (purpose-built for database triggers)
    -- This function sends data in Postgres Changes compatible format
    PERFORM realtime.broadcast_changes(
      'reconciliation',    -- topic (channel name)
      TG_OP,              -- event ('UPDATE')
      TG_OP,              -- operation ('UPDATE')
      TG_TABLE_NAME,      -- table name ('provider_runs')
      TG_TABLE_SCHEMA,    -- schema ('public')
      NEW,                -- new record (full row after UPDATE)
      OLD                 -- old record (full row before UPDATE)
    );

    -- Log for debugging
    RAISE NOTICE 'Broadcast: provider_run % (generation %) ready for reconciliation', NEW.id, NEW.generation_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_provider_run_ready()
IS 'Broadcasts provider_run changes using realtime.broadcast_changes() when ready for reconciliation.';

-- ============================================================================
-- PART 2: ADD RLS POLICY FOR REALTIME.MESSAGES
-- ============================================================================

-- Enable RLS on realtime.messages (if not already enabled)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow postgres and service_role to INSERT broadcast messages
-- This is required for realtime.broadcast_changes() to work
-- Drop policy if it exists, then create it (for idempotency)
DO $$
BEGIN
  DROP POLICY IF EXISTS "allow_broadcast_insert" ON realtime.messages;

  CREATE POLICY "allow_broadcast_insert"
  ON realtime.messages
  FOR INSERT
  TO postgres, service_role
  WITH CHECK (true);
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'realtime.messages table does not exist, skipping policy creation';
  WHEN undefined_object THEN
    -- Policy doesn't exist, create it
    CREATE POLICY "allow_broadcast_insert"
    ON realtime.messages
    FOR INSERT
    TO postgres, service_role
    WITH CHECK (true);
END $$;

COMMENT ON POLICY "allow_broadcast_insert" ON realtime.messages
IS 'Allows database triggers to send broadcast messages via realtime.broadcast_changes()';

-- ============================================================================
-- VERIFICATION QUERIES (For Testing)
-- ============================================================================

-- Verify trigger function was updated:
-- SELECT proname, prosrc FROM pg_proc
-- WHERE proname = 'notify_provider_run_ready';

-- Verify RLS policy exists:
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'realtime' AND tablename = 'messages';

-- Test trigger manually:
-- UPDATE public.provider_runs
-- SET status = 'succeeded'
-- WHERE id = 'YOUR-TEST-UUID' AND status = 'running';

-- Check realtime.messages table for broadcast (messages auto-delete after 3 days):
-- SELECT topic, event, payload FROM realtime.messages
-- ORDER BY inserted_at DESC LIMIT 5;

-- ============================================================================
-- NOTES
-- ============================================================================

-- PAYLOAD STRUCTURE: Server will receive:
-- {
--   event: 'UPDATE',
--   payload: {
--     type: 'UPDATE',
--     schema: 'public',
--     table: 'provider_runs',
--     record: { ...full new row... },
--     old_record: { ...full old row... }
--   }
-- }

-- PRIVATE CHANNEL: realtime.broadcast_changes() uses private channel by default
-- RLS: The policy above allows trigger functions to write messages
-- CLEANUP: Broadcast messages auto-delete from realtime.messages after 3 days

-- End migration
