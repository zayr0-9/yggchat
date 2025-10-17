// server/src/utils/stripe.ts
import Stripe from 'stripe'
import { statements } from '../database/db'
import { replenishCredits, TIER_CREDITS } from './credits'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

// Validate Stripe configuration on startup
if (!stripeSecretKey) {
  console.error('❌ [Stripe] STRIPE_SECRET_KEY not found in environment variables. Stripe functionality will be disabled.')
  console.error('   Add STRIPE_SECRET_KEY to your .env file')
} else {
  console.log('✅ [Stripe] Secret key loaded:', stripeSecretKey.substring(0, 12) + '...')
}

if (!stripeWebhookSecret) {
  console.warn('⚠️  [Stripe] STRIPE_WEBHOOK_SECRET not found. Webhooks will not work.')
} else {
  console.log('✅ [Stripe] Webhook secret loaded')
}

// Initialize Stripe with API key
export const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: '2025-09-30.clover',
    })
  : null

if (stripe) {
  console.log('✅ [Stripe] SDK initialized successfully')
}

// Stripe Price IDs (from your Stripe dashboard after creating products)
export const STRIPE_PRICE_IDS = {
  high: process.env.STRIPE_PRICE_ID_HIGH || '',
  mid: process.env.STRIPE_PRICE_ID_MID || '',
  low: process.env.STRIPE_PRICE_ID_LOW || '',
}

// Validate Price IDs on startup
console.log('[Stripe] Price IDs configured:')
console.log('  High:', STRIPE_PRICE_IDS.high || '❌ NOT SET')
console.log('  Mid:', STRIPE_PRICE_IDS.mid || '❌ NOT SET')
console.log('  Low:', STRIPE_PRICE_IDS.low || '❌ NOT SET')

// Warn if using product IDs instead of price IDs
Object.entries(STRIPE_PRICE_IDS).forEach(([tier, id]) => {
  if (id && id.startsWith('prod_')) {
    console.error(`❌ [Stripe] ${tier.toUpperCase()} is using a Product ID (${id})`)
    console.error(`   You need to use a Price ID instead (starts with "price_")`)
    console.error(`   See GET_STRIPE_PRICE_IDS.md for instructions`)
  }
})

export type SubscriptionTier = 'high' | 'mid' | 'low'

export interface CheckoutSessionParams {
  userId: string
  tier: SubscriptionTier
  userEmail?: string
  successUrl: string
  cancelUrl: string
}

/**
 * Create a Stripe Checkout Session for subscription
 * @param params - Checkout session parameters
 * @returns Stripe Checkout Session with URL to redirect user
 */
export async function createCheckoutSession(params: CheckoutSessionParams): Promise<Stripe.Checkout.Session | null> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  const { userId, tier, userEmail, successUrl, cancelUrl } = params

  const priceId = STRIPE_PRICE_IDS[tier]
  if (!priceId) {
    throw new Error(`No price ID configured for tier: ${tier}`)
  }

  try {
    // Check if user already has a Stripe customer ID
    const user = statements.getUserById.get(userId) as any
    let customerId = user?.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          userId: userId,
        },
      })
      customerId = customer.id

      // Update user with customer ID
      statements.updateUserSubscription.run(customerId, null, null, null, null, userId)
      console.log(`[Stripe] Created customer ${customerId} for user ${userId}`)
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: userId,
        tier,
      },
      subscription_data: {
        metadata: {
          userId: userId,
          tier,
        },
      },
    })

    console.log(`[Stripe] Created checkout session ${session.id} for user ${userId}, tier ${tier}`)
    return session
  } catch (error) {
    console.error('[Stripe] Error creating checkout session:', error)
    throw error
  }
}

/**
 * Handle successful checkout completion
 * Updates user subscription and replenishes credits
 */
export async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const userId = session.metadata?.userId
    const tier = session.metadata?.tier as SubscriptionTier

    if (!userId || !tier) {
      throw new Error('Missing userId or tier in session metadata')
    }

    // Get subscription details with expanded data
    const subscriptionId = session.subscription as string
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items']
    })

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscriptionId}, setting to null`)
    }

    // Update user subscription info
    statements.updateUserSubscription.run(
      session.customer as string,
      subscriptionId,
      tier,
      'active',
      periodEndISO,
      userId
    )

    // Replenish credits for the new billing period
    replenishCredits(userId, tier, `Subscription activated - ${tier} tier`)

    console.log(`[Stripe] Checkout completed for user ${userId}, tier ${tier}, subscription ${subscriptionId}`)
  } catch (error) {
    console.error('[Stripe] Error handling checkout complete:', error)
    throw error
  }
}

/**
 * Handle successful invoice payment (monthly renewal)
 * Replenishes credits for the new billing period
 */
export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const subscriptionId = (invoice as any).subscription as string
    if (!subscriptionId) {
      console.log('[Stripe] Invoice payment succeeded but no subscription found (likely one-time payment or initial checkout - handled by checkout.session.completed), skipping')
      return
    }

    // Get subscription to find user with expanded data
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items']
    })
    const userId = subscription.metadata?.userId
    const tier = subscription.metadata?.tier as SubscriptionTier

    if (!userId || !tier) {
      throw new Error('Missing userId or tier in subscription metadata')
    }

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscriptionId}, setting to null`)
    }

    // Update subscription status and period end
    statements.updateUserSubscription.run(
      subscription.customer as string,
      subscriptionId,
      tier,
      'active',
      periodEndISO,
      userId
    )

    // Replenish credits for the new billing period
    replenishCredits(userId, tier, `Monthly renewal - ${tier} tier`)

    console.log(`[Stripe] Invoice payment succeeded for user ${userId}, credits replenished`)
  } catch (error) {
    console.error('[Stripe] Error handling invoice payment:', error)
    throw error
  }
}

/**
 * Handle failed invoice payment
 * Updates status to past_due but keeps access until current_period_end
 */
export async function handleInvoicePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const subscriptionId = (invoice as any).subscription as string
    if (!subscriptionId) {
      console.log('[Stripe] Invoice payment failed but no subscription found, skipping')
      return
    }

    // Get subscription to find user with expanded data
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items']
    })
    const userId = subscription.metadata?.userId
    const tier = subscription.metadata?.tier as SubscriptionTier

    if (!userId) {
      throw new Error('Missing userId in subscription metadata')
    }

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscriptionId}, setting to null`)
    }

    // Update subscription status to past_due
    // Keep current_period_end so user can still use service until then
    statements.updateUserSubscription.run(
      subscription.customer as string,
      subscriptionId,
      tier,
      'past_due',
      periodEndISO,
      userId
    )

    console.log(`[Stripe] Invoice payment failed for user ${userId}, status set to past_due`)
  } catch (error) {
    console.error('[Stripe] Error handling invoice payment failure:', error)
    throw error
  }
}

/**
 * Handle subscription creation
 * This is called when a new subscription is created (also fires during checkout)
 */
export async function handleSubscriptionCreated(subscription: Stripe.Subscription): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const userId = subscription.metadata?.userId
    const tier = subscription.metadata?.tier as SubscriptionTier

    if (!userId) {
      console.warn('[Stripe] Subscription created but no userId in metadata, skipping')
      return
    }

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscription.id}, setting to null`)
    }

    // Update subscription info
    statements.updateUserSubscription.run(
      subscription.customer as string,
      subscription.id,
      tier || null,
      subscription.status === 'active' ? 'active' : subscription.status === 'canceled' ? 'canceled' : 'past_due',
      periodEndISO,
      userId
    )

    console.log(`[Stripe] Subscription created for user ${userId}, tier: ${tier}, status: ${subscription.status}`)
  } catch (error) {
    console.error('[Stripe] Error handling subscription creation:', error)
    throw error
  }
}

/**
 * Handle subscription update (tier change, etc.)
 */
export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const userId = subscription.metadata?.userId
    const tier = subscription.metadata?.tier as SubscriptionTier

    if (!userId) {
      throw new Error('Missing userId in subscription metadata')
    }

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscription.id}, setting to null`)
    }

    // Update subscription info
    statements.updateUserSubscription.run(
      subscription.customer as string,
      subscription.id,
      tier || null,
      subscription.status === 'active' ? 'active' : subscription.status === 'canceled' ? 'canceled' : 'past_due',
      periodEndISO,
      userId
    )

    console.log(`[Stripe] Subscription updated for user ${userId}, status: ${subscription.status}`)
  } catch (error) {
    console.error('[Stripe] Error handling subscription update:', error)
    throw error
  }
}

/**
 * Handle subscription deletion/cancellation
 * User can still use service until current_period_end
 */
export async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
  try {
    const userId = subscription.metadata?.userId

    if (!userId) {
      throw new Error('Missing userId in subscription metadata')
    }

    // Extract current_period_end from subscription items (API v2025-03-31+)
    const periodEnd = subscription.items?.data?.[0]?.current_period_end
    const periodEndISO = periodEnd ? new Date(periodEnd * 1000).toISOString() : null

    if (!periodEnd) {
      console.warn(`[Stripe] current_period_end is undefined for subscription ${subscription.id}, setting to null`)
    }

    // Update status to canceled
    // Keep current_period_end so user can still use service until then
    statements.updateUserSubscription.run(
      subscription.customer as string,
      subscription.id,
      null,
      'canceled',
      periodEndISO,
      userId
    )

    console.log(`[Stripe] Subscription canceled for user ${userId}${periodEndISO ? `, access until ${periodEndISO}` : ''}`)
  } catch (error) {
    console.error('[Stripe] Error handling subscription deletion:', error)
    throw error
  }
}

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(payload: string | Buffer, signature: string): Stripe.Event | null {
  if (!stripe || !stripeWebhookSecret) {
    throw new Error('Stripe webhook secret not configured')
  }

  try {
    const event = stripe.webhooks.constructEvent(payload, signature, stripeWebhookSecret)
    return event
  } catch (error: any) {
    console.error('[Stripe] Webhook signature verification failed:', error.message)
    return null
  }
}

/**
 * Cancel a user's subscription
 * Cancels at period end so user can continue using until then
 */
export async function cancelSubscription(userId: string): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const user = statements.getUserById.get(userId) as any
    const subscriptionId = user?.stripe_subscription_id

    if (!subscriptionId) {
      throw new Error('No active subscription found for user')
    }

    // Cancel subscription at period end
    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    })

    console.log(`[Stripe] Subscription ${subscriptionId} will cancel at period end for user ${userId}`)
  } catch (error) {
    console.error('[Stripe] Error canceling subscription:', error)
    throw error
  }
}

/**
 * Get user's subscription status
 */
export async function getUserSubscriptionStatus(userId: string): Promise<any> {
  try {
    const user = statements.getUserById.get(userId) as any

    return {
      tier: user?.subscription_tier || null,
      status: user?.subscription_status || null,
      currentPeriodEnd: user?.current_period_end || null,
      creditsBalance: user?.credits_balance || 0,
      stripeCustomerId: user?.stripe_customer_id || null,
      stripeSubscriptionId: user?.stripe_subscription_id || null,
    }
  } catch (error) {
    console.error('[Stripe] Error getting subscription status:', error)
    throw error
  }
}

/**
 * Check if user has active subscription with access
 * Returns true if:
 * - Status is 'active', OR
 * - Status is 'past_due' or 'canceled' but current_period_end hasn't passed
 */
export function hasActiveSubscription(userId: string): boolean {
  try {
    const user = statements.getUserById.get(userId) as any
    const status = user?.subscription_status
    const periodEnd = user?.current_period_end

    if (status === 'active') {
      return true
    }

    if ((status === 'past_due' || status === 'canceled') && periodEnd) {
      const periodEndDate = new Date(periodEnd)
      const now = new Date()
      return now < periodEndDate
    }

    return false
  } catch (error) {
    console.error('[Stripe] Error checking subscription status:', error)
    return false
  }
}
