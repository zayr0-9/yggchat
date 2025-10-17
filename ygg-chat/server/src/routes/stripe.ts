// server/src/routes/stripe.ts
import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { getCreditHistory, getUserCredits, TIER_CREDITS } from '../utils/credits'
import {
  cancelSubscription,
  createCheckoutSession,
  getUserSubscriptionStatus,
  handleCheckoutComplete,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleSubscriptionCreated,
  handleSubscriptionDeleted,
  handleSubscriptionUpdated,
  stripe,
  STRIPE_PRICE_IDS,
  SubscriptionTier,
  verifyWebhookSignature,
} from '../utils/stripe'

const router = express.Router()

/**
 * POST /stripe/create-checkout-session
 * Create a Stripe Checkout Session for subscription
 */
router.post(
  '/create-checkout-session',
  asyncHandler(async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on the server' })
    }

    const { userId, tier, email } = req.body

    if (!userId || !tier) {
      return res.status(400).json({ error: 'Missing userId or tier' })
    }

    if (!['high', 'mid', 'low'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier. Must be one of: high, mid, low' })
    }

    // Construct success and cancel URLs
    const baseUrl = req.headers.origin || 'http://localhost:5173'
    const successUrl = `${baseUrl}/payment?success=true&session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${baseUrl}/payment?canceled=true`

    try {
      const session = await createCheckoutSession({
        userId: userId,
        tier: tier as SubscriptionTier,
        userEmail: email,
        successUrl,
        cancelUrl,
      })

      if (!session) {
        return res.status(500).json({ error: 'Failed to create checkout session' })
      }

      res.json({
        sessionId: session.id,
        url: session.url,
      })
    } catch (error: any) {
      console.error('[Stripe API] Error creating checkout session:', error)
      res.status(500).json({ error: error.message || 'Failed to create checkout session' })
    }
  })
)

/**
 * GET /stripe/subscription-status
 * Get user's subscription status and credit balance
 */
router.get(
  '/subscription-status',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string | undefined

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' })
    }

    try {
      const status = await getUserSubscriptionStatus(userId)
      const credits = getUserCredits(userId)

      res.json({
        ...status,
        creditsBalance: credits,
      })
    } catch (error: any) {
      console.error('[Stripe API] Error getting subscription status:', error)
      res.status(500).json({ error: error.message || 'Failed to get subscription status' })
    }
  })
)

/**
 * POST /stripe/cancel-subscription
 * Cancel user's subscription (at period end)
 */
router.post(
  '/cancel-subscription',
  asyncHandler(async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on the server' })
    }

    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' })
    }

    try {
      await cancelSubscription(userId)
      res.json({ success: true, message: 'Subscription will be canceled at period end' })
    } catch (error: any) {
      console.error('[Stripe API] Error canceling subscription:', error)
      res.status(500).json({ error: error.message || 'Failed to cancel subscription' })
    }
  })
)

/**
 * GET /stripe/credit-history
 * Get user's credit transaction history
 */
router.get(
  '/credit-history',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string | undefined
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100

    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' })
    }

    try {
      const history = getCreditHistory(userId, limit)
      res.json({ history })
    } catch (error: any) {
      console.error('[Stripe API] Error getting credit history:', error)
      res.status(500).json({ error: error.message || 'Failed to get credit history' })
    }
  })
)

/**
 * GET /stripe/pricing-info
 * Get pricing information for all tiers
 */
router.get('/pricing-info', (req, res) => {
  res.json({
    tiers: {
      high: {
        name: 'High Tier God',
        price: 20,
        priceId: STRIPE_PRICE_IDS.high,
        credits: TIER_CREDITS.high,
        features: ['17.00 monthly credits', 'Access to all models', 'Priority support', 'Advanced tools'],
      },
      mid: {
        name: 'Mid Tier God',
        price: 12,
        priceId: STRIPE_PRICE_IDS.mid,
        credits: TIER_CREDITS.mid,
        features: ['9.00 monthly credits', 'Access to most models', 'Standard support', 'Basic tools'],
      },
      low: {
        name: 'Low Tier God',
        price: 5,
        priceId: STRIPE_PRICE_IDS.low,
        credits: TIER_CREDITS.low,
        features: ['3.00 monthly credits', 'Access to basic models', 'Community support', 'Essential tools'],
      },
    },
  })
})

/**
 * POST /stripe/webhook
 * Handle Stripe webhook events
 * This endpoint receives real-time updates from Stripe about payment events
 * Note: Raw body parsing is handled at the app level in index.ts
 */
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: 'Stripe is not configured on the server' })
    }

    const signature = req.headers['stripe-signature'] as string

    if (!signature) {
      console.error('[Stripe Webhook] Missing stripe-signature header')
      return res.status(400).json({ error: 'Missing stripe-signature header' })
    }

    // Verify webhook signature
    const event = verifyWebhookSignature(req.body, signature)

    if (!event) {
      console.error('[Stripe Webhook] Invalid signature')
      return res.status(400).json({ error: 'Invalid signature' })
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`)

    try {
      // Handle different event types
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any
          await handleCheckoutComplete(session)
          break
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any
          await handleInvoicePaymentSucceeded(invoice)
          break
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any
          await handleInvoicePaymentFailed(invoice)
          break
        }

        case 'customer.subscription.created': {
          const subscription = event.data.object as any
          await handleSubscriptionCreated(subscription)
          break
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any
          await handleSubscriptionUpdated(subscription)
          break
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any
          await handleSubscriptionDeleted(subscription)
          break
        }

        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`)
      }

      res.json({ received: true })
    } catch (error: any) {
      console.error(`[Stripe Webhook] Error handling event ${event.type}:`, error)
      res.status(500).json({ error: error.message || 'Webhook handler failed' })
    }
  })
)

export default router
