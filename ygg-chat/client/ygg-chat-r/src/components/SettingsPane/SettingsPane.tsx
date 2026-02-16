import { useQueryClient } from '@tanstack/react-query'
import mammoth from 'mammoth'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppStoreModal } from '../../containers/appStore'
import { fetchMcpTools, selectCurrentConversationId } from '../../features/chats'
import { convContextSet, systemPromptSet, updateContext, updateSystemPrompt } from '../../features/conversations'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { selectSelectedProject } from '../../features/projects'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { useUserSystemPrompts } from '../../hooks/useUserSystemPrompts'
import { localApi } from '../../utils/api'
import { extractTextFromPdf } from '../../utils/pdfUtils'
import { InputTextArea } from '../InputTextArea/InputTextArea'
import { SendButtonAnimationSettings } from './SendButtonAnimationSettings'
import { ToolsSettings } from './ToolsSettings'
import { VoiceSettingsSection } from './VoiceSettingsSection'

type SettingsPaneProps = {
  open: boolean
  onClose: () => void
}

const TEXT_FILE_EXTENSIONS = [
  '.txt',
  '.md',
  '.markdown',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.kt',
  '.kts',
  '.sh',
  '.bash',
  '.zsh',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.cfg',
  '.sql',
  '.rb',
  '.php',
  '.swift',
  '.gradle',
  '.bat',
  '.ps1',
  '.scala',
  '.erl',
  '.ex',
  '.r',
  '.csv',
  '.log',
]

const isPdfFile = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

const isSupportedTextFile = (file: File) => {
  if (file.type.startsWith('text/')) {
    return true
  }
  const lowerName = file.name.toLowerCase()
  return TEXT_FILE_EXTENSIONS.some(ext => lowerName.endsWith(ext))
}

const isDocxFile = (file: File) =>
  file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
  file.name.toLowerCase().endsWith('.docx')

const extractTextFromDocx = async (file: File): Promise<string> => {
  const arrayBuffer = await file.arrayBuffer()
  const { value: text } = await mammoth.extractRawText({ arrayBuffer })
  return text.trim()
}

export const SettingsPane: React.FC<SettingsPaneProps> = ({ open, onClose }) => {
  const dispatch = useAppDispatch()
  const queryClient = useQueryClient()
  const systemPrompt = useAppSelector(state => state.conversations.systemPrompt ?? '')
  const context = useAppSelector(state => state.conversations.convContext ?? '')
  const conversationId = useAppSelector(selectCurrentConversationId)
  const selectedProject = useAppSelector(selectSelectedProject)
  const conversations = useAppSelector(state => state.conversations.items)
  const tools = useAppSelector(state => state.chat.tools ?? [])

  const [attachmentTarget, setAttachmentTarget] = useState<'system' | 'context'>('system')
  const attachmentInputRef = useRef<HTMLInputElement>(null)
  const [promptContextExpanded, setPromptContextExpanded] = useState(false)
  const [appStoreOpen, setAppStoreOpen] = useState(false)

  // Skills section state
  const [skillsExpanded, setSkillsExpanded] = useState(false)
  const [skillUrl, setSkillUrl] = useState('')
  const [skillInstallStatus, setSkillInstallStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [skillInstallMessage, setSkillInstallMessage] = useState('')
  const [installedSkills, setInstalledSkills] = useState<
    Array<{ name: string; description: string; enabled: boolean }>
  >([])
  const [skillsLoading, setSkillsLoading] = useState(false)

  // MCP Servers section state
  const [mcpExpanded, setMcpExpanded] = useState(false)
  const [mcpServers, setMcpServers] = useState<
    Array<{
      name: string
      command: string
      args: string[]
      enabled: boolean
      status: 'disconnected' | 'connecting' | 'connected' | 'error'
      error?: string
      toolCount: number
    }>
  >([])
  const [mcpLazyStart, setMcpLazyStart] = useState(true)
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpRefreshing, setMcpRefreshing] = useState(false)
  const [mcpAddMode, setMcpAddMode] = useState(false)
  const [newServerName, setNewServerName] = useState('')
  const [newServerCommand, setNewServerCommand] = useState('')
  const [newServerArgs, setNewServerArgs] = useState('')
  const [mcpActionStatus, setMcpActionStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Font size offset state (persisted to localStorage)
  const [fontSizeOffset, setFontSizeOffset] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('chat:fontSizeOffset')
      return stored ? parseInt(stored, 10) : 0
    } catch {
      return 0
    }
  })

  const [groupToolReasoningRuns, setGroupToolReasoningRuns] = useState<boolean>(() => {
    try {
      return localStorage.getItem('chat:groupToolReasoningRuns') === 'true'
    } catch {
      return false
    }
  })

  const handleFontSizeChange = useCallback((value: number) => {
    const next = Math.max(-8, Math.min(16, value)) // Clamp between -8 and +16
    setFontSizeOffset(next)
    try {
      localStorage.setItem('chat:fontSizeOffset', String(next))
      window.dispatchEvent(new CustomEvent('fontSizeOffsetChange', { detail: next }))
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  const handleGroupToolReasoningRunsChange = useCallback((enabled: boolean) => {
    setGroupToolReasoningRuns(enabled)
    try {
      localStorage.setItem('chat:groupToolReasoningRuns', String(enabled))
      window.dispatchEvent(new CustomEvent('groupToolReasoningRunsChange', { detail: enabled }))
    } catch {
      // Ignore localStorage errors
    }
  }, [])

  // Use the custom hook for system prompt management
  const {
    prompts: userSystemPrompts,
    loading: promptsLoading,
    selectedPromptId,
    setSelectedPromptId,
    showSavePromptInput,
    setShowSavePromptInput,
    savePromptName,
    setSavePromptName,
    savingPrompt,
    saveError,
    isExistingPrompt,
    matchingPrompt,
    makingDefault,
    handleSelectPrompt,
    handleSaveAsPrompt,
    handleMakeDefault,
    handleRemoveDefault,
    removingDefault,
    resetSaveUI,
  } = useUserSystemPrompts({
    currentPromptContent: systemPrompt,
    isOpen: open,
    onPromptSelect: content => dispatch(systemPromptSet(content)),
  })

  // Track initial values when modal opens to detect changes
  const initialSystemPromptRef = useRef<string | null>(null)
  const initialContextRef = useRef<string | null>(null)
  const prevOpenRef = useRef<boolean>(false)

  const handleChange = useCallback(
    (value: string) => {
      // Only update Redux state for instant UI feedback
      dispatch(systemPromptSet(value))
    },
    [dispatch]
  )

  const handleContextChange = useCallback(
    (value: string) => {
      // Only update Redux state for instant UI feedback
      dispatch(convContextSet(value))
    },
    [dispatch]
  )

  // Fetch installed skills
  const fetchInstalledSkills = useCallback(async () => {
    setSkillsLoading(true)
    try {
      const data = await localApi.get<{
        success?: boolean
        skills?: Array<{ name: string; description: string; enabled: boolean }>
      }>('/skills')
      if (data.success && data.skills) {
        setInstalledSkills(data.skills)
      }
    } catch (error) {
      console.error('Failed to fetch installed skills:', error)
    } finally {
      setSkillsLoading(false)
    }
  }, [])

  // Fetch skills when section is expanded
  useEffect(() => {
    if (skillsExpanded) {
      fetchInstalledSkills()
    }
  }, [skillsExpanded, fetchInstalledSkills])

  // Handle skill installation from URL
  const handleInstallSkill = useCallback(async () => {
    const url = skillUrl.trim()
    if (!url) return

    setSkillInstallStatus('loading')
    setSkillInstallMessage('Downloading and installing skill...')

    try {
      const data = await localApi.post<{ success?: boolean; skillName?: string; error?: string }>(
        '/skills/install/url',
        {
          url,
        }
      )

      if (data.success) {
        setSkillInstallStatus('success')
        setSkillInstallMessage(`Successfully installed "${data.skillName}"`)
        setSkillUrl('')
        // Refresh skills list
        fetchInstalledSkills()
        // Auto-clear success message after 5 seconds
        setTimeout(() => {
          setSkillInstallStatus('idle')
          setSkillInstallMessage('')
        }, 5000)
      } else {
        setSkillInstallStatus('error')
        setSkillInstallMessage(data.error || 'Installation failed')
      }
    } catch (error) {
      setSkillInstallStatus('error')
      setSkillInstallMessage(error instanceof Error ? error.message : 'Network error - is the local server running?')
    }
  }, [skillUrl, fetchInstalledSkills])

  // Handle skill enable/disable toggle
  const handleToggleSkill = useCallback(async (skillName: string, currentEnabled: boolean) => {
    const action = currentEnabled ? 'disable' : 'enable'
    try {
      const data = await localApi.post<{ success?: boolean }>(`/skills/${encodeURIComponent(skillName)}/${action}`)
      if (data.success) {
        // Update local state
        setInstalledSkills(prev => prev.map(s => (s.name === skillName ? { ...s, enabled: !currentEnabled } : s)))
      }
    } catch (error) {
      console.error(`Failed to ${action} skill:`, error)
    }
  }, [])

  // Handle skill uninstall
  const handleUninstallSkill = useCallback(async (skillName: string) => {
    if (!confirm(`Are you sure you want to uninstall "${skillName}"?`)) return

    try {
      const data = await localApi.delete<{ success?: boolean }>(`/skills/${encodeURIComponent(skillName)}`)
      if (data.success) {
        // Remove from local state
        setInstalledSkills(prev => prev.filter(s => s.name !== skillName))
      }
    } catch (error) {
      console.error('Failed to uninstall skill:', error)
    }
  }, [])

  // Fetch MCP servers
  const fetchMcpServers = useCallback(async () => {
    setMcpLoading(true)
    try {
      const data = await localApi.get<{ success?: boolean; servers?: typeof mcpServers }>('/mcp/servers')
      if (data.success && data.servers) {
        setMcpServers(data.servers)
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error)
    } finally {
      setMcpLoading(false)
    }
  }, [])

  const fetchMcpSettings = useCallback(async () => {
    try {
      const data = await localApi.get<{ success?: boolean; settings?: { lazyStart?: boolean } }>('/mcp/settings')
      if (data.success && data.settings) {
        setMcpLazyStart(Boolean(data.settings.lazyStart))
      }
    } catch (error) {
      console.error('Failed to fetch MCP settings:', error)
    }
  }, [])

  // Fetch MCP servers when section is expanded
  useEffect(() => {
    if (mcpExpanded) {
      fetchMcpServers()
      fetchMcpSettings()
    }
  }, [mcpExpanded, fetchMcpServers, fetchMcpSettings])

  // Handle MCP server start/stop
  const handleToggleMcpServer = useCallback(
    async (serverName: string, currentStatus: string) => {
      const action = currentStatus === 'connected' ? 'stop' : 'start'
      try {
        const data = await localApi.post<{ success?: boolean; error?: string }>(
          `/mcp/servers/${encodeURIComponent(serverName)}/${action}`
        )
        if (data.success) {
          setMcpActionStatus({ type: 'success', message: `Server ${action}ed successfully` })
          fetchMcpServers()
          // Refresh MCP tools with orchestrator and Redux after server state change
          if (action === 'start') {
            setTimeout(async () => {
              // First refresh with orchestrator (backend registers tools)
              await localApi.post('/mcp/refresh-tools')
              // Then refresh Redux state (frontend gets tool definitions)
              dispatch(fetchMcpTools())
            }, 1000) // Small delay to let server fully connect
          } else {
            dispatch(fetchMcpTools())
          }
          setTimeout(() => setMcpActionStatus(null), 3000)
        } else {
          setMcpActionStatus({ type: 'error', message: data.error || `Failed to ${action} server` })
        }
      } catch (error) {
        setMcpActionStatus({ type: 'error', message: `Failed to ${action} server` })
      }
    },
    [fetchMcpServers, dispatch]
  )

  // Handle MCP server removal
  const handleRemoveMcpServer = useCallback(async (serverName: string) => {
    if (!confirm(`Are you sure you want to remove "${serverName}"?`)) return

    try {
      const data = await localApi.delete<{ success?: boolean }>(`/mcp/servers/${encodeURIComponent(serverName)}`)
      if (data.success) {
        setMcpServers(prev => prev.filter(s => s.name !== serverName))
        setMcpActionStatus({ type: 'success', message: 'Server removed' })
        setTimeout(() => setMcpActionStatus(null), 3000)
      }
    } catch (error) {
      console.error('Failed to remove MCP server:', error)
    }
  }, [])

  // Handle adding new MCP server
  const handleAddMcpServer = useCallback(async () => {
    const name = newServerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
    const command = newServerCommand.trim()
    const args = newServerArgs.trim().split(/\s+/).filter(Boolean)

    if (!name || !command) {
      setMcpActionStatus({ type: 'error', message: 'Name and command are required' })
      return
    }

    try {
      const data = await localApi.post<{ success?: boolean; error?: string }>('/mcp/servers', {
        name,
        command,
        args,
        enabled: true,
      })
      if (data.success) {
        setMcpActionStatus({ type: 'success', message: `Server "${name}" added` })
        setNewServerName('')
        setNewServerCommand('')
        setNewServerArgs('')
        setMcpAddMode(false)
        fetchMcpServers()
        // Refresh MCP tools after adding server (backend auto-registers, then update Redux)
        setTimeout(async () => {
          await localApi.post('/mcp/refresh-tools')
          dispatch(fetchMcpTools())
        }, 1500)
        setTimeout(() => setMcpActionStatus(null), 3000)
      } else {
        setMcpActionStatus({ type: 'error', message: data.error || 'Failed to add server' })
      }
    } catch (error) {
      setMcpActionStatus({ type: 'error', message: 'Network error' })
    }
  }, [newServerName, newServerCommand, newServerArgs, fetchMcpServers, dispatch])

  const handleRefreshMcpTools = useCallback(async () => {
    setMcpRefreshing(true)
    try {
      const data = await localApi.post<{ success?: boolean; error?: string }>('/mcp/refresh-tools')
      if (data.success) {
        dispatch(fetchMcpTools())
        fetchMcpServers()
        setMcpActionStatus({ type: 'success', message: 'MCP tools refreshed' })
      } else {
        setMcpActionStatus({ type: 'error', message: data.error || 'Failed to refresh MCP tools' })
      }
    } catch (error) {
      setMcpActionStatus({ type: 'error', message: 'Failed to refresh MCP tools' })
    } finally {
      setMcpRefreshing(false)
      setTimeout(() => setMcpActionStatus(null), 3000)
    }
  }, [dispatch, fetchMcpServers])

  const handleToggleMcpLazyStart = useCallback(async () => {
    const nextValue = !mcpLazyStart
    setMcpLazyStart(nextValue)
    try {
      const data = await localApi.put<{ success?: boolean; error?: string }>('/mcp/settings', { lazyStart: nextValue })
      if (data.success) {
        setMcpActionStatus({
          type: 'success',
          message: nextValue
            ? 'Lazy start enabled (servers won’t auto-start)'
            : 'Auto-start enabled (restart app to start servers)',
        })
      } else {
        setMcpActionStatus({ type: 'error', message: data.error || 'Failed to update MCP settings' })
        setMcpLazyStart(!nextValue)
      }
    } catch (error) {
      setMcpActionStatus({ type: 'error', message: 'Failed to update MCP settings' })
      setMcpLazyStart(!nextValue)
    } finally {
      setTimeout(() => setMcpActionStatus(null), 3000)
    }
  }, [mcpLazyStart])

  const handleAttachmentInputChange = useCallback(
    (target: 'system' | 'context') => async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0) return

      const pdfFiles = files.filter(isPdfFile)
      const docxFiles = files.filter(isDocxFile)
      const textFiles = files.filter(file => !isPdfFile(file) && !isDocxFile(file) && isSupportedTextFile(file))
      if (pdfFiles.length === 0 && docxFiles.length === 0 && textFiles.length === 0) {
        e.target.value = ''
        return
      }

      const collected: string[] = []

      if (pdfFiles.length > 0) {
        try {
          const pdfTexts = await Promise.all(
            pdfFiles.map(
              async file => `[Pdf Content for ${file.name}]:
${await extractTextFromPdf(file)}`
            )
          )
          collected.push(...pdfTexts)
        } catch (err) {
          console.error('Failed to extract PDF text(s)', err)
        }
      }

      if (textFiles.length > 0) {
        const textBlocks = await Promise.all(
          textFiles.map(async file => {
            try {
              const text = await file.text()
              return `[Text Content for ${file.name}]:
${text}`
            } catch (err) {
              console.error(`Failed to read text file ${file.name}`, err)
              return null
            }
          })
        )
        collected.push(...textBlocks.filter((block): block is string => Boolean(block)))
      }

      if (docxFiles.length > 0) {
        const docxBlocks = await Promise.all(
          docxFiles.map(async file => {
            try {
              const text = await extractTextFromDocx(file)
              return `[Docx Content for ${file.name}]:
${text}`
            } catch (err) {
              console.error(`Failed to extract DOCX text for ${file.name}`, err)
              return null
            }
          })
        )
        collected.push(...docxBlocks.filter((block): block is string => Boolean(block)))
      }

      if (collected.length === 0) {
        e.target.value = ''
        return
      }

      const block = `\`\`\`
${collected.join('')}
\`\`\`

`

      if (target === 'system') {
        const next = systemPrompt
          ? `${systemPrompt}

${block}`
          : block
        dispatch(systemPromptSet(next))
      } else {
        const next = context
          ? `${context}

${block}`
          : block
        dispatch(convContextSet(next))
      }

      e.target.value = ''
    },
    [context, dispatch, systemPrompt]
  )

  // Capture initial values when modal opens and save changes when it closes
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      initialSystemPromptRef.current = systemPrompt
      initialContextRef.current = context
    }

    if (!open && prevOpenRef.current) {
      if (conversationId) {
        const currentSystemPrompt = systemPrompt.trim() === '' ? null : systemPrompt
        const currentContext = context.trim() === '' ? null : context
        const initialSystemPrompt =
          initialSystemPromptRef.current?.trim() === '' ? null : initialSystemPromptRef.current
        const initialContext = initialContextRef.current?.trim() === '' ? null : initialContextRef.current

        const systemPromptChanged = currentSystemPrompt !== initialSystemPrompt
        const contextChanged = currentContext !== initialContext

        const currentConversation = conversations.find(conv => conv.id === conversationId) || null
        const projectId = currentConversation?.project_id || selectedProject?.id || null

        const updateSystemPromptInCache = (items: Conversation[] | undefined) => {
          if (!items) return items
          return items.map(conv =>
            conv.id === conversationId ? { ...conv, system_prompt: currentSystemPrompt } : conv
          )
        }

        const updateContextInCache = (items: Conversation[] | undefined) => {
          if (!items) return items
          return items.map(conv =>
            conv.id === conversationId ? { ...conv, conversation_context: currentContext } : conv
          )
        }

        if (systemPromptChanged) {
          dispatch(updateSystemPrompt({ id: conversationId, systemPrompt: currentSystemPrompt }))
            .unwrap()
            .then(() => {
              queryClient.setQueryData<Conversation[]>(['conversations'], updateSystemPromptInCache)
              if (projectId) {
                queryClient.setQueryData<Conversation[]>(
                  ['conversations', 'project', projectId],
                  updateSystemPromptInCache
                )
              }
              queryClient.setQueryData<Conversation[]>(['conversations', 'recent'], updateSystemPromptInCache)
              queryClient.setQueryData(['conversations', conversationId, 'data'], (prev: any) =>
                prev ? { ...prev, systemPrompt: currentSystemPrompt } : prev
              )
            })
            .catch(error => {
              console.error('Failed to update system prompt:', error)
            })
        }

        if (contextChanged) {
          dispatch(updateContext({ id: conversationId, context: currentContext }))
            .unwrap()
            .then(() => {
              queryClient.setQueryData<Conversation[]>(['conversations'], updateContextInCache)
              if (projectId) {
                queryClient.setQueryData<Conversation[]>(['conversations', 'project', projectId], updateContextInCache)
              }
              queryClient.setQueryData<Conversation[]>(['conversations', 'recent'], updateContextInCache)
              queryClient.setQueryData(['conversations', conversationId, 'data'], (prev: any) =>
                prev ? { ...prev, context: currentContext } : prev
              )
            })
            .catch(error => {
              console.error('Failed to update context:', error)
            })
        }
      }

      initialSystemPromptRef.current = null
      initialContextRef.current = null
    }

    prevOpenRef.current = open
  }, [open, conversationId, systemPrompt, context, conversations, dispatch, queryClient, selectedProject])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) {
      setAppStoreOpen(false)
    }
  }, [open])

  if (!open) return null

  return (
    <div className='fixed inset-0 z-400 flex items-center justify-center'>
      {/* Overlay */}
      <div
        className='fixed inset-0 bg-neutral-300/50 dark:bg-neutral-900/20 bg-opacity-50 backdrop-blur-sm'
        onClick={onClose}
      />

      {/* Modal */}
      <div className='py-2 w-full max-w-5xl'>
        <div
          className={`relative z-50 mx-4 rounded-3xl px-12 py-4 lg:py-6 dark:border-1 dark:border-neutral-900 bg-neutral-100 dark:bg-yBlack-900 shadow-lg overflow-y-scroll no-scrollbar transition-all duration-300 ease-in-out ${
            tools.some(tool => tool.enabled) ? 'h-[80vh]' : 'h-[58vh]'
          }`}
          onClick={e => e.stopPropagation()}
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className='flex justify-between items-center mb-3 py-4'>
            <h2 className='text-2xl font-semibold text-stone-800 dark:text-stone-200'>Chat Settings</h2>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => setAppStoreOpen(true)}
                className='p-1 rounded-md transition-colors'
                aria-label='Open App Store'
                title='App Store'
              >
                <i className='bx bx-store-alt text-2xl text-gray-600 dark:text-gray-400 active:scale-95'></i>
              </button>
              <button onClick={onClose} className='p-1 rounded-md transition-colors' aria-label='Close settings'>
                <i className='bx bx-x text-2xl text-gray-600 dark:text-gray-400 active:scale-95'></i>
              </button>
            </div>
          </div>

          <div className='space-y-6'>
            {/* Hidden attachment input used for both system prompt + context */}
            <input
              ref={attachmentInputRef}
              type='file'
              accept='application/pdf,text/plain,text/markdown,text/javascript,text/typescript,text/json,.md,.markdown,.js,.jsx,.ts,.tsx,.json,.py,.java,.c,.cpp,.h,.cs,.go,.rs,.kt,.kts,.sh,.bash,.zsh,.yml,.yaml,.toml,.ini,.cfg,.sql,.rb,.php,.swift,.gradle,.bat,.ps1,.scala,.erl,.ex,.r,.csv,.log,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx'
              multiple
              onChange={handleAttachmentInputChange(attachmentTarget)}
              className='hidden'
              aria-hidden='true'
            />

            {/* System Prompt and Context Collapsible Section */}
            <div className='space-y-2'>
              <button
                type='button'
                onClick={() => setPromptContextExpanded(!promptContextExpanded)}
                className='flex items-center justify-between w-full text-left'
              >
                <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>
                  System Prompt and Context
                </span>
                <i
                  className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${promptContextExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {promptContextExpanded && (
                <div className='space-y-6 pl-1 pt-2'>
                  {/* System Prompt Section */}
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>System prompt</span>
                      <button
                        type='button'
                        onClick={() => {
                          setAttachmentTarget('system')
                          attachmentInputRef.current?.click()
                        }}
                        className='flex items-center gap-1 text-sm text-blue-600 dark:text-blue-300 hover:underline'
                      >
                        <i className='bx bx-paperclip text-lg' aria-hidden='true'></i>
                        Attach File
                      </button>
                    </div>

                    {/* User System Prompts horizontal scrolling list */}
                    {userSystemPrompts.length > 0 && (
                      <div className='mb-2'>
                        <p className='text-sm text-neutral-600 dark:text-neutral-400 mb-2'>Select a saved prompt:</p>
                        <div className='flex gap-2 overflow-x-auto pb-2 thin-scrollbar'>
                          {userSystemPrompts.map(prompt => (
                            <button
                              key={prompt.id}
                              onClick={() => handleSelectPrompt(prompt)}
                              className={`flex items-center justify-center gap-2 flex-shrink-0 h-10 px-4 rounded-xl border transition-all duration-150 ${
                                selectedPromptId === prompt.id
                                  ? 'bg-sky-600/70 text-white border-transparent'
                                  : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-transparent dark:border-transparent hover:bg-neutral-100 dark:hover:bg-neutral-700'
                              }`}
                              title={prompt.description || prompt.content.substring(0, 100)}
                            >
                              <span className='font-medium text-sm whitespace-nowrap'>{prompt.name}</span>
                              {prompt.is_default && (
                                <span className=' pt-0.5 text-xs opacity-70'>
                                  <i className='bx bxs-star text-base'></i>
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {promptsLoading && (
                      <div className='mb-2 text-sm text-neutral-500 dark:text-neutral-400'>
                        Loading saved prompts...
                      </div>
                    )}

                    <InputTextArea
                      placeholder='Enter a system prompt to guide the assistant...'
                      value={systemPrompt}
                      onChange={value => {
                        handleChange(value)
                        // Clear selection if user manually edits the prompt
                        if (selectedPromptId) setSelectedPromptId(null)
                      }}
                      minRows={10}
                      maxRows={16}
                      width='w-full'
                      showCharCount
                      outline={true}
                      showHelp={false}
                      variant='outline'
                      className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
                    />

                    {/* Save as Prompt / Make Default button */}
                    {systemPrompt.trim() && (
                      <div className='mt-3'>
                        {isExistingPrompt ? (
                          // Show "Make Default" or "Remove Default" button when prompt already exists
                          matchingPrompt &&
                          (matchingPrompt.is_default ? (
                            <button
                              type='button'
                              onClick={handleRemoveDefault}
                              disabled={removingDefault}
                              className='flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors disabled:opacity-50'
                            >
                              <i className='bx bxs-star text-base'></i>
                              {removingDefault ? 'Removing...' : 'Remove Default'}
                            </button>
                          ) : (
                            <button
                              type='button'
                              onClick={handleMakeDefault}
                              disabled={makingDefault}
                              className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors disabled:opacity-50'
                            >
                              <i className='bx bx-star text-base'></i>
                              {makingDefault ? 'Setting...' : 'Make Default'}
                            </button>
                          ))
                        ) : (
                          // Show "Save as Prompt" when content doesn't match existing prompt
                          <>
                            {!showSavePromptInput ? (
                              <button
                                type='button'
                                onClick={() => setShowSavePromptInput(true)}
                                className='flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors'
                              >
                                <i className='bx bx-save text-base'></i>
                                Save as Prompt
                              </button>
                            ) : (
                              <div className='space-y-2'>
                                <div className='flex items-center gap-2'>
                                  <input
                                    type='text'
                                    value={savePromptName}
                                    onChange={e => setSavePromptName(e.target.value)}
                                    placeholder='Enter prompt name...'
                                    maxLength={100}
                                    className='flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-transparent'
                                    autoFocus
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') handleSaveAsPrompt()
                                      if (e.key === 'Escape') resetSaveUI()
                                    }}
                                  />
                                  <button
                                    type='button'
                                    onClick={handleSaveAsPrompt}
                                    disabled={!savePromptName.trim() || savingPrompt}
                                    className='px-3 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                                  >
                                    {savingPrompt ? 'Saving...' : 'Save'}
                                  </button>
                                  <button
                                    type='button'
                                    onClick={resetSaveUI}
                                    className='px-2 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors'
                                  >
                                    <i className='bx bx-x text-lg'></i>
                                  </button>
                                </div>
                                {saveError && <p className='text-sm text-red-500 dark:text-red-400'>{saveError}</p>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Context Section */}
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between'>
                      <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Context</span>
                      <button
                        type='button'
                        onClick={() => {
                          setAttachmentTarget('context')
                          attachmentInputRef.current?.click()
                        }}
                        className='flex items-center gap-1 text-sm text-blue-600 dark:text-blue-300 hover:underline'
                      >
                        <i className='bx bx-paperclip text-lg' aria-hidden='true'></i>
                        Attach File
                      </button>
                    </div>
                    <InputTextArea
                      placeholder='Enter a context to augment your chat...'
                      value={context}
                      onChange={handleContextChange}
                      minRows={10}
                      maxRows={16}
                      width='w-full'
                      variant='outline'
                      outline={true}
                      showHelp={false}
                      showCharCount={true}
                      className='drop-shadow-xl shadow-[0_0px_12px_3px_rgba(0,0,0,0.05),0_0px_2px_0px_rgba(0,0,0,0.1)] dark:shadow-[0_0px_24px_2px_rgba(0,0,0,0.5),0_0px_2px_2px_rgba(0,0,0,0)]'
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Font Size Section */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between'>
                <span className='text-sm font-medium text-stone-700 dark:text-stone-200'>Message Font Size</span>
                <span className='text-sm font-mono text-neutral-600 dark:text-neutral-400'>
                  {fontSizeOffset === 0 ? 'Default' : `${fontSizeOffset > 0 ? '+' : ''}${fontSizeOffset}px`}
                </span>
              </div>
              <div className='flex items-center gap-4'>
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-6'>-8</span>
                <input
                  type='range'
                  min={-8}
                  max={16}
                  step={1}
                  value={fontSizeOffset}
                  onChange={e => handleFontSizeChange(parseInt(e.target.value, 10))}
                  className='flex-1 h-2 bg-neutral-200 dark:bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-blue-500'
                />
                <span className='text-xs text-neutral-500 dark:text-neutral-500 w-6'>+16</span>
                <button
                  type='button'
                  onClick={() => handleFontSizeChange(0)}
                  className={`px-3 py-1.5 rounded-lg text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors ${fontSizeOffset === 0 ? 'invisible' : ''}`}
                  title='Reset to default'
                >
                  Reset
                </button>
              </div>
            </div>

            {/* Process Step Grouping Section */}
            <div className='space-y-2'>
              <div className='flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/40 px-3 py-2'>
                <div className='pr-4'>
                  <p className='text-sm font-medium text-stone-700 dark:text-stone-200'>
                    Group continuous reasoning/tool steps
                  </p>
                  <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                    Collapse long chains of agent reasoning and tool calls into one expandable section.
                  </p>
                </div>
                <button
                  type='button'
                  onClick={() => handleGroupToolReasoningRunsChange(!groupToolReasoningRuns)}
                  className='p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                  title={groupToolReasoningRuns ? 'Disable grouping' : 'Enable grouping'}
                  aria-pressed={groupToolReasoningRuns}
                >
                  <i
                    className={`bx ${groupToolReasoningRuns ? 'bx-toggle-right text-green-500' : 'bx-toggle-left text-neutral-400'} text-xl`}
                  ></i>
                </button>
              </div>
            </div>

            {/* Voice Settings Section */}
            <VoiceSettingsSection />

            {/* Send Button Animation Section */}
            <div className='space-y-2'>
              <SendButtonAnimationSettings />
            </div>

            {/* Tools Section */}
            <div>
              <ToolsSettings />
            </div>

            {/* Skills Section */}
            <div className='space-y-2'>
              <button
                type='button'
                onClick={() => setSkillsExpanded(!skillsExpanded)}
                className='flex items-center justify-between w-full text-left'
              >
                <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>Skills</span>
                <i
                  className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${skillsExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {skillsExpanded && (
                <div className='space-y-4 pl-1 pt-2'>
                  <p className='text-sm text-neutral-600 dark:text-neutral-400'>
                    Install skills from{' '}
                    <a
                      href='https://clawdhub.com/skills'
                      target='_blank'
                      rel='noopener noreferrer'
                      className='text-blue-600 dark:text-blue-400 hover:underline'
                    >
                      ClawdHub
                    </a>{' '}
                    or GitHub. Paste the skill page URL below.
                  </p>

                  {/* URL Input and Install Button */}
                  <div className='flex items-center gap-2'>
                    <input
                      type='text'
                      value={skillUrl}
                      onChange={e => setSkillUrl(e.target.value)}
                      placeholder='https://clawdhub.com/owner/skill-name'
                      className='flex-1 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                      disabled={skillInstallStatus === 'loading'}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && skillUrl.trim()) {
                          handleInstallSkill()
                        }
                      }}
                    />
                    <button
                      type='button'
                      onClick={handleInstallSkill}
                      disabled={!skillUrl.trim() || skillInstallStatus === 'loading'}
                      className='px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2'
                    >
                      {skillInstallStatus === 'loading' ? (
                        <>
                          <i className='bx bx-loader-alt animate-spin text-base'></i>
                          Installing...
                        </>
                      ) : (
                        <>
                          <i className='bx bx-download text-base'></i>
                          Install
                        </>
                      )}
                    </button>
                  </div>

                  {/* Status Message */}
                  {skillInstallMessage && (
                    <div
                      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                        skillInstallStatus === 'success'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : skillInstallStatus === 'error'
                            ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                      }`}
                    >
                      <i
                        className={`bx ${
                          skillInstallStatus === 'success'
                            ? 'bx-check-circle'
                            : skillInstallStatus === 'error'
                              ? 'bx-error-circle'
                              : 'bx-loader-alt animate-spin'
                        } text-base`}
                      ></i>
                      {skillInstallMessage}
                    </div>
                  )}

                  {/* Help text */}
                  <p className='text-xs text-neutral-500 dark:text-neutral-500'>
                    Supported URLs: ClawdHub pages (clawdhub.com/owner/skill), GitHub repos
                  </p>

                  {/* Installed Skills List */}
                  <div className='mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700'>
                    <h4 className='text-sm font-medium text-stone-700 dark:text-stone-200 mb-3'>
                      Installed Skills {!skillsLoading && `(${installedSkills.length})`}
                    </h4>

                    {skillsLoading ? (
                      <div className='flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400'>
                        <i className='bx bx-loader-alt animate-spin'></i>
                        Loading skills...
                      </div>
                    ) : installedSkills.length === 0 ? (
                      <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                        No skills installed yet. Install one from ClawdHub or GitHub above.
                      </p>
                    ) : (
                      <div className='space-y-2'>
                        {installedSkills.map(skill => (
                          <div
                            key={skill.name}
                            className='flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700'
                          >
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-center gap-2'>
                                <span className='font-medium text-sm text-neutral-900 dark:text-neutral-100'>
                                  {skill.name}
                                </span>
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${
                                    skill.enabled
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                                  }`}
                                >
                                  {skill.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                              <p className='text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5'>
                                {skill.description}
                              </p>
                            </div>
                            <div className='flex items-center gap-1 ml-2'>
                              <button
                                type='button'
                                onClick={() => handleToggleSkill(skill.name, skill.enabled)}
                                className='p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                                title={skill.enabled ? 'Disable skill' : 'Enable skill'}
                              >
                                <i
                                  className={`bx ${skill.enabled ? 'bx-toggle-right text-green-500' : 'bx-toggle-left text-neutral-400'} text-xl`}
                                ></i>
                              </button>
                              <button
                                type='button'
                                onClick={() => handleUninstallSkill(skill.name)}
                                className='p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-neutral-400 hover:text-red-500'
                                title='Uninstall skill'
                              >
                                <i className='bx bx-trash text-lg'></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* MCP Servers Section */}
            <div className='space-y-2'>
              <button
                type='button'
                onClick={() => setMcpExpanded(!mcpExpanded)}
                className='flex items-center justify-between w-full text-left'
              >
                <span className='text-[16px] font-medium text-stone-700 dark:text-stone-200'>MCP Servers</span>
                <i
                  className={`bx bx-chevron-down text-xl text-neutral-500 dark:text-neutral-400 transition-transform duration-200 ${mcpExpanded ? 'rotate-180' : ''}`}
                />
              </button>

              {mcpExpanded && (
                <div className='space-y-4 pl-1 pt-2'>
                  <p className='text-sm text-neutral-600 dark:text-neutral-400'>
                    Connect to MCP (Model Context Protocol) servers to add external tools. MCP servers provide tools
                    that the AI can use directly.
                  </p>

                  <div className='flex items-center justify-between rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50 px-3 py-2'>
                    <div>
                      <p className='text-sm font-medium text-neutral-700 dark:text-neutral-200'>
                        Lazy start MCP servers
                      </p>
                      <p className='text-xs text-neutral-500 dark:text-neutral-400'>
                        When enabled, servers won’t auto-start on launch.
                      </p>
                    </div>
                    <button
                      type='button'
                      onClick={handleToggleMcpLazyStart}
                      className='p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                      title={mcpLazyStart ? 'Disable lazy start' : 'Enable lazy start'}
                    >
                      <i
                        className={`bx ${mcpLazyStart ? 'bx-toggle-right text-green-500' : 'bx-toggle-left text-neutral-400'} text-xl`}
                      ></i>
                    </button>
                  </div>

                  {/* Status Message */}
                  {mcpActionStatus && (
                    <div
                      className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                        mcpActionStatus.type === 'success'
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}
                    >
                      <i
                        className={`bx ${mcpActionStatus.type === 'success' ? 'bx-check-circle' : 'bx-error-circle'} text-base`}
                      ></i>
                      {mcpActionStatus.message}
                    </div>
                  )}

                  {/* Add Server Button / Form */}
                  {!mcpAddMode ? (
                    <div className='flex flex-wrap items-center gap-3'>
                      <button
                        type='button'
                        onClick={() => setMcpAddMode(true)}
                        className='flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 transition-colors'
                      >
                        <i className='bx bx-plus text-base'></i>
                        Add MCP Server
                      </button>
                      <button
                        type='button'
                        onClick={handleRefreshMcpTools}
                        disabled={mcpRefreshing}
                        className='flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-100 transition-colors disabled:opacity-60'
                      >
                        <i
                          className={`bx ${mcpRefreshing ? 'bx-loader-circle animate-spin' : 'bx-refresh'} text-base`}
                        />
                        Refresh MCP Tools
                      </button>
                    </div>
                  ) : (
                    <div className='space-y-3 p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700'>
                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                          Server Name
                        </label>
                        <input
                          type='text'
                          value={newServerName}
                          onChange={e => setNewServerName(e.target.value)}
                          placeholder='my-server'
                          className='w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                        />
                      </div>
                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>Command</label>
                        <input
                          type='text'
                          value={newServerCommand}
                          onChange={e => setNewServerCommand(e.target.value)}
                          placeholder='npx'
                          className='w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                        />
                      </div>
                      <div className='space-y-2'>
                        <label className='text-xs font-medium text-neutral-600 dark:text-neutral-400'>
                          Arguments (space-separated)
                        </label>
                        <input
                          type='text'
                          value={newServerArgs}
                          onChange={e => setNewServerArgs(e.target.value)}
                          placeholder='-y @anthropic/mcp-server-filesystem /path/to/dir'
                          className='w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500'
                        />
                      </div>
                      <div className='flex items-center gap-2'>
                        <button
                          type='button'
                          onClick={handleAddMcpServer}
                          disabled={!newServerName.trim() || !newServerCommand.trim()}
                          className='px-3 py-1.5 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                        >
                          Add Server
                        </button>
                        <button
                          type='button'
                          onClick={() => {
                            setMcpAddMode(false)
                            setNewServerName('')
                            setNewServerCommand('')
                            setNewServerArgs('')
                          }}
                          className='px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors'
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Help text */}
                  <p className='text-xs text-neutral-500 dark:text-neutral-500'>
                    Example: Command "npx" with args "-y @modelcontextprotocol/server-filesystem /home/user/projects"
                  </p>

                  {/* Connected Servers List */}
                  <div className='mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-700'>
                    <h4 className='text-sm font-medium text-stone-700 dark:text-stone-200 mb-3'>
                      Configured Servers {!mcpLoading && `(${mcpServers.length})`}
                    </h4>

                    {mcpLoading ? (
                      <div className='flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400'>
                        <i className='bx bx-loader-alt animate-spin'></i>
                        Loading servers...
                      </div>
                    ) : mcpServers.length === 0 ? (
                      <p className='text-sm text-neutral-500 dark:text-neutral-400'>
                        No MCP servers configured. Add one above to get started.
                      </p>
                    ) : (
                      <div className='space-y-2'>
                        {mcpServers.map(server => (
                          <div
                            key={server.name}
                            className='flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700'
                          >
                            <div className='flex-1 min-w-0'>
                              <div className='flex items-center gap-2'>
                                <span className='font-medium text-sm text-neutral-900 dark:text-neutral-100'>
                                  {server.name}
                                </span>
                                <span
                                  className={`text-xs px-1.5 py-0.5 rounded ${
                                    server.status === 'connected'
                                      ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                      : server.status === 'connecting'
                                        ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                                        : server.status === 'error'
                                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                                          : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400'
                                  }`}
                                >
                                  {server.status}
                                </span>
                                {server.status === 'connected' && server.toolCount > 0 && (
                                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                                    {server.toolCount} tools
                                  </span>
                                )}
                              </div>
                              <p className='text-xs text-neutral-500 dark:text-neutral-400 truncate mt-0.5'>
                                {server.command} {server.args.join(' ')}
                              </p>
                              {server.error && (
                                <p className='text-xs text-red-500 dark:text-red-400 mt-0.5'>{server.error}</p>
                              )}
                            </div>
                            <div className='flex items-center gap-1 ml-2'>
                              <button
                                type='button'
                                onClick={() => handleToggleMcpServer(server.name, server.status)}
                                className='p-1.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                                title={server.status === 'connected' ? 'Stop server' : 'Start server'}
                              >
                                <i
                                  className={`bx ${
                                    server.status === 'connected'
                                      ? 'bx-stop text-red-500'
                                      : server.status === 'connecting'
                                        ? 'bx-loader-alt animate-spin text-yellow-500'
                                        : 'bx-play text-green-500'
                                  } text-xl`}
                                ></i>
                              </button>
                              <button
                                type='button'
                                onClick={() => handleRemoveMcpServer(server.name)}
                                className='p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors text-neutral-400 hover:text-red-500'
                                title='Remove server'
                              >
                                <i className='bx bx-trash text-lg'></i>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AppStoreModal open={appStoreOpen} onClose={() => setAppStoreOpen(false)} />
    </div>
  )
}
