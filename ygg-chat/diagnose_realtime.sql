-- ============================================================================
-- DIAGNOSTIC SCRIPT: Realtime Broadcast Issue
-- ============================================================================
-- Run this in Supabase SQL Editor to diagnose why broadcasts aren't working
-- ============================================================================

-- 1. Check if trigger function exists and view its source
SELECT
  proname AS function_name,
  pg_get_functiondef(oid) AS function_definition
FROM pg_proc
WHERE proname = 'notify_provider_run_ready';

-- 2. Check if trigger exists on provider_runs table
SELECT
  tgname AS trigger_name,
  tgtype,
  tgenabled,
  pg_get_triggerdef(oid) AS trigger_definition
FROM pg_trigger
WHERE tgname = 'trigger_notify_provider_run_ready';

-- 3. Check if realtime.messages table exists
SELECT EXISTS (
  SELECT FROM pg_tables
  WHERE schemaname = 'realtime'
  AND tablename = 'messages'
) AS realtime_messages_exists;

-- 4. Check RLS policies on realtime.messages (CRITICAL)
SELECT
  policyname,
  cmd AS operation,
  roles,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'realtime' AND tablename = 'messages'
ORDER BY cmd;

-- Expected: Two policies
-- - allow_broadcast_insert (INSERT, roles: postgres/service_role)
-- - allow_broadcast_select (SELECT, roles: postgres/service_role/authenticated)

-- 5. Check if there are any provider_runs ready for reconciliation
SELECT
  id,
  generation_id,
  status,
  created_at,
  actual_credits IS NULL AS needs_reconciliation
FROM provider_runs
WHERE status IN ('succeeded', 'aborted')
  AND generation_id IS NOT NULL
  AND actual_credits IS NULL
ORDER BY created_at DESC
LIMIT 5;

-- 6. Test the trigger function manually (check Postgres logs for RAISE NOTICE)
-- IMPORTANT: Replace 'YOUR-TEST-RUN-ID' with an actual ID from query #5
-- This will fire the trigger and you should see a NOTICE in the logs

-- STEP 1: First, check what provider_runs exist:
-- SELECT id, status, generation_id, actual_credits FROM provider_runs LIMIT 10;

-- STEP 2: Update a test run (replace the UUID):
-- UPDATE provider_runs
-- SET status = 'succeeded'
-- WHERE id = 'YOUR-TEST-RUN-ID'
--   AND status = 'running';

-- 7. Check recent messages in realtime.messages (if table exists)
-- These auto-delete after 3 days
-- If trigger is working, you should see messages with topic='reconciliation'
SELECT
  id,
  topic,
  event,
  payload,
  inserted_at
FROM realtime.messages
WHERE topic = 'reconciliation'
ORDER BY inserted_at DESC
LIMIT 10;

-- ============================================================================
-- COMMON ISSUES AND FIXES
-- ============================================================================

-- ISSUE 1: Missing SELECT policy on realtime.messages
-- SYMPTOM: Trigger fires (messages appear in realtime.messages) but server never receives them
-- FIX: Run migration 005_add_realtime_select_policy.sql

-- ISSUE 2: Trigger function not updated to use realtime.broadcast_changes()
-- SYMPTOM: Trigger fires but no messages in realtime.messages table
-- FIX: Run migration 004_fix_realtime_broadcast.sql

-- ISSUE 3: realtime.messages table doesn't exist (Supabase project too old)
-- SYMPTOM: Query #3 returns false, trigger function errors
-- FIX: Upgrade Supabase project or use postgres_changes instead of broadcast

-- ISSUE 4: Server not using service_role key
-- SYMPTOM: Subscription succeeds but no messages received
-- FIX: Check that SUPABASE_SERVICE_ROLE_KEY is set in server .env

-- ============================================================================
-- NEXT STEPS
-- ============================================================================

-- 1. Run queries 1-5 to check current state
-- 2. If realtime.messages exists but policies are missing:
--    - Run migrations 004 and 005
-- 3. If realtime.messages doesn't exist:
--    - Your Supabase project may be too old
--    - Consider using postgres_changes approach instead
-- 4. After fixing, test with query #6
-- 5. Check server logs for "⚡ Broadcast trigger" message
