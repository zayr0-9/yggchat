/**
 * Auth Provider Factory
 *
 * Dynamically selects and creates the appropriate auth provider based on
 * build target and runtime environment.
 */

import type { AuthProvider } from './types'

// Re-export types for convenience
export type { AuthProvider, AuthState, User, Session, Credentials, AuthChangeCallback } from './types'

let cachedProvider: AuthProvider | null = null

/**
 * Get the appropriate auth provider for the current environment
 *
 * Build-time selection (tree-shaken):
 * - __IS_ELECTRON__ -> ElectronAuthProvider
 * - __IS_WEB__ -> SupabaseAuthProvider
 * - __IS_LOCAL__ -> LocalAuthProvider
 *
 * Runtime fallback (if build constants not set):
 * - VITE_ENVIRONMENT=electron -> ElectronAuthProvider
 * - VITE_ENVIRONMENT=web -> SupabaseAuthProvider
 * - VITE_ENVIRONMENT=local -> LocalAuthProvider
 */
export async function getAuthProvider(): Promise<AuthProvider> {
  // Return cached provider if already created
  if (cachedProvider) {
    return cachedProvider
  }

  console.log('[AuthFactory] Creating auth provider...')
  console.log('[AuthFactory] Build target:', typeof __BUILD_TARGET__ !== 'undefined' ? __BUILD_TARGET__ : 'unknown')
  console.log('[AuthFactory] Runtime env:', import.meta.env.VITE_ENVIRONMENT || 'unknown')

  let provider: AuthProvider

  // Build-time selection (preferred - allows tree-shaking)
  if (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) {
    console.log('[AuthFactory] Using Electron auth provider (build-time)')
    const { ElectronAuthProvider } = await import('./electron')
    provider = new ElectronAuthProvider()
  } else if (typeof __IS_WEB__ !== 'undefined' && __IS_WEB__) {
    console.log('[AuthFactory] Using Supabase auth provider (build-time)')
    const { SupabaseAuthProvider } = await import('./supabase')
    provider = new SupabaseAuthProvider()
  } else if (typeof __IS_LOCAL__ !== 'undefined' && __IS_LOCAL__) {
    console.log('[AuthFactory] Using local auth provider (build-time)')
    const { LocalAuthProvider } = await import('./local')
    provider = new LocalAuthProvider()
  }
  // Runtime fallback (for development and when build constants not set)
  else {
    const runtimeEnv = import.meta.env.VITE_ENVIRONMENT || 'local'
    console.log('[AuthFactory] Using runtime environment:', runtimeEnv)

    if (runtimeEnv === 'electron') {
      console.log('[AuthFactory] Using Electron auth provider (runtime)')
      const { ElectronAuthProvider } = await import('./electron')
      provider = new ElectronAuthProvider()
    } else if (runtimeEnv === 'web') {
      console.log('[AuthFactory] Using Supabase auth provider (runtime)')
      const { SupabaseAuthProvider } = await import('./supabase')
      provider = new SupabaseAuthProvider()
    } else {
      console.log('[AuthFactory] Using local auth provider (runtime)')
      const { LocalAuthProvider } = await import('./local')
      provider = new LocalAuthProvider()
    }
  }

  // Initialize the provider
  await provider.initialize()

  // Cache it
  cachedProvider = provider

  return provider
}

/**
 * Reset the cached provider (useful for testing)
 */
export function resetAuthProvider() {
  cachedProvider = null
}
