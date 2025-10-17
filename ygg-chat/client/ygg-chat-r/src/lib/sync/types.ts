// Sync provider types and interfaces

export interface SyncStatus {
  enabled: boolean
  lastSyncAt: string | null
  syncing: boolean
  error: string | null
}

/**
 * Sync Provider Interface
 *
 * Handles optional cloud synchronization of conversations and messages.
 */
export interface SyncProvider {
  /**
   * Check if sync is supported in this environment
   */
  isSupported(): boolean

  /**
   * Enable cloud sync
   * Requires user authentication
   */
  enableSync(): Promise<void>

  /**
   * Disable cloud sync
   */
  disableSync(): Promise<void>

  /**
   * Get current sync status
   */
  getStatus(): Promise<SyncStatus>

  /**
   * Manually trigger a sync
   */
  syncNow(): Promise<void>

  /**
   * Subscribe to sync status changes
   * Returns an unsubscribe function
   */
  onStatusChange(callback: (status: SyncStatus) => void): () => void
}
