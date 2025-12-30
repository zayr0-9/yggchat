import 'boxicons'
import 'boxicons/css/boxicons.min.css'
import { useEffect } from 'react'
import { useFloatingWindow } from '../../hooks/useFloatingWindow'

interface FloatingWindowButtonProps {
  className?: string
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
}

export const FloatingWindowButton: React.FC<FloatingWindowButtonProps> = ({
  className = '',
  position = 'bottom-right',
}) => {
  const { isOpen, isLoading, toggleFloatingWindow } = useFloatingWindow()

  // Position styles
  const positionStyles = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
  }

  // Show only in Electron
  if (!window.electronAPI) {
    return null
  }

  return (
    <button
      onClick={toggleFloatingWindow}
      disabled={isLoading}
      className={`fixed z-50 p-3 rounded-full bg-blue-600 hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600 text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 ${positionStyles[position]} ${className}`}
      title={isOpen ? 'Close floating window' : 'Open floating window'}
      aria-label={isOpen ? 'Close floating window' : 'Open floating window'}
    >
      {isLoading ? (
        <i className="bx bx-loader-alt animate-spin text-xl" aria-hidden="true" />
      ) : (
        <i
          className={`bx ${isOpen ? 'bx-x' : 'bx-window'} text-xl`}
          aria-hidden="true"
        />
      )}
    </button>
  )
}
