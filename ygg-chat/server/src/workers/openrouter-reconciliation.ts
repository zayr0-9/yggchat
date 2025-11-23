/**
 * OpenRouter Generation Reconciliation Worker
 *
 * This worker reconciles generation costs by:
 * 1. Finding provider_runs that need reconciliation
 * 2. Fetching final cost from OpenRouter /generation API
 * 3. Calculating the adjustment (reserved - actual)
 * 4. Applying credit adjustments via finance_adjust_credits
 * 5. Marking provider_runs as reconciled
 *
 * Uses a simple polling approach:
 * - Polls every 1 minute for pending reconciliations
 * - Processes up to 10 provider_runs per batch
 * - Reliable and straightforward - no complex Realtime setup
 */

import { supabaseAdmin } from '../database/supamodels'
import { moneyFormat, moneyIsZero, moneySubtract } from '../utils/money'

// Configuration
const RECONCILE_BATCH_SIZE = 10 // Process 10 runs at a time
const RECONCILE_INTERVAL_MS = 60 * 1000 // Poll every 1 minute
const MAX_RETRIES = 10 // Give up after 10 attempts
const INITIAL_BACKOFF_MS = 2 * 60 * 1000 // Start with 2 minute backoff
const MAX_BACKOFF_MS = 60 * 60 * 1000 // Cap at 1 hour
const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

let isRunning = false
let intervalHandle: NodeJS.Timeout | null = null

interface ProviderRun {
  id: string
  user_id: string
  generation_id: string
  model: string
  reserved_credits: number
  reservation_ref_id: string
  status: string
  created_at: string
  next_reconcile_at: string | null
  reconciled_at: string | null
  actual_credits: number | null
  raw_usage: any
}

interface OpenRouterGenerationResponse {
  id: string
  model: string
  streamed: boolean
  generation_time: number
  created_at: number
  tokens_prompt: number
  tokens_completion: number
  native_tokens_prompt?: number
  native_tokens_completion?: number
  native_tokens_reasoning?: number
  num_media_generations?: any
  usage?: number // Cost in USD
  total_cost?: number // Alternative cost field
  moderation_results?: any
  error?: {
    code: number
    message: string
  }
}

/**
 * Fetch generation details from OpenRouter
 */
async function fetchGenerationDetails(generationId: string): Promise<OpenRouterGenerationResponse | null> {
  try {
    const openrouterApiKey = process.env.OPENROUTER_API_KEY
    if (!openrouterApiKey) {
      console.error('OPENROUTER_API_KEY not found in environment')
      return null
    }

    const url = `https://openrouter.ai/api/v1/generation?id=${generationId}`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        'HTTP-Referer': process.env.OPENROUTER_REFERER || process.env.SITE_URL || '',
        'X-Title': process.env.OPENROUTER_TITLE || 'Yggdrasil',
      },
    })

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`⚠️ Generation ${generationId} not found (404) - may not be ready yet`)
        return null
      }
      console.error(`Error fetching generation ${generationId}: ${response.status} ${response.statusText}`)
      return null
    }

    const data = (await response.json()) as any
    console.log(`✅ Fetched generation ${generationId}:`, {
      model: data.data?.model,
      usage: data.data?.usage,
      total_cost: data.data?.total_cost,
      tokens: {
        prompt: data.data?.tokens_prompt,
        completion: data.data?.tokens_completion,
        reasoning: data.data?.native_tokens_reasoning,
      },
    })

    return data.data || null
  } catch (error) {
    console.error(`Error fetching generation ${generationId}:`, error)
    return null
  }
}

/**
 * Calculate credit adjustment based on generation details
 * Returns the delta to apply (positive = refund, negative = additional charge)
 */
function calculateCreditAdjustment(providerRun: ProviderRun, generation: OpenRouterGenerationResponse): number | null {
  // Get actual cost from OpenRouter
  let actualCostUSD = 0

  if (generation.usage !== undefined && generation.usage !== null) {
    actualCostUSD = generation.usage
  } else if (generation.total_cost !== undefined && generation.total_cost !== null) {
    actualCostUSD = generation.total_cost
  } else {
    // No final cost available yet
    console.log(`⏳ Generation ${generation.id} has no final cost yet`)
    return null
  }

  // Convert to credits (assuming 1:1 USD to credits mapping)
  const actualCredits = actualCostUSD

  // Calculate adjustment: reserved - actual
  // Positive = we reserved more than needed (refund)
  // Negative = we reserved less than needed (additional charge)
  // Use precise decimal arithmetic to avoid floating-point errors
  const adjustmentDelta = moneySubtract(providerRun.reserved_credits, actualCredits)

  console.log(`💰 Credit calculation for ${generation.id}:`, {
    reserved: providerRun.reserved_credits,
    actual: actualCredits,
    delta: adjustmentDelta,
    type: adjustmentDelta > 0 ? 'refund' : adjustmentDelta < 0 ? 'charge' : 'exact',
  })

  return adjustmentDelta
}

/**
 * Apply credit adjustment via finance_adjust_credits function
 */
async function applyCreditAdjustment(
  providerRun: ProviderRun,
  adjustmentDelta: number,
  generation: OpenRouterGenerationResponse
): Promise<boolean> {
  try {
    // Determine the kind based on delta
    const kind = adjustmentDelta > 0 ? 'generation_refund' : 'generation_adjustment'

    // Call finance_adjust_credits RPC
    const { data, error } = await supabaseAdmin.rpc('finance_adjust_credits', {
      p_user_id: providerRun.user_id,
      p_ref_type: 'openrouter_gen_adjust',
      p_ref_id: providerRun.generation_id,
      p_delta: adjustmentDelta,
      p_kind: kind,
      p_metadata: {
        model: providerRun.model,
        generation_id: providerRun.generation_id,
        reservation_ref_id: providerRun.reservation_ref_id,
        reserved_credits: providerRun.reserved_credits,
        actual_credits: providerRun.reserved_credits - adjustmentDelta,
        tokens: {
          prompt: generation.tokens_prompt,
          completion: generation.tokens_completion,
          reasoning: generation.native_tokens_reasoning,
        },
        reconciled_at: new Date().toISOString(),
      },
      p_allow_negative: false, // Don't allow going negative (user must have balance)
    })

    if (error) {
      if (error.message.includes('insufficient_credits_for_adjustment')) {
        console.error(
          `⚠️ User ${providerRun.user_id} has insufficient credits for adjustment of ${adjustmentDelta}. Skipping.`
        )
        // Mark as reconciled anyway to avoid infinite retry
        return true
      }
      console.error(`Error applying credit adjustment for ${providerRun.generation_id}:`, error)
      return false
    }

    console.log(
      `✅ Applied ${kind} of ${moneyFormat(adjustmentDelta)} credits for generation ${providerRun.generation_id}`
    )
    return true
  } catch (error) {
    console.error(`Error in applyCreditAdjustment for ${providerRun.generation_id}:`, error)
    return false
  }
}

/**
 * Reconcile a single provider run
 */
async function reconcileProviderRun(providerRun: ProviderRun): Promise<'success' | 'retry' | 'skip'> {
  console.log(`🔄 Reconciling generation ${providerRun.generation_id} (run ${providerRun.id})`)

  // Check if this generation is too old (stale)
  const createdAt = new Date(providerRun.created_at).getTime()
  const now = Date.now()
  if (now - createdAt > STALE_THRESHOLD_MS) {
    console.log(
      `⏭️ Skipping stale generation ${providerRun.generation_id} (created ${Math.floor((now - createdAt) / (24 * 60 * 60 * 1000))} days ago)`
    )
    // Mark as reconciled to remove from queue
    await supabaseAdmin
      .from('provider_runs')
      .update({
        status: 'reconciled',
        reconciled_at: new Date().toISOString(),
      })
      .eq('id', providerRun.id)
    return 'skip'
  }

  // Fetch generation details from OpenRouter
  const generation = await fetchGenerationDetails(providerRun.generation_id)

  if (!generation) {
    // Generation not found or error - retry with backoff
    return 'retry'
  }

  if (generation.error) {
    console.error(`❌ Generation ${providerRun.generation_id} has error:`, generation.error)
    // Mark as reconciled with error to remove from queue
    await supabaseAdmin
      .from('provider_runs')
      .update({
        status: 'failed',
        reconciled_at: new Date().toISOString(),
        raw_usage: generation,
      })
      .eq('id', providerRun.id)
    return 'skip'
  }

  // Calculate credit adjustment
  const adjustmentDelta = calculateCreditAdjustment(providerRun, generation)

  if (adjustmentDelta === null) {
    // Final cost not ready yet - retry later
    return 'retry'
  }

  // If delta is zero (or very close), no adjustment needed
  if (moneyIsZero(adjustmentDelta)) {
    console.log(`✅ No adjustment needed for ${providerRun.generation_id} (exact match)`)
    // Mark as reconciled
    await supabaseAdmin
      .from('provider_runs')
      .update({
        status: 'reconciled',
        actual_credits: providerRun.reserved_credits,
        reconciled_at: new Date().toISOString(),
        raw_usage: generation,
      })
      .eq('id', providerRun.id)
    return 'success'
  }

  // Apply the credit adjustment
  const success = await applyCreditAdjustment(providerRun, adjustmentDelta, generation)

  if (!success) {
    return 'retry'
  }

  // Mark provider run as reconciled
  const actualCredits = moneySubtract(providerRun.reserved_credits, adjustmentDelta)
  const { error } = await supabaseAdmin
    .from('provider_runs')
    .update({
      status: 'reconciled',
      actual_credits: actualCredits,
      reconciled_at: new Date().toISOString(),
      raw_usage: generation,
    })
    .eq('id', providerRun.id)

  if (error) {
    console.error(`Error updating provider_runs ${providerRun.id}:`, error)
    return 'retry'
  }

  console.log(`✅ Successfully reconciled generation ${providerRun.generation_id}`)
  return 'success'
}

/**
 * Calculate next retry time with exponential backoff
 */
function calculateNextRetryTime(attemptCount: number): Date {
  const backoffMs = Math.min(INITIAL_BACKOFF_MS * Math.pow(2, attemptCount), MAX_BACKOFF_MS)
  return new Date(Date.now() + backoffMs)
}

/**
 * Cleanup old aborted runs without generation_id (stuck reservations)
 * These should have been refunded immediately, but this catches any that slipped through
 */
async function cleanupStuckAbortedReservations(): Promise<void> {
  try {
    // Find aborted runs without generation_id that are older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

    const { data: stuckRuns, error } = await supabaseAdmin
      .from('provider_runs')
      .select('id, user_id, reserved_credits, reservation_ref_id, model, created_at')
      .eq('status', 'aborted')
      .is('generation_id', null)
      .is('actual_credits', null)
      .lt('created_at', fiveMinutesAgo)
      .limit(10)

    if (error) {
      console.error('Error fetching stuck aborted reservations:', error)
      return
    }

    if (!stuckRuns || stuckRuns.length === 0) {
      return // No stuck runs to clean up
    }

    console.log(`🧹 Cleaning up ${stuckRuns.length} stuck aborted reservations`)

    for (const run of stuckRuns) {
      try {
        // Refund the full reserved amount
        const { error: refundError } = await supabaseAdmin.rpc('finance_adjust_credits', {
          p_user_id: run.user_id,
          p_ref_type: 'openrouter_gen_abort_cleanup',
          p_ref_id: run.reservation_ref_id,
          p_delta: run.reserved_credits,
          p_kind: 'generation_refund',
          p_metadata: {
            model: run.model,
            provider_run_id: run.id,
            reason: 'Cleanup: Aborted before streaming, refunding stuck reservation',
            cleaned_up_at: new Date().toISOString(),
          },
          p_allow_negative: false,
        })

        if (refundError) {
          console.error(`Error refunding stuck reservation ${run.id}:`, refundError)
          continue
        }

        // Mark as reconciled
        await supabaseAdmin
          .from('provider_runs')
          .update({
            status: 'reconciled',
            actual_credits: 0,
            reconciled_at: new Date().toISOString(),
          })
          .eq('id', run.id)

        console.log(`✅ Cleaned up stuck reservation ${run.id}, refunded ${run.reserved_credits} credits`)
      } catch (error) {
        console.error(`Error processing stuck run ${run.id}:`, error)
      }
    }
  } catch (error) {
    console.error('Error in cleanupStuckAbortedReservations:', error)
  }
}

/**
 * Main reconciliation worker loop
 */
async function runReconciliationBatch(): Promise<void> {
  if (isRunning) {
    console.log('⏭️ Reconciliation already running, skipping this interval')
    return
  }

  isRunning = true

  try {
    // First, cleanup any stuck aborted reservations without generation_id
    await cleanupStuckAbortedReservations()

    // Fetch pending reconciliations from the view
    const { data: pendingRuns, error } = await supabaseAdmin
      .from('provider_runs_pending_reconciliation')
      .select('*')
      .limit(RECONCILE_BATCH_SIZE)

    if (error) {
      console.error('Error fetching pending reconciliations:', error)
      return
    }

    if (!pendingRuns || pendingRuns.length === 0) {
      console.log('✅ No pending reconciliations')
      return
    }

    console.log(`🔄 Processing ${pendingRuns.length} pending reconciliations`)

    for (const run of pendingRuns as ProviderRun[]) {
      const result = await reconcileProviderRun(run)

      if (result === 'retry') {
        // Count attempts (estimate based on backoff or add a retry_count column)
        const createdAt = new Date(run.created_at).getTime()
        const elapsedMs = Date.now() - createdAt
        const estimatedAttempts = Math.floor(Math.log2(elapsedMs / INITIAL_BACKOFF_MS)) + 1

        if (estimatedAttempts >= MAX_RETRIES) {
          console.log(`⏭️ Max retries reached for ${run.generation_id}, marking as failed`)
          await supabaseAdmin
            .from('provider_runs')
            .update({
              status: 'failed',
              reconciled_at: new Date().toISOString(),
            })
            .eq('id', run.id)
        } else {
          // Schedule next retry
          const nextRetryAt = calculateNextRetryTime(estimatedAttempts)
          console.log(`⏰ Scheduling retry for ${run.generation_id} at ${nextRetryAt.toISOString()}`)
          await supabaseAdmin
            .from('provider_runs')
            .update({ next_reconcile_at: nextRetryAt.toISOString() })
            .eq('id', run.id)
        }
      }
    }

    console.log(`✅ Reconciliation batch complete`)
  } catch (error) {
    console.error('Error in reconciliation worker:', error)
  } finally {
    isRunning = false
  }
}

/**
 * Start the reconciliation worker (simple polling mode)
 */
export function startReconciliationWorker(): void {
  if (intervalHandle) {
    console.log('⚠️ Reconciliation worker already running')
    return
  }

  console.log('🚀 Starting OpenRouter reconciliation worker')
  console.log(
    `🔄 Polling every ${RECONCILE_INTERVAL_MS / 1000}s for pending reconciliations (batch size: ${RECONCILE_BATCH_SIZE})`
  )

  // Run initial batch immediately
  runReconciliationBatch()

  // Set up polling interval
  intervalHandle = setInterval(runReconciliationBatch, RECONCILE_INTERVAL_MS)
}

/**
 * Stop the reconciliation worker
 */
export function stopReconciliationWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
    console.log('🛑 Stopped OpenRouter reconciliation worker')
  }
}

/**
 * Manually trigger a reconciliation batch (for testing or on-demand use)
 */
export async function triggerReconciliation(): Promise<void> {
  await runReconciliationBatch()
}
