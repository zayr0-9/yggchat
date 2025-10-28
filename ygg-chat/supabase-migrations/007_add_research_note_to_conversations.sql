-- ============================================================================
-- ADD RESEARCH_NOTE COLUMN TO CONVERSATIONS TABLE
-- ============================================================================
--
-- This migration adds a nullable research_note text field to the conversations
-- table to allow users to store research notes associated with conversations.
--
-- ADDS:
-- 1. research_note column (TEXT, NULLABLE) to public.conversations
--
-- SAFE TO RUN: This migration is idempotent and won't error if column exists
-- ============================================================================

-- ============================================================================
-- PART 1: ADD COLUMN
-- ============================================================================

-- Add research_note column to conversations table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'conversations'
      AND column_name = 'research_note'
  ) THEN
    ALTER TABLE public.conversations ADD COLUMN research_note TEXT NULL;
    RAISE NOTICE 'Added research_note column to conversations table';
  ELSE
    RAISE NOTICE 'Column research_note already exists, skipping';
  END IF;
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Verify column was added:
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'conversations'
--   AND column_name = 'research_note';
-- (Should return 1 row with TEXT type and YES for nullable)

-- ============================================================================
-- NOTES
-- ============================================================================

-- PURPOSE: Store research notes associated with conversations
-- DEFAULT VALUE: NULL (no research note by default)
-- NULLABLE: YES (research notes are optional)
-- IMPACT: No impact on existing data or queries (new nullable column)
-- RLS: Automatically inherits RLS policies from conversations table

-- End migration
