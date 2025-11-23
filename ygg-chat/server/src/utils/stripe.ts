// server/src/utils/stripe.ts
import Stripe from 'stripe'
import { CreditsService, SubscriptionService, UserService, supabaseAdmin } from '../database/supamodels'

// Type helper for Stripe objects that may have additional properties in newer API versions
type StripeSubscription = Stripe.Subscription & {
  current_period_start?: number
  current_period_end?: number
  billing_cycle_anchor?: number
  cancel_at_period_end?: boolean
  canceled_at?: number | null
  trial_start?: number | null
  trial_end?: number | null
}

type StripeInvoice = Stripe.Invoice & {
  subscription?: string | Stripe.Subscription
}

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET

// Validate Stripe configuration on startup
if (!stripeSecretKey) {
  console.error(
    '❌ [Stripe] STRIPE_SECRET_KEY not found in environment variables. Stripe functionality will be disabled.'
  )
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
    const user = await UserService.getById(userId)
    if (!user) {
      throw new Error(`User ${userId} not found`)
    }

    let customerId = user.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          userId: userId,
        },
      })
      customerId = customer.id

      // Update user's stripe_customer_id in profiles
      const { error } = await supabaseAdmin.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId)

      if (error) {
        console.error('[Stripe] Error updating customer ID:', error)
        throw error
      }

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
 * Updates user subscription and allocates credits
 */
export async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const userId = session.metadata?.userId
    const tier = session.metadata?.tier as SubscriptionTier

    if (!userId || !tier) {
      const errorMsg = `Missing userId or tier in session metadata. Session ID: ${session.id}, Customer: ${session.customer}`
      console.error(`[Stripe] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    // Verify user exists in Supabase
    const user = await UserService.getById(userId)
    if (!user) {
      const errorMsg = `User ${userId} not found in database. Cannot create subscription. Session ID: ${session.id}`
      console.error(`[Stripe] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    console.log(`[Stripe] Processing checkout for user ${userId} (${user.username}), tier: ${tier}`)

    // Get subscription details with expanded data
    const subscriptionId = session.subscription as string
    const subscription = (await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items'],
    })) as StripeSubscription

    // Get the price ID from the subscription
    const stripePriceId = subscription.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${subscriptionId}`)
    }

    // Upsert subscription in Supabase (this also updates profiles table)
    await SubscriptionService.upsertSubscription({
      userId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: session.customer as string,
      stripePriceId,
      status: subscription.status,
      currentPeriodStart: new Date((subscription.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((subscription.current_period_end || 0) * 1000),
      billingCycleAnchor: new Date((subscription.billing_cycle_anchor || 0) * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      metadata: { tier, sessionId: session.id },
    })

    console.log(
      `[Stripe] Subscription created/updated for user ${userId}, subscription: ${subscriptionId}, status: ${subscription.status}`
    )

    // Allocate credits for the initial subscription
    // Note: For initial subscriptions, invoice.payment_succeeded fires BEFORE the subscription
    // is fully linked, so we handle credit allocation here instead.
    // Monthly renewals will still use invoice.payment_succeeded (which will have subscription data).
    try {
      console.log(
        `[Stripe] Allocating initial credits for user ${userId}, subscription: ${subscriptionId}, price: ${stripePriceId}`
      )

      // Get the invoice ID from the session (if available)
      const invoiceId = session.invoice as string | null

      if (invoiceId) {
        // Allocate credits using the same RPC that handles invoice payments
        await SubscriptionService.handleInvoicePayment({
          userId,
          stripeSubscriptionId: subscriptionId,
          stripeInvoiceId: invoiceId,
          stripePriceId,
          periodStart: new Date((subscription.current_period_start || 0) * 1000),
          periodEnd: new Date((subscription.current_period_end || 0) * 1000),
        })

        console.log(`[Stripe] Initial credits allocated for user ${userId}, invoice: ${invoiceId}`)
      } else {
        console.warn(`[Stripe] No invoice ID in checkout session ${session.id}. Credits may not be allocated.`)
      }
    } catch (creditError) {
      // Log error but don't fail the entire checkout
      console.error('[Stripe] Error allocating initial credits:', creditError)
      console.error('[Stripe] Subscription was created successfully, but credits were not allocated.')
      console.error('[Stripe] User may need manual credit allocation.')
    }
  } catch (error) {
    console.error('[Stripe] Error handling checkout complete:', error)
    throw error
  }
}

/**
 * Handle successful invoice payment (monthly renewal and initial checkout)
 * Allocates credits for the billing period using Supabase RPC
 *
 * NOTE: For initial subscriptions via checkout, this webhook fires BEFORE the subscription
 * is linked to the invoice. Credit allocation for new subscriptions is handled in
 * handleCheckoutComplete(). This webhook primarily handles monthly renewal payments.
 */
export async function handleInvoicePaymentSucceeded(invoice: Stripe.Invoice): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    // Retrieve the full invoice from Stripe API with subscription expanded
    // This ensures we have complete data even if webhook payload is incomplete
    const fullInvoice = (await stripe.invoices.retrieve(invoice.id, {
      expand: ['subscription'],
    })) as StripeInvoice

    console.log(`[Stripe] Retrieved invoice ${invoice.id}, subscription type: ${typeof fullInvoice.subscription}`)

    // Extract subscription ID - it could be a string or an expanded object
    let subscriptionId: string | undefined
    if (typeof fullInvoice.subscription === 'string') {
      subscriptionId = fullInvoice.subscription
    } else if (fullInvoice.subscription && typeof fullInvoice.subscription === 'object') {
      subscriptionId = fullInvoice.subscription.id
    }

    if (!subscriptionId) {
      console.log(
        `[Stripe] Invoice ${invoice.id} has no subscription. This is expected for initial subscriptions ` +
          `(credits allocated via checkout webhook) or one-time payments. Skipping credit allocation.`
      )
      return
    }

    console.log(`[Stripe] Invoice ${invoice.id} is for subscription ${subscriptionId} (likely a renewal)`)

    // Get subscription to find user (retrieve fresh data to ensure we have metadata)
    const subscription = (await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items'],
    })) as StripeSubscription
    const userId = subscription.metadata?.userId

    if (!userId) {
      const errorMsg = `Missing userId in subscription metadata. Subscription: ${subscriptionId}, Invoice: ${invoice.id}`
      console.error(`[Stripe] ${errorMsg}`)
      console.error(`[Stripe] Subscription metadata:`, JSON.stringify(subscription.metadata, null, 2))
      throw new Error(errorMsg)
    }

    // Verify user exists
    const user = await UserService.getById(userId)
    if (!user) {
      const errorMsg = `User ${userId} not found. Cannot allocate credits. Subscription: ${subscriptionId}, Invoice: ${invoice.id}`
      console.error(`[Stripe] ${errorMsg}`)
      throw new Error(errorMsg)
    }

    // Get price ID from subscription
    const stripePriceId = subscription.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${subscriptionId}`)
    }

    console.log(
      `[Stripe] Processing invoice payment for user ${userId} (${user.username}), subscription: ${subscriptionId}, invoice: ${invoice.id}, price: ${stripePriceId}`
    )

    // Use Supabase RPC to handle invoice payment and credit allocation
    // This RPC will:
    // 1. Update subscription period dates
    // 2. Look up plan by price ID to get credit amount
    // 3. Allocate credits to user
    // 4. Create allocation_history entry
    // 5. Create credits_ledger entry
    await SubscriptionService.handleInvoicePayment({
      userId,
      stripeSubscriptionId: subscriptionId,
      stripeInvoiceId: invoice.id,
      stripePriceId,
      periodStart: new Date((subscription.current_period_start || 0) * 1000),
      periodEnd: new Date((subscription.current_period_end || 0) * 1000),
    })

    console.log(
      `[Stripe] Invoice payment processed successfully for user ${userId}, invoice: ${invoice.id}. Credits allocated by Supabase RPC.`
    )
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
    const stripeInvoice = invoice as StripeInvoice
    const subscriptionId = stripeInvoice.subscription as string | undefined
    if (!subscriptionId) {
      console.log('[Stripe] Invoice payment failed but no subscription found, skipping')
      return
    }

    // Get subscription to find user
    const subscription = (await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items'],
    })) as StripeSubscription
    const userId = subscription.metadata?.userId

    if (!userId) {
      throw new Error(
        `Missing userId in subscription metadata. Subscription: ${subscriptionId}, Invoice: ${invoice.id}`
      )
    }

    // Get price ID
    const stripePriceId = subscription.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${subscriptionId}`)
    }

    // Update subscription status to past_due
    // Keep current_period_end so user can still use service until then
    await SubscriptionService.upsertSubscription({
      userId,
      stripeSubscriptionId: subscriptionId,
      stripeCustomerId: subscription.customer as string,
      stripePriceId,
      status: 'past_due',
      currentPeriodStart: new Date((subscription.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((subscription.current_period_end || 0) * 1000),
      billingCycleAnchor: new Date((subscription.billing_cycle_anchor || 0) * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end || false,
      canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
      trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : null,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
      metadata: { invoiceId: invoice.id, failureReason: 'payment_failed' },
    })

    console.log(`[Stripe] Invoice payment failed for user ${userId}, status set to past_due. Invoice: ${invoice.id}`)
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
    const sub = subscription as StripeSubscription
    const userId = sub.metadata?.userId

    if (!userId) {
      console.warn(`[Stripe] Subscription ${sub.id} created but no userId in metadata, skipping`)
      return
    }

    const stripePriceId = sub.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${sub.id}`)
    }

    // Upsert subscription in Supabase
    await SubscriptionService.upsertSubscription({
      userId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
      stripePriceId,
      status: sub.status,
      currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
      billingCycleAnchor: new Date((sub.billing_cycle_anchor || 0) * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end || false,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      metadata: sub.metadata,
    })

    console.log(
      `[Stripe] Subscription created for user ${userId}, subscription: ${subscription.id}, status: ${subscription.status}`
    )
  } catch (error) {
    console.error('[Stripe] Error handling subscription creation:', error)
    throw error
  }
}

/**
 * Handle subscription update (tier change, status change, etc.)
 */
export async function handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
  if (!stripe) {
    throw new Error('Stripe is not configured')
  }

  try {
    const sub = subscription as StripeSubscription
    const userId = sub.metadata?.userId

    if (!userId) {
      throw new Error(`Missing userId in subscription metadata. Subscription: ${sub.id}`)
    }

    const stripePriceId = sub.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${sub.id}`)
    }

    // Upsert subscription in Supabase
    await SubscriptionService.upsertSubscription({
      userId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
      stripePriceId,
      status: sub.status,
      currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
      billingCycleAnchor: new Date((sub.billing_cycle_anchor || 0) * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end || false,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      metadata: sub.metadata,
    })

    console.log(
      `[Stripe] Subscription updated for user ${userId}, subscription: ${subscription.id}, status: ${subscription.status}`
    )
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
    const sub = subscription as StripeSubscription
    const userId = sub.metadata?.userId

    if (!userId) {
      throw new Error(`Missing userId in subscription metadata. Subscription: ${sub.id}`)
    }

    const stripePriceId = sub.items.data[0]?.price?.id
    if (!stripePriceId) {
      throw new Error(`No price ID found in subscription ${sub.id}`)
    }

    // Update status to canceled
    // Keep current_period_end so user can still use service until then
    await SubscriptionService.upsertSubscription({
      userId,
      stripeSubscriptionId: sub.id,
      stripeCustomerId: sub.customer as string,
      stripePriceId,
      status: 'canceled',
      currentPeriodStart: new Date((sub.current_period_start || 0) * 1000),
      currentPeriodEnd: new Date((sub.current_period_end || 0) * 1000),
      billingCycleAnchor: new Date((sub.billing_cycle_anchor || 0) * 1000),
      cancelAtPeriodEnd: sub.cancel_at_period_end || false,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      metadata: sub.metadata,
    })

    const periodEndDate = new Date((sub.current_period_end || 0) * 1000).toISOString()
    console.log(
      `[Stripe] Subscription canceled for user ${userId}, subscription: ${sub.id}, access until ${periodEndDate}`
    )
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
    // Get user's active subscription from Supabase
    const subscription = await SubscriptionService.getActiveSubscription(userId)

    if (!subscription || !subscription.stripe_subscription_id) {
      throw new Error(`No active subscription found for user ${userId}`)
    }

    // Retrieve current subscription from Stripe to check actual status
    const stripeSubscription = (await stripe.subscriptions.retrieve(
      subscription.stripe_subscription_id
    )) as StripeSubscription

    // Check if subscription is already canceled
    if (stripeSubscription.status === 'canceled') {
      throw new Error('Subscription is already canceled')
    }

    // Check if subscription is already set to cancel at period end
    if (stripeSubscription.cancel_at_period_end) {
      throw new Error('Subscription is already scheduled to cancel at the end of the billing period')
    }

    // Check if subscription is in a state that can be canceled
    if (!['active', 'trialing', 'past_due'].includes(stripeSubscription.status)) {
      throw new Error(
        `Cannot cancel subscription with status: ${stripeSubscription.status}. Only active, trialing, or past_due subscriptions can be canceled.`
      )
    }

    // Cancel subscription at period end in Stripe
    await stripe.subscriptions.update(subscription.stripe_subscription_id, {
      cancel_at_period_end: true,
    })

    console.log(
      `[Stripe] Subscription ${subscription.stripe_subscription_id} will cancel at period end for user ${userId}`
    )
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
    // Get subscription and credits from Supabase
    const [subscription, creditsBalance, user] = await Promise.all([
      SubscriptionService.getActiveSubscription(userId),
      CreditsService.getUserCredits(userId),
      UserService.getById(userId),
    ])

    return {
      // Legacy tier field (map from plan_code if available)
      tier: subscription?.plan_code || null,
      status: subscription?.status || null,
      currentPeriodEnd: subscription?.current_period_end || null,
      creditsBalance: creditsBalance || 0,
      stripeCustomerId: user?.stripe_customer_id || null,
      stripeSubscriptionId: subscription?.stripe_subscription_id || null,
      // Additional subscription details
      planCode: subscription?.plan_code || null,
      planName: subscription?.plan_name || null,
      monthlyCredits: subscription?.monthly_credits || 0,
      cancelAtPeriodEnd: subscription?.cancel_at_period_end || false,
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
export async function hasActiveSubscription(userId: string): Promise<boolean> {
  try {
    const subscription = await SubscriptionService.getActiveSubscription(userId)

    if (!subscription) {
      return false
    }

    const status = subscription.status
    const periodEnd = subscription.current_period_end

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
