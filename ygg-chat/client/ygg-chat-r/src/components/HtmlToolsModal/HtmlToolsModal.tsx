import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { HtmlIframeSlot, McpAppIframeSlot, useHtmlIframeRegistry } from '../HtmlIframeRegistry/HtmlIframeRegistry'

// Ghost Pill Button Component
const GhostPill: React.FC<{
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  className?: string
  'aria-label'?: string
  'aria-pressed'?: boolean
}> = ({ children, onClick, active, disabled, danger, className = '', ...props }) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    className={`
      font-mono text-[11px] px-3 py-1.5 rounded-full
      transition-all duration-200 cursor-pointer
      border flex items-center justify-center gap-1.5
      disabled:opacity-40 disabled:cursor-not-allowed
      ${
        active
          ? 'bg-neutral-200 border-neutral-300 text-neutral-900 dark:bg-white/[0.08] dark:border-white/[0.1] dark:text-white'
          : danger
            ? 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-neutral-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 dark:hover:border-red-500/20'
            : 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-neutral-500 dark:hover:bg-white/[0.05] dark:hover:text-white'
      }
      ${className}
    `}
    {...props}
  >
    {children}
  </button>
)

// Icon-only Ghost Pill variant
const GhostPillIcon: React.FC<{
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
  className?: string
  'aria-label'?: string
  'aria-pressed'?: boolean
}> = ({ children, onClick, active, disabled, danger, className = '', ...props }) => (
  <button
    type='button'
    onClick={onClick}
    disabled={disabled}
    className={`
      w-8 h-8 rounded-full flex items-center justify-center
      transition-all duration-200 cursor-pointer border
      disabled:opacity-40 disabled:cursor-not-allowed
      ${
        active
          ? 'bg-neutral-200 border-neutral-300 text-neutral-900 dark:bg-white/[0.08] dark:border-white/[0.1] dark:text-white'
          : danger
            ? 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-red-50 hover:text-red-600 hover:border-red-200 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-neutral-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 dark:hover:border-red-500/20'
            : 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-neutral-500 dark:hover:bg-white/[0.05] dark:hover:text-white'
      }
      ${className}
    `}
    {...props}
  >
    {children}
  </button>
)

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
  const resolveEntryLabel = (entry: (typeof entries)[number]) =>
    entry.label || (entry.kind === 'mcp' ? 'MCP App' : 'HTML Tool Output')

  const displayLabels = useMemo(() => {
    const labelCounts = new Map<string, number>()
    const labelIndices = new Map<string, number>()
    activeEntries.forEach(entry => {
      const label = resolveEntryLabel(entry)
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1)
    })
    const result = new Map<string, string>()
    activeEntries.forEach(entry => {
      const label = resolveEntryLabel(entry)
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
  }, [activeEntries, resolveEntryLabel])

  const toggleFullscreen = (entryKey: string) => {
    const isExiting = fullscreenKey === entryKey
    setFullscreenKey(isExiting ? null : entryKey)
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
    if (!isVisible) {
      if (fullscreenKey) setFullscreenKey(null)
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

  const renderEntry = (entry: (typeof entries)[number], options?: { fillHeight?: boolean; compactView?: boolean }) => {
    const isCollapsed = collapsedTools[entry.key] ?? false
    const isHibernated = entry.status === 'hibernated'
    const isFavorite = entry.favorite
    const isFullscreen = fullscreenKey === entry.key
    const mcpEntry = entry.kind === 'mcp' ? entry : null
    const isCompact = options?.compactView === true
    const iframeHeightClass = isCollapsed
      ? 'h-0 overflow-hidden opacity-0 pointer-events-none'
      : isFullscreen
        ? 'flex-1 min-h-0'
        : options?.fillHeight
          ? 'flex-1 min-h-0'
          : 'h-[50vh]'
    const cardClassName = isFullscreen
      ? 'fixed inset-0 z-[1501] flex flex-col min-h-0 rounded-none border-0 bg-white dark:bg-[rgba(15,15,15,0.95)] shadow-none'
      : options?.fillHeight
        ? 'flex-1 flex flex-col min-h-0 rounded-2xl border border-neutral-200 dark:border-white/[0.05] bg-neutral-50 dark:bg-black/20'
        : isCompact
          ? 'rounded-2xl border border-neutral-200 dark:border-white/[0.05] bg-neutral-50 dark:bg-black/20 cursor-pointer hover:bg-neutral-100 dark:hover:bg-white/[0.03] hover:border-neutral-300 dark:hover:border-white/[0.08] transition-all duration-200'
          : 'rounded-2xl border border-neutral-200 dark:border-white/[0.05] bg-neutral-50 dark:bg-black/20'
    const cardStyle = isFullscreen ? { paddingTop: '0.5rem' } : undefined

    const handleCompactClick = () => {
      if (!isCompact) return
      setActiveTab(entry.key)
      registry.touchEntry(entry.key)
      setShowFavorites(false)
    }

    // Truncate key for display
    const truncatedKey = entry.key.length > 12 ? `${entry.key.slice(0, 8)}...${entry.key.slice(-4)}` : entry.key

    return (
      <div
        id={`html-tool-${entry.key}`}
        className={`${cardClassName} px-0 py-1`}
        style={cardStyle}
        onClick={handleCompactClick}
      >
        <div className={`flex items-center gap-3 px-3 ${isCompact ? '' : 'mb-1'}`}>
          <div className='flex items-center gap-3 min-w-0 flex-1'>
            {mcpEntry && (
              <span className='text-[10px] uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400'>
                MCP App
              </span>
            )}
            <span className='font-mono text-[10px] px-2 py-0 rounded bg-blue-100 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20'>
              ID: {truncatedKey}
            </span>
          </div>
          <div className='flex items-center gap-2' onClick={e => e.stopPropagation()}>
            <GhostPillIcon
              onClick={() => registry.toggleFavorite(entry.key)}
              active={isFavorite}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? 'Unfavorite tool output' : 'Favorite tool output'}
            >
              <i
                className={`bx ${isFavorite ? 'bxs-star text-amber-500 dark:text-amber-400' : 'bx-star'} text-sm`}
                aria-hidden='true'
              />
            </GhostPillIcon>
            <GhostPillIcon
              onClick={() => (isHibernated ? registry.restoreEntry(entry.key) : registry.hibernateEntry(entry.key))}
              aria-label={isHibernated ? 'Restore tool output' : 'Hibernate tool output'}
            >
              <i className={`bx ${isHibernated ? 'bx-play' : 'bx-moon'} text-sm`} aria-hidden='true' />
            </GhostPillIcon>
            <GhostPillIcon
              disabled={isHibernated}
              onClick={() => toggleFullscreen(entry.key)}
              aria-label={isFullscreen ? 'Exit fullscreen tool output' : 'Enter fullscreen tool output'}
            >
              <i className={`bx ${isFullscreen ? 'bx-exit-fullscreen' : 'bx-fullscreen'} text-sm`} aria-hidden='true' />
            </GhostPillIcon>
            {!isCompact && (
              <GhostPillIcon
                disabled={isHibernated}
                onClick={() =>
                  setCollapsedTools(prev => ({
                    ...prev,
                    [entry.key]: !prev[entry.key],
                  }))
                }
                aria-label={isCollapsed ? 'Expand tool output' : 'Collapse tool output'}
              >
                <i className={`bx ${isCollapsed ? 'bx-chevron-down' : 'bx-chevron-up'} text-sm`} aria-hidden='true' />
              </GhostPillIcon>
            )}
          </div>
        </div>
        {isCompact ? null : isHibernated ? (
          <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>
            Hibernated to save resources. Restore to reload.
          </div>
        ) : (
          <>
            {isCollapsed && (
              <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>Output collapsed.</div>
            )}
            <div className={`w-full ${iframeHeightClass}`} aria-hidden={isCollapsed}>
              {entry.kind === 'mcp' ? (
                <McpAppIframeSlot
                  iframeKey={entry.key}
                  serverName={entry.serverName}
                  qualifiedToolName={entry.qualifiedToolName}
                  resourceUri={entry.resourceUri}
                  toolArgs={entry.toolArgs ?? undefined}
                  toolResult={entry.toolResult ?? undefined}
                  toolDefinition={entry.toolDefinition}
                  reloadToken={entry.reloadToken}
                  className='h-full w-full overflow-hidden'
                  priority={1}
                />
              ) : (
                <HtmlIframeSlot
                  iframeKey={entry.key}
                  html={entry.html}
                  toolName={entry.toolName ?? null}
                  fullHeight
                  className='h-full w-full overflow-hidden'
                  priority={1}
                />
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  const handleClose = isHomepageFullscreen ? closeHomepageFullscreen : onClose

  const headerContent = (
    <header className='flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-white/[0.03] relative z-[1451]'>
      <div>
        <h2 className='text-lg font-medium text-neutral-900 dark:text-white tracking-tight leading-none'>Task Manager</h2>
        <p className='font-mono text-[10px] text-neutral-500 uppercase tracking-[0.15em] mt-1'>Running Apps</p>
      </div>
      <div className='flex items-center gap-2'>
        <GhostPill
          onClick={() => setShowFavorites(prev => !prev)}
          active={showFavorites}
          aria-pressed={showFavorites}
          aria-label={showFavorites ? 'Hide favorite tools' : 'Show favorite tools'}
        >
          <i
            className={`bx ${showFavorites ? 'bxs-star text-amber-500 dark:text-amber-400' : 'bx-star'}`}
            aria-hidden='true'
          />
          Favorites{favoriteEntries.length > 0 ? ` (${favoriteEntries.length})` : ''}
        </GhostPill>
        <GhostPill
          onClick={() => setShowHibernated(prev => !prev)}
          active={showHibernated}
          aria-pressed={showHibernated}
          aria-label={showHibernated ? 'Hide hibernated tools' : 'Show hibernated tools'}
        >
          <i className='bx bx-moon' aria-hidden='true' />
          Hibernated{hibernatedEntries.length > 0 ? ` (${hibernatedEntries.length})` : ''}
        </GhostPill>
        {/* Divider */}
        <div className='w-px h-4 bg-neutral-300 dark:bg-white/10 mx-1' />
        <GhostPillIcon
          onClick={() => setShowLimits(prev => !prev)}
          active={showLimits}
          aria-pressed={showLimits}
          aria-label={showLimits ? 'Hide tool limits' : 'Show tool limits'}
        >
          <i className='bx bx-slider-alt text-sm' aria-hidden='true' />
        </GhostPillIcon>
        <GhostPillIcon onClick={handleClose} danger aria-label='Close tool viewer'>
          <i className='bx bx-x text-lg' aria-hidden='true' />
        </GhostPillIcon>
      </div>
    </header>
  )

  const limitsContent = showLimits && (
    <div className='border-b border-neutral-200 dark:border-white/[0.03] px-4 py-3 relative z-[1451] bg-neutral-50 dark:bg-black/20'>
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-xs'>
        <label className='flex flex-col gap-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>Max live iframes</span>
          <input
            type='number'
            min={0}
            value={registry.settings.maxActive}
            onChange={event => registry.updateSettings({ maxActive: Number(event.target.value) })}
            className='rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none transition-colors'
          />
        </label>
        <label className='flex flex-col gap-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>Max cached tools</span>
          <input
            type='number'
            min={0}
            value={registry.settings.maxCached}
            onChange={event => registry.updateSettings({ maxCached: Number(event.target.value) })}
            className='rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none transition-colors'
          />
        </label>
        <label className='flex flex-col gap-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>
            Cache TTL (minutes)
          </span>
          <input
            type='number'
            min={0}
            value={registry.settings.ttlMinutes}
            onChange={event => registry.updateSettings({ ttlMinutes: Number(event.target.value) })}
            className='rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none transition-colors'
          />
        </label>
        <label className='flex flex-col gap-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>
            Hibernate after (minutes)
          </span>
          <input
            type='number'
            min={0}
            value={registry.settings.hibernateAfterMinutes}
            onChange={event => registry.updateSettings({ hibernateAfterMinutes: Number(event.target.value) })}
            className='rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none transition-colors'
          />
        </label>
        <label className='flex flex-col gap-1.5'>
          <span className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>
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
            className='rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none transition-colors'
          />
        </label>
        <div className='flex flex-col gap-1.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-600'>
          <span className='uppercase tracking-[0.15em] text-neutral-500'>Notes</span>
          <span>0 = no limit. Favorites are never evicted.</span>
        </div>
      </div>
    </div>
  )

  const mainContent =
    viewMode === 'tabs' ? (
      <div className='flex-1 flex flex-col overflow-hidden'>
        {/* Tool tab bar */}
        <div className='shrink-0 px-4 py-2 bg-neutral-50 dark:bg-black/20 border-b border-neutral-200 dark:border-white/[0.03] overflow-x-auto thin-scrollbar relative z-[1451]'>
          <div className='flex gap-2'>
            {activeEntries.map(entry => (
              <button
                key={entry.key}
                type='button'
                onClick={() => {
                  setActiveTab(entry.key)
                  registry.touchEntry(entry.key)
                }}
                className={`
                  text-[13px] font-semibold px-3.5 py-1.5 rounded-full
                  transition-all duration-200 cursor-pointer border whitespace-nowrap
                  ${
                    activeKey === entry.key
                      ? 'bg-neutral-200 border-neutral-300 text-neutral-900 dark:bg-white/[0.08] dark:border-white/[0.1] dark:text-white'
                      : 'bg-neutral-100 border-neutral-200 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-900 dark:bg-white/[0.02] dark:border-white/[0.05] dark:text-neutral-500 dark:hover:bg-white/[0.05] dark:hover:text-white'
                  }
                `}
              >
                {displayLabels.get(entry.key) ?? resolveEntryLabel(entry)}
              </button>
            ))}
          </div>
        </div>
        {/* Content area */}
        <div className='flex-1 flex flex-col min-h-0 p-0'>
          {activeEntries.length === 0 ? (
            <div className='flex-1 flex items-center justify-center border border-dashed border-neutral-300 dark:border-white/[0.05] rounded-2xl'>
              <span className='font-mono text-xs text-neutral-400 dark:text-neutral-700'>
                awaiting_output_stream_from_server...
              </span>
            </div>
          ) : (
            activeEntries.map(entry => {
              const isActive = entry.key === activeKey
              return (
                <div
                  key={entry.key}
                  className={isActive ? 'flex-1 flex flex-col min-h-0' : 'hidden'}
                  aria-hidden={!isActive}
                >
                  {renderEntry(entry, { fillHeight: true })}
                </div>
              )
            })
          )}
        </div>
        {/* Favorites panel */}
        {showFavorites && (
          <div className='shrink-0 border-t border-amber-200 dark:border-amber-500/20 bg-neutral-50/80 dark:bg-amber-500/[0.03] p-3 max-h-[40vh] overflow-y-auto space-y-3 relative z-[1451]'>
            <div className='font-mono text-[10px] uppercase tracking-[0.15em] text-amber-600 dark:text-amber-500 flex items-center gap-2'>
              <i className='bx bxs-star' aria-hidden='true' />
              Favorite tools (never removed or hibernated)
            </div>
            {favoriteEntries.length === 0 ? (
              <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>
                No favorite tools. Click the star icon on any tool to add it to favorites.
              </div>
            ) : (
              favoriteEntries.map(entry => (
                <React.Fragment key={entry.key}>{renderEntry(entry, { compactView: true })}</React.Fragment>
              ))
            )}
          </div>
        )}
        {/* Hibernated panel */}
        {showHibernated && (
          <div className='shrink-0 border-t border-neutral-200 dark:border-white/[0.03] bg-neutral-50 dark:bg-black/20 p-3 max-h-[40vh] overflow-y-auto space-y-3 relative z-[1451]'>
            <div className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>Hibernated tools</div>
            {hibernatedEntries.length === 0 ? (
              <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>No hibernated tools.</div>
            ) : (
              hibernatedEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
          </div>
        )}
      </div>
    ) : (
      <div className='flex-1 overflow-y-auto px-0 py-2 space-y-2'>
        {activeEntries.length === 0 ? (
          <div className='flex-1 flex items-center justify-center h-[300px] border border-dashed border-neutral-300 dark:border-white/[0.05] rounded-2xl'>
            <span className='font-mono text-xs text-neutral-400 dark:text-neutral-700'>
              awaiting_output_stream_from_server...
            </span>
          </div>
        ) : (
          activeEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
        )}
        {showFavorites && (
          <div className='border-t border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/[0.03] pt-3 space-y-3 relative z-[1451]'>
            <div className='font-mono text-[10px] uppercase tracking-[0.15em] text-amber-600 dark:text-amber-500 flex items-center gap-2'>
              <i className='bx bxs-star' aria-hidden='true' />
              Favorite tools (never removed or hibernated)
            </div>
            {favoriteEntries.length === 0 ? (
              <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>
                No favorite tools. Click the star icon on any tool to add it to favorites.
              </div>
            ) : (
              favoriteEntries.map(entry => (
                <React.Fragment key={entry.key}>{renderEntry(entry, { compactView: true })}</React.Fragment>
              ))
            )}
          </div>
        )}
        {showHibernated && (
          <div className='border-t border-neutral-200 dark:border-white/[0.03] bg-neutral-50 dark:bg-black/20 pt-3 space-y-3 relative z-[1451]'>
            <div className='font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500'>Hibernated tools</div>
            {hibernatedEntries.length === 0 ? (
              <div className='font-mono text-xs text-neutral-500 dark:text-neutral-600'>No hibernated tools.</div>
            ) : (
              hibernatedEntries.map(entry => <React.Fragment key={entry.key}>{renderEntry(entry)}</React.Fragment>)
            )}
          </div>
        )}
      </div>
    )

  // Homepage fullscreen mode
  if (isHomepageFullscreen) {
    return (
      <div
        className='fixed inset-0 z-[1400] flex flex-col bg-white/98 dark:bg-[rgba(15,15,15,0.98)] backdrop-blur-[32px]'
        style={{ paddingTop: 'var(--titlebar-height, 0px)', boxSizing: 'border-box' }}
      >
        {/* Minimalistic titlebar with tabs */}
        <div className='flex items-center h-10 px-3 bg-transparent shrink-0 app-region-drag border-b border-neutral-200 dark:border-white/[0.03]'>
          {/* Tabs - scrollable horizontally */}
          <div className='flex-1 flex items-center gap-1.5 overflow-x-auto no-scrollbar app-region-no-drag'>
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
                    className={`
                      font-mono text-[11px] px-3 py-1.5 rounded-full
                      transition-all duration-200 cursor-pointer border whitespace-nowrap
                      ${
                        isActive
                          ? 'bg-neutral-200 border-neutral-300 text-neutral-900 dark:bg-white/[0.08] dark:border-white/[0.1] dark:text-white'
                          : 'bg-transparent border-transparent text-neutral-500 hover:bg-neutral-100 dark:hover:bg-white/[0.03] hover:text-neutral-700 dark:hover:text-neutral-300'
                      }
                    `}
                  >
                    <span className='flex items-center gap-1.5'>
                      {entry.favorite && <i className='bx bxs-star text-amber-500 dark:text-amber-400 text-[10px]' />}
                      {displayLabels.get(entry.key) || resolveEntryLabel(entry)}
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
                    className='opacity-0 group-hover:opacity-100 ml-0.5 p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-white/[0.05] transition-all'
                  >
                    <i className='bx bx-dots-vertical-rounded text-xs text-neutral-500' />
                  </button>
                  {/* Tab dropdown menu */}
                  {showFullscreenTabMenu === entry.key &&
                    tabMenuPosition &&
                    createPortal(
                      <div
                        ref={tabMenuRef}
                        className='fixed z-[1500] min-w-[160px] rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-white/95 dark:bg-[rgba(15,15,15,0.95)] backdrop-blur-xl shadow-lg dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] py-1.5'
                        style={{
                          top: `${tabMenuPosition.top}px`,
                          left: `${tabMenuPosition.left}px`,
                        }}
                      >
                        <button
                          type='button'
                          className='w-full px-3 py-2 text-left font-mono text-[11px] flex items-center gap-2.5 hover:bg-neutral-100 dark:hover:bg-white/[0.05] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors'
                          onClick={() => {
                            registry.toggleFavorite(entry.key)
                            setShowFullscreenTabMenu(null)
                          }}
                        >
                          <i
                            className={`bx ${entry.favorite ? 'bxs-star text-amber-500 dark:text-amber-400' : 'bx-star'}`}
                          />
                          {entry.favorite ? 'Remove favorite' : 'Add to favorites'}
                        </button>
                        <button
                          type='button'
                          className='w-full px-3 py-2 text-left font-mono text-[11px] flex items-center gap-2.5 hover:bg-neutral-100 dark:hover:bg-white/[0.05] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors'
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
                          className='w-full px-3 py-2 text-left font-mono text-[11px] flex items-center gap-2.5 hover:bg-red-50 dark:hover:bg-red-500/10 text-red-600 dark:text-red-400 transition-colors'
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
                className='px-2 py-1 font-mono text-[10px] text-neutral-500 dark:text-neutral-600 hover:text-neutral-700 dark:hover:text-neutral-400 flex items-center gap-1 transition-colors'
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
                className='p-1.5 rounded-full hover:bg-neutral-200 dark:hover:bg-white/[0.05] text-neutral-500 hover:text-neutral-900 dark:hover:text-white transition-colors'
              >
                <i className='bx bx-cog text-sm' />
              </button>
              {showFullscreenSettings &&
                createPortal(
                  <div
                    ref={settingsDropdownRef}
                    className='fixed w-60 rounded-xl border border-neutral-200 dark:border-white/[0.08] bg-white/95 dark:bg-[rgba(15,15,15,0.95)] backdrop-blur-xl shadow-lg dark:shadow-[0_20px_50px_-10px_rgba(0,0,0,0.5)] py-2 z-[1500]'
                    style={{
                      top: `${(document.querySelector('[data-settings-trigger]') as HTMLElement)?.getBoundingClientRect().bottom ?? 44}px`,
                      right: `${window.innerWidth - ((document.querySelector('[data-settings-trigger]') as HTMLElement)?.getBoundingClientRect().right ?? 100)}px`,
                    }}
                  >
                    <div className='px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500 dark:text-neutral-600'>
                      Settings
                    </div>
                    <label className='flex items-center justify-between px-3 py-2.5 hover:bg-neutral-100 dark:hover:bg-white/[0.03] transition-colors'>
                      <span className='font-mono text-[11px] text-neutral-600 dark:text-neutral-400'>
                        Max live iframes
                      </span>
                      <input
                        type='number'
                        min={0}
                        value={registry.settings.maxActive}
                        onChange={e => registry.updateSettings({ maxActive: Number(e.target.value) })}
                        className='w-14 px-2 py-1 font-mono text-[11px] rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] text-right text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none'
                      />
                    </label>
                    <label className='flex items-center justify-between px-3 py-2.5 hover:bg-neutral-100 dark:hover:bg-white/[0.03] transition-colors'>
                      <span className='font-mono text-[11px] text-neutral-600 dark:text-neutral-400'>
                        Auto-hibernate (min)
                      </span>
                      <input
                        type='number'
                        min={0}
                        value={registry.settings.hibernateAfterMinutes}
                        onChange={e => registry.updateSettings({ hibernateAfterMinutes: Number(e.target.value) })}
                        className='w-14 px-2 py-1 font-mono text-[11px] rounded-lg border border-neutral-200 dark:border-white/[0.05] bg-white dark:bg-white/[0.02] text-right text-neutral-800 dark:text-neutral-200 focus:border-neutral-400 dark:focus:border-white/[0.1] focus:outline-none'
                      />
                    </label>
                    {hibernatedEntries.length > 0 && (
                      <>
                        <div className='my-1.5 border-t border-neutral-200 dark:border-white/[0.05]' />
                        <div className='px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-neutral-500 dark:text-neutral-600'>
                          Hibernated ({hibernatedEntries.length})
                        </div>
                        {hibernatedEntries.map(entry => (
                          <button
                            key={entry.key}
                            type='button'
                            className='w-full px-3 py-2 text-left font-mono text-[11px] flex items-center gap-2.5 hover:bg-neutral-100 dark:hover:bg-white/[0.03] text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors'
                            onClick={() => {
                              registry.restoreEntry(entry.key)
                              setActiveTab(entry.key)
                            }}
                          >
                            <i className='bx bx-play' />
                            <span className='truncate flex-1'>{resolveEntryLabel(entry)}</span>
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
              className='p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-500/10 text-neutral-500 hover:text-red-600 dark:hover:text-red-400 transition-colors'
            >
              <i className='bx bx-x text-lg' />
            </button>
          </div>
        </div>

        {/* App content - full size */}
        <div className='flex-1 min-h-0 relative'>
          {activeEntries.length === 0 ? (
            <div className='flex items-center justify-center h-full text-neutral-400 dark:text-neutral-700'>
              <div className='text-center'>
                <i className='bx bx-code-block text-4xl mb-2' />
                <p className='font-mono text-xs'>No active apps</p>
              </div>
            </div>
          ) : (
            activeEntries.map(entry => (
              <div
                key={entry.key}
                data-tab-key={entry.key}
                className={`absolute inset-0 ${entry.key === activeKey ? 'block' : 'hidden'}`}
              >
                {entry.kind === 'mcp' ? (
                  <McpAppIframeSlot
                    iframeKey={entry.key}
                    serverName={entry.serverName}
                    qualifiedToolName={entry.qualifiedToolName}
                    resourceUri={entry.resourceUri}
                    toolArgs={entry.toolArgs ?? undefined}
                    toolResult={entry.toolResult ?? undefined}
                    toolDefinition={entry.toolDefinition}
                    reloadToken={entry.reloadToken}
                    className='h-full w-full'
                    priority={1}
                  />
                ) : (
                  <HtmlIframeSlot
                    iframeKey={entry.key}
                    html={entry.html}
                    toolName={entry.toolName ?? null}
                    fullHeight
                    className='h-full w-full'
                    priority={1}
                  />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  if (!isOpen) return null

  // Main modal view
  return (
    <div
      className='fixed inset-0 z-[1400] flex flex-col'
      style={{ boxSizing: 'border-box' }}
    >
      {/* Fullscreen viewer */}
      <div
        className='relative w-full h-full bg-white/98 dark:bg-[rgba(15,15,15,0.98)] backdrop-blur-[32px] flex flex-col overflow-hidden'
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
