Below is a single SQL migration you can run on Postgres/Supabase. It adds a small provider_runs table to track each OpenRouter generation, strengthens credits_ledger for idempotency, adds a cached_current_credits convenience column, and provides two SECURITY DEFINER functions for atomic reservations and adjustments. After the SQL, there’s a concise implementation guide your agent can follow.
-- migration_openrouter_credits.sql

-- 1) Prereqs
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2) Profiles: cached balance cache (single source of truth is credits_ledger)
ALTER TABLE IF EXISTS public.profiles
ADD COLUMN IF NOT EXISTS cached_current_credits BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_profiles_cached_current_credits
ON public.profiles (cached_current_credits);

-- 3) Credits ledger (append-only)
CREATE TABLE IF NOT EXISTS public.credits_ledger (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID NOT NULL,
delta_credits BIGINT NOT NULL,
kind TEXT NOT NULL, -- e.g., monthly_allocation, usage, topup_credit, generation_reservation, generation_adjustment, generation_refund
external_ref_type TEXT NULL,
external_ref_id TEXT NULL,
metadata JSONB NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Useful indexes and idempotency guard
CREATE INDEX IF NOT EXISTS idx_credits_ledger_user_created_at
ON public.credits_ledger (user_id, created_at DESC);

-- Prevent double-application of the same external ref.
-- Partial unique index so rows without refs are allowed.
CREATE UNIQUE INDEX IF NOT EXISTS ux_credits_ledger_external_ref
ON public.credits_ledger (external_ref_type, external_ref_id)
WHERE external_ref_type IS NOT NULL AND external_ref_id IS NOT NULL;

-- 4) Provider runs: track each OpenRouter generation step (parent or tool call)
CREATE TABLE IF NOT EXISTS public.provider_runs (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
user_id UUID NOT NULL,
conversation_id UUID NULL,
message_id UUID NULL,
model TEXT NOT NULL, -- generation_id from OpenRouter. Unique when present.
generation_id TEXT NULL, -- local reservation reference: your TEMP run uuid used as external_ref_id for reservation
reservation_ref_id TEXT NOT NULL,
step_index INT NOT NULL DEFAULT 1, -- 1 for initial call, 2/3/... for tool-call follow-ups
status TEXT NOT NULL
CHECK (status IN ('running', 'succeeded', 'aborted', 'failed', 'reconciled'))
DEFAULT 'running',
reserved_credits BIGINT NOT NULL,
actual_credits BIGINT NULL,
raw_usage JSONB NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
finished_at TIMESTAMPTZ NULL,
reconciled_at TIMESTAMPTZ NULL,
next_reconcile_at TIMESTAMPTZ NULL
);

-- One OpenRouter generation id appears at most once.
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_runs_generation_id
ON public.provider_runs (generation_id)
WHERE generation_id IS NOT NULL;

-- Fast picking for the reconcile worker
CREATE INDEX IF NOT EXISTS idx_provider_runs_reconcile_queue
ON public.provider_runs (status, next_reconcile_at NULLS FIRST)
INCLUDE (generation_id, reserved_credits, user_id);

CREATE INDEX IF NOT EXISTS idx_provider_runs_user_status
ON public.provider_runs (user_id, status);

-- 5) Row Level Security (adjust to your needs)
-- Enable RLS so users can read their own rows; service role bypasses RLS.
ALTER TABLE public.credits_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_runs ENABLE ROW LEVEL SECURITY;

-- View own ledger
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'credits_ledger'
        AND policyname = 'select_own_ledger'
    ) THEN
        CREATE POLICY select_own_ledger ON public.credits_ledger
        FOR SELECT USING (user_id = auth.uid());
    END IF;
END $$;

-- View own runs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
        AND tablename = 'provider_runs'
        AND policyname = 'select_own_runs'
    ) THEN
        CREATE POLICY select_own_runs ON public.provider_runs
        FOR SELECT USING (user_id = auth.uid());
    END IF;
END $$;

-- Inserts/updates are done by your server with the service role (bypasses RLS).
-- Do not add insert/update policies for regular users unless you need them.

-- 6) Finance functions for atomic reservation and adjustments
-- SECURITY DEFINER: only grant execute to service_role.
-- Note: These operate solely on cached_current_credits and credits_ledger; the ledger remains the source of truth.

CREATE OR REPLACE FUNCTION public.finance_reserve_credits(
p_user_id UUID,
p_ref_type TEXT,
p_ref_id TEXT,
p_amount BIGINT,
p_metadata JSONB DEFAULT '{}'::JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_existing UUID;
v_balance BIGINT;
v_ledger_id UUID;
BEGIN
IF p_amount IS NULL OR p_amount <= 0 THEN
RAISE EXCEPTION USING MESSAGE = 'amount must be > 0';
END IF;

    -- Idempotency: if a ledger row already exists for this ref, return it.
    SELECT id INTO v_existing
    FROM public.credits_ledger
    WHERE external_ref_type = p_ref_type
    AND external_ref_id = p_ref_id;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Lock the user's profile row
    SELECT cached_current_credits INTO v_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_balance IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'profile_not_found';
    END IF;

    IF v_balance < p_amount THEN
        RAISE EXCEPTION USING MESSAGE = 'insufficient_credits';
    END IF;

    -- Insert ledger reservation (negative delta)
    INSERT INTO public.credits_ledger (
        user_id,
        delta_credits,
        kind,
        external_ref_type,
        external_ref_id,
        metadata
    ) VALUES (
        p_user_id,
        -p_amount,
        'generation_reservation',
        p_ref_type,
        p_ref_id,
        p_metadata
    )
    RETURNING id INTO v_ledger_id;

    -- Update cached balance
    UPDATE public.profiles
    SET cached_current_credits = cached_current_credits - p_amount
    WHERE id = p_user_id;

    RETURN v_ledger_id;

END $$;

COMMENT ON FUNCTION public.finance_reserve_credits(UUID, TEXT, TEXT, BIGINT, JSONB)
IS 'Atomically reserves credits for a generation; idempotent by (external_ref_type, external_ref_id). Delta is -amount.';

CREATE OR REPLACE FUNCTION public.finance_adjust_credits(
p_user_id UUID,
p_ref_type TEXT,
p_ref_id TEXT,
p_delta BIGINT,
p_kind TEXT DEFAULT 'generation_adjustment',
p_metadata JSONB DEFAULT '{}'::JSONB,
p_allow_negative BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
v_existing UUID;
v_balance BIGINT;
v_ledger_id UUID;
BEGIN
IF p_delta IS NULL OR p_delta = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'delta must be non-zero';
END IF;

    IF p_kind IS NULL OR LENGTH(p_kind) = 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'kind must be provided';
    END IF;

    -- Idempotency: if an adjustment for this ref already exists, return it.
    SELECT id INTO v_existing
    FROM public.credits_ledger
    WHERE external_ref_type = p_ref_type
    AND external_ref_id = p_ref_id;

    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    -- Lock the user's profile row
    SELECT cached_current_credits INTO v_balance
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF v_balance IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'profile_not_found';
    END IF;

    -- If charging extra (negative delta) and not allowed to go negative, enforce balance
    IF p_delta < 0 AND NOT p_allow_negative AND v_balance < ABS(p_delta) THEN
        RAISE EXCEPTION USING MESSAGE = 'insufficient_credits_for_adjustment';
    END IF;

    -- Insert ledger adjustment (positive for refund, negative for extra charge)
    INSERT INTO public.credits_ledger (
        user_id,
        delta_credits,
        kind,
        external_ref_type,
        external_ref_id,
        metadata
    ) VALUES (
        p_user_id,
        p_delta,
        p_kind,
        p_ref_type,
        p_ref_id,
        p_metadata
    )
    RETURNING id INTO v_ledger_id;

    -- Update cached balance
    UPDATE public.profiles
    SET cached_current_credits = cached_current_credits + p_delta
    WHERE id = p_user_id;

    RETURN v_ledger_id;

END $$;

COMMENT ON FUNCTION public.finance_adjust_credits(UUID, TEXT, TEXT, BIGINT, TEXT, JSONB, BOOLEAN)
IS 'Applies a refund (+) or an extra charge (-) for a generation; idempotent by (external_ref_type, external_ref_id).';

-- 7) Permissions: only service_role may execute the finance functions
REVOKE ALL ON FUNCTION public.finance_reserve_credits(UUID, TEXT, TEXT, BIGINT, JSONB)
FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.finance_adjust_credits(UUID, TEXT, TEXT, BIGINT, TEXT, JSONB, BOOLEAN)
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finance_reserve_credits(UUID, TEXT, TEXT, BIGINT, JSONB)
TO service_role;

GRANT EXECUTE ON FUNCTION public.finance_adjust_credits(UUID, TEXT, TEXT, BIGINT, TEXT, JSONB, BOOLEAN)
TO service_role;

-- End migration

Implementation guide for agent

Overview

Each OpenRouter API call (parent or tool call) is one “provider run”.
Reserve credits at the start of the run with finance_reserve_credits (ref_type='openrouter_gen_reserve', ref_id=reservation_ref_id).
Track the run in provider_runs. Save reservation_ref_id and, later, the OpenRouter generation_id.
When the run finishes, mark provider_runs.status and finished_at.
Reconcile later using OpenRouter GET /generation?id=GEN_ID and apply finance_adjust_credits with ref_type='openrouter_gen_adjust' and ref_id=GEN_ID.
At generation start (before calling OpenRouter)

Compute a conservative reserved_credits estimate (integer).
Generate reservation_ref_id = uuid string.
Call RPC (service role) finance_reserve_credits(user_id, 'openrouter_gen_reserve', reservation_ref_id, reserved_credits, metadata={model, message_id, step_index}).
If it throws 'insufficient_credits', block the action.
Insert provider_runs row:
user_id, model, message_id, conversation_id, step_index, status='running', reserved_credits, reservation_ref_id.
On first response chunk that includes OpenRouter generation_id

Update provider_runs set generation_id = <id>.
Optional: Update the reservation ledger row metadata to include generation_id for easier debugging:
update credits_ledger set metadata = coalesce(metadata,'{}') || jsonb_build_object('generation_id', <id>) where external_ref_type='openrouter_gen_reserve' and external_ref_id=<reservation_ref_id>;
On stream end for that step

Update provider_runs set status='succeeded' (or 'aborted'/'failed'), finished_at=now(), next_reconcile_at=now().
Reconciliation worker (opportunistic + periodic)

Select small batches:
provider_runs where status in ('succeeded','aborted') and generation_id is not null and actual_credits is null and (next_reconcile_at is null or next_reconcile_at <= now()) limit N.
For each:
GET https://openrouter.ai/api/v1/generation?id=<generation_id>.
If final cost ready:
Convert USD -> credits integer actual_credits.
adjust_delta = reserved_credits - actual_credits.
If adjust_delta != 0:
kind = adjust_delta > 0 ? 'generation_refund' : 'generation_adjustment'
Call finance_adjust_credits(user_id, 'openrouter_gen_adjust', generation_id, adjust_delta, kind, metadata={model, raw_openrouter, reservation_ref_id}, p_allow_negative=false)
Update provider_runs set actual_credits=actual_credits, raw_usage=<openrouter json>, reconciled_at=now(), status='reconciled'.
If not ready or 404:
Set next_reconcile_at = now() + small backoff (e.g., 2-5 minutes).
Tool calls

Treat each tool call as its own run with a new reservation_ref_id and step_index++.
Reserve per step; do not try to pre-reserve for unknown tool chains.
Rate limiting

Do not call /generation?id inline on the user request path.
After each user message, opportunistically reconcile a few pending runs for that user to keep fresh, and also run a tiny cron/interval worker to mop up.
Idempotency

Reservations: external_ref=('openrouter_gen_reserve', reservation_ref_id). Re-trying won’t double deduct.
Adjustments: external_ref=('openrouter_gen_adjust', generation_id). Re-trying won’t double adjust.
Balance reads

For UI speed, use profiles.cached_current_credits. Remember: credits_ledger is the source of truth.
This keeps it simple: one small tracking table, two safe functions, and a background reconciliation loop.
