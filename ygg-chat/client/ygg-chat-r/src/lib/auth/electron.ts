import type { AuthProvider, AuthState, Credentials, AuthChangeCallback, User } from './types'

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
    console.log('[ElectronAuth] Initializing...')

    // Check if running in Electron
    if (window.electronAPI) {
      this.electronAPI = window.electronAPI
      console.log('[ElectronAuth] Electron API detected')

      // Try to load saved session from Electron storage
      try {
        const savedSession = await this.electronAPI.storage.get('auth_session')
        if (savedSession && savedSession.user) {
          console.log('[ElectronAuth] Restored session from storage')
          this.authState = savedSession
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
    console.log('[ElectronAuth] Login called')

    // Check if this is a local mode login (empty credentials)
    const isLocalMode = !credentials.email && !credentials.password

    if (isLocalMode) {
      console.log('[ElectronAuth] Local mode login - using default user')

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
          },
          loading: false,
          accessToken: result.accessToken || ElectronAuthProvider.ELECTRON_TOKEN,
          userId: result.userId || ElectronAuthProvider.ELECTRON_USER_ID,
        }

        // Save to Electron storage
        await this.electronAPI.storage.set('auth_session', this.authState)

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
    console.log('[ElectronAuth] Logout called')

    if (this.electronAPI) {
      try {
        await this.electronAPI.auth.logout()
        await this.electronAPI.storage.set('auth_session', null)
      } catch (error) {
        console.error('[ElectronAuth] Logout error:', error)
      }
    }

    // Reset to default local user
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

    // Notify listeners
    this.notifyListeners(this.authState.user)
  }

  async refreshToken(): Promise<AuthState> {
    // For local-only mode, tokens don't expire
    // For cloud sync mode, we would implement token refresh here
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
    // Electron can work offline by default
    return false
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
        console.log('[ElectronAuth] Reloaded session from storage:', savedSession.user.id)
        this.authState = savedSession
        this.notifyListeners(this.authState.user)
      } else {
        console.log('[ElectronAuth] No session found in storage')
      }
    } catch (error) {
      console.warn('[ElectronAuth] Failed to reload session:', error)
    }
  }

  private notifyListeners(user: User | null) {
    this.listeners.forEach((listener) => {
      try {
        listener(user)
      } catch (error) {
        console.error('[ElectronAuth] Error in listener:', error)
      }
    })
  }
}
