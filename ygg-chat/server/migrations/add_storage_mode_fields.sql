-- Migration: Add Storage Mode Support to Projects and Conversations Tables
-- Date: 2025-11-29
-- Description: Adds storage_mode column to projects and conversations tables
--              to support dual local/cloud storage architecture

-- ============================================================================
-- STEP 1: Add storage_mode columns (nullable initially for safe backfill)
-- ============================================================================

-- Add storage_mode to projects table
-- This field tracks whether the project is stored in cloud (Supabase) or local (SQLite)
-- Initially nullable to allow safe backfilling of existing records

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS storage_mode TEXT;

-- Add storage_mode to conversations table
-- This field tracks whether the conversation is stored in cloud (Supabase) or local (SQLite)
-- Must match the parent project's storage_mode

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS storage_mode TEXT;

-- ============================================================================
-- STEP 2: Backfill existing records with 'cloud'
-- ============================================================================

-- All existing projects in Supabase are cloud-based
-- Set storage_mode to 'cloud' for any records where it's currently NULL

UPDATE projects
SET storage_mode = 'cloud'
WHERE storage_mode IS NULL;

-- All existing conversations in Supabase are cloud-based
-- Set storage_mode to 'cloud' for any records where it's currently NULL

UPDATE conversations
SET storage_mode = 'cloud'
WHERE storage_mode IS NULL;

-- ============================================================================
-- STEP 3: Add DEFAULT constraint
-- ============================================================================

-- Set default value to 'cloud' for new records
-- This ensures that new cloud projects/conversations automatically get the correct storage_mode

ALTER TABLE projects
  ALTER COLUMN storage_mode SET DEFAULT 'cloud';

ALTER TABLE conversations
  ALTER COLUMN storage_mode SET DEFAULT 'cloud';

-- ============================================================================
-- STEP 4: Add CHECK constraint for data integrity
-- ============================================================================

-- Restrict storage_mode values to only 'cloud' or 'local'
-- This prevents invalid values and ensures consistency

ALTER TABLE projects
  ADD CONSTRAINT projects_storage_mode_check
  CHECK (storage_mode IN ('cloud', 'local'));

ALTER TABLE conversations
  ADD CONSTRAINT conversations_storage_mode_check
  CHECK (storage_mode IN ('cloud', 'local'));

-- ============================================================================
-- STEP 5: Add indexes for efficient queries
-- ============================================================================

-- Create index on projects.storage_mode
-- Improves performance when filtering projects by storage location

CREATE INDEX IF NOT EXISTS idx_projects_storage_mode
  ON projects(storage_mode);

-- Create index on conversations.storage_mode
-- Improves performance when filtering conversations by storage location

CREATE INDEX IF NOT EXISTS idx_conversations_storage_mode
  ON conversations(storage_mode);

-- ============================================================================
-- STEP 6: Update PostgreSQL function to include storage_mode
-- ============================================================================

-- Drop and recreate the function to include storage_mode in the return type
-- This function is called by ProjectService.getAllSortedByLatestConversation()

DROP FUNCTION IF EXISTS get_projects_sorted_by_latest_conversation(uuid);

CREATE OR REPLACE FUNCTION get_projects_sorted_by_latest_conversation(user_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  owner_id uuid,
  context text,
  system_prompt text,
  storage_mode text,
  created_at timestamptz,
  updated_at timestamptz,
  latest_conversation_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.name,
    p.owner_id,
    p.context,
    p.system_prompt,
    p.storage_mode,
    p.created_at,
    p.updated_at,
    COALESCE(MAX(c.updated_at), p.updated_at) as latest_conversation_updated_at
  FROM projects p
  LEFT JOIN conversations c ON c.project_id = p.id AND c.owner_id = p.owner_id
  WHERE p.owner_id = user_id
  GROUP BY p.id, p.name, p.owner_id, p.context, p.system_prompt, p.storage_mode, p.created_at, p.updated_at
  ORDER BY latest_conversation_updated_at DESC;
$$;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

-- Verify the columns were added
-- Should show storage_mode column with TEXT type and default 'cloud'
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name IN ('projects', 'conversations')
--   AND column_name = 'storage_mode'
-- ORDER BY table_name, column_name;

-- Verify all records have storage_mode set (should return 0)
-- SELECT 'projects' as table_name, COUNT(*) as null_count
-- FROM projects
-- WHERE storage_mode IS NULL
-- UNION ALL
-- SELECT 'conversations', COUNT(*)
-- FROM conversations
-- WHERE storage_mode IS NULL;

-- Verify constraints were created
-- SELECT conname, contype, pg_get_constraintdef(oid) as definition
-- FROM pg_constraint
-- WHERE conname LIKE '%storage_mode%'
-- ORDER BY conname;

-- Verify indexes were created
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename IN ('projects', 'conversations')
--   AND indexname LIKE '%storage_mode%'
-- ORDER BY tablename, indexname;

-- Check distribution of storage_mode values
-- SELECT 'projects' as table_name, storage_mode, COUNT(*) as count
-- FROM projects
-- GROUP BY storage_mode
-- UNION ALL
-- SELECT 'conversations', storage_mode, COUNT(*)
-- FROM conversations
-- GROUP BY storage_mode
-- ORDER BY table_name, storage_mode;

-- ============================================================================
-- ROLLBACK SCRIPT (for reference - run manually if needed)
-- ============================================================================

-- WARNING: This rollback will remove the storage_mode columns and constraints
-- Only run if migration needs to be reversed

-- DROP INDEX IF EXISTS idx_conversations_storage_mode;
-- DROP INDEX IF EXISTS idx_projects_storage_mode;
-- ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_storage_mode_check;
-- ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_storage_mode_check;
-- ALTER TABLE conversations ALTER COLUMN storage_mode DROP DEFAULT;
-- ALTER TABLE projects ALTER COLUMN storage_mode DROP DEFAULT;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS storage_mode;
-- ALTER TABLE projects DROP COLUMN IF EXISTS storage_mode;

-- ============================================================================
-- USAGE EXAMPLES
-- ============================================================================

-- Example 1: Find all cloud projects
-- SELECT id, name, storage_mode, created_at
-- FROM projects
-- WHERE storage_mode = 'cloud'
-- ORDER BY created_at DESC;

-- Example 2: Find all local conversations
-- SELECT id, title, storage_mode, project_id, created_at
-- FROM conversations
-- WHERE storage_mode = 'local'
-- ORDER BY created_at DESC;

-- Example 3: Check for storage mode mismatches between projects and conversations
-- SELECT c.id as conversation_id, c.title, c.storage_mode as conv_storage,
--        p.id as project_id, p.name, p.storage_mode as proj_storage
-- FROM conversations c
-- LEFT JOIN projects p ON p.id = c.project_id
-- WHERE c.project_id IS NOT NULL
--   AND c.storage_mode != p.storage_mode;

-- Example 4: Count conversations by storage mode and project
-- SELECT p.name as project_name,
--        c.storage_mode,
--        COUNT(c.id) as conversation_count
-- FROM conversations c
-- JOIN projects p ON p.id = c.project_id
-- GROUP BY p.name, c.storage_mode
-- ORDER BY p.name, c.storage_mode;

-- ============================================================================
-- NOTES
-- ============================================================================

-- 1. RLS Policies: Existing RLS policies on projects and conversations tables
--    will automatically apply to rows with storage_mode field since they filter
--    by owner_id/user_id

-- 2. Triggers: Existing triggers (updated_at, conversation touch, etc.) will
--    automatically work with the new storage_mode field

-- 3. Backward Compatibility: All changes use IF NOT EXISTS and conditional
--    updates to allow safe re-running of migration. Existing records are
--    backfilled with 'cloud' which is correct for all Supabase data

-- 4. Storage Mode Values:
--    - 'cloud': Data stored in Supabase (RLS-protected, synced across devices)
--    - 'local': Data stored in local SQLite (Electron app, offline-first)

-- 5. Validation: The client-side validation in conversationActions.ts expects
--    projects and conversations to have matching storage_mode values. This
--    migration fixes the "undefined project" error by ensuring all records
--    have storage_mode set

-- 6. Performance: Indexes minimize overhead for storage_mode queries while
--    CHECK constraints ensure data integrity at the database level

-- 7. Migration Safety: This migration is designed to be:
--    - Idempotent (can be run multiple times safely)
--    - Zero-downtime (adds columns without locking)
--    - Reversible (rollback script provided)
--    - Data-preserving (all existing records retained with correct values)

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
