// server/src/utils/credits.ts
import { db, statements } from '../database/db'
import { generateId } from '../database/idGenerator'

// Credit allocation per tier (these can be adjusted based on your pricing model)
export const TIER_CREDITS: Record<string, number> = {
  high: 100000, // High Tier God - $20/month
  mid: 60000, // Mid Tier God - $12/month
  low: 25000, // Low Tier God - $5/month
}

export interface CreditCheckResult {
  hasCredits: boolean
  currentBalance: number
  required: number
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
export function checkCreditsAvailable(userId: string, requiredAmount: number): CreditCheckResult {
  try {
    const result = statements.getUserCredits.get(userId) as { credits_balance: number } | undefined
    const currentBalance = result?.credits_balance ?? 0

    return {
      hasCredits: currentBalance >= requiredAmount,
      currentBalance,
      required: requiredAmount,
    }
  } catch (error) {
    console.error('[Credits] Error checking credits:', error)
    return {
      hasCredits: false,
      currentBalance: 0,
      required: requiredAmount,
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
export function decrementCredits(userId: string, amount: number, reason: string): number | null {
  // Use a transaction to ensure atomicity
  const transaction = db.transaction((uid: string, amt: number, rsn: string) => {
    // Get current balance
    const result = statements.getUserCredits.get(uid) as { credits_balance: number } | undefined
    const currentBalance = result?.credits_balance ?? 0

    // Check if sufficient credits
    if (currentBalance < amt) {
      throw new Error('Insufficient credits')
    }

    // Calculate new balance
    const newBalance = currentBalance - amt

    // Update user credits
    statements.updateUserCredits.run(newBalance, uid)

    // Log transaction to ledger (negative amount for deduction)
    statements.createCreditLedgerEntry.run(generateId(), uid, -amt, rsn, newBalance)

    return newBalance
  })

  try {
    const newBalance = transaction(userId, amount, reason)
    console.log(`[Credits] Decremented ${amount} credits for user ${userId}. New balance: ${newBalance}`)
    return newBalance
  } catch (error: any) {
    if (error.message === 'Insufficient credits') {
      console.warn(`[Credits] Insufficient credits for user ${userId}. Required: ${amount}`)
      return null
    }
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
export function replenishCredits(userId: string, tier: 'high' | 'mid' | 'low', reason: string): number {
  const creditsToAdd = TIER_CREDITS[tier]

  if (!creditsToAdd) {
    throw new Error(`Invalid tier: ${tier}`)
  }

  // Use transaction for atomic update
  const transaction = db.transaction((uid: string, amt: number, rsn: string) => {
    // Get current balance
    const result = statements.getUserCredits.get(uid) as { credits_balance: number } | undefined
    const currentBalance = result?.credits_balance ?? 0

    // Set new balance (replenishment replaces the balance, not adds to it)
    const newBalance = amt

    // Update user credits
    statements.updateUserCredits.run(newBalance, uid)

    // Log transaction to ledger (positive amount for replenishment)
    statements.createCreditLedgerEntry.run(generateId(), uid, amt, rsn, newBalance)

    return newBalance
  })

  try {
    const newBalance = transaction(userId, creditsToAdd, reason)
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
export function addCredits(userId: string, amount: number, reason: string): number {
  const transaction = db.transaction((uid: string, amt: number, rsn: string) => {
    // Get current balance
    const result = statements.getUserCredits.get(uid) as { credits_balance: number } | undefined
    const currentBalance = result?.credits_balance ?? 0

    // Calculate new balance
    const newBalance = currentBalance + amt

    // Update user credits
    statements.updateUserCredits.run(newBalance, uid)

    // Log transaction to ledger
    statements.createCreditLedgerEntry.run(generateId(), uid, amt, rsn, newBalance)

    return newBalance
  })

  try {
    const newBalance = transaction(userId, amount, reason)
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
export function getUserCredits(userId: string): number {
  try {
    const result = statements.getUserCredits.get(userId) as { credits_balance: number } | undefined
    return result?.credits_balance ?? 0
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
export function getCreditHistory(userId: string, limit: number = 100): CreditTransaction[] {
  try {
    const results = statements.getCreditLedgerByUser.all(userId, limit) as any[]
    return results.map(r => ({
      userId: r.user_id,
      amount: r.amount,
      reason: r.reason,
      balanceAfter: r.balance_after,
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
export function getTotalCreditsUsed(userId: string): number {
  try {
    const result = statements.getTotalCreditsUsedByUser.get(userId) as { total_credits_used: number | null } | undefined
    return result?.total_credits_used ?? 0
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
