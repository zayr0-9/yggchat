import React from 'react'
import { useNavigate } from 'react-router-dom'

interface MarkdownLinkProps {
  href?: string
  children?: React.ReactNode
  [key: string]: any
}

export const MarkdownLink: React.FC<MarkdownLinkProps> = ({ href, children, ...props }) => {
  const navigate = useNavigate()

  // Check if running in Electron
  const isElectron =
    (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) ||
    import.meta.env.VITE_ENVIRONMENT === 'electron'

  const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href) return

    // Special protocol links (mailto:, tel:) - let them through normally
    if (href.startsWith('mailto:') || href.startsWith('tel:')) {
      return
    }

    // Check if it's an external link (starts with http://, https://, or //)
    const isExternal = /^(https?:)?\/\//.test(href)

    if (isExternal) {
      e.preventDefault()

      if (isElectron && window.electronAPI?.auth?.openExternal) {
        // Electron: Open in system browser
        try {
          const result = await window.electronAPI.auth.openExternal(href)
          if (!result.success) {
            console.error('Failed to open external link:', result.error)
            // Fallback: try window.open
            window.open(href, '_blank', 'noopener,noreferrer')
          }
        } catch (error) {
          console.error('Error opening external link:', error)
          window.open(href, '_blank', 'noopener,noreferrer')
        }
      } else {
        // Web: Open in new tab
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    } else if (href.startsWith('/')) {
      // Internal absolute path - use React Router
      e.preventDefault()
      navigate(href)
    }
    // Relative paths and hash links: let default behavior handle them
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      className='text-blue-600 dark:text-blue-400 hover:underline'
      {...props}
    >
      {children}
    </a>
  )
}
