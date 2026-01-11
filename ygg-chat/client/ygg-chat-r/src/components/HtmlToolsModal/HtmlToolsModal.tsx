import React, { useEffect, useState } from 'react'
import { Button } from '../Button/button'
import { HtmlIframeSlot, useHtmlIframeRegistry } from '../HtmlIframeRegistry/HtmlIframeRegistry'

type HtmlToolsModalProps = {
  isOpen: boolean
  onClose: () => void
  focusKey?: string | null
}

export const HtmlToolsModal: React.FC<HtmlToolsModalProps> = ({ isOpen, onClose, focusKey }) => {
  const registry = useHtmlIframeRegistry()
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({})
  const [viewMode, setViewMode] = useState<'list' | 'tabs'>('tabs')
  const [activeTab, setActiveTab] = useState<string | null>(null)

  const entries = registry?.entries ?? []
  const activeKey = activeTab ?? entries[0]?.key ?? null

  useEffect(() => {
    if (!isOpen || !focusKey) return
    if (viewMode === 'tabs') {
      const exists = entries.some(entry => entry.key === focusKey)
      if (exists) {
        setActiveTab(focusKey)
      }
      return
    }
    const target = document.getElementById(`html-tool-${focusKey}`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [entries, focusKey, isOpen, viewMode])

  useEffect(() => {
    if (entries.length === 0) {
      if (activeTab !== null) setActiveTab(null)
      return
    }
    if (!activeTab || !entries.some(entry => entry.key === activeTab)) {
      setActiveTab(entries[0].key)
    }
  }, [activeTab, entries])

  const renderEntry = (entry: (typeof entries)[number]) => {
    const isCollapsed = collapsedTools[entry.key] ?? false

    return (
      <div
        id={`html-tool-${entry.key}`}
        className='rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 bg-neutral-50/60 dark:bg-yBlack-900/60 p-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
      >
        <div className='flex items-center gap-3 mb-3'>
          <div className='text-sm font-semibold text-neutral-800 dark:text-neutral-100'>
            {entry.label || 'HTML Tool Output'}
          </div>
          <div className='flex items-center gap-2 min-w-0 ml-auto flex-1 justify-end'>
            <div className='text-[11px] text-neutral-500 dark:text-neutral-400 truncate max-w-[55%] min-w-0 text-right'>
              {entry.key}
            </div>
            <Button
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200/70 dark:border-neutral-700/60'
              onClick={() =>
                setCollapsedTools(prev => ({
                  ...prev,
                  [entry.key]: !prev[entry.key],
                }))
              }
              aria-label={isCollapsed ? 'Expand tool output' : 'Collapse tool output'}
            >
              <i className={`bx ${isCollapsed ? 'bx-chevron-down' : 'bx-chevron-up'}`} aria-hidden='true' />
            </Button>
          </div>
        </div>
        {isCollapsed && (
          <div className='text-xs text-neutral-500 dark:text-neutral-400'>Output collapsed.</div>
        )}
        <div
          className={`w-full ${
            isCollapsed ? 'h-0 overflow-hidden opacity-0 pointer-events-none' : 'h-[50vh]'
          }`}
          aria-hidden={isCollapsed}
        >
          <HtmlIframeSlot iframeKey={entry.key} html={entry.html} fullHeight className='h-full w-full' />
        </div>
      </div>
    )
  }

  if (!registry) return null

  return (
    <div
      className={`fixed inset-0 z-[1400] transition-opacity duration-200 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!isOpen}
    >
      <div
        className='absolute inset-0 bg-black/60 backdrop-blur-sm'
        onClick={isOpen ? onClose : undefined}
        aria-hidden='true'
      />
      <div
        className='relative mx-auto my-6 h-[90vh] w-[95vw] max-w-6xl rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900 shadow-2xl flex flex-col'
        role='dialog'
        aria-modal='true'
        aria-label='HTML tool viewer'
      >
        <div className='flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700'>
          <div>
            <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Tool Viewer</h2>
            <p className='text-xs text-neutral-500 dark:text-neutral-400'>HTML tool outputs</p>
          </div>
          <div className='flex items-center gap-2'>
            <div className='flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-yBlack-900/70 p-1'>
              <button
                type='button'
                onClick={() => setViewMode('tabs')}
                aria-pressed={viewMode === 'tabs'}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  viewMode === 'tabs'
                    ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                Tabs
              </button>
              <button
                type='button'
                onClick={() => setViewMode('list')}
                aria-pressed={viewMode === 'list'}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  viewMode === 'list'
                    ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                List
              </button>
            </div>
            <Button
              variant='outline'
              size='medium'
              rounded='full'
              className='border border-neutral-200 dark:border-neutral-700'
              onClick={onClose}
              aria-label='Close tool viewer'
            >
              <i className='bx bx-x text-2xl' aria-hidden='true'></i>
            </Button>
          </div>
        </div>
        {viewMode === 'tabs' ? (
          <div className='flex-1 flex flex-col overflow-hidden'>
            <div className='shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-4 overflow-x-auto thin-scrollbar'>
              <div className='flex gap-1 py-2'>
                {entries.map(entry => (
                  <button
                    key={entry.key}
                    type='button'
                    onClick={() => setActiveTab(entry.key)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                      activeKey === entry.key
                        ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    {entry.label || 'HTML Tool Output'}
                  </button>
                ))}
              </div>
            </div>
            <div className='flex-1 overflow-y-auto p-4'>
              {entries.length === 0 ? (
                <div className='text-sm text-neutral-600 dark:text-neutral-300'>No HTML tool outputs yet.</div>
              ) : (
                <div className='relative'>
                  {entries.map(entry => {
                    const isActive = entry.key === activeKey
                    return (
                      <div
                        key={entry.key}
                        className={isActive ? 'relative' : 'absolute inset-0 opacity-0 pointer-events-none'}
                        aria-hidden={!isActive}
                      >
                        {renderEntry(entry)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className='flex-1 overflow-y-auto p-4 space-y-6'>
            {entries.length === 0 ? (
              <div className='text-sm text-neutral-600 dark:text-neutral-300'>No HTML tool outputs yet.</div>
            ) : (
              entries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
          </div>
        )}
      </div>
    </div>
  )
}
