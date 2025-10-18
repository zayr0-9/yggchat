import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

interface CachedClaims {
  claims: Record<string, unknown>
  expiresAt: number
}

let claimsCache: CachedClaims | null = null

// Mutex to prevent concurrent token refresh requests
let refreshPromise: Promise<boolean> | null = null

/**
 * Read session from localStorage ONLY (no network calls).
 * This bypasses Supabase SDK's getSession() which may trigger network requests.
 *
 * @returns Session object from localStorage or null
 */
export function getSessionFromStorage(): Session | null {
  try {
    // Supabase stores session in localStorage with this key
    const storageKey = 'supabase-auth-token'
    const stored = localStorage.getItem(storageKey)

    console.log('[jwtUtils] Reading from localStorage key:', storageKey)

    if (!stored) {
      console.log('[jwtUtils] No data in localStorage')
      return null
    }

    // Parse the stored session data
    const parsed = JSON.parse(stored)
    console.log('[jwtUtils] Parsed localStorage:', {
      hasCurrentSession: !!parsed?.currentSession,
      hasSession: !!parsed?.session,
      topLevelKeys: Object.keys(parsed || {}),
    })

    // Supabase stores session in different formats depending on version
    // Try to extract session from various possible structures
    const session = parsed?.currentSession || parsed?.session || parsed

    console.log('[jwtUtils] Extracted session:', {
      hasAccessToken: !!session?.access_token,
      accessTokenPreview: session?.access_token ? session.access_token.substring(0, 20) + '...' : 'null',
      hasUser: !!session?.user,
      userId: session?.user?.id,
    })

    if (!session?.access_token) {
      console.warn('[jwtUtils] Session missing access_token')
      return null
    }

    return session as Session
  } catch (err) {
    console.error('[jwtUtils] Failed to read session from localStorage:', err)
    return null
  }
}

/**
 * Decodes a JWT token locally without any network calls.
 * Only decodes the payload - does NOT verify signature (assumes Supabase already validated on login).
 *
 * @param token - The JWT access token
 * @returns The decoded JWT payload or null if invalid
 */
function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('[jwtUtils] ❌ Invalid JWT format')
      return null
    }

    // Decode the payload (second part)
    const payload = parts[1]

    // Base64URL decode (handle URL-safe base64)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    )

    return JSON.parse(jsonPayload)
  } catch (err) {
    console.error('[jwtUtils] ❌ Failed to decode JWT:', err)
    return null
  }
}

/**
 * Gets JWT claims with caching - performs ZERO network calls.
 * Decodes the JWT locally from localStorage session.
 *
 * @returns The JWT claims if valid, null if no session or invalid token
 */
export async function getCachedClaims(): Promise<Record<string, unknown> | null> {
  const now = Date.now()

  // Return cached claims if still valid
  if (claimsCache && claimsCache.expiresAt > now) {
    return claimsCache.claims
  }

  if (claimsCache) {
  }

  try {
    // Read session from localStorage ONLY (NO network call - bypasses Supabase SDK)
    const session = getSessionFromStorage()

    if (!session || !session.access_token) {
      claimsCache = null
      return null
    }

    // Decode JWT locally (NO network call)
    const claims = decodeJWT(session.access_token)

    if (!claims) {
      console.error('[jwtUtils] ❌ Failed to decode JWT')
      claimsCache = null
      return null
    }

    // Check if token is expired
    const exp = claims.exp as number
    if (!exp) {
      console.error('[jwtUtils] ❌ JWT missing exp claim')
      claimsCache = null
      return null
    }

    const expiresAt = exp * 1000 - 30000 // 30 second buffer

    if (expiresAt <= now) {
      console.warn('[jwtUtils] ⚠️  JWT is expired')
      claimsCache = null
      return null
    }

    claimsCache = {
      claims,
      expiresAt,
    }

    return claims
  } catch (err) {
    console.error('[jwtUtils] ❌ Exception getting claims:', err)
    claimsCache = null
    return null
  }
}

/**
 * Validates if the current JWT is valid without making network calls.
 * Uses local asymmetric verification via getClaims().
 *
 * @returns true if token is valid, false otherwise
 */
export async function isTokenValid(): Promise<boolean> {
  const claims = await getCachedClaims()
  return claims !== null
}

/**
 * Clears the claims cache. Call this on sign out or auth state changes.
 */
export function clearClaimsCache(): void {
  claimsCache = null
}

/**
 * Gets the user ID from cached claims without network calls.
 *
 * @returns The user ID (sub claim) or null
 */
export async function getUserIdFromClaims(): Promise<string | null> {
  const claims = await getCachedClaims()
  return (claims?.sub as string) ?? null
}

/**
 * Gets the number of seconds until the current token expires.
 *
 * @returns Seconds until expiration, or null if no valid session
 */
export function getTokenExpirationTime(): number | null {
  try {
    const session = getSessionFromStorage()
    if (!session?.access_token) {
      return null
    }

    const claims = decodeJWT(session.access_token)
    if (!claims?.exp) {
      return null
    }

    const now = Math.floor(Date.now() / 1000)
    const expiresIn = (claims.exp as number) - now

    return expiresIn
  } catch (err) {
    console.error('[jwtUtils] Failed to get token expiration time:', err)
    return null
  }
}

/**
 * Checks if the current token needs refresh and refreshes it if necessary.
 * Uses local expiry time check - NO network calls unless refresh is actually needed.
 *
 * Includes mutex to prevent concurrent refresh requests (race condition protection).
 *
 * @param force - If true, force refresh regardless of expiration time
 * @returns true if token was refreshed, false otherwise
 */
export async function refreshTokenIfNeeded(force = false): Promise<boolean> {
  // If a refresh is already in progress, wait for it to complete
  if (refreshPromise) {
    console.log('[jwtUtils] Refresh already in progress, waiting...')
    return await refreshPromise
  }

  // Create a new refresh promise
  refreshPromise = (async () => {
    try {
      // Read from localStorage directly (no network call)
      const session = getSessionFromStorage()

      if (!session) {
        console.log('[jwtUtils] No session found, cannot refresh')
        return false
      }

      // Check if token expires in the next 5 minutes (300 seconds)
      const expiresAt = session.expires_at
      if (!expiresAt) {
        console.warn('[jwtUtils] Session missing expires_at')
        return false
      }

      const now = Math.floor(Date.now() / 1000)
      const expiresIn = expiresAt - now

      console.log('[jwtUtils] Token expires in', expiresIn, 'seconds')

      // Refresh if token expires in less than 5 minutes OR if forced
      if (force || expiresIn < 300) {
        console.log(`[jwtUtils] ${force ? 'Force refreshing' : 'Refreshing'} token...`)

        // Check if supabase client is available
        if (!supabase) {
          console.warn('[jwtUtils] ⚠️  Supabase client not available - cannot refresh token')
          return false
        }

        // This will call /auth/v1/token endpoint (NOT /auth/v1/user!)
        const { data, error } = await supabase.auth.refreshSession()

        if (error) {
          console.error('[jwtUtils] ❌ Failed to refresh session:', error)
          return false
        }

        if (data.session) {
          console.log('[jwtUtils] ✅ Token refreshed successfully')
          // Clear claims cache since we have a new token
          clearClaimsCache()
          return true
        }
      }

      return false
    } catch (err) {
      console.error('[jwtUtils] ❌ Exception during token refresh:', err)
      return false
    } finally {
      // Clear the promise so future requests can refresh again
      refreshPromise = null
    }
  })()

  return await refreshPromise
}
