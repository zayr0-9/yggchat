import React, { useEffect, useRef } from 'react'
import { attachCustomToolIframeBridge } from '../customToolIframeBridge'

interface CustomToolIframeProps {
  html: string
  toolName?: string | null
  userId?: string | null
  rootPath?: string | null
}

export const CustomToolIframe: React.FC<CustomToolIframeProps> = ({
  html,
  toolName = null,
  userId = null,
  rootPath = null,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return

    const cleanup = attachCustomToolIframeBridge(iframe, {
      toolName,
      userId,
      rootPath,
    })

    return () => cleanup()
  }, [rootPath, toolName, userId])

  return (
    <div className='mobile-custom-tool-iframe-wrap'>
      <iframe
        ref={iframeRef}
        srcDoc={html}
        className='mobile-custom-tool-iframe'
        style={{ border: 'none' }}
        title={toolName ? `Custom Tool: ${toolName}` : 'Custom Tool App'}
        allow='fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
        referrerPolicy='strict-origin-when-cross-origin'
        sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-presentation allow-downloads'
      />
    </div>
  )
}
