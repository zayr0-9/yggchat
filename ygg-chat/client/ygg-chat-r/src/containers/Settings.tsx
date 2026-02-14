import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { useNavigate } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import changelogMarkdown from '../../CHANGELOG.md?raw'
import { Button, Select } from '../components'
import { useHtmlIframeRegistry } from '../components/HtmlIframeRegistry/HtmlIframeRegistry'
import { chatSliceActions, selectProviderState } from '../features/chats'
import { fetchCustomTools, fetchTools, updateToolEnabled } from '../features/chats/chatActions'
import { clearTokens as clearOpenAITokens, isOpenAIAuthenticated } from '../features/chats/openaiOAuth'
import { getAllTools } from '../features/chats/toolDefinitions'
import {
  AGENT_SETTINGS_CHANGE_EVENT,
  AgentSettings,
  loadAgentSettings,
  saveAgentSettings,
} from '../helpers/agentSettingsStorage'
import {
  CHAT_REASONING_SETTINGS_CHANGE_EVENT,
  ChatReasoningSettings,
  loadChatReasoningSettings,
  REASONING_EFFORT_OPTIONS,
  saveChatReasoningSettings,
} from '../helpers/chatReasoningSettingsStorage'
import { loadShowTokenUsageBar, saveShowTokenUsageBar } from '../helpers/chatUiSettingsStorage'
import {
  loadProviderSettings,
  MAX_OPENROUTER_TEMPERATURE,
  MIN_OPENROUTER_TEMPERATURE,
  PROVIDER_SETTINGS_CHANGE_EVENT,
  ProviderSettings,
  saveProviderSettings,
} from '../helpers/providerSettingsStorage'
import {
  loadStartupLandingPreference,
  saveStartupLandingPreference,
  type StartupLandingPreference,
} from '../helpers/startupPreferences'
import {
  loadToolExecutionSettings,
  MAX_BASH_TIMEOUT_MS,
  MIN_BASH_TIMEOUT_MS,
  saveToolExecutionSettings,
  TOOL_EXECUTION_SETTINGS_CHANGE_EVENT,
  ToolExecutionSettings,
} from '../helpers/toolExecutionSettings'
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
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { useModels } from '../hooks/useQueries'
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
  const htmlRegistry = useHtmlIframeRegistry()
  const htmlEntries = htmlRegistry?.entries.filter(entry => entry.kind === 'html') ?? []

  // Tools state
  const tools = getAllTools()
  const [toolsExpanded, setToolsExpanded] = useState(false)
  const [htmlToolsExpanded, setHtmlToolsExpanded] = useState(false)
  const [agentToolsExpanded, setAgentToolsExpanded] = useState(false)
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
  const [isChangelogOpen, setIsChangelogOpen] = useState(false)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings())
  const [openRouterTemperatureInput, setOpenRouterTemperatureInput] = useState<string>(() => {
    const configured = loadProviderSettings().openRouterTemperature
    return typeof configured === 'number' ? String(configured) : ''
  })
  const [openRouterTemperatureTouched, setOpenRouterTemperatureTouched] = useState(false)
  const [toolExecutionSettings, setToolExecutionSettings] = useState<ToolExecutionSettings>(() =>
    loadToolExecutionSettings()
  )
  const [bashTimeoutInput, setBashTimeoutInput] = useState<string>(() =>
    String(loadToolExecutionSettings().bashTimeoutMs)
  )
  const [bashTimeoutTouched, setBashTimeoutTouched] = useState(false)
  const [startupLandingPreference, setStartupLandingPreference] = useState<StartupLandingPreference>(() =>
    loadStartupLandingPreference()
  )
  const [chatReasoningSettings, setChatReasoningSettings] = useState<ChatReasoningSettings>(() =>
    loadChatReasoningSettings()
  )
  const [showTokenUsageBar, setShowTokenUsageBar] = useState<boolean>(() => loadShowTokenUsageBar())
  const [agentSettings, setAgentSettings] = useState<AgentSettings>({
    heartbeatTime: null,
    agentName: 'Global Agent',
    model: null,
    modelContextLength: null,
    loopIntervalMs: 60000,
    autoResume: true,
    toolAllowlist: null,
    workDirectory: null,
  })
  const [workDirectoryInput, setWorkDirectoryInput] = useState('')
  const [workDirectoryTouched, setWorkDirectoryTouched] = useState(false)
  const [loopIntervalInput, setLoopIntervalInput] = useState('60000')
  const [loopIntervalTouched, setLoopIntervalTouched] = useState(false)
  const [agentSettingsLoading, setAgentSettingsLoading] = useState(true)
  const [agentSettingsSaving, setAgentSettingsSaving] = useState(false)
  const { data: openRouterModelsData } = useModels('OpenRouter')

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
    return () =>
      window.removeEventListener(PROVIDER_SETTINGS_CHANGE_EVENT, handleProviderSettingsChange as EventListener)
  }, [])

  useEffect(() => {
    if (openRouterTemperatureTouched) return
    const configured = providerSettings.openRouterTemperature
    setOpenRouterTemperatureInput(typeof configured === 'number' ? String(configured) : '')
  }, [providerSettings.openRouterTemperature, openRouterTemperatureTouched])

  useEffect(() => {
    const handleToolExecutionSettingsChange = (e: CustomEvent<ToolExecutionSettings>) => {
      setToolExecutionSettings(e.detail)
    }

    window.addEventListener(TOOL_EXECUTION_SETTINGS_CHANGE_EVENT, handleToolExecutionSettingsChange as EventListener)
    return () =>
      window.removeEventListener(
        TOOL_EXECUTION_SETTINGS_CHANGE_EVENT,
        handleToolExecutionSettingsChange as EventListener
      )
  }, [])

  useEffect(() => {
    const handleChatReasoningSettingsChange = (e: CustomEvent<ChatReasoningSettings>) => {
      setChatReasoningSettings(e.detail)
    }

    window.addEventListener(CHAT_REASONING_SETTINGS_CHANGE_EVENT, handleChatReasoningSettingsChange as EventListener)
    return () =>
      window.removeEventListener(
        CHAT_REASONING_SETTINGS_CHANGE_EVENT,
        handleChatReasoningSettingsChange as EventListener
      )
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
    showStatus({
      type: 'success',
      text: providerName ? `Default provider set to "${providerName}".` : 'Default provider cleared.',
    })
  }

  const handleOpenAIChatGPTSignOut = () => {
    clearOpenAITokens()
    if (providers.currentProvider === 'OpenAI (ChatGPT)') {
      dispatch(chatSliceActions.providerSelected('OpenRouter'))
    }
    showStatus({ type: 'success', text: 'Signed out of OpenAI ChatGPT. You can sign in again from Chat.' })
  }

  const handleOpenRouterTemperatureInputChange = (value: string) => {
    setOpenRouterTemperatureInput(value)
    setOpenRouterTemperatureTouched(true)
  }

  const commitOpenRouterTemperatureChange = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      const updated = {
        ...providerSettings,
        openRouterTemperature: null,
      }
      saveProviderSettings(updated)
      setProviderSettings(updated)
      setOpenRouterTemperatureTouched(false)
      setOpenRouterTemperatureInput('')
      showStatus({ type: 'success', text: 'OpenRouter temperature reset to model default.' })
      return
    }

    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      setOpenRouterTemperatureTouched(false)
      setOpenRouterTemperatureInput(
        typeof providerSettings.openRouterTemperature === 'number' ? String(providerSettings.openRouterTemperature) : ''
      )
      showStatus({ type: 'error', text: 'OpenRouter temperature must be a number between 0 and 2.' })
      return
    }

    const clamped = Math.max(MIN_OPENROUTER_TEMPERATURE, Math.min(MAX_OPENROUTER_TEMPERATURE, parsed))
    const normalized = Math.round(clamped * 100) / 100
    const updated = {
      ...providerSettings,
      openRouterTemperature: normalized,
    }
    saveProviderSettings(updated)
    setProviderSettings(updated)
    setOpenRouterTemperatureTouched(false)
    setOpenRouterTemperatureInput(String(normalized))

    if (normalized !== parsed) {
      showStatus({
        type: 'info',
        text: `OpenRouter temperature adjusted to ${normalized} (allowed range ${MIN_OPENROUTER_TEMPERATURE}-${MAX_OPENROUTER_TEMPERATURE}).`,
      })
      return
    }

    showStatus({ type: 'success', text: 'OpenRouter temperature updated.' })
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

  const handleStartupLandingPreferenceChange = (value: string) => {
    const nextPreference: StartupLandingPreference = value === 'latest-chat' ? 'latest-chat' : 'homepage'
    saveStartupLandingPreference(nextPreference)
    setStartupLandingPreference(nextPreference)
    showStatus({
      type: 'success',
      text:
        nextPreference === 'latest-chat'
          ? 'Startup default set to Latest Chat.'
          : 'Startup default set to Homepage.',
    })
  }

  const handleDefaultThinkingToggle = () => {
    const updated: ChatReasoningSettings = {
      ...chatReasoningSettings,
      defaultThinkingEnabled: !chatReasoningSettings.defaultThinkingEnabled,
    }
    saveChatReasoningSettings(updated)
    setChatReasoningSettings(updated)
    showStatus({
      type: 'success',
      text: updated.defaultThinkingEnabled
        ? 'Default thinking enabled for reasoning-capable models.'
        : 'Default thinking disabled.',
    })
  }

  const handleTokenUsageBarToggle = () => {
    const nextValue = !showTokenUsageBar
    saveShowTokenUsageBar(nextValue)
    setShowTokenUsageBar(nextValue)
    showStatus({
      type: 'success',
      text: nextValue ? 'Token usage bar enabled in Chat.' : 'Token usage bar hidden in Chat.',
    })
  }

  const handleDefaultReasoningEffortChange = (value: string) => {
    const effort = REASONING_EFFORT_OPTIONS.includes(value as (typeof REASONING_EFFORT_OPTIONS)[number])
      ? (value as ChatReasoningSettings['defaultReasoningEffort'])
      : 'medium'
    const updated: ChatReasoningSettings = {
      ...chatReasoningSettings,
      defaultReasoningEffort: effort,
    }
    saveChatReasoningSettings(updated)
    setChatReasoningSettings(updated)
    showStatus({
      type: 'success',
      text: `Default reasoning effort set to ${effort}.`,
    })
  }

  useEffect(() => {
    if (import.meta.env.VITE_ENVIRONMENT !== 'electron') {
      setAgentSettingsLoading(false)
      return
    }

    let isActive = true

    loadAgentSettings()
      .then(settings => {
        if (!isActive) return
        setAgentSettings(settings)
      })
      .catch(error => {
        console.error('Failed to load agent settings:', error)
        if (isActive) {
          showStatus({ type: 'error', text: 'Failed to load global agent settings.' })
        }
      })
      .finally(() => {
        if (isActive) {
          setAgentSettingsLoading(false)
        }
      })

    const handleAgentSettingsChange = (e: CustomEvent<AgentSettings>) => {
      if (!isActive) return
      setAgentSettings(e.detail)
    }

    window.addEventListener(AGENT_SETTINGS_CHANGE_EVENT, handleAgentSettingsChange as EventListener)
    return () => {
      isActive = false
      window.removeEventListener(AGENT_SETTINGS_CHANGE_EVENT, handleAgentSettingsChange as EventListener)
    }
  }, [])

  useEffect(() => {
    if (agentSettingsLoading || import.meta.env.VITE_ENVIRONMENT !== 'electron') return
    if (agentSettings.toolAllowlist && agentSettings.toolAllowlist.length > 0) return

    const defaultAllowlist = tools.filter(tool => tool.enabled || tool.name === 'bash').map(tool => tool.name)

    if (defaultAllowlist.length === 0) return

    const nextSettings = { ...agentSettings, toolAllowlist: defaultAllowlist }
    setAgentSettings(nextSettings)
    saveAgentSettings(nextSettings).catch(error => {
      console.error('Failed to persist default global agent tools:', error)
    })
  }, [agentSettings, agentSettingsLoading, tools])

  useEffect(() => {
    if (workDirectoryTouched) return
    setWorkDirectoryInput(agentSettings.workDirectory ?? '')
  }, [agentSettings.workDirectory, workDirectoryTouched])

  useEffect(() => {
    if (loopIntervalTouched) return
    setLoopIntervalInput(String(agentSettings.loopIntervalMs ?? 60000))
  }, [agentSettings.loopIntervalMs, loopIntervalTouched])

  useEffect(() => {
    if (bashTimeoutTouched) return
    setBashTimeoutInput(String(toolExecutionSettings.bashTimeoutMs))
  }, [toolExecutionSettings.bashTimeoutMs, bashTimeoutTouched])

  useEffect(() => {
    if (!isChangelogOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsChangelogOpen(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isChangelogOpen])

  const persistAgentSettings = async (nextSettings: AgentSettings, successText: string, errorText: string) => {
    setAgentSettings(nextSettings)

    if (import.meta.env.VITE_ENVIRONMENT !== 'electron') {
      return
    }

    setAgentSettingsSaving(true)
    try {
      const saved = await saveAgentSettings(nextSettings)
      setAgentSettings(saved)
      showStatus({ type: 'success', text: successText })
    } catch (error) {
      console.error('Failed to save agent settings:', error)
      showStatus({ type: 'error', text: errorText })
      try {
        const refreshed = await loadAgentSettings()
        setAgentSettings(refreshed)
      } catch (refreshError) {
        console.error('Failed to reload agent settings:', refreshError)
      }
    } finally {
      setAgentSettingsSaving(false)
    }
  }

  const handleHeartbeatTimeChange = async (value: string) => {
    const nextHeartbeat = value.trim().length > 0 ? value : null
    const nextSettings = { ...agentSettings, heartbeatTime: nextHeartbeat }
    await persistAgentSettings(
      nextSettings,
      nextHeartbeat ? 'Heartbeat time updated.' : 'Heartbeat disabled.',
      'Failed to update heartbeat time.'
    )
  }

  const handleAgentNameChange = async (value: string) => {
    const nextName = value.trim().length > 0 ? value.trim() : 'Global Agent'
    await persistAgentSettings(
      { ...agentSettings, agentName: nextName },
      'Global agent name updated.',
      'Failed to update agent name.'
    )
  }

  const handleModelChange = async (value: string) => {
    const trimmed = value.trim()
    const modelEntry = openRouterModelsData?.models?.find(model => model.name === trimmed)
    const contextLength = modelEntry?.contextLength ?? agentSettings.modelContextLength ?? null
    await persistAgentSettings(
      { ...agentSettings, model: trimmed || null, modelContextLength: contextLength },
      'Global agent model updated.',
      'Failed to update agent model.'
    )
  }

  const handleLoopIntervalInputChange = (value: string) => {
    setLoopIntervalInput(value)
    setLoopIntervalTouched(true)
  }

  const handleBashTimeoutInputChange = (value: string) => {
    setBashTimeoutInput(value)
    setBashTimeoutTouched(true)
  }

  const handleWorkDirectoryInputChange = (value: string) => {
    setWorkDirectoryInput(value)
    setWorkDirectoryTouched(true)
  }

  const commitWorkDirectoryChange = async (value: string) => {
    const nextWorkDirectory = value.trim().length > 0 ? value.trim() : null
    setWorkDirectoryTouched(false)
    setWorkDirectoryInput(nextWorkDirectory ?? '')
    await persistAgentSettings(
      { ...agentSettings, workDirectory: nextWorkDirectory },
      nextWorkDirectory ? 'Global agent work directory updated.' : 'Global agent work directory cleared.',
      'Failed to update global agent work directory.'
    )
  }

  const commitLoopIntervalChange = async (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setLoopIntervalTouched(false)
      setLoopIntervalInput(String(agentSettings.loopIntervalMs ?? 60000))
      return
    }

    const nextInterval = Math.floor(parsed)
    setLoopIntervalTouched(false)
    await persistAgentSettings(
      { ...agentSettings, loopIntervalMs: nextInterval },
      'Loop cadence updated.',
      'Failed to update loop cadence.'
    )
  }

  const commitBashTimeoutChange = (value: string) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBashTimeoutTouched(false)
      setBashTimeoutInput(String(toolExecutionSettings.bashTimeoutMs))
      showStatus({ type: 'error', text: 'Bash timeout must be a positive number of milliseconds.' })
      return
    }

    const clamped = Math.max(MIN_BASH_TIMEOUT_MS, Math.min(MAX_BASH_TIMEOUT_MS, Math.floor(parsed)))
    const nextSettings: ToolExecutionSettings = {
      ...toolExecutionSettings,
      bashTimeoutMs: clamped,
    }
    saveToolExecutionSettings(nextSettings)
    setToolExecutionSettings(nextSettings)
    setBashTimeoutTouched(false)
    setBashTimeoutInput(String(clamped))

    if (clamped !== Math.floor(parsed)) {
      showStatus({
        type: 'info',
        text: `Bash timeout adjusted to ${clamped}ms (allowed range ${MIN_BASH_TIMEOUT_MS}-${MAX_BASH_TIMEOUT_MS}ms).`,
      })
      return
    }

    showStatus({ type: 'success', text: 'Default bash timeout updated.' })
  }

  const handleAutoResumeToggle = async () => {
    await persistAgentSettings(
      { ...agentSettings, autoResume: !agentSettings.autoResume },
      'Auto-resume updated.',
      'Failed to update auto-resume.'
    )
  }

  const handleAgentToolToggle = async (toolName: string) => {
    const current = agentSettings.toolAllowlist ?? []
    const next = current.includes(toolName) ? current.filter(name => name !== toolName) : [...current, toolName]
    await persistAgentSettings(
      { ...agentSettings, toolAllowlist: next },
      'Global agent tools updated.',
      'Failed to update global agent tools.'
    )
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
    <div className='h-full overflow-y-auto thin-scrollbar bg-transparent min-h-full'>
      <div className='mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            {/* <p className='text-sm uppercase tracking-[0.3em] video-light:text-neutral-100 video-dark:text-neutral-900'>
              Config
            </p> */}
            <h1 className='text-3xl font-semibold video-light:text-neutral-100 video-dark:text-neutral-900 '>
              Settings
            </h1>
          </div>
          <div className='flex items-center gap-3'>
            <button
              type='button'
              onClick={() => setIsChangelogOpen(true)}
              className='rounded-full border border-stone-300 bg-stone-100 px-3 py-1 font-mono text-xs tracking-wide text-stone-700 transition hover:bg-stone-200 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
            >
              CHANGELOG
            </button>
            <Button variant='acrylic' onClick={() => navigate('/homepage')} className='group'>
              <p className='transition-transform duration-100 group-active:scale-95'>Back to Home</p>
            </Button>
          </div>
        </header>

        {renderStatus()}

        {isChangelogOpen && (
          <div
            className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4'
            onClick={() => setIsChangelogOpen(false)}
          >
            <div
              className='w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl dark:border-stone-700 dark:bg-zinc-900'
              onClick={event => event.stopPropagation()}
            >
              <div className='flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-700'>
                <p className='font-mono text-sm tracking-wide text-stone-800 dark:text-stone-100'>CHANGELOG</p>
                <button
                  type='button'
                  onClick={() => setIsChangelogOpen(false)}
                  className='rounded-md px-2 py-1 text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100'
                >
                  ✕
                </button>
              </div>
              <div className='max-h-[calc(85vh-60px)] overflow-y-auto thin-scrollbar p-4'>
                <div className='prose prose-sm max-w-none dark:prose-invert prose-headings:font-semibold prose-pre:rounded-lg prose-pre:border prose-pre:border-stone-300 dark:prose-pre:border-stone-700'>
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeHighlight, rehypeKatex]}>
                    {changelogMarkdown}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        )}

        <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Sidebar</h2>
            <p className='text-sm text-stone-500 dark:text-stone-200'>
              Configure where the app should land after login.
            </p>
          </div>

          <div className='mt-4 flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Startup Destination After Login</p>
              <p className='text-sm text-stone-500 dark:text-stone-400'>
                Choose where the app opens when login completes.
              </p>
              <Select
                value={startupLandingPreference}
                onChange={handleStartupLandingPreferenceChange}
                options={[
                  { value: 'homepage', label: 'Homepage' },
                  { value: 'latest-chat', label: 'Latest Chat' },
                ]}
                className='max-w-xs'
              />
            </div>
          </div>
        </section>

        <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Chat Reasoning Defaults</h2>
            <p className='text-sm text-stone-500 dark:text-stone-200'>
              These defaults are loaded every time Chat opens, then applied when the selected model supports
              reasoning/thinking.
            </p>
          </div>

          <div className='mt-4 flex flex-col gap-4'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Default Thinking</p>
                <p className='text-sm text-stone-500 dark:text-stone-400'>
                  Automatically turn thinking on for models that support it.
                </p>
              </div>
              <button
                onClick={handleDefaultThinkingToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  chatReasoningSettings.defaultThinkingEnabled
                    ? 'bg-emerald-500 dark:bg-emerald-600'
                    : 'bg-stone-300 dark:bg-stone-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    chatReasoningSettings.defaultThinkingEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className='flex flex-col gap-2 pt-2 border-t border-stone-200 dark:border-stone-700'>
              <div>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Default Reasoning Effort</p>
                <p className='text-sm text-stone-500 dark:text-stone-400'>
                  Used when thinking is enabled. The model must support reasoning.
                </p>
              </div>
              <Select
                value={chatReasoningSettings.defaultReasoningEffort}
                onChange={handleDefaultReasoningEffortChange}
                options={REASONING_EFFORT_OPTIONS.map(option => ({
                  value: option,
                  label:
                    option === 'medium'
                      ? 'Medium (Default)'
                      : option === 'xhigh'
                        ? 'X-High'
                        : option.charAt(0).toUpperCase() + option.slice(1),
                }))}
                className='max-w-xs'
              />
            </div>
          </div>
        </section>

        <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
          <div className='flex flex-col gap-1'>
            <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Chat Interface</h2>
            <p className='text-sm text-stone-500 dark:text-stone-200'>
              Control optional chat UI elements.
            </p>
          </div>

          <div className='mt-4 flex flex-col gap-4'>
            <div className='flex items-center justify-between'>
              <div>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Show Token Usage Bar</p>
                <p className='text-sm text-stone-500 dark:text-stone-400'>
                  Display input/output token progress and credit refresh in the chat composer.
                </p>
              </div>
              <button
                onClick={handleTokenUsageBarToggle}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  showTokenUsageBar ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    showTokenUsageBar ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>

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

              <div className='flex flex-col gap-2 pt-2 border-t border-stone-200 dark:border-stone-700'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>OpenRouter Temperature</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    Optional default for OpenRouter requests. Leave blank to use each model&apos;s default.
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    type='number'
                    min={MIN_OPENROUTER_TEMPERATURE}
                    max={MAX_OPENROUTER_TEMPERATURE}
                    step={0.1}
                    value={openRouterTemperatureInput}
                    placeholder='model default'
                    onChange={e => handleOpenRouterTemperatureInputChange(e.target.value)}
                    onBlur={e => commitOpenRouterTemperatureChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    className='w-40 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                  />
                  {providerSettings.openRouterTemperature !== null && (
                    <Button
                      variant='outline2'
                      size='small'
                      onClick={() => commitOpenRouterTemperatureChange('')}
                      className='h-[36px]'
                    >
                      Reset
                    </Button>
                  )}
                </div>
                <p className='text-xs text-stone-500 dark:text-stone-400'>
                  Range: {MIN_OPENROUTER_TEMPERATURE} to {MAX_OPENROUTER_TEMPERATURE}.
                </p>
              </div>

              <div className='flex flex-col gap-2 pt-2 border-t border-stone-200 dark:border-stone-700'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>OpenAI ChatGPT Account</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    Sign out to clear local ChatGPT OAuth tokens. You can sign in again from Chat when selecting OpenAI
                    (ChatGPT).
                  </p>
                </div>
                <div className='flex flex-wrap items-center gap-3'>
                  <span
                    className={`text-xs px-2 py-1 rounded-full border ${
                      isOpenAIAuthenticated()
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:border-emerald-700 dark:text-emerald-300'
                        : 'bg-stone-100 border-stone-200 text-stone-600 dark:bg-stone-800 dark:border-stone-700 dark:text-stone-300'
                    }`}
                  >
                    {isOpenAIAuthenticated() ? 'Signed in' : 'Signed out'}
                  </span>
                  <Button
                    variant='outline2'
                    size='small'
                    onClick={handleOpenAIChatGPTSignOut}
                    disabled={!isOpenAIAuthenticated()}
                  >
                    Sign out of ChatGPT
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Global Agent Settings Section */}
        {import.meta.env.VITE_ENVIRONMENT === 'electron' && (
          <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
            <div className='flex flex-col gap-1'>
              <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100 mb-2'>Global Agent</h2>
              <p className='text-sm text-stone-500 dark:text-stone-200'>
                Configure the background agent loop, model, and heartbeat schedule.
              </p>
            </div>

            <div className='mt-4 flex flex-col gap-5'>
              <div className='flex flex-col gap-2'>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Agent Name</p>
                <input
                  type='text'
                  value={agentSettings.agentName ?? ''}
                  onChange={e => handleAgentNameChange(e.target.value)}
                  disabled={agentSettingsLoading || agentSettingsSaving}
                  className='w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                />
              </div>

              <div className='flex flex-col gap-2'>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Model (OpenRouter)</p>
                <Select
                  value={agentSettings.model || ''}
                  onChange={handleModelChange}
                  options={(openRouterModelsData?.models || []).map(model => model.name)}
                  placeholder='Select a model...'
                  disabled={agentSettingsLoading || agentSettingsSaving}
                  className='max-w-full'
                />
                <p className='text-xs text-stone-500 dark:text-stone-400'>
                  Non-OpenRouter models can be set later. TODO: add provider-aware context limits.
                </p>
              </div>

              <div className='flex flex-col gap-2'>
                <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Work Directory</p>
                <input
                  type='text'
                  value={workDirectoryInput}
                  placeholder='/path/to/project'
                  onChange={e => handleWorkDirectoryInputChange(e.target.value)}
                  onBlur={e => commitWorkDirectoryChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                  disabled={agentSettingsLoading || agentSettingsSaving}
                  className='w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                />
                <p className='text-xs text-stone-500 dark:text-stone-400'>
                  Used as the working directory root when the global agent runs local tools.
                </p>
              </div>

              <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Loop Cadence (ms)</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>How often the agent checks its queue.</p>
                </div>
                <input
                  type='number'
                  min={1000}
                  step={1000}
                  value={loopIntervalInput}
                  onChange={e => handleLoopIntervalInputChange(e.target.value)}
                  onBlur={e => commitLoopIntervalChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.currentTarget.blur()
                    }
                  }}
                  disabled={agentSettingsLoading || agentSettingsSaving}
                  className='w-40 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                />
              </div>

              <div className='flex items-center justify-between'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Auto Resume</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    Resume the global agent after app restart.
                  </p>
                </div>
                <button
                  onClick={handleAutoResumeToggle}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    agentSettings.autoResume ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      agentSettings.autoResume ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
                <div>
                  <p className='text-base font-medium text-stone-900 dark:text-stone-100'>Daily Heartbeat Time</p>
                  <p className='text-sm text-stone-500 dark:text-stone-400'>
                    Uses your local time zone. Leave blank to disable.
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <input
                    type='time'
                    value={agentSettings.heartbeatTime ?? ''}
                    onChange={e => handleHeartbeatTimeChange(e.target.value)}
                    disabled={agentSettingsLoading || agentSettingsSaving}
                    className='rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                  />
                  {agentSettings.heartbeatTime && (
                    <Button
                      variant='outline2'
                      size='small'
                      onClick={() => handleHeartbeatTimeChange('')}
                      disabled={agentSettingsLoading || agentSettingsSaving}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {agentSettingsLoading && (
                <p className='text-xs text-stone-500 dark:text-stone-400'>Loading agent settings…</p>
              )}
            </div>

            <div className='mt-6 border-t border-stone-200 dark:border-stone-700 pt-4'>
              <button
                onClick={() => setAgentToolsExpanded(!agentToolsExpanded)}
                className='w-full flex items-center justify-between text-left'
              >
                <div className='flex flex-col gap-1'>
                  <h3 className='text-lg font-semibold text-stone-900 dark:text-stone-100'>Global Agent Tools</h3>
                  <p className='text-sm text-stone-500 dark:text-stone-200'>
                    Select which tools the global agent can call.
                  </p>
                </div>
                <div className='flex items-center gap-2'>
                  <span className='text-sm text-stone-500 dark:text-stone-400'>
                    {agentSettings.toolAllowlist?.length || 0}/{tools.length} enabled
                  </span>
                  <i
                    className={`bx bx-chevron-down text-2xl text-stone-500 dark:text-stone-400 transition-transform duration-200 ${
                      agentToolsExpanded ? 'rotate-180' : ''
                    }`}
                  ></i>
                </div>
              </button>

              <div
                className={`transition-all duration-300 ease-in-out overflow-hidden ${
                  agentToolsExpanded ? ' opacity-100 my-4' : 'max-h-0 opacity-0'
                }`}
              >
                <div className='space-y-2'>
                  {tools.map(tool => {
                    const enabled = agentSettings.toolAllowlist?.includes(tool.name) ?? false
                    return (
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
                            {tool.isMcp && (
                              <span className='text-xs px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-300 flex-shrink-0'>
                                MCP
                              </span>
                            )}
                          </div>
                          <p className='text-sm text-stone-500 dark:text-stone-400 truncate mt-0.5'>
                            {tool.description}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAgentToolToggle(tool.name)}
                          disabled={agentSettingsSaving || agentSettingsLoading}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-3 flex-shrink-0 ${
                            enabled ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
                          } ${agentSettingsSaving ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              enabled ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
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
                toolsExpanded ? ' opacity-100 my-4' : 'max-h-0 opacity-0'
              }`}
            >
              <div className='mb-3 rounded-lg border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-800/30'>
                <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
                  <div>
                    <p className='text-base font-medium text-stone-900 dark:text-stone-100'>
                      Default Bash Timeout (ms)
                    </p>
                    <p className='text-xs text-stone-500 dark:text-stone-400'>
                      Used when the `bash` tool call does not specify `timeoutMs`.
                    </p>
                  </div>
                  <input
                    type='number'
                    min={MIN_BASH_TIMEOUT_MS}
                    max={MAX_BASH_TIMEOUT_MS}
                    step={1000}
                    value={bashTimeoutInput}
                    onChange={e => handleBashTimeoutInputChange(e.target.value)}
                    onBlur={e => commitBashTimeoutChange(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                    className='w-44 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 dark:border-stone-700 dark:bg-zinc-900 dark:text-stone-100'
                  />
                </div>
                <p className='mt-2 text-xs text-stone-500 dark:text-stone-400'>
                  Range: {MIN_BASH_TIMEOUT_MS}ms to {MAX_BASH_TIMEOUT_MS}ms.
                </p>
              </div>

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
                {tools.length === 0 ? (
                  <div className='rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/80 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-900/60 dark:text-stone-400'>
                    No tools available. Reload to check for new tools.
                  </div>
                ) : (
                  tools.map(tool => (
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
                        <p className='text-sm text-stone-500 dark:text-stone-400 truncate mt-0.5'>{tool.description}</p>
                      </div>
                      <button
                        onClick={() => handleToolToggle(tool.name, tool.enabled)}
                        disabled={updatingTools.has(tool.name)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ml-3 flex-shrink-0 ${
                          tool.enabled ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
                        } ${updatingTools.has(tool.name) ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            tool.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}

        {/* HTML Tools Management Section - Collapsible */}
        {htmlRegistry && (
          <section className='rounded-2xl border border-neutral-200 mica p-6 shadow-lg shadow-neutral-200/30 dark:border-neutral-800 dark:shadow-black/20'>
            <button
              onClick={() => setHtmlToolsExpanded(!htmlToolsExpanded)}
              className='w-full flex items-center justify-between text-left'
            >
              <div className='flex flex-col gap-1'>
                <h2 className='text-xl font-semibold text-stone-900 dark:text-stone-100'>HTML Tools Cache</h2>
                <p className='text-sm text-stone-500 dark:text-stone-200'>
                  Manage cached HTML tool outputs. Remove problematic tools without rendering them.
                </p>
              </div>
              <div className='flex items-center gap-2'>
                <span className='text-sm text-stone-500 dark:text-stone-400'>{htmlEntries.length} cached</span>
                <i
                  className={`bx bx-chevron-down text-2xl text-stone-500 dark:text-stone-400 transition-transform duration-200 ${
                    htmlToolsExpanded ? 'rotate-180' : ''
                  }`}
                ></i>
              </div>
            </button>

            {/* Collapsible content */}
            <div
              className={`transition-all duration-300 ease-in-out overflow-hidden ${
                htmlToolsExpanded ? 'max-h-[2000px] opacity-100 mt-4' : 'max-h-0 opacity-0'
              }`}
            >
              {/* Tools list */}
              <div className='space-y-2'>
                {htmlEntries.length === 0 ? (
                  <div className='rounded-xl border-2 border-dashed border-stone-200 bg-stone-50/80 p-6 text-center text-sm text-stone-500 dark:border-stone-700 dark:bg-zinc-900/60 dark:text-stone-400'>
                    No HTML tools cached. Tools will appear here when AI generates interactive outputs.
                  </div>
                ) : (
                  htmlEntries.map(entry => {
                    const isHibernated = entry.status === 'hibernated'
                    const isFavorite = entry.favorite
                    const sizeKb = Math.round(entry.sizeBytes / 1024)
                    const truncatedKey =
                      entry.key.length > 20 ? `${entry.key.slice(0, 10)}...${entry.key.slice(-6)}` : entry.key

                    return (
                      <div
                        key={entry.key}
                        className={`flex items-center justify-between p-3 rounded-lg border ${
                          isHibernated
                            ? 'border-stone-300 dark:border-stone-600 bg-stone-100/50 dark:bg-stone-800/50 opacity-60'
                            : isFavorite
                              ? 'border-amber-300 dark:border-amber-600/50 bg-amber-50/50 dark:bg-amber-900/10'
                              : 'border-stone-200 dark:border-stone-700 bg-stone-50/50 dark:bg-stone-800/30'
                        }`}
                      >
                        <div className='flex-1 min-w-0'>
                          <div className='flex items-center gap-2'>
                            <span className='font-medium text-stone-800 dark:text-stone-200 truncate'>
                              {entry.label || 'Unnamed Tool'}
                            </span>
                            {isFavorite && (
                              <span className='text-xs px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-300 flex-shrink-0'>
                                ★ Favorite
                              </span>
                            )}
                            {isHibernated && (
                              <span className='text-xs px-1.5 py-0.5 rounded bg-stone-200 dark:bg-stone-700 text-stone-600 dark:text-stone-400 flex-shrink-0'>
                                Hibernated
                              </span>
                            )}
                          </div>
                          <p className='text-xs text-stone-500 dark:text-stone-400 mt-0.5'>
                            Key: {truncatedKey} · {sizeKb} KB · Updated {new Date(entry.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                        <div className='flex items-center gap-1.5 ml-3 flex-shrink-0'>
                          {/* Favorite toggle */}
                          <button
                            onClick={() => {
                              htmlRegistry.toggleFavorite(entry.key)
                              showStatus({
                                type: 'success',
                                text: entry.favorite ? 'Removed from favorites.' : 'Added to favorites.',
                              })
                            }}
                            className={`p-2 rounded-lg transition-colors ${
                              isFavorite
                                ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                                : 'bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-400 dark:hover:bg-stone-600'
                            }`}
                            title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            <i className={`bx ${isFavorite ? 'bxs-star' : 'bx-star'} text-base`}></i>
                          </button>
                          {/* Hibernate/Restore toggle */}
                          <button
                            onClick={() => {
                              if (isHibernated) {
                                htmlRegistry.restoreEntry(entry.key)
                                showStatus({ type: 'success', text: 'Tool restored.' })
                              } else {
                                htmlRegistry.hibernateEntry(entry.key)
                                showStatus({ type: 'info', text: 'Tool hibernated.' })
                              }
                            }}
                            className='p-2 rounded-lg bg-stone-100 text-stone-500 hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-400 dark:hover:bg-stone-600 transition-colors'
                            title={isHibernated ? 'Restore tool' : 'Hibernate tool'}
                          >
                            <i className={`bx ${isHibernated ? 'bx-sun' : 'bx-moon'} text-base`}></i>
                          </button>
                          {/* Remove button */}
                          <button
                            onClick={() => {
                              htmlRegistry.removeEntry(entry.key)
                              showStatus({ type: 'info', text: 'Tool removed from cache.' })
                            }}
                            className='p-2 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/50 transition-colors'
                            title='Remove tool'
                          >
                            <i className='bx bx-trash text-base'></i>
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Clear all button */}
              {htmlEntries.length > 0 && (
                <div className='mt-4 pt-3 flex justify-end'>
                  <Button
                    variant='outline2'
                    size='small'
                    onClick={() => {
                      htmlEntries.forEach(entry => htmlRegistry.removeEntry(entry.key))
                      showStatus({ type: 'success', text: 'All HTML tools cleared.' })
                    }}
                    className='text-rose-600 hover:text-rose-700 dark:text-rose-400'
                  >
                    Clear All Tools
                  </Button>
                </div>
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
            <p className='mt-1 text-sm video-light:text-neutral-100 video-dark:text-neutral-900'>
              Upload up to 8MB MP4/WebM clips and switch between them in one place.
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
