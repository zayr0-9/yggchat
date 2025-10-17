import type { SyncProvider, SyncStatus } from './types'

/**
 * Local-Only Sync Provider
 *
 * No cloud sync - all data stays local.
 * Used in local mode and Electron (when sync is disabled).
 */
export class LocalSyncProvider implements SyncProvider {
  private status: SyncStatus = {
    enabled: false,
    lastSyncAt: null,
    syncing: false,
    error: null,
  }

  private listeners: Set<(status: SyncStatus) => void> = new Set()

  isSupported(): boolean {
    return false
  }

  async enableSync(): Promise<void> {
    throw new Error('Cloud sync is not supported in local-only mode')
  }

  async disableSync(): Promise<void> {
    // Already disabled, no-op
    console.log('[LocalSync] Cloud sync is not enabled')
  }

  async getStatus(): Promise<SyncStatus> {
    return this.status
  }

  async syncNow(): Promise<void> {
    throw new Error('Cloud sync is not supported in local-only mode')
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
}
