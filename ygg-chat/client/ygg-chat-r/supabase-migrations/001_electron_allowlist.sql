-- Migration: Electron User Allowlist
-- Description: Creates a table to restrict Electron app OAuth to login-only (no signups)
-- Run this in Supabase SQL Editor or via Supabase CLI

-- Create the electron_allowlist table
CREATE TABLE IF NOT EXISTS public.electron_allowlist (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  notes TEXT
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_electron_allowlist_email
  ON public.electron_allowlist(email);

CREATE INDEX IF NOT EXISTS idx_electron_allowlist_created_at
  ON public.electron_allowlist(created_at DESC);

-- Enable Row Level Security
ALTER TABLE public.electron_allowlist ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Allow authenticated users to read their own allowlist entry
CREATE POLICY "Users can view their own allowlist status"
  ON public.electron_allowlist
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policy: Service role can do everything (for admin operations)
CREATE POLICY "Service role has full access"
  ON public.electron_allowlist
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add helpful comment
COMMENT ON TABLE public.electron_allowlist IS
  'Allowlist of users authorized to access the Electron application. Used for login-only OAuth (no signups).';

COMMENT ON COLUMN public.electron_allowlist.user_id IS
  'Foreign key to auth.users. User must exist before being added to allowlist.';

COMMENT ON COLUMN public.electron_allowlist.email IS
  'User email address for easier management. Must match auth.users.email.';

COMMENT ON COLUMN public.electron_allowlist.notes IS
  'Optional notes about why user was granted access, who approved them, etc.';
