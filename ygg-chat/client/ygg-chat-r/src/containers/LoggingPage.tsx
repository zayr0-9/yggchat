import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type LoggingFilters, useCloudLoggingAnalytics, useLocalLoggingAnalytics } from '../hooks/useLoggingAnalytics'
import { environment } from '../utils/api'

const RANGE_OPTIONS = [7, 30, 90]

type StorageView = 'cloud' | 'local'

const integerFormatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

const formatNumber = (value: number | null | undefined, digits = 2): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return value.toLocaleString(undefined, { maximumFractionDigits: digits })
}

const formatPercent = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${value.toFixed(2)}%`
}

const panelClass =
  'rounded-xl border border-neutral-200/80 dark:border-neutral-700/90 bg-white/95 dark:bg-neutral-900/98 backdrop-blur-2xl text-neutral-900 dark:text-neutral-100 shadow-sm dark:shadow-black/30'

const LoggingPage: React.FC = () => {
  const navigate = useNavigate()
  const supportsLocal = environment === 'electron'

  const [storageView, setStorageView] = useState<StorageView>('cloud')
  const [filters, setFilters] = useState<LoggingFilters>({
    rangeDays: 30,
    projectId: null,
    conversationId: null,
    model: null,
    providerRunStatus: null,
    toolName: null,
    toolStatus: null,
  })

  const cloudQuery = useCloudLoggingAnalytics(filters)
  const localQuery = useLocalLoggingAnalytics(filters, supportsLocal && storageView === 'local')

  const activeQuery = storageView === 'local' ? localQuery : cloudQuery
  const data = activeQuery.data

  const setFilter = <K extends keyof LoggingFilters>(key: K, value: LoggingFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  const cards = useMemo(() => {
    if (!data) return []
    return [
      { label: 'Net Credits Consumed', value: formatNumber(data.summary.netCreditsConsumed) },
      { label: 'Messages', value: integerFormatter.format(data.summary.messagesTotal || 0) },
      { label: 'Conversations', value: integerFormatter.format(data.summary.conversationsCreated || 0) },
      { label: 'Projects', value: integerFormatter.format(data.summary.projectsCreated || 0) },
      { label: 'Active Days', value: integerFormatter.format(data.summary.activeDays || 0) },
      {
        label: 'Avg Credits / Generation',
        value: formatNumber(data.summary.averageCreditsPerGeneration),
      },
      {
        label: 'Avg Credits / Assistant Msg',
        value: formatNumber(data.summary.averageCreditsPerAssistantMessage),
      },
      {
        label: 'Assistant Cost Coverage',
        value: formatPercent(data.dataQuality.assistantMessagesWithCostPct),
      },
    ]
  }, [data])

  const isLoading = activeQuery.isLoading
  const error = activeQuery.error instanceof Error ? activeQuery.error.message : null

  const available = data?.filters.available
  const selectedProject = filters.projectId || ''
  const selectedConversation = filters.conversationId || ''
  const selectedModel = filters.model || ''
  const selectedStatus = filters.providerRunStatus || ''
  const selectedToolName = filters.toolName || ''
  const selectedToolStatus = filters.toolStatus || ''

  const spendRows = (data?.spend.daily || []) as Array<Record<string, unknown>>
  const topModels = (data?.models.topByCredits || []) as Array<Record<string, unknown>>
  const monthlyAllocation = data?.payments.history.monthlyAllocation || []
  const topups = data?.payments.history.topups || []

  return (
    <div className='h-full overflow-y-auto min-h-full'>
      <div className='max-w-7xl mx-auto px-4 py-8 space-y-6'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h1 className='text-3xl font-bold text-neutral-900 dark:text-neutral-100'>Usage Logging</h1>
            <p className='text-sm text-neutral-600 dark:text-neutral-300'>
              Track spend, model behavior, run health, and activity metrics.
            </p>
          </div>
          <button
            type='button'
            onClick={() => navigate('/homepage')}
            className='px-4 py-2 rounded-lg bg-neutral-100 text-white dark:bg-neutral-800 dark:text-neutral-100 dark:border dark:border-neutral-700 text-sm font-medium'
          >
            Back Home
          </button>
        </div>

        <div className={`${panelClass} p-4`}>
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3'>
            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Range</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={filters.rangeDays}
                onChange={e => setFilter('rangeDays', Number(e.target.value))}
              >
                {RANGE_OPTIONS.map(day => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={day}
                    value={day}
                  >
                    Last {day} days
                  </option>
                ))}
              </select>
            </label>

            {supportsLocal && (
              <label className='flex flex-col text-xs gap-1'>
                <span className='text-neutral-500 dark:text-neutral-400'>Storage</span>
                <select
                  className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                  value={storageView}
                  onChange={e => setStorageView(e.target.value as StorageView)}
                >
                  <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value='cloud'>
                    Cloud
                  </option>
                  <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value='local'>
                    Local
                  </option>
                </select>
              </label>
            )}

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Project</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedProject}
                onChange={e => {
                  const value = e.target.value || null
                  setFilters(prev => ({ ...prev, projectId: value, conversationId: null }))
                }}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {available?.projects.map(project => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={project.id}
                    value={project.id}
                  >
                    {project.name}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Conversation</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedConversation}
                onChange={e => setFilter('conversationId', e.target.value || null)}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {available?.conversations.map(conversation => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={conversation.id}
                    value={conversation.id}
                  >
                    {conversation.title || conversation.id}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Model</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedModel}
                onChange={e => setFilter('model', e.target.value || null)}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {available?.models.map(model => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={model}
                    value={model}
                  >
                    {model}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Run Status</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedStatus}
                onChange={e => setFilter('providerRunStatus', e.target.value || null)}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {(available?.providerRunStatuses || []).map(status => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={status}
                    value={status}
                  >
                    {status}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Tool Name</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedToolName}
                onChange={e => setFilter('toolName', e.target.value || null)}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {(available?.toolNames || []).map(toolName => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={toolName}
                    value={toolName}
                  >
                    {toolName}
                  </option>
                ))}
              </select>
            </label>

            <label className='flex flex-col text-xs gap-1'>
              <span className='text-neutral-500 dark:text-neutral-400'>Tool Job Status</span>
              <select
                className='appearance-none px-3 py-2 rounded-xl border border-neutral-300/90 dark:border-neutral-700/90 bg-white/90 dark:bg-neutral-900/95 backdrop-blur-md text-sm text-neutral-900 dark:text-neutral-100 dark:[color-scheme:dark] shadow-sm'
                value={selectedToolStatus}
                onChange={e => setFilter('toolStatus', e.target.value || null)}
              >
                <option className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100' value=''>
                  All
                </option>
                {(available?.toolJobStatuses || []).map(status => (
                  <option
                    className='bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100'
                    key={status}
                    value={status}
                  >
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {isLoading && (
          <div className={`${panelClass} p-6 text-sm text-neutral-600 dark:text-neutral-300`}>Loading analytics…</div>
        )}

        {error && (
          <div className='rounded-xl border border-rose-300 dark:border-rose-700 bg-rose-50/80 dark:bg-rose-900/20 p-4 text-sm text-rose-800 dark:text-rose-200'>
            {error}
          </div>
        )}

        {!isLoading && !error && data && (
          <>
            <div className='grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3'>
              {cards.map(card => (
                <div key={card.label} className={`${panelClass} p-4`}>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>{card.label}</p>
                  <p className='text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mt-1'>{card.value}</p>
                </div>
              ))}
            </div>

            <div className='grid grid-cols-1 xl:grid-cols-2 gap-4'>
              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Spend Timeline</h2>
                <p className='text-xs text-neutral-500 dark:text-neutral-400 mb-3'>
                  Latest {spendRows.length} day buckets
                </p>
                <div className='overflow-auto max-h-80'>
                  <table className='w-full text-xs'>
                    <thead>
                      <tr className='text-left text-neutral-500 dark:text-neutral-300'>
                        <th className='py-1 pr-2'>Date</th>
                        <th className='py-1 pr-2'>Net</th>
                        <th className='py-1 pr-2'>Usage</th>
                        <th className='py-1 pr-2'>Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spendRows.slice(-20).map(row => {
                        const date = String(row.date || 'unknown')
                        const net = Number(row.netCreditsConsumed ?? row.apiCredits ?? 0)
                        const usage = Number(row.apiCredits ?? row.netCreditsConsumed ?? 0)
                        const refund = Number(row.refundCredits ?? 0)
                        return (
                          <tr key={date} className='border-t border-neutral-100 dark:border-neutral-800'>
                            <td className='py-1 pr-2'>{date}</td>
                            <td className='py-1 pr-2'>{formatNumber(net)}</td>
                            <td className='py-1 pr-2'>{formatNumber(usage)}</td>
                            <td className='py-1 pr-2'>{formatNumber(refund)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Top Models</h2>
                <p className='text-xs text-neutral-500 dark:text-neutral-400 mb-3'>By credits in selected range</p>
                <div className='overflow-auto max-h-80'>
                  <table className='w-full text-xs'>
                    <thead>
                      <tr className='text-left text-neutral-500 dark:text-neutral-400'>
                        <th className='py-1 pr-2'>Model</th>
                        <th className='py-1 pr-2'>Runs</th>
                        <th className='py-1 pr-2'>Total Credits</th>
                        <th className='py-1 pr-2'>Avg Credits</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topModels.slice(0, 15).map(model => (
                        <tr key={String(model.model)} className='border-t border-neutral-100 dark:border-neutral-800'>
                          <td className='py-1 pr-2'>{String(model.model || 'unknown')}</td>
                          <td className='py-1 pr-2'>{integerFormatter.format(Number(model.runs || 0))}</td>
                          <td className='py-1 pr-2'>{formatNumber(Number(model.totalActualCredits || 0))}</td>
                          <td className='py-1 pr-2'>{formatNumber(Number(model.avgActualCredits || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <div className='grid grid-cols-1 xl:grid-cols-3 gap-4'>
              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3'>Activity</h2>
                <div className='space-y-2'>
                  {Object.entries(data.activity.messagesByRole).map(([role, count]) => (
                    <div key={role} className='flex items-center justify-between text-xs'>
                      <span className='text-neutral-600 dark:text-neutral-300'>{role}</span>
                      <span className='font-medium text-neutral-900 dark:text-neutral-100'>
                        {integerFormatter.format(count)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className='grid grid-cols-3 gap-2 mt-4 text-xs'>
                  <StatMini
                    label='Branch Points'
                    value={integerFormatter.format(data.activity.branching.branchPoints || 0)}
                  />
                  <StatMini label='Avg Depth' value={formatNumber(data.activity.branching.averageDepth)} />
                  <StatMini label='Max Depth' value={integerFormatter.format(data.activity.branching.maxDepth || 0)} />
                </div>
              </section>

              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-3'>Tools</h2>
                <div className='text-xs space-y-2'>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Requested Calls</span>
                    <span className='font-medium'>{integerFormatter.format(data.tools.requested.total || 0)}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Job Tracking</span>
                    <span className='font-medium'>{data.tools.jobs.available ? 'Available' : 'Unavailable'}</span>
                  </div>
                  {data.tools.jobs.available && (
                    <>
                      <div className='flex justify-between'>
                        <span className='text-neutral-600 dark:text-neutral-300'>Tracked Jobs</span>
                        <span className='font-medium'>{integerFormatter.format(data.tools.jobs.total || 0)}</span>
                      </div>
                      <div className='flex justify-between'>
                        <span className='text-neutral-600 dark:text-neutral-300'>Avg Duration (ms)</span>
                        <span className='font-medium'>{formatNumber(data.tools.jobs.averageDurationMs)}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className='mt-3'>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400 mb-1'>Top requested tools</p>
                  <div className='space-y-1 max-h-28 overflow-auto'>
                    {Object.entries(data.tools.requested.byName)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 8)
                      .map(([name, count]) => (
                        <div key={name} className='flex justify-between text-xs'>
                          <span className='truncate'>{name}</span>
                          <span>{count}</span>
                        </div>
                      ))}
                  </div>
                </div>
              </section>
            </div>

            <div className='grid grid-cols-1 xl:grid-cols-2 gap-4'>
              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Subscription & Balance</h2>
                <div className='mt-3 text-xs space-y-2'>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Current Plan</span>
                    <span className='font-medium'>
                      {data.payments.currentPlan?.planName || data.payments.currentPlan?.planCode || '—'}
                    </span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Subscription Status</span>
                    <span className='font-medium'>{data.payments.currentPlan?.subscriptionStatus || '—'}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Current Balance</span>
                    <span className='font-medium'>{formatNumber(data.payments.currentCreditsBalance)}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Burn Rate (credits/day)</span>
                    <span className='font-medium'>{formatNumber(data.spend.burnRate.creditsPerDay)}</span>
                  </div>
                  <div className='flex justify-between'>
                    <span className='text-neutral-600 dark:text-neutral-300'>Projected Days Remaining</span>
                    <span className='font-medium'>{formatNumber(data.spend.burnRate.projectedDaysRemaining)}</span>
                  </div>
                </div>
              </section>

              <section className={`${panelClass} p-4`}>
                <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Allocation / Topups</h2>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mt-3 text-xs'>
                  <div>
                    <p className='font-medium mb-1 text-neutral-700 dark:text-neutral-200'>Monthly Allocation</p>
                    <div className='space-y-1 max-h-28 overflow-auto'>
                      {monthlyAllocation.length === 0 && (
                        <p className='text-neutral-500 dark:text-neutral-400'>No data</p>
                      )}
                      {monthlyAllocation.slice(0, 8).map((item: any) => (
                        <div key={String(item.id)} className='flex justify-between'>
                          <span>{String(item.created_at || '').slice(0, 10)}</span>
                          <span>{formatNumber(Number(item.credits || 0))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className='font-medium mb-1 text-neutral-700 dark:text-neutral-200'>Topups</p>
                    <div className='space-y-1 max-h-28 overflow-auto'>
                      {topups.length === 0 && <p className='text-neutral-500 dark:text-neutral-400'>No data</p>}
                      {topups.slice(0, 8).map((item: any) => (
                        <div key={String(item.id)} className='flex justify-between'>
                          <span>{String(item.created_at || '').slice(0, 10)}</span>
                          <span>{formatNumber(Number(item.credits || 0))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

const StatMini = ({ label, value }: { label: string; value: string }) => {
  return (
    <div className='rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/90 backdrop-blur-md p-2'>
      <p className='text-[10px] text-neutral-500 dark:text-neutral-400'>{label}</p>
      <p className='text-xs font-medium text-neutral-900 dark:text-neutral-100'>{value}</p>
    </div>
  )
}

export default LoggingPage
