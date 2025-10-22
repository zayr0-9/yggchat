-- ============================================================================
-- MIGRATION: Add exec_sql Helper Function
-- ============================================================================
--
-- This migration adds a helper function to execute raw SQL for JSONB updates
-- Fixes the issue with updateProviderRunWithGenerationId
--
-- SAFE TO RUN MULTIPLE TIMES (uses CREATE OR REPLACE)
-- ============================================================================

-- Helper function to execute raw SQL (for JSONB metadata updates)
-- SECURITY DEFINER: only service_role can execute
CREATE OR REPLACE FUNCTION public.exec_sql(
  sql text,
  params text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql USING params[1], params[2], params[3], params[4], params[5];
END $$;

COMMENT ON FUNCTION public.exec_sql(text, text[])
IS 'Execute raw SQL with parameterized values. SECURITY DEFINER - service_role only.';

-- Revoke from public and grant to service_role only
REVOKE ALL ON FUNCTION public.exec_sql(text, text[])
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.exec_sql(text, text[])
  TO service_role;

-- End migration
