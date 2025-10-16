import React, { useEffect, useId, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { selectFocusedChatMessageId } from '../../features/chats/chatSelectors'
import { chatSliceActions } from '../../features/chats/chatSlice'
import { selectMentionableFiles } from '../../features/ideContext/ideContextSelectors'
import { useIdeContext } from '../../hooks/useIdeContext'
import type { RootState } from '../../store/store'

type textAreaState = 'default' | 'error' | 'disabled'
type textAreaWidth = 'w-1/6' | 'w-1/4' | 'w-1/2' | 'w-3/4' | 'w-3/5' | 'w-5/6' | 'w-full' | 'max-w-3xl'

interface TextAreaProps {
  label?: string
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  state?: textAreaState
  errorMessage?: string
  maxLength?: number
  width?: textAreaWidth
  className?: string
  minRows?: number
  maxRows?: number
  autoFocus?: boolean
  showCharCount?: boolean
}

export const TextArea: React.FC<TextAreaProps> = ({
  label,
  placeholder = 'Type your message...',
  value = '',
  onChange,
  onKeyDown,
  state = 'default',
  errorMessage,
  maxLength = 2000000,
  width = 'max-w-3xl',
  className = '',
  minRows = 1,
  maxRows = 25,
  autoFocus = false,
  showCharCount = false,
  ...rest
}) => {
  const dispatch = useDispatch()
  const focusedMessageId = useSelector(selectFocusedChatMessageId)
  const imageDrafts = useSelector((s: RootState) => s.chat.composition.imageDrafts)
  const mentionableFiles = useSelector(selectMentionableFiles)
  // Local copy of mentionable files to prevent re-selecting the same file locally
  const [localMentionableFiles, setLocalMentionableFiles] = useState(mentionableFiles)
  // Merge in new files from the selector while preserving local removals
  useEffect(() => {
    setLocalMentionableFiles(prev => {
      if (prev.length === 0 && mentionableFiles.length > 0) return mentionableFiles
      const prevPaths = new Set(prev.map(f => f.path))
      const additions = mentionableFiles.filter(f => !prevPaths.has(f.path))
      return additions.length > 0 ? [...prev, ...additions] : prev
    })
  }, [mentionableFiles])
  const { requestFileContent } = useIdeContext()
  const id = useId()
  const errorId = `${id}-error`
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const [showFileList, setShowFileList] = useState(false)
  const [selectedFileIndex, setSelectedFileIndex] = useState(0)
  const [filteredFiles, setFilteredFiles] = useState<Array<{ path: string; name: string; mention: string }>>([])
  const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('up')
  const [dropdownMaxHeight, setDropdownMaxHeight] = useState<number | undefined>(undefined)

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (state !== 'disabled') {
      const newValue = e.target.value
      onChange?.(newValue)

      // Check if last character is '@' to show file list
      const lastChar = newValue.slice(-1)
      if (lastChar === '@') {
        setFilteredFiles(localMentionableFiles)
        setSelectedFileIndex(0)
        setShowFileList(true)
      } else if (showFileList && newValue.endsWith(' ')) {
        // Hide list when space is typed after @
        setShowFileList(false)
      } else if (showFileList) {
        // Filter files based on text after @
        const atIndex = newValue.lastIndexOf('@')
        if (atIndex !== -1) {
          const searchTerm = newValue.slice(atIndex + 1).toLowerCase()
          const filtered = localMentionableFiles.filter(
            file => file.name.toLowerCase().includes(searchTerm) || file.path.toLowerCase().includes(searchTerm)
          )
          setFilteredFiles(filtered)
          setSelectedFileIndex(0)
          if (filtered.length === 0) {
            setShowFileList(false)
          }
        } else {
          setShowFileList(false)
        }
      }
    }
  }

  const scrollToSelectedItem = (index: number) => {
    if (listRef.current) {
      const listElement = listRef.current
      const selectedElement = listElement.children[index] as HTMLElement
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        })
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showFileList && filteredFiles.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedFileIndex(prev => {
            const newIndex = prev < filteredFiles.length - 1 ? prev + 1 : 0
            setTimeout(() => scrollToSelectedItem(newIndex), 0)
            return newIndex
          })
          return
        case 'ArrowUp':
          e.preventDefault()
          setSelectedFileIndex(prev => {
            const newIndex = prev > 0 ? prev - 1 : filteredFiles.length - 1
            setTimeout(() => scrollToSelectedItem(newIndex), 0)
            return newIndex
          })
          return
        case 'Enter':
          e.preventDefault()
          handleFileSelection(filteredFiles[selectedFileIndex])
          return
        case 'Escape':
          e.preventDefault()
          setShowFileList(false)
          return
      }
    }
    onKeyDown?.(e)
  }

  const handleDragEnter = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (state !== 'disabled') setDragOver(true)
  }

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (state !== 'disabled') setDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (state === 'disabled') return

    const files = Array.from(e.dataTransfer?.files || [])
    const images = files.filter(f => f.type.startsWith('image/'))
    if (images.length === 0) return

    Promise.all(
      images.map(async image => ({
        dataUrl: await fileToDataUrl(image),
        name: image.name,
        type: image.type,
        size: image.size,
      }))
    )
      .then(drafts => {
        dispatch(chatSliceActions.imageDraftsAppended(drafts))
        if (focusedMessageId != null) {
          dispatch(
            chatSliceActions.messageArtifactsAppended({
              messageId: focusedMessageId,
              artifacts: drafts.map(d => d.dataUrl),
            })
          )
        }
      })
      .catch(err => console.error('Failed to read dropped images', err))
  }

  const handleFileSelection = async (file: { path: string; name: string; mention: string }) => {
    try {
      await requestFileContent(file.path)
      // Remove the selected file from local mentionable list and current filtered list
      setLocalMentionableFiles(prev => prev.filter(f => f.path !== file.path))
      setFilteredFiles(prev => prev.filter(f => f.path !== file.path))

      // Replace the @ mention with just the filename
      if (textareaRef.current) {
        const currentValue = textareaRef.current.value
        const atIndex = currentValue.lastIndexOf('@')
        if (atIndex !== -1) {
          const beforeAt = currentValue.slice(0, atIndex)
          const newValue = beforeAt + `@${file.name} `
          onChange?.(newValue)

          // Focus back to textarea and position cursor after the mention
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.focus()
              textareaRef.current.setSelectionRange(newValue.length, newValue.length)
            }
          }, 0)
        }
      }
    } catch (error) {
      console.error('Failed to request file content:', error)
    } finally {
      setShowFileList(false)
    }
  }

  // Auto-resize functionality
  const adjustHeight = () => {
    const textarea = textareaRef.current
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto'

      // Calculate the number of lines
      const lineHeight = 24 // Approximate line height in pixels
      const minHeight = minRows * lineHeight + 16 // 16px for padding
      const maxHeight = maxRows ? maxRows * lineHeight + 16 : undefined

      const scrollHeight = textarea.scrollHeight
      let newHeight = Math.max(scrollHeight, minHeight)

      if (maxHeight && newHeight > maxHeight) {
        newHeight = maxHeight
        textarea.style.overflowY = 'auto'
      } else {
        textarea.style.overflowY = 'hidden'
      }

      textarea.style.height = `${newHeight}px`
    }
  }

  // Adjust height when value changes
  useEffect(() => {
    adjustHeight()
  }, [value])

  // Adjust height on mount
  useEffect(() => {
    adjustHeight()
  }, [])

  // Programmatic focus when autoFocus toggles to true (e.g., after streaming finishes)
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Handle clicking outside to close file list
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showFileList &&
        listRef.current &&
        textareaRef.current &&
        !listRef.current.contains(event.target as Node) &&
        !textareaRef.current.contains(event.target as Node)
      ) {
        setShowFileList(false)
      }
    }

    if (showFileList) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showFileList])

  // Compute dropdown placement and size (up or down) based on viewport space
  useEffect(() => {
    if (!showFileList) return

    const updatePlacement = () => {
      const ta = textareaRef.current
      if (!ta) return
      const rect = ta.getBoundingClientRect()
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight
      const padding = 8 // px gap from textarea
      const desiredMax = 240 // ~max-h-60 (15rem)

      const spaceBelow = Math.max(0, viewportHeight - rect.bottom - padding)
      const spaceAbove = Math.max(0, rect.top - padding)

      if (spaceBelow >= spaceAbove) {
        setDropdownDirection('down')
        setDropdownMaxHeight(Math.max(0, Math.min(desiredMax, spaceBelow)))
      } else {
        setDropdownDirection('up')
        setDropdownMaxHeight(Math.max(0, Math.min(desiredMax, spaceAbove)))
      }
    }

    updatePlacement()
    window.addEventListener('resize', updatePlacement)
    window.addEventListener('scroll', updatePlacement, true)
    return () => {
      window.removeEventListener('resize', updatePlacement)
      window.removeEventListener('scroll', updatePlacement, true)
    }
  }, [showFileList])

  const baseStyles = `${width} px-4 py-3 rounded-xl transition-all duration-200 overflow-hidden bg-neutral-50 dark:bg-neutral-900`
  const labelClasses = state === 'disabled' ? 'opacity-40' : ''

  const stateStyles = {
    default: `${baseStyles} bg-gray-800 text-stone-800 dark:text-stone-200 placeholder-gray-400 border-gray-600 outline-none focus:border-gray-500 focus:ring-2 focus:ring-gray-500 focus:ring-opacity-50 dark:focus:ring-2 dark:focus:ring-secondary-600`,
    error: `${baseStyles} bg-gray-800 text-stone-800 dark:text-stone-200 placeholder-gray-400 border-red-500 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-500 focus:ring-opacity-50`,
    disabled: `${baseStyles} bg-gray-900 text-stone-800 dark:text-stone-200 border-gray-700 placeholder-gray-600 cursor-not-allowed`,
  }

  return (
    <div className='flex flex-col gap-1'>
      {label && (
        <label htmlFor={id} className={`text-sm font-medium text-gray-200 ${labelClasses}`}>
          {label}
        </label>
      )}

      <div className='relative'>
        <textarea
          ref={textareaRef}
          id={id}
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          disabled={state === 'disabled'}
          className={`${stateStyles[state]} ${dragOver ? 'border-blue-500 ring-2 ring-blue-500' : ''} ${className}`}
          aria-invalid={state === 'error'}
          aria-describedby={state === 'error' && errorMessage ? errorId : undefined}
          autoFocus={autoFocus}
          style={{
            minHeight: `${minRows * 24 + 16}px`,
          }}
          {...rest}
        />

        {/* Character count indicator */}
        {showCharCount && maxLength && (
          <div className='absolute bottom-2 right-3 text-xs text-stone-800 dark:text-stone-200'>
            {value.length}/{maxLength}
          </div>
        )}

        {/* Floating file list */}
        {showFileList && filteredFiles.length > 0 && (
          <div
            ref={listRef}
            className='absolute z-50 mb-1 w-80 max-h-60 overflow-y-auto dark:bg-secondary-600 bg-slate-50 border border-gray-600 rounded-lg shadow-lg thin-scrollbar'
            style={{
              bottom: dropdownDirection === 'up' ? '100%' : undefined,
              top: dropdownDirection === 'down' ? '100%' : undefined,
              left: 0,
              maxHeight: dropdownMaxHeight ? `${dropdownMaxHeight}px` : undefined,
            }}
          >
            {filteredFiles.map((file, index) => (
              <div
                key={file.path}
                className={`px-3 py-2 cursor-pointer text-sm border-b border-gray-700 last:border-b-0 ${
                  index === selectedFileIndex
                    ? 'bg-slate-200 dark:bg-secondary-800 text-stone-800 dark:text-stone-200'
                    : 'text-stone-800 dark:text-stone-200'
                }`}
                onClick={() => handleFileSelection(file)}
                onMouseEnter={() => setSelectedFileIndex(index)}
              >
                <div className='font-medium truncate'>{file.name}</div>
                <div className='text-xs text-stone-400 truncate'>{file.path}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Image draft previews */}
      {imageDrafts && imageDrafts.length > 0 && (
        <div className='mt-2 flex flex-wrap gap-2'>
          {imageDrafts.map((img, idx) => (
            <div
              key={idx}
              className='w-16 h-16 rounded-md overflow-hidden border border-gray-600 bg-neutral-800'
              title={img.name}
            >
              <img src={img.dataUrl} alt={img.name || `image-${idx}`} className='w-full h-full object-cover' />
            </div>
          ))}
        </div>
      )}

      {state === 'error' && errorMessage && (
        <span id={errorId} className='text-sm text-red-400 mt-1'>
          {errorMessage}
        </span>
      )}
    </div>
  )
}
