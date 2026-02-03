import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ConversationId } from '../../../../shared/types'
import { Button, ChatMessage } from '../components'
import { TextArea } from '../components/TextArea/TextArea'
import { updateResearchNote } from '../features/conversations/conversationActions'
import { makeSelectConversationById } from '../features/conversations/conversationSelectors'
import { Conversation } from '../features/conversations/conversationTypes'
import { loadAgentSettings } from '../helpers/agentSettingsStorage'
import { uiActions } from '../features/ui'
import { useAuth } from '../hooks/useAuth'
import {
  DirectoryFileEntry,
  ResearchNoteItem,
  useDirectoryFiles,
  useGlobalAgentMessages,
  useGlobalAgentStreamBuffer,
  useGlobalAgentOptimisticMessage
} from '../hooks/useQueries'
import {
  setGlobalAgentOptimisticMessage,
  clearGlobalAgentOptimisticMessage
} from '../hooks/useGlobalAgentCache'
import { globalAgentLoop, GlobalAgentState } from '../services'
import type { RootState } from '../store/store'

interface RightBarProps {
  conversationId: ConversationId | null
  notes?: ResearchNoteItem[]
  isLoadingNotes?: boolean
  className?: string
  ccCwd?: string
  onFilePathInsert?: (path: string) => void
}

const RightBar: React.FC<RightBarProps> = ({ conversationId, notes = [], isLoadingNotes = false, className = '', ccCwd = '', onFilePathInsert }) => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const isWeb = import.meta.env.VITE_ENVIRONMENT === 'web'

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
  const [agentInput, setAgentInput] = useState<string>('')

  // Use React Query hooks for agent messages
  const { data: agentData } = useGlobalAgentMessages()
  const agentMessages = agentData?.messages || []
  const agentConversationDate = agentData?.conversationDate
    ? new Date(agentData.conversationDate).toLocaleDateString()
    : null

  // Subscribe to live streaming updates (triggers re-render on stream buffer changes)
  const agentStreamBuffer = useGlobalAgentStreamBuffer()
  const optimisticMessage = useGlobalAgentOptimisticMessage()

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
      })
      .catch(error => {
        console.error('Failed to load agent settings:', error)
      })

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

  const handleAgentSend = async () => {
    if (isWeb) return
    const trimmed = agentInput.trim()
    if (!trimmed) return

    try {
      // Create optimistic message for instant UI feedback
      const optimisticUserMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: trimmed,
        created_at: new Date().toISOString(),
        _optimistic: true  // Flag for styling
      }

      // Add to cache immediately for instant UI update
      setGlobalAgentOptimisticMessage(queryClient, optimisticUserMessage)

      // Clear input
      setAgentInput('')

      // Enqueue task (async) - GlobalAgentLoop will clear optimistic message when real message is persisted
      await globalAgentLoop.enqueueTask(trimmed)
    } catch (error) {
      console.error('Failed to enqueue agent task:', error)
      // Clear optimistic message on error
      clearGlobalAgentOptimisticMessage(queryClient)
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
      className={`relative z-10 ${isWeb ? 'h-[100vh]' : 'h-full'} shadow-md border-neutral-200 dark:border-neutral-800 flex flex-col transition-all duration-300 ease-in-out backdrop-blur-sm bg-neutral-100/70 dark:bg-transparent flex-shrink-0 ${isCollapsed ? 'w-12' : 'w-64 md:w-72 lg:w-80 xl:w-90'} ${className}`}
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
                  : 'bg-neutral-100 dark:bg-neutral-900 text-stone-600 dark:text-stone-400 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
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
            <div className='flex items-center justify-between mb-2 gap-2'>
              <div className='flex flex-col'>
                <span className='text-xs text-neutral-500 dark:text-neutral-400 uppercase tracking-[0.2em]'>
                  {agentConversationDate ? `${agentSettingsName} - ${agentConversationDate}` : agentSettingsName}
                </span>
                <span className='text-sm font-semibold text-neutral-800 dark:text-neutral-100'>
                  Status: {agentState.status}
                </span>
              </div>
              <div className='flex gap-1'>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={() => globalAgentLoop.start()}
                  disabled={isWeb}
                  className='text-xs'
                >
                  Start
                </Button>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={() => globalAgentLoop.pause()}
                  disabled={isWeb}
                  className='text-xs'
                >
                  Pause
                </Button>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={() => globalAgentLoop.startNewSession()}
                  disabled={isWeb}
                  className='text-xs'
                >
                  New Session
                </Button>
                <Button
                  variant='outline2'
                  size='small'
                  onClick={() => globalAgentLoop.stop()}
                  disabled={isWeb}
                  className='text-xs'
                >
                  Stop
                </Button>
              </div>
            </div>

            <div className='flex-1 overflow-y-auto no-scrollbar space-y-2 pr-1'>
              {agentMessages.length === 0 && !optimisticMessage && (
                <div className='text-xs text-neutral-500 dark:text-neutral-400'>No global agent messages yet.</div>
              )}

              {/* Persisted messages from React Query cache */}
              {agentMessages
                .filter(message => message.role !== 'tool')
                .map(message => (
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
                  modelName={message.model_name}
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
                  className='opacity-70'  // Visual feedback for optimistic state
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
              <Button variant='outline2' size='small' onClick={handleAgentSend}>
                Send
              </Button>
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
    </aside>
  )
}

export default RightBar
