import type { ContentBlock, StreamEvent, ToolCall } from '@/features/chats/chatTypes'
import type { ToolDefinition } from '@/features/chats/toolDefinitions'
import type { RootState } from '@/store/store'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import { AnimatePresence, motion } from 'framer-motion'
import 'katex/dist/katex.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ReactMarkdown from 'react-markdown'
import { useSelector } from 'react-redux'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { fetchMcpTools } from '../../features/chats/chatActions'
import { chatSliceActions } from '../../features/chats/chatSlice'
import { useAppDispatch } from '../../hooks/redux'
import { useAuth } from '../../hooks/useAuth'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { environment, localApi } from '../../utils/api'
import { attachMessageBridge } from '../../utils/iframeBridge'
import { Button } from '../Button/button'
import { EditFileDiffView } from '../EditFileDiffView/EditFileDiffView'
import { useHtmlIframeRegistry } from '../HtmlIframeRegistry/HtmlIframeRegistry'
import { ImageModal } from '../ImageModal/ImageModal'
import { MarkdownLink } from '../MarkdownLink/MarkdownLink'
import { McpAppIframe } from '../McpAppIframe/McpAppIframe'
import { TextArea } from '../TextArea/TextArea'

type MessageRole = 'user' | 'assistant' | 'system' | 'ex_agent' | 'tool'
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
  streamEvents?: StreamEvent[]
  timestamp?: string | Date
  onEdit?: (id: string, newContent: string, newContentBlocks?: ContentBlock[]) => void
  onBranch?: (id: string, newContent: string, newContentBlocks?: ContentBlock[]) => void
  onDelete?: (id: string) => void
  onCopy?: (content: string) => void
  onResend?: (id: string) => void
  onAddToNote?: (text: string) => void
  onExplainFromSelection?: (id: string, newContent: string) => void
  onOpenToolHtmlModal?: (key?: string) => void
  isEditing?: boolean
  width: ChatMessageWidth
  // When true (default), message cards have colored backgrounds and left borders.
  // When false, they render with transparent background and border.
  colored?: boolean
  modelName?: string
  className?: string
  artifacts?: string[]
  showInlineActions?: boolean
  // Font size offset in pixels: positive increases, negative decreases all fonts uniformly
  fontSizeOffset?: number
  // Optional UX setting to group long consecutive reasoning/tool chains
  groupToolReasoningRuns?: boolean
  onEditingStateChange?: (id: string, isEditing: boolean, mode: 'edit' | 'branch' | null) => void
}

interface MessageActionsProps {
  onEdit?: () => void
  onBranch?: () => void
  onDelete?: () => void
  onCopy?: () => void
  onCopySelection?: () => void
  onExplainSelection?: (position?: { x: number; y: number }) => void
  onAddToNoteSelection?: () => void
  onResend?: () => void
  onSave?: () => void
  onCancel?: () => void
  onSaveBranch?: () => void
  onMore?: () => void
  isEditing: boolean
  editMode?: 'edit' | 'branch'
  copied?: boolean
  modelName?: string
  isVisible?: boolean
  variant?: 'default' | 'selection'
  layout?: 'pill' | 'menu'
}

const MessageActions: React.FC<MessageActionsProps> = ({
  onEdit,
  onBranch,
  onDelete,
  onCopy,
  onCopySelection,
  onExplainSelection,
  onAddToNoteSelection,
  // onResend - hidden from UI
  onSave,
  onCancel,
  onSaveBranch,
  onMore,
  isEditing,
  editMode = 'edit',
  copied = false,
  modelName,
  isVisible = false,
  variant = 'default',
  layout = 'pill',
}) => {
  const isSelectionVariant = variant === 'selection'
  const isMenuLayout = layout === 'menu'
  const showLabels = isMenuLayout
  const containerClassName = isMenuLayout
    ? 'flex flex-col items-stretch bg-neutral-100/90 dark:bg-neutral-900/90 backdrop-blur-xl border border-neutral-200/70 dark:border-white/[0.08] rounded-2xl p-1 gap-1 shadow-[0_12px_14px_-10px_rgba(0,0,0,0.2)] dark:shadow-[0_12px_12px_-1px_rgba(0,0,0,0.55)]'
    : 'inline-flex items-center bg-neutral-100/80 dark:bg-neutral-900/80 backdrop-blur-xl border border-neutral-200/50 dark:border-white/[0.08] rounded-full p-0 gap-0.5 shadow-[0_10px_14px_-10px_rgba(0,0,0,0.15)] dark:shadow-[0_3px_4px_-1px_rgba(0,0,0,0.5)]'
  const baseButtonClassName = isMenuLayout
    ? 'flex items-center gap-2 px-3 py-2 rounded-xl bg-transparent border-none cursor-pointer transition-all duration-200'
    : 'p-2 rounded-full bg-transparent border-none cursor-pointer transition-all duration-200'

  return (
    <div
      className={`${containerClassName} transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
        isVisible
          ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
          : 'opacity-0 translate-y-2 scale-[0.98] pointer-events-none'
      }`}
    >
      {/* Model ID Badge */}
      {modelName && !isEditing && !isSelectionVariant && (
        <div
          className={`font-mono text-[10px] text-neutral-500 dark:text-neutral-400 tracking-wider uppercase ${
            isMenuLayout ? 'px-3 py-2' : 'px-3'
          } ${
            isMenuLayout
              ? 'border-b border-neutral-200 dark:border-white/[0.08]'
              : 'border-r border-neutral-200 dark:border-white/[0.08]'
          }`}
        >
          {(() => {
            const displayName = modelName.includes('/') ? modelName.split('/').pop() || modelName : modelName
            return displayName.length > 20 ? displayName.slice(0, 20) + '...' : displayName
          })()}
        </div>
      )}

      {isEditing ? (
        <>
          <button
            onClick={editMode === 'branch' ? onSaveBranch : onSave}
            className='p-2 rounded-full bg-transparent border-none cursor-pointer text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-green-500 transition-all duration-200'
            title={editMode === 'branch' ? 'Create branch' : 'Save changes'}
          >
            <svg className='w-[15px] h-[15px]' strokeWidth='1.8' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M5 13l4 4L19 7' />
            </svg>
          </button>
          <button
            onClick={onCancel}
            className='p-2 rounded-full bg-transparent border-none cursor-pointer text-neutral-500 dark:text-neutral-400 hover:bg-red-500/10 hover:text-red-400 transition-all duration-200'
            title='Cancel editing'
          >
            <svg className='w-[15px] h-[15px]' strokeWidth='1.8' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' d='M6 18L18 6M6 6l12 12' />
            </svg>
          </button>
        </>
      ) : (
        <>
          {isSelectionVariant ? (
            <>
              {onCopySelection && (
                <button
                  onClick={onCopySelection}
                  className={`${baseButtonClassName} ${
                    copied
                      ? 'text-green-500'
                      : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-neutral-800 dark:hover:text-neutral-200'
                  }`}
                  title={copied ? 'Copied' : 'Copy selection'}
                >
                  {copied ? (
                    <svg
                      className='w-[15px] h-[15px]'
                      strokeWidth='1.8'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path strokeLinecap='round' strokeLinejoin='round' d='M5 13l4 4L19 7' />
                    </svg>
                  ) : (
                    <svg
                      className='w-[15px] h-[15px]'
                      strokeWidth='1.8'
                      fill='none'
                      stroke='currentColor'
                      viewBox='0 0 24 24'
                    >
                      <path d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z' />
                    </svg>
                  )}
                  {showLabels && <span className='text-sm'>Copy selection</span>}
                </button>
              )}

              {onExplainSelection && (
                <button
                  onClick={event => onExplainSelection({ x: event.clientX, y: event.clientY })}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-blue-500`}
                  title='Explain selection'
                >
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path strokeLinecap='round' strokeLinejoin='round' d='M12 21a9 9 0 100-18 9 9 0 000 18z' />
                    <path strokeLinecap='round' strokeLinejoin='round' d='M9.5 9a2.5 2.5 0 115 0c0 2-2.5 2-2.5 4' />
                    <path strokeLinecap='round' strokeLinejoin='round' d='M12 17h.01' />
                  </svg>
                  {showLabels && <span className='text-sm'>Explain selection</span>}
                </button>
              )}

              {onAddToNoteSelection && (
                <button
                  onClick={onAddToNoteSelection}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-amber-500`}
                  title='Add selection to note'
                >
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      d='M7 3h7l5 5v13a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2z'
                    />
                    <path strokeLinecap='round' strokeLinejoin='round' d='M14 3v6h6' />
                    <path strokeLinecap='round' strokeLinejoin='round' d='M8 13h8M8 17h5' />
                  </svg>
                  {showLabels && <span className='text-sm'>Add to note</span>}
                </button>
              )}
            </>
          ) : (
            <>
              {/* Copy Button */}
              <button
                onClick={onCopy}
                className={`${baseButtonClassName} ${
                  copied
                    ? 'text-green-500'
                    : 'text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
                title={copied ? 'Copied' : 'Copy Content'}
              >
                {copied ? (
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path strokeLinecap='round' strokeLinejoin='round' d='M5 13l4 4L19 7' />
                  </svg>
                ) : (
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path d='M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z' />
                  </svg>
                )}
                {showLabels && <span className='text-sm'>Copy</span>}
              </button>

              {/* Edit Button */}
              {onEdit && (
                <button
                  onClick={onEdit}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-neutral-800 dark:hover:text-neutral-200`}
                  title='Edit Prompt'
                >
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path d='M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z' />
                  </svg>
                  {showLabels && <span className='text-sm'>Edit</span>}
                </button>
              )}

              {/* Branch Button */}
              {onBranch && (
                <button
                  onClick={onBranch}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-green-500`}
                  title='Branch message'
                >
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      d='M6 4v8a4 4 0 004 4h4M6 8a2 2 0 100-4 2 2 0 000 4zm8 8a2 2 0 100-4 2 2 0 000 4z'
                    />
                  </svg>
                  {showLabels && <span className='text-sm'>Branch</span>}
                </button>
              )}

              {/* Regenerate Button - currently hidden per user request */}
              {/* {onResend && (
                <button
                  onClick={onResend}
                  className='p-2 rounded-full bg-transparent border-none cursor-pointer text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-blue-500 transition-all duration-200'
                  title='Regenerate Response'
                >
                  <svg className='w-[15px] h-[15px]' strokeWidth='1.8' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
                    <path d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' />
                  </svg>
                </button>
              )} */}

              {/* Delete Button */}
              {onDelete && (
                <button
                  onClick={onDelete}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-red-500/10 hover:text-red-400`}
                  title='Delete'
                >
                  <svg
                    className='w-[15px] h-[15px]'
                    strokeWidth='1.8'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path d='M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' />
                  </svg>
                  {showLabels && <span className='text-sm'>Delete</span>}
                </button>
              )}

              {/* More Options Button */}
              {onMore && (
                <button
                  onClick={onMore}
                  className={`${baseButtonClassName} text-neutral-500 dark:text-neutral-400 hover:bg-white/50 dark:hover:bg-white/5 hover:text-neutral-800 dark:hover:text-neutral-200`}
                  title='More options'
                >
                  <i className='bx bx-dots-vertical-rounded text-[15px]'></i>
                  {showLabels && <span className='text-sm'>More</span>}
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

// Configuration for collapsed content display
const COLLAPSED_CONTENT_WORD_LIMIT = 15
const PROCESS_RUN_GROUP_MIN_ITEMS = 4

type ProcessEntryType = 'tool' | 'reasoning'

interface MessageRenderItem {
  key: string
  kind: 'process' | 'other'
  processType?: ProcessEntryType
  node: React.ReactNode
}

// Helper function to convert contentBlocks to editable text
const contentBlocksToEditableText = (blocks: ContentBlock[] | undefined): string => {
  if (!blocks || blocks.length === 0) return ''

  return blocks
    .sort((a, b) => a.index - b.index)
    .map(block => {
      if (block.type === 'text') {
        return block.content
      } else if (block.type === 'thinking') {
        return `[THINKING]\n${block.content}\n[/THINKING]`
      } else if (block.type === 'tool_use') {
        return `[TOOL_USE: ${block.name}]\n${JSON.stringify(block.input, null, 2)}\n[/TOOL_USE]`
      } else if (block.type === 'tool_result') {
        const resultContent = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2)
        return `[TOOL_RESULT]\n${resultContent}\n[/TOOL_RESULT]`
      }
      return ''
    })
    .join('\n\n')
}

// Helper function to convert edited text back to contentBlocks
// Robust parser that handles malformed input gracefully
const editableTextToContentBlocks = (text: string): ContentBlock[] => {
  if (!text || !text.trim()) {
    return []
  }

  const blocks: ContentBlock[] = []
  let currentIndex = 0

  // Regex patterns for block detection - non-greedy and careful matching
  const thinkingPattern = /\[THINKING\]([\s\S]*?)\[\/THINKING\]/g
  const toolUsePattern = /\[TOOL_USE:\s*([^\]]+)\]([\s\S]*?)\[\/TOOL_USE\]/g
  const toolResultPattern = /\[TOOL_RESULT\]([\s\S]*?)\[\/TOOL_RESULT\]/g

  // Find all potential blocks with their positions
  interface PotentialBlock {
    type: 'thinking' | 'tool_use' | 'tool_result'
    start: number
    end: number
    content: string
    name?: string
  }

  const potentialBlocks: PotentialBlock[] = []

  // Detect THINKING blocks
  let match
  thinkingPattern.lastIndex = 0
  while ((match = thinkingPattern.exec(text)) !== null) {
    potentialBlocks.push({
      type: 'thinking',
      start: match.index,
      end: match.index + match[0].length,
      content: match[1].trim(),
    })
  }

  // Detect TOOL_USE blocks
  toolUsePattern.lastIndex = 0
  while ((match = toolUsePattern.exec(text)) !== null) {
    const toolName = match[1].trim()
    const toolInput = match[2].trim()

    // Validate JSON - if invalid, skip this block (treat as plain text)
    try {
      JSON.parse(toolInput)
      potentialBlocks.push({
        type: 'tool_use',
        start: match.index,
        end: match.index + match[0].length,
        name: toolName,
        content: toolInput,
      })
    } catch (e) {
      // Invalid JSON - skip this block, will be treated as plain text later
    }
  }

  // Detect TOOL_RESULT blocks
  toolResultPattern.lastIndex = 0
  while ((match = toolResultPattern.exec(text)) !== null) {
    potentialBlocks.push({
      type: 'tool_result',
      start: match.index,
      end: match.index + match[0].length,
      content: match[1].trim(),
    })
  }

  // Sort blocks by position
  potentialBlocks.sort((a, b) => a.start - b.start)

  // Check for overlapping blocks (nested/malformed tags) - skip overlapping ones
  const validBlocks: PotentialBlock[] = []
  for (const block of potentialBlocks) {
    let overlaps = false

    for (const validBlock of validBlocks) {
      // Check if blocks overlap
      if (block.start < validBlock.end && block.end > validBlock.start) {
        overlaps = true
        break
      }
    }

    if (!overlaps) {
      validBlocks.push(block)
    }
  }

  // Build final content blocks
  let position = 0

  for (const block of validBlocks) {
    // Add plain text before this block
    if (block.start > position) {
      const plainText = text.substring(position, block.start).trim()
      if (plainText) {
        blocks.push({
          type: 'text',
          index: currentIndex++,
          content: plainText,
        })
      }
    }

    // Add the structured block
    if (block.type === 'thinking') {
      blocks.push({
        type: 'thinking',
        index: currentIndex++,
        content: block.content,
      })
    } else if (block.type === 'tool_use' && block.name) {
      try {
        blocks.push({
          type: 'tool_use',
          index: currentIndex++,
          id: `tool_${Date.now()}_${currentIndex}`,
          name: block.name,
          input: JSON.parse(block.content),
        })
      } catch (e) {
        // Shouldn't happen due to earlier validation, but as fallback treat as text
        const textContent = text.substring(block.start, block.end)
        blocks.push({
          type: 'text',
          index: currentIndex++,
          content: textContent,
        })
      }
    } else if (block.type === 'tool_result') {
      // Try to parse content as JSON, otherwise use as string
      let resultContent: any
      try {
        resultContent = JSON.parse(block.content)
      } catch (e) {
        resultContent = block.content
      }

      blocks.push({
        type: 'tool_result',
        index: currentIndex++,
        tool_use_id: 'unknown_tool',
        content: resultContent,
        is_error: false,
      })
    }

    position = block.end
  }

  // Add remaining plain text
  if (position < text.length) {
    const plainText = text.substring(position).trim()
    if (plainText) {
      blocks.push({
        type: 'text',
        index: currentIndex++,
        content: plainText,
      })
    }
  }

  // If no blocks were created, return everything as plain text
  if (blocks.length === 0) {
    const trimmedText = text.trim()
    if (trimmedText) {
      return [
        {
          type: 'text',
          index: 0,
          content: trimmedText,
        },
      ]
    }
    return []
  }

  return blocks
}

interface ToolCallRenderGroup {
  id: string
  name?: string
  args?: Record<string, any> | null
  results: Array<{ content: any; is_error?: boolean }>
  anchorIndex: number
}

const buildToolCallGroupsFromStream = (events?: StreamEvent[]) => {
  if (!events || events.length === 0) return new Map<number, ToolCallRenderGroup>()

  const groupsById = new Map<string, ToolCallRenderGroup>()
  const mapByIndex = new Map<number, ToolCallRenderGroup>()

  events.forEach((event, idx) => {
    if (event.type === 'tool_call' && event.toolCall) {
      const id = event.toolCall.id
      if (!groupsById.has(id)) {
        // New tool_call - create fresh group
        groupsById.set(id, {
          id,
          name: event.toolCall.name,
          args: event.toolCall.arguments,
          results: [],
          anchorIndex: idx,
        })
      } else {
        // Group already exists (created by orphaned result arriving first)
        // Update it with the tool_call metadata
        const existingGroup = groupsById.get(id)!
        existingGroup.name = event.toolCall.name
        existingGroup.args = event.toolCall.arguments
        existingGroup.anchorIndex = idx // Set anchor to tool_call position
      }
      // Map this index to the group (for deduplication)
      mapByIndex.set(idx, groupsById.get(id)!)
    } else if (event.type === 'tool_result' && event.toolResult) {
      const target = groupsById.get(event.toolResult.tool_use_id)
      if (target) {
        // Normal case: tool_call already exists
        target.results.push({ content: event.toolResult.content, is_error: event.toolResult.is_error })
        // Always map result index to group (for skip logic in render)
        mapByIndex.set(idx, target)
      } else {
        // Orphaned result (arrives before its tool_call)
        // Create temporary group with special anchor marker
        const orphanedGroup: ToolCallRenderGroup = {
          id: event.toolResult.tool_use_id,
          name: undefined, // Will be set when tool_call arrives
          args: null, // Will be set when tool_call arrives
          results: [{ content: event.toolResult.content, is_error: event.toolResult.is_error }],
          anchorIndex: -1, // -1 = "don't render yet"
        }
        groupsById.set(event.toolResult.tool_use_id, orphanedGroup)
        // Map result index to orphaned group (so it gets skipped in render loop)
        mapByIndex.set(idx, orphanedGroup)
      }
    }
  })

  return mapByIndex
}

const buildToolCallGroupsFromBlocks = (blocks?: ContentBlock[]) => {
  if (!blocks || blocks.length === 0) return new Map<number, ToolCallRenderGroup>()

  const groupsById = new Map<string, ToolCallRenderGroup>()
  const mapByIndex = new Map<number, ToolCallRenderGroup>()

  blocks.forEach((block, idx) => {
    if (block.type === 'tool_use') {
      const id = block.id || `tool-${idx}`
      if (!groupsById.has(id)) {
        const group: ToolCallRenderGroup = {
          id,
          name: block.name,
          args: block.input,
          results: [],
          anchorIndex: idx,
        }
        groupsById.set(id, group)
        mapByIndex.set(idx, group)
      }
    } else if (block.type === 'tool_result') {
      const id = block.tool_use_id || `tool-result-${idx}`
      const target = groupsById.get(id)
      if (target) {
        target.results.push({ content: block.content, is_error: block.is_error })
      } else {
        const fallback: ToolCallRenderGroup = {
          id,
          name: 'Tool Result',
          args: null,
          results: [{ content: block.content, is_error: block.is_error }],
          anchorIndex: idx,
        }
        mapByIndex.set(idx, fallback)
      }
    }
  })

  return mapByIndex
}

const formatToolResultContent = (content: any) => {
  if (typeof content === 'string') return content
  if (content == null) return ''
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

const formatToolResultSummary = (content: any): string | null => {
  try {
    const data = typeof content === 'string' ? JSON.parse(content) : content
    if (!data || typeof data !== 'object' || !('success' in data)) return null
    return data.success ? 'success' : 'failure'
  } catch {
    return null
  }
}

interface TodoItem {
  text: string
  done: boolean
}

const TODO_ITEM_REGEX = /^\s*[-*]\s*\[(x|X| )\]\s*(.*)$/

const parseTodoListFromMarkdown = (content?: string): TodoItem[] => {
  if (!content) return []
  const items: TodoItem[] = []
  const lines = content.split('\n')
  for (const line of lines) {
    const match = TODO_ITEM_REGEX.exec(line)
    if (match) {
      items.push({
        done: match[1].toLowerCase() === 'x',
        text: match[2].trim(),
      })
    }
  }
  return items
}

const extractTodoTitleFromMarkdown = (content?: string): string | null => {
  if (!content) return null
  const match = content.match(/^#+\s*(.+)$/m)
  if (match) {
    return match[1].trim()
  }
  return null
}

const getTodoContentForAction = (group: ToolCallRenderGroup, action: string): string | null => {
  const normalizedAction = action.toLowerCase()
  // For 'create' action, content is in the input args
  if (normalizedAction === 'create') {
    if (typeof group.args?.content === 'string' && group.args.content.trim().length > 0) {
      return group.args.content
    }
  }

  // For 'read' action, content is in the result
  if (group.results.length > 0) {
    let primary = group.results[0].content

    // If primary is a JSON string, try to parse it
    if (typeof primary === 'string') {
      try {
        const parsed = JSON.parse(primary)
        if (typeof parsed === 'object' && parsed !== null && 'content' in parsed) {
          return parsed.content
        }
      } catch {
        // Not JSON, might be raw markdown content - return as is
        return primary
      }
    }

    // Handle object result with content property (from readTodoList)
    if (typeof primary === 'object' && primary !== null && 'content' in primary) {
      return (primary as any).content
    }

    return formatToolResultContent(primary)
  }

  return null
}

const TODO_TOOL_ACTIONS_WITH_CARD = new Set(['read', 'create'])

const isTodoListGroup = (group: ToolCallRenderGroup): boolean => {
  const action = typeof group.args?.action === 'string' ? group.args.action.toLowerCase() : ''
  return (group.name ?? '').toLowerCase() === 'todo_list' && TODO_TOOL_ACTIONS_WITH_CARD.has(action)
}

const todoActionLabel = (action: string) => {
  const normalized = action.toLowerCase()
  switch (normalized) {
    case 'read':
      return 'Current Todo List'
    case 'create':
      return 'New Todo List'
    default:
      return 'Todo List'
  }
}

const parseMcpQualifiedName = (qualifiedName: string) => {
  const match = qualifiedName.match(/^mcp__([^_]+)__(.+)$/)
  if (!match) return null
  return { serverName: match[1], toolName: match[2] }
}

// Component to render HTML in an iframe using srcdoc for packaged Electron compatibility
// Uses shared iframeBridge for consistent IPC support across Tool Manager and Inline Chat
const HtmlIframe: React.FC<{ html: string; fullHeight?: boolean; toolName?: string | null }> = ({
  html,
  fullHeight = false,
  toolName = null,
}) => {
  const { userId } = useAuth()
  const userIdRef = useRef<string | null>(null)
  const toolNameRef = useRef<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    userIdRef.current = userId ?? null
  }, [userId])

  useEffect(() => {
    toolNameRef.current = toolName ?? null
  }, [toolName])

  useEffect(() => {
    const cleanup = attachMessageBridge(
      () => iframeRef.current,
      () => userIdRef.current,
      () => ({ toolName: toolNameRef.current })
    )
    return cleanup
  }, [])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={html}
      className={fullHeight ? 'w-full h-full bg-white' : 'w-full min-h-[800px] rounded-lg bg-white'}
      style={{ border: 'none' }}
      title='HTML Preview'
      allow='fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      allowFullScreen
      referrerPolicy='strict-origin-when-cross-origin'
      sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-presentation'
    />
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
    streamEvents,
    // timestamp,
    onEdit,
    onBranch,
    onDelete,
    onCopy,
    onResend: _onResend,
    onAddToNote: _onAddToNote,
    onExplainFromSelection,
    onOpenToolHtmlModal,
    isEditing = false,
    width = 'w-3/5',
    colored = true,
    modelName,
    className,
    artifacts = [],
    showInlineActions = true,
    fontSizeOffset = 0,
    groupToolReasoningRuns = false,
    onEditingStateChange,
  }) => {
    const dispatch = useAppDispatch()
    const isMobile = useIsMobile()
    const [editingState, setEditingState] = useState(isEditing)
    const [editContent, setEditContent] = useState(content)
    const [editMode, setEditMode] = useState<'edit' | 'branch'>('edit')
    const [copied, setCopied] = useState(false)
    // Toggle visibility of the reasoning/thinking block
    const [showThinking, setShowThinking] = useState(false)
    // Track expanded/collapsed state for tool calls, tool results, and reasoning blocks
    const [expandedBlocks, setExpandedBlocks] = useState<{
      toolCalls: Set<string>
      toolResults: Set<string>
      reasoning: Set<number>
      groupRuns: Set<string>
    }>({
      toolCalls: new Set(),
      toolResults: new Set(),
      reasoning: new Set(),
      groupRuns: new Set(),
    })
    // More menu states
    const [showMoreMenu, setShowMoreMenu] = useState(false)
    const [showMoreInfo, setShowMoreInfo] = useState(false)
    const [menuOpenUp, setMenuOpenUp] = useState(false)
    const moreMenuRef = useRef<HTMLDivElement | null>(null)
    // Hover state for message actions visibility (fixes web mode hover detection)
    const [isHovering, setIsHovering] = useState(false)
    const moreButtonRef = useRef<HTMLDivElement | null>(null)
    const messageRef = useRef<HTMLDivElement | null>(null)

    const handleMobileMessageActivate = useCallback(() => {
      if (!isMobile) return
      setIsHovering(true)
    }, [isMobile])
    // Context menu states (floating MessageActions)
    const [contextMenuOpen, setContextMenuOpen] = useState(false)
    const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
    const [selectedText, setSelectedText] = useState<string>('')
    const floatingActionsRef = useRef<HTMLDivElement | null>(null)
    const [selectedArtifactUrl, setSelectedArtifactUrl] = useState<string | null>(null)
    // Explain input states
    const streamToolGroupsByIndex = useMemo(() => buildToolCallGroupsFromStream(streamEvents), [streamEvents])
    const contentToolGroupsByIndex = useMemo(() => buildToolCallGroupsFromBlocks(contentBlocks), [contentBlocks])
    const htmlRegistry = useHtmlIframeRegistry()
    const [showExplainInput, setShowExplainInput] = useState(false)
    const [explainInputValue, setExplainInputValue] = useState('')
    const explainInputPosition = useRef<{ x: number; y: number } | null>(null)
    const explainInputRef = useRef<HTMLDivElement | null>(null)
    const [mcpLoadState, setMcpLoadState] = useState<Record<string, boolean>>({})
    const [mcpReloadTokens, setMcpReloadTokens] = useState<Record<string, number>>({})
    // Get message data from Redux store
    const messageData = useSelector((state: RootState) =>
      state.chat.conversation.messages.find(m => String(m.id) === String(id))
    )
    const toolDefinitions = useSelector((state: RootState) => state.chat.tools)
    const conversationId = messageData?.conversation_id ?? null
    const projectId = useSelector((state: RootState) => {
      if (!conversationId) return null
      return state.conversations.items.find(conv => conv.id === conversationId)?.project_id ?? null
    })

    const handleLoadMcpApp = useCallback(
      async (serverName: string, reloadKey: string) => {
        if (environment !== 'electron') return
        setMcpLoadState(prev => ({ ...prev, [reloadKey]: true }))
        try {
          await localApi.post(`/mcp/servers/${encodeURIComponent(serverName)}/start`)
          await localApi.post('/mcp/refresh-tools')
          dispatch(fetchMcpTools())
          setMcpReloadTokens(prev => ({ ...prev, [reloadKey]: (prev[reloadKey] || 0) + 1 }))
        } catch (err) {
          console.error('[McpApp] Failed to load server', err)
        } finally {
          setMcpLoadState(prev => ({ ...prev, [reloadKey]: false }))
        }
      },
      [dispatch]
    )

    const hasContent = useMemo(() => {
      const hasSimpleContent = content && content.trim().length > 0
      const hasBlockContent =
        contentBlocks &&
        contentBlocks.some(b => (b.type === 'text' && b.content && b.content.trim().length > 0) || b.type === 'image')

      return hasSimpleContent || hasBlockContent
    }, [content, contentBlocks])

    const handleEdit = () => {
      dispatch(chatSliceActions.editingBranchSet(false))
      setEditingState(true)
      // Use contentBlocks if available, otherwise use simple content
      setEditContent(contentBlocks && contentBlocks.length > 0 ? contentBlocksToEditableText(contentBlocks) : content)
      setEditMode('edit')
      onEditingStateChange?.(id, true, 'edit')
    }

    const handleBranch = () => {
      dispatch(chatSliceActions.editingBranchSet(true))
      setEditingState(true)
      // Use contentBlocks if available, otherwise use simple content
      setEditContent(contentBlocks && contentBlocks.length > 0 ? contentBlocksToEditableText(contentBlocks) : content)
      setEditMode('branch')
      onEditingStateChange?.(id, true, 'branch')
    }

    const handleSave = () => {
      const trimmedContent = editContent.trim()

      // Prevent saving empty messages
      if (!trimmedContent) {
        console.warn('Cannot save empty message')
        return
      }

      if (onEdit && trimmedContent !== content) {
        // Convert edited text back to contentBlocks if original had contentBlocks
        const newContentBlocks =
          contentBlocks && contentBlocks.length > 0 ? editableTextToContentBlocks(trimmedContent) : undefined
        onEdit(id, trimmedContent, newContentBlocks)
      }
      dispatch(chatSliceActions.editingBranchSet(false))
      setEditingState(false)
      onEditingStateChange?.(id, false, 'edit')
    }

    const handleSaveBranch = () => {
      if (onBranch) {
        // Convert edited text back to contentBlocks if original had contentBlocks
        const newContentBlocks =
          contentBlocks && contentBlocks.length > 0 ? editableTextToContentBlocks(editContent.trim()) : undefined
        onBranch(id, editContent.trim(), newContentBlocks)
      }
      dispatch(chatSliceActions.editingBranchSet(false))
      // Clear any image drafts after branching is initiated
      dispatch(chatSliceActions.imageDraftsCleared())
      setEditingState(false)
      onEditingStateChange?.(id, false, 'branch')
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
      onEditingStateChange?.(id, false, editMode)
      setEditMode('edit')
    }

    const handleCopy = async () => {
      // Check for image block first
      const imageBlock = contentBlocks?.find(b => b.type === 'image')

      if (imageBlock && imageBlock.type === 'image' && imageBlock.url) {
        try {
          // Fetch image as blob to ensure download (avoids cross-origin issues with download attribute)
          const response = await fetch(imageBlock.url)
          const blob = await response.blob()
          const blobUrl = window.URL.createObjectURL(blob)

          const link = document.createElement('a')
          link.href = blobUrl

          // Determine filename
          let extension = 'png'
          if (imageBlock.mimeType) {
            const mimeParts = imageBlock.mimeType.split('/')
            if (mimeParts.length > 1) {
              extension = mimeParts[1]
            }
          } else if (blob.type) {
            const parts = blob.type.split('/')
            if (parts.length > 1) {
              extension = parts[1]
            }
          }

          const filename = `generated-image-${Date.now()}.${extension}`
          link.download = filename

          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          window.URL.revokeObjectURL(blobUrl)

          // Show copied feedback
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
          return
        } catch (err) {
          console.error('Failed to download image:', err)
          // Fallback to direct link if fetch fails
          try {
            window.open(imageBlock.url, '_blank')
          } catch (e) {
            console.error('Failed to open fallback link', e)
          }
        }
      }

      if (onCopy) {
        onCopy(content)
      }

      // Get rendered HTML from the message element for rich paste support
      let html: string | undefined
      const messageEl = document.getElementById(`message-${id}`)
      if (messageEl) {
        // Find the prose content div which contains the rendered markdown
        const proseEl = messageEl.querySelector('.prose')
        if (proseEl) {
          html = proseEl.innerHTML
        }
      }

      const ok = await copyRichText(content, html)
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

    const handleDeleteArtifact = (index: number) => {
      dispatch(chatSliceActions.messageArtifactDeleted({ messageId: id, index }))
    }

    const handleArtifactClick = (url: string) => {
      setSelectedArtifactUrl(url)
    }

    const handleCloseArtifactModal = () => {
      setSelectedArtifactUrl(null)
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault() // Always prevent default

      // Get selected text
      const selection = window.getSelection()
      const rawText = selection?.toString() || ''
      const container = messageRef.current
      const anchorNode = selection?.anchorNode ?? null
      const focusNode = selection?.focusNode ?? null
      const selectionInsideMessage =
        Boolean(rawText) &&
        Boolean(container) &&
        Boolean((anchorNode && container?.contains(anchorNode)) || (focusNode && container?.contains(focusNode)))
      const text = selectionInsideMessage ? rawText.trim() : ''

      // Store selected text for potential use
      setSelectedText(text)
      // Show floating MessageActions at click position
      setContextMenuPosition({ x: e.clientX, y: e.clientY })
      setContextMenuOpen(true)
      explainInputPosition.current = { x: e.clientX, y: e.clientY }
    }

    const handleSendExplainInput = () => {
      if (onExplainFromSelection && selectedText && explainInputValue.trim()) {
        // Combine user's custom question with the selected text
        const branchContent = `${explainInputValue.trim()}\n\nSelected text:\n\`\`\`\n${selectedText}\n\`\`\``
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

    const handleCopySelection = async () => {
      if (!selectedText) return
      const ok = await copyRichText(selectedText)
      if (ok) {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      } else {
        console.error('Failed to copy selection')
      }
    }

    const handleExplainSelection = (position?: { x: number; y: number }) => {
      if (!selectedText || !onExplainFromSelection) return
      if (position) {
        explainInputPosition.current = { ...position }
      } else if (contextMenuPosition) {
        explainInputPosition.current = { ...contextMenuPosition }
      }
      setExplainInputValue('')
      setShowExplainInput(true)
    }

    const handleAddSelectionToNote = () => {
      if (!selectedText || !_onAddToNote) return
      _onAddToNote(selectedText)
    }

    // Get adjusted position for explain input to avoid viewport overflow
    const getAdjustedExplainInputPosition = () => {
      if (!explainInputPosition.current || !explainInputRef.current) return explainInputPosition.current

      const inputRect = explainInputRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const offset = 12

      // On mobile, center the input in the viewport
      if (isMobile) {
        return {
          x: (viewportWidth - inputRect.width) / 2,
          y: (viewportHeight - inputRect.height) / 2,
        }
      }

      // On desktop, position near the cursor but adjust to avoid viewport overflow
      let { x, y } = explainInputPosition.current
      x = x - inputRect.width / 2

      // Adjust horizontal position
      if (x + inputRect.width > viewportWidth) {
        x = viewportWidth - inputRect.width - 10
      }
      if (x < 10) {
        x = 10
      }

      // Prefer showing above the click position; fall back below if needed
      const aboveY = y - inputRect.height - offset
      const belowY = y + offset
      if (aboveY >= 10) {
        y = aboveY
      } else if (belowY + inputRect.height <= viewportHeight - 10) {
        y = belowY
      } else {
        y = Math.max(10, viewportHeight - inputRect.height - 10)
      }

      return { x: Math.max(10, x), y: Math.max(10, y) }
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

    // Focus explain textarea without scrolling the virtual list
    useEffect(() => {
      if (!showExplainInput) return
      const focusTimer = window.setTimeout(() => {
        const textarea = explainInputRef.current?.querySelector('textarea') as HTMLTextAreaElement | null
        if (!textarea) return
        try {
          textarea.focus({ preventScroll: true })
        } catch {
          textarea.focus()
        }
      }, 0)

      return () => {
        window.clearTimeout(focusTimer)
      }
    }, [showExplainInput])

    // Close More menu when context menu opens to avoid conflicts
    useEffect(() => {
      if (contextMenuOpen) {
        setShowMoreMenu(false)
        setShowMoreInfo(false)
      }
    }, [contextMenuOpen])

    // Click outside handler for floating MessageActions
    const closeFloatingActions = useCallback(() => setContextMenuOpen(false), [])
    useEffect(() => {
      if (!contextMenuOpen) return

      const handleClickOutside = (event: MouseEvent) => {
        if (floatingActionsRef.current && !floatingActionsRef.current.contains(event.target as Node)) {
          closeFloatingActions()
        }
      }

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          closeFloatingActions()
        }
      }

      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)

      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
        document.removeEventListener('keydown', handleEscape)
      }
    }, [contextMenuOpen, closeFloatingActions])

    // Mobile: hide inline actions when tapping outside the message
    useEffect(() => {
      if (!isMobile) return

      const handleTapOutside = (event: MouseEvent | TouchEvent) => {
        if (messageRef.current && !messageRef.current.contains(event.target as Node)) {
          setIsHovering(false)
        }
      }

      document.addEventListener('mousedown', handleTapOutside)
      document.addEventListener('touchstart', handleTapOutside)

      return () => {
        document.removeEventListener('mousedown', handleTapOutside)
        document.removeEventListener('touchstart', handleTapOutside)
      }
    }, [isMobile])

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

    const copyRichText = async (plainText: string, html?: string) => {
      // Try copying both HTML and plain text for rich paste support (Word, etc.)
      try {
        if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && html) {
          const htmlBlob = new Blob([html], { type: 'text/html' })
          const textBlob = new Blob([plainText], { type: 'text/plain' })
          const clipboardItem = new ClipboardItem({
            'text/html': htmlBlob,
            'text/plain': textBlob,
          })
          await navigator.clipboard.write([clipboardItem])
          return true
        }
      } catch (_) {
        // Fall through to plain text copy
      }

      // Fallback to plain text copy
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(plainText)
          return true
        }
      } catch (_) {
        // fall through to execCommand fallback
      }

      // Fallback for non-secure contexts or older browsers
      try {
        const textarea = document.createElement('textarea')
        textarea.value = plainText
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
              ? 'bg-gray-800 border-l-0 border-l-yellow-500 dark:border-l-yPurple-400 bg-neutral-50 dark:bg-neutral-900'
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
              className='absolute top-2 right-2 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity duration-150 text-slate-900 dark:text-white dark:hover:bg-neutral-700'
              size='smaller'
              variant='outline2'
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          }
          <pre
            ref={preRef}
            className={`not-prose thin-scrollbar pb-10 overflow-auto rounded-2xl ring-0 outline-none bg-gray-100 text-[0.8em] text-gray-900 dark:bg-neutral-900 dark:text-neutral-100 p-3 dark:border-1 dark:border-neutral-700 shadow-[0px_0px_6px_0px_rgba(0,0,0,0.15)]  dark:shadow-[0px_0px_16px_2px_rgba(0,0,0,0.45)] [will-change:contents] [transform:translateZ(0)]`}
            {...props}
          >
            {children}
          </pre>
        </div>
      )
    }

    // Toggle function for collapsible blocks
    const toggleBlock = (type: 'toolCalls' | 'toolResults' | 'reasoning' | 'groupRuns', id: string | number) => {
      setExpandedBlocks(prev => {
        const newState = { ...prev }
        const currentSet = prev[type]
        const set = new Set([...Array.from(currentSet as any)])
        if (set.has(id as any)) {
          set.delete(id as any)
        } else {
          set.add(id as any)
        }
        newState[type] = set as any
        return newState
      })
    }

    // Extract path-like parameters from tool arguments
    const extractPathParam = (args: any): string | null => {
      if (!args || typeof args !== 'object') return null
      const pathKeys = ['file_path', 'path', 'directory', 'dir', 'output_path', 'input_path', 'filepath']
      for (const key of pathKeys) {
        if (args[key] && typeof args[key] === 'string') {
          return args[key]
        }
      }
      return null
    }

    // Truncate content to first N words
    const truncateWords = (text: string | any, maxWords: number = COLLAPSED_CONTENT_WORD_LIMIT): string => {
      const content = typeof text === 'object' ? JSON.stringify(text) : String(text)
      const words = content.split(/\s+/)
      if (words.length <= maxWords) return content
      return words.slice(0, maxWords).join(' ') + '...'
    }

    const extractHtmlFromToolResult = (content: any): { html: string; toolName?: string | null } | null => {
      if (!content) return null

      let resolved = content
      if (typeof resolved === 'string') {
        try {
          resolved = JSON.parse(resolved)
        } catch {
          return null
        }
      }
      if (typeof resolved === 'object' && resolved !== null && 'html' in resolved) {
        return {
          html: (resolved as any).html,
          toolName: (resolved as any).toolName ?? (resolved as any).tool_name ?? null,
        }
      }

      if (
        typeof resolved === 'object' &&
        resolved !== null &&
        (resolved as any).type === 'text/html' &&
        typeof (resolved as any).content === 'string'
      ) {
        return {
          html: (resolved as any).content,
          toolName: (resolved as any).toolName ?? (resolved as any).tool_name ?? null,
        }
      }
      return null
    }

    // Build a lookup map of HTML entries for on-demand registration.
    // Entries are NOT auto-registered - only when user clicks "Open Viewer" or expands.
    // This prevents polluting the registry with every tool found on the page.
    const htmlRegistryEntriesMap = useMemo(() => {
      const entriesMap = new Map<string, { key: string; html: string; label: string; toolName?: string | null }>()

      // Skip if we're in streaming mode - only available after message is persisted
      if (Array.isArray(streamEvents) && streamEvents.length > 0) {
        return entriesMap
      }

      const normalizeHtml = (html: string) => html.trim()
      const addEntry = (key: string, html: string, label: string, toolName?: string | null) => {
        if (typeof html !== 'string') return
        const normalized = normalizeHtml(html)
        if (normalized.length > 0) {
          entriesMap.set(key, { key, html: normalized, label, toolName: toolName ?? null })
        }
      }

      const groupsSource = Array.isArray(contentBlocks) && contentBlocks.length > 0 ? contentToolGroupsByIndex : null

      if (groupsSource) {
        const seen = new Set<string>()
        groupsSource.forEach(group => {
          if (seen.has(group.id)) return
          seen.add(group.id)

          const htmlSeen = new Set<string>()
          // Format label: replace underscores with spaces and title case
          const rawName = group.name || 'Tool Result'
          const toolLabel = rawName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          const toolName = group.name ?? null
          const isHtmlRenderer = (group.name ?? '').toLowerCase() === 'html_renderer'
          if (isHtmlRenderer && typeof group.args?.html === 'string') {
            const normalized = normalizeHtml(group.args.html)
            if (normalized.length > 0) {
              htmlSeen.add(normalized)
              addEntry(`${id}-html-renderer-${group.id}`, normalized, toolLabel, toolName)
            }
          }

          group.results.forEach((result, resultIdx) => {
            const maybeHtml = extractHtmlFromToolResult(result.content)
            if (maybeHtml?.html) {
              const normalized = normalizeHtml(maybeHtml.html)
              if (normalized.length === 0 || htmlSeen.has(normalized)) {
                return
              }
              htmlSeen.add(normalized)
              addEntry(`${id}-${group.id}-result-${resultIdx}`, normalized, toolLabel, maybeHtml.toolName ?? toolName)
            }
          })
        })
      }

      return entriesMap
    }, [contentBlocks, contentToolGroupsByIndex, id, streamEvents])

    // Register an HTML entry on-demand (when user clicks "Open Viewer")
    const registerAndOpenHtmlViewer = (entryKey: string) => {
      if (!htmlRegistry || !onOpenToolHtmlModal) return

      // Find the entry in our map and register it before opening
      const entry = htmlRegistryEntriesMap.get(entryKey)
      if (entry) {
        htmlRegistry.registerEntry(entry.key, entry.html, entry.label, {
          conversationId,
          projectId,
          toolName: entry.toolName ?? null,
        })
      }

      // Open the modal
      onOpenToolHtmlModal(entryKey)
    }

    const renderHtmlViewerButton = (entryKey: string) => (
      <Button
        variant='outline2'
        size='small'
        onClick={() => registerAndOpenHtmlViewer(entryKey)}
        disabled={!onOpenToolHtmlModal}
        title='Open tool output viewer'
      >
        <i className='bx bx-window-open text-base' aria-hidden='true'></i>
        <span className='ml-1'>Open Viewer</span>
      </Button>
    )

    const registerAndOpenMcpViewer = (
      entryKey: string,
      payload: {
        serverName: string
        resourceUri: string
        qualifiedToolName: string
        toolArgs?: Record<string, any> | null
        toolResult?: { content: any; is_error?: boolean } | null
        toolDefinition?: ToolDefinition
        reloadToken?: number
      },
      label?: string | null
    ) => {
      if (!htmlRegistry || !onOpenToolHtmlModal) return
      htmlRegistry.registerMcpEntry(entryKey, payload, label, { conversationId, projectId })
      onOpenToolHtmlModal(entryKey)
    }

    const renderMcpViewerButton = (
      entryKey: string,
      payload: {
        serverName: string
        resourceUri: string
        qualifiedToolName: string
        toolArgs?: Record<string, any> | null
        toolResult?: { content: any; is_error?: boolean } | null
        toolDefinition?: ToolDefinition
        reloadToken?: number
      },
      label?: string | null
    ) => (
      <Button
        variant='outline2'
        size='small'
        onClick={() => registerAndOpenMcpViewer(entryKey, payload, label)}
        disabled={!onOpenToolHtmlModal}
        title='Open MCP app viewer'
      >
        <i className='bx bx-fullscreen text-base' aria-hidden='true'></i>
        <span className='ml-1'>Fullscreen</span>
      </Button>
    )

    // Handle expand click - also registers HTML entries when expanding (not collapsing)
    const handleExpandToggle = (toggleKey: string, group: ToolCallRenderGroup) => {
      const isCurrentlyExpanded = expandedBlocks.toolCalls.has(toggleKey)

      // If we're expanding (not currently expanded), register any HTML entries
      if (!isCurrentlyExpanded && htmlRegistry) {
        // Check for html_renderer tool
        const isHtmlRenderer = (group.name ?? '').toLowerCase() === 'html_renderer'
        if (isHtmlRenderer && typeof group.args?.html === 'string') {
          const entryKey = `${id}-html-renderer-${group.id}`
          const entry = htmlRegistryEntriesMap.get(entryKey)
          if (entry) {
            htmlRegistry.registerEntry(entry.key, entry.html, entry.label, {
              conversationId,
              projectId,
              toolName: entry.toolName ?? null,
            })
          }
        }

        // Register HTML results
        group.results.forEach((result, resultIdx) => {
          const maybeHtml = extractHtmlFromToolResult(result.content)
          if (maybeHtml?.html) {
            const entryKey = `${id}-${group.id}-result-${resultIdx}`
            const entry = htmlRegistryEntriesMap.get(entryKey)
            if (entry) {
              htmlRegistry.registerEntry(entry.key, entry.html, entry.label, {
                conversationId,
                projectId,
                toolName: entry.toolName ?? null,
              })
            }
          }
        })
      }

      // Toggle the expansion state
      toggleBlock('toolCalls', toggleKey)
    }

    const renderToolCallGroupCard = (group: ToolCallRenderGroup, key: string) => {
      // Don't render orphaned groups (results waiting for their tool_call)
      if (group.anchorIndex === -1) {
        return null
      }

      const toggleKey = `tool-group-${key}`

      if (isTodoListGroup(group)) {
        return (
          <TodoListView
            key={toggleKey}
            group={group}
            toggleState={expandedBlocks.toolCalls}
            toggleFn={toggleBlock}
            keySuffix={toggleKey}
          />
        )
      }

      const isExpanded = expandedBlocks.toolCalls.has(toggleKey)
      const isMcpGroup = (group.name ?? '').startsWith('mcp__')
      const parsedMcp = isMcpGroup ? parseMcpQualifiedName(group.name ?? '') : null
      const mcpServerName = parsedMcp?.serverName

      // Special handling for html_renderer tool - always show rendered HTML
      const isHtmlRenderer = (group.name ?? '').toLowerCase() === 'html_renderer'
      const extractedHtml = (() => {
        if (!isHtmlRenderer) return null
        // Use the INPUT html directly (group.args.html) - it has the full CSS
        // The tool result gets processed and loses styling
        if (group.args && typeof group.args.html === 'string') {
          return group.args.html
        }
        return null
      })()
      const hasHtmlOutput =
        (isHtmlRenderer && typeof extractedHtml === 'string') ||
        group.results.some(result => Boolean(extractHtmlFromToolResult(result.content)?.html))

      // Render html_renderer tool with always-visible HTML
      if (isHtmlRenderer && typeof extractedHtml === 'string') {
        const htmlPreviewKey = `${id}-html-renderer-${group.id}`
        return (
          <div key={toggleKey} className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'>
            {/* Green pip indicator */}
            <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' />

            {/* Tool header */}
            <div className='flex items-center gap-2 mb-2'>
              <span className='font-mono text-xs bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'>
                {group.name || 'html_renderer'}
              </span>
              {renderHtmlViewerButton(htmlPreviewKey)}
            </div>

            {/* Always show HTML output */}
            <div className='mt-2'>
              <HtmlIframe html={extractedHtml} toolName={group.name ?? null} />
            </div>
          </div>
        )
      }

      const mcpTool = toolDefinitions.find(t => t.isMcp && t.name === group.name)
      const mcpResourceUri = mcpTool?.mcpUi?.resourceUri
      if (mcpTool && mcpResourceUri) {
        const parsed = parseMcpQualifiedName(group.name ?? '')
        const serverName = mcpTool.mcpServerName || parsed?.serverName
        if (serverName) {
          const latestResult = group.results.length > 0 ? group.results[group.results.length - 1] : null
          const normalizedResult = latestResult
            ? { content: latestResult.content, is_error: latestResult.is_error }
            : null
          const reloadKey = `${id}-${group.id}-mcp`
          const mcpEntryKey = `${id}-${group.id}-mcp-app`
          const rawLabel = mcpTool.mcpToolName || parsed?.toolName || group.name || 'MCP App'
          const mcpLabel = rawLabel.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
          const mcpViewerPayload = {
            serverName,
            resourceUri: mcpResourceUri,
            qualifiedToolName: mcpTool.name,
            toolArgs: group.args || undefined,
            toolResult: normalizedResult,
            toolDefinition: mcpTool,
            reloadToken: mcpReloadTokens[reloadKey] || 0,
          }
          return (
            <div
              key={toggleKey}
              className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'
            >
              <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' />
              <div className='flex items-center gap-2 mb-2 flex-wrap'>
                <span className='font-mono text-xs bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'>
                  {group.name || 'mcp_app'}
                </span>
                <span className='text-[10px] uppercase tracking-[0.15em] text-emerald-600 dark:text-emerald-400'>
                  MCP App
                </span>
                <div className='ml-auto flex items-center gap-2'>
                  {renderMcpViewerButton(mcpEntryKey, mcpViewerPayload, mcpLabel)}
                  <button
                    type='button'
                    onClick={() => handleLoadMcpApp(serverName, reloadKey)}
                    disabled={mcpLoadState[reloadKey]}
                    className='flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-60'
                  >
                    <i
                      className={`bx ${mcpLoadState[reloadKey] ? 'bx-loader-circle animate-spin' : 'bx-play-circle'}`}
                    />
                    Load app
                  </button>
                </div>
              </div>
              <div className='mt-2'>
                <McpAppIframe
                  serverName={serverName}
                  qualifiedToolName={mcpTool.name}
                  resourceUri={mcpResourceUri}
                  toolArgs={group.args || undefined}
                  toolResult={normalizedResult}
                  toolDefinition={mcpTool}
                  reloadToken={mcpReloadTokens[reloadKey] || 0}
                  className='w-full min-h-[600px] rounded-lg bg-white'
                />
              </div>
            </div>
          )
        }
      }

      const pathParam = extractPathParam(group.args)
      const resultSummary = group.results.length > 0 ? formatToolResultSummary(group.results[0].content) : null
      const pathContent = pathParam || null
      const htmlResultKeys = group.results
        .map((result, resultIdx) =>
          extractHtmlFromToolResult(result.content)?.html ? `${id}-${group.id}-result-${resultIdx}` : null
        )
        .filter((key): key is string => Boolean(key))
      const primaryHtmlResultKey = htmlResultKeys[0]

      // Check for failure: either structured failure response OR is_error flag on any result
      const hasResults = group.results.length > 0
      const hasError = group.results.some(r => r.is_error) || resultSummary === 'failure'
      // Special handling for edit_file tool - render EditFileDiffView
      const isEditFileTool = (group.name ?? '').toLowerCase() === 'edit_file'
      const isReplaceOperation = group.args?.searchPattern || group.args?.replacement
      const isAppendOperation = (group.args?.operation ?? '').toLowerCase() === 'append' && group.args?.content
      if (isEditFileTool && group.args && (isReplaceOperation || isAppendOperation)) {
        const editResult = group.results.length > 0 ? group.results[0].content : {}
        return (
          <div key={toggleKey} className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'>
            {/* Status pip indicator */}
            <div
              className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${
                hasResults && hasError
                  ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]'
                  : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
              }`}
            />
            {/* Tool header */}
            <div className='flex items-center gap-2 mb-3'>
              <span className='font-mono text-xs bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'>
                {group.name || 'edit_file'}
              </span>
            </div>
            {/* EditFileDiffView */}
            <EditFileDiffView
              args={{
                path: group.args.path,
                operation: group.args.operation,
                searchPattern: group.args.searchPattern,
                replacement: group.args.replacement,
                content: group.args.content,
                validateContent: group.args.validateContent,
              }}
              result={editResult}
            />
          </div>
        )
      }

      return (
        <div key={toggleKey} className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'>
          {/* Status pip indicator - green for success/executing, red for error */}
          <div
            className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${
              hasResults && hasError
                ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]'
                : 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]'
            }`}
          />

          {/* Tool header row */}
          <div className='flex items-center gap-2 flex-wrap'>
            <button
              onClick={() => handleExpandToggle(toggleKey, group)}
              className='flex items-center gap-2 group/tool hover:opacity-80 transition-opacity cursor-pointer outline-none'
            >
              <span className='font-mono text-xs bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 group-hover/tool:border-neutral-400 dark:group-hover/tool:border-neutral-600 transition-colors'>
                {group.name || 'tool'}
              </span>
              {/* Status indicator when collapsed */}
              {/* {!isExpanded && resultSummary && (
                <span
                  className={`text-[10px] ${resultSummary === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}
                >
                  {resultSummary}
                </span>
              )} */}
              {!isExpanded && !resultSummary && (
                <span className='inline-flex items-center text-neutral-400 dark:text-neutral-500'>
                  <i className='bx bx-dots-horizontal-rounded text-sm animate-pulse' />
                </span>
              )}
              {!isExpanded && pathContent && (
                <span
                  className='text-[10px] text-neutral-500 dark:text-neutral-500 max-w-[200px] overflow-hidden whitespace-nowrap'
                  style={{ direction: 'rtl', textOverflow: 'ellipsis' }}
                >
                  {pathContent}
                </span>
              )}
              <svg
                className={`tool-chevron w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 group-hover/tool:text-neutral-500 dark:group-hover/tool:text-neutral-400 ${isExpanded ? 'open' : ''}`}
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
              </svg>
            </button>
            {isMcpGroup && mcpServerName && (
              <button
                type='button'
                onClick={() => handleLoadMcpApp(mcpServerName, `${id}-${group.id}-mcp`)}
                disabled={mcpLoadState[`${id}-${group.id}-mcp`]}
                className='ml-auto flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-60'
              >
                <i
                  className={`bx ${
                    mcpLoadState[`${id}-${group.id}-mcp`] ? 'bx-loader-circle animate-spin' : 'bx-play-circle'
                  }`}
                />
                Load app
              </button>
            )}
            {primaryHtmlResultKey && renderHtmlViewerButton(primaryHtmlResultKey)}
          </div>

          {/* Expandable content */}
          <div className={`tool-expand-container ${isExpanded ? 'open' : ''}`}>
            <div className='tool-expand-content pt-3'>
              {/* Tool inputs */}
              {!hasHtmlOutput && group.args && Object.keys(group.args).length > 0 && (
                <div className='border-l-2 border-neutral-300/50 dark:border-neutral-700/50 pl-4 py-1 mb-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-500 leading-relaxed'>
                  {Object.entries(group.args).map(([argKey, value]) => (
                    <div key={argKey} className='break-all'>
                      <span className='text-neutral-400 dark:text-neutral-600'>{argKey}:</span>{' '}
                      <span className='text-neutral-600 dark:text-neutral-400'>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Tool results */}
              {group.results.length > 0 && (
                <div className='space-y-2'>
                  {group.results.map((result, resultIdx) => {
                    const resultKey = `${id}-${group.id}-result-${resultIdx}`
                    const maybeHtml = extractHtmlFromToolResult(result.content)

                    if (maybeHtml?.html) {
                      return (
                        <HtmlIframe
                          key={resultKey}
                          html={maybeHtml.html}
                          toolName={maybeHtml.toolName ?? group.name ?? null}
                        />
                      )
                    }

                    const renderedContent = formatToolResultContent(result.content)
                    return (
                      <div
                        key={resultKey}
                        className={`border-l-2 pl-4 py-1 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words ${
                          result.is_error
                            ? 'border-red-400/50 dark:border-red-600/50 text-red-600 dark:text-red-400'
                            : 'border-neutral-300/50 dark:border-neutral-700/50 text-neutral-500 dark:text-neutral-500'
                        }`}
                      >
                        {renderedContent}
                        {!result.is_error && (
                          <span className='text-neutral-400 dark:text-neutral-600 italic mt-1 block text-[10px] tracking-tight'>
                            completed
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )
    }

    // Style object for text content areas that should scale with fontSizeOffset
    const textContentStyle: React.CSSProperties | undefined =
      fontSizeOffset !== 0 ? { fontSize: `calc(1em + ${fontSizeOffset}px)` } : undefined
    const hasSelection = selectedText.length > 0

    const contextHighlightClass = contextMenuOpen ? 'bg-neutral-200/60 dark:bg-orange-900/10' : ''

    const isHiddenStreamSeparator = (event: StreamEvent, index: number): boolean => {
      const groupedTool = streamToolGroupsByIndex.get(index)

      // Tool events that are not rendered (deduped by anchor) should not split text/reasoning groups.
      if (groupedTool && groupedTool.anchorIndex !== index) return true

      // Empty deltas create invisible events; they should not split groups either.
      if ((event.type === 'text' || event.type === 'reasoning') && !event.delta) return true

      return false
    }

    const getPreviousVisibleStreamType = (index: number): StreamEvent['type'] | null => {
      if (!Array.isArray(streamEvents) || streamEvents.length === 0) return null

      for (let i = index - 1; i >= 0; i--) {
        const prevEvent = streamEvents[i]
        if (!prevEvent) continue
        if (isHiddenStreamSeparator(prevEvent, i)) continue
        return prevEvent.type
      }

      return null
    }

    const buildReasoningRenderItem = (reasoningText: string, reasoningId: number, key: string): MessageRenderItem => {
      const isExpanded = expandedBlocks.reasoning.has(reasoningId)
      const reasoningSummary = truncateWords(reasoningText)

      return {
        key,
        kind: 'process',
        processType: 'reasoning',
        node: (
          <div key={key} className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'>
            <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]' />

            <button
              onClick={() => toggleBlock('reasoning', reasoningId)}
              className='flex items-center gap-2 group/reason hover:opacity-80 transition-opacity cursor-pointer outline-none'
            >
              <span className='text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500 font-bold'>
                Reasoning
              </span>
              {!isExpanded && reasoningSummary && (
                <span className='text-xs text-neutral-500 dark:text-neutral-500 line-clamp-1 max-w-[300px]'>
                  {reasoningSummary}
                </span>
              )}
              <svg
                className={`tool-chevron w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 group-hover/reason:text-neutral-500 dark:group-hover/reason:text-neutral-400 ${isExpanded ? 'open' : ''}`}
                fill='none'
                viewBox='0 0 24 24'
                stroke='currentColor'
              >
                <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
              </svg>
            </button>

            <div className={`tool-expand-container ${isExpanded ? 'open' : ''}`}>
              <div className='tool-expand-content pt-2'>
                <div
                  className='text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed prose max-w-none dark:prose-invert'
                  style={textContentStyle}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], rehypeKatex]}
                    components={{ pre: PreRenderer, a: MarkdownLink }}
                  >
                    {reasoningText}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        ),
      }
    }

    const renderItemsWithOptionalProcessGrouping = (items: MessageRenderItem[], sourceKey: string): React.ReactNode[] => {
      if (!groupToolReasoningRuns) {
        return items.map(item => item.node)
      }

      const rendered: React.ReactNode[] = []
      let index = 0

      while (index < items.length) {
        const current = items[index]

        if (current.kind !== 'process') {
          rendered.push(current.node)
          index += 1
          continue
        }

        let runEnd = index
        while (runEnd < items.length && items[runEnd].kind === 'process') {
          runEnd += 1
        }

        const runItems = items.slice(index, runEnd)

        if (runItems.length >= PROCESS_RUN_GROUP_MIN_ITEMS) {
          const groupKey = `process-run-${sourceKey}-${runItems[0].key}-${runItems[runItems.length - 1].key}`
          const isExpanded = expandedBlocks.groupRuns.has(groupKey)
          const toolCount = runItems.filter(item => item.processType === 'tool').length
          const reasoningCount = runItems.filter(item => item.processType === 'reasoning').length
          const summaryParts: string[] = []
          if (toolCount > 0) summaryParts.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`)
          if (reasoningCount > 0) summaryParts.push(`${reasoningCount} reasoning`)

          rendered.push(
            <div key={groupKey} className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'>
              <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.35)]' />
              <button
                onClick={() => toggleBlock('groupRuns', groupKey)}
                className='flex items-center gap-2 group/run hover:opacity-80 transition-opacity cursor-pointer outline-none'
              >
                <span className='text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500 font-bold'>
                  Agent Steps ({runItems.length})
                </span>
                {!isExpanded && summaryParts.length > 0 && (
                  <span className='text-xs text-neutral-500 dark:text-neutral-500 line-clamp-1 max-w-[300px]'>
                    {summaryParts.join(' • ')}
                  </span>
                )}
                <svg
                  className={`tool-chevron w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 group-hover/run:text-neutral-500 dark:group-hover/run:text-neutral-400 ${isExpanded ? 'open' : ''}`}
                  fill='none'
                  viewBox='0 0 24 24'
                  stroke='currentColor'
                >
                  <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                </svg>
              </button>
              <div className={`tool-expand-container ${isExpanded ? 'open' : ''}`}>
                <div className='tool-expand-content pt-2'>{runItems.map(item => item.node)}</div>
              </div>
            </div>
          )
        } else {
          rendered.push(...runItems.map(item => item.node))
        }

        index = runEnd
      }

      return rendered
    }

    const buildStreamRenderItems = (): MessageRenderItem[] => {
      if (!Array.isArray(streamEvents) || streamEvents.length === 0) return []

      const items: MessageRenderItem[] = []
      let idx = 0

      while (idx < streamEvents.length) {
        const event = streamEvents[idx]
        if (!event) {
          idx += 1
          continue
        }

        const groupedTool = streamToolGroupsByIndex.get(idx)
        if (groupedTool) {
          if (groupedTool.anchorIndex === idx) {
            const toolKey = `stream-${groupedTool.id}-${idx}`
            const toolNode = renderToolCallGroupCard(groupedTool, toolKey)
            if (toolNode) {
              items.push({
                key: `stream-tool-${groupedTool.id}-${idx}`,
                kind: 'process',
                processType: 'tool',
                node: toolNode,
              })
            }
          }
          idx += 1
          continue
        }

        if (event.type === 'text') {
          let accumulatedText = event.delta || ''
          let nextIdx = idx + 1
          while (nextIdx < streamEvents.length) {
            const nextEvent = streamEvents[nextIdx]
            if (nextEvent?.type === 'text' && nextEvent.delta) {
              accumulatedText += nextEvent.delta
              nextIdx += 1
            } else {
              break
            }
          }

          if (accumulatedText) {
            const textKey = `text-${idx}`
            items.push({
              key: textKey,
              kind: 'other',
              node: (
                <div
                  key={textKey}
                  className='prose max-w-none dark:prose-invert w-full text-[16px] sm:text-[16px] 2xl:text-[20px] 3xl:text-[21px]'
                  style={textContentStyle}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], rehypeKatex]}
                    components={{ pre: PreRenderer, a: MarkdownLink }}
                  >
                    {accumulatedText}
                  </ReactMarkdown>
                </div>
              ),
            })
          }

          idx = nextIdx
          continue
        }

        if (event.type === 'reasoning' && event.delta) {
          if (getPreviousVisibleStreamType(idx) === 'reasoning') {
            idx += 1
            continue
          }

          let accumulatedReasoning = event.delta || ''
          let nextIdx = idx + 1
          while (nextIdx < streamEvents.length) {
            const nextEvent = streamEvents[nextIdx]
            if (nextEvent?.type === 'reasoning' && nextEvent.delta) {
              accumulatedReasoning += nextEvent.delta
              nextIdx += 1
            } else if (nextEvent && isHiddenStreamSeparator(nextEvent, nextIdx)) {
              nextIdx += 1
            } else {
              break
            }
          }

          items.push(buildReasoningRenderItem(accumulatedReasoning, idx, `reasoning-${idx}`))
          idx = nextIdx
          continue
        }

        if (event.type === 'tool_call' && event.toolCall && event.complete) {
          const toolCall = event.toolCall
          const toggleKey = `tool-call-${toolCall.id}-${idx}`
          const isExpanded = expandedBlocks.toolCalls.has(toggleKey)
          const pathParam = extractPathParam(toolCall.arguments)
          const isHtmlToolCall = (toolCall.name ?? '').toLowerCase() === 'html_renderer'
          const hasHtmlOutput = isHtmlToolCall || Boolean(extractHtmlFromToolResult(toolCall.result)?.html)

          items.push({
            key: `tool-${toolCall.id}-${idx}`,
            kind: 'process',
            processType: 'tool',
            node: (
              <div
                key={`tool-${toolCall.id}-${idx}`}
                className='relative pl-6 pb-4 ml-2 border-l border-neutral-300 dark:border-neutral-700'
              >
                <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' />

                <button
                  onClick={() => toggleBlock('toolCalls', toggleKey)}
                  className='flex items-center gap-2 group/tool hover:opacity-80 transition-opacity cursor-pointer outline-none'
                >
                  <span className='font-mono text-xs bg-neutral-100 dark:bg-neutral-900 px-1.5 py-0.5 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 group-hover/tool:border-neutral-400 dark:group-hover/tool:border-neutral-600 transition-colors'>
                    {toolCall.name || 'tool'}
                  </span>
                  {!isExpanded && pathParam && (
                    <span
                      className='text-[10px] text-neutral-500 dark:text-neutral-500 max-w-[200px] overflow-hidden whitespace-nowrap'
                      style={{ direction: 'rtl', textOverflow: 'ellipsis' }}
                    >
                      {pathParam}
                    </span>
                  )}
                  <svg
                    className={`tool-chevron w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 group-hover/tool:text-neutral-500 dark:group-hover/tool:text-neutral-400 ${isExpanded ? 'open' : ''}`}
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                  >
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                  </svg>
                </button>

                <div className={`tool-expand-container ${isExpanded ? 'open' : ''}`}>
                  <div className='tool-expand-content pt-3'>
                    {!hasHtmlOutput && toolCall.arguments && Object.keys(toolCall.arguments).length > 0 && (
                      <div className='border-l-2 border-neutral-300/50 dark:border-neutral-700/50 pl-4 py-1 mb-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-500 leading-relaxed'>
                        {Object.entries(toolCall.arguments).map(([key, value]) => (
                          <div key={key} className='break-all'>
                            <span className='text-neutral-400 dark:text-neutral-600'>{key}:</span>{' '}
                            <span className='text-neutral-600 dark:text-neutral-400'>
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {toolCall.result && (
                      <div className='border-l-2 border-neutral-300/50 dark:border-neutral-700/50 pl-4 py-1 font-mono text-[11px] text-neutral-500 dark:text-neutral-500 leading-relaxed whitespace-pre-wrap break-words'>
                        {toolCall.result}
                        <span className='text-neutral-400 dark:text-neutral-600 italic mt-1 block text-[10px] tracking-tight'>
                          completed
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ),
          })
          idx += 1
          continue
        }

        if (event.type === 'image' && event.url) {
          const imageKey = `image-${idx}`
          items.push({
            key: imageKey,
            kind: 'other',
            node: (
              <div key={imageKey} className='my-3 mx-1'>
                <img
                  src={event.url}
                  alt='Generated image'
                  className='max-w-full max-h-96 object-contain rounded-lg shadow-md'
                  loading='lazy'
                />
              </div>
            ),
          })
        }

        idx += 1
      }

      return items
    }

    const buildContentBlockRenderItems = (): MessageRenderItem[] => {
      if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) return []

      const items: MessageRenderItem[] = []
      let idx = 0

      while (idx < contentBlocks.length) {
        const block = contentBlocks[idx]
        if (!block) {
          idx += 1
          continue
        }

        const groupedTool = contentToolGroupsByIndex.get(idx)
        if (groupedTool) {
          const toolKey = `block-${groupedTool.id}-${idx}`
          const toolNode = renderToolCallGroupCard(groupedTool, toolKey)
          if (toolNode) {
            items.push({
              key: `block-tool-${groupedTool.id}-${idx}`,
              kind: 'process',
              processType: 'tool',
              node: toolNode,
            })
          }
          idx += 1
          continue
        }

        if (block.type === 'text') {
          const textKey = `text-${block.index}-${idx}`
          items.push({
            key: textKey,
            kind: 'other',
            node: (
              <div
                key={textKey}
                className='prose sm:px-1 max-w-none dark:prose-invert w-full text-[16px] sm:text-[16px] 2xl:text-[20px] 3xl:text-[21px] mt-2'
                style={textContentStyle}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], rehypeKatex]}
                  components={{ pre: PreRenderer, a: MarkdownLink }}
                >
                  {block.content}
                </ReactMarkdown>
              </div>
            ),
          })
          idx += 1
          continue
        }

        if (block.type === 'thinking') {
          let prevIdx = idx - 1
          while (prevIdx >= 0 && contentBlocks[prevIdx]?.type === 'reasoning_details') {
            prevIdx -= 1
          }
          if (prevIdx >= 0 && contentBlocks[prevIdx]?.type === 'thinking') {
            idx += 1
            continue
          }

          let accumulatedThinking = block.content || ''
          let nextIdx = idx + 1
          while (nextIdx < contentBlocks.length) {
            const nextBlock = contentBlocks[nextIdx]
            if (!nextBlock) {
              nextIdx += 1
              continue
            }
            if (nextBlock.type === 'thinking') {
              accumulatedThinking += nextBlock.content || ''
              nextIdx += 1
            } else if (nextBlock.type === 'reasoning_details') {
              nextIdx += 1
            } else {
              break
            }
          }

          items.push(buildReasoningRenderItem(accumulatedThinking, block.index, `thinking-${block.index}-${idx}`))
          idx = nextIdx
          continue
        }

        if (block.type === 'reasoning_details') {
          idx += 1
          continue
        }

        if (block.type === 'image' && block.url) {
          const imageKey = `image-${block.index}-${idx}`
          items.push({
            key: imageKey,
            kind: 'other',
            node: (
              <div key={imageKey} className='my-3 mx-1'>
                <img
                  src={block.url}
                  alt='Generated image'
                  className='max-w-full max-h-96 object-contain rounded-lg shadow-md'
                  onClick={() => handleArtifactClick(block.url)}
                  loading='lazy'
                />
              </div>
            ),
          })
          idx += 1
          continue
        }

        idx += 1
      }

      return items
    }

    const streamRenderedNodes =
      !editingState && Array.isArray(streamEvents) && streamEvents.length > 0
        ? renderItemsWithOptionalProcessGrouping(buildStreamRenderItems(), `stream-${id}`)
        : null

    const contentBlockRenderedNodes =
      !editingState && Array.isArray(contentBlocks) && contentBlocks.length > 0
        ? renderItemsWithOptionalProcessGrouping(buildContentBlockRenderItems(), `blocks-${id}`)
        : null

    return (
      <div
        id={`message-${id}`}
        ref={messageRef}
        className={`group px-0 sm:px-2 md:px-2 mb-0 sm:mb-0 md:mb-0 ${styles.container} ${contextHighlightClass} ${width} transition-[background-color,opacity] duration-200 rounded-md hover:bg-opacity-80 ${className ?? ''}`}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={handleMobileMessageActivate}
        onTouchStart={handleMobileMessageActivate}
      >
        {/* Header with role */}
        {role === 'user' && (
          <div className='inline-flex mt-8 items-center gap-2 py-[3px] px-2.5 bg-white/[0.03] border border-white/[0.08] rounded-md mb-3 backdrop-blur cursor-default transition-all duration-200'>
            <div className='w-1 h-1 rounded-full bg-neutral-500 shadow-[0_0_8px_rgba(115,115,115,0.4)]'></div>
            <span className='font-mono text-[11px] uppercase tracking-[0.1em] text-neutral-500'>{styles.roleText}</span>
          </div>
        )}

        {/* Prioritize rendering: streamEvents > contentBlocks > legacy fields */}
        {/* Sequential streaming events - render in order as received */}
        {!editingState && Array.isArray(streamEvents) && streamEvents.length > 0 ? (
          <div className='space-y-0 mb-3'>{streamRenderedNodes}</div>
        ) : !editingState && Array.isArray(contentBlocks) && contentBlocks.length > 0 ? (
          <div className='space-y-0 mb-0'>{contentBlockRenderedNodes}</div>
        ) : (
          <>
            {/* Fallback: render tool calls and reasoning separately if no streamEvents or contentBlocks */}
            {Array.isArray(toolCalls) && toolCalls.length > 0 && (
              <div className='space-y-0 mb-3'>
                {toolCalls.map((toolCall, idx) =>
                  renderToolCallGroupCard(
                    {
                      id: toolCall.id,
                      name: toolCall.name,
                      args: toolCall.arguments,
                      results: toolCall.result
                        ? [{ content: toolCall.result, is_error: toolCall.status === 'executing' && false }]
                        : [],
                      anchorIndex: idx,
                    },
                    `legacy-${toolCall.id}-${idx}`
                  )
                )}
              </div>
            )}

            {/* Reasoning / thinking block */}
            {typeof thinking === 'string' && thinking.trim().length > 0 && (
              <div className='relative pl-6 pb-4 ml-2 mb-2 border-l border-neutral-300 dark:border-neutral-700'>
                {/* Blue pip indicator for reasoning */}
                <div className='absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]' />

                {/* Reasoning header */}
                <button
                  onClick={() => setShowThinking(s => !s)}
                  className='flex items-center gap-2 group/reason hover:opacity-80 transition-opacity cursor-pointer outline-none'
                  aria-expanded={showThinking}
                  aria-controls={`reasoning-content-${id}`}
                >
                  <span className='text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-500 font-bold'>
                    Reasoning
                  </span>
                  {!showThinking && (
                    <span className='text-xs text-neutral-500 dark:text-neutral-500 line-clamp-1 max-w-[300px]'>
                      {truncateWords(thinking)}
                    </span>
                  )}
                  <svg
                    className={`tool-chevron w-3.5 h-3.5 text-neutral-400 dark:text-neutral-600 group-hover/reason:text-neutral-500 dark:group-hover/reason:text-neutral-400 ${showThinking ? 'open' : ''}`}
                    fill='none'
                    viewBox='0 0 24 24'
                    stroke='currentColor'
                  >
                    <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M9 5l7 7-7 7' />
                  </svg>
                </button>

                {/* Expandable content */}
                <div className={`tool-expand-container ${showThinking ? 'open' : ''}`}>
                  <div className='tool-expand-content pt-2'>
                    <div
                      id={`reasoning-content-${id}`}
                      className='text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed prose max-w-none dark:prose-invert'
                      style={textContentStyle}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], rehypeKatex]}
                        components={{ pre: PreRenderer, a: MarkdownLink }}
                      >
                        {thinking}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Message content - show edit mode or normal display */}
        {editingState ? (
          <div className='px-4 w-full relative'>
            <TextArea
              value={editContent}
              onChange={setEditContent}
              placeholder='Edit your message...'
              minRows={2}
              maxRows={40}
              maxLength={20000}
              autoFocus
              width='w-full'
              onContextMenu={(e: React.MouseEvent<HTMLTextAreaElement>) => {
                // Always show default browser menu in TextArea, never the custom menu
                e.stopPropagation()
              }}
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
          </div>
        ) : (
          <>
            {/* Display mode - only show if no contentBlocks or streamEvents present (to avoid duplication) */}
            {(!contentBlocks || contentBlocks.length === 0) && (!streamEvents || streamEvents.length === 0) && (
              <div
                className='prose px-4 py-2 sm:px-1 max-w-none dark:prose-invert w-full text-[16px] md:text-[14px] lg:text-[14px] xl:text-[16px] 2xl:text-[20px] 3xl:text-[20px] 4xl:text-[20px]'
                style={textContentStyle}
              >
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[[rehypeHighlight, { ignoreMissing: true }], rehypeKatex]}
                  components={{ pre: PreRenderer, a: MarkdownLink }}
                >
                  {content}
                </ReactMarkdown>
              </div>
            )}
          </>
        )}
        {/* {hasContent && modelName && role !== 'user' && (
          <div className='mt-1 text-xs sm:text-sm 3xl:text-base text-stone-400 flex justify-end'>{modelName}</div>
        )} */}
        {/* Artifacts (images) */}
        {Array.isArray(artifacts) && artifacts.length > 0 && role !== 'assistant' && (
          <div className='mt-3 mb-3 space-y-2 flex flex-col items-end'>
            <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400'>
              Attachments
            </h3>
            <div className='flex flex-wrap gap-2 sm:gap-3 justify-end self-end'>
              {artifacts.map((dataUrl, idx) => (
                <div
                  key={`${id}-artifact-${idx}`}
                  className='relative rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 w-fit'
                >
                  <img
                    src={dataUrl}
                    alt={`attachment-${idx}`}
                    className='h-20 w-20 sm:h-20 md:h-20 lg:h-20 object-contain bg-neutral-100 dark:bg-neutral-800 cursor-pointer'
                    loading='lazy'
                    onClick={() => handleArtifactClick(dataUrl)}
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
          </div>
        )}
        {/* Actions row (at bottom) */}
        {hasContent && role === 'user' && showInlineActions && (
          <div className='flex items-center justify-end'>
            <div ref={moreButtonRef} className='relative'>
              <MessageActions
                onEdit={handleEdit}
                onBranch={handleBranch}
                onDelete={handleDelete}
                onCopy={handleCopy}
                onSave={handleSave}
                onSaveBranch={handleSaveBranch}
                onCancel={handleCancel}
                onMore={handleMoreClick}
                isEditing={editingState}
                editMode={editMode}
                copied={copied}
                modelName={modelName}
                isVisible={isHovering}
                variant='default'
              />
              {/* More menu dropdown */}
              {showMoreMenu && (
                <div
                  ref={moreMenuRef}
                  className={`absolute right-0 ${menuOpenUp ? 'bottom-full mb-1' : 'top-8'} z-20 w-64 sm:w-72 md:w-80 rounded-2xl bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 shadow-[0_0px_4px_3px_rgba(0,0,0,0.03)] dark:shadow-[0_1px_8px_2px_rgba(0,0,0,0.45)] [will-change:contents] [transform:translateZ(0)]`}
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
        )}

        {role === 'user' && (
          <div className='h-px w-full bg-gradient-to-r from-transparent via-orange-500/30 to-transparent mb-8'></div>
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

        {/* Floating MessageActions on Right-Click */}
        {contextMenuOpen &&
          contextMenuPosition &&
          createPortal(
            <AnimatePresence>
              <motion.div
                ref={floatingActionsRef}
                initial={{ opacity: 0, scale: 0.95, y: 5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 5 }}
                transition={{ duration: 0.15 }}
                className='fixed z-[100000]'
                style={{
                  left: `${contextMenuPosition.x}px`,
                  top: `${contextMenuPosition.y}px`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <MessageActions
                  onEdit={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleEdit()
                        }
                      : undefined
                  }
                  onBranch={
                    !hasSelection && role === 'user'
                      ? () => {
                          closeFloatingActions()
                          handleBranch()
                        }
                      : undefined
                  }
                  onDelete={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleDelete()
                        }
                      : undefined
                  }
                  onCopy={
                    !hasSelection
                      ? () => {
                          handleCopy()
                          // Don't close on copy to show feedback
                        }
                      : undefined
                  }
                  onCopySelection={
                    hasSelection
                      ? () => {
                          handleCopySelection()
                          // Don't close on copy to show feedback
                        }
                      : undefined
                  }
                  onExplainSelection={
                    hasSelection && onExplainFromSelection
                      ? (position?: { x: number; y: number }) => {
                          closeFloatingActions()
                          handleExplainSelection(position)
                        }
                      : undefined
                  }
                  onAddToNoteSelection={
                    hasSelection && _onAddToNote
                      ? () => {
                          closeFloatingActions()
                          handleAddSelectionToNote()
                        }
                      : undefined
                  }
                  onSave={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleSave()
                        }
                      : undefined
                  }
                  onSaveBranch={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleSaveBranch()
                        }
                      : undefined
                  }
                  onCancel={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleCancel()
                        }
                      : undefined
                  }
                  onMore={
                    !hasSelection
                      ? () => {
                          closeFloatingActions()
                          handleMoreClick()
                        }
                      : undefined
                  }
                  isEditing={editingState}
                  editMode={editMode}
                  copied={copied}
                  modelName={modelName}
                  isVisible={true}
                  variant={hasSelection ? 'selection' : 'default'}
                  layout='menu'
                />
              </motion.div>
            </AnimatePresence>,
            document.body
          )}

        {/* Floating Explain Input - use portal to escape transform container */}
        {showExplainInput &&
          explainInputPosition.current &&
          createPortal(
            <AnimatePresence>
              <motion.div
                ref={explainInputRef}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.15 }}
                className='fixed z-[100000] w-[320px] sm:w-[400px] rounded-lg bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 shadow-[0_4px_12px_rgba(0,0,0,0.15)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.5)] p-3 [will-change:contents] [transform:translateZ(0)]'
                style={{
                  left: `${getAdjustedExplainInputPosition()?.x || explainInputPosition.current.x}px`,
                  top: `${getAdjustedExplainInputPosition()?.y || explainInputPosition.current.y}px`,
                }}
              >
                {/* Display selected text */}
                <div className='mb-2 p-2 rounded-md bg-neutral-50 dark:bg-yBlack-800 border border-neutral-200 dark:border-neutral-700 max-h-[100px] overflow-y-auto'>
                  <div className='text-xs text-gray-600 dark:text-gray-400 italic line-clamp-4'>"{selectedText}"</div>
                </div>
                <TextArea
                  value={explainInputValue}
                  onChange={setExplainInputValue}
                  placeholder='Ask a question about the selected text...'
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
            </AnimatePresence>,
            document.body
          )}
        <ImageModal
          isOpen={Boolean(selectedArtifactUrl)}
          imageUrl={selectedArtifactUrl ?? ''}
          onClose={handleCloseArtifactModal}
        />
      </div>
    )
  }
)

const TodoListView: React.FC<{
  group: ToolCallRenderGroup
  toggleState: Set<string>
  toggleFn: (type: 'toolCalls' | 'toolResults' | 'reasoning' | 'groupRuns', id: string | number) => void
  keySuffix: string
}> = ({ group, toggleState, toggleFn, keySuffix }) => {
  const action = (group.args?.action as string | undefined)?.toLowerCase() || 'read'
  const actionLabel = todoActionLabel(action)
  const key = `todo-list-${keySuffix}`
  const isExpanded = toggleState.has(key)
  const summaryContent = getTodoContentForAction(group, action)
  const todoItems = parseTodoListFromMarkdown(summaryContent)
  const title = extractTodoTitleFromMarkdown(summaryContent)

  const handleToggle = () => {
    toggleFn('toolCalls', key)
  }

  return (
    <div
      key={key}
      className='todo-list-card relative mb-4 mx-3 rounded-xl border border-blue-200 bg-white/60 dark:border-yellow-700/40 dark:bg-yBlack-900 shadow-[0px_0px_5px_0px_rgba(0,0,0,0.08)] dark:shadow-[0px_0px_4px_0px_rgba(0,0,0,0.35)]'
    >
      <div className='flex items-center justify-between px-4 py-3'>
        <div>
          <p className='text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-200'>
            {actionLabel}
          </p>
          {title && <p className='text-xs text-blue-600 dark:text-blue-500'>{title}</p>}
        </div>
        <Button
          variant='outline2'
          size='small'
          onClick={handleToggle}
          title={isExpanded ? 'Hide todo list' : 'Show todo list'}
        >
          {isExpanded ? (
            <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M5 15l7-7 7 7' />
            </svg>
          ) : (
            <svg className='w-4 h-4' fill='none' stroke='currentColor' viewBox='0 0 24 24'>
              <path strokeLinecap='round' strokeLinejoin='round' strokeWidth={2} d='M19 9l-7 7-7-7' />
            </svg>
          )}
        </Button>
      </div>
      {isExpanded && (
        <div className='px-4 pb-4 space-y-2'>
          {todoItems.length === 0 ? (
            <p className='text-xs text-blue-700 dark:text-blue-200'>No todo items to display yet.</p>
          ) : (
            <ul className='space-y-2'>
              {todoItems.map((item, idx) => (
                <li
                  key={`todo-item-${idx}`}
                  className={`flex items-center gap-3 rounded-xl text-[12px] xl:text-[16px]  ${
                    item.done
                      ? ' bg-neutral-50/40 text-neutral-800 dark:bg-yBlack-900 dark:text-neutral-200'
                      : 'border-neutral-200 bg-white/70 text-neutral-800 dark:border-neutral-800 dark:bg-yBlack-900 dark:text-neutral-200'
                  }`}
                >
                  <span className='text-sm xl:text-[18px]'> {item.done ? '[✓]' : `[  \u00A0 ]`}</span>
                  <span className={`${item.done ? 'line-through opacity-80' : ''}`}>{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Display name for debugging
ChatMessage.displayName = 'ChatMessage'

export { ChatMessage }
