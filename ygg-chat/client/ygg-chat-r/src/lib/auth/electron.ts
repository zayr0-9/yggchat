import { supabase } from '../supabase'
import type { AuthChangeCallback, AuthProvider, AuthState, Credentials, User } from './types'

/**
 * Electron Auth Provider
 *
 * For Electron, we default to local-only mode (no auth required).
 * Optional cloud sync can be enabled, which would use IPC to communicate
 * with the main process for secure credential storage.
 */
export class ElectronAuthProvider implements AuthProvider {
  // Use the same user ID as local mode - they share the same database
  private static readonly ELECTRON_USER_ID = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
  private static readonly ELECTRON_TOKEN = 'electron-local-token'

  private authState: AuthState = {
    user: null,
    session: null,
    loading: false,
    accessToken: null,
    userId: null,
  }

  private listeners: Set<AuthChangeCallback> = new Set()
  private electronAPI: any = null

  async initialize(): Promise<void> {
    // console.log('[ElectronAuth] Initializing...')

    // Check if running in Electron
    if (window.electronAPI) {
      this.electronAPI = window.electronAPI
      // console.log('[ElectronAuth] Electron API detected')

      // Try to load saved session from Electron storage
      try {
        const savedSession = await this.electronAPI.storage.get('auth_session')
        if (savedSession && savedSession.user) {
          // console.log('[ElectronAuth] Restored session from storage')

          // Temporarily set state to check expiry/refresh
          this.authState = savedSession

          // Check if token is expired (for cloud sessions)
          if (
            this.authState.session?.access_token &&
            this.authState.user.id !== ElectronAuthProvider.ELECTRON_USER_ID &&
            this.isTokenExpired(this.authState.session.access_token)
          ) {
            //  console.log('[ElectronAuth] Token expired, attempting refresh...')
            try {
              await this.refreshToken()
              //  console.log('[ElectronAuth] Token refreshed during initialization')
            } catch (refreshError) {
              console.error('[ElectronAuth] Failed to refresh token on init:', refreshError)
              // Clear invalid session
              await this.logout()
              return
            }
          }

          // Sync with Supabase client if we have a valid cloud session
          // This ensures api.ts and jwtUtils.ts work correctly
          if (supabase && this.authState.session && this.authState.user.id !== ElectronAuthProvider.ELECTRON_USER_ID) {
            // console.log('[ElectronAuth] Syncing session to Supabase client')
            await supabase.auth.setSession({
              access_token: this.authState.session.access_token,
              refresh_token: this.authState.session.refresh_token || '',
            })
          }
        } else {
          console.log('[ElectronAuth] No saved session found - user must log in')
        }
      } catch (error) {
        console.warn('[ElectronAuth] Failed to load saved session:', error)
      }
    } else {
      console.warn('[ElectronAuth] Not running in Electron environment')
    }

    // Notify listeners of initial state (null if no saved session)
    this.notifyListeners(this.authState.user)
  }

  async getSession(): Promise<AuthState> {
    return this.authState
  }

  async login(credentials: Credentials): Promise<AuthState> {
    // console.log('[ElectronAuth] Login called')

    // Check if this is a local mode login (empty credentials)
    const isLocalMode = !credentials.email && !credentials.password

    if (isLocalMode) {
      // console.log('[ElectronAuth] Local mode login - using default user')

      // Use default local user for local mode
      this.authState = {
        user: {
          id: ElectronAuthProvider.ELECTRON_USER_ID,
          username: 'electron-user',
          email: 'electron@localhost',
        },
        session: {
          access_token: ElectronAuthProvider.ELECTRON_TOKEN,
        },
        loading: false,
        accessToken: ElectronAuthProvider.ELECTRON_TOKEN,
        userId: ElectronAuthProvider.ELECTRON_USER_ID,
      }

      // Save to Electron storage if available
      if (this.electronAPI) {
        try {
          await this.electronAPI.storage.set('auth_session', this.authState)
        } catch (error) {
          console.warn('[ElectronAuth] Failed to save session:', error)
        }
      }

      // Notify listeners
      this.notifyListeners(this.authState.user)

      return this.authState
    }

    // Cloud sync login (requires Electron API)
    if (!this.electronAPI) {
      console.warn('[ElectronAuth] Electron API not available for cloud login')
      throw new Error('Electron API not available for cloud authentication')
    }

    try {
      // Use IPC to login (for optional cloud sync)
      const result = await this.electronAPI.auth.login(credentials)

      if (result.success) {
        // Update auth state
        this.authState = {
          user: {
            id: result.userId || ElectronAuthProvider.ELECTRON_USER_ID,
            email: credentials.email,
            username: result.username || 'electron-user',
          },
          session: {
            access_token: result.accessToken || ElectronAuthProvider.ELECTRON_TOKEN,
            // Ensure refresh token is preserved if returned, otherwise we might need to fetch it via supabase if possible,
            // but electron login usually just returns access token?
            // If result doesn't have refresh_token, we might be in trouble for future refreshes.
            // Assuming result might have it or we set it later.
            // But for now, let's assume result has what we need or we rely on what's there.
            // Actually, the Electron main process auth.login might need to return refresh_token too.
            // If it doesn't, we can't refresh.
            // But wait, if we use Supabase auth in main process, it returns a session.
            // Let's assume result might carry session data.
            // For now, I will preserve existing behavior but ensure we capture session properly if available.
            ...((result as any).session
              ? (result as any).session
              : { access_token: result.accessToken || ElectronAuthProvider.ELECTRON_TOKEN }),
          },
          loading: false,
          accessToken: result.accessToken || ElectronAuthProvider.ELECTRON_TOKEN,
          userId: result.userId || ElectronAuthProvider.ELECTRON_USER_ID,
        }

        // If we have a real session from the result (which we should if the main process does it right), good.
        // If not, we might be limited.

        // Save to Electron storage
        await this.electronAPI.storage.set('auth_session', this.authState)

        // Sync to Supabase client
        if (supabase && !isLocalMode) {
          await supabase.auth.setSession({
            access_token: this.authState.accessToken!,
            refresh_token: this.authState.session?.refresh_token || '',
          })
        }

        // Notify listeners
        this.notifyListeners(this.authState.user)
      }

      return this.authState
    } catch (error) {
      console.error('[ElectronAuth] Login failed:', error)
      throw error
    }
  }

  async logout(): Promise<void> {
    // console.log('[ElectronAuth] Logout called')

    if (this.electronAPI) {
      try {
        await this.electronAPI.auth.logout()

        // Clear ALL stored data to prevent unauthorized access
        if ('clear' in this.electronAPI.storage) {
          await this.electronAPI.storage.clear()
          // console.log('[ElectronAuth] Cleared all stored session data')
        } else {
          // Fallback: just delete auth_session
          await this.electronAPI.storage.set('auth_session', null)
        }
      } catch (error) {
        console.error('[ElectronAuth] Logout error:', error)
      }
    }

    // Clear supabase session too
    if (supabase) {
      await supabase.auth.signOut()
    }

    // Reset to null state (no default user after logout)
    this.authState = {
      user: null,
      session: null,
      loading: false,
      accessToken: null,
      userId: null,
    }

    // Notify listeners (triggers redirect to login)
    this.notifyListeners(null)
  }

  async refreshToken(): Promise<AuthState> {
    // For local-only mode, tokens don't expire
    if (this.authState.user?.id === ElectronAuthProvider.ELECTRON_USER_ID) {
      return this.authState
    }

    // For cloud sync mode
    // console.log('[ElectronAuth] Refreshing token...')

    if (!this.authState.session?.refresh_token) {
      console.warn('[ElectronAuth] No refresh token available')
      // If we don't have a refresh token, we can't refresh.
      // But maybe Supabase client has it?
      return this.authState
    }

    if (!supabase) {
      console.warn('[ElectronAuth] Supabase client not available for refresh')
      return this.authState
    }

    try {
      // Refresh the session
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: this.authState.session.refresh_token,
      })

      if (error) {
        throw error
      }

      if (data.session) {
        // console.log('[ElectronAuth] Token refresh successful')

        // Update state
        this.authState = {
          ...this.authState,
          session: data.session as any,
          accessToken: data.session.access_token,
          // update user if needed, but usually id is same
        }

        // Save to Electron storage
        if (this.electronAPI) {
          await this.electronAPI.storage.set('auth_session', this.authState)
        }

        return this.authState
      }
    } catch (error) {
      console.error('[ElectronAuth] Token refresh failed:', error)
      // If refresh fails (e.g. revoked), we should probably logout
      // But let the caller decide or AuthContext handle it.
      // If we throw, AuthContext might catch it.
      throw error
    }

    return this.authState
  }

  onAuthStateChange(callback: AuthChangeCallback): () => void {
    this.listeners.add(callback)

    // Immediately call with current user
    callback(this.authState.user)

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback)
    }
  }

  requiresNetworkAuth(): boolean {
    // Electron can work offline by default, but if we have a cloud session, we need network auth handling
    // (like refreshing tokens)
    return !!this.authState.user && this.authState.user.id !== ElectronAuthProvider.ELECTRON_USER_ID
  }

  /**
   * Reload auth session from Electron storage
   * Useful after OAuth flows that save session externally
   */
  async reloadSession(): Promise<void> {
    if (!this.electronAPI) {
      console.warn('[ElectronAuth] Cannot reload session - Electron API not available')
      return
    }

    try {
      const savedSession = await this.electronAPI.storage.get('auth_session')
      if (savedSession && savedSession.user) {
        // console.log('[ElectronAuth] Reloaded session from storage:', savedSession.user.id)
        this.authState = savedSession

        // Check expiry and sync
        if (this.authState.session?.access_token && this.authState.user.id !== ElectronAuthProvider.ELECTRON_USER_ID) {
          if (this.isTokenExpired(this.authState.session.access_token)) {
            // console.log('[ElectronAuth] Reloaded token is expired, refreshing...')
            try {
              await this.refreshToken()
            } catch (e) {
              console.error('Failed to refresh reloaded token:', e)
              await this.logout()
              return
            }
          }

          // Sync to Supabase
          if (supabase) {
            await supabase.auth.setSession({
              access_token: this.authState.session.access_token,
              refresh_token: this.authState.session.refresh_token || '',
            })
          }
        }

        this.notifyListeners(this.authState.user)
      } else {
        console.log('[ElectronAuth] No session found in storage')
      }
    } catch (error) {
      console.warn('[ElectronAuth] Failed to reload session:', error)
    }
  }

  private notifyListeners(user: User | null) {
    this.listeners.forEach(listener => {
      try {
        listener(user)
      } catch (error) {
        console.error('[ElectronAuth] Error in listener:', error)
      }
    })
  }

  private isTokenExpired(token: string): boolean {
    try {
      const payloadBase64 = token.split('.')[1]
      if (!payloadBase64) return true

      const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/')
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      )

      const payload = JSON.parse(jsonPayload)
      if (!payload.exp) return true

      // Check if expired (with 30s buffer)
      return payload.exp * 1000 < Date.now() + 30000
    } catch (e) {
      console.error('[ElectronAuth] Error checking token expiry:', e)
      return true
    }
  }
}
