import type { AuthProvider, AuthState, Credentials, AuthChangeCallback, User } from './types'

/**
 * Local Auth Provider
 *
 * Uses a hardcoded local user for development and local-only mode.
 * No network authentication required.
 */
export class LocalAuthProvider implements AuthProvider {
  private static readonly LOCAL_USER_ID = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
  private static readonly LOCAL_TOKEN = 'local-mode-token'

  private authState: AuthState = {
    user: {
      id: LocalAuthProvider.LOCAL_USER_ID,
      username: 'local-user',
      email: 'local@localhost',
    },
    session: {
      access_token: LocalAuthProvider.LOCAL_TOKEN,
    },
    loading: false,
    accessToken: LocalAuthProvider.LOCAL_TOKEN,
    userId: LocalAuthProvider.LOCAL_USER_ID,
  }

  private listeners: Set<AuthChangeCallback> = new Set()

  async initialize(): Promise<void> {
    console.log('[LocalAuth] Initialized with hardcoded local user')
    // Notify listeners of initial state
    this.notifyListeners(this.authState.user)
  }

  async getSession(): Promise<AuthState> {
    return this.authState
  }

  async login(_credentials: Credentials): Promise<AuthState> {
    // In local mode, login always succeeds with the hardcoded user
    console.log('[LocalAuth] Login called (always succeeds in local mode)')
    return this.authState
  }

  async logout(): Promise<void> {
    console.log('[LocalAuth] Logout called (no-op in local mode)')
    // In local mode, we don't actually logout
    // Just notify listeners
    this.notifyListeners(null)
    // But immediately restore the local user
    setTimeout(() => {
      this.notifyListeners(this.authState.user)
    }, 100)
  }

  async refreshToken(): Promise<AuthState> {
    // Local tokens never expire
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
    return false
  }

  private notifyListeners(user: User | null) {
    this.listeners.forEach((listener) => {
      try {
        listener(user)
      } catch (error) {
        console.error('[LocalAuth] Error in listener:', error)
      }
    })
  }
}
