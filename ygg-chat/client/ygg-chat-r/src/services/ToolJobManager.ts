/**
 * Tool Job Manager
 *
 * Client-side singleton service for managing background tool jobs.
 * Survives React component remounts - provides a stable interface for:
 * - Submitting jobs to the orchestrator
 * - Querying job status
 * - Subscribing to real-time job updates via WebSocket
 *
 * This service is independent of React lifecycle and maintains its own state.
 */

// Types mirrored from server (electron/tools/orchestrator/types.ts)
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type JobPriority = 'low' | 'normal' | 'high' | 'critical'

export interface JobOptions {
  priority?: JobPriority
  timeoutMs?: number
  retries?: number
  retryDelayMs?: number
  rootPath?: string | null
  operationMode?: 'plan' | 'execute'
  metadata?: Record<string, any>
  conversationId?: string | null
  messageId?: string | null
  streamId?: string | null
}

export interface Job {
  id: string
  toolName: string
  args: Record<string, any>
  status: JobStatus
  priority: JobPriority
  rootPath: string | null
  operationMode: 'plan' | 'execute'
  timeoutMs: number
  retries: number
  retriesRemaining: number
  retryDelayMs: number
  metadata: Record<string, any>
  conversationId: string | null
  messageId: string | null
  streamId: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  result: any | null
  error: string | null
  progress: number
  progressMessage: string | null
}

export interface JobSummary {
  id: string
  toolName: string
  status: JobStatus
  priority: JobPriority
  progress: number
  progressMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  conversationId: string | null
  error: string | null
}

export interface JobFilter {
  status?: JobStatus | JobStatus[]
  conversationId?: string
  toolName?: string
  limit?: number
  offset?: number
  orderBy?: 'createdAt' | 'priority' | 'status'
  orderDir?: 'asc' | 'desc'
}

export interface JobEvent {
  type: 'job_created' | 'job_started' | 'job_progress' | 'job_completed' | 'job_failed' | 'job_cancelled'
  job: JobSummary
  timestamp: string
}

export interface OrchestratorStats {
  pending: number
  running: number
  completed: number
  failed: number
  cancelled: number
  total: number
  concurrencyLimit: number
  activeWorkers: number
}

type JobEventListener = (event: JobEvent) => void
type JobsChangeListener = (jobs: JobSummary[]) => void

const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'
const WS_URL = 'ws://127.0.0.1:3002/ide-context?type=frontend&id=job-manager'

class ToolJobManager {
  private static instance: ToolJobManager | null = null

  // In-memory cache of jobs
  private jobs: Map<string, JobSummary> = new Map()
  private cachedJobs: JobSummary[] = []
  private cachedRunning: JobSummary[] = []

  // WebSocket connection
  private ws: WebSocket | null = null
  private wsConnected = false
  private wsReconnectTimer: number | null = null
  private wsReconnectAttempts = 0
  private readonly maxReconnectAttempts = 10
  private readonly reconnectDelayMs = 2000

  // Event listeners
  private eventListeners: Set<JobEventListener> = new Set()
  private changeListeners: Set<JobsChangeListener> = new Set()

  // Initialization state
  private initialized = false
  private initializing = false

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): ToolJobManager {
    if (!ToolJobManager.instance) {
      ToolJobManager.instance = new ToolJobManager()
    }
    return ToolJobManager.instance
  }

  /**
   * Initialize the manager (connect WebSocket, load initial jobs)
   */
  async initialize(): Promise<void> {
    if (this.initialized || this.initializing) return

    this.initializing = true

    try {
      // Load initial jobs from server
      await this.refreshJobs()

      // Connect WebSocket for real-time updates
      this.connectWebSocket()

      this.initialized = true
    } catch (error) {
      console.error('[ToolJobManager] Initialization failed:', error)
    } finally {
      this.initializing = false
    }
  }

  /**
   * Connect to WebSocket for real-time job events
   */
  private connectWebSocket(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return
    }

    try {
      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        this.wsConnected = true
        this.wsReconnectAttempts = 0

        // Subscribe to job events
        this.ws?.send(JSON.stringify({ type: 'subscribe_jobs' }))
      }

      this.ws.onmessage = event => {
        try {
          const message = JSON.parse(event.data)

          if (message.type === 'job_event') {
            this.handleJobEvent(message.data as JobEvent)
          }
        } catch (error) {
          console.error('[ToolJobManager] Failed to parse WebSocket message:', error)
        }
      }

      this.ws.onclose = () => {
        this.wsConnected = false
        this.scheduleReconnect()
      }

      this.ws.onerror = error => {
        console.error('[ToolJobManager] WebSocket error:', error)
      }
    } catch (error) {
      console.error('[ToolJobManager] Failed to connect WebSocket:', error)
      this.scheduleReconnect()
    }
  }

  /**
   * Schedule WebSocket reconnection
   */
  private scheduleReconnect(): void {
    if (this.wsReconnectTimer) return
    if (this.wsReconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[ToolJobManager] Max reconnect attempts reached')
      return
    }

    this.wsReconnectAttempts++
    const delay = this.reconnectDelayMs * Math.min(this.wsReconnectAttempts, 5)

    this.wsReconnectTimer = window.setTimeout(() => {
      this.wsReconnectTimer = null
      this.connectWebSocket()
    }, delay)
  }

  /**
   * Handle incoming job event
   */
  private handleJobEvent(event: JobEvent): void {
    // Update local cache
    this.jobs.set(event.job.id, event.job)

    // Notify event listeners
    for (const listener of this.eventListeners) {
      try {
        listener(event)
      } catch (error) {
        console.error('[ToolJobManager] Event listener error:', error)
      }
    }

    // Notify change listeners
    this.notifyChangeListeners()
  }

  /**
   * Notify all change listeners with current jobs
   */
  private notifyChangeListeners(): void {
    this.cachedJobs = Array.from(this.jobs.values())
    this.cachedRunning = this.cachedJobs.filter(j => j.status === 'pending' || j.status === 'running')
    for (const listener of this.changeListeners) {
      try {
        listener(this.cachedJobs)
      } catch (error) {
        console.error('[ToolJobManager] Change listener error:', error)
      }
    }
  }

  /**
   * Refresh jobs from server
   */
  async refreshJobs(filter?: JobFilter): Promise<JobSummary[]> {
    try {
      const params = new URLSearchParams()
      if (filter?.status) {
        params.set('status', Array.isArray(filter.status) ? filter.status.join(',') : filter.status)
      }
      if (filter?.conversationId) params.set('conversationId', filter.conversationId)
      if (filter?.toolName) params.set('toolName', filter.toolName)
      if (filter?.limit) params.set('limit', String(filter.limit))
      if (filter?.offset) params.set('offset', String(filter.offset))
      if (filter?.orderBy) params.set('orderBy', filter.orderBy)
      if (filter?.orderDir) params.set('orderDir', filter.orderDir)

      const url = `${LOCAL_API_BASE}/jobs${params.toString() ? '?' + params.toString() : ''}`
      const response = await fetch(url)
      const data = await response.json()

      if (data.success && data.jobs) {
        // Update cache
        for (const job of data.jobs) {
          this.jobs.set(job.id, job)
        }
        this.notifyChangeListeners()
        return data.jobs
      }

      throw new Error(data.error || 'Failed to fetch jobs')
    } catch (error) {
      console.error('[ToolJobManager] Failed to refresh jobs:', error)
      throw error
    }
  }

  /**
   * Submit a new job
   */
  async submitJob(toolName: string, args: Record<string, any>, options?: JobOptions): Promise<Job> {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, args, options }),
      })

      const data = await response.json()

      if (data.success && data.job) {
        // Add to local cache
        this.jobs.set(data.job.id, {
          id: data.job.id,
          toolName: data.job.toolName,
          status: data.job.status,
          priority: data.job.priority,
          progress: data.job.progress,
          progressMessage: data.job.progressMessage,
          createdAt: data.job.createdAt,
          startedAt: data.job.startedAt,
          completedAt: data.job.completedAt,
          conversationId: data.job.conversationId,
          error: data.job.error,
        })
        this.notifyChangeListeners()
        return data.job
      }

      throw new Error(data.error || 'Failed to submit job')
    } catch (error) {
      console.error('[ToolJobManager] Failed to submit job:', error)
      throw error
    }
  }

  /**
   * Get a specific job
   */
  async getJob(jobId: string): Promise<Job | null> {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}`)
      const data = await response.json()

      if (data.success && data.job) {
        return data.job
      }

      if (response.status === 404) {
        return null
      }

      throw new Error(data.error || 'Failed to get job')
    } catch (error) {
      console.error('[ToolJobManager] Failed to get job:', error)
      throw error
    }
  }

  /**
   * Cancel a job
   */
  async cancelJob(jobId: string): Promise<boolean> {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/jobs/${jobId}/cancel`, {
        method: 'POST',
      })

      const data = await response.json()
      return data.success === true
    } catch (error) {
      console.error('[ToolJobManager] Failed to cancel job:', error)
      return false
    }
  }

  /**
   * Get orchestrator statistics
   */
  async getStats(): Promise<OrchestratorStats> {
    try {
      const response = await fetch(`${LOCAL_API_BASE}/jobs/stats`)
      const data = await response.json()

      if (data.success && data.stats) {
        return data.stats
      }

      throw new Error(data.error || 'Failed to get stats')
    } catch (error) {
      console.error('[ToolJobManager] Failed to get stats:', error)
      throw error
    }
  }

  /**
   * Get all cached jobs
   */
  getJobs(): JobSummary[] {
    return this.cachedJobs
  }

  /**
   * Get jobs by status
   */
  getJobsByStatus(status: JobStatus | JobStatus[]): JobSummary[] {
    const statuses = Array.isArray(status) ? status : [status]
    return this.cachedJobs.filter(j => statuses.includes(j.status))
  }

  /**
   * Get running jobs
   */
  getRunningJobs(): JobSummary[] {
    return this.cachedRunning
  }

  /**
   * Subscribe to job events
   */
  onJobEvent(listener: JobEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  /**
   * Subscribe to jobs list changes
   */
  onJobsChange(listener: JobsChangeListener): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  /**
   * Check if connected to server
   */
  isConnected(): boolean {
    return this.wsConnected
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    if (this.wsReconnectTimer) {
      clearTimeout(this.wsReconnectTimer)
      this.wsReconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    this.wsConnected = false
    this.initialized = false
  }
}

// Export singleton instance
export const toolJobManager = ToolJobManager.getInstance()

// Auto-initialize when imported (but don't block) - skip in web mode (electron only)
if (typeof window !== 'undefined' && import.meta.env.VITE_ENVIRONMENT !== 'web') {
  // Delay initialization slightly to let the app settle
  setTimeout(() => {
    toolJobManager.initialize().catch(console.error)
  }, 1000)
}
