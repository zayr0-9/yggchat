import type { ContentBlock, ToolCall } from '@/features/chats/chatTypes'
import type { RootState } from '@/store/store'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { useDispatch, useSelector } from 'react-redux'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { chatSliceActions } from '../../features/chats/chatSlice'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { Button } from '../Button/button'
import { ContextMenu, ContextMenuItem } from '../ContextMenu/ContextMenu'
import { TextArea } from '../TextArea/TextArea'
type MessageRole = 'user' | 'assistant' | 'system' | 'ex_agent'
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
  toolCalls?: ToolCall[]
  contentBlocks?: ContentBlock[]
  timestamp?: string | Date
  onEdit?: (id: string, newContent: string) => void
  onBranch?: (id: string, newContent: string) => void
  onDelete?: (id: string) => void
  onCopy?: (content: string) => void
  onResend?: (id: string) => void
  onAddToNote?: (text: string) => void
  onExplainFromSelection?: (id: string, newContent: string) => void
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
    <div className='flex items-center gap-0.5 sm:gap-1 max-[767px]:opacity-100 opacity-0 group-hover:opacity-100 border-1 border-stone-300 dark:bg-yBlack-900 dark:border-1 dark:border-neutral-700 transition-opacity rounded-3xl duration-200 shadow-[0_0px_4px_3px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_6px_2px_rgba(0,0,0,0.35)]'>
      <div className='flex items-center gap-0.5 sm:gap-1 px-1 sm:px-2 py-0.5 sm:py-1'>
        {isEditing ? (
          <>
            <button
              onClick={editMode === 'branch' ? onSaveBranch : onSave}
              className='p-1.5 rounded-2xl text-stone-700 hover:text-green-600 dark:text-stone-300 dark:hover:text-green-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
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
              className='p-1.5 rounded-2xl text-stone-700 hover:text-red-400 hover:bg-neutral-100 dark:text-stone-300 hover:scale-105 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90'
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
                  : 'text-stone-700 hover:text-blue-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-transform duration-100 active:scale-90'
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
                className='p-1.5 rounded-2xl text-stone-700 hover:text-yellow-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
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
                className='p-1.5 pt-2 rounded-2xl text-stone-700 hover:text-green-600 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-109 transition-colors duration-150 active:scale-90'
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
                className='p-1.5 rounded-2xl text-stone-700 hover:text-indigo-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 hover:scale-105 transition-colors duration-150 active:scale-90'
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
                className='p-1.5 rounded-2xl text-stone-700 hover:text-red-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90 hover:scale-105'
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
              <div className='rounded-full pt-1 px-1 text-stone-700 hover:text-purple-400 hover:bg-neutral-100 dark:hover:bg-yBlack-900 transition-colors duration-150 active:scale-90 hover:scale-106'>
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
    contentBlocks,
    // timestamp,
    onEdit,
    onBranch,
    onDelete,
    onCopy,
    onResend,
    onAddToNote,
    onExplainFromSelection,
    isEditing = false,
    width = 'w-3/5',
    colored = true,
    modelName,
    className,
    artifacts = [],
  }) => {
    const dispatch = useDispatch()
    const isMobile = useIsMobile()
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
    const [menuOpenUp, setMenuOpenUp] = useState(false)
    const moreMenuRef = useRef<HTMLDivElement | null>(null)
    const moreButtonRef = useRef<HTMLDivElement | null>(null)
    // Context menu states
    const [contextMenuOpen, setContextMenuOpen] = useState(false)
    const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
    const [selectedText, setSelectedText] = useState<string>('')
    // Explain input states
    const [showExplainInput, setShowExplainInput] = useState(false)
    const [explainInputValue, setExplainInputValue] = useState('')
    const explainInputPosition = useRef<{ x: number; y: number } | null>(null)
    const explainInputRef = useRef<HTMLDivElement | null>(null)

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

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault()

      // Get selected text
      const selection = window.getSelection()
      const text = selection?.toString().trim() || ''

      // Only show menu if text is selected
      if (text) {
        setSelectedText(text)
        setContextMenuPosition({ x: e.clientX, y: e.clientY })
        setContextMenuOpen(true)
      }
    }

    const handleAddToNoteClick = () => {
      if (onAddToNote && selectedText) {
        onAddToNote(selectedText)
      }
      setContextMenuOpen(false)
    }

    const handleCopySelectedText = async () => {
      if (selectedText) {
        await copyPlainText(selectedText)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      setContextMenuOpen(false)
    }

    const handleCreateBranchFromSelection = () => {
      if (onExplainFromSelection && selectedText) {
        // Store position and show floating input instead of immediately creating branch
        explainInputPosition.current = contextMenuPosition
        setShowExplainInput(true)
        setExplainInputValue('')
      }
      setContextMenuOpen(false)
    }

    const handleSendExplainInput = () => {
      if (onExplainFromSelection && selectedText && explainInputValue.trim()) {
        // Combine user's custom question with the selected text
        const branchContent = `${explainInputValue.trim()}\n\nSelected text:\n${selectedText}`
        onExplainFromSelection(id, branchContent)
        // Reset state
        setShowExplainInput(false)
        setExplainInputValue('')
        setSelectedText('')
      }
    }

    const handleCancelExplainInput = () => {
      setShowExplainInput(false)
      setExplainInputValue('')
      setSelectedText('')
    }

    // Get adjusted position for explain input to avoid viewport overflow
    const getAdjustedExplainInputPosition = () => {
      if (!explainInputPosition.current || !explainInputRef.current) return explainInputPosition.current

      const inputRect = explainInputRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // On mobile, center the input in the viewport
      if (isMobile) {
        return {
          x: (viewportWidth - inputRect.width) / 2,
          y: (viewportHeight - inputRect.height) / 2,
        }
      }

      // On desktop, position near the cursor but adjust to avoid viewport overflow
      let { x, y } = explainInputPosition.current

      // Adjust horizontal position
      if (x + inputRect.width > viewportWidth) {
        x = viewportWidth - inputRect.width - 10
      }

      // Adjust vertical position
      if (y + inputRect.height > viewportHeight) {
        y = viewportHeight - inputRect.height - 10
      }

      return { x: Math.max(10, x), y: Math.max(10, y) }
    }

    // Context menu items
    const contextMenuItems: ContextMenuItem[] = [
      {
        label: 'Add to note',
        icon: <i className='bx bx-note' />,
        onClick: handleAddToNoteClick,
        disabled: !onAddToNote || !selectedText,
      },
      {
        label: 'Explain',
        icon: <i className='bx bx-git-branch' />,
        onClick: handleCreateBranchFromSelection,
        disabled: !onExplainFromSelection || !selectedText,
      },
      {
        label: 'Copy',
        icon: <i className='bx bx-copy' />,
        onClick: handleCopySelectedText,
        disabled: !selectedText,
      },
    ]

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

    // Click outside handler for more menu
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

    // Click outside handler for explain input
    useEffect(() => {
      if (!showExplainInput) return

      const handleClickOutside = (event: MouseEvent) => {
        if (explainInputRef.current && !explainInputRef.current.contains(event.target as Node)) {
          handleCancelExplainInput()
        }
      }

      document.addEventListener('mousedown', handleClickOutside)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }, [showExplainInput])

    // Compute dropdown placement - runs on mount and when menu state changes
    useEffect(() => {
      const computePosition = () => {
        const trigger = moreButtonRef.current
        if (!trigger || typeof window === 'undefined') return

        const rect = trigger.getBoundingClientRect()
        const spaceBelow = window.innerHeight - rect.bottom
        const spaceAbove = rect.top

        // Open upward if space below is insufficient and space above is better
        const shouldOpenUp = spaceBelow < 300 && spaceAbove > spaceBelow
        setMenuOpenUp(shouldOpenUp)
      }

      // Always compute on mount and when showMoreMenu changes
      computePosition()

      if (!showMoreMenu) return

      window.addEventListener('resize', computePosition)
      window.addEventListener('scroll', computePosition, true)

      return () => {
        window.removeEventListener('resize', computePosition)
        window.removeEventListener('scroll', computePosition, true)
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
              ? 'bg-gray-800 border-l-0 border-l-yellow-500 dark:border-l-yPurple-400 bg-neutral-50 dark:bg-yBlack-800'
              : transparentContainer,
            role: 'text-indigo-800 dark:text-yPurple-50',
            roleText: 'User',
          }
        case 'assistant':
          return {
            container: useColored
              ? 'bg-gray-850 border-l-0 border-l-blue-500 dark:border-l-yBrown-400 bg-neutral-50  dark:bg-neutral-900'
              : transparentContainer,
            role: 'text-lime-800 dark:text-yBrown-50',
            roleText: 'Assistant',
          }
        case 'system':
          return {
            container: useColored
              ? 'bg-gray-800 border-l-0 border-l-purple-500 bg-purple-50 dark:bg-neutral-800'
              : transparentContainer,
            role: 'text-purple-400',
            roleText: 'System',
          }
        case 'ex_agent':
          return {
            container: useColored
              ? 'bg-gray-800 border-2 border-orange-600 bg-emerald-50 bg-neutral-50 dark:bg-neutral-800'
              : transparentContainer,
            role: 'text-orange-700 dark:text-orange-400',
            roleText: 'Claude Code',
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

    // const formatTimestamp = (dateInput: string | Date) => {
    //   const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput
    //   if (isNaN(date.getTime())) {
    //     return typeof dateInput === 'string' ? dateInput : ''
    //   }
    //   return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    // }

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
            className={`not-prose overflow-auto rounded-2xl ring-0 outline-none bg-gray-100 text-gray-900 dark:bg-neutral-900 dark:text-neutral-100 p-3 dark:border-1 dark:border-neutral-700 shadow-[0px_0px_6px_0px_rgba(0,0,0,0.15)]  dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)]`}
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
        className={`group px-2 sm:px-2 md:px-2 mb-1 sm:mb-1 md:mb-2 ${styles.container} ${width} transition-all duration-200 rounded-3xl hover:bg-opacity-80  ${className ?? ''}`}
        onContextMenu={handleContextMenu}
      >
        {/* Header with role */}
        <div className='flex items-center justify-between mb-3 xl:mb-4 ml-1'>
          <div className='flex items-center justify-between max-w-32 dark:bg-neutral-800 shadow-[0px_0px_2.5px_-0.5px_rgba(0,0,0,0.50)]  dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] rounded-4xl px-3 py-2'>
            <span
              className={`text-[14px] mt-0 sm:text-[14px] lg:text-[16px] 3xl:text-base font-semibold ${styles.role}`}
            >
              {styles.roleText}
            </span>
          </div>
        </div>

        {/* Tool calls block */}
        {Array.isArray(toolCalls) && toolCalls.length > 0 && (
          <div className='mb-3 mx-3 rounded-2xl border border-blue-200 bg-neutral-50 p-2 sm:p-3 dark:border-blue-900/30 dark:bg-neutral-900 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)]  dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)]'>
            <div className='mb-2 flex items-center justify-between'>
              <div className='text-xs sm:text-sm 3xl:text-base font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300'>
                Tool Calls ({toolCalls.length})
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
              <div
                id={`tool-calls-content-${id}`}
                className='space-y-3 text-xs sm:text-sm xl:text-[14px] 3xl:text-base '
              >
                {toolCalls.map((toolCall, idx) => (
                  <div key={toolCall.id || idx} className='bg-neutral-50 rounded-2xl dark:bg-neutral-900 py-2 '>
                    <div className='flex items-center justify-between mb-2'>
                      <div className='font-semibold text-blue-700 dark:text-blue-300'>{toolCall.name}</div>
                      {/* <span className='text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'>
                        {toolCall.status}
                      </span> */}
                    </div>
                    {toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
                      <div className='text-xs space-y-1'>
                        {Object.entries(toolCall.arguments).map(([key, value]) => (
                          <div key={key} className='flex gap-2'>
                            <span className='font-medium text-gray-600 dark:text-gray-400'>{key}:</span>
                            <span className='text-gray-800 dark:text-gray-200 break-all'>
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {toolCall.result && (
                      <div className='mt-2 p-1.5 bg-green-50 dark:bg-green-900/20 rounded text-green-800 dark:text-green-300 text-xs'>
                        <div className='font-semibold mb-1'>Result:</div>
                        <div className='break-all'>{toolCall.result}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Reasoning / thinking block */}
        {typeof thinking === 'string' && thinking.trim().length > 0 && (
          <div className='mb-3 rounded-xl p-2 border border-neutral-100 bg-neutral-50 mx-3 sm:px-2 dark:border-neutral-900/40 dark:bg-neutral-900 shadow-[0px_0px_3px_1px_rgba(0,0,0,0.05)]  dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)]'>
            <div className='mb-2 flex items-center justify-between'>
              <div className='text-xs sm:text-sm 3xl:text-base font-semibold uppercase tracking-wide text-neutral-800 dark:text-neutral-300'>
                Reasoning
              </div>
              <Button
                type='button'
                onClick={() => setShowThinking(s => !s)}
                className='ml-2 text-xs px-2 py-1 border-1 border-neutral-50 text-amber-800 dark:text-amber-300 dark:border-amber-900/60 hover:bg-amber-100 dark:hover:bg-neutral-800'
                size='smaller'
                variant='outline'
                aria-expanded={showThinking}
                aria-controls={`reasoning-content-${id}`}
              >
                {showThinking ? 'Hide' : 'Show'}
              </Button>
            </div>
            {showThinking && (
              <div
                id={`reasoning-content-${id}`}
                className='prose max-w-none dark:prose-invert w-full text-xs sm:text-sm 3xl:text-base'
              >
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

        {/* Sequential content blocks for ex_agent messages (Claude Code responses) */}
        {Array.isArray(contentBlocks) && contentBlocks.length > 0 && (
          <div className='space-y-3 mb-3'>
            {contentBlocks.map((block, idx) => {
              switch (block.type) {
                case 'thinking':
                  return (
                    <div
                      key={`thinking-${block.index}-${idx}`}
                      className='rounded-2xl border border-neutral-50 bg-neutral-50 p-2 sm:p-3 dark:border-neutral-800 dark:bg-neutral-900 shadow-[0px_0px_4px_-0.5px_rgba(0,0,0,0.2)] dark:shadow-[0px_0px_16px_-2px_rgba(0,0,0,0.45)]'
                    >
                      <div className='text-xs sm:text-sm lg:text-xs py-1 3xl:text-base font-semibold uppercase tracking-wide text-neutral-800 dark:text-orange-300/85 mb-2'>
                        Thinking
                      </div>
                      <div className='prose max-w-none dark:prose-invert w-full text-xs sm:text-sm 3xl:text-base'>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
                          components={{ pre: PreRenderer }}
                        >
                          {block.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  )
                case 'tool_use':
                  const blockInput = (block.input ?? {}) as Record<string, any>
                  const todos = Array.isArray(blockInput.todos)
                    ? (blockInput.todos as Array<Record<string, any>>)
                    : null
                  const otherInputs = Object.entries(blockInput).filter(([key]) => key !== 'todos')
                  return (
                    <div
                      key={`tool-use-${block.id}-${idx}`}
                      className='rounded-2xl border border-blue-50 my-3 bg-neutral-50 p-1 sm:p-2 dark:border-neutral-800 dark:bg-neutral-900 shadow-[0px_0px_4px_-0.5px_rgba(0,0,0,0.1)] dark:shadow-[0px_0px_16px_-2px_rgba(0,0,0,0.45)]'
                    >
                      <div className='text-xs sm:text-sm lg:text-xs py-1 3xl:text-base font-semibold uppercase tracking-wide text-blue-800 dark:text-blue-300 mb-1'>
                        Tool: {block.name}
                      </div>
                      <div className='bg-neutral-50 dark:bg-neutral-900 px-2 pb-1 rounded-md text-xs sm:text-sm'>
                        {todos && todos.length > 0 && (
                          <div className='space-y-2'>
                            <div className='font-semibold text-blue-700 dark:text-blue-300'>Todo Items</div>
                            <ul className='space-y-1 list-disc list-inside text-gray-800 dark:text-gray-200'>
                              {todos.map((todo, todoIdx) => (
                                <li key={todoIdx} className='ml-2'>
                                  <div className='font-medium'>{todo.content ?? 'Untitled task'}</div>
                                  <div className='text-xs text-gray-600 dark:text-gray-400 flex flex-wrap gap-2'>
                                    {todo.status && (
                                      <span className='inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
                                        {String(todo.status)}
                                      </span>
                                    )}
                                    {todo.activeForm && <span className='italic'>{String(todo.activeForm)}</span>}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {otherInputs.length > 0 && (
                          <div className='space-y-1 mt-2'>
                            <div className='font-semibold text-xs text-blue-700 dark:text-blue-300'>Input</div>
                            {otherInputs.map(([key, value]) => (
                              <div key={key} className='flex gap-2'>
                                <span className='font-medium text-gray-600 dark:text-gray-400'>{key}:</span>
                                <span className='text-gray-800 dark:text-gray-200 break-all'>
                                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                case 'text':
                  return (
                    <div
                      key={`text-${block.index}-${idx}`}
                      className='prose max-w-none dark:prose-invert w-full text-xs sm:text-sm 3xl:text-base'
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }]]}
                        components={{ pre: PreRenderer }}
                      >
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  )
                case 'tool_result':
                  const isError = block.is_error
                  return (
                    <div
                      key={`tool-result-${block.tool_use_id}-${idx}`}
                      className={`rounded-2xl border p-2 sm:p-3 my-2 text-xs shadow-[0px_0px_4px_-0.5px_rgba(0,0,0,0.1)] dark:shadow-[0px_0px_16px_-2px_rgba(0,0,0,0.45)] ${
                        isError
                          ? 'border-red-50 bg-red-50 dark:border-red-900/40 dark:bg-neutral-900'
                          : 'border-green-50 bg-neutral-50 dark:border-green-900/40 dark:bg-neutral-900'
                      }`}
                    >
                      <div
                        className={`text-xs sm:text-xs 3xl:text-base font-semibold uppercase tracking-wide mb-2 ${
                          isError ? 'text-red-800 dark:text-red-300' : 'text-green-800 dark:text-green-300'
                        }`}
                      >
                        {isError ? 'Tool Error' : 'Tool Result'}
                      </div>
                      <div className='text-xs text-neutral-800 dark:text-neutral-50 sm:text-sm break-all whitespace-pre-wrap'>
                        {typeof block.content === 'object'
                          ? JSON.stringify(block.content, null, 2)
                          : String(block.content)}
                      </div>
                    </div>
                  )
                default:
                  return null
              }
            })}
          </div>
        )}

        {/* Message content - only show if no contentBlocks present (to avoid duplication with content_blocks last element) */}
        {(!contentBlocks || contentBlocks.length === 0) && (
          <div className='prose px-4 max-w-none dark:prose-invert w-full text-[16px] md:text-[14px] lg:text-[14px] xl:text-[16px] 2xl:text-[18px] 3xl:text-[20px] 4xl:text-[20px]'>
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
        )}
        {modelName && (
          <div className='mt-1 text-xs sm:text-sm 3xl:text-base text-stone-400 flex justify-end'>{modelName}</div>
        )}
        {/* Actions row (at bottom) */}
        <div className='flex items-center justify-end mt-3 mb-2'>
          <div ref={moreButtonRef} className='relative'>
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
                className={`absolute right-0 ${menuOpenUp ? 'bottom-full mb-1' : 'top-8'} z-20 w-64 sm:w-72 md:w-80 rounded-2xl bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 shadow-[0_0px_4px_3px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_8px_2px_rgba(0,0,0,0.45)]`}
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
                  <div className='p-2 sm:p-3'>
                    <div className='flex items-center justify-between mb-1'>
                      <h3 className='text-xs sm:text-sm 3xl:text-base font-semibold text-gray-700 dark:text-gray-300'>
                        Message Info
                      </h3>
                      <button
                        onClick={handleBackToMenu}
                        className='text-xs sm:text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 active:scale-95 transition-all duration-150'
                      >
                        Back
                      </button>
                    </div>
                    <div className='max-h-64 sm:max-h-80 md:max-h-96 overflow-y-auto text-xs sm:text-sm space-y-1.5 pt-2'>
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

        {/* Artifacts (images) */}
        {Array.isArray(artifacts) && artifacts.length > 0 && (
          <div className='mt-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 sm:gap-3'>
            {artifacts.map((dataUrl, idx) => (
              <div
                key={`${id}-artifact-${idx}`}
                className='relative rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900'
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={dataUrl}
                  alt={`attachment-${idx}`}
                  className='w-full h-40 sm:h-48 md:h-56 lg:h-64 object-contain bg-neutral-100 dark:bg-neutral-800'
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
          <div className='mt-2 text-xs sm:text-sm text-gray-500'>
            Press Enter to save, Shift+Enter for new line, Escape to cancel
          </div>
        )}

        {/* {timestamp && formatTimestamp(timestamp) && (
          <div className='text-[9px] sm:text-xs 3xl:text-sm text-stone-400 pt-0.5 flex justify-end'>
            {formatTimestamp(timestamp)}
          </div>
        )} */}

        {/* Context Menu */}
        <ContextMenu
          isOpen={contextMenuOpen}
          position={contextMenuPosition}
          items={contextMenuItems}
          onClose={() => setContextMenuOpen(false)}
        />

        {/* Floating Explain Input */}
        <AnimatePresence>
          {showExplainInput && explainInputPosition.current && (
            <motion.div
              ref={explainInputRef}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className='fixed z-[10000] w-[320px] sm:w-[400px] rounded-lg bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)] p-3'
              style={{
                left: `${getAdjustedExplainInputPosition()?.x || explainInputPosition.current.x}px`,
                top: `${getAdjustedExplainInputPosition()?.y || explainInputPosition.current.y}px`,
              }}
            >
              {/* <div className='mb-2 text-sm font-medium text-gray-700 dark:text-gray-300'>
                Ask about selected text
              </div> */}
              {/* Display selected text */}
              <div className='mb-2 p-2 rounded-md bg-neutral-50 dark:bg-yBlack-800 border border-neutral-200 dark:border-neutral-700 max-h-[100px] overflow-y-auto'>
                <div className='text-xs text-gray-600 dark:text-gray-400 italic line-clamp-4'>"{selectedText}"</div>
              </div>
              <TextArea
                value={explainInputValue}
                onChange={setExplainInputValue}
                placeholder='Ask a question about the selected text...'
                autoFocus
                width='w-full'
                minRows={1}
                maxRows={2}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendExplainInput()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    handleCancelExplainInput()
                  }
                }}
              />
              <div className='mt-2 flex justify-end gap-2'>
                <button
                  onClick={handleCancelExplainInput}
                  className='px-3 py-1.5 text-sm rounded-md text-gray-700 dark:text-gray-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors'
                >
                  Cancel
                </button>
                <button
                  onClick={handleSendExplainInput}
                  disabled={!explainInputValue.trim()}
                  className='px-3 py-1.5 text-sm rounded-md bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-300 disabled:cursor-not-allowed dark:disabled:bg-neutral-700 text-white transition-colors'
                >
                  Send
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }
)

// Display name for debugging
ChatMessage.displayName = 'ChatMessage'

export { ChatMessage }
