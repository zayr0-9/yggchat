-- Migration: Add quick_chat_project_id to profiles table
-- This column stores the default project for quick chats

-- Add column to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS quick_chat_project_id uuid NULL;

-- Add foreign key constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'profiles_quick_chat_project_id_fkey'
    AND table_name = 'profiles'
  ) THEN
    ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_quick_chat_project_id_fkey
    FOREIGN KEY (quick_chat_project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create trigger function to auto-create "Quick Chat" project for new profiles
CREATE OR REPLACE FUNCTION public.create_default_quick_chat_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_project_id uuid;
BEGIN
  -- Create default Quick Chat project for new user
  INSERT INTO public.projects (owner_id, name, created_at, updated_at, context, system_prompt)
  VALUES (NEW.id, 'Quick Chat', NOW(), NOW(), '', '')
  RETURNING id INTO new_project_id;

  -- Update the profile with the new project id
  NEW.quick_chat_project_id := new_project_id;

  RETURN NEW;
END;
$$;

-- Create trigger on profiles INSERT (BEFORE so we can modify NEW)
DROP TRIGGER IF EXISTS trigger_create_quick_chat_project ON public.profiles;

CREATE TRIGGER trigger_create_quick_chat_project
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_quick_chat_project();
