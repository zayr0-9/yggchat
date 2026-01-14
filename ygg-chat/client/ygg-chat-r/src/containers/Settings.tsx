import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Select } from '../components'
import { selectProviderState } from '../features/chats'
import { fetchCustomTools, fetchTools, updateToolEnabled } from '../features/chats/chatActions'
import { getAllTools } from '../features/chats/toolDefinitions'
import {
  addCustomVideo,
  clearCustomVideoLibrary,
  CustomVideoEntry,
  loadActiveCustomVideoId,
  loadSavedVideos,
  persistActiveCustomVideoId,
  removeCustomVideo,
  updateCustomVideoTextColorMode,
  VIDEO_BACKGROUND_CHANGE_EVENT,
} from '../helpers/videoBackgroundStorage'
import {
  loadProviderSettings,
  PROVIDER_SETTINGS_CHANGE_EVENT,
  ProviderSettings,
  saveProviderSettings,
} from '../helpers/providerSettingsStorage'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { API_BASE } from '../utils/api'

const MAX_UPLOAD_SIZE_BYTES = 8 * 1024 * 1024 // 8MB

type StatusMessage = {
  type: 'success' | 'error' | 'info'
  text: string
}

const formatSize = (size?: number) => {
  if (!size) {
    return 'n/a'
  }

  if (size < 1024) {
    return `${size.toFixed(0)} bytes`
  }

  const kilo = size / 1024
  if (kilo < 1024) {
    return `${kilo.toFixed(1)} KB`
  }

  return `${(kilo / 1024).toFixed(1)} MB`
}

interface GoogleDriveStatus {
  connected: boolean
  connectedAt: string | null
  lastUsedAt: string | null
}

const Settings: React.FC = () => {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { accessToken } = useAuth()
  const providers = useAppSelector(selectProviderState)

  // Tools state
  const tools = getAllTools()
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [updatingTools, setUpdatingTools] = useState<Set<string>>(new Set())
  const [reloadingTools, setReloadingTools] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const timeoutRef = useRef<number | null>(null)
  const [videos, setVideos] = useState<CustomVideoEntry[]>(() => loadSavedVideos())
  const [activeVideoId, setActiveVideoId] = useState<string | null>(() => loadActiveCustomVideoId())
  const [uploading, setUploading] = useState(false)
  const [googleConnecting, setGoogleConnecting] = useState(false)
  const [googleDisconnecting, setGoogleDisconnecting] = useState(false)
  const [googleDriveStatus, setGoogleDriveStatus] = useState<GoogleDriveStatus | null>(null)
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings())

  // Fetch Google Drive connection status
  const fetchGoogleDriveStatus = async () => {
    if (!accessToken) return
    try {
      const response = await fetch(`${API_BASE}/oauth/google-drive/status`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (response.ok) {
        const status = await response.json()
        setGoogleDriveStatus(status)
      }
    } catch (error) {
      console.error('Failed to fetch Google Drive status:', error)
    }
  }

  useEffect(() => {
    fetchGoogleDriveStatus()
  }, [accessToken])

  useEffect(() => {
    const handleBackgroundChange = () => {
      setVideos(loadSavedVideos())
      setActiveVideoId(loadActiveCustomVideoId())
    }

    window.addEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
    return () => window.removeEventListener(VIDEO_BACKGROUND_CHANGE_EVENT, handleBackgroundChange)
  }, [])

  useEffect(() => {
    const handleProviderSettingsChange = (e: CustomEvent<ProviderSettings>) => {
      setProviderSettings(e.detail)
    }

    window.addEventListener(PROVIDER_SETTINGS_CHANGE_EVENT, handleProviderSettingsChange as EventListener)
    return () => window.removeEventListener(PROVIDER_SETTINGS_CHANGE_EVENT, handleProviderSettingsChange as EventListener)
  }, [])

  const handleProviderVisibilityToggle = () => {
    const updated = {
      ...providerSettings,
      showProviderSelector: !providerSettings.showProviderSelector,
    }
    saveProviderSettings(updated)
    setProviderSettings(updated)
    showStatus({
      type: 'success',
      text: updated.showProviderSelector ? 'Provider selector will be visible.' : 'Provider selector hidden.',
    })
  }

  const handleDefaultProviderChange = (providerName: string) => {
    const updated = {
      ...providerSettings,
      defaultProvider: providerName || null,
    }
    saveProviderSettings(updated)
    setProviderSettings(updated)
    showStatus({ type: 'success', text: providerName ? `Default provider set to "${providerName}".` : 'Default provider cleared.' })
  }

  // Tool handlers
  const handleToolToggle = async (toolName: string, currentEnabled: boolean) => {
    setUpdatingTools(prev => new Set(prev).add(toolName))
    try {
      await dispatch(updateToolEnabled({ toolName, enabled: !currentEnabled })).unwrap()
      showStatus({ type: 'success', text: `${toolName} ${!currentEnabled ? 'enabled' : 'disabled'}.` })
    } catch (error) {
      console.error('Failed to update tool:', error)
      showStatus({ type: 'error', text: `Failed to update ${toolName}.` })
    } finally {
      setUpdatingTools(prev => {
        const newSet = new Set(prev)
        newSet.delete(toolName)
        return newSet
      })
    }
  }

  const handleReloadTools = async () => {
    setReloadingTools(true)
    try {
      await dispatch(fetchCustomTools())
      await dispatch(fetchTools())
      showStatus({ type: 'success', text: 'Tools reloaded.' })
    } catch (err) {
      console.error('Failed to reload tools:', err)
      showStatus({ type: 'error', text: 'Failed to reload tools.' })
    } finally {
      setReloadingTools(false)
    }
  }

  const showStatus = (message: StatusMessage) => {
    setStatusMessage(message)
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    timeoutRef.current = window.setTimeout(() => setStatusMessage(null), 4000)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    if (!['video/mp4', 'video/webm'].includes(file.type)) {
      showStatus({ type: 'error', text: 'Video must be in MP4 or WebM format.' })
      return
    }

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      showStatus({ type: 'error', text: 'File must be smaller than 8MB to keep localStorage responsive.' })
      return
    }

    setUploading(true)

    try {
      const entry = await addCustomVideo({
        mimeType: file.type,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        blob: file,
      })

      persistActiveCustomVideoId(entry.id)
      setVideos(loadSavedVideos())
      setActiveVideoId(entry.id)
      showStatus({ type: 'success', text: 'Custom video saved and activated.' })
    } catch (error) {
      console.error(error)
      showStatus({ type: 'error', text: 'Unable to save the custom video. Try again.' })
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleSelectVideo = (id: string) => {
    persistActiveCustomVideoId(id)
    setActiveVideoId(id)
    showStatus({ type: 'success', text: 'Active background updated.' })
  }

  const handleRemoveVideo = (id: string) => {
    removeCustomVideo(id)
    setVideos(loadSavedVideos())
    if (activeVideoId === id) {
      setActiveVideoId(null)
    }
    showStatus({ type: 'info', text: 'Video removed from gallery.' })
  }

  const handleClearGallery = () => {
    clearCustomVideoLibrary()
    setVideos([])
    setActiveVideoId(null)
    showStatus({ type: 'success', text: 'Gallery cleared. Default wallpapers will be used.' })
  }

  const handleResetToDefault = () => {
    persistActiveCustomVideoId(null)
    setActiveVideoId(null)
    showStatus({ type: 'success', text: 'Reverted to the built-in defaults.' })
  }

  const handleTextColorModeChange = (id: string, mode: 'light' | 'dark' | 'auto') => {
    updateCustomVideoTextColorMode(id, mode)
    setVideos(loadSavedVideos())
    showStatus({ type: 'success', text: `Text color mode set to "${mode}".` })
  }

  const handleGoogleDriveConnect = async () => {
    if (!accessToken) {
      showStatus({ type: 'error', text: 'Sign in required to connect Google Drive.' })
      return
    }

    setGoogleConnecting(true)
    try {
      const response = await fetch(`${API_BASE}/oauth/google-drive/start`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to start Google Drive connection.')
      }

      if (!payload?.authUrl) {
        throw new Error('No Google authorization URL returned.')
      }

      if (window.electronAPI?.auth?.openExternal) {
        const result = await window.electronAPI.auth.openExternal(payload.authUrl)
        if (!result?.success) {
          window.open(payload.authUrl, '_blank', 'noopener,noreferrer')
        }
      } else {
        window.open(payload.authUrl, '_blank', 'noopener,noreferrer')
      }

      showStatus({
        type: 'info',
        text: 'Google Drive sign-in opened in your browser. Refresh this page after signing in.',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open Google Drive sign-in.'
      showStatus({ type: 'error', text: message })
    } finally {
      setGoogleConnecting(false)
    }
  }

  const handleGoogleDriveDisconnect = async () => {
    if (!accessToken) return

    setGoogleDisconnecting(true)
    try {
      const response = await fetch(`${API_BASE}/oauth/google-drive/disconnect`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        throw new Error('Failed to disconnect Google Drive.')
      }

      setGoogleDriveStatus({ connected: false, connectedAt: null, lastUsedAt: null })
      showStatus({ type: 'success', text: 'Google Drive disconnected.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to disconnect Google Drive.'
      showStatus({ type: 'error', text: message })
    } finally {
      setGoogleDisconnecting(false)
    }
  }

  const renderStatus = () => {
    if (!statusMessage) return null

    const colors = {
      success:
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-900/40 dark:border-emerald-800 dark:text-emerald-200',
      error: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-900/40 dark:border-rose-800 dark:text-rose-200',
      info: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-900/40 dark:border-sky-800 dark:text-sky-200',
    }

    return (
      <div className={`rounded-lg border px-4 py-2 text-sm ${colors[statusMessage.type]}`}>{statusMessage.text}</div>
    )
  }

  return (
    <div className='h-full overflow-y-auto bg-transparent min-h-full'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <p className='text-sm uppercase tracking-[0.3em] video-light:text-neutral-100 video-dark:text-neutral-900'>
              Background
            </p>
            <h1 className='text-3xl font-semibold video-light:text-neutral-100 video-dark:text-neutral-900 '>
              Custom Wallpaper
            </h1>
            <p className='mt-1 text-sm video-light:text-neutral-100 video-dark:text-neutral-900'>
              Upload up to 8MB MP4/WebM clips and switch between them in one place.
            </p>
          </div>
          <Button variant='acrylic' onClick={() => navigate('/homepage')} className='group'>
            <p className='transition-transform duration-100 group-active:scale-95'>Back to Home</p>
          </Button>
        </header>

        {renderStatus()}

        {/* Provider Settings Section */}
        {import.meta.env.VITE_ENVIRONMENT === 'electron' && (
          <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
            <div className='flex flex-col gap-1'>
              <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Provider Settings</h2>
              <p className='text-sm text-stone-500 dark:text-stone-200'>
                Configure how providers appear in the chat interface.
              </p>
            </div>

            <div className='mt-4 flex flex-col gap-4'>
              {/* Visibility Toggle */}
              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Show Provider Selector</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    Toggle visibility of the provider dropdown in the chat.
                  </p>
                </div>
                <button
                  onClick={handleProviderVisibilityToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    providerSettings.showProviderSelector
                      ? 'bg-emerald-500 dark:bg-emerald-600'
                      : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      providerSettings.showProviderSelector ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Default Provider Selection - shown when selector is hidden */}
              {!providerSettings.showProviderSelector && (
                <div className='flex flex-col gap-2 pt-2 border-t border-stone-200 dark:border-stone-700'>
                  <div>
                    <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Default Provider</p>
                    <p className='text-sm text-stone-500 dark:text-stone-400'>
                      This provider will be used automatically when the selector is hidden.
                    </p>
                  </div>
                  <Select
                    value={providerSettings.defaultProvider || ''}
                    onChange={handleDefaultProviderChange}
                    options={providers.providers.map(p => p.name)}
                    placeholder='Select a default provider...'
                    disabled={providers.providers.length === 0}
                    className='max-w-xs'
                  />
                  {providers.providers.length === 0 && (
                    <p className='text-xs text-amber-600 dark:text-amber-400'>
                      No providers available. Open a chat first to load providers.
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Tools Settings Section - Collapsible */}
        {import.meta.env.VITE_ENVIRONMENT === 'electron' && (
          <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
            <button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              className='w-full flex items-center justify-between text-left'
            >
              <div className='flex flex-col gap-1'>
                <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100'>Tools Configuration</h2>
                <p className='text-sm text-stone-500 dark:text-stone-200'>
                  Enable or disable AI tools. Changes apply to all new conversations.
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-sm text-stone-500 dark:text-stone-400'>
                  {tools.filter(t => t.enabled).length}/{tools.length} enabled
                </span>
                <i
                  className={`bx bx-chevron-down text-2xl text-stone-500 dark:text-stone-400 transition-transform duration-200 ${
                    toolsExpanded ? 'rotate-180' : ''
                  }`}
                ></i>
              </div>
            </button>

            {/* Collapsible content */}
            <div
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                toolsExpanded ? 'max-h-[2000px] opacity-100 mt-4' : 'max-h-0 opacity-0'
              }`}
            >
              {/* Reload button */}
              <div className='flex justify-end mb-3'>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={handleReloadTools}
                  disabled={reloadingTools}
                  className='flex items-center gap-1.5'
                >
                  <i className={`bx bx-refresh text-base ${reloadingTools ? 'animate-spin' : ''}`}></i>
                  {reloadingTools ? 'Reloading...' : 'Reload Tools'}
                </Button>
              </div>

              {/* Tools list */}
              <div className='space-y-2'>
                {tools.map(tool => (
                  <div
                    key={tool.name}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      tool.isCustom
                        ? 'border-orange-300 dark:border-orange-600/50 bg-orange-50/50 dark:bg-orange-900/10'
                        : 'border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-800/30'
                    }`}
                  >
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2'>
                        <span className='font-medium text-stone-800 dark:text-stone-200 truncate'>
                          {tool.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        {tool.isCustom && (
                          <span className='text-xs px-1.5 py-0.5 rounded bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-300 flex-shrink-0'>
                            Custom
                          </span>
                        )}
                      </div>
                      <p className='text-sm text-stone-500 dark:text-stone-400 truncate mt-0.5'>
                        {tool.description}
                      </p>
                    </div>
                    <button
                      onClick={() => handleToolToggle(tool.name, tool.enabled)}
                      disabled={updatingTools.has(tool.name)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-3 flex-shrink-0 ${
                        tool.enabled
                          ? 'bg-emerald-500 dark:bg-emerald-600'
                          : 'bg-stone-300 dark:bg-stone-600'
                      } ${updatingTools.has(tool.name) ? 'opacity-50 cursor-wait' : ''}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          tool.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>

              {tools.length === 0 && (
                <p className='text-sm text-stone-500 dark:text-stone-400 text-center py-4'>
                  No tools available. Reload to check for new tools.
                </p>
              )}
            </div>
          </section>
        )}

        {false && (
          <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
            <div className='flex flex-col gap-1'>
              <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Services</h2>
              <p className='text-sm text-stone-500 dark:text-stone-200'>
                Connect third-party services so tools can access them through the proxy.
              </p>
            </div>
            <div className='mt-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between'>
              <div className='flex items-center gap-3'>
                <div>
                  <div className='flex items-center gap-2'>
                    <p className='text-base font-semibold text-stone-900 dark:text-stone-100'>Google Drive</p>
                    {googleDriveStatus?.connected && (
                      <span className='rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'>
                        Connected
                      </span>
                    )}
                  </div>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    {googleDriveStatus?.connected
                      ? `Connected ${googleDriveStatus.connectedAt ? new Date(googleDriveStatus.connectedAt).toLocaleDateString() : ''}`
                      : 'Sign in once to enable Drive-powered tools.'}
                  </p>
                </div>
              </div>
              <div className='flex gap-2'>
                {googleDriveStatus?.connected ? (
                  <>
                    <Button
                      variant='outline2'
                      size='large'
                      onClick={handleGoogleDriveConnect}
                      disabled={googleConnecting}
                      className='group'
                    >
                      <p className='transition-transform duration-100 group-active:scale-95'>
                        {googleConnecting ? 'Opening…' : 'Reconnect'}
                      </p>
                    </Button>
                    <Button
                      variant='outline2'
                      size='large'
                      onClick={handleGoogleDriveDisconnect}
                      disabled={googleDisconnecting}
                      className='group text-rose-600 hover:text-rose-700 dark:text-rose-400'
                    >
                      <p className='transition-transform duration-100 group-active:scale-95'>
                        {googleDisconnecting ? 'Disconnecting…' : 'Disconnect'}
                      </p>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant='outline2'
                    size='large'
                    onClick={handleGoogleDriveConnect}
                    disabled={googleConnecting}
                    className='group'
                  >
                    <p className='transition-transform duration-100 group-active:scale-95'>
                      {googleConnecting ? 'Opening…' : 'Connect Google Drive'}
                    </p>
                  </Button>
                )}
              </div>
            </div>
          </section>
        )}

        <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Custom Upload</h2>
            <p className='text-sm text-stone-500 dark:text-stone-200'>
              Drag in an MP4 or WebM and we’ll keep it ready for whenever you want that motion.
            </p>
          </div>

          <div className='mt-2 flex flex-col gap-4 lg:flex-row lg:items-center'>
            <div className='flex-1 space-y-1 py-2'>
              <p className='text-sm mb-4 text-stone-500 dark:text-stone-200'>
                Accepted formats: MP4, WebM · Max size 8MB.
              </p>
              <div className='rounded-xl border border-dashed border-stone-200 bg-stone-50/80 p-4 text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-800/60 dark:text-stone-200'>
                <p>Uploaded wallpapers appear below. You can switch between them at any time.</p>
              </div>
            </div>

            <div className='flex gap-3 lg:pt-8'>
              <input
                ref={fileInputRef}
                type='file'
                accept='video/mp4,video/webm'
                className='hidden'
                onChange={handleFileChange}
              />
              <Button
                variant='outline2'
                size='large'
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className='group shadow-md'
              >
                <p className='transition-transform duration-100 group-active:scale-95'>
                  {uploading ? 'Processing…' : 'Browse for video'}
                </p>
              </Button>
            </div>
          </div>
        </section>

        <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:bg-zinc-900 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100'>Saved Wallpapers</h2>
                <p className='text-sm text-stone-500 dark:text-stone-400'>Select or delete any saved clip.</p>
              </div>
              <div className='flex flex-wrap gap-2'>
                <Button variant='outline2' size='small' onClick={handleResetToDefault} className='group'>
                  <p className='transition-transform duration-100 group-active:scale-95'>Reset to Default</p>
                </Button>
                <Button variant='outline2' size='small' onClick={handleClearGallery} className='group'>
                  <p className='transition-transform duration-100 group-active:scale-95'>Clear Gallery</p>
                </Button>
              </div>
            </div>
          </div>

          <div className='mt-5 grid gap-4 md:grid-cols-2'>
            {videos.length === 0 ? (
              <div className='col-span-full rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/80 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-900/60 dark:text-stone-400'>
                No saved wallpapers yet. Upload a video to get started.
              </div>
            ) : (
              videos.map(video => {
                const isActive = video.id === activeVideoId
                return (
                  <div
                    key={video.id}
                    className={`flex flex-col gap-3 rounded-xl border p-4 transition ${
                      isActive
                        ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-500/60 dark:bg-emerald-900/40'
                        : 'border-stone-200 bg-stone-50/70 hover:border-indigo-400 dark:hover:bg-neutral-700/40 dark:border-stone-700 dark:bg-zinc-900/70 dark:hover:border-sky-600'
                    }`}
                  >
                    <div className='flex items-start justify-between gap-3'>
                      <div>
                        <p className='text-base font-semibold text-stone-900 dark:text-stone-100'>
                          {video.name || 'Uploaded wallpaper'}
                        </p>
                        <p className='text-xs text-stone-500 dark:text-stone-400'>
                          {video.mimeType} · {formatSize(video.size)}
                        </p>
                        <p className='text-xs text-stone-400 dark:text-stone-500'>
                          Added {new Date(video.createdAt).toLocaleString()}
                        </p>
                      </div>
                      {isActive && (
                        <span className='rounded-full border border-emerald-300 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:border-emerald-500/60 dark:text-emerald-200'>
                          Active
                        </span>
                      )}
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button
                        variant={isActive ? 'primary' : 'outline2'}
                        size='small'
                        onClick={() => handleSelectVideo(video.id)}
                        className='group'
                      >
                        <p className='transition-transform duration-100 group-active:scale-95'>
                          {isActive ? 'Selected' : 'Use this wallpaper'}
                        </p>
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => handleRemoveVideo(video.id)}
                        className='group'
                      >
                        <p className='transition-transform duration-100 group-active:scale-95'>Remove</p>
                      </Button>
                      <div className='ml-auto flex items-center gap-1'>
                        <span className='text-xs text-stone-500 dark:text-stone-400 mr-1'>Text:</span>
                        {(['auto', 'light', 'dark'] as const).map(mode => {
                          const currentMode = video.textColorMode ?? 'auto'
                          const isSelected = currentMode === mode
                          return (
                            <button
                              key={mode}
                              onClick={() => handleTextColorModeChange(video.id, mode)}
                              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                                isSelected
                                  ? 'bg-indigo-500 text-white dark:bg-indigo-600'
                                  : 'bg-stone-200 text-stone-600 hover:bg-stone-300 dark:bg-zinc-700 dark:text-stone-300 dark:hover:bg-zinc-600'
                              }`}
                              title={
                                mode === 'auto'
                                  ? 'Follow system theme'
                                  : mode === 'light'
                                    ? 'Light text (for dark videos)'
                                    : 'Dark text (for light videos)'
                              }
                            >
                              {mode === 'auto' ? 'Auto' : mode === 'light' ? 'Light' : 'Dark'}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default Settings
