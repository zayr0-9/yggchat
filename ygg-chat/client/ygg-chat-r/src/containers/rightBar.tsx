import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ConversationId } from '../../../../shared/types'
import { Button, ChatMessage, MonacoFileEditorPane, MonacoGitDiffPane } from '../components'
import { useHtmlIframeRegistry } from '../components/HtmlIframeRegistry/HtmlIframeRegistry'
import { TextArea } from '../components/TextArea/TextArea'
import { useHtmlDarkMode } from '../components/ThemeManager/themeConfig'
import { updateResearchNote } from '../features/conversations/conversationActions'
import { makeSelectConversationById } from '../features/conversations/conversationSelectors'
import { Conversation } from '../features/conversations/conversationTypes'
import { uiActions } from '../features/ui'
import { AGENT_SETTINGS_CHANGE_EVENT, AgentSettings, loadAgentSettings } from '../helpers/agentSettingsStorage'
import { useAuth } from '../hooks/useAuth'
import { clearGlobalAgentOptimisticMessage, setGlobalAgentOptimisticMessage } from '../hooks/useGlobalAgentCache'
import {
  DirectoryFileEntry,
  GitBranch,
  GitCommit,
  GitStatusFile,
  GlobalAgentQueuedTask,
  ResearchNoteItem,
  useDirectoryFiles,
  useDirectoryFileSearch,
  useGitCheckoutBranch,
  useGitCreateBranch,
  useGitDiff,
  useGitOverview,
  useGitStageFiles,
  useGitUnstageFiles,
  useGlobalAgentMessages,
  useGlobalAgentOptimisticMessage,
  useGlobalAgentQueuedTasks,
  useGlobalAgentStreamBuffer,
  useRemoveGlobalAgentQueuedTask,
} from '../hooks/useQueries'
import { globalAgentLoop, GlobalAgentSchedulePreset, GlobalAgentState, GlobalAgentTaskSchedule } from '../services'
import type { RootState } from '../store/store'
import { localApi } from '../utils/api'

interface RightBarProps {
  conversationId: ConversationId | null
  notes?: ResearchNoteItem[]
  isLoadingNotes?: boolean
  className?: string
  ccCwd?: string
  onFilePathInsert?: (path: string) => void
}

type ScheduleIntervalUnit = 'seconds' | 'minutes' | 'hours'

type AgentScheduleDraft = {
  preset: GlobalAgentSchedulePreset
  repeatCount: number
  intervalValue: number
  intervalUnit: ScheduleIntervalUnit
  startDate: string
  endDate: string
  allowedWeekdays: number[]
}

type FileEditorState = {
  path: string
  content: string
  savedContent: string
  loading: boolean
  saving: boolean
  error: string | null
}

type GitDiffTabState = {
  id: string
  path: string
  relativePath: string
  displayPath: string
  staged: boolean
  untracked: boolean
  conflicted: boolean
}

const getFileDockTabId = (filePath: string): string => `file:${filePath}`
const getGitDiffDockTabId = (
  file: Pick<GitStatusFile, 'relativePath' | 'staged' | 'untracked' | 'conflicted'>,
  stagedView: boolean
): string =>
  `git-diff:${file.untracked ? 'untracked' : file.conflicted ? 'conflicted' : stagedView ? 'staged' : 'unstaged'}:${file.relativePath}`

const ALL_WEEKDAYS: number[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOCKED_SIDEBAR_FIXED_WIDTH_PX = 340
const DOCKED_EDITOR_PREFERRED_WIDTH_PX = 720
const DOCKED_CHAT_MIN_WIDTH_PX = 580

const PRESET_CONFIGS: Array<{
  key: GlobalAgentSchedulePreset
  label: string
  intervalValue: number
  intervalUnit: ScheduleIntervalUnit
}> = [
  { key: 'hourly', label: 'Every Hour', intervalValue: 1, intervalUnit: 'hours' },
  { key: 'every_4_hours', label: 'Every 4 Hours', intervalValue: 4, intervalUnit: 'hours' },
  { key: 'every_6_hours', label: 'Every 6 Hours', intervalValue: 6, intervalUnit: 'hours' },
  { key: 'daily', label: 'Every Day', intervalValue: 24, intervalUnit: 'hours' },
]

const intervalUnitToMs = (value: number, unit: ScheduleIntervalUnit): number => {
  const safeValue = Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
  if (unit === 'hours') return safeValue * 60 * 60 * 1000
  if (unit === 'minutes') return safeValue * 60 * 1000
  return safeValue * 1000
}

const RightBar: React.FC<RightBarProps> = ({
  conversationId,
  notes = [],
  isLoadingNotes = false,
  className = '',
  ccCwd = '',
  onFilePathInsert,
}) => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const isWeb = import.meta.env.VITE_ENVIRONMENT === 'web'
  const htmlRegistry = useHtmlIframeRegistry()

  // File browser state
  const [currentPath, setCurrentPath] = useState<string>(ccCwd)
  const [pathHistory, setPathHistory] = useState<string[]>([])
  const [fileSearchQuery, setFileSearchQuery] = useState('')
  const [debouncedFileSearchQuery, setDebouncedFileSearchQuery] = useState('')
  const [followGitignore, setFollowGitignore] = useState(true)
  const { data: directoryData, isLoading: isLoadingFiles, error: filesError } = useDirectoryFiles(currentPath || null)
  const fileSearchBasePath = ccCwd || currentPath || null
  const activeFileSearchQuery = debouncedFileSearchQuery.trim()
  const isFileSearchMode = activeFileSearchQuery.length > 0
  const {
    data: fileSearchData,
    isLoading: isLoadingFileSearch,
    isFetching: isFetchingFileSearch,
    error: fileSearchError,
  } = useDirectoryFileSearch(fileSearchBasePath, activeFileSearchQuery, followGitignore, 200)
  const displayedDirectoryFiles = isFileSearchMode ? fileSearchData?.files || [] : directoryData?.files || []
  const isSearchingFiles = isLoadingFileSearch || isFetchingFileSearch
  const isCollapsed = useSelector((state: RootState) => state.ui.rightBarCollapsed)
  const isDarkMode = useHtmlDarkMode()
  const [openFileEditors, setOpenFileEditors] = useState<FileEditorState[]>([])
  const [openGitDiffTabs, setOpenGitDiffTabs] = useState<GitDiffTabState[]>([])
  const [activeDockTabId, setActiveDockTabId] = useState<string | null>(null)
  const [activeFileEditorPath, setActiveFileEditorPath] = useState<string | null>(null)
  const fileEditorRequestIdRef = useRef<Record<string, number>>({})
  const asideRef = useRef<HTMLElement | null>(null)
  const [dockedLayoutWidth, setDockedLayoutWidth] = useState<number | null>(null)
  const activeFileEditor = useMemo(
    () =>
      activeDockTabId?.startsWith('file:')
        ? (openFileEditors.find(editor => getFileDockTabId(editor.path) === activeDockTabId) ?? null)
        : null,
    [activeDockTabId, openFileEditors]
  )
  const activeGitDiffTab = useMemo(
    () =>
      activeDockTabId?.startsWith('git-diff:')
        ? (openGitDiffTabs.find(tab => tab.id === activeDockTabId) ?? null)
        : null,
    [activeDockTabId, openGitDiffTabs]
  )
  const isEditorDirty = activeFileEditor ? activeFileEditor.content !== activeFileEditor.savedContent : false
  const hasAnyDirtyEditors = openFileEditors.some(editor => editor.content !== editor.savedContent)
  const isEditorDockOpen =
    !isCollapsed && (openFileEditors.length > 0 || openGitDiffTabs.length > 0) && !!activeDockTabId
  const monacoTheme = isDarkMode ? 'vs-dark' : 'vs'
  const dockedSidebarPanelWidth = useMemo(() => {
    if (!isEditorDockOpen) return DOCKED_SIDEBAR_FIXED_WIDTH_PX
    if (dockedLayoutWidth == null) return DOCKED_SIDEBAR_FIXED_WIDTH_PX
    return Math.min(DOCKED_SIDEBAR_FIXED_WIDTH_PX, dockedLayoutWidth)
  }, [dockedLayoutWidth, isEditorDockOpen])

  useEffect(() => {
    if (!isEditorDockOpen) {
      setDockedLayoutWidth(null)
      return
    }

    const asideElement = asideRef.current
    const parentElement = asideElement?.parentElement
    if (!parentElement) return

    const updateDockedLayout = () => {
      const parentWidth = parentElement.clientWidth || 0
      if (parentWidth <= 0) return

      const preferredDockWidth = DOCKED_SIDEBAR_FIXED_WIDTH_PX + DOCKED_EDITOR_PREFERRED_WIDTH_PX
      const widthKeepingChatVisible = parentWidth - DOCKED_CHAT_MIN_WIDTH_PX
      const nextWidth =
        widthKeepingChatVisible >= DOCKED_SIDEBAR_FIXED_WIDTH_PX
          ? Math.min(preferredDockWidth, widthKeepingChatVisible)
          : Math.min(parentWidth, DOCKED_SIDEBAR_FIXED_WIDTH_PX)

      setDockedLayoutWidth(currentWidth => (currentWidth === nextWidth ? currentWidth : nextWidth))
    }

    updateDockedLayout()

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateDockedLayout()) : null

    resizeObserver?.observe(parentElement)
    window.addEventListener('resize', updateDockedLayout)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateDockedLayout)
    }
  }, [isEditorDockOpen])

  // Sync currentPath with ccCwd only when the actual cwd prop changes
  useEffect(() => {
    if (ccCwd && ccCwd !== currentPath) {
      setCurrentPath(ccCwd)
      setPathHistory([])
      setFileSearchQuery('')
      setDebouncedFileSearchQuery('')
    }
    // Intentionally keyed only to ccCwd so folder navigation inside the browser
    // does not get reset back to the root cwd on every currentPath update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccCwd])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedFileSearchQuery(fileSearchQuery)
    }, 220)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [fileSearchQuery])

  // Tab state: 'git' for repository tools, 'note' for single conversation note, 'list' for all notes, 'global' for agent (hidden)
  const [activeTab, setActiveTab] = useState<'git' | 'note' | 'list' | 'global'>('note')
  const gitBasePath = currentPath || ccCwd || null
  const isGitTabAvailable = !isWeb
  const [selectedGitDiff, setSelectedGitDiff] = useState<{
    relativePath: string
    staged: boolean
    untracked: boolean
  } | null>(null)
  const [gitActionFeedback, setGitActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )
  const [newGitBranchName, setNewGitBranchName] = useState('')
  const {
    data: gitOverviewData,
    isLoading: isLoadingGitOverview,
    isFetching: isFetchingGitOverview,
    refetch: refetchGitOverview,
  } = useGitOverview(gitBasePath, isGitTabAvailable && activeTab === 'git' && !isCollapsed)
  const selectedGitStatusFile = useMemo(
    () => gitOverviewData?.status.all.find(file => file.relativePath === selectedGitDiff?.relativePath) ?? null,
    [gitOverviewData?.status.all, selectedGitDiff?.relativePath]
  )
  const shouldLoadGitDiff =
    isGitTabAvailable && !isCollapsed && !!gitBasePath && !!activeGitDiffTab?.relativePath && !!activeDockTabId
  const {
    data: gitDiffData,
    isLoading: isLoadingGitDiff,
    isFetching: isFetchingGitDiff,
  } = useGitDiff(gitBasePath, activeGitDiffTab?.relativePath, Boolean(activeGitDiffTab?.staged), shouldLoadGitDiff)
  const gitStageFilesMutation = useGitStageFiles()
  const gitUnstageFilesMutation = useGitUnstageFiles()
  const gitCheckoutBranchMutation = useGitCheckoutBranch()
  const gitCreateBranchMutation = useGitCreateBranch()

  // Local note state for debounced updates
  const [localNote, setLocalNote] = useState('')
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Global agent state
  const [agentState, setAgentState] = useState<GlobalAgentState>(globalAgentLoop.getState())
  const [agentSettingsName, setAgentSettingsName] = useState<string>('Global Agent')
  const [agentWorkDirectory, setAgentWorkDirectory] = useState<string | null>(null)
  const [agentInput, setAgentInput] = useState<string>('')
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false)
  const [scheduleModalTab, setScheduleModalTab] = useState<'schedule' | 'queue'>('schedule')
  const [removingTaskId, setRemovingTaskId] = useState<string | null>(null)
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDraft, setScheduleDraft] = useState<AgentScheduleDraft>({
    preset: 'hourly',
    repeatCount: 1,
    intervalValue: 1,
    intervalUnit: 'hours',
    startDate: '',
    endDate: '',
    allowedWeekdays: [...ALL_WEEKDAYS],
  })

  // Use React Query hooks for agent messages
  const { data: agentData } = useGlobalAgentMessages()
  const agentMessages = agentData?.messages || []
  const agentConversationDate = agentData?.conversationDate
    ? new Date(agentData.conversationDate).toLocaleDateString()
    : null

  // Subscribe to live streaming updates (triggers re-render on stream buffer changes)
  const agentStreamBuffer = useGlobalAgentStreamBuffer()
  const optimisticMessage = useGlobalAgentOptimisticMessage()
  const isAgentStreaming = Boolean(agentStreamBuffer) || Boolean(agentState.streamId)
  const scheduleModalVisible = scheduleModalOpen && !isCollapsed && activeTab === 'global'
  const {
    data: queuedTasksData,
    isLoading: isLoadingQueuedTasks,
    isFetching: isFetchingQueuedTasks,
  } = useGlobalAgentQueuedTasks(scheduleModalVisible)
  const removeQueuedTaskMutation = useRemoveGlobalAgentQueuedTask()
  const queuedTasks = queuedTasksData?.tasks || []

  const parseJsonSafe = useCallback(<T,>(value: any, fallback: T): T => {
    if (!value) return fallback
    if (typeof value === 'object') return value as T
    if (typeof value !== 'string') return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }, [])

  // Normalize content blocks to handle both old format (text) and new format (content)
  const normalizeContentBlocks = useCallback((blocks: any[]): any[] => {
    return blocks.map((block, idx) => {
      if (block.type === 'text') {
        return {
          ...block,
          index: block.index ?? idx,
          content: block.content ?? block.text ?? '', // Handle both formats
        }
      }
      return { ...block, index: block.index ?? idx }
    })
  }, [])

  const mergedAgentMessages = useMemo(() => {
    if (!agentMessages.length) return []

    const merged: any[] = []
    const toolUseIndex = new Map<string, number>()

    const parseBlocks = (value: any): any[] => {
      const parsed = parseJsonSafe<any[]>(value, [])
      return Array.isArray(parsed) ? parsed : []
    }

    const registerToolUses = (blocks: any[], index: number) => {
      blocks.forEach(block => {
        if (block?.type === 'tool_use') {
          const id = block.id || block.tool_use_id
          if (typeof id === 'string' && id.length > 0) {
            toolUseIndex.set(id, index)
          }
        }
      })
    }

    const registerToolCalls = (toolCallsValue: any, index: number) => {
      const toolCalls = parseJsonSafe<any[]>(toolCallsValue, [])
      if (!Array.isArray(toolCalls)) return
      toolCalls.forEach(call => {
        if (typeof call?.id === 'string' && call.id.length > 0) {
          toolUseIndex.set(call.id, index)
        }
      })
    }

    agentMessages.forEach(message => {
      const role = message.role
      const contentBlocks = parseBlocks(message.content_blocks)

      if (role === 'tool') {
        const toolCallId =
          typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0
            ? message.tool_call_id
            : contentBlocks.find(block => block?.type === 'tool_result' && block.tool_use_id)?.tool_use_id

        if (toolCallId && toolUseIndex.has(toolCallId)) {
          const targetIndex = toolUseIndex.get(toolCallId)!
          const target = merged[targetIndex]
          if (target) {
            const targetBlocks = parseBlocks(target.content_blocks)
            const mergedBlocks = [...targetBlocks, ...contentBlocks]
            target.content_blocks = mergedBlocks
          }
          return
        }
      }

      const nextMessage = { ...message, content_blocks: contentBlocks }
      merged.push(nextMessage)

      const mergedIndex = merged.length - 1
      registerToolUses(contentBlocks, mergedIndex)
      registerToolCalls(message.tool_calls, mergedIndex)
    })

    return merged
  }, [agentMessages, parseJsonSafe])

  const handleOpenToolHtmlModal = useCallback(
    (key?: string) => {
      htmlRegistry?.openModal(key)
    },
    [htmlRegistry]
  )
  const openToolHtmlModal = htmlRegistry ? handleOpenToolHtmlModal : undefined

  // Get conversation data using selector
  const conversation = useSelector(conversationId ? makeSelectConversationById(conversationId) : () => null)

  // Initialize local note from conversation data
  useEffect(() => {
    if (conversation?.research_note !== undefined) {
      setLocalNote(conversation.research_note || '')
    }
  }, [conversation?.research_note])

  useEffect(() => {
    if (isWeb) return
    let mounted = true

    loadAgentSettings()
      .then(settings => {
        if (!mounted) return
        setAgentSettingsName(settings.agentName || 'Global Agent')
        setAgentWorkDirectory(settings.workDirectory || null)
      })
      .catch(error => {
        console.error('Failed to load agent settings:', error)
      })

    const handleAgentSettingsChange = (event: CustomEvent<AgentSettings>) => {
      if (!mounted) return
      setAgentSettingsName(event.detail.agentName || 'Global Agent')
      setAgentWorkDirectory(event.detail.workDirectory || null)
    }

    window.addEventListener(AGENT_SETTINGS_CHANGE_EVENT, handleAgentSettingsChange as EventListener)

    // Subscribe to agent state changes only
    // Stream and message events now update React Query cache directly in GlobalAgentLoop
    const unsubscribe = globalAgentLoop.on(event => {
      if (!mounted) return
      if (event.type === 'state') {
        setAgentState(event.state)
      }
      // Note: stream and message events are handled by GlobalAgentLoop updating the cache
      // No need to manually refetch or update state here
    })

    return () => {
      mounted = false
      window.removeEventListener(AGENT_SETTINGS_CHANGE_EVENT, handleAgentSettingsChange as EventListener)
      unsubscribe()
    }
  }, [])

  // Debounced update function
  const debouncedUpdate = useCallback(
    (note: string) => {
      if (!conversationId) return

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = setTimeout(() => {
        dispatch(updateResearchNote({ id: conversationId, researchNote: note }) as any)
          .unwrap()
          .then(() => {
            const projectId = conversation?.project_id

            // Update all conversations cache
            const conversationsCache = queryClient.getQueryData<Conversation[]>(['conversations'])
            if (conversationsCache) {
              queryClient.setQueryData(
                ['conversations'],
                conversationsCache.map(conv => (conv.id === conversationId ? { ...conv, research_note: note } : conv))
              )
            }

            // Update project conversations cache if project exists
            if (projectId) {
              const projectConversationsCache = queryClient.getQueryData<Conversation[]>([
                'conversations',
                'project',
                projectId,
              ])
              if (projectConversationsCache) {
                queryClient.setQueryData(
                  ['conversations', 'project', projectId],
                  projectConversationsCache.map(conv =>
                    conv.id === conversationId ? { ...conv, research_note: note } : conv
                  )
                )
              }
            }

            // Update recent conversations cache
            const recentCache = queryClient.getQueryData<Conversation[]>(['conversations', 'recent'])
            if (recentCache) {
              queryClient.setQueryData(
                ['conversations', 'recent'],
                recentCache.map(conv => (conv.id === conversationId ? { ...conv, research_note: note } : conv))
              )
            }

            // Update research notes cache
            const researchNotesCache = queryClient.getQueryData<ResearchNoteItem[]>(['research-notes', userId])
            if (researchNotesCache) {
              if (!note || note.trim().length === 0) {
                queryClient.setQueryData(
                  ['research-notes', userId],
                  researchNotesCache.filter(item => item.id !== conversationId)
                )
              } else {
                const existingIndex = researchNotesCache.findIndex(item => item.id === conversationId)
                if (existingIndex >= 0) {
                  queryClient.setQueryData(
                    ['research-notes', userId],
                    researchNotesCache.map(item =>
                      item.id === conversationId
                        ? {
                            ...item,
                            research_note: note,
                            updated_at: new Date().toISOString(),
                          }
                        : item
                    )
                  )
                } else {
                  queryClient.setQueryData(
                    ['research-notes', userId],
                    [
                      {
                        id: conversationId,
                        title: conversation?.title || `Conversation ${conversationId}`,
                        research_note: note,
                        updated_at: new Date().toISOString(),
                        project_id: conversation?.project_id || null,
                      },
                      ...researchNotesCache,
                    ]
                  )
                }
              }
            }
          })
          .catch((error: unknown) => {
            console.error('Failed to update research note:', error)
          })
      }, 1000)
    },
    [conversationId, conversation?.project_id, conversation?.title, dispatch, queryClient, userId]
  )

  // Handle text change
  const handleNoteChange = useCallback(
    (value: string) => {
      setLocalNote(value)
      debouncedUpdate(value)
    },
    [debouncedUpdate]
  )

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
    }
  }, [])

  const toggleCollapse = () => {
    if (!isCollapsed && !confirmCollapseDirtyEditors()) return
    dispatch(uiActions.rightBarToggled())
  }

  const handleNoteClick = (noteItem: ResearchNoteItem) => {
    navigate(`/chat/${noteItem.project_id || 'unknown'}/${noteItem.id}`)
  }

  // File browser navigation
  const handleFileClick = (file: DirectoryFileEntry) => {
    if (!file.isDirectory) return

    setPathHistory(prev => (currentPath && currentPath !== file.path ? [...prev, currentPath] : prev))
    setCurrentPath(file.path)
    setFileSearchQuery('')
    setDebouncedFileSearchQuery('')
  }

  const handleGoBack = () => {
    if (pathHistory.length > 0) {
      const previousPath = pathHistory[pathHistory.length - 1]
      setPathHistory(prev => prev.slice(0, -1))
      setCurrentPath(previousPath)
    } else if (ccCwd) {
      setCurrentPath(ccCwd)
    }
  }

  const handleGoToRoot = () => {
    if (ccCwd) {
      setCurrentPath(ccCwd)
      setPathHistory([])
    }
  }

  const handleClearFileSearch = () => {
    setFileSearchQuery('')
    setDebouncedFileSearchQuery('')
  }

  const getFileName = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/')
    const lastSlash = normalized.lastIndexOf('/')
    return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized
  }, [])

  const dockTabs = useMemo(
    () => [
      ...openFileEditors.map(editor => ({
        id: getFileDockTabId(editor.path),
        label: getFileName(editor.path),
        title: editor.path,
        kind: 'file' as const,
        isDirty: editor.content !== editor.savedContent,
        isSaving: editor.saving,
      })),
      ...openGitDiffTabs.map(tab => ({
        id: tab.id,
        label: `${getFileName(tab.path)}${tab.staged ? ' (staged)' : tab.untracked ? ' (new)' : ''}`,
        title: tab.displayPath,
        kind: 'diff' as const,
        isDirty: false,
        isSaving: false,
      })),
    ],
    [getFileName, openFileEditors, openGitDiffTabs]
  )

  useEffect(() => {
    if (activeDockTabId) return
    if (dockTabs.length === 0) return
    setActiveDockTabId(dockTabs[0].id)
  }, [activeDockTabId, dockTabs])

  useEffect(() => {
    if (!activeDockTabId?.startsWith('file:')) return
    setActiveFileEditorPath(activeDockTabId.slice('file:'.length))
  }, [activeDockTabId])

  const updateOpenFileEditor = useCallback(
    (filePath: string, updater: (editor: FileEditorState) => FileEditorState) => {
      setOpenFileEditors(prev => prev.map(editor => (editor.path === filePath ? updater(editor) : editor)))
    },
    []
  )

  const confirmDiscardSingleEditor = useCallback(
    (filePath: string) => {
      const editor = openFileEditors.find(item => item.path === filePath)
      if (!editor || editor.content === editor.savedContent) return true
      return window.confirm(`Discard unsaved changes in ${getFileName(filePath)}?`)
    },
    [getFileName, openFileEditors]
  )

  const confirmCollapseDirtyEditors = useCallback(() => {
    if (!hasAnyDirtyEditors) return true
    return window.confirm('Collapse the right sidebar while keeping unsaved editor tabs open?')
  }, [hasAnyDirtyEditors])

  const openFileEditor = useCallback(
    async (filePath: string) => {
      if (isWeb || !filePath) return

      const existingEditor = openFileEditors.find(editor => editor.path === filePath)
      dispatch(uiActions.rightBarExpanded())
      setActiveFileEditorPath(filePath)
      setActiveDockTabId(getFileDockTabId(filePath))

      if (existingEditor && !existingEditor.loading && !existingEditor.error) {
        return
      }

      if (!existingEditor) {
        setOpenFileEditors(prev => [
          ...prev,
          {
            path: filePath,
            content: '',
            savedContent: '',
            loading: true,
            saving: false,
            error: null,
          },
        ])
      } else {
        updateOpenFileEditor(filePath, editor => ({ ...editor, loading: true, error: null }))
      }

      const requestId = (fileEditorRequestIdRef.current[filePath] || 0) + 1
      fileEditorRequestIdRef.current[filePath] = requestId

      try {
        const params = new URLSearchParams({ path: filePath })
        const result = await localApi.get<{ path?: string; content?: string; size?: number }>(
          `/local/file-content?${params}`
        )
        if (fileEditorRequestIdRef.current[filePath] !== requestId) return
        const content = typeof result?.content === 'string' ? result.content : ''
        updateOpenFileEditor(filePath, editor => ({
          ...editor,
          content,
          savedContent: content,
          loading: false,
          saving: false,
          error: null,
        }))
      } catch (error) {
        if (fileEditorRequestIdRef.current[filePath] !== requestId) return
        updateOpenFileEditor(filePath, editor => ({
          ...editor,
          content: '',
          savedContent: '',
          loading: false,
          saving: false,
          error: error instanceof Error ? error.message : 'Failed to load file',
        }))
      }
    },
    [dispatch, isWeb, openFileEditors, updateOpenFileEditor]
  )

  const handleFileEditorChange = useCallback(
    (nextValue: string) => {
      if (!activeFileEditorPath) return
      updateOpenFileEditor(activeFileEditorPath, editor => ({ ...editor, content: nextValue }))
    },
    [activeFileEditorPath, updateOpenFileEditor]
  )

  const openGitDiffTab = useCallback(
    (file: GitStatusFile, stagedView: boolean) => {
      const tabId = getGitDiffDockTabId(file, stagedView)
      const nextTab: GitDiffTabState = {
        id: tabId,
        path: file.path,
        relativePath: file.relativePath,
        displayPath: file.displayPath,
        staged: !file.untracked && stagedView,
        untracked: file.untracked,
        conflicted: file.conflicted,
      }

      dispatch(uiActions.rightBarExpanded())
      setOpenGitDiffTabs(prev => (prev.some(tab => tab.id === tabId) ? prev : [...prev, nextTab]))
      setActiveDockTabId(tabId)
    },
    [dispatch]
  )

  const selectDockTab = useCallback((tabId: string) => {
    setActiveDockTabId(tabId)
    if (tabId.startsWith('file:')) {
      const nextPath = tabId.slice('file:'.length)
      setActiveFileEditorPath(nextPath)
    }
  }, [])

  const closeFileEditorTab = useCallback(
    (filePath: string) => {
      const tabIndex = openFileEditors.findIndex(editor => editor.path === filePath)
      if (tabIndex === -1) return
      if (!confirmDiscardSingleEditor(filePath)) return

      fileEditorRequestIdRef.current[filePath] = (fileEditorRequestIdRef.current[filePath] || 0) + 1
      const remainingEditors = openFileEditors.filter(editor => editor.path !== filePath)
      const removedTabId = getFileDockTabId(filePath)
      setOpenFileEditors(remainingEditors)
      setActiveFileEditorPath(currentActive => {
        if (currentActive !== filePath) return currentActive
        const fallbackIndex = Math.min(tabIndex, remainingEditors.length - 1)
        return fallbackIndex >= 0 ? (remainingEditors[fallbackIndex]?.path ?? null) : null
      })
      setActiveDockTabId(currentActive => {
        if (currentActive !== removedTabId) return currentActive
        const remainingDockTabs = [
          ...remainingEditors.map(editor => getFileDockTabId(editor.path)),
          ...openGitDiffTabs.map(tab => tab.id),
        ]
        const fallbackIndex = Math.min(tabIndex, remainingDockTabs.length - 1)
        return fallbackIndex >= 0 ? (remainingDockTabs[fallbackIndex] ?? null) : null
      })
    },
    [confirmDiscardSingleEditor, openFileEditors, openGitDiffTabs]
  )

  const closeGitDiffTab = useCallback(
    (tabId: string) => {
      const tabIndex = openGitDiffTabs.findIndex(tab => tab.id === tabId)
      if (tabIndex === -1) return
      const remainingDiffTabs = openGitDiffTabs.filter(tab => tab.id !== tabId)
      setOpenGitDiffTabs(remainingDiffTabs)
      setActiveDockTabId(currentActive => {
        if (currentActive !== tabId) return currentActive
        const remainingDockTabs = [
          ...openFileEditors.map(editor => getFileDockTabId(editor.path)),
          ...remainingDiffTabs.map(tab => tab.id),
        ]
        const fallbackIndex = Math.min(openFileEditors.length + tabIndex, remainingDockTabs.length - 1)
        return fallbackIndex >= 0 ? (remainingDockTabs[fallbackIndex] ?? null) : null
      })
    },
    [openFileEditors, openGitDiffTabs]
  )

  const closeDockTab = useCallback(
    (tabId: string) => {
      if (tabId.startsWith('file:')) {
        closeFileEditorTab(tabId.slice('file:'.length))
        return
      }
      closeGitDiffTab(tabId)
    },
    [closeFileEditorTab, closeGitDiffTab]
  )

  const closeMonacoDock = useCallback(() => {
    if (!confirmCollapseDirtyEditors()) return
    fileEditorRequestIdRef.current = {}
    setOpenFileEditors([])
    setOpenGitDiffTabs([])
    setActiveFileEditorPath(null)
    setActiveDockTabId(null)
  }, [confirmCollapseDirtyEditors])

  const saveFileEditor = useCallback(async () => {
    if (
      isWeb ||
      !activeFileEditor ||
      activeFileEditor.loading ||
      activeFileEditor.saving ||
      activeFileEditor.content === activeFileEditor.savedContent
    ) {
      return
    }

    updateOpenFileEditor(activeFileEditor.path, editor => ({ ...editor, saving: true, error: null }))

    try {
      const result = await localApi.post<{ path?: string; size?: number; saved?: boolean }>('/local/file-content', {
        path: activeFileEditor.path,
        content: activeFileEditor.content,
      })

      if (result?.saved === false) {
        throw new Error('Save failed')
      }

      updateOpenFileEditor(activeFileEditor.path, editor => ({
        ...editor,
        savedContent: editor.content,
        saving: false,
        error: null,
      }))
    } catch (error) {
      updateOpenFileEditor(activeFileEditor.path, editor => ({
        ...editor,
        saving: false,
        error: error instanceof Error ? error.message : 'Failed to save file',
      }))
    }
  }, [activeFileEditor, isWeb, updateOpenFileEditor])

  const scheduleSummary = useMemo(() => {
    if (!scheduleEnabled) return 'Schedule: Off'
    const repeats = Math.max(1, Math.floor(scheduleDraft.repeatCount || 1))
    const every = Math.max(1, Math.floor(scheduleDraft.intervalValue || 1))
    const unitLabel =
      scheduleDraft.intervalUnit === 'hours'
        ? every === 1
          ? 'hour'
          : 'hours'
        : scheduleDraft.intervalUnit === 'minutes'
          ? every === 1
            ? 'minute'
            : 'minutes'
          : every === 1
            ? 'second'
            : 'seconds'
    const weekdaySummary =
      scheduleDraft.allowedWeekdays.length === 7
        ? 'all days'
        : scheduleDraft.allowedWeekdays
            .slice()
            .sort((a, b) => a - b)
            .map(day => WEEKDAY_LABELS[day])
            .join(', ')
    const rangeLabel =
      scheduleDraft.startDate || scheduleDraft.endDate
        ? ` | ${scheduleDraft.startDate || 'any'} -> ${scheduleDraft.endDate || 'any'}`
        : ''
    return `${repeats} run${repeats > 1 ? 's' : ''}, every ${every} ${unitLabel}, ${weekdaySummary}${rangeLabel}`
  }, [scheduleDraft, scheduleEnabled])

  const handlePresetSelect = (presetKey: GlobalAgentSchedulePreset) => {
    if (presetKey === 'custom') {
      setScheduleDraft(prev => ({ ...prev, preset: 'custom' }))
      return
    }
    const preset = PRESET_CONFIGS.find(item => item.key === presetKey)
    if (!preset) return
    setScheduleDraft(prev => ({
      ...prev,
      preset: preset.key,
      intervalValue: preset.intervalValue,
      intervalUnit: preset.intervalUnit,
    }))
  }

  const toggleScheduleWeekday = (day: number) => {
    setScheduleDraft(prev => {
      const exists = prev.allowedWeekdays.includes(day)
      const nextDays = exists ? prev.allowedWeekdays.filter(value => value !== day) : [...prev.allowedWeekdays, day]
      return {
        ...prev,
        allowedWeekdays: nextDays.length > 0 ? nextDays : [day],
      }
    })
  }

  const buildScheduleConfig = useCallback((): GlobalAgentTaskSchedule | undefined => {
    if (!scheduleEnabled) return undefined
    const repeatCount = Math.max(1, Math.floor(scheduleDraft.repeatCount || 1))
    const intervalValue = Math.max(1, Math.floor(scheduleDraft.intervalValue || 1))
    return {
      repeatCount,
      intervalMs: intervalUnitToMs(intervalValue, scheduleDraft.intervalUnit),
      preset: scheduleDraft.preset,
      startDate: scheduleDraft.startDate || null,
      endDate: scheduleDraft.endDate || null,
      allowedWeekdays: scheduleDraft.allowedWeekdays,
    }
  }, [scheduleDraft, scheduleEnabled])

  const getQueuedTaskRunAtLabel = useCallback(
    (task: GlobalAgentQueuedTask): string | null => {
      const payload = parseJsonSafe<any>(task.payload, null)
      const runAt = payload?.__globalSchedule?.runAt
      if (typeof runAt !== 'string' || runAt.trim().length === 0) return null
      const timestamp = Date.parse(runAt)
      if (Number.isNaN(timestamp)) return null
      return new Date(timestamp).toLocaleString()
    },
    [parseJsonSafe]
  )

  const handleRemoveQueuedTask = useCallback(
    async (taskId: string) => {
      if (isWeb || !taskId) return
      try {
        setRemovingTaskId(taskId)
        await removeQueuedTaskMutation.mutateAsync(taskId)
      } catch (error) {
        console.error('Failed to remove queued task:', error)
      } finally {
        setRemovingTaskId(null)
      }
    },
    [isWeb, removeQueuedTaskMutation]
  )

  const handleAgentSend = async () => {
    if (isWeb) return
    const trimmed = agentInput.trim()
    if (!trimmed) return

    const scheduleConfig = buildScheduleConfig()

    try {
      if (!scheduleConfig) {
        // Create optimistic message for instant UI feedback
        const optimisticUserMessage = {
          id: `temp-${Date.now()}`,
          role: 'user',
          content: trimmed,
          created_at: new Date().toISOString(),
          _optimistic: true, // Flag for styling
        }

        // Add to cache immediately for instant UI update
        setGlobalAgentOptimisticMessage(queryClient, optimisticUserMessage)
      } else {
        clearGlobalAgentOptimisticMessage(queryClient)
      }

      // Clear input
      setAgentInput('')

      // Enqueue task (async) - GlobalAgentLoop will clear optimistic message when real message is persisted
      await globalAgentLoop.enqueueTask(trimmed, undefined, undefined, scheduleConfig)

      // Reset schedule toggle after a successful send
      setScheduleEnabled(false)
    } catch (error) {
      console.error('Failed to enqueue agent task:', error)
      // Clear optimistic message on error
      clearGlobalAgentOptimisticMessage(queryClient)
    }
  }

  const handleAgentAbort = async () => {
    if (isWeb) return
    try {
      await globalAgentLoop.abortCurrentGeneration()
    } catch (error) {
      console.error('Failed to abort agent generation:', error)
    }
  }

  // Get the display name for current path (relative to ccCwd)
  const getDisplayPath = () => {
    if (!currentPath || !ccCwd) return ''
    if (currentPath === ccCwd) return '/'
    return currentPath.replace(ccCwd, '') || '/'
  }

  const fileSearchStatusText = useMemo(() => {
    if (!fileSearchBasePath) {
      return 'Set conversation/project cwd first'
    }

    if (!followGitignore) {
      return `Searching in: ${fileSearchBasePath} (ignoring .gitignore)`
    }

    if (fileSearchData?.respectingGitignore) {
      return `Searching in: ${fileSearchBasePath} (respects .gitignore)`
    }

    return `Searching in: ${fileSearchBasePath} (git repo not detected; fallback search)`
  }, [fileSearchBasePath, followGitignore, fileSearchData?.respectingGitignore])

  useEffect(() => {
    if (activeTab !== 'git') return

    const selected = selectedGitDiff
    const isSelectionStillValid =
      !!selected &&
      !!gitOverviewData?.status.all.some(file => {
        if (file.relativePath !== selected.relativePath) return false
        if (selected.untracked) return file.untracked
        if (selected.staged) return file.staged || file.conflicted
        return file.unstaged || file.untracked || file.conflicted
      })

    if (isSelectionStillValid) return

    const fallbackFile =
      gitOverviewData?.status.conflicted[0] ||
      gitOverviewData?.status.staged[0] ||
      gitOverviewData?.status.unstaged[0] ||
      gitOverviewData?.status.untracked[0] ||
      null

    setSelectedGitDiff(
      fallbackFile
        ? {
            relativePath: fallbackFile.relativePath,
            staged: fallbackFile.staged,
            untracked: fallbackFile.untracked,
          }
        : null
    )
  }, [activeTab, gitOverviewData, selectedGitDiff])

  const gitSummary = gitOverviewData?.summary ?? null
  const gitStatusSections = useMemo(
    () => [
      {
        key: 'conflicted' as const,
        label: 'Conflicted',
        files: gitOverviewData?.status.conflicted || [],
        badgeClass:
          'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200',
      },
      {
        key: 'staged' as const,
        label: 'Staged',
        files: gitOverviewData?.status.staged || [],
        badgeClass:
          'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200',
      },
      {
        key: 'unstaged' as const,
        label: 'Unstaged',
        files: gitOverviewData?.status.unstaged || [],
        badgeClass:
          'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
      },
      {
        key: 'untracked' as const,
        label: 'Untracked',
        files: gitOverviewData?.status.untracked || [],
        badgeClass: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200',
      },
    ],
    [gitOverviewData]
  )
  const displayedGitCommits = useMemo(() => (gitOverviewData?.commits || []).slice(0, 8), [gitOverviewData?.commits])
  const displayedCommitGraphLines = useMemo(
    () => (gitOverviewData?.commitGraphLines || []).slice(0, 18),
    [gitOverviewData?.commitGraphLines]
  )
  const displayedLocalBranches = useMemo(
    () => (gitOverviewData?.branches.local || []).slice(0, 8),
    [gitOverviewData?.branches.local]
  )
  const displayedRemoteBranches = useMemo(
    () => (gitOverviewData?.branches.remote || []).slice(0, 4),
    [gitOverviewData?.branches.remote]
  )
  const isGitBusy =
    gitStageFilesMutation.isPending ||
    gitUnstageFilesMutation.isPending ||
    gitCheckoutBranchMutation.isPending ||
    gitCreateBranchMutation.isPending

  const handleSelectGitDiff = useCallback(
    (file: GitStatusFile, staged: boolean, openInDock = true) => {
      setSelectedGitDiff({
        relativePath: file.relativePath,
        staged: !file.untracked && staged,
        untracked: file.untracked,
      })
      if (openInDock) {
        openGitDiffTab(file, staged)
      }
    },
    [openGitDiffTab]
  )

  const handleGitStageAll = useCallback(async () => {
    if (!gitBasePath) return
    try {
      const result = await gitStageFilesMutation.mutateAsync({ path: gitBasePath })
      setGitActionFeedback({ type: 'success', message: result.message })
      await refetchGitOverview()
    } catch (error) {
      setGitActionFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to stage all changes',
      })
    }
  }, [gitBasePath, gitStageFilesMutation, refetchGitOverview])

  const handleGitStageFile = useCallback(
    async (file: GitStatusFile) => {
      if (!gitBasePath) return
      try {
        const result = await gitStageFilesMutation.mutateAsync({
          path: gitBasePath,
          files: [file.relativePath],
        })
        setGitActionFeedback({ type: 'success', message: result.message })
        setSelectedGitDiff({ relativePath: file.relativePath, staged: true, untracked: false })
        await refetchGitOverview()
      } catch (error) {
        setGitActionFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : `Failed to stage ${file.relativePath}`,
        })
      }
    },
    [gitBasePath, gitStageFilesMutation, refetchGitOverview]
  )

  const handleGitUnstageFile = useCallback(
    async (file: GitStatusFile) => {
      if (!gitBasePath) return
      try {
        const result = await gitUnstageFilesMutation.mutateAsync({
          path: gitBasePath,
          files: [file.relativePath],
        })
        setGitActionFeedback({ type: 'success', message: result.message })
        setSelectedGitDiff({ relativePath: file.relativePath, staged: false, untracked: false })
        await refetchGitOverview()
      } catch (error) {
        setGitActionFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : `Failed to unstage ${file.relativePath}`,
        })
      }
    },
    [gitBasePath, gitUnstageFilesMutation, refetchGitOverview]
  )

  const handleGitCheckoutBranch = useCallback(
    async (branch: GitBranch) => {
      if (!gitBasePath || !branch.name || branch.current) return
      try {
        const result = await gitCheckoutBranchMutation.mutateAsync({ path: gitBasePath, branch: branch.name })
        setGitActionFeedback({ type: 'success', message: result.message })
        await refetchGitOverview()
      } catch (error) {
        setGitActionFeedback({
          type: 'error',
          message: error instanceof Error ? error.message : `Failed to checkout ${branch.name}`,
        })
      }
    },
    [gitBasePath, gitCheckoutBranchMutation, refetchGitOverview]
  )

  const handleGitCreateBranch = useCallback(async () => {
    const nextBranch = newGitBranchName.trim()
    if (!gitBasePath || !nextBranch) return
    try {
      const result = await gitCreateBranchMutation.mutateAsync({
        path: gitBasePath,
        branch: nextBranch,
        checkout: true,
      })
      setGitActionFeedback({ type: 'success', message: result.message })
      setNewGitBranchName('')
      await refetchGitOverview()
    } catch (error) {
      setGitActionFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : `Failed to create branch ${nextBranch}`,
      })
    }
  }, [gitBasePath, gitCreateBranchMutation, newGitBranchName, refetchGitOverview])

  return (
    <aside
      ref={asideRef}
      className={`relative z-10 ${isWeb ? 'h-[100vh]' : 'h-full'} flex flex-col overflow-hidden transition-all duration-300 ease-in-out bg-transparent dark:bg-transparent flex-shrink-0 ${isCollapsed ? 'w-11' : isEditorDockOpen ? '' : 'w-64 md:w-72 lg:w-80 xl:w-90'} ${className}`}
      style={
        isEditorDockOpen && dockedLayoutWidth != null
          ? {
              width: `${dockedLayoutWidth}px`,
              maxWidth: '100%',
            }
          : undefined
      }
      aria-label='Research Notes'
    >
      {/* Toggle Button */}
      <div className='flex items-center justify-between py-3 my-1 md:py-2.5 lg:p-1 xl:p-1 2xl:px-1 2xl:py-2'>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline2'
            size='circle'
            rounded='full'
            onClick={toggleCollapse}
            className={`${isCollapsed ? 'mx-auto' : 'ml-0'} mb-2 transition-transform duration-200 hover:scale-103 px-2 py-2 acrylic-ultra-light-nb-3`}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <i className={`bx ${isCollapsed ? 'bx-chevron-left' : 'bx-chevron-right'} text-xl`} aria-hidden='true'></i>
          </Button>

          {isEditorDockOpen && (
            <span className='leading-none rounded-[18px] py-2 px-3.5 bg-neutral-50 font-semibold text-[22px] text-neutral-600 dark:text-neutral-200 acrylic-ultra-light-nb-3'>
              Editor
            </span>
          )}
        </div>

        {/* {!isCollapsed && (
          <h2 className='leading-none text-[14px] md:text-[16px] lg:text-[16px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[22px] rounded-[18px] py-2 px-2.5 font-semibold text-neutral-700 dark:text-neutral-200 truncate bg-neutral-50 acrylic-ultra-light-nb-3'>
            Explorer
          </h2>
        )} */}
      </div>

      {/* Main content wrapper - equal height sections when expanded */}
      <div className={`flex-1 ${isCollapsed ? 'flex flex-col' : 'flex min-h-0'}`}>
        {isEditorDockOpen && (
          <div className='min-w-0 flex-1 px-2 pb-2'>
            {activeFileEditor ? (
              <MonacoFileEditorPane
                filePath={activeFileEditor.path}
                value={activeFileEditor.content}
                loading={activeFileEditor.loading}
                error={activeFileEditor.error}
                isDirty={isEditorDirty}
                isSaving={activeFileEditor.saving}
                theme={monacoTheme}
                tabs={dockTabs}
                activeTabId={activeDockTabId}
                onChange={handleFileEditorChange}
                onSave={() => {
                  void saveFileEditor()
                }}
                onClose={closeMonacoDock}
                onSelectTab={selectDockTab}
                onCloseTab={closeDockTab}
              />
            ) : activeGitDiffTab ? (
              <MonacoGitDiffPane
                title={activeGitDiffTab.displayPath}
                filePath={activeGitDiffTab.path}
                originalValue={gitDiffData?.original?.content ?? ''}
                modifiedValue={gitDiffData?.modified?.content ?? ''}
                originalLabel={gitDiffData?.original?.label ?? 'Original'}
                modifiedLabel={gitDiffData?.modified?.label ?? 'Modified'}
                loading={isLoadingGitDiff || isFetchingGitDiff}
                error={null}
                theme={monacoTheme}
                language={gitDiffData?.languageHint || 'plaintext'}
                message={gitDiffData?.message ?? null}
                patch={gitDiffData?.diff ?? ''}
                preferPatch={Boolean(gitDiffData?.preferPatch || (!gitDiffData?.original && !gitDiffData?.modified))}
                tabs={dockTabs}
                activeTabId={activeDockTabId}
                onClose={closeMonacoDock}
                onOpenFile={activeGitDiffTab.path ? () => void openFileEditor(activeGitDiffTab.path) : null}
                onSelectTab={selectDockTab}
                onCloseTab={closeDockTab}
              />
            ) : null}
          </div>
        )}
        <div
          className={`min-w-0 overflow-hidden flex ${isCollapsed ? 'flex-col' : 'min-h-0 flex-1 flex-col'} ${
            isEditorDockOpen ? 'flex-shrink-0  ' : 'flex-1'
          }`}
          style={
            isEditorDockOpen
              ? {
                  width: `${dockedSidebarPanelWidth}px`,
                  minWidth: `${dockedSidebarPanelWidth}px`,
                  maxWidth: `${dockedSidebarPanelWidth}px`,
                  flexBasis: `${dockedSidebarPanelWidth}px`,
                }
              : undefined
          }
        >
          {/* File browser - show when ccCwd is set and expanded */}
          {!isCollapsed && ccCwd && (
            <div className='min-w-0 flex-1 min-h-0 flex flex-col overflow-hidden px-2 pb-2 border-b border-neutral-200 dark:border-neutral-800'>
              {/* Path header with navigation */}
              <div className='flex min-w-0 items-center gap-2 mb-2 flex-shrink-0 overflow-hidden'>
                <button
                  onClick={handleGoToRoot}
                  className='w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors bg-neutral-50 acrylic-ultra-light-nb-3 '
                  title='Go to root'
                  disabled={currentPath === ccCwd}
                >
                  <i className='bx bx-home text-sm leading-none text-neutral-600 dark:text-neutral-100' />
                </button>
                <button
                  onClick={handleGoBack}
                  className='w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors bg-neutral-50 acrylic-ultra-light-nb-3'
                  title='Go back'
                  disabled={pathHistory.length === 0}
                >
                  <i className='bx bx-arrow-back text-sm leading-none text-neutral-600 dark:text-neutral-100' />
                </button>
                {onFilePathInsert && currentPath && (
                  <button
                    onClick={() => onFilePathInsert(currentPath)}
                    className='w-7 h-7 flex items-center justify-center rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors bg-neutral-50 acrylic-ultra-light-nb-3'
                    title='Insert current directory path'
                  >
                    <i className='bx bx-folder-plus text-sm leading-none text-neutral-600 dark:text-neutral-100' />
                  </button>
                )}
                <span
                  className='text-[10px] text-neutral-500 dark:text-neutral-400 truncate flex-1'
                  title={currentPath}
                >
                  {getDisplayPath()}
                </span>
              </div>

              <div className='flex min-w-0 items-center gap-1 mb-1 flex-shrink-0 overflow-hidden'>
                <input
                  type='search'
                  value={fileSearchQuery}
                  onChange={event => setFileSearchQuery(event.target.value)}
                  placeholder='Find Files..'
                  disabled={!fileSearchBasePath}
                  className='flex-1 min-w-0 rounded-[12px] placeholder-neutral-800  dark:placeholder-neutral-100 bg-neutral-50 acrylic-ultra-light-nb-3 dark:bg-neutral-800 px-2 py-1 text-[13px] text-neutral-700 dark:text-neutral-100 outline-none'
                />
                <button
                  onClick={handleClearFileSearch}
                  className='shrink-0 whitespace-nowrap px-1.5 py-1 rounded-[10px] text-[11px] hover:bg-neutral-200/70 dark:hover:bg-neutral-300/80 dark:text-neutral-100 dark:hover:text-neutral-900 transition-colors disabled:opacity-50'
                  disabled={fileSearchQuery.length === 0}
                  title='Clear search'
                >
                  Clear
                </button>
                <button
                  onClick={() => setFollowGitignore(value => !value)}
                  className='shrink-0 max-w-[8.5rem] truncate px-1.5 py-1 rounded-[10px] text-[11px] hover:bg-neutral-200/70 dark:hover:bg-neutral-300/80 dark:text-neutral-100 dark:hover:text-neutral-900 transition-colors'
                  title='Toggle .gitignore-aware search'
                >
                  {followGitignore ? '.gitignore on' : '.gitignore off'}
                </button>
              </div>

              <div className='mb-2 text-[10px] text-neutral-500 dark:text-neutral-200 flex-shrink-0'>
                {fileSearchStatusText}
                {isFileSearchMode && fileSearchData?.truncated ? ' - Results limited' : ''}
              </div>

              {/* File list */}
              <div className='flex-1 overflow-y-auto no-scrollbar'>
                {!isFileSearchMode && isLoadingFiles && (
                  <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>Loading files...</div>
                )}
                {!isFileSearchMode && filesError && (
                  <div className='text-[10px] text-red-500 dark:text-red-400 py-1'>
                    {filesError instanceof Error ? filesError.message : 'Failed to load files'}
                  </div>
                )}
                {!isFileSearchMode && directoryData?.files && directoryData.files.length === 0 && !isLoadingFiles && (
                  <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>Empty directory</div>
                )}

                {isFileSearchMode && isSearchingFiles && (
                  <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>
                    Searching subdirectories...
                  </div>
                )}
                {isFileSearchMode && fileSearchError && (
                  <div className='text-[10px] text-red-500 dark:text-red-400 py-1'>
                    {fileSearchError instanceof Error ? fileSearchError.message : 'Failed to search files'}
                  </div>
                )}
                {isFileSearchMode && !isSearchingFiles && !fileSearchError && displayedDirectoryFiles.length === 0 && (
                  <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>No matches</div>
                )}

                {displayedDirectoryFiles.map(file => (
                  <div
                    key={`${isFileSearchMode ? 'search' : 'list'}-${file.path}`}
                    className='flex items-center gap-1.5 rounded-[10px] my-1.5 bg-neutral-50 acrylic-ultra-light-nb-3 px-1.5 py-0.5 rounded text-[13px] transition-colors group'
                  >
                    <div
                      role='button'
                      tabIndex={0}
                      onClick={() => handleFileClick(file)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleFileClick(file)
                        }
                      }}
                      className={`flex items-center gap-1.5 flex-1 min-w-0 ${
                        file.isDirectory
                          ? 'cursor-pointer hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded px-1 -mx-1'
                          : 'cursor-default text-neutral-500 dark:text-neutral-400'
                      }`}
                      title={file.path}
                    >
                      <i
                        className={`bx ${file.isDirectory ? 'bx-folder text-amber-500' : 'bx-file text-neutral-400'} text-sm flex-shrink-0`}
                      />
                      <div className='min-w-0 flex-1'>
                        <div className='truncate text-neutral-700 dark:text-neutral-300'>{file.name}</div>
                        {isFileSearchMode && file.relativePath && file.relativePath !== file.name && (
                          <div className='truncate text-[10px] text-neutral-500 dark:text-neutral-400'>
                            {file.relativePath}
                          </div>
                        )}
                      </div>
                    </div>
                    {!file.isDirectory && !isWeb && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          void openFileEditor(file.path)
                        }}
                        className={`p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors flex-shrink-0 ${
                          activeFileEditorPath === file.path
                            ? 'opacity-100 bg-neutral-200 dark:bg-neutral-700/60'
                            : 'opacity-0 group-hover:opacity-100'
                        }`}
                        title='Open in editor'
                      >
                        <i className='bx bx-pencil text-sm text-neutral-600 dark:text-neutral-300' />
                      </button>
                    )}
                    {onFilePathInsert && (
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          onFilePathInsert(file.path)
                        }}
                        className='p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0'
                        title='Insert path to input'
                      >
                        <i className='bx bx-plus text-sm text-neutral-600 dark:text-neutral-400' />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab buttons - only show when expanded */}
          {!isCollapsed && (
            <div className='flex min-w-0 gap-2 overflow-hidden px-3 py-2 flex-shrink-0'>
              {!isWeb && (
                <button
                  onClick={() => setActiveTab('git')}
                  className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                    activeTab === 'git'
                      ? 'bg-neutral-50 acrylic-ultra-light-nb-3 text-stone-800 dark:text-stone-200 scale-102 dark:border-transparent shadow-[0px_0.5px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.05)]'
                      : 'bg-transparent text-stone-600 dark:text-stone-300 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 '
                  }`}
                >
                  GIT
                </button>
              )}
              <button
                onClick={() => setActiveTab('note')}
                className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                  activeTab === 'note'
                    ? 'bg-neutral-50 acrylic-ultra-light-nb-3 text-stone-800 dark:text-stone-200 scale-102 dark:border-transparent shadow-[0px_0.5px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.05)]'
                    : 'bg-transparent text-stone-600 dark:text-stone-300 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 '
                }`}
              >
                Note
              </button>
              <button
                onClick={() => setActiveTab('list')}
                className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                  activeTab === 'list'
                    ? 'bg-neutral-50 acrylic-ultra-light-nb-3 text-stone-800 dark:text-stone-200 scale-102 dark:border-transparent shadow-[0px_0.5px_3px_-0.5px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.05)]'
                    : 'bg-transparent hover:scale-101 text-stone-600 dark:text-stone-300 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 '
                }`}
              >
                List
              </button>
              {/* Global tab intentionally hidden.
            <button
              onClick={() => setActiveTab('global')}
              className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                activeTab === 'global'
                  ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 border-neutral-300 scale-102 dark:border-neutral-600 shadow-[0px_0.5px_3px_-0.5px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.35)]'
                  : 'bg-transparent hover:scale-101 text-stone-600 dark:text-stone-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
              }`}
            >
              Global
            </button>
            */}
            </div>
          )}

          {/* Content Area */}
          <div
            className={`${!isCollapsed && ccCwd ? 'flex-1' : 'flex-1'} min-w-0 min-h-0 overflow-y-auto overflow-x-hidden p-2 pt-2 2xl:pt-2 no-scrollbar scroll-fade dark:border-neutral-800 rounded-xl border-t-0`}
            data-heimdall-wheel-exempt='true'
            data-heimdall-contextmenu-exempt='true'
          >
            {isCollapsed ? (
              // Collapsed state - show icons only
              <div className='flex flex-col items-center gap-2'>
                {ccCwd && (
                  <Button
                    variant='outline2'
                    size='circle'
                    rounded='full'
                    className='h-10 w-10 transition-transform duration-200 hover:scale-103 '
                    onClick={toggleCollapse}
                    title='Expand to view files'
                  >
                    <i className='bx bx-folder text-lg' aria-hidden='true'></i>
                  </Button>
                )}
                <Button
                  variant='outline2'
                  size='circle'
                  rounded='full'
                  className='h-10 w-10 transition-transform duration-200 hover:scale-103 '
                  onClick={toggleCollapse}
                  title='Expand to view notes'
                >
                  <i className='bx bx-note text-lg' aria-hidden='true'></i>
                </Button>
              </div>
            ) : activeTab === 'git' ? (
              !gitBasePath ? (
                <div className='text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1'>
                  Set conversation/project cwd first to inspect repository state.
                </div>
              ) : isLoadingGitOverview && !gitOverviewData ? (
                <div className='text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1'>Loading repository...</div>
              ) : !gitOverviewData?.isGitRepo || !gitSummary ? (
                <div className='space-y-2 px-2 py-1'>
                  <div className='text-xs text-neutral-500 dark:text-neutral-400'>
                    No git repository detected for this path.
                  </div>
                  <div className='text-[11px] text-neutral-500 dark:text-neutral-400 break-all'>{gitBasePath}</div>
                  <Button variant='outline2' size='small' onClick={() => void refetchGitOverview()}>
                    Retry
                  </Button>
                </div>
              ) : (
                <div className='flex flex-col gap-3'>
                  {gitActionFeedback && (
                    <div
                      className={`rounded-lg border px-3 py-2 text-xs ${
                        gitActionFeedback.type === 'success'
                          ? 'bg-neutral-50/80 text-emerald-700 dark:bg-neutral-500/10 dark:text-emerald-200'
                          : 'bg-neutral-50/80 text-rose-700 dark:bg-neutral-500/10 dark:text-rose-200'
                      }`}
                    >
                      <div className='flex items-start justify-between gap-2'>
                        <span>{gitActionFeedback.message}</span>
                        <button
                          onClick={() => setGitActionFeedback(null)}
                          className='text-current opacity-70 hover:opacity-100'
                          title='Dismiss'
                        >
                          <i className='bx bx-x text-sm' />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className='min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                      <div className='min-w-0 flex-1'>
                        <div className='flex min-w-0 flex-wrap items-center gap-2'>
                          <i className='bx bx-git-repo-forked shrink-0 text-base text-neutral-600 dark:text-neutral-300' />
                          <span className='min-w-0 truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                            {gitSummary.repoName}
                          </span>
                          {gitSummary.isClean ? (
                            <span className='shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'>
                              Clean
                            </span>
                          ) : (
                            <span className='shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200'>
                              Dirty
                            </span>
                          )}
                        </div>
                        <div className='mt-1 text-[11px] text-neutral-500 dark:text-neutral-400 break-all'>
                          {gitSummary.repoRoot}
                        </div>
                        <div className='mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-neutral-600 dark:text-neutral-300'>
                          <span className='max-w-full truncate rounded-full border border-neutral-200 px-2 py-0.5 dark:border-neutral-700'>
                            branch: {gitSummary.currentBranch || 'detached HEAD'}
                          </span>
                          {gitSummary.headShortSha && (
                            <span className='shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 dark:border-neutral-700'>
                              {gitSummary.headShortSha}
                            </span>
                          )}
                          {gitSummary.upstreamBranch && (
                            <span className='max-w-full truncate rounded-full border border-neutral-200 px-2 py-0.5 dark:border-neutral-700'>
                              {gitSummary.upstreamBranch}
                            </span>
                          )}
                          {(gitSummary.ahead > 0 || gitSummary.behind > 0) && (
                            <span className='shrink-0 rounded-full border border-neutral-200 px-2 py-0.5 dark:border-neutral-700'>
                              ↑{gitSummary.ahead} ↓{gitSummary.behind}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className='flex w-full flex-wrap gap-2 sm:w-auto sm:flex-shrink-0'>
                        <Button
                          variant='outline2'
                          size='small'
                          onClick={() => void refetchGitOverview()}
                          disabled={isFetchingGitOverview || isGitBusy}
                          className='px-2'
                          aria-label={
                            isFetchingGitOverview ? 'Refreshing repository overview' : 'Refresh repository overview'
                          }
                          title={
                            isFetchingGitOverview ? 'Refreshing repository overview' : 'Refresh repository overview'
                          }
                        >
                          <i
                            className={`bx ${isFetchingGitOverview ? 'bx-loader-circle animate-spin' : 'bx-refresh'} text-base`}
                            aria-hidden='true'
                          />
                        </Button>
                        <Button
                          variant='outline2'
                          size='small'
                          onClick={() => void handleGitStageAll()}
                          disabled={gitSummary.changedFilesCount === 0 || gitStageFilesMutation.isPending}
                          className='px-2'
                          aria-label={
                            gitStageFilesMutation.isPending ? 'Staging all changed files' : 'Stage all changed files'
                          }
                          title={
                            gitStageFilesMutation.isPending ? 'Staging all changed files' : 'Stage all changed files'
                          }
                        >
                          <i
                            className={`bx ${gitStageFilesMutation.isPending ? 'bx-loader-circle animate-spin' : 'bx-upload'} text-base`}
                            aria-hidden='true'
                          />
                        </Button>
                      </div>
                    </div>

                    <div className='mt-3 grid grid-cols-2 gap-2 text-[11px]'>
                      <div className='rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'>
                        <div className='text-neutral-500 dark:text-neutral-400'>Changed</div>
                        <div className='text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                          {gitSummary.changedFilesCount}
                        </div>
                      </div>
                      <div className='rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'>
                        <div className='text-neutral-500 dark:text-neutral-400'>Staged</div>
                        <div className='text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                          {gitSummary.stagedCount}
                        </div>
                      </div>
                      <div className='rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'>
                        <div className='text-neutral-500 dark:text-neutral-400'>Unstaged</div>
                        <div className='mt-1 flex items-center justify-between gap-2'>
                          <div className='text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                            {gitSummary.unstagedCount}
                          </div>
                          <Button
                            variant='outline2'
                            size='small'
                            onClick={() => void handleGitStageAll()}
                            disabled={
                              (gitSummary.unstagedCount === 0 && gitSummary.untrackedCount === 0) ||
                              gitStageFilesMutation.isPending
                            }
                            className='px-2 py-0.5 text-[10px]'
                            title={
                              gitStageFilesMutation.isPending ? 'Staging all changed files' : 'Stage all changed files'
                            }
                          >
                            {gitStageFilesMutation.isPending ? 'Staging...' : 'Stage all'}
                          </Button>
                        </div>
                      </div>
                      <div className='rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'>
                        <div className='text-neutral-500 dark:text-neutral-400'>Untracked</div>
                        <div className='text-sm font-semibold text-neutral-900 dark:text-neutral-100'>
                          {gitSummary.untrackedCount}
                        </div>
                      </div>
                    </div>

                    {gitSummary.remoteUrl && (
                      <div className='mt-3 text-[11px] text-neutral-500 dark:text-neutral-400 break-all'>
                        remote: {gitSummary.remoteUrl}
                      </div>
                    )}
                  </div>

                  <div className='rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <h3 className='text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400'>
                        Changes
                      </h3>
                      <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                        {gitSummary.changedFilesCount} file{gitSummary.changedFilesCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className='space-y-2'>
                      {gitStatusSections.every(section => section.files.length === 0) ? (
                        <div className='text-xs text-neutral-500 dark:text-neutral-400'>Working tree is clean.</div>
                      ) : (
                        gitStatusSections.map(section => (
                          <div
                            key={section.key}
                            className='rounded-lg border border-neutral-200/80 p-2 dark:border-neutral-800'
                          >
                            <div className='mb-2 flex items-center justify-between gap-2'>
                              <span className='text-xs font-medium text-neutral-800 dark:text-neutral-200'>
                                {section.label}
                              </span>
                              <div className='flex items-center gap-2'>
                                {section.key === 'unstaged' && (
                                  <Button
                                    variant='outline2'
                                    size='small'
                                    onClick={() => void handleGitStageAll()}
                                    disabled={
                                      (gitSummary.unstagedCount === 0 && gitSummary.untrackedCount === 0) ||
                                      gitStageFilesMutation.isPending
                                    }
                                    className='px-2 py-0.5 text-[10px]'
                                    title={
                                      gitStageFilesMutation.isPending
                                        ? 'Staging all changed files'
                                        : 'Stage all changed files'
                                    }
                                  >
                                    {gitStageFilesMutation.isPending ? 'Staging...' : 'Stage all'}
                                  </Button>
                                )}
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${section.badgeClass}`}
                                >
                                  {section.files.length}
                                </span>
                              </div>
                            </div>

                            {section.files.length === 0 ? (
                              <div className='text-[11px] text-neutral-500 dark:text-neutral-400'>No files</div>
                            ) : (
                              <div
                                className={
                                  section.key === 'staged' || section.key === 'unstaged' || section.key === 'untracked'
                                    ? 'max-h-56 space-y-1 overflow-y-auto pr-1 thin-scrollbar'
                                    : 'space-y-2'
                                }
                              >
                                {section.files.map(file => {
                                  const isSelected =
                                    selectedGitDiff?.relativePath === file.relativePath &&
                                    (section.key === 'staged'
                                      ? Boolean(selectedGitDiff?.staged) && !selectedGitDiff?.untracked
                                      : section.key === 'untracked'
                                        ? Boolean(selectedGitDiff?.untracked)
                                        : !selectedGitDiff?.staged && !selectedGitDiff?.untracked)

                                  return section.key === 'staged' ||
                                    section.key === 'unstaged' ||
                                    section.key === 'untracked' ? (
                                    <div
                                      key={`${section.key}-${file.relativePath}`}
                                      className={`group relative min-w-0 overflow-hidden rounded-md border transition-colors ${
                                        isSelected
                                          ? 'border-sky-300 bg-sky-50/70 dark:border-sky-500/50 dark:bg-sky-500/10'
                                          : 'border-transparent bg-neutral-50/70 dark:bg-neutral-950/30'
                                      }`}
                                    >
                                      <button
                                        onClick={() => handleSelectGitDiff(file, section.key === 'staged')}
                                        className='flex w-full min-w-0 items-center gap-2 px-2 py-1.5 pr-24 text-left'
                                        title={file.displayPath}
                                      >
                                        <span className='shrink-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'>
                                          {file.code}
                                        </span>
                                        <span className='block min-w-0 truncate text-xs font-medium text-neutral-800 dark:text-neutral-200'>
                                          {file.displayPath}
                                        </span>
                                      </button>
                                      <div
                                        className={`absolute inset-y-0 right-0 flex items-center gap-1 px-1.5 pl-6 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${
                                          isSelected
                                            ? 'bg-gradient-to-l from-sky-50/95 via-sky-50/90 to-transparent dark:from-sky-500/15 dark:via-sky-500/10'
                                            : 'bg-gradient-to-l from-white/95 via-white/90 to-transparent dark:from-neutral-900/95 dark:via-neutral-900/85'
                                        }`}
                                      >
                                        <button
                                          onClick={() => openGitDiffTab(file, section.key === 'staged')}
                                          className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                          aria-label='Open diff'
                                          title='Open diff'
                                        >
                                          <i className='bx bx-git-compare text-[12px]' aria-hidden='true' />
                                        </button>
                                        {!file.isDeleted && !isWeb && (
                                          <button
                                            onClick={() => void openFileEditor(file.path)}
                                            className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            aria-label='Open file'
                                            title='Open file'
                                          >
                                            <i className='bx bx-file text-[12px]' aria-hidden='true' />
                                          </button>
                                        )}
                                        {onFilePathInsert && (
                                          <button
                                            onClick={() => onFilePathInsert(file.path)}
                                            className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            aria-label='Insert path'
                                            title='Insert path'
                                          >
                                            <i className='bx bx-export text-[12px]' aria-hidden='true' />
                                          </button>
                                        )}
                                        {section.key === 'staged' ? (
                                          <button
                                            onClick={() => void handleGitUnstageFile(file)}
                                            disabled={gitUnstageFilesMutation.isPending}
                                            className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            aria-label='Unstage file'
                                            title='Unstage file'
                                          >
                                            <i className='bx bx-download text-[12px]' aria-hidden='true' />
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => void handleGitStageFile(file)}
                                            disabled={gitStageFilesMutation.isPending}
                                            className='inline-flex h-6 w-6 items-center justify-center rounded-full border border-neutral-200 text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            aria-label='Stage file'
                                            title='Stage file'
                                          >
                                            <i className='bx bx-upload text-[12px]' aria-hidden='true' />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ) : (
                                    <div
                                      key={`${section.key}-${file.relativePath}`}
                                      className={`min-w-0 overflow-hidden rounded-lg border px-2 py-2 transition-colors ${
                                        isSelected
                                          ? 'border-sky-300 bg-sky-50/70 dark:border-sky-500/50 dark:bg-sky-500/10'
                                          : 'border-transparent bg-neutral-50/70 dark:bg-neutral-950/30'
                                      }`}
                                    >
                                      <div className='flex min-w-0 flex-wrap items-start gap-2'>
                                        <button
                                          onClick={() => handleSelectGitDiff(file, false)}
                                          className='min-w-0 flex-1 text-left'
                                        >
                                          <div className='flex min-w-0 items-center gap-2'>
                                            <span className='shrink-0 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'>
                                              {file.code}
                                            </span>
                                            <span className='block min-w-0 truncate text-xs font-medium text-neutral-800 dark:text-neutral-200 overflow-left'>
                                              {file.displayPath}
                                            </span>
                                          </div>
                                          <div className='mt-1 break-words text-[11px] text-neutral-500 dark:text-neutral-400'>
                                            {file.isDeleted
                                              ? 'Deleted'
                                              : file.isRenamed
                                                ? 'Renamed'
                                                : file.untracked
                                                  ? 'Untracked'
                                                  : file.conflicted
                                                    ? 'Conflict requires resolution'
                                                    : 'Modified in working tree'}
                                          </div>
                                        </button>
                                        <div className='flex w-full flex-wrap gap-1.5 sm:w-auto sm:flex-col sm:flex-shrink-0'>
                                          <button
                                            onClick={() => openGitDiffTab(file, false)}
                                            className='rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                          >
                                            Open Diff
                                          </button>
                                          {!file.isDeleted && !isWeb && (
                                            <button
                                              onClick={() => void openFileEditor(file.path)}
                                              className='rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            >
                                              Open
                                            </button>
                                          )}
                                          {onFilePathInsert && (
                                            <button
                                              onClick={() => onFilePathInsert(file.path)}
                                              className='rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                            >
                                              Insert
                                            </button>
                                          )}
                                          <button
                                            onClick={() => void handleGitStageFile(file)}
                                            disabled={gitStageFilesMutation.isPending}
                                            className='rounded-md border border-neutral-200 px-2 py-1 text-[10px] text-neutral-700 transition-colors hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                          >
                                            Stage
                                          </button>
                                        </div>
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className='rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <h3 className='text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400'>
                        Diff Preview
                      </h3>
                      {selectedGitDiff && (
                        <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                          {selectedGitDiff.staged ? 'staged' : selectedGitDiff.untracked ? 'untracked' : 'working tree'}
                        </span>
                      )}
                    </div>

                    {!selectedGitDiff || !selectedGitStatusFile ? (
                      <div className='text-xs text-neutral-500 dark:text-neutral-400'>
                        Select a changed file, then open its diff in the Monaco dock.
                      </div>
                    ) : (
                      <div className='space-y-2'>
                        <div className='text-xs text-neutral-700 dark:text-neutral-200'>
                          {selectedGitStatusFile.displayPath}
                        </div>
                        <div className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                          Monaco diff opens in the shared editor dock so file editing and git inspection stay in one
                          place.
                        </div>
                        <div className='flex flex-wrap gap-2'>
                          <Button
                            variant='outline2'
                            size='small'
                            onClick={() => openGitDiffTab(selectedGitStatusFile, Boolean(selectedGitDiff.staged))}
                          >
                            Open diff in dock
                          </Button>
                          {!selectedGitStatusFile.isDeleted && !isWeb && (
                            <Button
                              variant='outline2'
                              size='small'
                              onClick={() => void openFileEditor(selectedGitStatusFile.path)}
                            >
                              Open file
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className='rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <h3 className='text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400'>
                        Branches
                      </h3>
                      <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                        {gitOverviewData?.branches.local.length || 0} local
                      </span>
                    </div>

                    <div className='mb-3 flex gap-2'>
                      <input
                        value={newGitBranchName}
                        onChange={e => setNewGitBranchName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleGitCreateBranch()
                          }
                        }}
                        placeholder='new-branch-name'
                        className='flex-1 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-sm text-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100'
                      />
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => void handleGitCreateBranch()}
                        disabled={!newGitBranchName.trim() || gitCreateBranchMutation.isPending}
                      >
                        {gitCreateBranchMutation.isPending ? 'Creating...' : 'Create'}
                      </Button>
                    </div>

                    <div className='space-y-2'>
                      {displayedLocalBranches.length === 0 ? (
                        <div className='text-xs text-neutral-500 dark:text-neutral-400'>No local branches.</div>
                      ) : (
                        displayedLocalBranches.map(branch => (
                          <div
                            key={branch.name}
                            className='flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'
                          >
                            <div className='min-w-0 flex-1'>
                              <div className='flex items-center gap-2'>
                                <span className='truncate text-xs font-medium text-neutral-800 dark:text-neutral-200'>
                                  {branch.name}
                                </span>
                                {branch.current && (
                                  <span className='rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200'>
                                    current
                                  </span>
                                )}
                              </div>
                              <div className='mt-1 text-[11px] text-neutral-500 dark:text-neutral-400'>
                                {branch.shortHash || '----'} {branch.relativeDate ? `• ${branch.relativeDate}` : ''}
                              </div>
                            </div>
                            <Button
                              variant='outline2'
                              size='small'
                              onClick={() => void handleGitCheckoutBranch(branch)}
                              disabled={branch.current || gitCheckoutBranchMutation.isPending}
                            >
                              {branch.current ? 'On branch' : 'Checkout'}
                            </Button>
                          </div>
                        ))
                      )}
                    </div>

                    {displayedRemoteBranches.length > 0 && (
                      <div className='mt-3'>
                        <div className='mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-500 dark:text-neutral-400'>
                          Remote
                        </div>
                        <div className='space-y-1.5'>
                          {displayedRemoteBranches.map(branch => (
                            <div key={branch.name} className='text-[11px] text-neutral-600 dark:text-neutral-300'>
                              {branch.name}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className='rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <h3 className='text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400'>
                        Commit Graph
                      </h3>
                      <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                        last {displayedCommitGraphLines.length}
                      </span>
                    </div>
                    {displayedCommitGraphLines.length === 0 ? (
                      <div className='text-xs text-neutral-500 dark:text-neutral-400'>No commit graph available.</div>
                    ) : (
                      <div className='overflow-hidden rounded-lg border border-neutral-200 bg-neutral-950/95 dark:border-neutral-800'>
                        <pre className='max-h-72 overflow-auto px-3 py-3 text-[11px] leading-5 text-emerald-100 no-scrollbar whitespace-pre-wrap break-words font-mono'>
                          {displayedCommitGraphLines.join('\n')}
                        </pre>
                      </div>
                    )}
                  </div>

                  <div className='rounded-xl border border-neutral-200 bg-white/70 p-3 dark:border-neutral-800 dark:bg-neutral-900/40'>
                    <div className='mb-2 flex items-center justify-between gap-2'>
                      <h3 className='text-xs font-semibold uppercase tracking-[0.18em] text-neutral-500 dark:text-neutral-400'>
                        Recent Commits
                      </h3>
                      <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>
                        last {displayedGitCommits.length}
                      </span>
                    </div>
                    {displayedGitCommits.length === 0 ? (
                      <div className='text-xs text-neutral-500 dark:text-neutral-400'>No commits available.</div>
                    ) : (
                      <div className='space-y-2'>
                        {displayedGitCommits.map((commit: GitCommit) => (
                          <div
                            key={commit.hash}
                            className='rounded-lg border border-neutral-200 px-2 py-2 dark:border-neutral-800'
                          >
                            <div className='flex items-center gap-2'>
                              <span className='rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300'>
                                {commit.shortHash}
                              </span>
                              <span className='truncate text-xs font-medium text-neutral-800 dark:text-neutral-200'>
                                {commit.subject}
                              </span>
                            </div>
                            <div className='mt-1 text-[11px] text-neutral-500 dark:text-neutral-400'>
                              {commit.author} • {commit.relativeDate}
                              {commit.decorations ? ` • ${commit.decorations}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            ) : activeTab === 'list' ? (
              // List tab - show all research notes
              <>
                {isLoadingNotes && <div className='text-xs text-gray-500 dark:text-gray-300 px-2 py-1'>Loading...</div>}
                {notes.length === 0 && !isLoadingNotes && (
                  <div className='text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1'>No research notes</div>
                )}
                {notes.map(noteItem => (
                  <div key={noteItem.id} className='sm:mb-1 md:mb-1 lg:mb-1.5 2xl:mb-2 group relative'>
                    <div
                      role='button'
                      tabIndex={0}
                      onClick={() => handleNoteClick(noteItem)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleNoteClick(noteItem)
                        }
                      }}
                      className='w-full text-left rounded-lg transition-all duration-200 cursor-pointer hover:bg-stone-100/30 hover:ring-neutral-100 hover:ring-1 sm:py-1 xl:py-2 dark:hover:ring-neutral-600/60 outline-transparent dark:hover:bg-yBlack-900/10'
                    >
                      <div className='flex flex-col gap-0 md:gap-1 lg:gap-1.5 xl:gap-1 2xl:gap-2 py-2 md:py-0 lg:py-0 xl:py-0 mx-2'>
                        <span className='text-[10px] md:text-[11px] lg:text-[12px] xl:text-[12px] 2xl:text-[14px] 3xl:text-[16px] 4xl:text-[14px] font-medium text-neutral-900 dark:text-stone-200 truncate'>
                          {noteItem.title || `Conversation ${noteItem.id}`}
                        </span>
                        {noteItem.research_note && (
                          <span className='text-xs md:text-[11px] lg:text-[10px] xl:text-[12px] 2xl:text-[12px] 3xl:text-[16px] 4xl:text-[14px] text-neutral-600 dark:text-stone-300 truncate'>
                            {noteItem.research_note.substring(0, 50)}
                            {noteItem.research_note.length > 50 ? '...' : ''}
                          </span>
                        )}
                        {noteItem.updated_at && (
                          <span className='text-xs md:text-[11px] lg:text-[10px] xl:text-[9px] 2xl:text-[11px] 3xl:text-[12px] 4xl:text-[14px] text-neutral-500 dark:text-neutral-400 text-right'>
                            {new Date(noteItem.updated_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            ) : activeTab === 'global' ? (
              <div className='flex flex-col h-full'>
                <div className='mb-2 flex flex-col gap-2'>
                  <div className='flex items-start justify-between gap-2'>
                    <div className='flex flex-col flex-1 min-w-0'>
                      <span className='text-xs text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.2em] truncate'>
                        {agentConversationDate ? `${agentSettingsName} - ${agentConversationDate}` : agentSettingsName}
                      </span>
                      <span className='text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate'>
                        Status: {agentState.status}
                      </span>
                    </div>
                    <div className='flex gap-1 flex-shrink-0 flex-wrap justify-end'>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => globalAgentLoop.start()}
                        disabled={isWeb}
                        className='text-xs'
                        aria-label='Start'
                        title='Start'
                      >
                        🟢
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => globalAgentLoop.pause()}
                        disabled={isWeb}
                        className='text-xs'
                        aria-label='Pause'
                        title='Pause'
                      >
                        🟡
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => globalAgentLoop.startNewSession()}
                        disabled={isWeb}
                        className='text-xs'
                        aria-label='New Session'
                        title='New Session'
                      >
                        🔵
                      </Button>
                      <Button
                        variant='outline2'
                        size='small'
                        onClick={() => globalAgentLoop.stop()}
                        disabled={isWeb}
                        className='text-xs'
                        aria-label='Stop'
                        title='Stop'
                      >
                        🔴
                      </Button>
                    </div>
                  </div>
                  {agentWorkDirectory && (
                    <span
                      className='text-[11px] text-neutral-500 dark:text-neutral-400 truncate'
                      title={agentWorkDirectory}
                    >
                      cwd: {agentWorkDirectory}
                    </span>
                  )}
                </div>

                <div className='flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1'>
                  {agentMessages.length === 0 && !optimisticMessage && (
                    <div className='text-xs text-neutral-500 dark:text-neutral-400'>No global agent messages yet.</div>
                  )}

                  {/* Persisted messages from React Query cache */}
                  {mergedAgentMessages.map(message => (
                    <ChatMessage
                      key={message.id}
                      id={message.id}
                      role={message.role}
                      content={message.content || ''}
                      thinking={message.thinking_block || undefined}
                      toolCalls={parseJsonSafe(message.tool_calls, [])}
                      contentBlocks={normalizeContentBlocks(parseJsonSafe(message.content_blocks, []))}
                      timestamp={message.created_at}
                      width='w-full'
                      colored={false}
                      showInlineActions={false}
                      modelName={message.model_name}
                      onOpenToolHtmlModal={openToolHtmlModal}
                    />
                  ))}

                  {/* Optimistic user message (shown while task is enqueued) */}
                  {optimisticMessage && (
                    <ChatMessage
                      key={optimisticMessage.id}
                      id={optimisticMessage.id}
                      role={optimisticMessage.role}
                      content={optimisticMessage.content}
                      timestamp={optimisticMessage.created_at}
                      width='w-full'
                      colored={false}
                      showInlineActions={false}
                      className='opacity-70' // Visual feedback for optimistic state
                      onOpenToolHtmlModal={openToolHtmlModal}
                    />
                  )}

                  {/* Streaming assistant response from React Query cache */}
                  {agentStreamBuffer && (
                    <ChatMessage
                      id='global-agent-streaming'
                      role='assistant'
                      content={agentStreamBuffer}
                      contentBlocks={[{ type: 'text', index: 0, content: agentStreamBuffer }]}
                      width='w-full'
                      colored={false}
                      showInlineActions={false}
                      onOpenToolHtmlModal={openToolHtmlModal}
                    />
                  )}
                </div>

                <div className='mt-2 flex flex-col gap-2'>
                  <TextArea
                    value={agentInput}
                    onChange={setAgentInput}
                    placeholder='Queue a task for the global agent...'
                    className='w-full resize-none'
                    minRows={2}
                    maxRows={4}
                  />
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline2'
                      size='small'
                      onClick={() => {
                        setScheduleModalTab('schedule')
                        setScheduleModalOpen(true)
                      }}
                      className={scheduleEnabled ? 'border-sky-500 text-sky-100 bg-sky-600 hover:bg-sky-700' : ''}
                    >
                      Schedule
                    </Button>
                    <Button variant='outline2' size='small' onClick={handleAgentSend}>
                      Send
                    </Button>
                    <Button
                      variant='outline2'
                      size='small'
                      onClick={handleAgentAbort}
                      disabled={!isAgentStreaming}
                      className={
                        isAgentStreaming
                          ? 'border-rose-500 text-rose-100 bg-rose-600 hover:bg-rose-700 dark:border-rose-500/70'
                          : 'opacity-60'
                      }
                      title={isAgentStreaming ? 'Stop current agent generation' : 'No active generation'}
                    >
                      Stop
                    </Button>
                  </div>
                  <span className='text-[11px] text-neutral-500 dark:text-neutral-400'>{scheduleSummary}</span>
                </div>
              </div>
            ) : (
              // Note tab - show current conversation note editor
              <>
                {!conversationId ? (
                  <div className='text-xs text-neutral-500 dark:text-neutral-400 px-2 py-1'>
                    Select a conversation to add notes
                  </div>
                ) : (
                  <div className='h-full flex flex-col'>
                    <TextArea
                      value={localNote}
                      onChange={handleNoteChange}
                      placeholder='Enter research notes for this conversation...'
                      className='w-full resize-none flex-1'
                      minRows={undefined}
                      maxRows={undefined}
                      fillAvailableHeight={true}
                      autoFocus={false}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {scheduleModalVisible && (
        <div className='absolute mb-15 inset-0 z-50 flex items-end bg-black/30 p-2'>
          <div className='w-full max-h-full overflow-y-auto no-scrollbar rounded-xl border border-stone-300 bg-stone-50 p-3 shadow-xl dark:border-stone-700 dark:bg-zinc-900'>
            <div className='mb-2 flex items-center justify-between'>
              <p className='text-sm font-semibold text-stone-900 dark:text-stone-100'>Schedule Task</p>
              <button
                onClick={() => setScheduleModalOpen(false)}
                className='rounded p-1 text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-zinc-800 dark:hover:text-stone-100'
                title='Close'
              >
                <i className='bx bx-x text-lg' />
              </button>
            </div>

            <div className='mb-3 flex gap-2 rounded-lg border border-stone-200 bg-white p-1 dark:border-stone-700 dark:bg-zinc-800'>
              <button
                onClick={() => setScheduleModalTab('schedule')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  scheduleModalTab === 'schedule'
                    ? 'bg-stone-200 text-stone-900 dark:bg-zinc-700 dark:text-stone-100'
                    : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-zinc-700/60'
                }`}
              >
                Schedule
              </button>
              <button
                onClick={() => setScheduleModalTab('queue')}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  scheduleModalTab === 'queue'
                    ? 'bg-stone-200 text-stone-900 dark:bg-zinc-700 dark:text-stone-100'
                    : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-zinc-700/60'
                }`}
              >
                Queue ({queuedTasks.length})
              </button>
            </div>

            {scheduleModalTab === 'schedule' ? (
              <>
                <div className='mb-3 flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-700'>
                  <div>
                    <p className='text-sm font-medium text-stone-900 dark:text-stone-100'>Enable Schedule</p>
                    <p className='text-xs text-stone-500 dark:text-stone-400'>
                      Send once now, then repeat based on this plan.
                    </p>
                  </div>
                  <button
                    onClick={() => setScheduleEnabled(prev => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      scheduleEnabled ? 'bg-emerald-500 dark:bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        scheduleEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className='grid grid-cols-2 gap-2 mb-3'>
                  <label className='flex flex-col gap-1'>
                    <span className='text-xs text-stone-600 dark:text-stone-300'>Repeat Count</span>
                    <input
                      type='number'
                      min={1}
                      step={1}
                      value={scheduleDraft.repeatCount}
                      onChange={e =>
                        setScheduleDraft(prev => ({
                          ...prev,
                          repeatCount: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className='w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-zinc-800 dark:text-stone-100'
                    />
                  </label>
                  <label className='flex flex-col gap-1'>
                    <span className='text-xs text-stone-600 dark:text-stone-300'>Every (number)</span>
                    <input
                      type='number'
                      min={1}
                      step={1}
                      value={scheduleDraft.intervalValue}
                      onChange={e =>
                        setScheduleDraft(prev => ({
                          ...prev,
                          preset: 'custom',
                          intervalValue: Math.max(1, Number(e.target.value) || 1),
                        }))
                      }
                      className='w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-zinc-800 dark:text-stone-100'
                    />
                  </label>
                </div>

                <div className='mb-3 flex gap-2'>
                  <button
                    onClick={() => setScheduleDraft(prev => ({ ...prev, preset: 'custom', intervalUnit: 'seconds' }))}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      scheduleDraft.intervalUnit === 'seconds'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                        : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                    }`}
                  >
                    Seconds
                  </button>
                  <button
                    onClick={() => setScheduleDraft(prev => ({ ...prev, preset: 'custom', intervalUnit: 'minutes' }))}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      scheduleDraft.intervalUnit === 'minutes'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                        : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                    }`}
                  >
                    Minutes
                  </button>
                  <button
                    onClick={() => setScheduleDraft(prev => ({ ...prev, preset: 'custom', intervalUnit: 'hours' }))}
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      scheduleDraft.intervalUnit === 'hours'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                        : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                    }`}
                  >
                    Hours
                  </button>
                </div>

                <div className='mb-3'>
                  <p className='mb-1 text-xs text-stone-600 dark:text-stone-300'>Presets</p>
                  <div className='flex flex-wrap gap-2'>
                    {PRESET_CONFIGS.map(preset => (
                      <button
                        key={preset.key}
                        onClick={() => handlePresetSelect(preset.key)}
                        className={`rounded-lg border px-2 py-1 text-xs ${
                          scheduleDraft.preset === preset.key
                            ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200'
                            : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                    <button
                      onClick={() => handlePresetSelect('custom')}
                      className={`rounded-lg border px-2 py-1 text-xs ${
                        scheduleDraft.preset === 'custom'
                          ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200'
                          : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                <div className='mb-3 grid grid-cols-2 gap-2'>
                  <label className='flex flex-col gap-1'>
                    <span className='text-xs text-stone-600 dark:text-stone-300'>Start Date</span>
                    <input
                      type='date'
                      value={scheduleDraft.startDate}
                      onChange={e => setScheduleDraft(prev => ({ ...prev, startDate: e.target.value }))}
                      className='w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-zinc-800 dark:text-stone-100'
                    />
                  </label>
                  <label className='flex flex-col gap-1'>
                    <span className='text-xs text-stone-600 dark:text-stone-300'>End Date</span>
                    <input
                      type='date'
                      value={scheduleDraft.endDate}
                      onChange={e => setScheduleDraft(prev => ({ ...prev, endDate: e.target.value }))}
                      className='w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-zinc-800 dark:text-stone-100'
                    />
                  </label>
                </div>

                <div className='mb-3'>
                  <p className='mb-1 text-xs text-stone-600 dark:text-stone-300'>Allowed Weekdays</p>
                  <div className='flex flex-wrap gap-1'>
                    {WEEKDAY_LABELS.map((label, index) => {
                      const selected = scheduleDraft.allowedWeekdays.includes(index)
                      return (
                        <button
                          key={label}
                          onClick={() => toggleScheduleWeekday(index)}
                          className={`rounded-md border px-2 py-1 text-[11px] ${
                            selected
                              ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
                              : 'border-stone-200 text-stone-600 dark:border-stone-700 dark:text-stone-300'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className='flex items-center justify-between'>
                  <span className='text-[11px] text-stone-500 dark:text-stone-400'>{scheduleSummary}</span>
                  <div className='flex gap-2'>
                    <Button
                      variant='outline2'
                      size='small'
                      onClick={() => {
                        setScheduleEnabled(false)
                        setScheduleModalOpen(false)
                      }}
                    >
                      Disable
                    </Button>
                    <Button variant='outline2' size='small' onClick={() => setScheduleModalOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <p className='text-xs text-stone-600 dark:text-stone-300'>
                    Pending and scheduled tasks are shown here.
                  </p>
                  <span className='text-[11px] text-stone-500 dark:text-stone-400'>
                    {isFetchingQueuedTasks ? 'Refreshing...' : `${queuedTasks.length} queued`}
                  </span>
                </div>

                {isLoadingQueuedTasks ? (
                  <div className='text-xs text-stone-500 dark:text-stone-400'>Loading queued tasks...</div>
                ) : queuedTasks.length === 0 ? (
                  <div className='text-xs text-stone-500 dark:text-stone-400'>No queued tasks.</div>
                ) : (
                  <div className='space-y-2 max-h-80 overflow-y-auto pr-1 no-scrollbar'>
                    {queuedTasks.map(task => {
                      const runAtLabel = getQueuedTaskRunAtLabel(task)
                      const createdAtLabel = task.created_at
                        ? Number.isNaN(Date.parse(task.created_at))
                          ? task.created_at
                          : new Date(task.created_at).toLocaleString()
                        : 'Unknown time'
                      return (
                        <div
                          key={task.id}
                          className='rounded-lg border border-stone-200 bg-white p-2 dark:border-stone-700 dark:bg-zinc-800'
                        >
                          <div className='flex items-start gap-2'>
                            <div className='min-w-0 flex-1'>
                              <p className='text-sm text-stone-900 dark:text-stone-100 break-words'>
                                {task.description}
                              </p>
                              <div className='mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400'>
                                <span>Status: {task.status}</span>
                                <span>Queued: {createdAtLabel}</span>
                                {runAtLabel && <span>Run at: {runAtLabel}</span>}
                              </div>
                            </div>
                            <Button
                              variant='outline2'
                              size='small'
                              onClick={() => handleRemoveQueuedTask(task.id)}
                              disabled={removingTaskId === task.id || removeQueuedTaskMutation.isPending}
                              className='text-xs'
                              title='Remove from queue'
                            >
                              {removingTaskId === task.id ? 'Removing...' : 'Remove'}
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                <div className='flex justify-end'>
                  <Button variant='outline2' size='small' onClick={() => setScheduleModalOpen(false)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}

export default RightBar
