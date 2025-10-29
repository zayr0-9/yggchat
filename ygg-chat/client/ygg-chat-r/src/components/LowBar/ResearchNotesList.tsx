import { ChevronDown, ChevronUp } from 'lucide-react'
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { ResearchNoteItem } from '../../hooks/useQueries'

interface ResearchNotesListProps {
  notes: ResearchNoteItem[]
  isLoading?: boolean
}

export const ResearchNotesList: React.FC<ResearchNotesListProps> = ({ notes, isLoading = false }) => {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [isExpanded, setIsExpanded] = useState(false)
  const [expandedNoteIds, setExpandedNoteIds] = useState<Set<string>>(new Set())

  const handleNoteClick = (note: ResearchNoteItem) => {
    navigate(`/chat/${note.project_id}/${note.id}`)
  }

  const toggleNoteExpansion = (noteId: string, event: React.MouseEvent) => {
    event.stopPropagation() // Prevent navigation when clicking chevron
    setExpandedNoteIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(noteId)) {
        newSet.delete(noteId)
      } else {
        newSet.add(noteId)
      }
      return newSet
    })
  }

  const truncateNote = (text: string, maxLength: number = 100): string => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) {
      return 'Today'
    } else if (diffDays === 1) {
      return 'Yesterday'
    } else if (diffDays < 7) {
      return `${diffDays} days ago`
    } else {
      return date.toLocaleDateString()
    }
  }

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 transition-all duration-300 ease-in-out ${
        isExpanded
          ? isMobile
            ? 'w-[95%] h-[75%]'
            : 'w-[35%] h-[60%]'
          : isMobile
            ? 'w-[50%] h-[35px]'
            : 'w-[18%] h-[35px]'
      }`}
    >
      {/* Container with shadow and border */}
      <div className='h-full flex flex-col backdrop-blur-sm dark:bg-transparent border border-transparent dark:border-neutral-800 rounded-2xl shadow-lg overflow-hidden'>
        {/* Header bar (always visible) */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`flex items-center justify-between ${isExpanded ? 'mt-2 mx-2' : ''} px-4 py-2 bg-neutral-50 dark:bg-neutral-900 dark:outline-2 rounded-full dark:hover:bg-neutral-800 transition-all hover:scale-99 duration-200 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)] dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] dark:outline-neutral-800`}
        >
          <span className='text-sm font-medium text-stone-800 dark:text-stone-200'>All Notes ({notes.length})</span>
          {isExpanded ? (
            <ChevronUp className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          ) : (
            <ChevronDown className='w-4 h-4 text-stone-600 dark:text-stone-300' />
          )}
        </button>

        {/* Expanded content - List of notes */}
        {isExpanded && (
          <div
            className='flex-1 p-3 overflow-y-auto thin-scrollbar'
            data-heimdall-wheel-exempt='true'
            data-heimdall-contextmenu-exempt='true'
          >
            {isLoading ? (
              <div className='text-center py-4 text-stone-600 dark:text-stone-400'>Loading notes...</div>
            ) : notes.length === 0 ? (
              <div className='text-center py-4 text-stone-600 dark:text-stone-400'>
                No research notes yet. Create notes by adding them to your conversations.
              </div>
            ) : (
              <div className='space-y-3'>
                {notes.map(note => {
                  const isNoteExpanded = expandedNoteIds.has(note.id)

                  return (
                    <div
                      key={note.id}
                      className='p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-sm transition-all duration-200 ease-in-out'
                    >
                      {/* Clickable header area - navigates to chat */}
                      <div
                        onClick={() => handleNoteClick(note)}
                        className='cursor-pointer hover:opacity-80 transition-opacity duration-150'
                      >
                        {/* Title row with chevron button */}
                        <div className='flex items-start justify-between gap-2 mb-1'>
                          <h3 className='flex-1 text-sm font-semibold text-stone-800 dark:text-stone-200 truncate'>
                            {note.title || `Conversation ${note.id}`}
                          </h3>
                          <button
                            onClick={e => toggleNoteExpansion(note.id, e)}
                            className='flex-shrink-0 p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded transition-colors duration-150'
                            aria-label={isNoteExpanded ? 'Collapse note' : 'Expand note'}
                            aria-expanded={isNoteExpanded}
                          >
                            {isNoteExpanded ? (
                              <ChevronUp className='w-3.5 h-3.5 text-stone-600 dark:text-stone-400' />
                            ) : (
                              <ChevronDown className='w-3.5 h-3.5 text-stone-600 dark:text-stone-400' />
                            )}
                          </button>
                        </div>

                        {/* Truncated preview - only show when collapsed */}
                        {!isNoteExpanded && (
                          <p className='text-xs text-stone-600 dark:text-stone-400 line-clamp-2'>
                            {truncateNote(note.research_note)}
                          </p>
                        )}
                      </div>

                      {/* Expanded content - full note text */}
                      {isNoteExpanded && (
                        <div className='mt-2 p-2 bg-neutral-100 dark:bg-neutral-800 rounded-md max-h-48 overflow-y-auto thin-scrollbar'>
                          <p className='text-xs text-stone-700 dark:text-stone-300 whitespace-pre-wrap'>
                            {note.research_note}
                          </p>
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className='text-xs text-stone-500 dark:text-stone-500 mt-2'>
                        {formatDate(note.updated_at)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
