-- Migration: Add GIN index for fuzzy/contains title search using pg_trgm
-- Note: pg_trgm extension should already be enabled in the public schema
-- If not, run: CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create GIN index for efficient ILIKE and similarity searches on conversation titles
CREATE INDEX IF NOT EXISTS idx_conversations_title_trgm
ON public.conversations USING gin (title gin_trgm_ops);
