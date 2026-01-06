import { formatDistanceToNow } from 'date-fns'
import React, { useMemo, useState } from 'react'
import { useJobStats, useToolJobs } from '../../hooks/useToolJobs'
import { toolJobManager } from '../../services/ToolJobManager'
import { Button } from '../Button/button'

type ToolJobsModalProps = {
  isOpen: boolean
  onClose: () => void
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
  const { jobs, loading, error } = useToolJobs()
  const { stats, loading: statsLoading } = useJobStats()
  const [cancelling, setCancelling] = useState<Set<string>>(new Set())

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
    </div>
  )
}
