import React, { useEffect, useMemo, useRef, useState } from 'react'

export type SelectOption = { value: string; label?: string }

interface SelectProps {
  value?: string
  options: Array<string | SelectOption>
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  searchBarVisible?: boolean
  size?: 'small' | 'medium' | 'large'
}

export const Select: React.FC<SelectProps> = ({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  searchBarVisible = false,
  size = 'medium',
}) => {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number>(-1)
  const [searchTerm, setSearchTerm] = useState('')
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [openUp, setOpenUp] = useState(false)
  const [listMaxHeight, setListMaxHeight] = useState<number | undefined>(undefined)

  const normOptions: SelectOption[] = useMemo(() => {
    const out: SelectOption[] = []
    for (const o of options) {
      if (o == null) continue
      if (typeof o === 'string') {
        out.push({ value: o, label: o })
      } else if (typeof o.value === 'string' && o.value.length > 0) {
        out.push({ value: o.value, label: o.label ?? o.value })
      }
    }
    return out
  }, [options])

  const filteredOptions: SelectOption[] = useMemo(() => {
    if (!searchBarVisible || !searchTerm.trim()) {
      return normOptions
    }
    const term = searchTerm.toLowerCase()
    return normOptions.filter(opt => opt.label.toLowerCase().includes(term) || opt.value.toLowerCase().includes(term))
  }, [normOptions, searchTerm, searchBarVisible])

  const selected = useMemo(() => normOptions.find(o => o.value === value) || null, [normOptions, value])

  // Size styles to mirror Button component sizes
  const sizeClass = useMemo(() => {
    switch (size) {
      case 'small':
        return 'px-3 py-1.5 text-sm leading-none'
      case 'large':
        return 'px-4 py-3 text-lg leading-none'
      case 'medium':
      default:
        return 'px-3 py-3 text-base leading-none'
    }
  }, [size])

  // Close on outside click (use 'click' so option selection handlers run first)
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (listRef.current?.contains(t)) return
      if (searchRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  // Reset search term when dropdown closes
  useEffect(() => {
    if (!open) {
      setSearchTerm('')
    }
  }, [open])

  // Compute dropdown placement and size
  useEffect(() => {
    const compute = () => {
      const btn = btnRef.current
      if (!btn || typeof window === 'undefined') return
      const rect = btn.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      // Decide direction: prefer up if below space is tight and above has more room
      const shouldOpenUp = spaceBelow < 200 && spaceAbove > spaceBelow
      setOpenUp(shouldOpenUp)
      const available = (shouldOpenUp ? spaceAbove : spaceBelow) - 8 // 8px margin
      // Cap to a reasonable range for usability
      const maxH = Math.max(160, Math.min(360, available))
      setListMaxHeight(Number.isFinite(maxH) ? maxH : 280)
    }
    // Always compute once on mount and whenever `open` changes
    compute()
    if (!open) return
    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true) // capture scrolls from ancestors
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open])

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      setOpen(true)
      setActiveIndex(
        Math.max(
          0,
          filteredOptions.findIndex(o => o.value === value)
        )
      )
      return
    }
    if (!open) return

    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => (i + 1) % filteredOptions.length)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => (i - 1 + filteredOptions.length) % filteredOptions.length)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filteredOptions[activeIndex]
      if (opt) {
        onChange(opt.value)
        setOpen(false)
      }
      return
    }
  }

  const handleSelect = (val: string) => {
    if (disabled) return
    onChange(val)
    setOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={btnRef}
        type='button'
        className={`w-full inline-flex items-center justify-between gap-2 ${sizeClass} dark:bg-yBlack-900 rounded-lg bg-neutral-50 text-stone-800 dark:text-stone-200 border dark:border-0 border-neutral-200/70  hover:bg-neutral-100 dark:hover:bg-yBlack-500 disabled:opacity-60 disabled:cursor-not-allowed`}
        aria-haspopup='listbox'
        aria-expanded={open}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      >
        <span className='truncate text-left flex-1'>
          {selected ? selected.label : <span className='text-neutral-500 dark:text-neutral-400'>{placeholder}</span>}
        </span>
        <i className={`bx bx-chevron-down transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden='true' />
      </button>

      {open && (
        <div
          ref={listRef}
          role='listbox'
          tabIndex={-1}
          className={`absolute z-50 w-full left-0 ${openUp ? 'bottom-full mb-1' : 'top-full mt-1'} rounded-lg overflow-hidden border border-neutral-200 dark:border-0 dark:border-neutral-700 bg-white dark:bg-yBlack-900  shadow-xl`}
          style={{ maxHeight: listMaxHeight }}
        >
          {searchBarVisible && (
            <div className='px-2 py-2 border-b border-neutral-200 dark:border-neutral-700'>
              <input
                ref={searchRef}
                type='text'
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder='Search...'
                className='w-full px-2 py-1 text-sm rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 text-stone-800 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-neutral-800 dark:focus:ring-2 dark:focus:ring-neutral-700 dark:border-0'
                autoFocus
              />
            </div>
          )}
          <div
            className='overflow-auto thin-scrollbar'
            style={{ maxHeight: searchBarVisible ? (listMaxHeight || 280) - 50 : listMaxHeight }}
          >
            {filteredOptions.length === 0 ? (
              <div className='px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400'>
                {searchBarVisible && searchTerm.trim() ? 'No matching options' : 'No options'}
              </div>
            ) : (
              filteredOptions.map((opt, idx) => {
                const isSelected = value === opt.value
                const isActive = idx === activeIndex
                return (
                  <button
                    type='button'
                    key={opt.value}
                    role='option'
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={e => {
                      // Select on mousedown to beat any outside click handlers and avoid losing the event
                      e.preventDefault()
                      e.stopPropagation()
                      handleSelect(opt.value)
                    }}
                    onClick={() => handleSelect(opt.value)}
                    className={`w-full text-left px-3 py-2 text-sm transition-colors
                      ${isActive ? 'bg-neutral-100 dark:bg-yBlack-500' : ''}
                      ${isSelected ? 'font-medium' : ''}
                      text-stone-800 dark:text-stone-100`}
                  >
                    {opt.label}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
