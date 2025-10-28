import { ChevronDown, ChevronUp } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { ConversationId } from '../../../../../shared/types'
import { updateResearchNote } from '../../features/conversations/conversationActions'
import { makeSelectConversationById } from '../../features/conversations/conversationSelectors'
import { TextArea } from '../TextArea/TextArea'

interface LowBarProps {
  conversationId: ConversationId | null
}

export const LowBar: React.FC<LowBarProps> = ({ conversationId }) => {
  const dispatch = useDispatch()
  const [isExpanded, setIsExpanded] = useState(false)
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

  // Debounced update function
  const debouncedUpdate = useCallback(
    (note: string) => {
      if (!conversationId) return

      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = setTimeout(() => {
        dispatch(updateResearchNote({ id: conversationId, researchNote: note }) as any)
      }, 1000) // 1 second debounce
    },
    [conversationId, dispatch]
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
        isExpanded ? 'w-[400px] h-[320px]' : 'w-[200px] h-[40px]'
      }`}
    >
      {/* Container with shadow and border */}
      <div className='h-full flex flex-col bg-slate-100 dark:bg-secondary-700 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg overflow-hidden'>
        {/* Header bar (always visible) */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className='flex items-center justify-between px-4 py-2 bg-slate-200 dark:bg-secondary-600 hover:bg-slate-300 dark:hover:bg-secondary-500 transition-colors border-b border-gray-300 dark:border-gray-600 cursor-pointer'
        >
          <span className='text-sm font-medium text-stone-800 dark:text-stone-200'>Notes</span>
          {isExpanded ? (
            <ChevronUp className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          ) : (
            <ChevronDown className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          )}
        </button>

        {/* Expanded content */}
        {isExpanded && (
          <div className='flex-1 p-3 overflow-hidden' data-heimdall-wheel-exempt='true'>
            <TextArea
              value={localNote}
              onChange={handleNoteChange}
              placeholder='Enter research notes for this conversation...'
              className='w-full h-full resize-none'
              minRows={8}
              maxRows={8}
              autoFocus={false}
            />
          </div>
        )}
      </div>
    </div>
  )
}
