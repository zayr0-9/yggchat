import type { RootState } from '@/store/store'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useDispatch, useSelector } from 'react-redux'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { chatSliceActions } from '../../features/chats/chatSlice'
import { Button } from '../Button/button'
import { TextArea } from '../TextArea/TextArea'
type MessageRole = 'user' | 'assistant' | 'system'
// Updated to use valid Tailwind classes
type ChatMessageWidth =
  | 'max-w-sm'
  | 'max-w-md'
  | 'max-w-lg'
  | 'max-w-xl'
  | 'max-w-2xl'
  | 'max-w-3xl'
  | 'w-full'
  | 'w-3/5'

interface ChatMessageProps {
  id: string
  role: MessageRole
  content: string
  thinking?: string
  toolCalls?: string
  timestamp?: string | Date
  onEdit?: (id: string, newContent: string) => void
  onBranch?: (id: string, newContent: string) => void
  onDelete?: (id: string) => void
  onCopy?: (content: string) => void
  onResend?: (id: string) => void
  isEditing?: boolean
  width: ChatMessageWidth
  // When true (default), message cards have colored backgrounds and left borders.
  // When false, they render with transparent background and border.
  colored?: boolean
  modelName?: string
  className?: string
  artifacts?: string[]
}

interface MessageActionsProps {
  onEdit?: () => void
  onBranch?: () => void
  onDelete?: () => void
  onCopy?: () => void
  onResend?: () => void
  onSave?: () => void
  onCancel?: () => void
  onSaveBranch?: () => void
  onMore?: () => void
  isEditing: boolean
  editMode?: 'edit' | 'branch'
  copied?: boolean
}

const MessageActions: React.FC<MessageActionsProps> = ({
  onEdit,
  onBranch,
  onDelete,
  onCopy,
  onResend,
  onSave,
  onCancel,
  onSaveBranch,
  onMore,
  isEditing,
  editMode = 'edit',
  copied = false,
}) => {
  return (
    <div className='flex items-center gap-1 opacity-0 group-hover:opacity-100 border-1 border-stone-300 dark:bg-yBlack-900 dark:border-1 dark:border-neutral-700 transition-opacity rounded-3xl duration-200 shadow-[0_0px_4px_3px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_6px_2px_rgba(0,0,0,0.35)]'>
      <div className='flex items-center gap-1 px-2 py-1'>
        {isEditing ? (
          <>
            <button
              onClick={editMode === 'branch' ? onSaveBranch : onSave}
              className='p-1.5 rounded-2xl text-stone-600 hover:text-green-600 dark:text-stone-300 dark:hover:text-green-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
              title={editMode === 'branch' ? 'Create branch' : 'Save changes'}
            >
              {editMode === 'branch' ? (
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                </svg>
              ) : (
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                </svg>
              )}
            </button>
            <button
              onClick={onCancel}
              className='p-1.5 rounded-2xl text-stone-600 hover:text-red-400 hover:bg-neutral-100 dark:text-stone-300 hover:scale-105 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90'
              title='Cancel editing'
            >
              <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
              </svg>
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCopy}
              className={`p-1.5 rounded-2xl transition-colors duration-150 hover:scale-104 ${
                copied
                  ? 'text-green-500 hover:text-green-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900'
                  : 'text-stone-600 hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-transform duration-100 active:scale-90'
              }`}
              title={copied ? 'Copied' : 'Copy message'}
            >
              {copied ? (
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 13l4 4L19 7' />
                </svg>
              ) : (
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z'
                  />
                </svg>
              )}
            </button>
            {onEdit && (
              <button
                onClick={onEdit}
                className='p-1.5 rounded-2xl text-gray-400 hover:text-yellow-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
                title='Edit message'
              >
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z'
                  />
                </svg>
              </button>
            )}
            {onBranch && (
              <button
                onClick={onBranch}
                className='p-1.5 pt-2 rounded-2xl text-gray-400 hover:text-green-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-109 transition-colors duration-150 active:scale-90'
                title='Branch message'
              >
                <svg className='w-5 h-5' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 4v8a4 4 0 004 4h4M6 8a2 2 0 100-4 2 2 0 000 4zm8 8a2 2 0 100-4 2 2 0 000 4z'
                  />
                </svg>
              </button>
            )}
            {onResend && (
              <button
                onClick={onResend}
                className='p-1.5 rounded-2xl text-gray-400 hover:text-indigo-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
                title='Resend message'
              >
                <svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' viewBox='0 0 24 24'>
                  <path d='M19.07 4.93a9.9 9.9 0 0 0-3.18-2.14 10.12 10.12 0 0 0-7.79 0c-1.19.5-2.26 1.23-3.18 2.14S3.28 6.92 2.78 8.11A9.95 9.95 0 0 0 1.99 12h2c0-1.08.21-2.13.63-3.11.4-.95.98-1.81 1.72-2.54.73-.74 1.59-1.31 2.54-1.71 1.97-.83 4.26-.83 6.23 0 .95.4 1.81.98 2.54 1.72.17.17.33.34.48.52L16 9.01h6V3l-2.45 2.45c-.15-.18-.31-.36-.48-.52M19.37 15.11c-.4.95-.98 1.81-1.72 2.54-.73.74-1.59 1.31-2.54 1.71-1.97.83-4.26.83-6.23 0-.95-.4-1.81-.98-2.54-1.72-.17-.17-.33-.34-.48-.52l2.13-2.13H2v6l2.45-2.45c.15.18.31.36.48.52.92.92 1.99 1.64 3.18 2.14 1.23.52 2.54.79 3.89.79s2.66-.26 3.89-.79c1.19-.5 2.26-1.23 3.18-2.14s1.64-1.99 2.14-3.18c.52-1.23.79-2.54.79-3.89h-2c0 1.08-.21 2.13-.63 3.11Z'></path>
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                onClick={onDelete}
                className='p-1.5 rounded-2xl text-gray-400 hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90 hover:scale-105'
                title='Delete message'
              >
                <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16'
                  />
                </svg>
              </button>
            )}
            {onMore && (
              <div className='rounded-full pt-1 px-1 text-gray-400 hover:text-purple-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90 hover:scale-106'>
                <button onClick={onMore} className='' title='More options'>
                  <i className='bx bx-dots-vertical-rounded text-base'></i>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const ChatMessage: React.FC<ChatMessageProps> = React.memo(
  ({
    id,
    role,
    content,
    thinking,
    toolCalls,
    timestamp,
    onEdit,
    onBranch,
    onDelete,
    onCopy,
    onResend,
    isEditing = false,
    width = 'w-3/5',
    colored = true,
    modelName,
    className,
    artifacts = [],
  }) => {
    const dispatch = useDispatch()
    const [editingState, setEditingState] = useState(isEditing)
    const [editContent, setEditContent] = useState(content)
    const [editMode, setEditMode] = useState<'edit' | 'branch'>('edit')
    const [copied, setCopied] = useState(false)
    // Toggle visibility of the reasoning/thinking block
    const [showThinking, setShowThinking] = useState(true)
    // Toggle visibility of the tool calls block
    const [showToolCalls, setShowToolCalls] = useState(true)
    // More menu states
    const [showMoreMenu, setShowMoreMenu] = useState(false)
    const [showMoreInfo, setShowMoreInfo] = useState(false)
    const moreMenuRef = useRef<HTMLDivElement | null>(null)

    // Get message data from Redux store
    const messageData = useSelector((state: RootState) =>
      state.chat.conversation.messages.find(m => String(m.id) === String(id))
    )

    const handleEdit = () => {
      dispatch(chatSliceActions.editingBranchSet(false))
      setEditingState(true)
      setEditContent(content)
      setEditMode('edit')
    }

    const handleBranch = () => {
      dispatch(chatSliceActions.editingBranchSet(true))
      setEditingState(true)
      setEditContent(content)
      setEditMode('branch')
    }

    const handleSave = () => {
      const trimmedContent = editContent.trim()

      // Prevent saving empty messages
      if (!trimmedContent) {
        console.warn('Cannot save empty message')
        return
      }

      if (onEdit && trimmedContent !== content) {
        onEdit(id, trimmedContent)
      }
      dispatch(chatSliceActions.editingBranchSet(false))
      setEditingState(false)
    }

    const handleSaveBranch = () => {
      if (onBranch) {
        onBranch(id, editContent.trim())
      }
      dispatch(chatSliceActions.editingBranchSet(false))
      // Clear any image drafts after branching is initiated
      dispatch(chatSliceActions.imageDraftsCleared())
      setEditingState(false)
    }

    const handleCancel = () => {
      setEditContent(content)
      dispatch(chatSliceActions.editingBranchSet(false))
      if (editMode === 'branch') {
        dispatch(chatSliceActions.imageDraftsCleared())
        // Restore any artifacts deleted during branch editing
        dispatch(chatSliceActions.messageArtifactsRestoreFromBackup({ messageId: id }))
      }
      setEditingState(false)
      setEditMode('edit')
    }

    const handleCopy = async () => {
      if (onCopy) {
        onCopy(content)
      }
      const ok = await copyPlainText(content)
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else {
        console.error('Failed to copy message')
      }
    }

    const handleDelete = () => {
      if (onDelete) {
        onDelete(id)
      }
    }

    const handleResend = () => {
      if (onResend) {
        onResend(id)
      }
    }

    const handleDeleteArtifact = (index: number) => {
      dispatch(chatSliceActions.messageArtifactDeleted({ messageId: id, index }))
    }

    const handleMoreClick = () => {
      setShowMoreMenu(!showMoreMenu)
      setShowMoreInfo(false)
    }

    const handleMoreInfoClick = () => {
      setShowMoreInfo(true)
    }

    const handleBackToMenu = () => {
      setShowMoreInfo(false)
    }

    // Click outside handler
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
          setShowMoreMenu(false)
          setShowMoreInfo(false)
        }
      }

      if (showMoreMenu) {
        document.addEventListener('mousedown', handleClickOutside)
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }, [showMoreMenu])

    const copyPlainText = async (text: string) => {
      // Try async clipboard API first
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch (_) {
        // fall through to fallback
      }

      // Fallback for non-secure contexts or older browsers
      try {
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.focus()
        textarea.select()
        // @ts-ignore - Deprecated API used intentionally as a safe fallback when Clipboard API is unavailable
        const ok = document.execCommand('copy')
        document.body.removeChild(textarea)
        return ok
      } catch (err) {
        console.error('Copy fallback failed:', err)
        return false
      }
    }

    const getRoleStyles = () => {
      const transparentContainer = 'border-l-4 border-l-transparent bg-transparent dark:bg-transparent'
      const useColored = !!colored
      switch (role) {
        case 'user':
          return {
            container: useColored
              ? 'bg-gray-800 border-l-1 border-l-yellow-500 dark:border-l-yPurple-400 bg-neutral-50 dark:bg-neutral-900'
              : transparentContainer,
            role: 'text-indigo-800 dark:text-yPurple-50',
            roleText: 'User',
          }
        case 'assistant':
          return {
            container: useColored
              ? 'bg-gray-850 border-l-1 border-l-blue-500  dark:border-l-yBrown-400 bg-neutral-50  dark:bg-neutral-900'
              : transparentContainer,
            role: 'text-lime-800 dark:text-yBrown-50',
            roleText: 'Assistant',
          }
        case 'system':
          return {
            container: useColored
              ? 'bg-gray-800 border-l-1 border-l-purple-500 bg-purple-50 dark:bg-neutral-800'
              : transparentContainer,
            role: 'text-purple-400',
            roleText: 'System',
          }
        default:
          return {
            container: useColored
              ? 'bg-gray-800 border-l-4 border-l-gray-500 bg-gray-50 dark:bg-neutral-800'
              : transparentContainer,
            role: 'text-gray-400',
            roleText: 'Unknown',
          }
      }
    }

    const styles = getRoleStyles()

    const formatTimestamp = (dateInput: string | Date) => {
      const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
      if (isNaN(date.getTime())) {
        return typeof dateInput === 'string' ? dateInput : ''
      }
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    // Custom renderer for block code (<pre>) to add a copy button while preserving valid HTML structure
    const PreRenderer: React.FC<any> = ({ children, ...props }) => {
      const [copied, setCopied] = useState(false)
      const preRef = useRef<HTMLPreElement | null>(null)

      const handleCopyCode = async () => {
        try {
          const plain = preRef.current?.innerText ?? ''
          await navigator.clipboard.writeText(plain)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch (err) {
          console.error('Failed to copy code block:', err)
        }
      }

      return (
        <div className='relative group/code my-3 not-prose'>
          {
            <Button
              type='button'
              onClick={handleCopyCode}
              className='absolute top-2 right-2 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity duration-150 border-1 text-slate-900 dark:text-white border-neutral-600 dark:border-neutral-600 dark:hover:bg-neutral-700'
              size='smaller'
              variant='outline'
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          }
          <pre
            ref={preRef}
            className={`not-prose overflow-auto rounded-lg ring-0 outline-none shadow-none bg-gray-100 text-gray-900 dark:bg-neutral-900 dark:text-neutral-100 p-3 dark:border-1 dark:border-neutral-500`}
            {...props}
          >
            {children}
          </pre>
        </div>
      )
    }

    return (
      <div
        id={`message-${id}`}
        className={`group p-4 mb-4 ${styles.container} ${width} transition-all duration-200 rounded-xl hover:bg-opacity-80  ${className ?? ''}`}
      >
        {/* Header with role and actions */}
        <div className='flex items-center justify-between mb-3'>
          <div className='flex items-center gap-2'>
            <span className={`text-sm font-semibold ${styles.role}`}>{styles.roleText}</span>
            {timestamp && formatTimestamp(timestamp) && (
              <span className='text-xs text-neutral-400 pt-0.5'>{formatTimestamp(timestamp)}</span>
            )}
          </div>

          <div className='relative'>
            <MessageActions
              onEdit={role === 'user' ? handleEdit : handleEdit}
              onBranch={role === 'user' ? handleBranch : undefined}
              onDelete={handleDelete}
              onCopy={handleCopy}
              onResend={role === 'assistant' ? handleResend : undefined}
              onSave={handleSave}
              onSaveBranch={handleSaveBranch}
              onCancel={handleCancel}
              onMore={handleMoreClick}
              isEditing={editingState}
              editMode={editMode}
              copied={copied}
            />
            {/* More menu dropdown */}
            {showMoreMenu && (
              <div
                ref={moreMenuRef}
                className='absolute right-0 top-8 z-20 w-80 rounded-2xl bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 shadow-[0_0px_4px_3px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_8px_2px_rgba(0,0,0,0.45)]'
              >
                {!showMoreInfo ? (
                  <div className='py-1 rounded-4xl'>
                    <button
                      onClick={handleMoreInfoClick}
                      className='w-full text-left rounded-4xl px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-900 active:scale-95 transition-all duration-150'
                    >
                      More Info
                    </button>
                  </div>
                ) : (
                  <div className='p-3'>
                    <div className='flex items-center justify-between mb-2'>
                      <h3 className='text-sm font-semibold text-gray-700 dark:text-gray-300'>Message Info</h3>
                      <button
                        onClick={handleBackToMenu}
                        className='text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 active:scale-95 transition-all duration-150'
                      >
                        Back
                      </button>
                    </div>
                    <div className='max-h-96 overflow-y-auto text-xs space-y-1.5 pt-2'>
                      {messageData ? (
                        <>
                          {Object.entries(messageData)
                            .filter(
                              ([key]) =>
                                key !== 'content' &&
                                key !== 'plain_text_content' &&
                                key !== 'artifacts' &&
                                key !== 'content_plain_text'
                            )
                            .map(([key, value]) => (
                              <div key={key} className='flex gap-2'>
                                <span className='font-medium text-gray-600 dark:text-gray-400 shrink-0'>{key}:</span>
                                <span className='text-gray-800 dark:text-gray-200 break-all'>
                                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                </span>
                              </div>
                            ))}
                        </>
                      ) : (
                        <p className='text-gray-500 dark:text-gray-400'>No message data found</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Tool calls block */}
        {typeof toolCalls === 'string' && toolCalls.trim().length > 0 && (
          <div className='mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-900/40 dark:bg-neutral-900'>
            <div className='mb-2 flex items-center justify-between'>
              <div className='text-xs font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300'>
                Tool Calls
              </div>
              <Button
                type='button'
                onClick={() => setShowToolCalls(s => !s)}
                className='ml-2 text-xs px-2 py-1 border-1 border-blue-300 text-blue-800 dark:text-blue-300 dark:border-blue-900/60 hover:bg-blue-100 dark:hover:bg-neutral-800'
                size='smaller'
                variant='outline'
                aria-expanded={showToolCalls}
                aria-controls={`tool-calls-content-${id}`}
              >
                {showToolCalls ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showToolCalls && (
              <div id={`tool-calls-content-${id}`} className='prose max-w-none dark:prose-invert w-full text-sm'>
                <pre className='bg-gray-100 dark:bg-neutral-800 p-3 rounded-md overflow-auto text-xs'>
                  <code className='text-blue-700 dark:text-blue-300'>
                    {(() => {
                      try {
                        const parsed = JSON.parse(toolCalls)
                        return JSON.stringify(parsed, null, 2)
                      } catch {
                        return toolCalls
                      }
                    })()}
                  </code>
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Reasoning / thinking block */}
        {typeof thinking === 'string' && thinking.trim().length > 0 && (
          <div className='mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/40 dark:bg-neutral-900'>
            <div className='mb-2 flex items-center justify-between'>
              <div className='text-xs font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300'>
                Reasoning
              </div>
              <Button
                type='button'
                onClick={() => setShowThinking(s => !s)}
                className='ml-2 text-xs px-2 py-1 border-1 border-amber-300 text-amber-800 dark:text-amber-300 dark:border-amber-900/60 hover:bg-amber-100 dark:hover:bg-neutral-800'
                size='smaller'
                variant='outline'
                aria-expanded={showThinking}
                aria-controls={`reasoning-content-${id}`}
              >
                {showThinking ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showThinking && (
              <div id={`reasoning-content-${id}`} className='prose max-w-none dark:prose-invert w-full text-sm'>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
                  components={{ pre: PreRenderer }}
                >
                  {thinking}
                </ReactMarkdown>
              </div>
            )}
          </div>
        )}

        {/* Message content */}
        <div className='prose max-w-none dark:prose-invert w-full text-lg'>
          {editingState ? (
            <TextArea
              value={editContent}
              onChange={setEditContent}
              placeholder='Edit your message...'
              minRows={2}
              maxRows={40}
              maxLength={20000}
              autoFocus
              width='w-full'
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (editMode === 'branch') {
                    handleSaveBranch()
                  } else {
                    handleSave()
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  handleCancel()
                }
              }}
            />
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
              components={{ pre: PreRenderer }}
            >
              {content}
            </ReactMarkdown>
          )}
        </div>

        {/* Artifacts (images) */}
        {Array.isArray(artifacts) && artifacts.length > 0 && (
          <div className='mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3'>
            {artifacts.map((dataUrl, idx) => (
              <div
                key={`${id}-artifact-${idx}`}
                className='relative rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900'
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dataUrl}
                  alt={`attachment-${idx}`}
                  className='w-full h-64 object-contain bg-neutral-100 dark:bg-neutral-800'
                  loading='lazy'
                />
                {editingState && editMode === 'branch' && (
                  <button
                    type='button'
                    title='Remove image'
                    onClick={() => handleDeleteArtifact(idx)}
                    className='absolute top-2 right-2 z-10 p-1.5 rounded-md bg-neutral-800/70 text-white hover:bg-neutral-700'
                  >
                    <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                      <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M6 18L18 6M6 6l12 12' />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Edit instructions */}
        {editingState && (
          <div className='mt-2 text-xs text-gray-500'>
            Press Enter to save, Shift+Enter for new line, Escape to cancel
          </div>
        )}

        {modelName && <div className='mt-2 text-[16px] text-gray-500 flex justify-end'>{modelName}</div>}
      </div>
    )
  }
)

// Display name for debugging
ChatMessage.displayName = 'ChatMessage'

export { ChatMessage }
