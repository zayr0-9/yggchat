import { useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, formatDistance } from 'date-fns'
import React, { useEffect, useMemo, useState } from 'react'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { useJobStats, useToolJobs } from '../../hooks/useToolJobs'
import type { PaginatedConversationsResponse } from '../../hooks/useQueries'
import { Job, toolJobManager } from '../../services/ToolJobManager'
import { Button } from '../Button/button'

type ToolJobsModalProps = {
  isOpen: boolean
  onClose: () => void
}

type JobDetailsModalProps = {
  job: Job | null
  conversationTitle?: string
  isOpen: boolean
  onClose: () => void
}

const formatElapsedTime = (startedAt: string | null): string => {
  if (!startedAt) return '—'
  return formatDistance(new Date(startedAt), new Date(), { includeSeconds: true })
}

const JobDetailsModal: React.FC<JobDetailsModalProps> = ({ job, conversationTitle, isOpen, onClose }) => {
  const [elapsedTime, setElapsedTime] = useState<string>('—')

  // Update elapsed time every second for running jobs
  useEffect(() => {
    if (!job?.startedAt || job.completedAt) {
      setElapsedTime(job?.startedAt ? formatElapsedTime(job.startedAt) : '—')
      return
    }

    const updateElapsed = () => setElapsedTime(formatElapsedTime(job.startedAt))
    updateElapsed()
    const interval = setInterval(updateElapsed, 1000)
    return () => clearInterval(interval)
  }, [job?.startedAt, job?.completedAt])

  if (!isOpen || !job) return null

  const statusColor = statusColors[job.status] || statusColors.pending

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200'>
      <div className='bg-white dark:bg-yBlack-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 p-6 w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300'>
        <div className='flex items-start justify-between gap-4 mb-4'>
          <div>
            <h3 className='text-xl font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-2'>
              <i className='bx bx-detail text-blue-500' aria-hidden='true'></i>
              Job Details
            </h3>
            <p className='text-sm text-neutral-600 dark:text-neutral-400 mt-1'>{job.toolName}</p>
          </div>
          <Button variant='outline2' size='medium' onClick={onClose}>
            <i className='bx bx-x text-lg' aria-hidden='true'></i>
            Close
          </Button>
        </div>

        <div className='overflow-y-auto flex-1 space-y-4 pr-1'>
          {/* Status & Priority */}
          <div className='grid grid-cols-2 gap-3'>
            <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
              <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-1'>Status</div>
              <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>{job.status}</span>
            </div>
            <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
              <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-1'>Priority</div>
              <span className='text-sm font-medium text-neutral-900 dark:text-neutral-50'>{job.priority}</span>
            </div>
          </div>

          {/* Time Info */}
          <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
            <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2'>Timing</div>
            <div className='grid grid-cols-2 gap-2 text-sm'>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Created: </span>
                <span className='text-neutral-900 dark:text-neutral-50'>
                  {job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}
                </span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Started: </span>
                <span className='text-neutral-900 dark:text-neutral-50'>
                  {job.startedAt ? new Date(job.startedAt).toLocaleString() : '—'}
                </span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Completed: </span>
                <span className='text-neutral-900 dark:text-neutral-50'>
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}
                </span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Elapsed: </span>
                <span className={`font-medium ${job.status === 'running' ? 'text-blue-500' : 'text-neutral-900 dark:text-neutral-50'}`}>
                  {elapsedTime}
                </span>
              </div>
            </div>
          </div>

          {/* Conversation & Message */}
          <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
            <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2'>Context</div>
            <div className='space-y-2 text-sm'>
              {conversationTitle && (
                <div>
                  <span className='text-neutral-600 dark:text-neutral-400'>Conversation: </span>
                  <span className='text-neutral-900 dark:text-neutral-50'>{conversationTitle}</span>
                </div>
              )}
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Conversation ID: </span>
                <span className='text-neutral-900 dark:text-neutral-50 font-mono text-xs'>{job.conversationId || '—'}</span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Message ID: </span>
                <span className='text-neutral-900 dark:text-neutral-50 font-mono text-xs'>{job.messageId || '—'}</span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Stream ID: </span>
                <span className='text-neutral-900 dark:text-neutral-50 font-mono text-xs'>{job.streamId || '—'}</span>
              </div>
            </div>
          </div>

          {/* Tool Input */}
          <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
            <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1'>
              <i className='bx bx-right-arrow-alt' aria-hidden='true'></i>
              Tool Input (Args)
            </div>
            <pre className='text-xs bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto text-neutral-800 dark:text-neutral-200'>
              {JSON.stringify(job.args, null, 2)}
            </pre>
          </div>

          {/* Tool Output */}
          <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
            <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2 flex items-center gap-1'>
              <i className='bx bx-left-arrow-alt' aria-hidden='true'></i>
              Tool Output (Result)
            </div>
            {job.result !== null ? (
              <pre className='text-xs bg-neutral-100 dark:bg-neutral-800 rounded-lg p-3 overflow-x-auto max-h-48 overflow-y-auto text-neutral-800 dark:text-neutral-200'>
                {typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2)}
              </pre>
            ) : (
              <div className='text-sm text-neutral-500 dark:text-neutral-400 italic'>
                {job.status === 'running' || job.status === 'pending' ? 'Job still in progress...' : 'No result'}
              </div>
            )}
          </div>

          {/* Error (if any) */}
          {job.error && (
            <div className='rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50/80 dark:bg-rose-900/20 p-3'>
              <div className='text-xs text-rose-500 dark:text-rose-400 mb-2 flex items-center gap-1'>
                <i className='bx bx-error-circle' aria-hidden='true'></i>
                Error
              </div>
              <pre className='text-xs bg-rose-100 dark:bg-rose-900/40 rounded-lg p-3 overflow-x-auto max-h-32 overflow-y-auto text-rose-800 dark:text-rose-200'>
                {job.error}
              </pre>
            </div>
          )}

          {/* Progress */}
          {(job.status === 'running' || job.status === 'pending') && (
            <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
              <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2'>Progress</div>
              <div className='flex items-center gap-3'>
                <div className='flex-1'>
                  <ProgressBar value={job.progress ?? 0} status={job.status} />
                </div>
                <span className='text-sm font-medium text-neutral-900 dark:text-neutral-50'>{job.progress ?? 0}%</span>
              </div>
              {job.progressMessage && (
                <div className='text-xs text-neutral-600 dark:text-neutral-300 mt-2'>{job.progressMessage}</div>
              )}
            </div>
          )}

          {/* Job ID & Metadata */}
          <div className='rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3'>
            <div className='text-xs text-neutral-500 dark:text-neutral-400 mb-2'>Identifiers</div>
            <div className='space-y-1 text-sm'>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Job ID: </span>
                <span className='text-neutral-900 dark:text-neutral-50 font-mono text-xs'>{job.id}</span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Retries: </span>
                <span className='text-neutral-900 dark:text-neutral-50'>
                  {job.retriesRemaining}/{job.retries}
                </span>
              </div>
              <div>
                <span className='text-neutral-600 dark:text-neutral-400'>Timeout: </span>
                <span className='text-neutral-900 dark:text-neutral-50'>{job.timeoutMs}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200',
}

const ProgressBar: React.FC<{ value: number; status: string }> = ({ value, status }) => {
  const pct = Math.min(100, Math.max(0, value || 0))
  const color =
    status === 'failed'
      ? 'bg-rose-500'
      : status === 'completed'
        ? 'bg-emerald-500'
        : status === 'running'
          ? 'bg-blue-500'
          : 'bg-amber-500'

  return (
    <div className='w-full h-2 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden'>
      <div className={`${color} h-full transition-all duration-200`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export const ToolJobsModal: React.FC<ToolJobsModalProps> = ({ isOpen, onClose }) => {
  const queryClient = useQueryClient()
  const { jobs, loading, error } = useToolJobs()
  const { stats, loading: statsLoading } = useJobStats()
  const [cancelling, setCancelling] = useState<Set<string>>(new Set())
  const [selectedJobDetails, setSelectedJobDetails] = useState<Job | null>(null)
  const [conversationTitle, setConversationTitle] = useState<string | undefined>(undefined)
  const [detailsLoading, setDetailsLoading] = useState(false)

  // Look up conversation title from React Query cache
  const findConversationTitle = (conversationId: string | null): string | undefined => {
    if (!conversationId) return undefined

    // Search all cached conversation lists
    const allConversationQueries = queryClient.getQueriesData<
      Conversation[] | { pages: PaginatedConversationsResponse[] }
    >({ queryKey: ['conversations'] })

    for (const [, data] of allConversationQueries) {
      let conversations: Conversation[] = []

      // Handle both flat arrays and infinite query pages
      if (Array.isArray(data)) {
        conversations = data
      } else if (data && typeof data === 'object' && 'pages' in data) {
        conversations = data.pages.flatMap(page => page.conversations)
      }

      const match = conversations.find(c => String(c.id) === String(conversationId))
      if (match?.title) {
        return match.title
      }
    }

    return undefined
  }

  const handleViewDetails = async (jobId: string) => {
    setDetailsLoading(true)
    try {
      const fullJob = await toolJobManager.getJob(jobId)
      setSelectedJobDetails(fullJob)
      // Look up conversation title
      const title = findConversationTitle(fullJob?.conversationId ?? null)
      setConversationTitle(title)
    } catch (err) {
      console.error('[ToolJobsModal] Failed to fetch job details:', err)
    } finally {
      setDetailsLoading(false)
    }
  }

  const handleCloseDetails = () => {
    setSelectedJobDetails(null)
    setConversationTitle(undefined)
  }

  const handleCancel = async (jobId: string) => {
    setCancelling(prev => new Set(prev).add(jobId))
    try {
      await toolJobManager.cancelJob(jobId)
    } catch (err) {
      console.error('[ToolJobsModal] Cancel failed:', err)
    } finally {
      setCancelling(prev => {
        const next = new Set(prev)
        next.delete(jobId)
        return next
      })
    }
  }

  const runningJobs = useMemo(() => jobs.filter(j => j.status === 'running' || j.status === 'pending'), [jobs])

  if (!isOpen) return null

  return (
    <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200'>
      <div className='bg-white dark:bg-yBlack-900 rounded-2xl shadow-2xl border border-neutral-200 dark:border-neutral-800 p-6 w-full max-w-5xl mx-4 animate-in slide-in-from-bottom-4 duration-300'>
        <div className='flex items-start justify-between gap-4 mb-4'>
          <div>
            <h2 className='text-2xl font-semibold text-neutral-900 dark:text-neutral-50'>Tool Jobs</h2>
            <p className='text-sm text-neutral-600 dark:text-neutral-400'>Live status from the orchestrator</p>
          </div>
          <div className='flex items-center gap-2'>
            <div className='flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'>
              <span className='w-2 h-2 rounded-full bg-emerald-500 animate-pulse' aria-hidden='true'></span>
              Live
            </div>
            <Button variant='outline2' size='medium' onClick={onClose}>
              <i className='bx bx-x text-lg' aria-hidden='true'></i>
              Close
            </Button>
          </div>
        </div>

        <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-5'>
          {['pending', 'running', 'completed', 'failed'].map(key => {
            const value = statsLoading ? '—' : (stats?.[key as keyof typeof stats] ?? 0)
            const labels: Record<string, string> = {
              pending: 'Pending',
              running: 'Running',
              completed: 'Completed',
              failed: 'Failed',
            }
            const badge = statusColors[key] || 'bg-neutral-200 text-neutral-700'
            return (
              <div
                key={key}
                className='rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3 flex items-center gap-3'
              >
                <div className={`px-3 py-1 rounded-full text-xs font-medium ${badge}`}>{labels[key]}</div>
                <div className='text-xl font-semibold text-neutral-900 dark:text-neutral-50'>{value}</div>
              </div>
            )
          })}
          <div className='rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/60 p-3 flex items-center gap-3'>
            <div className='px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200'>
              Active workers
            </div>
            <div className='text-xl font-semibold text-neutral-900 dark:text-neutral-50'>
              {statsLoading ? '—' : (stats?.activeWorkers ?? 0)}
            </div>
          </div>
        </div>

        {error ? <div className='mb-4 text-sm text-rose-500'>Failed to load jobs: {error.message}</div> : null}

        {loading && jobs.length === 0 ? (
          <div className='flex items-center gap-2 text-neutral-600 dark:text-neutral-300 text-sm mb-2'>
            <i className='bx bx-loader-alt bx-spin text-lg' aria-hidden='true'></i>
            Loading jobs...
          </div>
        ) : null}

        <div className='space-y-3 max-h-[60vh] overflow-y-auto pr-1'>
          {jobs.length === 0 ? (
            <div className='text-neutral-600 dark:text-neutral-300 text-sm flex items-center gap-2'>
              <i className='bx bx-check-circle text-lg text-emerald-500' aria-hidden='true'></i>
              No jobs yet. Trigger a tool to see it here.
            </div>
          ) : (
            jobs.map(job => {
              const color = statusColors[job.status] || statusColors.pending
              const started = job.startedAt ? formatDistanceToNow(new Date(job.startedAt), { addSuffix: true }) : '—'
              const created = job.createdAt ? formatDistanceToNow(new Date(job.createdAt), { addSuffix: true }) : '—'
              const duration =
                job.startedAt && job.completedAt
                  ? `${Math.max(0, Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000))}s`
                  : job.startedAt && !job.completedAt
                    ? 'In progress'
                    : '—'
              const canCancel = !['completed', 'failed', 'cancelled'].includes(job.status)

              return (
                <div
                  key={job.id}
                  className='rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/70 dark:bg-neutral-900/80 p-4 shadow-sm'
                >
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='flex flex-col gap-1'>
                      <div className='flex items-center gap-2'>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${color}`}>{job.status}</span>
                        <span className='text-sm text-neutral-600 dark:text-neutral-400'>Priority {job.priority}</span>
                      </div>
                      <div className='text-base font-semibold text-neutral-900 dark:text-neutral-50'>
                        {job.toolName}
                      </div>
                      <div className='text-xs text-neutral-500 dark:text-neutral-400'>
                        Created {created} {started !== '—' ? `· Started ${started}` : ''} · {duration}
                      </div>
                      {job.progressMessage ? (
                        <div className='text-xs text-neutral-600 dark:text-neutral-300'>{job.progressMessage}</div>
                      ) : null}
                    </div>
                    <div className='flex flex-col items-end gap-2 text-xs text-neutral-500 dark:text-neutral-400 break-all'>
                      <div className='text-right'>
                        <div>ID: {job.id}</div>
                        {job.conversationId ? <div>Conversation: {job.conversationId}</div> : null}
                        {job.error ? <div className='text-rose-500 mt-1'>Error: {job.error}</div> : null}
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='outline2'
                          size='small'
                          className='px-3'
                          disabled={detailsLoading}
                          onClick={() => handleViewDetails(job.id)}
                        >
                          <i className='bx bx-detail mr-1' aria-hidden='true'></i>
                          Details
                        </Button>
                        {canCancel && (
                          <Button
                            variant='outline2'
                            size='small'
                            className='px-3'
                            disabled={cancelling.has(job.id)}
                            onClick={() => handleCancel(job.id)}
                          >
                            {cancelling.has(job.id) ? (
                              <>
                                <i className='bx bx-loader-alt bx-spin mr-1' aria-hidden='true'></i>
                                Stopping
                              </>
                            ) : (
                              <>
                                <i className='bx bx-stop mr-1' aria-hidden='true'></i>
                                Stop
                              </>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className='mt-3'>
                    <ProgressBar value={job.progress ?? 0} status={job.status} />
                  </div>
                </div>
              )
            })
          )}
        </div>

        {runningJobs.length > 0 ? (
          <div className='mt-4 text-xs text-neutral-500 dark:text-neutral-400'>
            {runningJobs.length} job{runningJobs.length === 1 ? '' : 's'} running or pending.
          </div>
        ) : null}
      </div>

      {/* Job Details Modal */}
      <JobDetailsModal
        job={selectedJobDetails}
        conversationTitle={conversationTitle}
        isOpen={selectedJobDetails !== null}
        onClose={handleCloseDetails}
      />
    </div>
  )
}
