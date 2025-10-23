-- ============================================================================
-- REALTIME BROADCAST TRIGGER FOR PROVIDER_RUNS RECONCILIATION
-- ============================================================================
--
-- This migration creates a Postgres trigger that broadcasts provider_run
-- changes via Supabase Realtime Broadcast (no replication required).
--
-- WHY BROADCAST INSTEAD OF POSTGRES CHANGES?
-- - Works immediately without waiting for Replication feature
-- - Recommended by Supabase for scaling applications
-- - More control over what data is broadcast
-- - Better performance at scale
--
-- DEPENDENCIES: Requires 002_openrouter_generation_tracking.sql
-- ============================================================================

-- ============================================================================
-- PART 1: CREATE TRIGGER FUNCTION
-- ============================================================================

-- Function that broadcasts when a provider_run is ready for reconciliation
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
    -- Broadcast to the 'reconciliation' channel
    -- This sends a message to any server listening on this channel
    PERFORM realtime.send(
      payload := jsonb_build_object(
        'event', 'provider_run_ready',
        'id', NEW.id,
        'user_id', NEW.user_id,
        'generation_id', NEW.generation_id,
        'model', NEW.model,
        'reserved_credits', NEW.reserved_credits,
        'reservation_ref_id', NEW.reservation_ref_id,
        'status', NEW.status,
        'created_at', NEW.created_at,
        'next_reconcile_at', NEW.next_reconcile_at
      ),
      event := 'provider_run_ready',
      topic := 'reconciliation'  -- Channel name
    );

    -- Log for debugging (optional, can be removed in production)
    RAISE NOTICE 'Broadcast: provider_run % (generation %) ready for reconciliation', NEW.id, NEW.generation_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_provider_run_ready()
IS 'Broadcasts provider_run changes to Realtime subscribers when ready for reconciliation. Uses Supabase Realtime Broadcast (no replication required).';

-- ============================================================================
-- PART 2: ATTACH TRIGGER TO PROVIDER_RUNS TABLE
-- ============================================================================

-- Drop existing trigger if it exists (for safe re-running of migration)
DROP TRIGGER IF EXISTS trigger_notify_provider_run_ready ON public.provider_runs;

-- Create trigger that fires AFTER each UPDATE
CREATE TRIGGER trigger_notify_provider_run_ready
  AFTER UPDATE ON public.provider_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_provider_run_ready();

COMMENT ON TRIGGER trigger_notify_provider_run_ready ON public.provider_runs
IS 'Triggers Realtime broadcast when provider_run status changes to succeeded/aborted';

-- ============================================================================
-- PART 3: GRANT PERMISSIONS
-- ============================================================================

-- Ensure the trigger function can call realtime.send
-- (service_role already has this, but being explicit)
GRANT USAGE ON SCHEMA realtime TO postgres;

-- ============================================================================
-- VERIFICATION QUERIES (For Testing)
-- ============================================================================

-- Verify trigger was created:
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trigger_notify_provider_run_ready';

-- Manually test the trigger (replace 'test-uuid' with a real provider_run ID):
-- UPDATE public.provider_runs
-- SET status = 'succeeded'
-- WHERE id = 'test-uuid' AND status = 'running';

-- Check if realtime.send function is available:
-- SELECT proname FROM pg_proc WHERE proname = 'send' AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'realtime');

-- ============================================================================
-- NOTES
-- ============================================================================

-- PERFORMANCE: This trigger only fires on UPDATE, not INSERT
-- IDEMPOTENCY: Safe to run multiple times (uses CREATE OR REPLACE and DROP IF EXISTS)
-- ROLLBACK: To remove, run:
--   DROP TRIGGER IF EXISTS trigger_notify_provider_run_ready ON public.provider_runs;
--   DROP FUNCTION IF EXISTS public.notify_provider_run_ready();

-- End migration
