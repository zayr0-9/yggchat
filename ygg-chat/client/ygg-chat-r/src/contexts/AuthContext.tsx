import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { updateThunkExtraAuth } from '../store/thunkExtra'
import { getCachedClaims, clearClaimsCache, isTokenValid, refreshTokenIfNeeded, getSessionFromStorage } from '../lib/jwtUtils'

export interface AuthContextType {
  user: User | null
  session: Session | null
  accessToken: string | null
  userId: string | null
  loading: boolean
  signOut: () => Promise<void>
  getClaims: () => Promise<Record<string, unknown> | null>
  isTokenValid: () => Promise<boolean>
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: React.ReactNode
}

interface AuthState {
  user: User | null
  session: Session | null
  accessToken: string | null
  userId: string | null
  loading: boolean
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Use single state object to batch updates and prevent multiple re-renders
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    accessToken: null,
    userId: null,
    loading: true,
  })

  // JWT Verification Strategy (ASYMMETRIC):
  // 1. getSession() reads from localStorage ONLY (no network calls)
  // 2. getClaims() verifies JWT locally using JWKS public keys (no /auth/v1/user calls)
  // 3. Manual token refresh via refreshSession() when needed (calls /auth/v1/token only)
  // 4. onAuthStateChange listener for reactivity (enables navigation updates without validation network calls)

  // Update auth state helper
  const updateAuthState = useCallback((newSession: Session | null) => {
    const newAccessToken = newSession?.access_token ?? null
    const newUserId = newSession?.user?.id ?? null

    setAuthState({
      user: newSession?.user ?? null,
      session: newSession,
      accessToken: newAccessToken,
      userId: newUserId,
      loading: false,
    })

    updateThunkExtraAuth(newAccessToken, newUserId)

    console.log('[AuthContext] Session updated:', newUserId ?? 'none')
  }, [])

  useEffect(() => {
    // Check if we're in local mode
    const isLocal = import.meta.env.VITE_ENVIRONMENT === 'local'

    // STEP 1: Read initial session from localStorage ONLY (ZERO network calls)
    const initializeAuth = async () => {
      try {
        console.log('[AuthContext] Initializing - reading from localStorage...')

        // In local mode, bypass Supabase and use hardcoded local user
        if (isLocal) {
          console.log('[AuthContext] Local mode detected - using hardcoded local user')
          setAuthState({
            user: { id: 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3' } as any,
            session: null,
            accessToken: 'local-mode-token',
            userId: 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3',
            loading: false,
          })
          updateThunkExtraAuth('local-mode-token', 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3')
          return
        }

        const initialSession = getSessionFromStorage()

        if (initialSession) {
          // STEP 2: Check if token needs refresh (but don't validate yet)
          // This checks expiry time locally without network calls
          const needsRefresh = await refreshTokenIfNeeded()

          if (needsRefresh) {
            console.log('[AuthContext] Token was refreshed during init')
            // Re-read session after refresh (from localStorage)
            const refreshedSession = getSessionFromStorage()
            updateAuthState(refreshedSession)
          } else {
            updateAuthState(initialSession)
          }
        } else {
          console.log('[AuthContext] No session found in localStorage')
          updateAuthState(null)
        }
      } catch (error) {
        console.error('[AuthContext] Failed to initialize auth:', error)
        setAuthState(prev => ({ ...prev, loading: false }))
      }
    }

    initializeAuth()

    // STEP 3: Set up onAuthStateChange listener to detect auth changes
    // This listener enables navigation updates without triggering network calls for validation
    // JWT validation remains local via getCachedClaims()
    // Skip if supabase client is not initialized (missing env vars)
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      console.log('[AuthContext] Auth state changed:', event)

      // Update state for SIGNED_IN and SIGNED_OUT events
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        updateAuthState(session)

        // Clear claims cache on sign out
        if (event === 'SIGNED_OUT') {
          clearClaimsCache()
        }
      }
    })

    // STEP 4: Set up periodic token refresh check (every 30 seconds)
    // This ensures we refresh before expiry without relying on onAuthStateChange
    const refreshInterval = setInterval(async () => {
      try {
        const needsRefresh = await refreshTokenIfNeeded()
        if (needsRefresh) {
          console.log('[AuthContext] Token refreshed by interval')
          const refreshedSession = getSessionFromStorage()
          updateAuthState(refreshedSession)
        }
      } catch (error) {
        console.error('[AuthContext] Refresh interval error:', error)
      }
    }, 30000) // Check every 30 seconds

    // Cleanup interval and listener on unmount
    return () => {
      console.log('[AuthContext] Cleaning up refresh interval and auth listener')
      clearInterval(refreshInterval)
      subscription?.data.subscription.unsubscribe()
    }
  }, [updateAuthState])

  // Listen for storage events (for multi-tab synchronization)
  // This handles sign-in/sign-out in other tabs
  useEffect(() => {
    const handleStorageChange = async (e: StorageEvent) => {
      if (e.key === 'supabase-auth-token' || e.key === 'supabase.auth.token') {
        console.log('[AuthContext] Storage changed - reloading session from localStorage')
        const session = getSessionFromStorage()
        updateAuthState(session)
        if (!session) {
          clearClaimsCache()
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [updateAuthState])

  // Memoize signOut to prevent recreating on every render
  const signOut = useCallback(async () => {
    clearClaimsCache()
    if (supabase) {
      await supabase.auth.signOut()
    }
    updateAuthState(null)
  }, [updateAuthState])

  // Memoize context value to prevent re-render cascades
  // Only updates when authState or signOut actually changes
  const value: AuthContextType = useMemo(
    () => ({
      user: authState.user,
      session: authState.session,
      accessToken: authState.accessToken,
      userId: authState.userId,
      loading: authState.loading,
      signOut,
      getClaims: getCachedClaims,
      isTokenValid,
    }),
    [authState, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
