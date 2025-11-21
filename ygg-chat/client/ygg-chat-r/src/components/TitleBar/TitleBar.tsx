import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import './TitleBar.css'

export const TitleBar = () => {
  const location = useLocation()
  const [platform, setPlatform] = useState<string>('')
  const [isElectron, setIsElectron] = useState(false)

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
        <div className='titlebar-title'>
          <span>Yggdrasil</span>
        </div>
      </div>
      <div className='titlebar-controls'>
        <button
          className='titlebar-button titlebar-chat titlebar-minimize'
          onClick={handleMinimize}
          aria-label='Minimize'
          title='Minimize'
        >
          <svg width='10' height='1' viewBox='0 0 10 1'>
            <rect fill='currentColor' width='10' height='1' />
          </svg>
        </button>
        <button
          className='titlebar-button titlebar-chat titlebar-maximize'
          onClick={handleMaximize}
          aria-label='Maximize'
          title='Maximize'
        >
          <svg width='10' height='10' viewBox='0 0 10 10'>
            <path fill='currentColor' d='M0 0v10h10V0H0zm1 1h8v8H1V1z' />
          </svg>
        </button>
        <button
          className='titlebar-button titlebar-chat titlebar-close'
          onClick={handleClose}
          aria-label='Close'
          title='Close'
        >
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
