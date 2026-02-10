import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import './TitleBar.css'

import { useAppSelector } from '../../hooks/redux'
import { selectCcCwd } from '../../features/chats'

export const TitleBar = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const [platform, setPlatform] = useState<string>('')
  const [isElectron, setIsElectron] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const [isCompactLoading, setIsCompactLoading] = useState(false)

  const currentCwd = useAppSelector(selectCcCwd)

  useEffect(() => {
    const detectPlatform = async () => {
      if (window.electronAPI?.platformInfo?.get) {
        const info = await window.electronAPI.platformInfo.get()
        setPlatform(info.platform)
        setIsElectron(info.isElectron)

        // Add padding to app content on Windows
        if (info.isElectron && info.platform === 'win32') {
          document.body.classList.add('has-titlebar')
        }

        // Check initial compact mode state
        if (window.electronAPI?.window?.isCompact) {
          const compact = await window.electronAPI.window.isCompact()
          setIsCompact(compact)
        }
      }
    }
    detectPlatform()

    // Cleanup
    return () => {
      document.body.classList.remove('has-titlebar')
    }
  }, [])

  // Only show on Windows in Electron
  if (!isElectron || platform !== 'win32') {
    return null
  }

  const handleToggleCompact = async () => {
    if (!window.electronAPI?.window?.toggleCompact) return
    setIsCompactLoading(true)
    try {
      const result = await window.electronAPI.window.toggleCompact()
      if (result.success) {
        setIsCompact(result.compact)
      }
    } catch (err) {
      console.error('Failed to toggle compact mode:', err)
    } finally {
      setIsCompactLoading(false)
    }
  }

  const handleMinimize = () => {
    window.electronAPI?.window?.minimize()
  }

  const handleMaximize = () => {
    window.electronAPI?.window?.maximize()
  }

  const handleClose = () => {
    window.electronAPI?.window?.close()
  }

  const isChatPage = location.pathname.startsWith('/chat/')

  return (
    <div className={`titlebar ${isChatPage ? 'titlebar-chat' : ''}`}>
      <div className='titlebar-drag-region'>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => navigate(-1)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '6px',
              opacity: 0.8,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1', e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8', e.currentTarget.style.backgroundColor = 'transparent')}
            title="Go Back"
          >
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <button
            onClick={() => navigate(1)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '4px',
              borderRadius: '6px',
              opacity: 0.8,
              transition: 'all 0.2s ease'
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1', e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.8', e.currentTarget.style.backgroundColor = 'transparent')}
            title="Go Forward"
          >
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className='titlebar-controls'>
        <div
          style={{
            marginRight: '12px',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.4)',
            maxWidth: '300px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            userSelect: 'text',
            cursor: 'default',
          }}
          title={currentCwd || 'No working directory selected'}
        >
          {currentCwd ? (
            <span style={{ fontFamily: 'monospace' }}>{currentCwd}</span>
          ) : (
            <span style={{ fontStyle: 'italic', opacity: 1 }}>Select a work folder</span>
          )}
        </div>
        <button
          className='titlebar-button titlebar-compact'
          onClick={handleToggleCompact}
          disabled={isCompactLoading}
          aria-label={isCompact ? 'Disable Floating Mode' : 'Enable Floating Mode'}
          title={isCompact ? 'Disable Floating Mode' : 'Enable Floating Mode'}
        >
          {isCompactLoading ? (
            <svg width='10' height='10' viewBox='0 0 10 10' className='animate-spin'>
              <circle cx='5' cy='5' r='4' fill='none' stroke='currentColor' strokeWidth='1' strokeDasharray='12 6' />
            </svg>
          ) : isCompact ? (
            <svg width='10' height='10' viewBox='0 0 10 10'>
              <path fill='currentColor' d='M0 0v4h1V1h3V0H0zm6 0v1h3v3h1V0H6zM0 6v4h4V9H1V6H0zm9 0v3H6v1h4V6H9z' />
            </svg>
          ) : (
            <svg width='10' height='10' viewBox='0 0 10 10'>
              <path fill='currentColor' d='M3 0v1H1v2H0V0h3zm4 0h3v3H9V1H7V0zM0 7h1v2h2v1H0V7zm9 0h1v3H7V9h2V7z' />
            </svg>
          )}
        </button>
        <button
          className='titlebar-button titlebar-minimize'
          onClick={handleMinimize}
          aria-label='Minimize'
          title='Minimize'
        >
          <svg width='10' height='1' viewBox='0 0 10 1'>
            <rect fill='currentColor' width='10' height='1' />
          </svg>
        </button>
        <button
          className='titlebar-button titlebar-maximize'
          onClick={handleMaximize}
          aria-label='Maximize'
          title='Maximize'
        >
          <svg width='10' height='10' viewBox='0 0 10 10'>
            <path fill='currentColor' d='M0 0v10h10V0H0zm1 1h8v8H1V1z' />
          </svg>
        </button>
        <button className='titlebar-button titlebar-close' onClick={handleClose} aria-label='Close' title='Close'>
          <svg width='10' height='10' viewBox='0 0 10 10'>
            <path
              fill='currentColor'
              d='M1.207.293l-.914.914L4.086 5 .293 8.793l.914.914L5 5.914l3.793 3.793.914-.914L5.914 5l3.793-3.793-.914-.914L5 4.086 1.207.293z'
            />
          </svg>
        </button>
      </div>
    </div>
  )
}
