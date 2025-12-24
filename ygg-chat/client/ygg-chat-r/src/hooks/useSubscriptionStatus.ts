import { useEffect, useMemo, useState } from 'react'
import { getPaymentProvider, type SubscriptionStatus } from '../lib/payments'

interface UseSubscriptionStatusResult {
  subscriptionStatus: SubscriptionStatus | null
  hasActiveAccess: boolean
  isFreeUser: boolean
  isLoading: boolean
}

export function useSubscriptionStatus(userId: string | null | undefined): UseSubscriptionStatusResult {
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      if (!userId) {
        setIsLoading(false)
        return
      }

      try {
        setIsLoading(true)
        const provider = await getPaymentProvider()
        const status = await provider.getSubscriptionStatus(userId)
        if (!cancelled) {
          setSubscriptionStatus(status)
        }
      } catch (err) {
        console.warn('[useSubscriptionStatus] Failed to fetch subscription status', err)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadStatus()

    return () => {
      cancelled = true
    }
  }, [userId])

  const hasActiveAccess = useMemo(() => {
    if (!subscriptionStatus || !subscriptionStatus.tier) return false
    const status = subscriptionStatus.status
    if (status === 'active') return true
    if ((status === 'past_due' || status === 'canceled') && subscriptionStatus.currentPeriodEnd) {
      const periodEnd = new Date(subscriptionStatus.currentPeriodEnd)
      return new Date() < periodEnd
    }
    return false
  }, [subscriptionStatus])

  const isFreeUser = !hasActiveAccess

  return {
    subscriptionStatus,
    hasActiveAccess,
    isFreeUser,
    isLoading,
  }
}
