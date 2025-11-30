// src/lib/sync/dualSyncManager.ts
// Manages syncing Railway server responses to local SQLite database in Electron mode

import { v4 as uuidv4 } from 'uuid'
import { environment } from '../../utils/api'

// Types for sync operations
export interface SyncOperation {
  id: string
  type:
    | 'user'
    | 'project'
    | 'conversation'
    | 'message'
    | 'attachment'
    | 'provider_cost'
    | 'research_note_update'
    | 'cwd_update'
  action: 'create' | 'update' | 'delete'
  data: any
  retryCount: number
  timestamp: number
  error?: string
}

export interface DualSyncStatus {
  enabled: boolean
  localServerAvailable: boolean
  queueLength: number
  lastSyncAt: string | null
  errors: Array<{ id: string; type: string; error: string; timestamp: number }>
}

const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000
const MAX_ERROR_LOG = 50

class DualSyncManager {
  private queue: SyncOperation[] = []
  private processing = false
  private enabled = false
  private localServerAvailable = false
  private lastSyncAt: string | null = null
  private errors: Array<{ id: string; type: string; error: string; timestamp: number }> = []
  private statusListeners: Array<(status: DualSyncStatus) => void> = []

  constructor() {
    // Only enable in Electron mode
    if (environment === 'electron') {
      this.checkLocalServer()
    }
  }

  // Check if local server is available
  private async checkLocalServer(): Promise<boolean> {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        const data = await response.json()
        this.localServerAvailable = data.status === 'ok'
        this.enabled = this.localServerAvailable
        console.log('[DualSync] Local server available:', this.localServerAvailable)
      } else {
        this.localServerAvailable = false
        this.enabled = false
      }
    } catch (error) {
      console.warn('[DualSync] Local server not available:', error)
      this.localServerAvailable = false
      this.enabled = false
    }
    this.notifyStatusChange()
    return this.localServerAvailable
  }

  // Enable/disable sync
  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.localServerAvailable
    console.log('[DualSync] Sync enabled:', this.enabled)
    this.notifyStatusChange()
  }

  // Get current status
  getStatus(): DualSyncStatus {
    return {
      enabled: this.enabled,
      localServerAvailable: this.localServerAvailable,
      queueLength: this.queue.length,
      lastSyncAt: this.lastSyncAt,
      errors: this.errors.slice(-10), // Last 10 errors
    }
  }

  // Subscribe to status changes
  onStatusChange(callback: (status: DualSyncStatus) => void): () => void {
    this.statusListeners.push(callback)
    return () => {
      this.statusListeners = this.statusListeners.filter(cb => cb !== callback)
    }
  }

  private notifyStatusChange(): void {
    const status = this.getStatus()
    this.statusListeners.forEach(cb => cb(status))
  }

  // Enqueue a sync operation
  enqueue(operation: Omit<SyncOperation, 'id' | 'retryCount' | 'timestamp'>): void {
    if (!this.enabled) {
      console.log('[DualSync] Sync disabled, skipping operation:', operation.type, operation.action)
      return
    }

    // NEW: Skip local-only records
    if (operation.data?.storage_mode === 'local') {
      console.log('[DualSync] Skipping local-only record:', operation.type, operation.data.id)
      return
    }

    const op: SyncOperation = {
      ...operation,
      id: uuidv4(),
      retryCount: 0,
      timestamp: Date.now(),
    }

    this.queue.push(op)
    console.log(`[DualSync] Enqueued ${op.type} ${op.action} operation (queue: ${this.queue.length})`)
    this.notifyStatusChange()

    // Process queue if not already processing
    if (!this.processing) {
      this.processQueue()
    }
  }

  // Process the queue
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return
    }

    this.processing = true

    while (this.queue.length > 0) {
      const operation = this.queue[0]

      try {
        await this.executeOperation(operation)
        // Success - remove from queue
        this.queue.shift()
        this.lastSyncAt = new Date().toISOString()
        console.log(`[DualSync] Successfully synced ${operation.type} ${operation.action}`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        operation.retryCount++
        operation.error = errorMsg

        if (operation.retryCount >= MAX_RETRIES) {
          // Max retries reached - log error and remove from queue
          console.error(`[DualSync] Failed to sync ${operation.type} after ${MAX_RETRIES} retries:`, errorMsg)
          this.errors.push({
            id: operation.id,
            type: operation.type,
            error: errorMsg,
            timestamp: Date.now(),
          })
          if (this.errors.length > MAX_ERROR_LOG) {
            this.errors = this.errors.slice(-MAX_ERROR_LOG)
          }
          this.queue.shift()
        } else {
          // Retry with delay
          console.warn(
            `[DualSync] Retry ${operation.retryCount}/${MAX_RETRIES} for ${operation.type} ${operation.action}:`,
            errorMsg
          )
          await this.sleep(RETRY_DELAY_MS * operation.retryCount)
        }
      }

      this.notifyStatusChange()
    }

    this.processing = false
  }

  private async executeOperation(operation: SyncOperation): Promise<void> {
    let endpoint: string
    let method: 'POST' | 'DELETE' | 'PATCH' = 'POST'

    switch (operation.type) {
      case 'user':
        endpoint = '/sync/user'
        break
      case 'project':
        if (operation.action === 'delete') {
          endpoint = `/sync/project/${operation.data.id}`
          method = 'DELETE'
        } else {
          endpoint = '/sync/project'
        }
        break
      case 'conversation':
        if (operation.action === 'delete') {
          endpoint = `/sync/conversation/${operation.data.id}`
          method = 'DELETE'
        } else {
          endpoint = '/sync/conversation'
        }
        break
      // Add specific handling for research notes if needed, though currently syncConversation handles full object update
      case 'message':
        if (operation.action === 'delete') {
          endpoint = `/sync/message/${operation.data.id}`
          method = 'DELETE'
        } else {
          endpoint = '/sync/message'
        }
        break
      case 'attachment':
        endpoint = '/sync/attachment'
        break
      case 'provider_cost':
        endpoint = '/sync/provider-cost'
        break
      case 'research_note_update':
        endpoint = `/conversations/${operation.data.id}/research-note`
        method = 'PATCH'
        break
      case 'cwd_update':
        endpoint = `/conversations/${operation.data.id}/cwd`
        method = 'PATCH'
        break
      default:
        throw new Error(`Unknown operation type: ${operation.type}`)
    }

    const response = await fetch(`${LOCAL_API_BASE}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: (method === 'POST' || method === 'PATCH') ? JSON.stringify(operation.data) : undefined,
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Convenience methods for syncing specific data types

  syncUser(userData: any): void {
    this.enqueue({
      type: 'user',
      action: 'create',
      data: userData,
    })
  }

  syncProject(projectData: any, action: 'create' | 'update' | 'delete' = 'create'): void {
    // Skip local-only projects
    if (projectData?.storage_mode === 'local') {
      console.log('[DualSync] Skipping local-only project:', projectData.id)
      return
    }

    this.enqueue({
      type: 'project',
      action,
      data: projectData,
    })
  }

  syncConversation(conversationData: any, action: 'create' | 'update' | 'delete' = 'create'): void {
    // Skip local-only conversations
    if (conversationData?.storage_mode === 'local') {
      console.log('[DualSync] Skipping local-only conversation:', conversationData.id)
      return
    }

    this.enqueue({
      type: 'conversation',
      action,
      data: conversationData,
    })
  }

  syncMessage(messageData: any, action: 'create' | 'update' | 'delete' = 'create'): void {
    this.enqueue({
      type: 'message',
      action,
      data: messageData,
    })
  }

  syncAttachment(attachmentData: any): void {
    this.enqueue({
      type: 'attachment',
      action: 'create',
      data: attachmentData,
    })
  }

  syncProviderCost(costData: any): void {
    this.enqueue({
      type: 'provider_cost',
      action: 'create',
      data: costData,
    })
  }

  syncResearchNote(data: { id: string; researchNote: string | null }): void {
    this.enqueue({
      type: 'research_note_update',
      action: 'update',
      data,
    })
  }

  syncCwd(data: { id: string; cwd: string | null }): void {
    this.enqueue({
      type: 'cwd_update',
      action: 'update',
      data,
    })
  }

  // Batch sync for efficiency
  async syncBatch(operations: Array<{ type: string; action: string; data: any }>): Promise<void> {
    if (!this.enabled) {
      console.log('[DualSync] Sync disabled, skipping batch operation')
      return
    }

    try {
      const response = await fetch(`${LOCAL_API_BASE}/sync/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ operations }),
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Batch sync failed: HTTP ${response.status}: ${errorText}`)
      }

      const result = await response.json()
      console.log(
        `[DualSync] Batch sync completed: ${result.results.filter((r: any) => r.success).length}/${operations.length} succeeded`
      )
      this.lastSyncAt = new Date().toISOString()
      this.notifyStatusChange()
    } catch (error) {
      console.error('[DualSync] Batch sync failed:', error)
      // Fall back to individual operations
      for (const op of operations) {
        this.enqueue({
          type: op.type as any,
          action: op.action as any,
          data: op.data,
        })
      }
    }
  }

  // Get sync stats from local server
  async getLocalStats(): Promise<any> {
    if (!this.localServerAvailable) {
      return null
    }

    try {
      const response = await fetch(`${LOCAL_API_BASE}/sync/stats`, {
        signal: AbortSignal.timeout(2000),
      })
      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      console.warn('[DualSync] Failed to get local stats:', error)
    }
    return null
  }

  // Check if a conversation exists locally
  async checkConversationExists(conversationId: string): Promise<boolean> {
    if (!this.enabled) return false

    try {
      const response = await fetch(`${LOCAL_API_BASE}/sync/conversation/${conversationId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      })

      if (response.ok) {
        const data = await response.json()
        return !!data.exists
      }
    } catch (error) {
      console.warn('[DualSync] Failed to check conversation existence:', error)
    }
    return false
  }

  // Check if a project exists locally
  async checkProjectExists(projectId: string): Promise<boolean> {
    if (!this.enabled) return false

    try {
      const response = await fetch(`${LOCAL_API_BASE}/sync/project/${projectId}`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      })

      if (response.ok) {
        const data = await response.json()
        return !!data.exists
      }
    } catch (error) {
      console.warn('[DualSync] Failed to check project existence:', error)
    }
    return false
  }

  // Clear error log
  clearErrors(): void {
    this.errors = []
    this.notifyStatusChange()
  }

  // Refresh local server availability
  async refresh(): Promise<void> {
    await this.checkLocalServer()
  }
}

// Singleton instance
let instance: DualSyncManager | null = null

export function getDualSyncManager(): DualSyncManager {
  if (!instance) {
    instance = new DualSyncManager()
  }
  return instance
}

// Convenience export
export const dualSync = {
  get manager() {
    return getDualSyncManager()
  },
  syncUser: (data: any) => getDualSyncManager().syncUser(data),
  syncProject: (data: any, action?: 'create' | 'update' | 'delete') => getDualSyncManager().syncProject(data, action),
  syncConversation: (data: any, action?: 'create' | 'update' | 'delete') =>
    getDualSyncManager().syncConversation(data, action),
  syncMessage: (data: any, action?: 'create' | 'update' | 'delete') => getDualSyncManager().syncMessage(data, action),
  syncAttachment: (data: any) => getDualSyncManager().syncAttachment(data),
  syncProviderCost: (data: any) => getDualSyncManager().syncProviderCost(data),
  syncResearchNote: (data: { id: string; researchNote: string | null }) => getDualSyncManager().syncResearchNote(data),
  syncCwd: (data: { id: string; cwd: string | null }) => getDualSyncManager().syncCwd(data),
  syncBatch: (operations: Array<{ type: string; action: string; data: any }>) =>
    getDualSyncManager().syncBatch(operations),
  checkConversationExists: (id: string) => getDualSyncManager().checkConversationExists(id),
  checkProjectExists: (id: string) => getDualSyncManager().checkProjectExists(id),
  getStatus: () => getDualSyncManager().getStatus(),
  setEnabled: (enabled: boolean) => getDualSyncManager().setEnabled(enabled),
  refresh: () => getDualSyncManager().refresh(),
}
