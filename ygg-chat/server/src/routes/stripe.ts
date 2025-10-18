// server/src/routes/stripe.ts
import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import {
  createCheckoutSession,
  getUserSubscriptionStatus,
  cancelSubscription,
  verifyWebhookSignature,
  handleCheckoutComplete,
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  STRIPE_PRICE_IDS,
} from '../utils/stripe'
import { TIER_CREDITS, getCreditHistory } from '../utils/credits'

const router = express.Router()

/**
 * POST /api/stripe/create-checkout-session
 * Create a Stripe Checkout Session for subscription
 */
router.post(
  '/create-checkout-session',
  asyncHandler(async (req, res) => {
    const { userId, tier, email } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }

    if (!tier || !['high', 'mid', 'low'].includes(tier)) {
      return res.status(400).json({ error: 'Valid tier (high, mid, low) is required' })
    }

    // Create checkout session with configured URLs
    const baseUrl = process.env.CLIENT_URL || 'http://localhost:5173'
    const session = await createCheckoutSession({
      userId,
      tier,
      userEmail: email,
      successUrl: `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/subscription/cancel`,
    })

    if (!session) {
      return res.status(500).json({ error: 'Failed to create checkout session' })
    }

    res.json({
      sessionId: session.id,
      url: session.url,
    })
  })
)

/**
 * GET /api/stripe/subscription-status
 * Get user's subscription status and credit balance
 */
router.get(
  '/subscription-status',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' })
    }

    const status = await getUserSubscriptionStatus(userId)
    res.json(status)
  })
)

/**
 * POST /api/stripe/cancel-subscription
 * Cancel user's subscription (at period end)
 */
router.post(
  '/cancel-subscription',
  asyncHandler(async (req, res) => {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' })
    }

    await cancelSubscription(userId)

    res.json({
      success: true,
      message: 'Subscription will be canceled at the end of the current billing period',
    })
  })
)

/**
 * GET /api/stripe/credit-history
 * Get user's credit transaction history
 */
router.get(
  '/credit-history',
  asyncHandler(async (req, res) => {
    const userId = req.query.userId as string
    const limit = parseInt(req.query.limit as string) || 100

    if (!userId) {
      return res.status(400).json({ error: 'userId query parameter is required' })
    }

    // Get credit history using the credits utility function
    const history = getCreditHistory(userId, limit)

    res.json({ history })
  })
)

/**
 * GET /api/stripe/pricing-info
 * Get pricing information for all subscription tiers
 */
router.get(
  '/pricing-info',
  asyncHandler(async (req, res) => {
    // Return tier information with credits and price IDs
    const pricingInfo = {
      tiers: {
        high: {
          name: 'High Tier',
          price: 29.99, // Update with actual prices from Stripe
          priceId: STRIPE_PRICE_IDS.high,
          credits: TIER_CREDITS.high,
          features: ['Unlimited conversations', 'Priority support', 'Advanced features'],
        },
        mid: {
          name: 'Mid Tier',
          price: 19.99, // Update with actual prices from Stripe
          priceId: STRIPE_PRICE_IDS.mid,
          credits: TIER_CREDITS.mid,
          features: ['Multiple conversations', 'Standard support', 'Basic features'],
        },
        low: {
          name: 'Low Tier',
          price: 9.99, // Update with actual prices from Stripe
          priceId: STRIPE_PRICE_IDS.low,
          credits: TIER_CREDITS.low,
          features: ['Limited conversations', 'Email support', 'Essential features'],
        },
      },
    }

    res.json(pricingInfo)
  })
)

/**
 * POST /api/stripe/webhook
 * Stripe webhook handler
 * IMPORTANT: This route is mounted separately with express.raw() middleware in index.ts
 */
router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature']

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' })
    }

    // Verify webhook signature (req.body is raw buffer from express.raw middleware)
    const event = verifyWebhookSignature(req.body, signature as string)

    if (!event) {
      return res.status(400).json({ error: 'Invalid signature' })
    }

    console.log(`[Stripe Webhook] Received event: ${event.type}`)

    // Handle different event types
    try {
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
    } catch (error) {
      console.error('[Stripe Webhook] Error handling webhook:', error)
      res.status(500).json({ error: 'Webhook handler failed' })
    }
  })
)

export default router
