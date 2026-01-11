import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '../Button/button'
import { HtmlIframeSlot, useHtmlIframeRegistry } from '../HtmlIframeRegistry/HtmlIframeRegistry'

export const HtmlToolsModal: React.FC = () => {
  const registry = useHtmlIframeRegistry()
  if (!registry) return null

  const isOpen = registry.isModalOpen
  const focusKey = registry.focusKey
  const onClose = registry.closeModal
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({})
  const [viewMode, setViewMode] = useState<'list' | 'tabs'>('tabs')
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [showLimits, setShowLimits] = useState(false)
  const [showHibernated, setShowHibernated] = useState(false)
  const [fullscreenKey, setFullscreenKey] = useState<string | null>(null)
  const lastFocusKeyRef = useRef<string | null>(null)
  const lastFocusModeRef = useRef<'list' | 'tabs' | null>(null)

  const entries = registry.entries
  const activeEntries = useMemo(() => entries.filter(entry => entry.status === 'active'), [entries])
  const hibernatedEntries = useMemo(() => entries.filter(entry => entry.status === 'hibernated'), [entries])
  const activeKey = activeTab ?? activeEntries[0]?.key ?? null
  const maxBytesMb = useMemo(() => Math.round(registry.settings.maxBytes / (1024 * 1024)), [registry.settings.maxBytes])

  const toggleFullscreen = (entryKey: string) => {
    setFullscreenKey(prev => (prev === entryKey ? null : entryKey))
  }

  useEffect(() => {
    if (!isOpen || !focusKey) {
      lastFocusKeyRef.current = null
      lastFocusModeRef.current = null
      return
    }
    if (lastFocusKeyRef.current === focusKey && lastFocusModeRef.current === viewMode) {
      return
    }
    if (viewMode === 'tabs') {
      const exists = activeEntries.some(entry => entry.key === focusKey)
      if (exists) {
        setActiveTab(focusKey)
        lastFocusKeyRef.current = focusKey
        lastFocusModeRef.current = viewMode
      }
      return
    }
    const target = document.getElementById(`html-tool-${focusKey}`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      lastFocusKeyRef.current = focusKey
      lastFocusModeRef.current = viewMode
    }
  }, [activeEntries, focusKey, isOpen, viewMode])

  useEffect(() => {
    if (!isOpen && fullscreenKey) {
      setFullscreenKey(null)
    }
  }, [fullscreenKey, isOpen])

  useEffect(() => {
    if (!fullscreenKey) return
    const exists = entries.some(entry => entry.key === fullscreenKey && entry.status === 'active')
    if (!exists) {
      setFullscreenKey(null)
    }
  }, [entries, fullscreenKey])

  useEffect(() => {
    if (activeEntries.length === 0) {
      if (activeTab !== null) setActiveTab(null)
      return
    }
    if (!activeTab || !activeEntries.some(entry => entry.key === activeTab)) {
      setActiveTab(activeEntries[0].key)
    }
  }, [activeEntries, activeTab])

  const renderEntry = (entry: (typeof entries)[number]) => {
    const isCollapsed = collapsedTools[entry.key] ?? false
    const isHibernated = entry.status === 'hibernated'
    const isFavorite = entry.favorite
    const isFullscreen = fullscreenKey === entry.key
    const iframeHeightClass = isCollapsed
      ? 'h-0 overflow-hidden opacity-0 pointer-events-none'
      : isFullscreen
      ? 'flex-1 min-h-0'
      : 'h-[50vh]'
    const cardClassName = isFullscreen
      ? 'fixed inset-0 z-[1501] flex flex-col min-h-0 rounded-none border-0 bg-white dark:bg-yBlack-900 shadow-none'
      : 'rounded-xl border border-neutral-200/70 dark:border-neutral-700/60 bg-neutral-50/60 dark:bg-yBlack-900/60 shadow-[0_2px_8px_rgba(0,0,0,0.08)]'
    const cardStyle = isFullscreen
      ? { paddingTop: 'calc(var(--titlebar-height, 0px) + 0.75rem)' }
      : undefined

    return (
      <div
        id={`html-tool-${entry.key}`}
        className={`${cardClassName} p-3`}
        style={cardStyle}
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
              onClick={() => registry.toggleFavorite(entry.key)}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? 'Unfavorite tool output' : 'Favorite tool output'}
            >
              <i className={`bx ${isFavorite ? 'bxs-star' : 'bx-star'}`} aria-hidden='true' />
            </Button>
            <Button
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200/70 dark:border-neutral-700/60'
              onClick={() =>
                isHibernated ? registry.restoreEntry(entry.key) : registry.hibernateEntry(entry.key)
              }
              aria-label={isHibernated ? 'Restore tool output' : 'Hibernate tool output'}
            >
              <i className={`bx ${isHibernated ? 'bx-play' : 'bx-moon'}`} aria-hidden='true' />
            </Button>
            <Button
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200/70 dark:border-neutral-700/60'
              disabled={isHibernated}
              onClick={() => toggleFullscreen(entry.key)}
              aria-label={isFullscreen ? 'Exit fullscreen tool output' : 'Enter fullscreen tool output'}
            >
              <i className={`bx ${isFullscreen ? 'bx-exit-fullscreen' : 'bx-fullscreen'}`} aria-hidden='true' />
            </Button>
            <Button
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200/70 dark:border-neutral-700/60'
              disabled={isHibernated}
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
        {isHibernated ? (
          <div className='text-xs text-neutral-500 dark:text-neutral-400'>
            Hibernated to save resources. Restore to reload.
          </div>
        ) : (
          <>
            {isCollapsed && (
              <div className='text-xs text-neutral-500 dark:text-neutral-400'>Output collapsed.</div>
            )}
            <div
              className={`w-full ${iframeHeightClass}`}
              aria-hidden={isCollapsed}
            >
              <HtmlIframeSlot iframeKey={entry.key} html={entry.html} fullHeight className='h-full w-full' />
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      className={`fixed inset-0 z-[1400] transition-opacity duration-200 ${
        isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
      }`}
      style={{ paddingTop: 'var(--titlebar-height, 0px)', boxSizing: 'border-box' }}
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
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200 dark:border-neutral-700'
              onClick={() => setShowHibernated(prev => !prev)}
              aria-pressed={showHibernated}
              aria-label={showHibernated ? 'Hide hibernated tools' : 'Show hibernated tools'}
            >
              <span className='flex items-center gap-1 text-xs'>
                <i className='bx bx-bed' aria-hidden='true'></i>
                {showHibernated ? 'Hide' : 'Show'} hibernated
                {hibernatedEntries.length > 0 ? ` (${hibernatedEntries.length})` : ''}
              </span>
            </Button>
            <Button
              variant='outline2'
              size='smaller'
              rounded='full'
              className='border border-neutral-200 dark:border-neutral-700'
              onClick={() => setShowLimits(prev => !prev)}
              aria-pressed={showLimits}
              aria-label={showLimits ? 'Hide tool limits' : 'Show tool limits'}
            >
              <i className='bx bx-slider-alt' aria-hidden='true'></i>
            </Button>
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
        {showLimits && (
          <div className='border-b border-neutral-200 dark:border-neutral-700 px-5 py-3'>
            <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs text-neutral-600 dark:text-neutral-300'>
              <label className='flex flex-col gap-1'>
                <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Max live iframes
                </span>
                <input
                  type='number'
                  min={0}
                  value={registry.settings.maxActive}
                  onChange={event => registry.updateSettings({ maxActive: Number(event.target.value) })}
                  className='rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900/70 px-2 py-1 text-sm text-neutral-800 dark:text-neutral-100'
                />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Max cached tools
                </span>
                <input
                  type='number'
                  min={0}
                  value={registry.settings.maxCached}
                  onChange={event => registry.updateSettings({ maxCached: Number(event.target.value) })}
                  className='rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900/70 px-2 py-1 text-sm text-neutral-800 dark:text-neutral-100'
                />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Cache TTL (minutes)
                </span>
                <input
                  type='number'
                  min={0}
                  value={registry.settings.ttlMinutes}
                  onChange={event => registry.updateSettings({ ttlMinutes: Number(event.target.value) })}
                  className='rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900/70 px-2 py-1 text-sm text-neutral-800 dark:text-neutral-100'
                />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Hibernate after (minutes)
                </span>
                <input
                  type='number'
                  min={0}
                  value={registry.settings.hibernateAfterMinutes}
                  onChange={event => registry.updateSettings({ hibernateAfterMinutes: Number(event.target.value) })}
                  className='rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900/70 px-2 py-1 text-sm text-neutral-800 dark:text-neutral-100'
                />
              </label>
              <label className='flex flex-col gap-1'>
                <span className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Max cache size (MB)
                </span>
                <input
                  type='number'
                  min={0}
                  value={maxBytesMb}
                  onChange={event =>
                    registry.updateSettings({
                      maxBytes: Number(event.target.value) * 1024 * 1024,
                    })
                  }
                  className='rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900/70 px-2 py-1 text-sm text-neutral-800 dark:text-neutral-100'
                />
              </label>
              <div className='flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400'>
                <span className='uppercase tracking-wide'>Notes</span>
                <span>0 = no limit. Favorites are never evicted.</span>
              </div>
            </div>
          </div>
        )}
        {viewMode === 'tabs' ? (
          <div className='flex-1 flex flex-col overflow-hidden'>
            <div className='shrink-0 border-b border-neutral-200 dark:border-neutral-700 px-4 overflow-x-auto thin-scrollbar'>
              <div className='flex gap-1 py-2'>
                {activeEntries.map(entry => (
                  <button
                    key={entry.key}
                    type='button'
                    onClick={() => {
                      setActiveTab(entry.key)
                      registry.touchEntry(entry.key)
                    }}
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
              {activeEntries.length === 0 ? (
                <div className='text-sm text-neutral-600 dark:text-neutral-300'>
                  No active HTML tool outputs yet.
                </div>
              ) : (
                <div>
                  {activeEntries.map(entry => {
                    const isActive = entry.key === activeKey
                    return (
                      <div key={entry.key} className={isActive ? 'block' : 'hidden'} aria-hidden={!isActive}>
                        {renderEntry(entry)}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {showHibernated && (
              <div className='border-t border-neutral-200 dark:border-neutral-700 p-4 max-h-[40vh] overflow-y-auto space-y-4'>
                <div className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Hibernated tools
                </div>
                {hibernatedEntries.length === 0 ? (
                  <div className='text-sm text-neutral-600 dark:text-neutral-300'>No hibernated tools.</div>
                ) : (
                  hibernatedEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
                )}
              </div>
            )}
          </div>
        ) : (
          <div className='flex-1 overflow-y-auto p-4 space-y-6'>
            {activeEntries.length === 0 ? (
              <div className='text-sm text-neutral-600 dark:text-neutral-300'>
                No active HTML tool outputs yet.
              </div>
            ) : (
              activeEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
            {showHibernated && (
              <div className='border-t border-neutral-200 dark:border-neutral-700 pt-4 space-y-4'>
                <div className='text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                  Hibernated tools
                </div>
                {hibernatedEntries.length === 0 ? (
                  <div className='text-sm text-neutral-600 dark:text-neutral-300'>No hibernated tools.</div>
                ) : (
                  hibernatedEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
