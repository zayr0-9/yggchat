import type { SyncProvider, SyncStatus } from './types'

/**
 * Supabase Sync Provider
 *
 * Implements cloud synchronization for conversations and messages.
 * (Placeholder implementation - full sync logic to be implemented later)
 */
export class SupabaseSyncProvider implements SyncProvider {
  private status: SyncStatus = {
    enabled: false,
    lastSyncAt: null,
    syncing: false,
    error: null,
  }

  private listeners: Set<(status: SyncStatus) => void> = new Set()
  private syncInterval: number | null = null

  isSupported(): boolean {
    return true
  }

  async enableSync(): Promise<void> {
    console.log('[SupabaseSync] Enabling cloud sync...')

    this.status.enabled = true
    this.status.error = null
    this.notifyListeners()

    // Start periodic sync (every 5 minutes)
    this.syncInterval = window.setInterval(() => {
      this.syncNow().catch((error) => {
        console.error('[SupabaseSync] Periodic sync failed:', error)
      })
    }, 5 * 60 * 1000)

    // Do initial sync
    await this.syncNow()
  }

  async disableSync(): Promise<void> {
    console.log('[SupabaseSync] Disabling cloud sync...')

    this.status.enabled = false
    this.notifyListeners()

    // Stop periodic sync
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  async getStatus(): Promise<SyncStatus> {
    return this.status
  }

  async syncNow(): Promise<void> {
    if (!this.status.enabled) {
      throw new Error('Sync is not enabled')
    }

    console.log('[SupabaseSync] Starting sync...')

    this.status.syncing = true
    this.status.error = null
    this.notifyListeners()

    try {
      // TODO: Implement actual sync logic
      // 1. Get local messages not yet synced
      // 2. Upload to Supabase
      // 3. Download new messages from Supabase
      // 4. Merge into local storage

      // Placeholder delay
      await new Promise((resolve) => setTimeout(resolve, 1000))

      this.status.lastSyncAt = new Date().toISOString()
      this.status.syncing = false
      this.notifyListeners()

      console.log('[SupabaseSync] Sync completed successfully')
    } catch (error) {
      console.error('[SupabaseSync] Sync failed:', error)

      this.status.syncing = false
      this.status.error = error instanceof Error ? error.message : 'Unknown error'
      this.notifyListeners()

      throw error
    }
  }

  onStatusChange(callback: (status: SyncStatus) => void): () => void {
    this.listeners.add(callback)

    // Immediately call with current status
    callback(this.status)

    // Return unsubscribe function
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyListeners() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.status)
      } catch (error) {
        console.error('[SupabaseSync] Error in listener:', error)
      }
    })
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.syncInterval !== null) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
    this.listeners.clear()
  }
}
