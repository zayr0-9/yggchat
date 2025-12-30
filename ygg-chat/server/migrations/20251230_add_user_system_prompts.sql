-- Migration: Add user_system_prompts table for custom system prompt management
-- Date: 2025-12-30
-- Description: Creates user_system_prompts table with 1:N relationship to profiles

-- Create user_system_prompts table
CREATE TABLE IF NOT EXISTS public.user_system_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  content text NOT NULL,
  description text NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_system_prompts_pkey PRIMARY KEY (id),
  CONSTRAINT user_system_prompts_owner_id_fkey FOREIGN KEY (owner_id)
    REFERENCES public.profiles (id) ON DELETE CASCADE
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_system_prompts_owner_id
  ON public.user_system_prompts(owner_id);

CREATE INDEX IF NOT EXISTS idx_user_system_prompts_owner_id_is_default
  ON public.user_system_prompts(owner_id, is_default)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_user_system_prompts_updated_at
  ON public.user_system_prompts(owner_id, updated_at DESC);

-- Add comments for documentation
COMMENT ON TABLE public.user_system_prompts IS 'Custom system prompts per user. 1:N relationship with profiles.';
COMMENT ON COLUMN public.user_system_prompts.name IS 'User-defined name for the system prompt';
COMMENT ON COLUMN public.user_system_prompts.content IS 'The actual system prompt text';
COMMENT ON COLUMN public.user_system_prompts.description IS 'Optional description of what this prompt does';
COMMENT ON COLUMN public.user_system_prompts.is_default IS 'If true, this prompt is used as the default for new conversations';

-- Enable Row Level Security
ALTER TABLE public.user_system_prompts ENABLE ROW LEVEL SECURITY;

-- RLS Policy: SELECT own prompts
CREATE POLICY "user_system_prompts_select_own"
  ON public.user_system_prompts
  FOR SELECT
  USING (owner_id = auth.uid());

-- RLS Policy: INSERT own prompts
CREATE POLICY "user_system_prompts_insert_own"
  ON public.user_system_prompts
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

-- RLS Policy: UPDATE own prompts
CREATE POLICY "user_system_prompts_update_own"
  ON public.user_system_prompts
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- RLS Policy: DELETE own prompts
CREATE POLICY "user_system_prompts_delete_own"
  ON public.user_system_prompts
  FOR DELETE
  USING (owner_id = auth.uid());

-- Function to ensure only one default prompt per user
CREATE OR REPLACE FUNCTION public.ensure_single_default_prompt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.user_system_prompts
    SET is_default = false, updated_at = now()
    WHERE owner_id = NEW.owner_id
      AND id != NEW.id
      AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if exists
DROP TRIGGER IF EXISTS ensure_single_default_prompt_trigger ON public.user_system_prompts;

-- Create trigger for ensuring single default
CREATE TRIGGER ensure_single_default_prompt_trigger
  AFTER INSERT OR UPDATE OF is_default ON public.user_system_prompts
  FOR EACH ROW
  WHEN (NEW.is_default = true)
  EXECUTE FUNCTION public.ensure_single_default_prompt();

-- Add comment for trigger function
COMMENT ON FUNCTION public.ensure_single_default_prompt()
  IS 'Ensures only one system prompt per user can be marked as default';
