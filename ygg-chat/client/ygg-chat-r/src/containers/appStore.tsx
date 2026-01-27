import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { reloadCustomTools } from '../features/chats/chatActions'
import { useAppDispatch } from '../hooks/redux'
import {
  AppStoreApp,
  AppStoreDescription,
  fetchAppStoreApps,
  fetchInstalledCustomTools,
  installAppFromStore,
  restartDesktopApp,
  uninstallAppFromStore,
} from '../services/appStore'
import { environment } from '../utils/api'

type AppStoreModalProps = {
  open: boolean
  onClose: () => void
}

type AppActionStatus = {
  type: 'idle' | 'working' | 'success' | 'error'
  message: string
  restartRequired?: boolean
}

type AppActionState = {
  appId: string
  type: 'install' | 'uninstall'
}

const formatSize = (size?: number | string) => {
  if (!size) return 'n/a'
  if (typeof size === 'string') return size
  if (size < 1024) return `${size.toFixed(0)} bytes`
  const kilo = size / 1024
  if (kilo < 1024) return `${kilo.toFixed(1)} KB`
  return `${(kilo / 1024).toFixed(1)} MB`
}

const getAppSummary = (description?: AppStoreDescription) => {
  if (!description) return 'No description available yet.'
  return description.shortDescription || description.description || 'No description available yet.'
}

const getAppDisplayName = (app: AppStoreApp) => app.description.title || app.description.name || app.name || app.id

const normalizeToolId = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_')

const collectInstalledToolIndex = (tools: Array<{ name?: string; sourcePath?: string }>) => {
  const ids = new Set<string>()
  const map: Record<string, string> = {}

  const register = (value: string, prefer = false) => {
    const normalized = normalizeToolId(value)
    ids.add(normalized)
    if (prefer || !map[normalized]) {
      map[normalized] = value
    }
  }

  tools.forEach(tool => {
    if (tool.sourcePath) {
      const parts = tool.sourcePath.split(/[/\\]/)
      const dirName = parts[parts.length - 1]
      if (dirName) {
        register(dirName, true)
      }
    }
    if (tool.name) {
      register(tool.name)
    }
  })

  return { ids, map }
}

export const AppStoreModal: React.FC<AppStoreModalProps> = ({ open, onClose }) => {
  const isElectron = environment === 'electron'
  const dispatch = useAppDispatch()
  const [apps, setApps] = useState<AppStoreApp[]>([])
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [installedToolIds, setInstalledToolIds] = useState<Set<string>>(new Set())
  const [installedToolIndex, setInstalledToolIndex] = useState<Record<string, string>>({})
  const [installedLoading, setInstalledLoading] = useState(false)
  const [installedError, setInstalledError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<AppActionState | null>(null)
  const [actionStatus, setActionStatus] = useState<AppActionStatus | null>(null)

  const selectedApp = useMemo(() => {
    if (!apps.length) return null
    const found = apps.find(app => app.id === selectedAppId)
    return found || apps[0]
  }, [apps, selectedAppId])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    setLoading(true)
    setError(null)
    setActionStatus(null)

    fetchAppStoreApps()
      .then(data => {
        if (cancelled) return
        setApps(data)
        setSelectedAppId(current => {
          if (current && data.some(app => app.id === current)) return current
          return data[0]?.id || null
        })
      })
      .catch(err => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load apps')
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const reloadInstalledTools = useCallback(async () => {
    if (!isElectron) {
      setInstalledToolIds(new Set())
      setInstalledToolIndex({})
      setInstalledLoading(false)
      setInstalledError(null)
      return
    }

    setInstalledLoading(true)
    setInstalledError(null)

    try {
      const tools = await fetchInstalledCustomTools()
      const { ids, map } = collectInstalledToolIndex(tools)
      setInstalledToolIds(ids)
      setInstalledToolIndex(map)
    } catch (err) {
      setInstalledError(err instanceof Error ? err.message : 'Failed to load installed tools')
    } finally {
      setInstalledLoading(false)
    }
  }, [isElectron])

  useEffect(() => {
    if (!open) return
    void reloadInstalledTools()
  }, [open, reloadInstalledTools])

  const isAppInstalled = useCallback(
    (app: AppStoreApp) => {
      const candidates = [app.id, app.description.name, app.name].filter(Boolean) as string[]
      return candidates.some(candidate => installedToolIds.has(normalizeToolId(candidate)))
    },
    [installedToolIds]
  )

  const resolveInstalledAppId = useCallback(
    (app: AppStoreApp) => {
      const candidates = [app.id, app.description.name, app.name].filter(Boolean) as string[]
      for (const candidate of candidates) {
        const normalized = normalizeToolId(candidate)
        const resolved = installedToolIndex[normalized]
        if (resolved) return resolved
      }
      return app.id
    },
    [installedToolIndex]
  )

  useEffect(() => {
    if (!open) {
      setActionState(null)
      setActionStatus(null)
    }
  }, [open])

  const handleInstall = useCallback(async () => {
    if (!selectedApp || !selectedApp.zipUrl) {
      setActionStatus({
        type: 'error',
        message: 'No download available for this app yet.',
      })
      return
    }

    if (!isElectron) {
      setActionStatus({
        type: 'error',
        message: 'App installs are only available in the desktop app.',
      })
      return
    }

    setActionState({ appId: selectedApp.id, type: 'install' })
    setActionStatus({ type: 'working', message: 'Downloading and installing app...' })

    try {
      const result = await installAppFromStore({
        appId: selectedApp.id,
        appName: selectedApp.name,
        zipUrl: selectedApp.zipUrl,
      })

      if (!result.success) {
        throw new Error(result.error || 'Install failed')
      }

      setActionStatus({
        type: 'success',
        message: result.message || 'Installed successfully. Restart recommended.',
        restartRequired: result.restartRequired ?? true,
      })
      await reloadInstalledTools()
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Install failed',
      })
    } finally {
      setActionState(null)
    }
  }, [isElectron, reloadInstalledTools, selectedApp])

  const handleUninstall = useCallback(async () => {
    if (!selectedApp) {
      return
    }

    if (!isElectron) {
      setActionStatus({
        type: 'error',
        message: 'App uninstalls are only available in the desktop app.',
      })
      return
    }

    setActionState({ appId: selectedApp.id, type: 'uninstall' })
    setActionStatus({ type: 'working', message: 'Uninstalling app...' })

    try {
      const targetAppId = resolveInstalledAppId(selectedApp)
      const result = await uninstallAppFromStore({ appId: targetAppId })

      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed')
      }

      setActionStatus({
        type: 'success',
        message: result.message || 'Uninstalled successfully.',
        restartRequired: result.restartRequired ?? false,
      })
      await reloadInstalledTools()
      await dispatch(reloadCustomTools())
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Uninstall failed',
      })
    } finally {
      setActionState(null)
    }
  }, [dispatch, isElectron, reloadInstalledTools, resolveInstalledAppId, selectedApp])

  const handleRestart = useCallback(async () => {
    const result = await restartDesktopApp()
    if (!result.success) {
      setActionStatus({
        type: 'error',
        message: result.error || 'Failed to restart app.',
      })
    }
  }, [])

  const selectedAppInstalled = useMemo(() => {
    if (!selectedApp) return false
    return isAppInstalled(selectedApp)
  }, [isAppInstalled, selectedApp])

  const isActionInProgress = selectedApp ? actionState?.appId === selectedApp.id : false
  const isInstalling = isActionInProgress && actionState?.type === 'install'
  const isUninstalling = isActionInProgress && actionState?.type === 'uninstall'

  if (!open) return null

  return (
    <div className='fixed inset-0 z-[60] flex items-center justify-center'>
      <div
        className='fixed inset-0 z-[60] bg-neutral-300/50 dark:bg-neutral-900/20 bg-opacity-50 backdrop-blur-sm'
        onClick={onClose}
      />

      <div className='py-2 w-full max-w-6xl'>
        <div
          className='relative z-[70] mx-4 rounded-3xl px-8 lg:px-10 py-4 lg:py-6 dark:border-1 dark:border-neutral-900 bg-neutral-100 dark:bg-yBlack-900 shadow-lg overflow-y-scroll no-scrollbar transition-all duration-300 ease-in-out h-[80vh]'
          onClick={e => e.stopPropagation()}
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className='flex flex-wrap items-center justify-between gap-4 mb-3 py-4'>
            <div>
              <h2 className='text-2xl font-semibold text-stone-800 dark:text-stone-200'>App Store</h2>
              <p className='text-sm text-neutral-500 dark:text-neutral-400'>Browse and install first-party tools.</p>
            </div>
            <div className='flex items-center gap-2'>
              <div className='flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/60 p-1'>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`px-2 py-1 rounded-md text-sm transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                  aria-label='Grid view'
                >
                  <i className='bx bxs-grid-alt text-lg'></i>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-2 py-1 rounded-md text-sm transition-colors ${
                    viewMode === 'list'
                      ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                  aria-label='List view'
                >
                  <i className='bx bx-list-ul text-lg'></i>
                </button>
              </div>
              <button onClick={onClose} className='p-1 rounded-md transition-colors' aria-label='Close app store'>
                <i className='bx bx-x text-2xl text-gray-600 dark:text-gray-400 active:scale-95'></i>
              </button>
            </div>
          </div>

          <div className='grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] gap-6'>
            <div className='space-y-4'>
              {!isElectron && (
                <div className='rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'>
                  App installs are available in the desktop app. You can still browse the catalog here.
                </div>
              )}

              {installedLoading && (
                <div className='flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400'>
                  <i className='bx bx-loader-alt animate-spin'></i>
                  Checking installed apps...
                </div>
              )}

              {installedError && (
                <div className='rounded-xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'>
                  {installedError}
                </div>
              )}

              {loading && (
                <div className='flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400'>
                  <i className='bx bx-loader-alt animate-spin'></i>
                  Loading apps...
                </div>
              )}

              {error && (
                <div className='rounded-xl border border-red-200/70 bg-red-50/70 px-4 py-3 text-sm text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300'>
                  {error}
                </div>
              )}

              {!loading && !error && apps.length === 0 && (
                <div className='rounded-xl border border-neutral-200/70 bg-white/70 px-4 py-6 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-400'>
                  No apps published yet.
                </div>
              )}

              <div
                className={
                  viewMode === 'grid'
                    ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4'
                    : 'space-y-3'
                }
              >
                {apps.map(app => {
                  const displayName = getAppDisplayName(app)
                  const summary = getAppSummary(app.description)
                  const publisher = app.description.publisher || 'Unknown publisher'
                  const version = app.description.version ? `v${app.description.version}` : null
                  const isSelected = selectedApp?.id === app.id
                  const iconUrl = app.description.iconUrl || app.description.icon
                  const isInstalled = isAppInstalled(app)

                  return (
                    <button
                      key={app.id}
                      onClick={() => setSelectedAppId(app.id)}
                      className={`text-left rounded-2xl border p-4 transition-all duration-200 hover:border-blue-300/60 dark:hover:border-blue-400/50 ${
                        isSelected
                          ? 'border-blue-400 bg-blue-50/60 dark:bg-blue-500/10 shadow-sm'
                          : 'border-neutral-200/70 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/60'
                      } ${viewMode === 'list' ? 'flex items-start gap-4' : 'flex flex-col gap-3'}`}
                    >
                      <div className='flex items-start gap-3'>
                        {iconUrl ? (
                          <img
                            src={iconUrl}
                            alt={`${displayName} icon`}
                            className='h-10 w-10 rounded-lg object-cover border border-neutral-200 dark:border-neutral-700'
                          />
                        ) : (
                          <div className='h-10 w-10 rounded-lg bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-sm font-semibold text-neutral-700 dark:text-neutral-200'>
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className='min-w-0'>
                          <p className='text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate'>
                            {displayName}
                          </p>
                          <p className='text-xs text-neutral-500 dark:text-neutral-400 line-clamp-2'>{summary}</p>
                        </div>
                      </div>
                      <div className='mt-2 flex items-center justify-between text-xs text-neutral-400 dark:text-neutral-500'>
                        <span className='truncate'>{publisher}</span>
                        <span className='flex items-center gap-2'>
                          {isInstalled && (
                            <span className='px-2 py-0.5 rounded-full bg-emerald-100/70 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold uppercase tracking-wide'>
                              Installed
                            </span>
                          )}
                          {version && <span>{version}</span>}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className='rounded-2xl border border-neutral-200/70 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/60 p-5 h-fit'>
              {selectedApp ? (
                <>
                  <div className='flex items-start justify-between gap-4'>
                    <div>
                      <h3 className='text-xl font-semibold text-neutral-900 dark:text-neutral-100'>
                        {getAppDisplayName(selectedApp)}
                      </h3>
                      <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                        {selectedApp.description.publisher || 'Publisher not listed'}
                      </p>
                    </div>
                    <span className='text-xs font-mono uppercase tracking-[0.15em] text-neutral-400'>
                      {selectedApp.description.category || 'Tool'}
                    </span>
                  </div>

                  <p className='mt-4 text-sm text-neutral-600 dark:text-neutral-300'>
                    {getAppSummary(selectedApp.description)}
                  </p>

                  <div className='mt-4 grid grid-cols-2 gap-3 text-xs text-neutral-500 dark:text-neutral-400'>
                    <div>
                      <p className='uppercase tracking-[0.12em] text-[10px]'>Version</p>
                      <p className='text-sm text-neutral-700 dark:text-neutral-200'>
                        {selectedApp.description.version || 'n/a'}
                      </p>
                    </div>
                    <div>
                      <p className='uppercase tracking-[0.12em] text-[10px]'>Size</p>
                      <p className='text-sm text-neutral-700 dark:text-neutral-200'>
                        {formatSize(selectedApp.description.size)}
                      </p>
                    </div>
                    <div>
                      <p className='uppercase tracking-[0.12em] text-[10px]'>Package</p>
                      <p className='text-sm text-neutral-700 dark:text-neutral-200 truncate'>
                        {selectedApp.zipName || 'default'}
                      </p>
                    </div>
                    <div>
                      <p className='uppercase tracking-[0.12em] text-[10px]'>Updated</p>
                      <p className='text-sm text-neutral-700 dark:text-neutral-200'>
                        {selectedApp.updatedAt ? new Date(selectedApp.updatedAt).toLocaleDateString() : 'n/a'}
                      </p>
                    </div>
                  </div>

                  {selectedApp.description.tags && selectedApp.description.tags.length > 0 && (
                    <div className='mt-4 flex flex-wrap gap-2'>
                      {selectedApp.description.tags.map(tag => (
                        <span
                          key={tag}
                          className='px-2 py-1 text-xs rounded-full bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className='mt-6 flex flex-wrap items-center gap-3'>
                    {selectedAppInstalled ? (
                      <button
                        onClick={handleUninstall}
                        disabled={!isElectron || isActionInProgress}
                        className='px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2'
                      >
                        {isUninstalling ? (
                          <>
                            <i className='bx bx-loader-alt animate-spin text-base'></i>
                            Uninstalling...
                          </>
                        ) : (
                          <>
                            <i className='bx bx-trash text-base'></i>
                            Uninstall
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={handleInstall}
                        disabled={!isElectron || isActionInProgress}
                        className='px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2'
                      >
                        {isInstalling ? (
                          <>
                            <i className='bx bx-loader-alt animate-spin text-base'></i>
                            Installing...
                          </>
                        ) : (
                          <>
                            <i className='bx bx-download text-base'></i>
                            Download & Install
                          </>
                        )}
                      </button>
                    )}
                    {selectedApp.descriptionUrl && (
                      <a
                        href={selectedApp.descriptionUrl}
                        target='_blank'
                        rel='noreferrer'
                        className='text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors'
                      >
                        View description
                      </a>
                    )}
                  </div>

                  {actionStatus && (
                    <div
                      className={`mt-4 flex items-center gap-2 text-sm ${
                        actionStatus.type === 'error'
                          ? 'text-red-500'
                          : actionStatus.type === 'success'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-neutral-500 dark:text-neutral-400'
                      }`}
                    >
                      {actionStatus.type === 'working' && <i className='bx bx-loader-alt animate-spin'></i>}
                      {actionStatus.type === 'success' && <i className='bx bx-check-circle'></i>}
                      {actionStatus.type === 'error' && <i className='bx bx-error-circle'></i>}
                      <span>{actionStatus.message}</span>
                    </div>
                  )}

                  {actionStatus?.restartRequired && (
                    <div className='mt-3 flex flex-wrap items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400'>
                      <span>Restart Yggdrasil to finish installation.</span>
                      <button
                        onClick={handleRestart}
                        className='px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs text-neutral-700 dark:text-neutral-200 hover:border-blue-300 hover:text-blue-600 transition-colors'
                      >
                        Restart now
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className='text-sm text-neutral-500 dark:text-neutral-400'>Select an app to see details.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
