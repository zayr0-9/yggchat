// server/src/utils/credits.ts
import { CreditsService } from '../database/supamodels'

// Credit allocation per tier (legacy - kept for backward compatibility)
// These values are now stored in Supabase plans table
export const TIER_CREDITS: Record<string, number> = {
  high: 100000, // High Tier God - $20/month
  mid: 60000, // Mid Tier God - $12/month
  low: 25000, // Low Tier God - $5/month
}

export interface CreditCheckResult {
  hasCredits: boolean
  currentBalance: number
  required: number
  shortfall?: number
}

export interface CreditTransaction {
  userId: string
  amount: number
  reason: string
  balanceAfter: number
  createdAt: string
}

/**
 * Check if user has sufficient credits for an operation
 * @param userId - User ID
 * @param requiredAmount - Amount of credits required (positive number)
 * @returns Object with hasCredits boolean and current balance
 */
export async function checkCreditsAvailable(userId: string, requiredAmount: number): Promise<CreditCheckResult> {
  try {
    const result = await CreditsService.checkCreditsAvailable(userId, requiredAmount)
    return {
      hasCredits: result.hasCredits,
      currentBalance: result.currentBalance,
      required: result.required,
      shortfall: result.shortfall,
    }
  } catch (error) {
    console.error('[Credits] Error checking credits:', error)
    return {
      hasCredits: false,
      currentBalance: 0,
      required: requiredAmount,
      shortfall: requiredAmount,
    }
  }
}

/**
 * Atomically decrement user credits using a transaction
 * @param userId - User ID
 * @param amount - Amount to decrement (positive number)
 * @param reason - Reason for the deduction (e.g., 'AI generation - GPT-4')
 * @returns New balance after deduction, or null if insufficient credits
 */
export async function decrementCredits(userId: string, amount: number, reason: string): Promise<number | null> {
  try {
    const newBalance = await CreditsService.decrementCredits(userId, amount, reason)
    if (newBalance === null) {
      console.warn(`[Credits] Insufficient credits for user ${userId}. Required: ${amount}`)
    }
    return newBalance
  } catch (error) {
    console.error('[Credits] Error decrementing credits:', error)
    return null
  }
}

/**
 * Replenish user credits based on their subscription tier
 * @param userId - User ID
 * @param tier - Subscription tier ('high', 'mid', 'low')
 * @param reason - Reason for replenishment (e.g., 'Monthly subscription renewal')
 * @returns New balance after replenishment
 */
export async function replenishCredits(userId: string, tier: 'high' | 'mid' | 'low', reason: string): Promise<number> {
  const creditsToAdd = TIER_CREDITS[tier]

  if (!creditsToAdd) {
    throw new Error(`Invalid tier: ${tier}`)
  }

  try {
    const newBalance = await CreditsService.replenishCredits(userId, creditsToAdd, reason)
    console.log(`[Credits] Replenished ${creditsToAdd} credits for user ${userId}. New balance: ${newBalance}`)
    return newBalance
  } catch (error) {
    console.error('[Credits] Error replenishing credits:', error)
    throw error
  }
}

/**
 * Add credits to user balance (for manual adjustments or bonuses)
 * This ADDS to the current balance instead of replacing it
 * @param userId - User ID
 * @param amount - Amount to add (positive number)
 * @param reason - Reason for the addition
 * @returns New balance after addition
 */
export async function addCredits(userId: string, amount: number, reason: string): Promise<number> {
  try {
    const newBalance = await CreditsService.addCredits(userId, amount, reason)
    console.log(`[Credits] Added ${amount} credits for user ${userId}. New balance: ${newBalance}`)
    return newBalance
  } catch (error) {
    console.error('[Credits] Error adding credits:', error)
    throw error
  }
}

/**
 * Get user's current credit balance
 * @param userId - User ID
 * @returns Current credit balance
 */
export async function getUserCredits(userId: string): Promise<number> {
  try {
    return await CreditsService.getUserCredits(userId)
  } catch (error) {
    console.error('[Credits] Error getting user credits:', error)
    return 0
  }
}

/**
 * Get user's credit transaction history
 * @param userId - User ID
 * @param limit - Number of transactions to retrieve (default 100)
 * @returns Array of credit transactions
 */
export async function getCreditHistory(userId: string, limit: number = 100): Promise<CreditTransaction[]> {
  try {
    const results = await CreditsService.getCreditHistory(userId, limit)
    return results.map(r => ({
      userId: r.user_id,
      amount: r.delta_credits, // Changed from amount to delta_credits
      reason: r.description ?? 'No description',
      balanceAfter: 0, // Not stored in new schema, would need to calculate
      createdAt: r.created_at,
    }))
  } catch (error) {
    console.error('[Credits] Error getting credit history:', error)
    return []
  }
}

/**
 * Get total credits used by user (all-time)
 * @param userId - User ID
 * @returns Total credits used
 */
export async function getTotalCreditsUsed(userId: string): Promise<number> {
  try {
    return await CreditsService.getTotalCreditsUsed(userId)
  } catch (error) {
    console.error('[Credits] Error getting total credits used:', error)
    return 0
  }
}

/**
 * Estimate credits required for an AI generation call
 * This is a rough estimate based on model and expected token usage
 * @param estimatedTokens - Estimated total tokens (input + output)
 * @param model - Model name
 * @returns Estimated credits required
 */
export function estimateCreditsForGeneration(estimatedTokens: number, model: string = 'unknown'): number {
  // Simple credit estimation: 1 credit per 10 tokens
  // This can be adjusted based on your pricing model
  // More expensive models could have different rates
  const baseRate = 0.1 // credits per token

  // Model-specific multipliers (optional)
  let multiplier = 1
  if (model.includes('gpt-4') || model.includes('claude-3-opus')) {
    multiplier = 2 // Premium models cost more
  } else if (model.includes('o1') || model.includes('o3')) {
    multiplier = 3 // Reasoning models cost even more
  }

  return Math.ceil(estimatedTokens * baseRate * multiplier)
}
