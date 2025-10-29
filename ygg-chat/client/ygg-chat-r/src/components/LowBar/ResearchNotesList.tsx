import { ChevronDown, ChevronUp } from 'lucide-react'
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ResearchNoteItem } from '../../hooks/useQueries'
import { useIsMobile } from '../../hooks/useMediaQuery'

interface ResearchNotesListProps {
  notes: ResearchNoteItem[]
  isLoading?: boolean
}

export const ResearchNotesList: React.FC<ResearchNotesListProps> = ({ notes, isLoading = false }) => {
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const [isExpanded, setIsExpanded] = useState(false)

  const handleNoteClick = (note: ResearchNoteItem) => {
    navigate(`/chat/${note.project_id}/${note.id}`)
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
                {notes.map(note => (
                  <div
                    key={note.id}
                    onClick={() => handleNoteClick(note)}
                    className='p-3 bg-neutral-50 dark:bg-neutral-900 rounded-lg cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-all duration-150 border border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md'
                  >
                    {/* Conversation title */}
                    <h3 className='text-sm font-semibold text-stone-800 dark:text-stone-200 mb-1 truncate'>
                      {note.title || `Conversation ${note.id}`}
                    </h3>

                    {/* Note preview */}
                    <p className='text-xs text-stone-600 dark:text-stone-400 mb-2 line-clamp-2'>
                      {truncateNote(note.research_note)}
                    </p>

                    {/* Timestamp */}
                    <div className='text-xs text-stone-500 dark:text-stone-500'>
                      {formatDate(note.updated_at)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
