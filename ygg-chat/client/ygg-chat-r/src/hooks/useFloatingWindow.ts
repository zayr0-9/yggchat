import { useEffect, useState } from 'react'

interface FloatingWindowHookReturn {
  isOpen: boolean
  isLoading: boolean
  error: string | null
  toggleCompact: () => Promise<void>
}

/**
 * Hook to manage compact mode (mini popup) on the main window in Electron
 */
export const useFloatingWindow = (): FloatingWindowHookReturn => {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleCompact = async () => {
    if (!window.electronAPI?.window) return

    setIsLoading(true)
    setError(null)

    try {
      const result = await window.electronAPI.window.toggleCompact()
      if (result.success) {
        setIsOpen(result.compact)
      } else {
        setError(result.error || 'Failed to toggle compact mode')
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
      if (window.electronAPI?.window?.isCompact) {
        try {
          const compact = await window.electronAPI.window.isCompact()
          setIsOpen(compact)
        } catch (err) {
          console.error('Failed to check compact mode state:', err)
        }
      }
    }

    checkInitialState()
  }, [])

  return {
    isOpen,
    isLoading,
    error,
    toggleCompact,
  }
}
