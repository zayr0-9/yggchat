// server/src/routes/stripe.ts
import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { getCreditHistory, TIER_CREDITS } from '../utils/credits'
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
  STRIPE_PRICE_IDS,
  verifyWebhookSignature,
} from '../utils/stripe'

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
      successUrl: `${baseUrl}/payment?success=true`,
      cancelUrl: `${baseUrl}/payment?canceled=true`,
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
          price: 49.99, // Update with actual prices from Stripe
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
 * IMPORTANT: Requires express.raw() middleware to preserve raw body for signature verification
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

    console.log(`[Stripe Webhook] Received event: ${event.type} [${event.id}]`)

    // Handle different event types
    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as any
          console.log(
            `[Stripe Webhook] Processing checkout.session.completed - Session: ${session.id}, Customer: ${session.customer}`
          )
          await handleCheckoutComplete(session)
          break
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any
          console.log(
            `[Stripe Webhook] Processing invoice.payment_succeeded - Invoice: ${invoice.id}, Subscription: ${invoice.subscription}`
          )
          await handleInvoicePaymentSucceeded(invoice)
          break
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any
          console.log(
            `[Stripe Webhook] Processing invoice.payment_failed - Invoice: ${invoice.id}, Subscription: ${invoice.subscription}`
          )
          await handleInvoicePaymentFailed(invoice)
          break
        }

        case 'customer.subscription.created': {
          const subscription = event.data.object as any
          console.log(
            `[Stripe Webhook] Processing customer.subscription.created - Subscription: ${subscription.id}, Status: ${subscription.status}`
          )
          await handleSubscriptionCreated(subscription)
          break
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any
          console.log(
            `[Stripe Webhook] Processing customer.subscription.updated - Subscription: ${subscription.id}, Status: ${subscription.status}`
          )
          await handleSubscriptionUpdated(subscription)
          break
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any
          console.log(`[Stripe Webhook] Processing customer.subscription.deleted - Subscription: ${subscription.id}`)
          await handleSubscriptionDeleted(subscription)
          break
        }

        // Payment intent events (logged but not handled - informational only)
        case 'payment_intent.succeeded':
        case 'payment_intent.created': {
          const paymentIntent = event.data.object as any
          console.log(
            `[Stripe Webhook] ${event.type} - Payment Intent: ${paymentIntent.id} (no action needed, handled by invoice events)`
          )
          break
        }

        // Customer events (logged but not handled - informational only)
        case 'customer.created':
        case 'customer.updated':
        case 'payment_method.attached': {
          console.log(`[Stripe Webhook] ${event.type} [${event.id}] (no action needed)`)
          break
        }

        // Invoice events (logged but not handled - informational only)
        case 'invoice.created':
        case 'invoice.finalized':
        case 'invoice.paid': {
          const invoice = event.data.object as any
          console.log(`[Stripe Webhook] ${event.type} - Invoice: ${invoice.id} (no action needed)`)
          break
        }

        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type} [${event.id}]`)
      }

      console.log(`[Stripe Webhook] Successfully processed event: ${event.type} [${event.id}]`)
      res.json({ received: true })
    } catch (error: any) {
      console.error(`[Stripe Webhook] Error handling event ${event.type} [${event.id}]:`, error)
      console.error(`[Stripe Webhook] Error details:`, error.message)
      console.error(`[Stripe Webhook] Stack trace:`, error.stack)
      res.status(500).json({ error: 'Webhook handler failed', eventId: event.id, eventType: event.type })
    }
  })
)

export default router
