import { supabaseAdmin } from '../database/supamodels'
import { hasActiveSubscription } from './stripe'

/**
 * Check if user can access all models (has subscription or credits)
 */
export async function canAccessPaidModels(userId: string): Promise<boolean> {
  const hasSubscription = await hasActiveSubscription(userId)
  if (hasSubscription) return true

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('cached_current_credits')
    .eq('id', userId)
    .single()

  return (profile?.cached_current_credits ?? 0) > 0
}

/**
 * Check if user can generate (has subscription, credits, or free generations left)
 */
export async function canUserGenerate(userId: string): Promise<{
  canGenerate: boolean
  freeGenerationsRemaining: number
  reason?: string
}> {
  // Check paid access first
  const hasPaidAccess = await canAccessPaidModels(userId)
  if (hasPaidAccess) {
    return { canGenerate: true, freeGenerationsRemaining: 0 }
  }

  // Check free generations
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('free_generations_remaining')
    .eq('id', userId)
    .single()

  const remaining = profile?.free_generations_remaining ?? 0

  if (remaining > 0) {
    return { canGenerate: true, freeGenerationsRemaining: remaining }
  }

  return {
    canGenerate: false,
    freeGenerationsRemaining: 0,
    reason: 'Free generations exhausted. Please upgrade to continue.'
  }
}

/**
 * Decrement free generation counter (only if user has no paid access)
 */
export async function decrementFreeGeneration(userId: string): Promise<number> {
  const hasPaidAccess = await canAccessPaidModels(userId)
  if (hasPaidAccess) return -1 // Sentinel: not applicable

  const { data } = await supabaseAdmin.rpc('decrement_free_generation', {
    p_user_id: userId
  })

  return data as number
}

/**
 * Check if model is free tier eligible
 */
export function isFreeTierModel(model: {
  name: string
  promptCost: number
  completionCost: number
}): boolean {
  const FREE_WHITELIST = ['openai/gpt-oss-120b:exacto', 'openai/gpt-oss-20b']

  if (FREE_WHITELIST.includes(model.name)) return true

  return model.promptCost === 0 && model.completionCost === 0
}
