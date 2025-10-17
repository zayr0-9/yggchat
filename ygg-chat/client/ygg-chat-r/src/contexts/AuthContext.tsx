import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { Session, User } from '@supabase/supabase-js'
import { updateThunkExtraAuth } from '../store/thunkExtra'
import { getAuthProvider, type AuthProvider as IAuthProvider } from '../lib/auth'

export interface AuthContextType {
  user: User | null
  session: Session | null
  accessToken: string | null
  userId: string | null
  loading: boolean
  signIn: (credentials: { email: string; password: string }) => Promise<void>
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

  // Store the auth provider instance
  const [provider, setProvider] = useState<IAuthProvider | null>(null)

  // Update auth state helper
  const updateAuthState = useCallback((state: Partial<AuthState>) => {
    setAuthState(prev => {
      const newState = { ...prev, ...state, loading: false }

      // Update Redux thunk extra auth
      updateThunkExtraAuth(newState.accessToken, newState.userId)

      console.log('[AuthContext] Session updated:', newState.userId ?? 'none')

      return newState
    })
  }, [])

  // Initialize auth provider on mount
  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | null = null
    let refreshInterval: number | null = null

    const initializeAuth = async () => {
      try {
        console.log('[AuthContext] Initializing auth provider...')

        // Get the appropriate provider for this environment
        const authProvider = await getAuthProvider()

        if (!mounted) return

        setProvider(authProvider)

        // Get initial session
        const session = await authProvider.getSession()

        if (!mounted) return

        updateAuthState({
          user: session.user as any,
          session: session.session as any,
          accessToken: session.accessToken,
          userId: session.userId,
        })

        // Subscribe to auth state changes
        unsubscribe = authProvider.onAuthStateChange((user) => {
          if (!mounted) return

          updateAuthState({
            user: user as any,
            session: null, // Provider handles session internally
            accessToken: user ? 'token-from-provider' : null,
            userId: user?.id ?? null,
          })
        })

        // Set up periodic token refresh if provider requires network auth
        if (authProvider.requiresNetworkAuth()) {
          console.log('[AuthContext] Setting up periodic token refresh')
          refreshInterval = window.setInterval(async () => {
            try {
              await authProvider.refreshToken()
            } catch (error) {
              console.error('[AuthContext] Token refresh failed:', error)
            }
          }, 30000) // Check every 30 seconds
        }
      } catch (error) {
        console.error('[AuthContext] Failed to initialize auth:', error)
        if (mounted) {
          setAuthState(prev => ({ ...prev, loading: false }))
        }
      }
    }

    initializeAuth()

    // Cleanup
    return () => {
      mounted = false
      console.log('[AuthContext] Cleaning up auth provider')

      if (unsubscribe) {
        unsubscribe()
      }

      if (refreshInterval !== null) {
        clearInterval(refreshInterval)
      }
    }
  }, [updateAuthState])

  // Sign in using the provider
  const signIn = useCallback(async (credentials: { email: string; password: string }) => {
    console.log('[AuthContext] Signing in...')

    if (!provider) {
      console.warn('[AuthContext] Provider not initialized yet')
      throw new Error('Auth provider not initialized')
    }

    try {
      const authState = await provider.login(credentials)

      // Update state
      updateAuthState({
        user: authState.user as any,
        session: authState.session as any,
        accessToken: authState.accessToken,
        userId: authState.userId,
      })
    } catch (error) {
      console.error('[AuthContext] Sign in failed:', error)
      throw error
    }
  }, [provider, updateAuthState])

  // Sign out using the provider
  const signOut = useCallback(async () => {
    console.log('[AuthContext] Signing out...')

    if (!provider) {
      console.warn('[AuthContext] Provider not initialized yet')
      return
    }

    try {
      await provider.logout()

      // Update state
      updateAuthState({
        user: null,
        session: null,
        accessToken: null,
        userId: null,
      })
    } catch (error) {
      console.error('[AuthContext] Sign out failed:', error)
      throw error
    }
  }, [provider, updateAuthState])

  // Memoize context value to prevent re-render cascades
  // Only updates when authState or signIn/signOut actually changes
  const value: AuthContextType = useMemo(
    () => ({
      user: authState.user,
      session: authState.session,
      accessToken: authState.accessToken,
      userId: authState.userId,
      loading: authState.loading,
      signIn,
      signOut,
      getClaims: async () => {
        // For Supabase provider, use its getClaims method
        if (provider && 'getClaims' in provider) {
          return (provider as any).getClaims()
        }
        // For other providers, return null
        return null
      },
      isTokenValid: async () => {
        // For Supabase provider, use its isTokenValid method
        if (provider && 'isTokenValid' in provider) {
          return (provider as any).isTokenValid()
        }
        // For other providers, always valid
        return true
      },
    }),
    [authState, signIn, signOut, provider]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
