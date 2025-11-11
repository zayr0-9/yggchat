-- ============================================================================
-- SUPABASE DATABASE MIGRATION: Remove Search Indexing
-- ============================================================================
--
-- This migration removes PostgreSQL full-text search indexing from messages.
-- Keeps search functionality via SQLite FTS5 (local database).
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent with IF EXISTS checks)
-- ============================================================================

-- ============================================================================
-- PART 1: DROP RPC FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.search_messages(conversation_id uuid, query_text text) CASCADE;
DROP FUNCTION IF EXISTS public.search_all_user_messages(query_text text, limit_count int DEFAULT 50, offset_count int DEFAULT 0) CASCADE;
DROP FUNCTION IF EXISTS public.search_messages_by_project(project_id uuid, query_text text) CASCADE;

-- ============================================================================
-- PART 2: DROP TRIGGERS
-- ============================================================================

DROP TRIGGER IF EXISTS trg_messages_tsvector ON public.messages;

-- ============================================================================
-- PART 3: DROP TRIGGER FUNCTION
-- ============================================================================

DROP FUNCTION IF EXISTS public.messages_search_vector_update() CASCADE;

-- ============================================================================
-- PART 4: DROP INDEX
-- ============================================================================

DROP INDEX IF EXISTS public.idx_messages_search;

-- ============================================================================
-- PART 5: DROP COLUMN
-- ============================================================================

ALTER TABLE public.messages DROP COLUMN IF EXISTS search_vector;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
--
-- Verification queries:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'search_vector';
-- -- Should return no rows
--
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_schema = 'public' AND event_object_table = 'messages' AND trigger_name LIKE 'trg_messages%';
-- -- Should return no rows
