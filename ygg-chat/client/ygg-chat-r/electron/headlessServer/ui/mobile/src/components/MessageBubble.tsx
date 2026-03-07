import React, { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { MobileMessage } from '../types'
import { buildRenderItemsForMessage } from '../messageParser'
import { ReasoningCard } from './ReasoningCard'
import { ToolCallCard } from './ToolCallCard'

interface MessageBubbleProps {
  message: MobileMessage
  isStreaming?: boolean
  showUserActions?: boolean
  userActionsDisabled?: boolean
  isBranchTarget?: boolean
  onBranchUserMessage?: (message: MobileMessage) => void
  onDeleteUserMessage?: (message: MobileMessage) => void
}

const roleLabel = (role: string): string => {
  if (role === 'assistant') return 'Assistant'
  if (role === 'user') return 'You'
  if (role === 'tool') return 'Tool'
  return 'System'
}

export const MessageBubble: React.FC<MessageBubbleProps> = ({
  message,
  isStreaming = false,
  showUserActions = false,
  userActionsDisabled = false,
  isBranchTarget = false,
  onBranchUserMessage,
  onDeleteUserMessage,
}) => {
  const renderItems = useMemo(() => buildRenderItemsForMessage(message), [message])

  return (
    <article className={`mobile-message ${message.role}${isBranchTarget ? ' branch-target' : ''}`}>
      <header className='mobile-message-header'>
        <span className='mobile-message-role'>{roleLabel(message.role)}</span>
        {isStreaming ? <span className='mobile-streaming-badge'>streaming</span> : null}
      </header>

      <div className='mobile-message-body'>
        {renderItems.length === 0 ? <div className='mobile-empty-text'>(no content)</div> : null}

        {renderItems.map(item => {
          if (item.type === 'text') {
            return (
              <div key={item.key} className='mobile-message-text markdown-body'>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
              </div>
            )
          }

          if (item.type === 'reasoning') {
            return <ReasoningCard key={item.key} text={item.text} />
          }

          return <ToolCallCard key={item.key} group={item.group} defaultExpanded={false} />
        })}
      </div>

      {showUserActions && message.role === 'user' && !isStreaming ? (
        <footer className='mobile-message-actions'>
          <button type='button' onClick={() => onBranchUserMessage?.(message)} disabled={userActionsDisabled}>
            Branch
          </button>
          <button type='button' onClick={() => onDeleteUserMessage?.(message)} disabled={userActionsDisabled}>
            Delete
          </button>
        </footer>
      ) : null}
    </article>
  )
}
