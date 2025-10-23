import type {
  PaymentProvider,
  SubscriptionStatus,
  TierInfo,
  CreditHistoryEntry,
} from './types'
import { API_BASE } from '../../utils/api'

/**
 * Stripe Payment Provider
 *
 * Used in web mode for subscription payments and credit management.
 */
export class StripePaymentProvider implements PaymentProvider {
  isSupported(): boolean {
    return true
  }

  async createCheckoutSession(
    userId: string,
    tier: 'high' | 'mid' | 'low',
    email?: string,
  ): Promise<{ sessionId: string; url: string }> {
    const response = await fetch(`${API_BASE}/stripe/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId, tier, email }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to create checkout session',
      }))
      throw new Error(errorData.error || 'Failed to create checkout session')
    }

    return response.json()
  }

  async getSubscriptionStatus(userId: string): Promise<SubscriptionStatus> {
    const response = await fetch(`${API_BASE}/stripe/subscription-status?userId=${userId}`)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to get subscription status',
      }))
      throw new Error(errorData.error || 'Failed to get subscription status')
    }

    return response.json()
  }

  async cancelSubscription(userId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/stripe/cancel-subscription`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to cancel subscription',
      }))
      throw new Error(errorData.error || 'Failed to cancel subscription')
    }
  }

  async getCreditHistory(userId: string, limit: number = 100): Promise<CreditHistoryEntry[]> {
    const response = await fetch(
      `${API_BASE}/stripe/credit-history?userId=${userId}&limit=${limit}`,
    )

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to get credit history',
      }))
      throw new Error(errorData.error || 'Failed to get credit history')
    }

    const data = await response.json()
    return data.history || []
  }

  async getPricingInfo(): Promise<TierInfo[]> {
    const response = await fetch(`${API_BASE}/stripe/pricing-info`)

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        error: 'Failed to get pricing info',
      }))
      throw new Error(errorData.error || 'Failed to get pricing info')
    }

    const data = await response.json()

    // Convert from object format to array
    return [
      { ...data.tiers.low, name: 'Low' },
      { ...data.tiers.mid, name: 'Mid' },
      { ...data.tiers.high, name: 'High' },
    ]
  }
}
