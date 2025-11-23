// Payment provider types and interfaces

export interface SubscriptionStatus {
  tier: 'high' | 'mid' | 'low' | null
  status: 'active' | 'canceled' | 'past_due' | null
  currentPeriodEnd: string | null
  creditsBalance: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface TierInfo {
  name: string
  price: number
  priceId: string
  credits: number
  features: string[]
}

export interface CreditHistoryEntry {
  id: string
  userId: string
  amount: number
  type: 'purchase' | 'usage' | 'refund'
  description: string
  createdAt: string
}

/**
 * Payment Provider Interface
 *
 * All payment implementations must conform to this interface.
 * This allows us to swap between Stripe (web) and no-op (Electron) seamlessly.
 */
export interface PaymentProvider {
  /**
   * Check if payments are supported in this environment
   */
  isSupported(): boolean

  /**
   * Create a checkout session for purchasing a subscription
   */
  createCheckoutSession(
    userId: string,
    tier: 'high' | 'mid' | 'low',
    email?: string
  ): Promise<{
    sessionId: string
    url: string
  }>

  /**
   * Get the current subscription status for a user
   */
  getSubscriptionStatus(userId: string): Promise<SubscriptionStatus>

  /**
   * Cancel a user's subscription
   */
  cancelSubscription(userId: string): Promise<void>

  /**
   * Get credit history for a user
   */
  getCreditHistory(userId: string, limit?: number): Promise<CreditHistoryEntry[]>

  /**
   * Get pricing information for all tiers
   */
  getPricingInfo(): Promise<TierInfo[]>
}
