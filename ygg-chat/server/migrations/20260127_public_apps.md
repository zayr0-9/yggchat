# Public Apps Table (Community App Store)

## Purpose
Creates the `public_apps` table used for the third-party/community app store. Each upload is linked to a user profile, and apps are immediately visible to everyone.

## SQL Migration

```sql
-- =====================================================
-- Migration: Public Apps (Community App Store)
-- =====================================================

-- Core table
CREATE TABLE IF NOT EXISTS public.public_apps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id text NOT NULL UNIQUE,
  uploader_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  description jsonb NOT NULL,
  definition jsonb NOT NULL,
  description_url text NOT NULL,
  zip_url text NOT NULL,
  contains_executables boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS public_apps_uploader_user_id_idx
  ON public.public_apps (uploader_user_id);

CREATE INDEX IF NOT EXISTS public_apps_created_at_idx
  ON public.public_apps (created_at);

-- Updated-at trigger (scoped to this table)
CREATE OR REPLACE FUNCTION public.set_public_apps_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_public_apps_updated_at ON public.public_apps;
CREATE TRIGGER set_public_apps_updated_at
BEFORE UPDATE ON public.public_apps
FOR EACH ROW
EXECUTE FUNCTION public.set_public_apps_updated_at();

-- Row Level Security
ALTER TABLE public.public_apps ENABLE ROW LEVEL SECURITY;

-- Public read access (community store is public)
CREATE POLICY "Public apps are viewable by everyone"
  ON public.public_apps
  FOR SELECT
  USING (true);

-- Insert/update/delete limited to uploader
CREATE POLICY "Users can insert their own public apps"
  ON public.public_apps
  FOR INSERT
  WITH CHECK (auth.uid() = uploader_user_id);

CREATE POLICY "Users can update their own public apps"
  ON public.public_apps
  FOR UPDATE
  USING (auth.uid() = uploader_user_id)
  WITH CHECK (auth.uid() = uploader_user_id);

CREATE POLICY "Users can delete their own public apps"
  ON public.public_apps
  FOR DELETE
  USING (auth.uid() = uploader_user_id);
```

## Notes
- `description` should include optional `gitLink` when available.
- `contains_executables` is set during upload (true if any .exe/.bat/.sh files are present).
- This migration is additive and safe to run multiple times.
