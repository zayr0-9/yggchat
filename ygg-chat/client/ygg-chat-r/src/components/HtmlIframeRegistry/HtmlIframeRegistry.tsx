import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type HtmlIframeEntry = {
  key: string
  html: string
  label: string | null
}

type HtmlIframeRegistryContextValue = {
  entries: HtmlIframeEntry[]
  registerEntry: (key: string, html: string, label?: string | null) => void
  updateIframe: (key: string, html: string, fullHeight: boolean, label?: string | null) => void
  setTarget: (key: string, target: HTMLElement | null) => void
}

type IframeRecord = {
  iframe: HTMLIFrameElement
  html: string
  fullHeight: boolean
  cleanup: () => void
}

const HtmlIframeRegistryContext = createContext<HtmlIframeRegistryContextValue | null>(null)

export const useHtmlIframeRegistry = () => useContext(HtmlIframeRegistryContext)

const getIframeClassName = (fullHeight: boolean) =>
  fullHeight ? 'w-full h-full bg-white' : 'w-full min-h-[800px] rounded-lg bg-white'

const configureIframeElement = (iframe: HTMLIFrameElement) => {
  iframe.style.border = 'none'
  iframe.title = 'HTML Preview'
  iframe.className = getIframeClassName(false)
  iframe.setAttribute(
    'allow',
    'fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
  )
  iframe.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation')
}

const attachMessageBridge = (iframe: HTMLIFrameElement) => {
  const handleMessage = async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) {
      return
    }

    const { type, requestId, options } = event.data || {}
    if (!type || !requestId) return

    const electronAPI = (window as any).electronAPI

    let response: any = { success: false, error: 'Unknown request type' }

    try {
      switch (type) {
        case 'DIALOG_OPEN_FILE':
          if (electronAPI?.dialog?.openFile) {
            response = await electronAPI.dialog.openFile(options)
          } else {
            response = { success: false, error: 'File dialog not available (not in Electron)' }
          }
          break
        case 'DIALOG_SAVE_FILE':
          if (electronAPI?.dialog?.saveFile) {
            response = await electronAPI.dialog.saveFile(options)
          } else {
            response = { success: false, error: 'Save dialog not available (not in Electron)' }
          }
          break
        case 'FS_READ_FILE':
          if (electronAPI?.fs?.readFile) {
            response = await electronAPI.fs.readFile(options?.filePath, options?.encoding)
          } else {
            response = { success: false, error: 'File read not available (not in Electron)' }
          }
          break
        case 'FS_WRITE_FILE':
          if (electronAPI?.fs?.writeFile) {
            response = await electronAPI.fs.writeFile(options?.filePath, options?.content, options?.encoding)
          } else {
            response = { success: false, error: 'File write not available (not in Electron)' }
          }
          break
        case 'FS_MKDIR':
          if (electronAPI?.fs?.mkdir) {
            response = await electronAPI.fs.mkdir(options?.dirPath)
          } else {
            response = { success: false, error: 'Mkdir not available (not in Electron)' }
          }
          break
        case 'SHELL_EXEC':
          if (electronAPI?.exec?.run) {
            response = await electronAPI.exec.run(options?.command, { cwd: options?.cwd, timeout: options?.timeout })
          } else {
            response = { success: false, error: 'Shell exec not available (not in Electron)' }
          }
          break
        case 'HTTP_REQUEST':
          if (electronAPI?.http?.request) {
            response = await electronAPI.http.request({
              url: options?.url,
              method: options?.method,
              headers: options?.headers,
              body: options?.body,
              timeout: options?.timeout,
            })
          } else {
            response = { success: false, error: 'HTTP request not available (not in Electron)' }
          }
          break
      }
    } catch (err) {
      response = { success: false, error: String(err) }
    }

    iframe.contentWindow?.postMessage({ type: `${type}_RESPONSE`, requestId, ...response }, '*')
  }

  window.addEventListener('message', handleMessage)
  return () => window.removeEventListener('message', handleMessage)
}

const createIframeRecord = (html: string, fullHeight: boolean): IframeRecord => {
  const iframe = document.createElement('iframe')
  configureIframeElement(iframe)
  iframe.className = getIframeClassName(fullHeight)
  iframe.srcdoc = html
  const cleanup = attachMessageBridge(iframe)

  return { iframe, html, fullHeight, cleanup }
}

export const HtmlIframeRegistryProvider: React.FC<{
  children: React.ReactNode
  resetKey?: string | number | null
}> = ({ children, resetKey }) => {
  const recordsRef = useRef<Map<string, IframeRecord>>(new Map())
  const targetsRef = useRef<Map<string, HTMLElement | null>>(new Map())
  const entriesRef = useRef<Map<string, HtmlIframeEntry>>(new Map())
  const [entries, setEntries] = useState<HtmlIframeEntry[]>([])
  const hiddenHostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    recordsRef.current.forEach(record => {
      record.cleanup()
      record.iframe.remove()
    })
    recordsRef.current.clear()
    targetsRef.current.clear()
    entriesRef.current.clear()
    setEntries([])
  }, [resetKey])

  const registerEntry = useCallback((key: string, html: string, label?: string | null) => {
    const existingEntry = entriesRef.current.get(key)
    const nextLabel = label ?? existingEntry?.label ?? null
    const nextEntry: HtmlIframeEntry = {
      key,
      html,
      label: nextLabel,
    }
    if (!existingEntry || existingEntry.html !== html || existingEntry.label !== nextLabel) {
      entriesRef.current.set(key, nextEntry)
      setEntries(prev => {
        const index = prev.findIndex(entry => entry.key === key)
        if (index === -1) {
          return [...prev, nextEntry]
        }
        const next = [...prev]
        next[index] = nextEntry
        return next
      })
    }
  }, [])

  const setTarget = useCallback((key: string, target: HTMLElement | null) => {
    targetsRef.current.set(key, target)
    const record = recordsRef.current.get(key)
    const host = target ?? hiddenHostRef.current
    if (record && host && record.iframe.parentElement !== host) {
      host.appendChild(record.iframe)
    }
  }, [])

  const updateIframe = useCallback((key: string, html: string, fullHeight: boolean, label?: string | null) => {
    let record = recordsRef.current.get(key)
    if (!record) {
      record = createIframeRecord(html, fullHeight)
      recordsRef.current.set(key, record)
    } else {
      if (record.html !== html) {
        record.iframe.srcdoc = html
        record.html = html
      }
      if (record.fullHeight !== fullHeight) {
        record.iframe.className = getIframeClassName(fullHeight)
        record.fullHeight = fullHeight
      }
    }

    const existingEntry = entriesRef.current.get(key)
    const nextLabel = label ?? existingEntry?.label ?? null
    const nextEntry: HtmlIframeEntry = {
      key,
      html,
      label: nextLabel,
    }
    if (!existingEntry || existingEntry.html !== html || existingEntry.label !== nextLabel) {
      entriesRef.current.set(key, nextEntry)
      setEntries(prev => {
        const index = prev.findIndex(entry => entry.key === key)
        if (index === -1) {
          return [...prev, nextEntry]
        }
        const next = [...prev]
        next[index] = nextEntry
        return next
      })
    }

    const target = targetsRef.current.get(key)
    const host = target ?? hiddenHostRef.current
    if (host && record.iframe.parentElement !== host) {
      host.appendChild(record.iframe)
    }
  }, [])

  const contextValue = useMemo(
    () => ({ entries, registerEntry, updateIframe, setTarget }),
    [entries, registerEntry, updateIframe, setTarget]
  )

  return (
    <HtmlIframeRegistryContext.Provider value={contextValue}>
      {children}
      <div ref={hiddenHostRef} className='fixed left-0 top-0 h-0 w-0 overflow-hidden' aria-hidden='true' />
    </HtmlIframeRegistryContext.Provider>
  )
}

export const HtmlIframeSlot: React.FC<{
  iframeKey: string
  html: string
  fullHeight?: boolean
  className?: string
}> = ({ iframeKey, html, fullHeight = false, className }) => {
  const registry = useHtmlIframeRegistry()
  const slotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!registry) return
    registry.updateIframe(iframeKey, html, fullHeight)
  }, [registry, iframeKey, html, fullHeight])

  useLayoutEffect(() => {
    if (!registry) return
    const node = slotRef.current
    if (!node) return
    registry.setTarget(iframeKey, node)
    return () => {
      registry.setTarget(iframeKey, null)
    }
  }, [registry, iframeKey])

  if (!registry) {
    return (
      <div className={className}>
        <iframe
          srcDoc={html}
          className={getIframeClassName(fullHeight)}
          style={{ border: 'none' }}
          title='HTML Preview'
          allow='fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
          referrerPolicy='strict-origin-when-cross-origin'
          sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-presentation'
        />
      </div>
    )
  }

  return <div ref={slotRef} className={className} />
}
