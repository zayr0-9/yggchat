import { useEffect, useState } from 'react'

interface FloatingWindowHookReturn {
  isOpen: boolean
  isLoading: boolean
  error: string | null
  openFloatingWindow: () => Promise<void>
  closeFloatingWindow: () => Promise<void>
  toggleFloatingWindow: () => Promise<void>
}

/**
 * Hook to manage the floating popup window in Electron
 * Returns controls to open, close, and toggle the floating window
 */
export const useFloatingWindow = (): FloatingWindowHookReturn => {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openFloatingWindow = async () => {
    if (!window.electronAPI?.window) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.window.openFloating()
      if (result.success) {
        setIsOpen(true)
      } else {
        setError(result.error || 'Failed to open floating window')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const closeFloatingWindow = async () => {
    if (!window.electronAPI?.window) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.window.closeFloating()
      if (result.success) {
        setIsOpen(false)
      } else {
        setError(result.error || 'Failed to close floating window')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const toggleFloatingWindow = async () => {
    if (!window.electronAPI?.window) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.window.toggleFloating()
      if (result.success) {
        setIsOpen(result.isOpen)
      } else {
        setError(result.error || 'Failed to toggle floating window')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  // Check initial state on mount
  useEffect(() => {
    const checkInitialState = async () => {
      if (window.electronAPI?.window?.isFloatingOpen) {
        try {
          const open = await window.electronAPI.window.isFloatingOpen()
          setIsOpen(open)
        } catch (err) {
          console.error('Failed to check floating window state:', err)
        }
      }
    }

    checkInitialState()
  }, [])

  return {
    isOpen,
    isLoading,
    error,
    openFloatingWindow,
    closeFloatingWindow,
    toggleFloatingWindow,
  }
}
