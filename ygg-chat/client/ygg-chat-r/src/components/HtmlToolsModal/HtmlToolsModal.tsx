import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../Button/button'
import { HtmlIframeSlot, useHtmlIframeRegistry } from '../HtmlIframeRegistry/HtmlIframeRegistry'

export const HtmlToolsModal: React.FC = () => {
  const registry = useHtmlIframeRegistry()
  if (!registry) return null

  const isOpen = registry.isModalOpen
  const isHomepageFullscreen = registry.isHomepageFullscreen
  const focusKey = registry.focusKey
  const onClose = registry.closeModal
  const closeHomepageFullscreen = () => registry.setHomepageFullscreen(false)
  const [collapsedTools, setCollapsedTools] = useState<Record<string, boolean>>({})
  const [viewMode, _setViewMode] = useState<'list' | 'tabs'>('tabs')
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [showLimits, setShowLimits] = useState(false)
  const [showFavorites, setShowFavorites] = useState(false)
  const [showHibernated, setShowHibernated] = useState(false)
  const [fullscreenKey, setFullscreenKey] = useState<string | null>(null)
  const [showFullscreenSettings, setShowFullscreenSettings] = useState(false)
  const [showFullscreenTabMenu, setShowFullscreenTabMenu] = useState<string | null>(null)
  const [tabMenuPosition, setTabMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const settingsRef = useRef<HTMLDivElement | null>(null)
  const settingsDropdownRef = useRef<HTMLDivElement | null>(null)
  const tabMenuRef = useRef<HTMLDivElement | null>(null)
  const lastFocusKeyRef = useRef<string | null>(null)
  const lastFocusModeRef = useRef<'list' | 'tabs' | null>(null)

  const entries = registry.entries
  const activeEntries = useMemo(() => entries.filter(entry => entry.status === 'active'), [entries])
  const hibernatedEntries = useMemo(() => entries.filter(entry => entry.status === 'hibernated'), [entries])
  const favoriteEntries = useMemo(() => entries.filter(entry => entry.favorite), [entries])
  const activeKey = activeTab ?? activeEntries[0]?.key ?? null
  const maxBytesMb = useMemo(() => Math.round(registry.settings.maxBytes / (1024 * 1024)), [registry.settings.maxBytes])

  const displayLabels = useMemo(() => {
    const labelCounts = new Map<string, number>()
    const labelIndices = new Map<string, number>()
    activeEntries.forEach(entry => {
      const label = entry.label || 'App'
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
    })
    const result = new Map<string, string>()
    activeEntries.forEach(entry => {
      const label = entry.label || 'App'
      const count = labelCounts.get(label) || 1
      if (count > 1) {
        const idx = (labelIndices.get(label) || 0) + 1
        labelIndices.set(label, idx)
        result.set(entry.key, `${label} (${idx})`)
      } else {
        result.set(entry.key, label)
      }
    })
    return result
  }, [activeEntries])

  const toggleFullscreen = (entryKey: string) => {
    setFullscreenKey(prev => (prev === entryKey ? null : entryKey))
  }

  const isVisible = isOpen || isHomepageFullscreen

  useEffect(() => {
    if (!isVisible || !focusKey) {
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
  }, [activeEntries, focusKey, isVisible, viewMode])

  useEffect(() => {
    if (!isVisible && fullscreenKey) {
      setFullscreenKey(null)
    }
  }, [fullscreenKey, isVisible])

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

  // Close fullscreen dropdowns on outside click
  useEffect(() => {
    if (!showFullscreenSettings && !showFullscreenTabMenu) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      const isInsideSettingsTrigger = settingsRef.current?.contains(target)
      const isInsideSettingsDropdown = settingsDropdownRef.current?.contains(target)
      if (!isInsideSettingsTrigger && !isInsideSettingsDropdown) {
        setShowFullscreenSettings(false)
      }
      if (tabMenuRef.current && !tabMenuRef.current.contains(target)) {
        setShowFullscreenTabMenu(null)
        setTabMenuPosition(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showFullscreenSettings, showFullscreenTabMenu])

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
    const cardStyle = isFullscreen ? { paddingTop: 'calc(var(--titlebar-height, 0px) + 0.75rem)' } : undefined

    return (
      <div id={`html-tool-${entry.key}`} className={`${cardClassName} p-3`} style={cardStyle}>
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
              onClick={() => (isHibernated ? registry.restoreEntry(entry.key) : registry.hibernateEntry(entry.key))}
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
            {isCollapsed && <div className='text-xs text-neutral-500 dark:text-neutral-400'>Output collapsed.</div>}
            <div className={`w-full ${iframeHeightClass}`} aria-hidden={isCollapsed}>
              <HtmlIframeSlot iframeKey={entry.key} html={entry.html} fullHeight className='h-full w-full' />
            </div>
          </>
        )}
      </div>
    )
  }

  const handleClose = isHomepageFullscreen ? closeHomepageFullscreen : onClose

  const headerContent = (
    <div className='flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-700'>
      <div>
        <h2 className='text-lg font-semibold text-neutral-900 dark:text-neutral-100'>Tool Viewer</h2>
        <p className='text-xs text-neutral-500 dark:text-neutral-400'>HTML tool outputs</p>
      </div>
      <div className='flex items-center gap-2'>
        <Button
          variant='outline2'
          size='smaller'
          rounded='full'
          className={`border ${showFavorites ? 'border-amber-400 bg-amber-50 dark:bg-amber-900/20' : 'border-neutral-200 dark:border-neutral-700'}`}
          onClick={() => setShowFavorites(prev => !prev)}
          aria-pressed={showFavorites}
          aria-label={showFavorites ? 'Hide favorite tools' : 'Show favorite tools'}
        >
          <span className='flex items-center gap-1 text-xs'>
            <i className={`bx ${showFavorites ? 'bxs-star text-amber-500' : 'bx-star'}`} aria-hidden='true'></i>
            {showFavorites ? 'Hide' : 'Show'} favorites
            {favoriteEntries.length > 0 ? ` (${favoriteEntries.length})` : ''}
          </span>
        </Button>
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
          onClick={handleClose}
          aria-label='Close tool viewer'
        >
          <i className='bx bx-x text-2xl' aria-hidden='true'></i>
        </Button>
      </div>
    </div>
  )

  const limitsContent = showLimits && (
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
  )

  const mainContent =
    viewMode === 'tabs' ? (
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
            <div className='text-sm text-neutral-600 dark:text-neutral-300'>No active HTML tool outputs yet.</div>
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
        {showFavorites && (
          <div className='border-t border-amber-200 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 p-4 max-h-[40vh] overflow-y-auto space-y-4'>
            <div className='text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400 flex items-center gap-1.5'>
              <i className='bx bxs-star' aria-hidden='true'></i>
              Favorite tools (never removed or hibernated)
            </div>
            {favoriteEntries.length === 0 ? (
              <div className='text-sm text-neutral-600 dark:text-neutral-300'>No favorite tools. Click the star icon on any tool to add it to favorites.</div>
            ) : (
              favoriteEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
          </div>
        )}
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
          <div className='text-sm text-neutral-600 dark:text-neutral-300'>No active HTML tool outputs yet.</div>
        ) : (
          activeEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
        )}
        {showFavorites && (
          <div className='border-t border-amber-200 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 pt-4 space-y-4'>
            <div className='text-[11px] uppercase tracking-wide text-amber-600 dark:text-amber-400 flex items-center gap-1.5'>
              <i className='bx bxs-star' aria-hidden='true'></i>
              Favorite tools (never removed or hibernated)
            </div>
            {favoriteEntries.length === 0 ? (
              <div className='text-sm text-neutral-600 dark:text-neutral-300'>No favorite tools. Click the star icon on any tool to add it to favorites.</div>
            ) : (
              favoriteEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
          </div>
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
    )

  if (isHomepageFullscreen) {
    return (
      <div
        className='fixed inset-0 z-[1400] flex flex-col bg-neutral-50/95 dark:bg-yBlack-900/98 backdrop-blur-xl'
        style={{ paddingTop: 'var(--titlebar-height, 0px)', boxSizing: 'border-box' }}
      >
        {/* Minimalistic titlebar with tabs */}
        <div className='flex items-center h-10 px-2 bg-transparent shrink-0 app-region-drag'>
          {/* Tabs - scrollable horizontally */}
          <div className='flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar app-region-no-drag'>
            {activeEntries.map(entry => {
              const isActive = entry.key === activeKey
              return (
                <div key={entry.key} className='relative flex items-center group shrink-0'>
                  <button
                    type='button'
                    onClick={() => {
                      setActiveTab(entry.key)
                      registry.touchEntry(entry.key)
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                      isActive
                        ? 'bg-white/80 dark:bg-neutral-800/80 text-neutral-900 dark:text-neutral-100 shadow-sm'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-neutral-800/50'
                    }`}
                  >
                    <span className='flex items-center gap-1.5'>
                      {entry.favorite && <i className='bx bxs-star text-amber-500 text-[10px]' />}
                      {displayLabels.get(entry.key) || entry.label || 'App'}
                    </span>
                  </button>
                  {/* Tab context menu trigger */}
                  <button
                    type='button'
                    onClick={e => {
                      e.stopPropagation()
                      if (showFullscreenTabMenu === entry.key) {
                        setShowFullscreenTabMenu(null)
                        setTabMenuPosition(null)
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setTabMenuPosition({ top: rect.bottom + 4, left: rect.left })
                        setShowFullscreenTabMenu(entry.key)
                      }
                    }}
                    className='opacity-0 group-hover:opacity-100 ml-0.5 p-1 rounded hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 transition-opacity'
                  >
                    <i className='bx bx-dots-vertical-rounded text-xs text-neutral-500 dark:text-neutral-400' />
                  </button>
                  {/* Tab dropdown menu */}
                  {showFullscreenTabMenu === entry.key &&
                    tabMenuPosition &&
                    createPortal(
                      <div
                        ref={tabMenuRef}
                        className='fixed z-[1500] min-w-[140px] rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-lg py-1'
                        style={{
                          top: `${tabMenuPosition.top}px`,
                          left: `${tabMenuPosition.left}px`,
                        }}
                      >
                        <button
                          type='button'
                          className='w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                          onClick={() => {
                            registry.toggleFavorite(entry.key)
                            setShowFullscreenTabMenu(null)
                          }}
                        >
                          <i className={`bx ${entry.favorite ? 'bxs-star text-amber-500' : 'bx-star'}`} />
                          {entry.favorite ? 'Remove favorite' : 'Add to favorites'}
                        </button>
                        <button
                          type='button'
                          className='w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                          onClick={() => {
                            registry.hibernateEntry(entry.key)
                            setShowFullscreenTabMenu(null)
                          }}
                        >
                          <i className='bx bx-moon' />
                          Hibernate
                        </button>
                        <button
                          type='button'
                          className='w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-red-600 dark:text-red-400'
                          onClick={() => {
                            registry.removeEntry(entry.key)
                            setShowFullscreenTabMenu(null)
                          }}
                        >
                          <i className='bx bx-trash' />
                          Remove
                        </button>
                      </div>,
                      document.body
                    )}
                </div>
              )
            })}
            {/* Hibernated indicator */}
            {hibernatedEntries.length > 0 && (
              <button
                type='button'
                onClick={() => setShowHibernated(!showHibernated)}
                className='px-2 py-1 text-[10px] text-neutral-500 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 flex items-center gap-1'
              >
                <i className='bx bx-moon' />
                {hibernatedEntries.length}
              </button>
            )}
          </div>

          {/* Right side controls */}
          <div className='flex items-center gap-1 shrink-0 app-region-no-drag'>
            {/* Settings dropdown */}
            <div className='relative' ref={settingsRef}>
              <button
                type='button'
                data-settings-trigger
                onClick={() => setShowFullscreenSettings(!showFullscreenSettings)}
                className='p-1.5 rounded-lg hover:bg-neutral-200/50 dark:hover:bg-neutral-700/50 text-neutral-600 dark:text-neutral-400'
              >
                <i className='bx bx-cog text-sm' />
              </button>
              {showFullscreenSettings &&
                createPortal(
                  <div
                    ref={settingsDropdownRef}
                    className='fixed w-56 rounded-lg border border-neutral-200/60 dark:border-neutral-700/60 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md shadow-lg py-2 z-[1500]'
                    style={{
                      top: `${(document.querySelector('[data-settings-trigger]') as HTMLElement)?.getBoundingClientRect().bottom ?? 44}px`,
                      right: `${window.innerWidth - ((document.querySelector('[data-settings-trigger]') as HTMLElement)?.getBoundingClientRect().right ?? 100)}px`,
                    }}
                  >
                    <div className='px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500'>
                      Settings
                    </div>
                    <label className='flex items-center justify-between px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800'>
                      <span className='text-xs text-neutral-700 dark:text-neutral-300'>Max live iframes</span>
                      <input
                        type='number'
                        min={0}
                        value={registry.settings.maxActive}
                        onChange={e => registry.updateSettings({ maxActive: Number(e.target.value) })}
                        className='w-14 px-2 py-0.5 text-xs rounded border border-neutral-200 dark:border-neutral-700 bg-transparent text-right'
                      />
                    </label>
                    <label className='flex items-center justify-between px-3 py-2 hover:bg-neutral-100 dark:hover:bg-neutral-800'>
                      <span className='text-xs text-neutral-700 dark:text-neutral-300'>Auto-hibernate (min)</span>
                      <input
                        type='number'
                        min={0}
                        value={registry.settings.hibernateAfterMinutes}
                        onChange={e => registry.updateSettings({ hibernateAfterMinutes: Number(e.target.value) })}
                        className='w-14 px-2 py-0.5 text-xs rounded border border-neutral-200 dark:border-neutral-700 bg-transparent text-right'
                      />
                    </label>
                    {hibernatedEntries.length > 0 && (
                      <>
                        <div className='my-1 border-t border-neutral-200 dark:border-neutral-700' />
                        <div className='px-3 py-1.5 text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500'>
                          Hibernated ({hibernatedEntries.length})
                        </div>
                        {hibernatedEntries.map(entry => (
                          <button
                            key={entry.key}
                            type='button'
                            className='w-full px-3 py-2 text-left text-xs flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                            onClick={() => {
                              registry.restoreEntry(entry.key)
                              setActiveTab(entry.key)
                            }}
                          >
                            <i className='bx bx-play' />
                            <span className='truncate flex-1'>{entry.label || 'App'}</span>
                          </button>
                        ))}
                      </>
                    )}
                  </div>,
                  document.body
                )}
            </div>
            {/* Close button */}
            <button
              type='button'
              onClick={closeHomepageFullscreen}
              className='p-1.5 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-600 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400'
            >
              <i className='bx bx-x text-lg' />
            </button>
          </div>
        </div>

        {/* App content - full size */}
        <div className='flex-1 min-h-0 relative'>
          {activeEntries.length === 0 ? (
            <div className='flex items-center justify-center h-full text-neutral-400 dark:text-neutral-600'>
              <div className='text-center'>
                <i className='bx bx-code-block text-4xl mb-2' />
                <p className='text-sm'>No active apps</p>
              </div>
            </div>
          ) : (
            activeEntries.map(entry => (
              <div
                key={entry.key}
                data-tab-key={entry.key}
                className={`absolute inset-0 ${entry.key === activeKey ? 'block' : 'hidden'}`}
              >
                <HtmlIframeSlot iframeKey={entry.key} html={entry.html} fullHeight className='h-full w-full' />
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  if (!isOpen) return null

  return (
    <div
      className='fixed inset-0 z-[1400]'
      style={{ paddingTop: 'var(--titlebar-height, 0px)', boxSizing: 'border-box' }}
    >
      <div className='absolute inset-0 bg-black/60 backdrop-blur-sm' onClick={onClose} aria-hidden='true' />
      <div
        className='relative mx-auto my-6 h-[90vh] w-[95vw] max-w-6xl rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-yBlack-900 shadow-2xl flex flex-col'
        role='dialog'
        aria-modal='true'
        aria-label='HTML tool viewer'
      >
        {headerContent}
        {limitsContent}
        {mainContent}
      </div>
    </div>
  )
}
