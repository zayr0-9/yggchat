import type { TierInfo } from '../lib/payments/types'

export interface Plan {
    id: string
    name: string
    price: number
    priceId: string // Added for Stripe integration matching
    billingCycle: string
    description: string
    featured?: boolean
    cta: string
}

export interface Feature {
    name: string
    plans: Record<string, string>
}

export const PLANS: Plan[] = [
    {
        id: 'basic',
        name: 'Basic',
        price: 9.99,
        priceId: 'price_low',
        billingCycle: '/month',
        description: 'Perfect for individuals getting started',
        cta: 'Subscribe',
    },
    {
        id: 'pro',
        name: 'Pro',
        price: 19.99,
        priceId: 'price_mid',
        billingCycle: '/month',
        description: 'Best for growing businesses',
        featured: true,
        cta: 'Subscribe',
    },
    {
        id: 'ultra',
        name: 'Ultra',
        price: 49.99,
        priceId: 'price_high',
        billingCycle: '/month',
        description: 'For large teams and organizations',
        cta: 'Subscribe',
    },
]

export const PRICING_FEATURES: Feature[] = [
    { name: 'Multiple Models', plans: { basic: '400+', pro: '400+', ultra: '400+' } },
    { name: 'Credits', plans: { basic: '400', pro: '800', ultra: '2200' } },
    { name: 'Cloud Sync', plans: { basic: 'Limited', pro: 'Unlimited', ultra: 'Unlimited' } },
    { name: 'Database', plans: { basic: 'Cloud + Local', pro: 'Cloud + Local', ultra: 'Cloud + Local' } },
    { name: 'Agents', plans: { basic: 'Yes', pro: 'Yes', ultra: 'Yes' } },
    { name: 'Claude Code support', plans: { basic: 'Yes', pro: 'Yes', ultra: 'Yes' } },
    { name: 'Storage', plans: { basic: '1GB', pro: '10GB', ultra: '50GB' } },
    { name: 'Local version', plans: { basic: 'Yes', pro: 'Yes', ultra: 'Yes' } },
]

// Helper to generate feature strings from PRICING_FEATURES
export const getFeaturesForPlan = (planId: string): string[] => {
    return PRICING_FEATURES.reduce((acc, feature) => {
        const value = feature.plans[planId]
        if (!value || value === 'Not included' || value === 'x') return acc

        if (feature.name === 'Credits') {
            acc.push(`${value} credits/mo`)
        } else if (feature.name === 'Multiple Models') {
            if (value.includes('+')) {
                acc.push(`${value} Models`) // "400+ Models"
            } else {
                acc.push(`${feature.name}: ${value}`)
            }
        } else if (value === 'Yes') {
            acc.push(feature.name)
        } else {
            acc.push(`${value} ${feature.name === 'Storage' ? '' : feature.name}`.trim())
        }
        return acc
    }, [] as string[])
}

// Default tiers derived from shared data
export const TIER_INFOS: TierInfo[] = PLANS.map(plan => ({
    name: plan.name,
    price: plan.price,
    priceId: plan.priceId,
    credits: parseInt(PRICING_FEATURES.find(f => f.name === 'Credits')?.plans[plan.id]?.replace(/\D/g, '') || '0'),
    features: getFeaturesForPlan(plan.id)
}))
