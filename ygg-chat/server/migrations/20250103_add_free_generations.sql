-- Migration: Add free tier support with 20 lifetime free generations
-- Date: 2025-01-03
-- Description: Adds free_generations_remaining field to profiles table and RPC function for atomic decrement

-- Add free_generations_remaining column to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS free_generations_remaining integer NOT NULL DEFAULT 20;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_profiles_free_generations
ON public.profiles(free_generations_remaining);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.free_generations_remaining
IS 'Lifetime free generations remaining for user. Initialized to 20 for new users. Never resets. Used when user has no subscription and no credits.';

-- Set default for existing users (they get 20 free generations retroactively)
UPDATE public.profiles
SET free_generations_remaining = 20
WHERE free_generations_remaining IS NULL OR free_generations_remaining = 0;

-- RPC function to atomically decrement free_generations_remaining
-- Returns the new count after decrement (or 0 if already 0)
CREATE OR REPLACE FUNCTION public.decrement_free_generation(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count integer;
BEGIN
  -- Lock row and decrement if > 0
  -- GREATEST ensures count never goes below 0
  UPDATE public.profiles
  SET free_generations_remaining = GREATEST(free_generations_remaining - 1, 0)
  WHERE id = p_user_id
  AND free_generations_remaining > 0
  RETURNING free_generations_remaining INTO v_new_count;

  -- Return new count (or 0 if no update occurred - user already at 0)
  RETURN COALESCE(v_new_count, 0);
END $$;

-- Add comment for documentation
COMMENT ON FUNCTION public.decrement_free_generation(uuid)
IS 'Atomically decrements free_generations_remaining for a user by 1. Returns new count. Thread-safe for concurrent requests.';

-- Grant execute permission to service_role only (server-side use only)
REVOKE ALL ON FUNCTION public.decrement_free_generation(uuid)
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.decrement_free_generation(uuid)
TO service_role;

-- Verify migration
DO $$
DECLARE
  column_exists boolean;
  function_exists boolean;
BEGIN
  -- Check if column was added
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'free_generations_remaining'
  ) INTO column_exists;

  -- Check if function was created
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'decrement_free_generation'
    AND pronamespace = 'public'::regnamespace
  ) INTO function_exists;

  IF column_exists AND function_exists THEN
    RAISE NOTICE '✅ Migration successful: free_generations_remaining column and decrement function created';
  ELSE
    RAISE EXCEPTION '❌ Migration verification failed';
  END IF;
END $$;
