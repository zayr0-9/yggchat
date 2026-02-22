import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ConversationId } from '../../../../shared/types'
import { Button, ChatMessage } from '../components'
import { useHtmlIframeRegistry } from '../components/HtmlIframeRegistry/HtmlIframeRegistry'
import { TextArea } from '../components/TextArea/TextArea'
import { updateResearchNote } from '../features/conversations/conversationActions'
import { makeSelectConversationById } from '../features/conversations/conversationSelectors'
import { Conversation } from '../features/conversations/conversationTypes'
import { uiActions } from '../features/ui'
import { AGENT_SETTINGS_CHANGE_EVENT, AgentSettings, loadAgentSettings } from '../helpers/agentSettingsStorage'
import { useAuth } from '../hooks/useAuth'
import { clearGlobalAgentOptimisticMessage, setGlobalAgentOptimisticMessage } from '../hooks/useGlobalAgentCache'
import {
  DirectoryFileEntry,
  GlobalAgentQueuedTask,
  ResearchNoteItem,
  useDirectoryFiles,
  useGlobalAgentMessages,
  useGlobalAgentOptimisticMessage,
  useGlobalAgentQueuedTasks,
  useGlobalAgentStreamBuffer,
  useRemoveGlobalAgentQueuedTask,
} from '../hooks/useQueries'
import { globalAgentLoop, GlobalAgentSchedulePreset, GlobalAgentState, GlobalAgentTaskSchedule } from '../services'
import type { RootState } from '../store/store'

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

const ALL_WEEKDAYS: number[] = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  const { data: directoryData, isLoading: isLoadingFiles, error: filesError } = useDirectoryFiles(currentPath || null)

  // Sync currentPath with ccCwd when it changes
  useEffect(() => {
    if (ccCwd && ccCwd !== currentPath) {
      setCurrentPath(ccCwd)
      setPathHistory([])
    }
  }, [ccCwd])

  // Drawer collapse state from Redux (persisted to localStorage in slice)
  const isCollapsed = useSelector((state: RootState) => state.ui.rightBarCollapsed)

  // Tab state: 'note' for single conversation note, 'list' for all notes, 'global' for agent
  const [activeTab, setActiveTab] = useState<'note' | 'list' | 'global'>('global')

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
    dispatch(uiActions.rightBarToggled())
  }

  const handleNoteClick = (noteItem: ResearchNoteItem) => {
    navigate(`/chat/${noteItem.project_id || 'unknown'}/${noteItem.id}`)
  }

  // File browser navigation
  const handleFileClick = (file: DirectoryFileEntry) => {
    if (file.isDirectory) {
      setPathHistory(prev => [...prev, currentPath])
      setCurrentPath(file.path)
    }
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

  return (
    <aside
      className={`relative z-10 ${isWeb ? 'h-[100vh]' : 'h-full'} rounded-tl-xl shadow-md border-neutral-200 dark:border-neutral-800 flex flex-col transition-all duration-300 ease-in-out backdrop-blur-sm bg-neutral-100/70 dark:bg-transparent flex-shrink-0 ${isCollapsed ? 'w-12' : 'w-64 md:w-72 lg:w-80 xl:w-90'} ${className}`}
      aria-label='Research Notes'
    >
      {/* Toggle Button */}
      <div className='flex items-center justify-between py-3 my-1 md:py-2.5 lg:p-1 xl:p-1 2xl:px-1 2xl:py-2'>
        <Button
          variant='outline2'
          size='circle'
          rounded='full'
          onClick={toggleCollapse}
          className={`${isCollapsed ? 'mx-auto' : 'ml-2'} transition-transform duration-200 hover:scale-103 px-2 py-2`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`bx ${isCollapsed ? 'bx-chevron-left' : 'bx-chevron-right'} text-xl`} aria-hidden='true'></i>
        </Button>
        {!isCollapsed && (
          <h2 className='text-[14px] md:text-[16px] lg:text-[16px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[22px] pr-2 font-semibold text-neutral-700 dark:text-neutral-200 truncate'>
            Notes
          </h2>
        )}
      </div>

      {/* Main content wrapper - equal height sections when expanded */}
      <div className={`flex-1 flex flex-col ${isCollapsed ? '' : 'min-h-0'}`}>
        {/* File browser - show when ccCwd is set and expanded */}
        {!isCollapsed && ccCwd && (
          <div className='flex-1 min-h-0 flex flex-col px-2 pb-2 border-b border-neutral-200 dark:border-neutral-800'>
            {/* Path header with navigation */}
            <div className='flex items-center gap-1 mb-2 flex-shrink-0'>
              <button
                onClick={handleGoToRoot}
                className='p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                title='Go to root'
                disabled={currentPath === ccCwd}
              >
                <i className='bx bx-home text-sm text-neutral-600 dark:text-neutral-400' />
              </button>
              <button
                onClick={handleGoBack}
                className='p-1 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                title='Go back'
                disabled={pathHistory.length === 0}
              >
                <i className='bx bx-arrow-back text-sm text-neutral-600 dark:text-neutral-400' />
              </button>
              <span className='text-[10px] text-neutral-500 dark:text-neutral-400 truncate flex-1' title={currentPath}>
                {getDisplayPath()}
              </span>
            </div>

            {/* File list */}
            <div className='flex-1 overflow-y-auto no-scrollbar'>
              {isLoadingFiles && (
                <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>Loading files...</div>
              )}
              {filesError && (
                <div className='text-[10px] text-red-500 dark:text-red-400 py-1'>
                  {filesError instanceof Error ? filesError.message : 'Failed to load files'}
                </div>
              )}
              {directoryData?.files && directoryData.files.length === 0 && !isLoadingFiles && (
                <div className='text-[10px] text-neutral-500 dark:text-neutral-400 py-1'>Empty directory</div>
              )}
              {directoryData?.files?.map(file => (
                <div
                  key={file.path}
                  className='flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] transition-colors group'
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
                  >
                    <i
                      className={`bx ${file.isDirectory ? 'bx-folder text-amber-500' : 'bx-file text-neutral-400'} text-sm flex-shrink-0`}
                    />
                    <span className='truncate text-neutral-700 dark:text-neutral-300'>{file.name}</span>
                  </div>
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
          <div className='flex gap-2 px-3 py-2 flex-shrink-0'>
            <button
              onClick={() => setActiveTab('note')}
              className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                activeTab === 'note'
                  ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 scale-102 border-neutral-300 dark:border-neutral-600 shadow-[0px_0.5px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.25)]'
                  : 'bg-transparent text-stone-600 dark:text-stone-400 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
              }`}
            >
              Note
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`flex-1 px-2 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                activeTab === 'list'
                  ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 border-neutral-300 scale-102 dark:border-neutral-600 shadow-[0px_0.5px_3px_-0.5px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.35)]'
                  : 'bg-transparent hover:scale-101 text-stone-600 dark:text-stone-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
              }`}
            >
              List
            </button>
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
          </div>
        )}

        {/* Content Area */}
        <div
          className={`${!isCollapsed && ccCwd ? 'flex-1' : 'flex-1'} min-h-0 overflow-y-auto overflow-x-hidden p-2 pt-2 2xl:pt-2 no-scrollbar scroll-fade dark:border-neutral-800 rounded-xl border-t-0`}
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
                  className='h-10 w-10'
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
                className='h-10 w-10'
                onClick={toggleCollapse}
                title='Expand to view notes'
              >
                <i className='bx bx-note text-lg' aria-hidden='true'></i>
              </Button>
            </div>
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
