// utils/api.ts
import { ConversationId } from '../../../../shared/types'

// Base configuration
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
export const environment = import.meta.env.VITE_ENVIRONMENT || 'local'

// Core API utility function - now accepts accessToken as parameter
export const apiCall = async <T>(endpoint: string, accessToken: string | null, options?: RequestInit): Promise<T> => {
  const isFormData = options?.body && typeof FormData !== 'undefined' && options.body instanceof FormData

  // Destructure to separate headers from other options
  const { headers: optionsHeaders, ...restOptions } = options || {}

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...restOptions, // Spread everything EXCEPT headers
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...optionsHeaders, // Spread headers from options
      ...(accessToken && environment === 'web' ? { Authorization: `Bearer ${accessToken}` } : {}), // Add Authorization header with JWT in web mode
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
  }

  return response.json()
}

// Convenience methods for common HTTP operations
export const api = {
  get: <T>(endpoint: string, accessToken: string | null, options?: RequestInit) => {
    // Log all conversation endpoint calls to track duplicate requests
    if (endpoint.includes('/conversations') && !endpoint.includes('/messages')) {
    }
    return apiCall<T>(endpoint, accessToken, { ...options, method: 'GET' })
  },

  post: <T>(endpoint: string, accessToken: string | null, data?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, accessToken, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, accessToken: string | null, data?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, accessToken, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, accessToken: string | null, data?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, accessToken, {
      ...options,
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, accessToken: string | null, options?: RequestInit) =>
    apiCall<T>(endpoint, accessToken, { ...options, method: 'DELETE' }),
}

// Helper for streaming requests
export const createStreamingRequest = async (
  endpoint: string,
  accessToken: string | null,
  options?: RequestInit
): Promise<Response> => {
  const isFormData = options?.body && typeof FormData !== 'undefined' && options.body instanceof FormData

  // Destructure to separate headers from other options
  const { headers: optionsHeaders, ...restOptions } = options || {}

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...optionsHeaders, // Spread the headers from options
    ...(accessToken && environment === 'web' ? { Authorization: `Bearer ${accessToken}` } : {}), // Add Authorization header with JWT in web mode
  }

  return fetch(`${API_BASE}${endpoint}`, {
    ...restOptions, // Spread everything EXCEPT headers
    headers, // Set headers separately
  })
}

// Specific helpers for conversation system prompt endpoints
export type SystemPromptGetResponse = { systemPrompt: string | null }
export type SystemPromptPatchResponse = { id: ConversationId; system_prompt: string | null }
export type ConversationPatchResponse = {
  id: ConversationId
  system_prompt?: string | null
  conversation_context?: string | null
}
export type ConversationContextGetResponse = { context: string | null }

export const getConversationSystemPrompt = (conversationId: ConversationId, accessToken: string | null) =>
  api.get<SystemPromptGetResponse>(`/conversations/${conversationId}/system-prompt`, accessToken)

export const getConversationContext = (conversationId: ConversationId, accessToken: string | null) =>
  api.get<ConversationContextGetResponse>(`/conversations/${conversationId}/context`, accessToken)

export const patchConversationSystemPrompt = (
  conversationId: ConversationId,
  systemPrompt: string | null,
  accessToken: string | null
) =>
  api.patch<SystemPromptPatchResponse>(`/conversations/${conversationId}/system-prompt`, accessToken, { systemPrompt })

export const patchConversationContext = (
  conversationId: ConversationId,
  context: string | null,
  accessToken: string | null
) => api.patch<ConversationPatchResponse>(`/conversations/${conversationId}/context`, accessToken, { context })

export const cloneConversation = (conversationId: ConversationId, accessToken: string | null) =>
  api.post<{ id: ConversationId; title: string; project_id: ConversationId | null }>(
    `/conversations/${conversationId}/clone`,
    accessToken
  )

// Stripe Payment API functions
export interface SubscriptionStatus {
  tier: 'high' | 'mid' | 'low' | null
  status: 'active' | 'canceled' | 'past_due' | null
  currentPeriodEnd: string | null
  creditsBalance: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
}

export interface TierInfo {
  name: string
  price: number
  priceId: string
  credits: number
  features: string[]
}

export interface PricingInfo {
  tiers: {
    high: TierInfo
    mid: TierInfo
    low: TierInfo
  }
}

export interface CheckoutSessionResponse {
  sessionId: string
  url: string
}

export interface CreditTransaction {
  userId: number
  amount: number
  reason: string
  balanceAfter: number
  createdAt: string
}

/**
 * Create a Stripe Checkout Session for subscription
 */
export const createCheckoutSession = async (
  userId: number,
  tier: 'high' | 'mid' | 'low',
  email?: string
): Promise<CheckoutSessionResponse> => {
  const response = await fetch(`${API_BASE}/stripe/create-checkout-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId, tier, email }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to create checkout session' }))
    throw new Error(errorData.error || 'Failed to create checkout session')
  }

  return response.json()
}

/**
 * Get user's subscription status and credit balance
 */
export const getSubscriptionStatus = async (userId: number): Promise<SubscriptionStatus> => {
  const response = await fetch(`${API_BASE}/stripe/subscription-status?userId=${userId}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to get subscription status' }))
    throw new Error(errorData.error || 'Failed to get subscription status')
  }

  return response.json()
}

/**
 * Cancel user's subscription (at period end)
 */
export const cancelSubscription = async (userId: number): Promise<{ success: boolean; message: string }> => {
  const response = await fetch(`${API_BASE}/stripe/cancel-subscription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ userId }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to cancel subscription' }))
    throw new Error(errorData.error || 'Failed to cancel subscription')
  }

  return response.json()
}

/**
 * Get user's credit transaction history
 */
export const getCreditHistory = async (
  userId: number,
  limit: number = 100
): Promise<{ history: CreditTransaction[] }> => {
  const response = await fetch(`${API_BASE}/stripe/credit-history?userId=${userId}&limit=${limit}`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to get credit history' }))
    throw new Error(errorData.error || 'Failed to get credit history')
  }

  return response.json()
}

/**
 * Get pricing information for all subscription tiers
 */
export const getPricingInfo = async (): Promise<PricingInfo> => {
  const response = await fetch(`${API_BASE}/stripe/pricing-info`)

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Failed to get pricing info' }))
    throw new Error(errorData.error || 'Failed to get pricing info')
  }

  return response.json()
}
