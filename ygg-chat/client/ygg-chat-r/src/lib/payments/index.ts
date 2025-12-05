/**
 * Payment Provider Factory
 *
 * Dynamically selects and creates the appropriate payment provider based on
 * build target and runtime environment.
 */

import type { PaymentProvider } from './types'

// Re-export types for convenience
export type { CreditHistoryEntry, PaymentProvider, SubscriptionStatus, TierInfo } from './types'

let cachedProvider: PaymentProvider | null = null

/**
 * Get the appropriate payment provider for the current environment
 *
 * Build-time selection (tree-shaken):
 * - __IS_ELECTRON__ -> NoOpPaymentProvider
 * - __IS_LOCAL__ -> NoOpPaymentProvider
 * - __IS_WEB__ -> StripePaymentProvider
 *
 * Runtime fallback (if build constants not set):
 * - VITE_ENVIRONMENT=electron -> NoOpPaymentProvider
 * - VITE_ENVIRONMENT=local -> NoOpPaymentProvider
 * - VITE_ENVIRONMENT=web -> StripePaymentProvider
 */
export async function getPaymentProvider(): Promise<PaymentProvider> {
  // Return cached provider if already created
  if (cachedProvider) {
    return cachedProvider
  }

  // console.log('[PaymentFactory] Creating payment provider...')
  // console.log(
  //   '[PaymentFactory] Build target:',
  //   typeof __BUILD_TARGET__ !== 'undefined' ? __BUILD_TARGET__ : 'unknown',
  // )
  // console.log('[PaymentFactory] Runtime env:', import.meta.env.VITE_ENVIRONMENT || 'unknown')

  let provider: PaymentProvider

  // Build-time selection (preferred - allows tree-shaking)
  if (
    (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) ||
    (typeof __IS_LOCAL__ !== 'undefined' && __IS_LOCAL__)
  ) {
    // console.log('[PaymentFactory] Using No-Op payment provider (build-time)')
    const { NoOpPaymentProvider } = await import('./none')
    provider = new NoOpPaymentProvider()
  } else if (typeof __IS_WEB__ !== 'undefined' && __IS_WEB__) {
    // console.log('[PaymentFactory] Using Stripe payment provider (build-time)')
    const { StripePaymentProvider } = await import('./stripe')
    provider = new StripePaymentProvider()
  }
  // Runtime fallback (for development and when build constants not set)
  else {
    const runtimeEnv = import.meta.env.VITE_ENVIRONMENT || 'local'
    // console.log('[PaymentFactory] Using runtime environment:', runtimeEnv)

    if (runtimeEnv === 'web') {
      // console.log('[PaymentFactory] Using Stripe payment provider (runtime)')
      const { StripePaymentProvider } = await import('./stripe')
      provider = new StripePaymentProvider()
    } else {
      // console.log('[PaymentFactory] Using No-Op payment provider (runtime)')
      const { NoOpPaymentProvider } = await import('./none')
      provider = new NoOpPaymentProvider()
    }
  }

  // Cache it
  cachedProvider = provider

  return provider
}

/**
 * Reset the cached provider (useful for testing)
 */
export function resetPaymentProvider() {
  cachedProvider = null
}
