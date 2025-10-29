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
import { TextArea } from '../TextArea/TextArea'
import { ResearchNotesList } from './ResearchNotesList'

interface LowBarProps {
  conversationId: ConversationId | null
  mode?: 'single' | 'list'
  notes?: ResearchNoteItem[]
  isLoadingNotes?: boolean
}

export const LowBar: React.FC<LowBarProps> = ({
  conversationId,
  mode = 'single',
  notes = [],
  isLoadingNotes = false,
}) => {
  const dispatch = useDispatch()
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const isMobile = useIsMobile()
  const [isExpanded, setIsExpanded] = useState(false)
  const [localNote, setLocalNote] = useState('')
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Get conversation data using selector
  const conversation = useSelector(conversationId ? makeSelectConversationById(conversationId) : () => null)

  // If mode is 'list', render the ResearchNotesList component instead
  if (mode === 'list') {
    return <ResearchNotesList notes={notes} isLoading={isLoadingNotes} />
  }

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

  // Don't render if no conversation
  if (!conversationId) {
    return null
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out ${
        isExpanded
          ? isMobile
            ? 'w-[95%] h-[75%]'
            : 'w-[30%] h-[50%]'
          : isMobile
            ? 'w-[40%] h-[35px]'
            : 'w-[15%] h-[35px]'
      }`}
    >
      {/* Container with shadow and border */}
      <div className='h-full flex flex-col backdrop-blur-sm dark:bg-transparent border border-transparent dark:border-neutral-800 rounded-2xl shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_20px_rgba(0,0,0,0.95)] overflow-hidden'>
        {/* Header bar (always visible) */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center justify-between ${isExpanded ? 'mt-2 mx-2' : ''} px-4 py-2 bg-neutral-50 dark:bg-neutral-900 dark:outline-2 rounded-full dark:hover:bg-neutral-800 transition-all hover:scale-99 duration-200 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] dark:outline-neutral-800`}
        >
          <span className='text-sm font-medium text-stone-800 dark:text-stone-200 '>Notes</span>
          {isExpanded ? (
            <ChevronUp className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          ) : (
            <ChevronDown className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          )}
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div
            className='flex-1 p-3 overflow-hidden thin-scrollbar'
            data-heimdall-wheel-exempt='true'
            data-heimdall-contextmenu-exempt='true'
          >
            <TextArea
              value={localNote}
              onChange={handleNoteChange}
              placeholder='Enter research notes for this conversation...'
              className='w-full h-full resize-none'
              minRows={20}
              fillAvailableHeight={true}
              autoFocus={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
