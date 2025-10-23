-- ============================================================================
-- SUPABASE DATABASE MIGRATION: Stripe Billing & Credits Ledger System
-- ============================================================================
--
-- This migration implements a clean, non-redundant billing system where:
-- - Stripe is the single source of truth for subscription periods
-- - credits_ledger is the single source of truth for balance
-- - No duplicate state across tables
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent with IF EXISTS/NOT EXISTS checks)
-- ============================================================================

-- ============================================================================
-- PART 1: NEW ENUMS
-- ============================================================================

DO $$
BEGIN
  -- Ledger entry types
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ledger_entry_kind') THEN
    CREATE TYPE ledger_entry_kind AS ENUM (
      'monthly_allocation',  -- Credits allocated from subscription invoice
      'usage',              -- Credits consumed by AI API usage
      'topup_credit',       -- Credits purchased via one-time payment
      'refund',             -- Credits refunded
      'adjustment',         -- Manual adjustment (admin)
      'bonus'               -- Promotional credits
    );
  END IF;

  -- Stripe subscription statuses (mirrors Stripe's status enum)
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subscription_status') THEN
    CREATE TYPE subscription_status AS ENUM (
      'active',
      'trialing',
      'past_due',
      'canceled',
      'unpaid',
      'incomplete',
      'incomplete_expired',
      'paused'
    );
  END IF;
END $$;

-- ============================================================================
-- PART 2: NEW TABLES
-- ============================================================================

-- Plans: Maps Stripe price IDs to credit allocations
CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code text UNIQUE NOT NULL,           -- e.g., 'starter', 'pro', 'enterprise'
  stripe_price_id text UNIQUE NOT NULL,     -- e.g., 'price_1ABC...'
  stripe_product_id text,                   -- e.g., 'prod_ABC...'
  included_credits_per_cycle numeric NOT NULL DEFAULT 0,
  display_name text NOT NULL,               -- e.g., 'Starter Plan'
  display_price_usd numeric NOT NULL,       -- e.g., 5.00
  billing_interval text NOT NULL DEFAULT 'month', -- 'month' or 'year'
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plans_stripe_price ON public.plans(stripe_price_id);
CREATE INDEX IF NOT EXISTS idx_plans_code ON public.plans(plan_code);
CREATE INDEX IF NOT EXISTS idx_plans_active ON public.plans(is_active) WHERE is_active = true;

-- Subscriptions: Synced from Stripe via webhooks
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_subscription_id text UNIQUE NOT NULL,
  stripe_customer_id text NOT NULL,
  stripe_price_id text NOT NULL,
  plan_id uuid REFERENCES public.plans(id) ON DELETE SET NULL,
  status subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_start timestamptz NOT NULL,
  current_period_end timestamptz NOT NULL,
  billing_cycle_anchor timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON public.subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON public.subscriptions(stripe_customer_id);

-- Credits Ledger: Single source of truth for all credit activity
CREATE TABLE IF NOT EXISTS public.credits_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  delta_credits numeric NOT NULL,           -- Positive = add, Negative = deduct
  kind ledger_entry_kind NOT NULL,

  -- External reference for idempotency (e.g., invoice_id, payment_intent_id, message_id)
  external_ref_type text,                   -- 'invoice', 'payment_intent', 'message', 'manual'
  external_ref_id text,                     -- The actual Stripe/internal ID

  -- For usage entries: link to message
  message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,

  -- Rich metadata stored as JSON
  -- For usage: {prompt_tokens, completion_tokens, reasoning_tokens, approx_cost, model_name, etc.}
  -- For topup: {gross_amount, platform_cut, net_credits}
  -- For allocation: {period_start, period_end, plan_code}
  metadata jsonb DEFAULT '{}'::jsonb,

  description text,                         -- Human-readable description
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Idempotency constraint: prevent duplicate credits from webhook retries
  CONSTRAINT unique_external_ref UNIQUE NULLS NOT DISTINCT (user_id, external_ref_type, external_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_created ON public.credits_ledger(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_kind ON public.credits_ledger(kind);
CREATE INDEX IF NOT EXISTS idx_ledger_message ON public.credits_ledger(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_conversation ON public.credits_ledger(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ledger_external_ref ON public.credits_ledger(external_ref_type, external_ref_id) WHERE external_ref_id IS NOT NULL;

-- ============================================================================
-- PART 3: DROP EXISTING VIEWS THAT DEPEND ON PROFILES TABLE
-- ============================================================================

-- We need to drop these views before modifying the profiles table
-- They will be recreated in Part 7 with the new schema
DROP VIEW IF EXISTS public.user_credit_summary CASCADE;
DROP VIEW IF EXISTS public.users_low_credits CASCADE;
DROP VIEW IF EXISTS public.provider_cost_with_message CASCADE;

-- ============================================================================
-- PART 4: MODIFY PROFILES TABLE
-- ============================================================================

-- Add new Stripe-related columns
DO $$
BEGIN
  -- Add stripe_customer_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'stripe_customer_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN stripe_customer_id text UNIQUE;
  END IF;

  -- Add active_subscription_id (FK to subscriptions)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'active_subscription_id'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN active_subscription_id uuid REFERENCES public.subscriptions(id) ON DELETE SET NULL;
  END IF;

  -- Rename current_credits to cached_current_credits for clarity
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'profiles'
    AND column_name = 'current_credits'
  ) THEN
    ALTER TABLE public.profiles RENAME COLUMN current_credits TO cached_current_credits;
  END IF;
END $$;

-- Create index on stripe_customer_id
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON public.profiles(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_active_sub ON public.profiles(active_subscription_id) WHERE active_subscription_id IS NOT NULL;

-- Drop redundant columns that are now derived from subscriptions/ledger
-- CAREFUL: This will delete data! Comment out if you want to preserve for migration
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS max_credits;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS last_reset_at;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS reset_period;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS credits_enabled;

-- Instead, we'll keep them but mark as deprecated in comments for now
COMMENT ON COLUMN public.profiles.max_credits IS 'DEPRECATED: Use plans.included_credits_per_cycle via active subscription';
COMMENT ON COLUMN public.profiles.last_reset_at IS 'DEPRECATED: Use subscriptions.current_period_start';
COMMENT ON COLUMN public.profiles.reset_period IS 'DEPRECATED: Use subscriptions.billing_cycle_anchor';
COMMENT ON COLUMN public.profiles.credits_enabled IS 'DEPRECATED: Derive from subscriptions.status = active';

-- ============================================================================
-- PART 5: REMOVE OLD TRIGGERS AND FUNCTIONS
-- ============================================================================

-- Drop old credit-related triggers
DROP TRIGGER IF EXISTS trg_pc_after_insert ON public.provider_cost;
DROP TRIGGER IF EXISTS trg_pc_after_delete ON public.provider_cost;

-- Drop old credit functions
DROP FUNCTION IF EXISTS public.deduct_credits_on_cost();
DROP FUNCTION IF EXISTS public.refund_credits_on_cost_delete();

-- ============================================================================
-- PART 6: NEW LEDGER-BASED FUNCTIONS
-- ============================================================================

-- Function: Get current credit balance for a user
CREATE OR REPLACE FUNCTION public.get_user_credit_balance(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(delta_credits), 0)
  FROM public.credits_ledger
  WHERE user_id = p_user_id;
$$;

-- Function: Check if user has sufficient credits
CREATE OR REPLACE FUNCTION public.can_deduct_credits(p_user_id uuid, p_amount numeric)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.get_user_credit_balance(p_user_id) >= p_amount;
$$;

-- Function: Insert usage ledger entry and update cached balance
CREATE OR REPLACE FUNCTION public.insert_usage_ledger_entry(
  p_user_id uuid,
  p_message_id uuid,
  p_conversation_id uuid,
  p_credits_cost numeric,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_id uuid;
BEGIN
  -- Insert usage entry into ledger
  INSERT INTO public.credits_ledger (
    user_id,
    delta_credits,
    kind,
    external_ref_type,
    external_ref_id,
    message_id,
    conversation_id,
    metadata,
    description
  ) VALUES (
    p_user_id,
    -ABS(p_credits_cost),  -- Ensure negative for usage
    'usage',
    'message',
    p_message_id::text,
    p_message_id,
    p_conversation_id,
    p_metadata,
    COALESCE(p_description, 'AI API usage')
  )
  RETURNING id INTO v_ledger_id;

  -- Update cached balance (optional optimization)
  UPDATE public.profiles
  SET cached_current_credits = GREATEST(0, cached_current_credits - ABS(p_credits_cost))
  WHERE id = p_user_id;

  RETURN v_ledger_id;
END;
$$;

-- Function: Insert allocation ledger entry (called from webhook)
CREATE OR REPLACE FUNCTION public.insert_allocation_ledger_entry(
  p_user_id uuid,
  p_credits numeric,
  p_invoice_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_description text DEFAULT 'Monthly credit allocation'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_id uuid;
BEGIN
  -- Insert with idempotency check via unique constraint
  INSERT INTO public.credits_ledger (
    user_id,
    delta_credits,
    kind,
    external_ref_type,
    external_ref_id,
    metadata,
    description
  ) VALUES (
    p_user_id,
    p_credits,
    'monthly_allocation',
    'invoice',
    p_invoice_id,
    p_metadata,
    p_description
  )
  ON CONFLICT (user_id, external_ref_type, external_ref_id) DO NOTHING
  RETURNING id INTO v_ledger_id;

  -- Update cached balance if insert succeeded
  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.profiles
    SET cached_current_credits = cached_current_credits + p_credits
    WHERE id = p_user_id;
  END IF;

  RETURN v_ledger_id;
END;
$$;

-- Function: Insert topup ledger entry
CREATE OR REPLACE FUNCTION public.insert_topup_ledger_entry(
  p_user_id uuid,
  p_credits numeric,
  p_payment_intent_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_description text DEFAULT 'Credit top-up'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger_id uuid;
BEGIN
  -- Insert with idempotency check
  INSERT INTO public.credits_ledger (
    user_id,
    delta_credits,
    kind,
    external_ref_type,
    external_ref_id,
    metadata,
    description
  ) VALUES (
    p_user_id,
    p_credits,
    'topup_credit',
    'payment_intent',
    p_payment_intent_id,
    p_metadata,
    p_description
  )
  ON CONFLICT (user_id, external_ref_type, external_ref_id) DO NOTHING
  RETURNING id INTO v_ledger_id;

  -- Update cached balance if insert succeeded
  IF v_ledger_id IS NOT NULL THEN
    UPDATE public.profiles
    SET cached_current_credits = cached_current_credits + p_credits
    WHERE id = p_user_id;
  END IF;

  RETURN v_ledger_id;
END;
$$;

-- Function: Sync cached balance from ledger (for maintenance/reconciliation)
CREATE OR REPLACE FUNCTION public.sync_cached_balance(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actual_balance numeric;
BEGIN
  v_actual_balance := public.get_user_credit_balance(p_user_id);

  UPDATE public.profiles
  SET cached_current_credits = v_actual_balance
  WHERE id = p_user_id;

  RETURN v_actual_balance;
END;
$$;

-- ============================================================================
-- PART 7: WEBHOOK HANDLER FUNCTIONS (Called by backend on Stripe events)
-- ============================================================================

-- Handle: invoice.payment_succeeded
CREATE OR REPLACE FUNCTION public.handle_invoice_payment_succeeded(
  p_user_id uuid,
  p_stripe_subscription_id text,
  p_stripe_invoice_id text,
  p_stripe_price_id text,
  p_period_start timestamptz,
  p_period_end timestamptz
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_credits numeric;
  v_ledger_id uuid;
BEGIN
  -- Look up credits from plan
  SELECT included_credits_per_cycle INTO v_plan_credits
  FROM public.plans
  WHERE stripe_price_id = p_stripe_price_id AND is_active = true;

  IF v_plan_credits IS NULL THEN
    RAISE EXCEPTION 'No active plan found for price_id: %', p_stripe_price_id;
  END IF;

  -- Insert allocation ledger entry (idempotent via unique constraint)
  v_ledger_id := public.insert_allocation_ledger_entry(
    p_user_id,
    v_plan_credits,
    p_stripe_invoice_id,
    jsonb_build_object(
      'subscription_id', p_stripe_subscription_id,
      'price_id', p_stripe_price_id,
      'period_start', p_period_start,
      'period_end', p_period_end
    ),
    format('Monthly allocation: %s credits', v_plan_credits)
  );

  RETURN v_ledger_id;
END;
$$;

-- Handle: customer.subscription.created/updated
CREATE OR REPLACE FUNCTION public.handle_subscription_upsert(
  p_user_id uuid,
  p_stripe_subscription_id text,
  p_stripe_customer_id text,
  p_stripe_price_id text,
  p_status subscription_status,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_billing_cycle_anchor timestamptz,
  p_cancel_at_period_end boolean DEFAULT false,
  p_canceled_at timestamptz DEFAULT NULL,
  p_trial_start timestamptz DEFAULT NULL,
  p_trial_end timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_plan_id uuid;
BEGIN
  -- Look up plan_id
  SELECT id INTO v_plan_id
  FROM public.plans
  WHERE stripe_price_id = p_stripe_price_id;

  -- Upsert subscription
  INSERT INTO public.subscriptions (
    user_id,
    stripe_subscription_id,
    stripe_customer_id,
    stripe_price_id,
    plan_id,
    status,
    current_period_start,
    current_period_end,
    billing_cycle_anchor,
    cancel_at_period_end,
    canceled_at,
    trial_start,
    trial_end,
    metadata,
    updated_at
  ) VALUES (
    p_user_id,
    p_stripe_subscription_id,
    p_stripe_customer_id,
    p_stripe_price_id,
    v_plan_id,
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_billing_cycle_anchor,
    p_cancel_at_period_end,
    p_canceled_at,
    p_trial_start,
    p_trial_end,
    p_metadata,
    now()
  )
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    status = EXCLUDED.status,
    stripe_price_id = EXCLUDED.stripe_price_id,
    plan_id = EXCLUDED.plan_id,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    billing_cycle_anchor = EXCLUDED.billing_cycle_anchor,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    canceled_at = EXCLUDED.canceled_at,
    trial_start = EXCLUDED.trial_start,
    trial_end = EXCLUDED.trial_end,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_subscription_id;

  -- Update user's active subscription if this is active
  IF p_status IN ('active', 'trialing') THEN
    UPDATE public.profiles
    SET
      active_subscription_id = v_subscription_id,
      stripe_customer_id = p_stripe_customer_id
    WHERE id = p_user_id;
  END IF;

  RETURN v_subscription_id;
END;
$$;

-- Handle: payment_intent.succeeded (for top-ups)
CREATE OR REPLACE FUNCTION public.handle_payment_intent_succeeded(
  p_user_id uuid,
  p_payment_intent_id text,
  p_amount_usd numeric,
  p_platform_cut_percent numeric DEFAULT 10.0,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_net_credits numeric;
  v_ledger_id uuid;
BEGIN
  -- Calculate net credits after platform cut
  v_net_credits := p_amount_usd * (1 - p_platform_cut_percent / 100.0);

  -- Insert topup ledger entry (idempotent)
  v_ledger_id := public.insert_topup_ledger_entry(
    p_user_id,
    v_net_credits,
    p_payment_intent_id,
    jsonb_build_object(
      'gross_amount', p_amount_usd,
      'platform_cut_percent', p_platform_cut_percent,
      'net_credits', v_net_credits
    ) || p_metadata,
    format('Top-up: $%s → %s credits', p_amount_usd, v_net_credits)
  );

  RETURN v_ledger_id;
END;
$$;

-- ============================================================================
-- PART 8: UPDATED VIEWS
-- ============================================================================

-- Note: Views were already dropped in Part 3 before table modifications
-- Now we recreate them with the new schema

-- View: User credit summary (reads from subscriptions + ledger)
CREATE OR REPLACE VIEW public.user_credit_summary AS
SELECT
  p.id,
  p.username,
  p.stripe_customer_id,

  -- Subscription info
  s.stripe_subscription_id,
  s.status AS subscription_status,
  s.current_period_start,
  s.current_period_end,
  s.cancel_at_period_end,
  pl.plan_code,
  pl.display_name AS plan_name,
  pl.included_credits_per_cycle AS monthly_credits,

  -- Credit balance (from ledger)
  public.get_user_credit_balance(p.id) AS current_credits,
  p.cached_current_credits,
  p.total_spent,

  -- Calculate percentage remaining
  ROUND(
    CASE
      WHEN pl.included_credits_per_cycle > 0
      THEN (public.get_user_credit_balance(p.id) / pl.included_credits_per_cycle) * 100
      ELSE 0
    END::numeric,
    2
  ) AS credits_remaining_percent,

  -- Lifetime stats
  COALESCE(
    (SELECT SUM(ABS(delta_credits))
     FROM public.credits_ledger
     WHERE user_id = p.id AND kind = 'usage'),
    0
  ) AS lifetime_credits_used,

  COALESCE(
    (SELECT COUNT(*)
     FROM public.credits_ledger
     WHERE user_id = p.id),
    0
  ) AS total_transactions

FROM public.profiles p
LEFT JOIN public.subscriptions s ON s.id = p.active_subscription_id
LEFT JOIN public.plans pl ON pl.id = s.plan_id
WHERE p.id = auth.uid();

-- View: Users with low credits
CREATE OR REPLACE VIEW public.users_low_credits AS
SELECT
  p.id,
  p.username,
  public.get_user_credit_balance(p.id) AS current_credits,
  pl.included_credits_per_cycle AS max_credits,
  ROUND(
    CASE
      WHEN pl.included_credits_per_cycle > 0
      THEN (public.get_user_credit_balance(p.id) / pl.included_credits_per_cycle) * 100
      ELSE 0
    END::numeric,
    2
  ) AS remaining_percent
FROM public.profiles p
LEFT JOIN public.subscriptions s ON s.id = p.active_subscription_id
LEFT JOIN public.plans pl ON pl.id = s.plan_id
WHERE p.id = auth.uid()
  AND s.status IN ('active', 'trialing')
  AND public.get_user_credit_balance(p.id) < (pl.included_credits_per_cycle * 0.2)
ORDER BY remaining_percent ASC NULLS LAST;

-- View: Usage history (filters ledger for usage entries with message details)
CREATE OR REPLACE VIEW public.usage_history AS
SELECT
  cl.id,
  cl.user_id,
  cl.delta_credits AS credits_used,
  cl.message_id,
  cl.conversation_id,
  cl.metadata,
  cl.description,
  cl.created_at,

  -- Join message details
  m.role,
  m.content,
  m.model_name,

  -- Join conversation details
  c.title AS conversation_title,

  -- Extract token info from metadata
  (cl.metadata->>'prompt_tokens')::bigint AS prompt_tokens,
  (cl.metadata->>'completion_tokens')::bigint AS completion_tokens,
  (cl.metadata->>'reasoning_tokens')::bigint AS reasoning_tokens,
  (cl.metadata->>'approx_cost')::numeric AS approx_cost

FROM public.credits_ledger cl
LEFT JOIN public.messages m ON m.id = cl.message_id
LEFT JOIN public.conversations c ON c.id = cl.conversation_id
WHERE cl.kind = 'usage'
  AND cl.user_id = auth.uid()
ORDER BY cl.created_at DESC;

-- View: Allocation history (monthly credits received)
CREATE OR REPLACE VIEW public.allocation_history AS
SELECT
  cl.id,
  cl.user_id,
  cl.delta_credits AS credits_allocated,
  cl.external_ref_id AS invoice_id,
  cl.metadata,
  cl.description,
  cl.created_at,

  -- Extract period info from metadata
  (cl.metadata->>'period_start')::timestamptz AS period_start,
  (cl.metadata->>'period_end')::timestamptz AS period_end,
  cl.metadata->>'price_id' AS stripe_price_id

FROM public.credits_ledger cl
WHERE cl.kind = 'monthly_allocation'
  AND cl.user_id = auth.uid()
ORDER BY cl.created_at DESC;

-- View: Topup history
CREATE OR REPLACE VIEW public.topup_history AS
SELECT
  cl.id,
  cl.user_id,
  cl.delta_credits AS credits_purchased,
  cl.external_ref_id AS payment_intent_id,
  cl.metadata,
  cl.description,
  cl.created_at,

  -- Extract payment info from metadata
  (cl.metadata->>'gross_amount')::numeric AS amount_paid_usd,
  (cl.metadata->>'platform_cut_percent')::numeric AS platform_cut_percent,
  (cl.metadata->>'net_credits')::numeric AS net_credits

FROM public.credits_ledger cl
WHERE cl.kind = 'topup_credit'
  AND cl.user_id = auth.uid()
ORDER BY cl.created_at DESC;

-- ============================================================================
-- PART 9: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on new tables
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credits_ledger ENABLE ROW LEVEL SECURITY;

-- Plans: Everyone can view active plans (for pricing page)
DROP POLICY IF EXISTS "plans_select_all" ON public.plans;
CREATE POLICY "plans_select_all"
  ON public.plans
  FOR SELECT
  USING (is_active = true);

-- Plans: Only service role can modify
DROP POLICY IF EXISTS "plans_modify_service" ON public.plans;
CREATE POLICY "plans_modify_service"
  ON public.plans
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Subscriptions: Users can view their own
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own"
  ON public.subscriptions
  FOR SELECT
  USING (user_id = auth.uid());

-- Subscriptions: Only service role can modify (via webhooks)
DROP POLICY IF EXISTS "subscriptions_modify_service" ON public.subscriptions;
CREATE POLICY "subscriptions_modify_service"
  ON public.subscriptions
  FOR ALL
  USING (auth.jwt()->>'role' = 'service_role')
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Credits Ledger: Users can view their own entries
DROP POLICY IF EXISTS "ledger_select_own" ON public.credits_ledger;
CREATE POLICY "ledger_select_own"
  ON public.credits_ledger
  FOR SELECT
  USING (user_id = auth.uid());

-- Credits Ledger: Only service role can insert (via functions/webhooks)
DROP POLICY IF EXISTS "ledger_insert_service" ON public.credits_ledger;
CREATE POLICY "ledger_insert_service"
  ON public.credits_ledger
  FOR INSERT
  WITH CHECK (auth.jwt()->>'role' = 'service_role');

-- Credits Ledger: No updates or deletes (append-only)
-- (No policies needed - default deny)

-- ============================================================================
-- PART 10: DATA MIGRATION (Optional - Backfill from provider_cost)
-- ============================================================================

-- This function migrates existing provider_cost records to credits_ledger
-- RUN THIS ONLY ONCE after deploying the new schema
CREATE OR REPLACE FUNCTION public.migrate_provider_cost_to_ledger()
RETURNS TABLE (
  migrated_count bigint,
  total_credits_migrated numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_migrated_count bigint := 0;
  v_total_credits numeric := 0;
BEGIN
  -- Check if provider_cost table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'provider_cost'
  ) THEN
    RAISE NOTICE 'provider_cost table does not exist, skipping migration';
    RETURN QUERY SELECT 0::bigint, 0::numeric;
    RETURN;
  END IF;

  -- Insert provider_cost records as usage entries in credits_ledger
  INSERT INTO public.credits_ledger (
    user_id,
    delta_credits,
    kind,
    external_ref_type,
    external_ref_id,
    message_id,
    conversation_id,
    metadata,
    description,
    created_at
  )
  SELECT
    pc.owner_id,
    -ABS(pc.api_credit_cost),  -- Negative for usage
    'usage'::ledger_entry_kind,
    'message',
    pc.message_id::text,
    pc.message_id,
    m.conversation_id,
    jsonb_build_object(
      'prompt_tokens', pc.prompt_tokens,
      'completion_tokens', pc.completion_tokens,
      'reasoning_tokens', pc.reasoning_tokens,
      'approx_cost', pc.approx_cost,
      'model_name', m.model_name,
      'migrated_from_provider_cost', true,
      'original_provider_cost_id', pc.id
    ),
    'Migrated from provider_cost table',
    pc.created_at
  FROM public.provider_cost pc
  JOIN public.messages m ON m.id = pc.message_id
  ON CONFLICT (user_id, external_ref_type, external_ref_id) DO NOTHING;

  GET DIAGNOSTICS v_migrated_count = ROW_COUNT;

  SELECT SUM(ABS(delta_credits)) INTO v_total_credits
  FROM public.credits_ledger
  WHERE metadata->>'migrated_from_provider_cost' = 'true';

  RAISE NOTICE 'Migrated % records, total % credits', v_migrated_count, v_total_credits;

  RETURN QUERY SELECT v_migrated_count, COALESCE(v_total_credits, 0);
END;
$$;

-- ============================================================================
-- PART 11: HELPER FUNCTIONS FOR APPLICATION USE
-- ============================================================================

-- Get user's current subscription details
CREATE OR REPLACE FUNCTION public.get_user_subscription(p_user_id uuid)
RETURNS TABLE (
  subscription_id uuid,
  stripe_subscription_id text,
  status subscription_status,
  plan_code text,
  plan_name text,
  monthly_credits numeric,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.id,
    s.stripe_subscription_id,
    s.status,
    pl.plan_code,
    pl.display_name,
    pl.included_credits_per_cycle,
    s.current_period_start,
    s.current_period_end,
    s.cancel_at_period_end
  FROM public.subscriptions s
  JOIN public.plans pl ON pl.id = s.plan_id
  WHERE s.user_id = p_user_id
    AND s.id = (SELECT active_subscription_id FROM public.profiles WHERE id = p_user_id)
  LIMIT 1;
$$;

-- Get usage summary for a date range
CREATE OR REPLACE FUNCTION public.get_usage_summary(
  p_user_id uuid,
  p_start_date timestamptz DEFAULT NULL,
  p_end_date timestamptz DEFAULT NULL
)
RETURNS TABLE (
  total_credits_used numeric,
  total_messages bigint,
  total_prompt_tokens bigint,
  total_completion_tokens bigint,
  total_reasoning_tokens bigint,
  approx_cost_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(SUM(ABS(delta_credits)), 0) AS total_credits_used,
    COUNT(DISTINCT message_id) AS total_messages,
    COALESCE(SUM((metadata->>'prompt_tokens')::bigint), 0) AS total_prompt_tokens,
    COALESCE(SUM((metadata->>'completion_tokens')::bigint), 0) AS total_completion_tokens,
    COALESCE(SUM((metadata->>'reasoning_tokens')::bigint), 0) AS total_reasoning_tokens,
    COALESCE(SUM((metadata->>'approx_cost')::numeric), 0) AS approx_cost_usd
  FROM public.credits_ledger
  WHERE user_id = p_user_id
    AND kind = 'usage'
    AND (p_start_date IS NULL OR created_at >= p_start_date)
    AND (p_end_date IS NULL OR created_at <= p_end_date);
$$;

-- Check if user can afford an operation
CREATE OR REPLACE FUNCTION public.check_credit_availability(
  p_user_id uuid,
  p_required_credits numeric
)
RETURNS TABLE (
  has_credits boolean,
  current_balance numeric,
  required_credits numeric,
  shortfall numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH balance AS (
    SELECT public.get_user_credit_balance(p_user_id) AS current
  )
  SELECT
    current >= p_required_credits AS has_credits,
    current AS current_balance,
    p_required_credits AS required_credits,
    GREATEST(0, p_required_credits - current) AS shortfall
  FROM balance;
$$;

-- ============================================================================
-- PART 12: SAMPLE DATA (Optional - for testing)
-- ============================================================================

-- Insert sample plans
-- Uncomment to create sample plans for testing

/*
INSERT INTO public.plans (plan_code, stripe_price_id, stripe_product_id, included_credits_per_cycle, display_name, display_price_usd, billing_interval)
VALUES
  ('free', 'price_free_tier', 'prod_free', 10, 'Free Tier', 0, 'month'),
  ('starter', 'price_starter_monthly', 'prod_starter', 100, 'Starter Plan', 5, 'month'),
  ('pro', 'price_pro_monthly', 'prod_pro', 500, 'Pro Plan', 20, 'month'),
  ('enterprise', 'price_enterprise_monthly', 'prod_enterprise', 2000, 'Enterprise Plan', 50, 'month')
ON CONFLICT (stripe_price_id) DO NOTHING;
*/

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================

-- To apply this migration:
-- 1. Review all changes carefully
-- 2. Run this SQL in your Supabase SQL editor
-- 3. Optionally run: SELECT * FROM public.migrate_provider_cost_to_ledger();
-- 4. Update your application code to use new ledger-based functions
-- 5. Configure Stripe webhooks to call the webhook handler functions
-- 6. After confirming everything works, you can drop the provider_cost table:
--    DROP TABLE IF EXISTS public.provider_cost CASCADE;

-- Verification queries:
-- SELECT * FROM public.plans;
-- SELECT * FROM public.subscriptions;
-- SELECT * FROM public.credits_ledger ORDER BY created_at DESC LIMIT 10;
-- SELECT * FROM public.user_credit_summary;
-- SELECT public.get_user_credit_balance(auth.uid());
