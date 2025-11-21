import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../components'
import { useAuth } from '../hooks/useAuth'
import { getPaymentProvider, type SubscriptionStatus, type TierInfo } from '../lib/payments'

interface PricingInfo {
  tiers: {
    high: TierInfo
    mid: TierInfo
    low: TierInfo
  }
}

// Default tiers for display when API is not available (e.g. in Electron)
const DEFAULT_TIERS: TierInfo[] = [
  {
    name: 'Low',
    price: 9.99,
    priceId: 'price_low',
    credits: 300,
    features: ['Limited conversations', 'Database', '300 credits/mo'],
  },
  {
    name: 'Mid',
    price: 19.99,
    priceId: 'price_mid',
    credits: 1200,
    features: ['Access to advanced models', 'Fast response speed', '1,200 credits/mo', 'Priority support'],
  },
  {
    name: 'High',
    price: 29.99,
    priceId: 'price_high',
    credits: 2200,
    features: [
      'Access to all models',
      'Fastest response speed',
      '2,200 credits/mo',
      'Priority support',
      'Early access to features',
    ],
  },
]

const PaymentPage: React.FC = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { userId } = useAuth()

  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null)
  const [pricingInfo, setPricingInfo] = useState<PricingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // const [paymentsSupported, setPaymentsSupported] = useState(true)

  // Check for success/cancel query params from Stripe redirect
  const success = searchParams.get('success')
  const canceled = searchParams.get('canceled')

  // Check if we're in Electron or local mode (payments not supported directly)
  const isElectronOrLocal =
    (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) ||
    (typeof __IS_LOCAL__ !== 'undefined' && __IS_LOCAL__) ||
    import.meta.env.VITE_ENVIRONMENT === 'electron' ||
    import.meta.env.VITE_ENVIRONMENT === 'local'

  useEffect(() => {
    fetchData()
  }, [userId])

  // Refetch data when returning from successful checkout
  useEffect(() => {
    if (success && userId) {
      // Small delay to ensure webhook has processed
      const timer = setTimeout(() => {
        fetchData()
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [success, userId])

  const fetchData = async () => {
    setLoading(true)

    try {
      const provider = await getPaymentProvider()

      // In Electron/Local, provider.isSupported() returns false,
      // but we still want to show the pricing UI (just with external links).
      // So we only check this for setting the state variable which might be used elsewhere.
      // const supported = provider.isSupported()
      // setPaymentsSupported(supported)

      if (userId) {
        // Fetch subscription status only if user is logged in
        try {
          const statusData = await provider.getSubscriptionStatus(userId)
          setSubscriptionStatus(statusData)
        } catch (err) {
          console.warn('[PaymentPage] Failed to fetch subscription status:', err)
          // Don't block UI rendering if status fetch fails
        }
      }

      // Fetch pricing info
      let tiersData = await provider.getPricingInfo()

      // If no tiers returned (e.g. Electron no-op provider), use defaults
      if (!tiersData || tiersData.length === 0) {
        tiersData = DEFAULT_TIERS
      }

      // Convert array to object format for backward compatibility
      const pricingData: PricingInfo = {
        tiers: {
          low: tiersData.find(t => t.name === 'Low') || tiersData[0],
          mid: tiersData.find(t => t.name === 'Mid') || tiersData[1],
          high: tiersData.find(t => t.name === 'High') || tiersData[2],
        },
      }
      setPricingInfo(pricingData)
    } catch (err: any) {
      console.error('[PaymentPage] Error fetching payment data:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const openPaymentUrl = async () => {
    const url = 'https://yggchat.com/payment'
    if (window.electronAPI?.auth?.openExternal) {
      await window.electronAPI.auth.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const handleSubscribe = async (tier: 'high' | 'mid' | 'low') => {
    // If in Electron/Local mode, open external payment page
    if (isElectronOrLocal) {
      await openPaymentUrl()
      return
    }

    if (!userId) {
      setError('You must be logged in to subscribe')
      return
    }

    setCheckoutLoading(tier)
    setError(null)

    try {
      const provider = await getPaymentProvider()

      const { url } = await provider.createCheckoutSession(userId, tier)

      if (url) {
        // Redirect to Stripe Checkout
        window.location.href = url
      }
    } catch (err: any) {
      console.error('Error creating checkout session:', err)
      setError(err.message)
      setCheckoutLoading(null)
    }
  }

  const handleCancelSubscription = async () => {
    if (
      !userId ||
      !window.confirm(
        'Are you sure you want to cancel your subscription? You will have access until the end of your billing period.'
      )
    ) {
      return
    }

    try {
      const provider = await getPaymentProvider()

      await provider.cancelSubscription(userId)

      alert('Subscription canceled. You will have access until the end of your billing period.')
      fetchData() // Refresh data
    } catch (err: any) {
      console.error('Error canceling subscription:', err)
      setError(err.message)
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString()
  }

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'high':
        return 'from-purple-500 to-pink-600'
      case 'mid':
        return 'from-blue-500 to-cyan-600'
      case 'low':
        return 'from-green-500 to-teal-600'
      default:
        return 'from-gray-500 to-gray-600'
    }
  }

  const hasActiveAccess = () => {
    if (!subscriptionStatus || !subscriptionStatus.tier) return false

    const status = subscriptionStatus.status

    // Active subscription
    if (status === 'active') return true

    // Past due or canceled but still within access period
    if ((status === 'past_due' || status === 'canceled') && subscriptionStatus.currentPeriodEnd) {
      const periodEnd = new Date(subscriptionStatus.currentPeriodEnd)
      const now = new Date()
      return now < periodEnd
    }

    return false
  }

  if (loading) {
    return (
      <div className='min-h-full bg-zinc-50 dark:bg-yBlack-500 flex items-center justify-center'>
        <p className='text-xl dark:text-neutral-100'>Loading...</p>
      </div>
    )
  }

  // Show alternative UI for Electron/local modes (no payments) -> REMOVED to show pricing
  /* 
  if (!paymentsSupported || isElectronOrLocal) {
    return (...)
  }
  */

  return (
    <div className='min-h-full bg-zinc-50 dark:bg-yBlack-500'>
      <div className='max-w-7xl mx-auto px-4 py-8'>
        {/* Header */}
        <div className='flex items-center justify-between mb-8'>
          <div className='flex items-center gap-4'>
            <Button variant='outline2' onClick={() => navigate('/')}>
              <i className='bx bx-arrow-back mr-2'></i>
              Home
            </Button>
            <h1 className='relative z-10 text-4xl font-bold text-neutral-900 dark:text-neutral-100'>Subscription & Credits</h1>
          </div>
          <div className='flex gap-2'>
            {isElectronOrLocal && (
              <Button variant='outline' onClick={openPaymentUrl}>
                <i className='bx bx-link-external mr-2'></i>
                Manage Subscription on Web
              </Button>
            )}
          </div>
        </div>

        {/* Success/Cancel Messages */}
        {success && (
          <div className='mb-6 p-4 bg-green-100 dark:bg-green-900 border border-green-400 dark:border-green-600 rounded-lg'>
            <p className='text-green-800 dark:text-green-200'>
              <i className='bx bx-check-circle mr-2'></i>
              Subscription activated successfully! Welcome aboard!
            </p>
          </div>
        )}
        {canceled && (
          <div className='mb-6 p-4 bg-yellow-100 dark:bg-yellow-900 border border-yellow-400 dark:border-yellow-600 rounded-lg'>
            <p className='text-yellow-800 dark:text-yellow-200'>
              <i className='bx bx-info-circle mr-2'></i>
              Checkout canceled. You can subscribe anytime!
            </p>
          </div>
        )}

        {error && (
          <div className='mb-6 p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 rounded-lg'>
            <p className='text-red-800 dark:text-red-200'>
              <i className='bx bx-error mr-2'></i>
              {error}
            </p>
          </div>
        )}

        {/* Current Subscription Status */}
        {subscriptionStatus && subscriptionStatus.tier && (
          <div className='mb-8 p-6 bg-white dark:bg-yBlack-900 rounded-lg shadow-md border border-indigo-100 dark:border-neutral-700'>
            <h2 className='text-2xl font-bold mb-4 dark:text-neutral-100'>Current Subscription</h2>
            <div className='grid grid-cols-1 md:grid-cols-3 gap-4'>
              <div>
                <p className='text-sm text-gray-600 dark:text-gray-400'>Tier</p>
                <p className='text-lg font-semibold dark:text-neutral-100 capitalize'>
                  {subscriptionStatus.tier} Tier God
                </p>
              </div>
              <div>
                <p className='text-sm text-gray-600 dark:text-gray-400'>Status</p>
                <p className='text-lg font-semibold dark:text-neutral-100 capitalize'>{subscriptionStatus.status}</p>
              </div>
              <div>
                <p className='text-sm text-gray-600 dark:text-gray-400'>Credits Balance</p>
                <p className='text-lg font-semibold dark:text-neutral-100'>
                  {(subscriptionStatus.creditsBalance * 10).toLocaleString()}
                </p>
              </div>
            </div>
            {subscriptionStatus.currentPeriodEnd && (
              <div className='mt-4'>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  {subscriptionStatus.status === 'canceled' ? 'Access until' : 'Renews on'}:{' '}
                  {formatDate(subscriptionStatus.currentPeriodEnd)}
                </p>
              </div>
            )}
            {subscriptionStatus.status === 'active' && (
              <div className='mt-4'>
                <Button variant='outline2' size='medium' onClick={handleCancelSubscription}>
                  Cancel Subscription
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Pricing Tiers - Only show if user doesn't have active subscription */}
        {!hasActiveAccess() ? (
          <>
            <h2 className='relative z-10 text-3xl font-bold mb-6 text-neutral-900 dark:text-neutral-100'>
              Choose Your Plan
            </h2>

            <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
              {pricingInfo &&
                Object.entries(pricingInfo.tiers).map(([key, tier]) => {
                  const tierKey = key as 'high' | 'mid' | 'low'
                  const isLoading = checkoutLoading === tierKey

                  return (
                    <div
                      key={key}
                      className='relative p-6 rounded-lg shadow-lg border-2 border-gray-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900 hover:shadow-xl transition-shadow flex flex-col'
                    >
                      <div
                        className={`w-16 h-16 rounded-full bg-gradient-to-br ${getTierColor(tierKey)} mb-4 flex items-center justify-center`}
                      >
                        <i className='bx bx-crown text-white text-3xl'></i>
                      </div>

                      <h3 className='text-2xl font-bold mb-2 dark:text-neutral-100'>{tier.name}</h3>
                      <div className='mb-4'>
                        <span className='text-4xl font-bold dark:text-neutral-100'>${tier.price}</span>
                        <span className='text-gray-600 dark:text-gray-400'>/month</span>
                      </div>

                      <div className='mb-6'>
                        <p className='text-sm text-gray-600 dark:text-gray-400 mb-2'>Monthly Credits</p>
                        <p className='text-xl font-semibold dark:text-neutral-100'>{tier.credits.toLocaleString()}</p>
                      </div>

                      <ul className='space-y-2 mb-6 flex-grow'>
                        {tier.features.map((feature, idx) => (
                          <li key={idx} className='flex items-start text-sm dark:text-neutral-200'>
                            <i className='bx bx-check text-green-500 mr-2 mt-0.5'></i>
                            {feature}
                          </li>
                        ))}
                      </ul>

                      <Button
                        variant='outline'
                        size='large'
                        className='w-full'
                        onClick={() => handleSubscribe(tierKey)}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <>
                            <i className='bx bx-loader-alt animate-spin mr-2'></i>
                            Processing...
                          </>
                        ) : isElectronOrLocal ? (
                          <>
                            <i className='bx bx-link-external mr-2'></i>
                            Subscribe on Website
                          </>
                        ) : (
                          'Subscribe Now'
                        )}
                      </Button>
                    </div>
                  )
                })}
            </div>

            <div className='relative z-10 mt-8 flex justify-center'>
              <Button variant='outline' size='large' onClick={() => navigate('/')}>
                <i className='bx bx-home-alt mr-2'></i>
                No thanks, take me Home
              </Button>
            </div>
          </>
        ) : (
          /* Already subscribed message */
          <div className='mb-8 p-6 bg-white dark:bg-yBlack-900 rounded-lg shadow-md border border-gray-200 dark:border-neutral-700'>
            <h2 className='text-2xl font-bold mb-4 dark:text-neutral-100'>You&apos;re All Set! 🎉</h2>
            <p className='text-gray-700 dark:text-neutral-300 mb-4'>
              You currently have an active subscription. Your credits will automatically replenish each month on your
              renewal date.
            </p>
            {subscriptionStatus?.status === 'canceled' && (
              <p className='text-yellow-700 dark:text-yellow-400 mb-4'>
                <i className='bx bx-info-circle mr-2'></i>
                Your subscription is set to cancel, but you&apos;ll have access until{' '}
                {formatDate(subscriptionStatus.currentPeriodEnd)}.
              </p>
            )}
            {subscriptionStatus?.status === 'past_due' && (
              <p className='text-red-700 dark:text-red-400 mb-4'>
                <i className='bx bx-error mr-2'></i>
                Your payment is past due. Please update your payment method to continue service after{' '}
                {formatDate(subscriptionStatus.currentPeriodEnd)}.
              </p>
            )}
            <p className='text-sm text-gray-600 dark:text-gray-400'>
              Need to change your plan or payment method? Please contact support or cancel your current subscription
              first.
            </p>
          </div>
        )}

        {/* How Credits Work */}
        <div className='mt-12 p-6 bg-white dark:bg-yBlack-900 rounded-lg shadow-md border border-gray-200 dark:border-neutral-700'>
          <h2 className='text-2xl font-bold mb-4 dark:text-neutral-100'>How Credits Work</h2>
          <ul className='space-y-2 dark:text-neutral-200'>
            <li className='flex items-start'>
              <i className='bx bx-info-circle mr-2 mt-0.5 text-indigo-600'></i>
              Credits are consumed with each AI generation based on the model and token usage
            </li>
            <li className='flex items-start'>
              <i className='bx bx-info-circle mr-2 mt-0.5 text-indigo-600'></i>
              Your credits replenish automatically each month on your subscription renewal date
            </li>
            <li className='flex items-start'>
              <i className='bx bx-info-circle mr-2 mt-0.5 text-indigo-600'></i>
              If payment fails, you can continue using the service until your current period ends
            </li>
            <li className='flex items-start'>
              <i className='bx bx-info-circle mr-2 mt-0.5 text-indigo-600'></i>
              More expensive models (like GPT-4, Claude Opus) use more credits per generation
            </li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default PaymentPage
