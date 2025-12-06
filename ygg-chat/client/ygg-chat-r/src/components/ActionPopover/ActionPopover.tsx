import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../Button/button'

interface ActionPopoverProps {
  children: React.ReactNode
  isActive?: boolean
  footer?: React.ReactNode
}

export const ActionPopover: React.FC<ActionPopoverProps> = ({ children, isActive = false, footer }) => {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popoverPosition, setPopoverPosition] = useState<{ top: number; left: number } | null>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Compute popover position (above the trigger button)
  useEffect(() => {
    const compute = () => {
      const btn = btnRef.current
      if (!btn || typeof window === 'undefined') return
      const rect = btn.getBoundingClientRect()

      // Position above the button with a small gap
      setPopoverPosition({
        top: rect.top - 8, // 8px gap above
        left: rect.left + rect.width / 2, // Center horizontally
      })
    }

    compute()
    if (!open) return

    window.addEventListener('resize', compute)
    window.addEventListener('scroll', compute, true)
    return () => {
      window.removeEventListener('resize', compute)
      window.removeEventListener('scroll', compute, true)
    }
  }, [open])

  const handleToggle = useCallback(() => {
    setOpen(o => !o)
  }, [])

  return (
    <div className='relative'>
      <Button
        ref={btnRef}
        variant='outline2'
        size='large'
        onClick={handleToggle}
        className={
          isActive
            ? 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700/50'
            : 'text-neutral-600 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700/50'
        }
        title='Toggle options'
        aria-haspopup='true'
        aria-expanded={open}
      >
        <i className='bx bx-dots-horizontal-rounded text-[18px]' aria-hidden='true' />
      </Button>

      {open &&
        popoverPosition &&
        createPortal(
          <div
            ref={popoverRef}
            className='fixed z-[100] rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-700 bg-white/90 dark:bg-neutral-800/90 backdrop-blur-md shadow-xl'
            style={{
              top: `${popoverPosition.top}px`,
              left: `${popoverPosition.left}px`,
              transform: 'translate(-50%, -100%)', // Center horizontally, position above
            }}
          >
            <div className='flex items-center gap-1 p-2'>{children}</div>
            {footer && <div className='px-2 pb-2'>{footer}</div>}
          </div>,
          document.body
        )}
    </div>
  )
}
