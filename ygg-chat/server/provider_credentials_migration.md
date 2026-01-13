Below is a single SQL migration you can run on Postgres/Supabase. It creates a `provider_credentials` table keyed by `(user_id, provider)` so each user has a single active credential set per service. Use an UPSERT on `(user_id, provider)` to replace credentials when a user re-authenticates or switches accounts.
-- migration_provider_credentials.sql

-- 1) Prereqs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Provider credentials (one row per user + provider)
CREATE TABLE IF NOT EXISTS public.provider_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_account_id TEXT NULL, -- optional: provider account identifier (e.g., Google "sub")
  refresh_token TEXT NOT NULL,
  client_id TEXT NULL,
  client_secret TEXT NULL,
  token_url TEXT NULL,
  scopes TEXT[] NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NULL
);

-- Enforce single credential set per user + provider
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_credentials_user_provider
ON public.provider_credentials (user_id, provider);

CREATE INDEX IF NOT EXISTS idx_provider_credentials_provider
ON public.provider_credentials (provider);

-- 3) updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_provider_credentials_updated_at'
  ) THEN
    CREATE TRIGGER set_provider_credentials_updated_at
    BEFORE UPDATE ON public.provider_credentials
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at_timestamp();
  END IF;
END $$;

-- 4) Row Level Security: keep tokens server-only (service role bypasses RLS)
ALTER TABLE public.provider_credentials ENABLE ROW LEVEL SECURITY;

-- No policies: anonymous/authenticated clients cannot read/write this table.

-- End migration
