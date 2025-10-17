import type {
  PaymentProvider,
  SubscriptionStatus,
  TierInfo,
  CreditHistoryEntry,
} from './types'

/**
 * No-Op Payment Provider
 *
 * Used in Electron and local modes where payments are not supported.
 * Users provide their own API keys instead of paying for subscriptions.
 */
export class NoOpPaymentProvider implements PaymentProvider {
  isSupported(): boolean {
    return false
  }

  async createCheckoutSession(
    _userId: string,
    _tier: 'high' | 'mid' | 'low',
    _email?: string,
  ): Promise<{ sessionId: string; url: string }> {
    throw new Error('Payments are not supported in this version. Please use your own API keys.')
  }

  async getSubscriptionStatus(_userId: string): Promise<SubscriptionStatus> {
    return {
      tier: null,
      status: null,
      currentPeriodEnd: null,
      creditsBalance: 0,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    }
  }

  async cancelSubscription(_userId: string): Promise<void> {
    throw new Error('Payments are not supported in this version.')
  }

  async getCreditHistory(_userId: string, _limit?: number): Promise<CreditHistoryEntry[]> {
    return []
  }

  async getPricingInfo(): Promise<TierInfo[]> {
    return []
  }
}
