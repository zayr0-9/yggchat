import { useQueryClient } from '@tanstack/react-query'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ConversationId } from '../../../../shared/types'
import { Button } from '../components'
import { TextArea } from '../components/TextArea/TextArea'
import { updateResearchNote } from '../features/conversations/conversationActions'
import { makeSelectConversationById } from '../features/conversations/conversationSelectors'
import { Conversation } from '../features/conversations/conversationTypes'
import { useAuth } from '../hooks/useAuth'
import { ResearchNoteItem } from '../hooks/useQueries'

interface RightBarProps {
  conversationId: ConversationId | null
  notes?: ResearchNoteItem[]
  isLoadingNotes?: boolean
  className?: string
}

const RightBar: React.FC<RightBarProps> = ({ conversationId, notes = [], isLoadingNotes = false, className = '' }) => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const isWeb = import.meta.env.VITE_ENVIRONMENT === 'web'

  // Drawer collapse state with localStorage persistence
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      if (typeof window === 'undefined') return true
      const stored = localStorage.getItem('rightbar:collapsed')
      if (stored !== null) {
        return stored === 'true'
      }
      // Default to collapsed
      return true
    } catch {
      return true
    }
  })

  // Tab state: 'note' for single conversation note, 'list' for all notes
  const [activeTab, setActiveTab] = useState<'note' | 'list'>('note')

  // Local note state for debounced updates
  const [localNote, setLocalNote] = useState('')
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get conversation data using selector
  const conversation = useSelector(conversationId ? makeSelectConversationById(conversationId) : () => null)

  // Initialize local note from conversation data
  useEffect(() => {
    if (conversation?.research_note !== undefined) {
      setLocalNote(conversation.research_note || '')
    }
  }, [conversation?.research_note])

  // Persist collapse state
  useEffect(() => {
    try {
      localStorage.setItem('rightbar:collapsed', String(isCollapsed))
    } catch {}
  }, [isCollapsed])

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
    setIsCollapsed(prev => !prev)
  }

  const handleNoteClick = (noteItem: ResearchNoteItem) => {
    navigate(`/chat/${noteItem.project_id || 'unknown'}/${noteItem.id}`)
  }

  return (
    <aside
      className={`relative z-10 ${isWeb ? 'h-[100vh]' : 'h-full'} shadow-md rounded-l-xl border-l border-neutral-200 dark:border-neutral-800 flex flex-col transition-all duration-300 ease-in-out backdrop-blur-sm bg-neutral-100/70 dark:bg-transparent flex-shrink-0 ${isCollapsed ? 'w-16' : 'w-64 md:w-72 lg:w-80 xl:w-90'} ${className}`}
      aria-label='Research Notes'
    >
      {/* Toggle Button */}
      <div className='flex items-center justify-between py-3 my-1 md:py-2.5 lg:p-1 xl:p-1 2xl:px-1 2xl:py-2'>
        <Button
          variant='acrylic'
          size='circle'
          rounded='full'
          onClick={toggleCollapse}
          className={`${isCollapsed ? 'mx-auto' : 'ml-2'} transition-transform duration-200 hover:scale-103`}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`bx ${isCollapsed ? 'bx-chevron-left' : 'bx-chevron-right'} text-2xl`} aria-hidden='true'></i>
        </Button>
        {!isCollapsed && (
          <h2 className='text-[14px] md:text-[16px] lg:text-[16px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[22px] pr-2 font-semibold text-neutral-700 dark:text-neutral-200 truncate'>
            Notes
          </h2>
        )}
      </div>

      {/* Tab buttons - only show when expanded */}
      {!isCollapsed && (
        <div className='flex gap-2 px-3 pb-2'>
          <button
            onClick={() => setActiveTab('note')}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
              activeTab === 'note'
                ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 scale-102 border-neutral-300 dark:border-neutral-600 shadow-[0px_0.5px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.25)]'
                : 'bg-neutral-100 dark:bg-neutral-900 text-stone-600 dark:text-stone-400 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
            }`}
          >
            Note
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`flex-1 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
              activeTab === 'list'
                ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 border-neutral-300 scale-102 dark:border-neutral-600 shadow-[0px_0.5px_3px_-0.5px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.35)]'
                : 'bg-transparent hover:scale-101 text-stone-600 dark:text-stone-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
            }`}
          >
            List
          </button>
        </div>
      )}

      {/* Content Area */}
      <div
        className='flex-1 overflow-y-auto overflow-x-hidden p-2 pt-2 2xl:pt-2 no-scrollbar scroll-fade dark:border-neutral-800 rounded-xl border-t-0'
        data-heimdall-wheel-exempt='true'
        data-heimdall-contextmenu-exempt='true'
      >
        {isCollapsed ? (
          // Collapsed state - show icon only
          <div className='flex flex-col items-center gap-2'>
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
    </aside>
  )
}

export default RightBar
