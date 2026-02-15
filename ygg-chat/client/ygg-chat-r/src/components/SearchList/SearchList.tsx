import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TextField } from '..'
import { ConversationId } from '../../../../../shared/types'

export type SearchResultItem = {
  conversationId: ConversationId
  messageId: string
  content: string
  conversationTitle?: string
  createdAt: string
  highlighted?: string
}

type Variant = 'neutral' | 'secondary'

type DropdownPosition = {
  top: number
  left: number
  width: number
  maxHeight: number
}

export interface SearchListProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  results: SearchResultItem[]
  loading?: boolean
  onResultClick: (conversationId: ConversationId, messageId: string) => void
  placeholder?: string
  className?: string
  dropdownVariant?: Variant
}

const variantBorderClass: Record<Variant, string> = {
  neutral: 'dark:border-neutral-600',
  secondary: 'dark:border-secondary-600',
}

const SearchList: React.FC<SearchListProps> = ({
  value,
  onChange,
  onSubmit,
  results,
  loading = false,
  onResultClick,
  placeholder = 'Search messages...',
  className = '',
  dropdownVariant = 'neutral',
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState<DropdownPosition>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 320,
  })
  const dropdownRef = useRef<HTMLUListElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Update dropdown position when opening
  useEffect(() => {
    const updatePosition = () => {
      if (isOpen && containerRef.current) {
        // Position based on the actual input element
        const inputElement = containerRef.current.querySelector('input')
        if (inputElement) {
          const rect = inputElement.getBoundingClientRect()
          const viewportPadding = 8
          const minDropdownHeight = 120
          const preferredMaxHeight = 420

          const spaceBelow = window.innerHeight - rect.bottom - viewportPadding
          const spaceAbove = rect.top - viewportPadding
          const openUpward = spaceBelow < minDropdownHeight && spaceAbove > spaceBelow

          const availableHeight = openUpward ? spaceAbove : spaceBelow
          const computedMaxHeight = Math.max(100, Math.min(preferredMaxHeight, availableHeight))

          const top = openUpward
            ? Math.max(viewportPadding, rect.top - computedMaxHeight)
            : Math.max(viewportPadding, rect.bottom)

          const clampedLeft = Math.min(
            Math.max(viewportPadding, rect.left),
            Math.max(viewportPadding, window.innerWidth - rect.width - viewportPadding)
          )

          setDropdownPosition({
            top,
            left: clampedLeft,
            width: rect.width,
            maxHeight: computedMaxHeight,
          })
        }
      }
    }

    updatePosition()

    if (isOpen) {
      window.addEventListener('scroll', updatePosition, true)
      window.addEventListener('resize', updatePosition)
      return () => {
        window.removeEventListener('scroll', updatePosition, true)
        window.removeEventListener('resize', updatePosition)
      }
    }
  }, [isOpen])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const handleEnterKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && value.trim()) {
      onSubmit()
      setIsOpen(true)
    }
  }

  const handleSearchClick = () => {
    if (value.trim()) {
      onSubmit()
      setIsOpen(true)
    }
  }

  const borderVariantClass = variantBorderClass[dropdownVariant]

  const dropdownContent = isOpen
    ? loading
      ? (
          <div
            className='fixed z-50 bg-indigo-50 dark:bg-yBlack-900 p-4 md:p-3 lg:p-2.5 xl:p-2 text-sm md:text-xs lg:text-xs xl:text-[10px]'
            style={{
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
            }}
          >
            Searching...
          </div>
        )
      : results.length > 0
        ? (
            <ul
              ref={dropdownRef}
              className={`fixed z-50 overflow-y-auto bg-slate-50 border border-indigo-100 ${borderVariantClass} rounded shadow-lg dark:bg-neutral-700 thin-scrollbar`}
              style={{
                colorScheme: 'dark',
                top: `${dropdownPosition.top}px`,
                left: `${dropdownPosition.left}px`,
                width: `${dropdownPosition.width}px`,
                maxHeight: `${dropdownPosition.maxHeight}px`,
              }}
            >
              {results.map(res => (
                <li
                  key={`${res.conversationId}-${res.messageId}`}
                  className='p-3 hover:bg-indigo-100 dark:bg-yBlack-900 dark:hover:bg-yBlack-700 cursor-pointer text-sm dark:text-neutral-200'
                  onClick={() => {
                    onResultClick(res.conversationId, res.messageId)
                    setIsOpen(false)
                  }}
                >
                  <div className='flex justify-between items-baseline'>
                    <div className='font-semibold text-base text-indigo-600 dark:text-yBrown-50'>
                      {res.conversationTitle || `Conv ${res.conversationId}`}
                    </div>
                    <div className='text-xs text-neutral-500 dark:text-neutral-400 ml-2'>
                      {new Date(res.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className='mt-1 pl-2 text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap break-words max-h-48 overflow-hidden'>
                    {res.content}
                  </div>
                </li>
              ))}
            </ul>
          )
        : null
    : null

  return (
    <div
      ref={containerRef}
      className={`relative drop-shadow-xl shadow-[0_1px_10px_-2px_rgba(0,0,0,0.01),0_1px_10px_-2px_rgba(0,0,0,0.01)] dark:shadow-[1px_4px_16px_-6px_rgba(0,0,0,0.45),1px_4px_16px_-4px_rgba(0,0,0,0.02)] ${className}`}
    >
      <TextField
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={handleEnterKey}
        showSearchIcon
        onSearchClick={handleSearchClick}
      />

      {dropdownContent && typeof document !== 'undefined' ? createPortal(dropdownContent, document.body) : null}
    </div>
  )
}

export default SearchList
