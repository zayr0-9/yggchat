import { clearClaimsCache, getCachedClaims, isTokenValid as validateToken } from '../jwtUtils'
import { supabase } from '../supabase'
import type { AuthChangeCallback, AuthProvider, AuthState, Credentials } from './types'

/**
 * Supabase Auth Provider
 *
 * Wrapper around Supabase authentication with asymmetric JWT verification.
 * - getSession() reads from localStorage (no network calls)
 * - getClaims() verifies JWT locally using JWKS public keys
 * - Manual token refresh when needed
 */
export class SupabaseAuthProvider implements AuthProvider {
  private listeners: Set<AuthChangeCallback> = new Set()
  private unsubscribe: (() => void) | null = null
  private cachedSession: AuthState | null = null

  async initialize(): Promise<void> {
    if (!supabase) {
      console.warn('[SupabaseAuth] Supabase client not initialized')
      return
    }

    console.log('[SupabaseAuth] Initializing...')

    // Set up auth state change listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[SupabaseAuth] Auth state changed:', event, {
        hasSession: !!session,
        hasAccessToken: !!session?.access_token,
        tokenPreview: session?.access_token ? session.access_token.substring(0, 20) + '...' : 'null',
      })

      if (event === 'SIGNED_OUT') {
        clearClaimsCache()
        this.cachedSession = null
      } else if (session) {
        // Cache the session from the callback (has the valid access_token)
        this.cachedSession = {
          user: (session.user as any) ?? null,
          session: session as any,
          accessToken: session.access_token ?? null,
          userId: session.user?.id ?? null,
          loading: false,
        }
        console.log('[SupabaseAuth] Cached session from callback:', {
          userId: this.cachedSession.userId,
          hasAccessToken: !!this.cachedSession.accessToken,
        })
      }

      // Notify all listeners
      const user = session?.user ?? null
      this.notifyListeners(user as any)
    })

    this.unsubscribe = () => subscription.unsubscribe()

    // Set up multi-tab sync
    window.addEventListener('storage', this.handleStorageChange)

    console.log('[SupabaseAuth] Initialized successfully')
  }

  async getSession(): Promise<AuthState> {
    if (!supabase) {
      console.warn('[SupabaseAuth] Supabase client not available')
      return {
        user: null,
        session: null,
        accessToken: null,
        userId: null,
        loading: false,
      }
    }

    try {
      // If we have a cached session from the callback, return it (most recent)
      if (this.cachedSession) {
        console.log('[SupabaseAuth] Returning cached session:', {
          userId: this.cachedSession.userId,
          hasAccessToken: !!this.cachedSession.accessToken,
        })
        return this.cachedSession
      }

      // Otherwise, use Supabase SDK's getSession() which reads from localStorage
      // This is for initial page load before onAuthStateChange fires
      console.log('[SupabaseAuth] No cached session, using SDK getSession()')
      const { data, error } = await supabase.auth.getSession()

      if (error) {
        console.error('[SupabaseAuth] Error getting session from SDK:', error)
        return {
          user: null,
          session: null,
          accessToken: null,
          userId: null,
          loading: false,
        }
      }

      const session = data.session

      if (!session) {
        console.log('[SupabaseAuth] No session from SDK')
        return {
          user: null,
          session: null,
          accessToken: null,
          userId: null,
          loading: false,
        }
      }

      console.log('[SupabaseAuth] Got session from SDK:', {
        userId: session.user?.id,
        hasAccessToken: !!session.access_token,
        tokenPreview: session.access_token ? session.access_token.substring(0, 20) + '...' : 'null',
      })

      // Cache this session
      this.cachedSession = {
        user: (session.user as any) ?? null,
        session: session as any,
        accessToken: session.access_token ?? null,
        userId: session.user?.id ?? null,
        loading: false,
      }

      return this.cachedSession
    } catch (error) {
      console.error('[SupabaseAuth] Error getting session:', error)
      return {
        user: null,
        session: null,
        accessToken: null,
        userId: null,
        loading: false,
      }
    }
  }

  async login(credentials: Credentials): Promise<AuthState> {
    if (!supabase) {
      throw new Error('Supabase client not initialized')
    }

    console.log('[SupabaseAuth] Logging in...')

    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    })

    if (error) {
      console.error('[SupabaseAuth] Login failed:', error.message)
      throw error
    }

    console.log('[SupabaseAuth] Login successful')

    return {
      user: (data.user as any) ?? null,
      session: data.session as any,
      accessToken: data.session?.access_token ?? null,
      userId: data.user?.id ?? null,
      loading: false,
    }
  }

  async logout(): Promise<void> {
    if (!supabase) {
      console.warn('[SupabaseAuth] Supabase client not available for logout')
      return
    }

    console.log('[SupabaseAuth] Logging out...')

    clearClaimsCache()

    const { error } = await supabase.auth.signOut()

    if (error) {
      console.error('[SupabaseAuth] Logout error:', error.message)
      throw error
    }

    console.log('[SupabaseAuth] Logout successful')
  }

  async refreshToken(): Promise<AuthState> {
    if (!supabase) {
      throw new Error('Supabase client not initialized')
    }

    console.log('[SupabaseAuth] Refreshing token...')

    const { data, error } = await supabase.auth.refreshSession()

    if (error) {
      console.error('[SupabaseAuth] Token refresh failed:', error.message)
      throw error
    }

    console.log('[SupabaseAuth] Token refreshed successfully')

    return {
      user: (data.user as any) ?? null,
      session: data.session as any,
      accessToken: data.session?.access_token ?? null,
      userId: data.user?.id ?? null,
      loading: false,
    }
  }

  onAuthStateChange(callback: AuthChangeCallback): () => void {
    this.listeners.add(callback)

    // Immediately call with current user
    this.getSession().then(state => {
      callback(state.user)
    })

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback)
    }
  }

  requiresNetworkAuth(): boolean {
    return false
  }

  /**
   * Verify JWT claims locally (no network call)
   */
  async getClaims(): Promise<Record<string, unknown> | null> {
    try {
      const claims = await getCachedClaims()
      return claims
    } catch (error) {
      console.error('[SupabaseAuth] Failed to get claims:', error)
      return null
    }
  }

  /**
   * Check if token is valid (local verification)
   */
  async isTokenValid(): Promise<boolean> {
    try {
      return await validateToken()
    } catch (error) {
      console.error('[SupabaseAuth] Token validation failed:', error)
      return false
    }
  }

  /**
   * Handle storage changes from other tabs
   */
  private handleStorageChange = (event: StorageEvent) => {
    if (event.key === 'supabase-auth-token' && event.newValue !== event.oldValue) {
      console.log('[SupabaseAuth] Auth state changed in another tab')

      // Re-read session and notify listeners
      this.getSession().then(state => {
        this.notifyListeners(state.user)
      })
    }
  }

  private notifyListeners(user: any) {
    this.listeners.forEach(listener => {
      try {
        listener(user)
      } catch (error) {
        console.error('[SupabaseAuth] Error in listener:', error)
      }
    })
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.unsubscribe) {
      this.unsubscribe()
    }
    window.removeEventListener('storage', this.handleStorageChange)
    this.listeners.clear()
  }
}
