import React, { useCallback, useEffect, useRef } from 'react'

interface ComposerProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled?: boolean
  sending?: boolean
  isBranching?: boolean
  branchLabel?: string
  onCancelBranch?: () => void
}

const DEFAULT_ROWS = 3
const MAX_ROWS = 8

export const Composer: React.FC<ComposerProps> = ({
  value,
  onChange,
  onSubmit,
  disabled = false,
  sending = false,
  isBranching = false,
  branchLabel,
  onCancelBranch,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const autoResize = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const computedStyle = window.getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(computedStyle.lineHeight) || 20
    const paddingY = (Number.parseFloat(computedStyle.paddingTop) || 0) + (Number.parseFloat(computedStyle.paddingBottom) || 0)
    const borderY = (Number.parseFloat(computedStyle.borderTopWidth) || 0) + (Number.parseFloat(computedStyle.borderBottomWidth) || 0)

    const minHeight = lineHeight * DEFAULT_ROWS + paddingY + borderY
    const maxHeight = lineHeight * MAX_ROWS + paddingY + borderY

    textarea.style.height = 'auto'
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight)
    textarea.style.height = `${nextHeight}px`
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    autoResize()
  }, [value, autoResize])

  return (
    <div className='mobile-composer'>
      {isBranching ? (
        <div className='mobile-branch-banner'>
          <span>{branchLabel || 'Branching from selected message'}</span>
          {onCancelBranch ? (
            <button type='button' onClick={onCancelBranch} disabled={disabled || sending}>
              Cancel branch
            </button>
          ) : null}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        rows={DEFAULT_ROWS}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={isBranching ? 'Rewrite branched prompt...' : 'Type a message...'}
        disabled={disabled}
        onInput={autoResize}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSubmit()
          }
        }}
      />
      <button type='button' onClick={onSubmit} disabled={disabled || !value.trim() || sending}>
        {sending ? 'Sending…' : isBranching ? 'Send Branch' : 'Send'}
      </button>
    </div>
  )
}
