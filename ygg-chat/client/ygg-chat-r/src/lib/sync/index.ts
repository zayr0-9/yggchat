/**
 * Sync Provider Factory
 *
 * Dynamically selects and creates the appropriate sync provider based on
 * build target and runtime environment.
 */

import type { SyncProvider } from './types'

// Re-export types for convenience
export type { SyncProvider, SyncStatus } from './types'

let cachedProvider: SyncProvider | null = null

/**
 * Get the appropriate sync provider for the current environment
 *
 * Build-time selection (tree-shaken):
 * - __IS_ELECTRON__ -> LocalSyncProvider (can be upgraded to Supabase)
 * - __IS_LOCAL__ -> LocalSyncProvider
 * - __IS_WEB__ -> SupabaseSyncProvider (always syncs)
 *
 * Runtime fallback (if build constants not set):
 * - VITE_ENVIRONMENT=electron -> LocalSyncProvider
 * - VITE_ENVIRONMENT=local -> LocalSyncProvider
 * - VITE_ENVIRONMENT=web -> SupabaseSyncProvider
 */
export async function getSyncProvider(): Promise<SyncProvider> {
  // Return cached provider if already created
  if (cachedProvider) {
    return cachedProvider
  }

  console.log('[SyncFactory] Creating sync provider...')
  console.log(
    '[SyncFactory] Build target:',
    typeof __BUILD_TARGET__ !== 'undefined' ? __BUILD_TARGET__ : 'unknown',
  )
  console.log('[SyncFactory] Runtime env:', import.meta.env.VITE_ENVIRONMENT || 'unknown')

  let provider: SyncProvider

  // Build-time selection (preferred - allows tree-shaking)
  if (typeof __IS_WEB__ !== 'undefined' && __IS_WEB__) {
    console.log('[SyncFactory] Using Supabase sync provider (build-time)')
    const { SupabaseSyncProvider } = await import('./supabase')
    provider = new SupabaseSyncProvider()
  } else if (
    (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) ||
    (typeof __IS_LOCAL__ !== 'undefined' && __IS_LOCAL__)
  ) {
    console.log('[SyncFactory] Using local-only sync provider (build-time)')
    const { LocalSyncProvider } = await import('./local')
    provider = new LocalSyncProvider()
  }
  // Runtime fallback (for development and when build constants not set)
  else {
    const runtimeEnv = import.meta.env.VITE_ENVIRONMENT || 'local'
    console.log('[SyncFactory] Using runtime environment:', runtimeEnv)

    if (runtimeEnv === 'web') {
      console.log('[SyncFactory] Using Supabase sync provider (runtime)')
      const { SupabaseSyncProvider } = await import('./supabase')
      provider = new SupabaseSyncProvider()
    } else {
      console.log('[SyncFactory] Using local-only sync provider (runtime)')
      const { LocalSyncProvider } = await import('./local')
      provider = new LocalSyncProvider()
    }
  }

  // Cache it
  cachedProvider = provider

  return provider
}

/**
 * Reset the cached provider (useful for testing)
 */
export function resetSyncProvider() {
  cachedProvider = null
}
