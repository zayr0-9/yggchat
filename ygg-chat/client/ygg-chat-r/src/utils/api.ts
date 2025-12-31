// utils/api.ts
import { ConversationId, StorageMode } from '../../../../shared/types'
import { clearClaimsCache, getSessionFromStorage, getTokenExpirationTime, refreshTokenIfNeeded } from '../lib/jwtUtils'

// Base configuration
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'
export const environment = import.meta.env.VITE_ENVIRONMENT || 'local'
export const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'

// Helper to determine if we should use local API
export function shouldUseLocalApi(storageMode?: StorageMode, env?: string): boolean {
  return storageMode === 'local' && (env || environment) === 'electron'
}

// Local API client (mirrors cloud api object) with error handling
const handleLocalApiError = (error: any, endpoint: string): never => {
  // Check if it's a network error (server unavailable)
  if (error instanceof TypeError && error.message.includes('fetch')) {
    throw new Error(
      `Local server not available at ${LOCAL_API_BASE}. ` +
        `Please ensure the Electron app is running with the local server enabled.`
    )
  }
  // Re-throw other errors
  throw new Error(`Local API error (${endpoint}): ${error.message || 'Unknown error'}`)
}

export const localApi = {
  get: async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    try {
      const response = await fetch(`${LOCAL_API_BASE}${endpoint}`, { ...options, method: 'GET' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return (await response.json()) as T
    } catch (error) {
      return handleLocalApiError(error, endpoint)
    }
  },

  post: async <T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> => {
    try {
      const response = await fetch(`${LOCAL_API_BASE}${endpoint}`, {
        ...options,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: data ? JSON.stringify(data) : undefined,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return (await response.json()) as T
    } catch (error) {
      return handleLocalApiError(error, endpoint)
    }
  },

  patch: async <T>(endpoint: string, data?: any, options?: RequestInit): Promise<T> => {
    try {
      const response = await fetch(`${LOCAL_API_BASE}${endpoint}`, {
        ...options,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        body: data ? JSON.stringify(data) : undefined,
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return (await response.json()) as T
    } catch (error) {
      return handleLocalApiError(error, endpoint)
    }
  },

  delete: async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
    try {
      const response = await fetch(`${LOCAL_API_BASE}${endpoint}`, { ...options, method: 'DELETE' })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      return (await response.json()) as T
    } catch (error) {
      return handleLocalApiError(error, endpoint)
    }
  },
}

/**
 * Ensures the access token is valid before making a request.
 * Automatically refreshes the token if it expires in < 5 minutes.
 *
 * @returns The current valid access token or null
 */
async function ensureValidToken(): Promise<string | null> {
  // Skip for non-web/electron environments (local mode doesn't need token refresh)
  if (environment !== 'web' && environment !== 'electron') {
    return null
  }

  const session = getSessionFromStorage()
  if (!session?.access_token) {
    // console.log('[api] No session found')
    return null
  }

  const expiresIn = getTokenExpirationTime()
  if (expiresIn === null) {
    console.warn('[api] Could not determine token expiration')
    return session.access_token
  }

  // Refresh if token expires in < 5 minutes (300 seconds)
  if (expiresIn < 300) {
    // console.log(`[api] Token expires in ${expiresIn}s, refreshing...`)
    await refreshTokenIfNeeded()
    // Get the refreshed token
    const refreshedSession = getSessionFromStorage()
    return refreshedSession?.access_token || null
  }

  return session.access_token
}

// Flag to prevent multiple concurrent redirects
let isRedirectingToLogin = false

// Custom event name for force logout - AuthContext should listen for this
export const FORCE_LOGOUT_EVENT = 'force-logout'

// Helper function to handle login redirection based on environment
const redirectToLogin = () => {
  // Check if already on login page
  const currentPath = environment === 'electron' ? window.location.hash.replace('#', '') : window.location.pathname

  if (currentPath === '/login' || currentPath.startsWith('/login')) {
    // console.log('[api] Already on login page, skipping redirect')
    return
  }

  // Prevent multiple concurrent redirects
  if (isRedirectingToLogin) {
    // console.log('[api] Redirect already in progress, skipping')
    return
  }

  isRedirectingToLogin = true

  // Clear cached auth state to stop queries from firing with stale tokens
  clearClaimsCache()

  if (typeof window !== 'undefined') {
    // Clear the cached Electron session
    ;(window as any)._cachedElectronSession = null

    // Clear Supabase localStorage to prevent stale tokens
    try {
      localStorage.removeItem('supabase-auth-token')
    } catch (e) {
      // Ignore localStorage errors
    }

    // Dispatch force logout event so AuthContext can clear its React state
    // This prevents the redirect loop where Login.tsx sees stale user state
    window.dispatchEvent(new CustomEvent(FORCE_LOGOUT_EVENT))
  }

  if (environment === 'electron') {
    // In Electron with HashRouter, we need to update the hash
    window.location.hash = '/login'
  } else {
    // In Web with BrowserRouter, we can use href (or assign to origin + /login)
    window.location.href = '/login'
  }

  // Reset the flag after a short delay to allow for page transition
  setTimeout(() => {
    isRedirectingToLogin = false
  }, 2000)
}

// Core API utility function - now accepts accessToken as parameter
export const apiCall = async <T>(endpoint: string, accessToken: string | null, options?: RequestInit): Promise<T> => {
  // Ensure token is valid before making the request
  const validToken = await ensureValidToken()
  const tokenToUse = validToken || accessToken

  const isFormData = options?.body && typeof FormData !== 'undefined' && options.body instanceof FormData

  // Destructure to separate headers from other options
  const { headers: optionsHeaders, ...restOptions } = options || {}

  const makeRequest = async (token: string | null) => {
    return fetch(`${API_BASE}${endpoint}`, {
      ...restOptions, // Spread everything EXCEPT headers
      headers: {
        ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
        ...optionsHeaders, // Spread headers from options
        ...(token && (environment === 'web' || environment === 'electron') ? { Authorization: `Bearer ${token}` } : {}), // Add Authorization header with JWT in web/electron mode
      },
    })
  }

  let response = await makeRequest(tokenToUse)

  // Handle 401 Unauthorized: Try to refresh token and retry once
  if (response.status === 401 && (environment === 'web' || environment === 'electron')) {
    console.warn('[api] Received 401 Unauthorized, attempting token refresh and retry...')

    try {
      // Force refresh the token
      const refreshed = await refreshTokenIfNeeded(true)

      if (refreshed) {
        // Get the new token
        const newSession = getSessionFromStorage()
        const newToken = newSession?.access_token

        if (newToken) {
          // console.log('[api] Token refreshed, retrying request...')
          // Retry the request with the new token
          response = await makeRequest(newToken)

          if (response.status === 401) {
            // Still unauthorized after refresh - redirect to login
            console.error('[api] Still unauthorized after token refresh, redirecting to login...')
            redirectToLogin()
            throw new Error('Session expired. Please log in again.')
          }
        } else {
          console.error('[api] Token refresh succeeded but no token found')
          redirectToLogin()
          throw new Error('Session expired. Please log in again.')
        }
      } else {
        console.error('[api] Token refresh failed, redirecting to login...')
        redirectToLogin()
        throw new Error('Session expired. Please log in again.')
      }
    } catch (error) {
      console.error('[api] Error during token refresh:', error)
      redirectToLogin()
      throw new Error('Session expired. Please log in again.')
    }
  }

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
// Note: Streaming requests always go to cloud server for LLM generation
// The storageMode parameter in the request body tells the server whether to save to cloud DB or not
export const createStreamingRequest = async (
  endpoint: string,
  accessToken: string | null,
  options?: RequestInit
): Promise<Response> => {
  // Ensure token is valid before making the request
  const validToken = await ensureValidToken()
  const tokenToUse = validToken || accessToken

  const isFormData = options?.body && typeof FormData !== 'undefined' && options.body instanceof FormData

  // Destructure to separate headers from other options
  const { headers: optionsHeaders, ...restOptions } = options || {}

  const makeStreamRequest = async (token: string | null) => {
    const headers = {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...optionsHeaders, // Spread the headers from options
      ...(token && (environment === 'web' || environment === 'electron') ? { Authorization: `Bearer ${token}` } : {}),
    }

    return fetch(`${API_BASE}${endpoint}`, {
      ...restOptions, // Spread everything EXCEPT headers
      headers, // Set headers separately
    })
  }

  let response = await makeStreamRequest(tokenToUse)

  // Handle 401 Unauthorized: Try to refresh token and retry once
  if (response.status === 401 && (environment === 'web' || environment === 'electron')) {
    console.warn('[api] Streaming request received 401, attempting token refresh and retry...')

    try {
      // Force refresh the token
      const refreshed = await refreshTokenIfNeeded(true)

      if (refreshed) {
        // Get the new token
        const newSession = getSessionFromStorage()
        const newToken = newSession?.access_token

        if (newToken) {
          // console.log('[api] Token refreshed, retrying streaming request...')
          // Retry the request with the new token
          response = await makeStreamRequest(newToken)

          if (response.status === 401) {
            // Still unauthorized after refresh - redirect to login
            console.error('[api] Streaming request still unauthorized after token refresh')
            redirectToLogin()
            throw new Error('Session expired. Please log in again.')
          }
        } else {
          console.error('[api] Token refresh succeeded but no token found')
          redirectToLogin()
          throw new Error('Session expired. Please log in again.')
        }
      } else {
        console.error('[api] Token refresh failed, redirecting to login...')
        redirectToLogin()
        throw new Error('Session expired. Please log in again.')
      }
    } catch (error) {
      console.error('[api] Error during streaming request token refresh:', error)
      redirectToLogin()
      throw new Error('Session expired. Please log in again.')
    }
  }

  return response
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

export const patchConversationResearchNote = (
  conversationId: ConversationId,
  researchNote: string | null,
  accessToken: string | null
) =>
  api.patch<ConversationPatchResponse>(`/conversations/${conversationId}/research-note`, accessToken, { researchNote })

export const patchConversationCwd = (conversationId: ConversationId, cwd: string | null, accessToken: string | null) =>
  api.patch<ConversationPatchResponse>(`/conversations/${conversationId}/cwd`, accessToken, { cwd })

export const patchConversationProject = (
  conversationId: ConversationId,
  projectId: string | null,
  accessToken: string | null
) => api.patch<ConversationPatchResponse>(`/conversations/${conversationId}/project`, accessToken, { projectId })

export const cloneConversation = (conversationId: ConversationId, accessToken: string | null) =>
  api.post<{ id: ConversationId; title: string; project_id: ConversationId | null }>(
    `/conversations/${conversationId}/clone`,
    accessToken
  )

// User System Prompts API
export interface UserSystemPrompt {
  id: string
  owner_id: string
  name: string
  content: string
  description?: string | null
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface CreateUserSystemPromptPayload {
  name: string
  content: string
  description?: string | null
  isDefault?: boolean
}

export interface UpdateUserSystemPromptPayload {
  name?: string
  content?: string
  description?: string | null
  isDefault?: boolean
}

export const getUserSystemPrompts = (accessToken: string | null) =>
  api.get<UserSystemPrompt[]>('/system-prompts', accessToken)

export const getUserSystemPromptById = (id: string, accessToken: string | null) =>
  api.get<UserSystemPrompt>(`/system-prompts/${id}`, accessToken)

export const getDefaultUserSystemPrompt = (accessToken: string | null) =>
  api.get<UserSystemPrompt | null>('/system-prompts/default', accessToken)

export const createUserSystemPrompt = (data: CreateUserSystemPromptPayload, accessToken: string | null) =>
  api.post<UserSystemPrompt>('/system-prompts', accessToken, data)

export const updateUserSystemPrompt = (id: string, data: UpdateUserSystemPromptPayload, accessToken: string | null) =>
  api.put<UserSystemPrompt>(`/system-prompts/${id}`, accessToken, data)

export const setDefaultUserSystemPrompt = (id: string, accessToken: string | null) =>
  api.patch<UserSystemPrompt>(`/system-prompts/${id}/default`, accessToken)

export const deleteUserSystemPrompt = (id: string, accessToken: string | null) =>
  api.delete<{ message: string; id: string }>(`/system-prompts/${id}`, accessToken)

// Stripe Payment API functions
export interface SubscriptionStatus {
  tier: 'high' | 'mid' | 'low' | null
  status: 'active' | 'canceled' | 'past_due' | null
  currentPeriodEnd: string | null
  creditsBalance: number
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  planCode: string | null
  planName: string | null
  monthlyCredits: number
  cancelAtPeriodEnd: boolean
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
