-- ============================================================================
-- ADDITIVE MIGRATION: OpenRouter Generation Tracking & Reconciliation
-- ============================================================================
--
-- This migration EXTENDS the existing billing system with:
-- 1. New ledger_entry_kind values for generation tracking
-- 2. provider_runs table for two-phase commit pattern
-- 3. Atomic reserve/adjust functions for OpenRouter cost management
-- 4. Additional indexes for reconciliation worker performance
--
-- SAFE TO RUN: Only adds new values/tables, doesn't recreate existing ones
-- DEPENDENCIES: Requires supabase_billing_migration.sql to be run first
-- ============================================================================

-- ============================================================================
-- PART 1: EXTEND EXISTING ENUMS
-- ============================================================================

-- Add new ledger entry kinds for OpenRouter generation tracking
DO $$
BEGIN
  -- Add generation_reservation (upfront credit hold)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'generation_reservation'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ledger_entry_kind')
  ) THEN
    ALTER TYPE ledger_entry_kind ADD VALUE 'generation_reservation';
  END IF;

  -- Add generation_refund (when actual < reserved)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'generation_refund'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ledger_entry_kind')
  ) THEN
    ALTER TYPE ledger_entry_kind ADD VALUE 'generation_refund';
  END IF;

  -- Add generation_adjustment (when actual > reserved, or other adjustments)
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'generation_adjustment'
    AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ledger_entry_kind')
  ) THEN
    ALTER TYPE ledger_entry_kind ADD VALUE 'generation_adjustment';
  END IF;
END $$;

-- ============================================================================
-- PART 2: CREATE PROVIDER_RUNS TABLE
-- ============================================================================

-- Track each OpenRouter generation step (parent or tool call)
CREATE TABLE IF NOT EXISTS public.provider_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,

  -- Model and generation tracking
  model text NOT NULL,                          -- e.g., 'anthropic/claude-3.5-sonnet'
  generation_id text,                           -- OpenRouter's generation ID (unique when present)
  reservation_ref_id text NOT NULL,             -- Local UUID for reservation ledger entry
  step_index int NOT NULL DEFAULT 1,            -- 1 for initial call, 2/3/... for tool-call follow-ups

  -- Status tracking
  status text NOT NULL
    CHECK (status IN ('running', 'succeeded', 'aborted', 'failed', 'reconciled'))
    DEFAULT 'running',

  -- Credit tracking
  reserved_credits numeric NOT NULL,            -- Upfront reservation amount
  actual_credits numeric,                       -- Final cost from OpenRouter (NULL until reconciled)

  -- Raw data from OpenRouter
  raw_usage jsonb,                              -- Full response from /generation?id=X

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,                      -- When stream ended
  reconciled_at timestamptz,                    -- When we got final cost from OpenRouter
  next_reconcile_at timestamptz                 -- Next retry time (for backoff)
);

-- Indexes for provider_runs
-- One OpenRouter generation id appears at most once
CREATE UNIQUE INDEX IF NOT EXISTS ux_provider_runs_generation_id
  ON public.provider_runs (generation_id)
  WHERE generation_id IS NOT NULL;

-- Fast picking for the reconcile worker (needs to find pending reconciliations)
CREATE INDEX IF NOT EXISTS idx_provider_runs_reconcile_queue
  ON public.provider_runs (status, next_reconcile_at NULLS FIRST)
  INCLUDE (generation_id, reserved_credits, user_id);

-- User's generation history
CREATE INDEX IF NOT EXISTS idx_provider_runs_user_status
  ON public.provider_runs (user_id, status);

-- User's chronological history (for pagination)
CREATE INDEX IF NOT EXISTS idx_provider_runs_user_created
  ON public.provider_runs (user_id, created_at DESC);

-- Conversation-level tracking
CREATE INDEX IF NOT EXISTS idx_provider_runs_conversation
  ON public.provider_runs (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

-- Message-level tracking
CREATE INDEX IF NOT EXISTS idx_provider_runs_message
  ON public.provider_runs (message_id)
  WHERE message_id IS NOT NULL;

-- ============================================================================
-- PART 3: ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS so users can read their own rows; service role bypasses RLS
ALTER TABLE public.provider_runs ENABLE ROW LEVEL SECURITY;

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

-- Inserts/updates are done by server with service role (bypasses RLS)
-- No insert/update policies for regular users

-- ============================================================================
-- PART 4: FINANCE FUNCTIONS FOR ATOMIC RESERVATION AND ADJUSTMENTS
-- ============================================================================

-- SECURITY DEFINER: only grant execute to service_role
-- These operate on cached_current_credits and credits_ledger

-- Function: Reserve credits atomically (two-phase commit pattern)
CREATE OR REPLACE FUNCTION public.finance_reserve_credits(
  p_user_id uuid,
  p_ref_type text,
  p_ref_id text,
  p_amount numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_balance numeric;
  v_ledger_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be > 0';
  END IF;

  -- Idempotency: if a ledger row already exists for this ref, return it
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
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_credits';
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

COMMENT ON FUNCTION public.finance_reserve_credits(uuid, text, text, numeric, jsonb)
IS 'Atomically reserves credits for a generation; idempotent by (external_ref_type, external_ref_id). Delta is -amount.';

-- Function: Adjust credits (refund or additional charge)
CREATE OR REPLACE FUNCTION public.finance_adjust_credits(
  p_user_id uuid,
  p_ref_type text,
  p_ref_id text,
  p_delta numeric,
  p_kind ledger_entry_kind DEFAULT 'generation_adjustment',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_allow_negative boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_balance numeric;
  v_ledger_id uuid;
BEGIN
  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'delta must be non-zero';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION 'kind must be provided';
  END IF;

  -- Idempotency: if an adjustment for this ref already exists, return it
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
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  -- If charging extra (negative delta) and not allowed to go negative, enforce balance
  IF p_delta < 0 AND NOT p_allow_negative AND v_balance < ABS(p_delta) THEN
    RAISE EXCEPTION 'insufficient_credits_for_adjustment';
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

COMMENT ON FUNCTION public.finance_adjust_credits(uuid, text, text, numeric, ledger_entry_kind, jsonb, boolean)
IS 'Applies a refund (+) or an extra charge (-) for a generation; idempotent by (external_ref_type, external_ref_id).';

-- ============================================================================
-- PART 5: HELPER FUNCTION FOR JSONB UPDATES
-- ============================================================================

-- Helper function to execute raw SQL (for JSONB metadata updates)
-- SECURITY DEFINER: only service_role can execute
CREATE OR REPLACE FUNCTION public.exec_sql(
  sql text,
  params text[] DEFAULT '{}'::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE sql USING params[1], params[2], params[3], params[4], params[5];
END $$;

COMMENT ON FUNCTION public.exec_sql(text, text[])
IS 'Execute raw SQL with parameterized values. SECURITY DEFINER - service_role only.';

-- ============================================================================
-- PART 6: PERMISSIONS
-- ============================================================================

-- Only service_role may execute the finance functions
REVOKE ALL ON FUNCTION public.finance_reserve_credits(uuid, text, text, numeric, jsonb)
  FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.finance_adjust_credits(uuid, text, text, numeric, ledger_entry_kind, jsonb, boolean)
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finance_reserve_credits(uuid, text, text, numeric, jsonb)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.finance_adjust_credits(uuid, text, text, numeric, ledger_entry_kind, jsonb, boolean)
  TO service_role;

REVOKE ALL ON FUNCTION public.exec_sql(text, text[])
  FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.exec_sql(text, text[])
  TO service_role;

-- ============================================================================
-- PART 7: HELPER VIEW FOR RECONCILIATION QUEUE
-- ============================================================================

-- View to make it easy to find runs that need reconciliation
CREATE OR REPLACE VIEW public.provider_runs_pending_reconciliation AS
SELECT
  id,
  user_id,
  generation_id,
  model,
  reserved_credits,
  status,
  created_at,
  finished_at,
  next_reconcile_at,
  CASE
    WHEN next_reconcile_at IS NULL THEN 0
    ELSE EXTRACT(EPOCH FROM (now() - next_reconcile_at))
  END as seconds_overdue
FROM public.provider_runs
WHERE status IN ('succeeded', 'aborted')
  AND generation_id IS NOT NULL
  AND actual_credits IS NULL
  AND (next_reconcile_at IS NULL OR next_reconcile_at <= now())
ORDER BY next_reconcile_at NULLS FIRST
LIMIT 100;

COMMENT ON VIEW public.provider_runs_pending_reconciliation
IS 'Helper view for reconciliation worker: finds runs that need OpenRouter cost lookup';

-- ============================================================================
-- PART 8: ADDITIONAL INDEXES FOR PERFORMANCE
-- ============================================================================

-- Index on credits_ledger for global audit queries
CREATE INDEX IF NOT EXISTS idx_ledger_created_at
  ON public.credits_ledger (created_at DESC);

-- Composite index for kind-specific queries
CREATE INDEX IF NOT EXISTS idx_ledger_user_kind_created
  ON public.credits_ledger (user_id, kind, created_at DESC);

-- End migration
