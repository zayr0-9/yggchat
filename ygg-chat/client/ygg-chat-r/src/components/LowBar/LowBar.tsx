import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ConversationId } from '../../../../../shared/types'
import { updateResearchNote } from '../../features/conversations/conversationActions'
import { makeSelectConversationById } from '../../features/conversations/conversationSelectors'
import { Conversation } from '../../features/conversations/conversationTypes'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { ResearchNoteItem } from '../../hooks/useQueries'
import { QuickInput } from '../QuickInput/QuickInput'
import { TextArea } from '../TextArea/TextArea'
import { ResearchNotesList } from './ResearchNotesList'

interface LowBarProps {
  conversationId: ConversationId | null
  mode?: 'single' | 'list'
  notes?: ResearchNoteItem[]
  isLoadingNotes?: boolean
  enableTabs?: boolean
  showInput?: boolean
}

export const LowBar: React.FC<LowBarProps> = ({
  conversationId,
  mode = 'single',
  notes = [],
  isLoadingNotes = false,
  enableTabs = false,
  showInput = false,
}) => {
  const dispatch = useDispatch()
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const isMobile = useIsMobile()
  const [isExpanded, setIsExpanded] = useState(false) // Auto-expand when in list mode
  const [localNote, setLocalNote] = useState('')
  const [activeTab, setActiveTab] = useState<'note' | 'list'>('note')
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get conversation data using selector
  const conversation = useSelector(conversationId ? makeSelectConversationById(conversationId) : () => null)

  // Initialize local note from conversation data
  useEffect(() => {
    if (conversation?.research_note !== undefined) {
      setLocalNote(conversation.research_note || '')
    }
  }, [conversation?.research_note])

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
            // Update React Query caches to reflect the new research note
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
              // If note is empty or whitespace, remove from list
              if (!note || note.trim().length === 0) {
                queryClient.setQueryData(
                  ['research-notes', userId],
                  researchNotesCache.filter(item => item.id !== conversationId)
                )
              } else {
                // Update existing note or add new one
                const existingIndex = researchNotesCache.findIndex(item => item.id === conversationId)
                if (existingIndex >= 0) {
                  // Update existing note
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
                  // Add new note to the list
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
      }, 1000) // 1 second debounce
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

  // Don't render if no conversation (except when in list mode for quick chats)
  if (!conversationId && mode !== 'list') {
    return null
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out ${
        isExpanded
          ? isMobile
            ? 'w-[95%] h-[75%]'
            : 'w-[30%] lg:w-[35%] h-[50%] lg:h-[60%] 2xl:h-[55%] 2xl:w-[35%]'
          : isMobile
            ? 'w-[40%] h-[35px]'
            : 'w-[15%] h-[38px]'
      }`}
    >
      {/* Container with shadow and border */}
      <div className='h-full flex flex-col backdrop-blur-sm dark:bg-transparent border border-transparent dark:border-neutral-900 rounded-3xl overflow-hidden shadow-[0px_0px_3px_1px_rgba(0,0,0,0.09)] dark:shadow-[0px_0px_4px_2px_rgba(0,0,0,0.25)] dark:outline-1 dark:outline-neutral-700'>
        {/* Header bar (always visible) */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center justify-between px-4 py-2 ${isExpanded ? 'mt-3 mx-2' : ''} bg-transparent acrylic-light dark:bg-neutral-900 dark:outline-0 rounded-2xl dark:hover:bg-neutral-800 transition-all hover:scale-99 duration-200 `}
        >
          <div className='text-sm font-medium text-stone-800 dark:text-stone-200 '>Notes</div>
          {isExpanded ? (
            <ChevronDown className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          ) : (
            <ChevronUp className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          )}
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className='flex-1 flex flex-col overflow-hidden'>
            {/* Tab buttons - only show when enableTabs is true */}
            {enableTabs && (
              <div className='flex gap-2 px-3 pt-3 pb-2'>
                <button
                  onClick={() => setActiveTab('note')}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                    activeTab === 'note'
                      ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 scale-102 border-neutral-300 dark:border-neutral-600 shadow-[0px_0.5px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.25)] dark:outline-neutral-800'
                      : 'bg-transparent text-stone-600 dark:text-stone-400 hover:scale-101 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
                  }`}
                >
                  Note
                </button>
                <button
                  onClick={() => setActiveTab('list')}
                  className={`flex-1 px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                    activeTab === 'list'
                      ? 'bg-neutral-100 dark:bg-neutral-900 text-stone-800 dark:text-stone-200 border-1 border-neutral-300 scale-102 dark:border-neutral-600 shadow-[0px_0.5px_3px_-0.5px_rgba(0,0,0,0.05)] dark:shadow-[0px_0.5px_3px_2px_rgba(0,0,0,0.35)] dark:outline-neutral-800'
                      : 'bg-transparent hover:scale-101 text-stone-600 dark:text-stone-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 border-1 border-neutral-300 dark:border-neutral-800'
                  }`}
                >
                  List
                </button>
              </div>
            )}

            {/* Content area based on active tab */}
            <div
              className='flex-1 p-3 pb-4 overflow-hidden thin-scrollbar'
              data-heimdall-wheel-exempt='true'
              data-heimdall-contextmenu-exempt='true'
            >
              {enableTabs && activeTab === 'list' ? (
                <div className='h-full flex flex-col overflow-hidden'>
                  <div className='flex-1 overflow-y-auto thin-scrollbar'>
                    <ResearchNotesList notes={notes} isLoading={isLoadingNotes} isEmbedded={true} />
                  </div>
                  {showInput && <QuickInput />}
                </div>
              ) : mode === 'list' ? (
                <div className='h-full flex flex-col overflow-hidden'>
                  <div className='flex-1 overflow-y-auto thin-scrollbar'>
                    <ResearchNotesList notes={notes} isLoading={isLoadingNotes} isEmbedded={true} />
                  </div>
                  <QuickInput />
                </div>
              ) : (
                <TextArea
                  value={localNote}
                  onChange={handleNoteChange}
                  placeholder='Enter research notes for this conversation...'
                  className='w-full h-full resize-none'
                  minRows={undefined}
                  maxRows={undefined}
                  fillAvailableHeight={true}
                  autoFocus={false}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
