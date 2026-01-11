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
import type { Message, ContentBlock } from '../../features/chats/chatTypes'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { localApi } from '../../utils/api'

type HtmlIframeEntry = {
  key: string
  html: string
  label: string | null
  favorite: boolean
  status: 'active' | 'hibernated'
  sizeBytes: number
  createdAt: number
  updatedAt: number
  lastUsedAt: number
}

type HtmlToolsSettings = {
  maxActive: number
  maxCached: number
  maxBytes: number
  ttlMinutes: number
  hibernateAfterMinutes: number
}

type HtmlIframeRegistryContextValue = {
  entries: HtmlIframeEntry[]
  registerEntry: (key: string, html: string, label?: string | null) => void
  updateIframe: (key: string, html: string, fullHeight: boolean, label?: string | null) => void
  setTarget: (key: string, target: HTMLElement | null) => void
  isModalOpen: boolean
  focusKey: string | null
  openModal: (focusKey?: string | null) => void
  closeModal: () => void
  touchEntry: (key: string) => void
  toggleFavorite: (key: string) => void
  hibernateEntry: (key: string) => void
  restoreEntry: (key: string) => void
  removeEntry: (key: string) => void
  bootstrapFromLocalCache: (userId: string) => Promise<void>
  settings: HtmlToolsSettings
  updateSettings: (updates: Partial<HtmlToolsSettings>) => void
}

type IframeRecord = {
  iframe: HTMLIFrameElement
  html: string
  fullHeight: boolean
  cleanup: () => void
}

const HtmlIframeRegistryContext = createContext<HtmlIframeRegistryContextValue | null>(null)

export const useHtmlIframeRegistry = () => useContext(HtmlIframeRegistryContext)

const DEFAULT_SETTINGS: HtmlToolsSettings = {
  maxActive: 6,
  maxCached: 20,
  maxBytes: 8 * 1024 * 1024,
  ttlMinutes: 12 * 60,
  hibernateAfterMinutes: 20,
}

const LOG_HTML_TOOLS = true

const logHtmlTools = (...args: any[]) => {
  if (!LOG_HTML_TOOLS) return
  console.debug('[HtmlTools]', ...args)
}

const getHtmlSizeBytes = (html: string) => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(html).length
  }
  return html.length
}

const normalizeLimit = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0)

type ToolCallRenderGroup = {
  id: string
  name?: string
  args?: Record<string, any> | null
  results: Array<{ content: any; is_error?: boolean }>
  anchorIndex: number
}

const parseContentBlocks = (raw?: Message['content_blocks']): ContentBlock[] => {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') return [raw as ContentBlock]
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as ContentBlock[]
      if (parsed && typeof parsed === 'object') return [parsed as ContentBlock]
    } catch {
      return []
    }
  }
  return []
}

const buildToolCallGroupsFromBlocks = (blocks?: ContentBlock[]) => {
  if (!blocks || blocks.length === 0) return new Map<number, ToolCallRenderGroup>()

  const groupsById = new Map<string, ToolCallRenderGroup>()
  const mapByIndex = new Map<number, ToolCallRenderGroup>()

  blocks.forEach((block, idx) => {
    if (block.type === 'tool_use') {
      const id = block.id || `tool-${idx}`
      if (!groupsById.has(id)) {
        const group: ToolCallRenderGroup = {
          id,
          name: block.name,
          args: block.input,
          results: [],
          anchorIndex: idx,
        }
        groupsById.set(id, group)
        mapByIndex.set(idx, group)
      }
    } else if (block.type === 'tool_result') {
      const id = block.tool_use_id || `tool-result-${idx}`
      const target = groupsById.get(id)
      if (target) {
        target.results.push({ content: block.content, is_error: block.is_error })
      } else {
        const fallback: ToolCallRenderGroup = {
          id,
          name: 'Tool Result',
          args: null,
          results: [{ content: block.content, is_error: block.is_error }],
          anchorIndex: idx,
        }
        mapByIndex.set(idx, fallback)
      }
    }
  })

  return mapByIndex
}

const extractHtmlFromToolResult = (content: any): string | null => {
  if (!content) return null

  let resolved = content
  if (typeof resolved === 'string') {
    try {
      resolved = JSON.parse(resolved)
    } catch {
      return null
    }
  }

  if (typeof resolved === 'object' && resolved !== null && 'html' in resolved) {
    return (resolved as any).html
  }

  if (
    typeof resolved === 'object' &&
    resolved !== null &&
    (resolved as any).type === 'text/html' &&
    typeof (resolved as any).content === 'string'
  ) {
    return (resolved as any).content
  }

  return null
}

const buildHtmlEntriesFromMessages = (messages: Message[]) => {
  const entries: Array<{ key: string; html: string; label: string }> = []

  const normalizeHtml = (html: string) => html.trim()

  messages.forEach(message => {
    const blocks = parseContentBlocks(message.content_blocks)
    if (!blocks.length) return

    const groupsSource = buildToolCallGroupsFromBlocks(blocks)
    const seen = new Set<string>()

    groupsSource.forEach(group => {
      if (seen.has(group.id)) return
      seen.add(group.id)

      const htmlSeen = new Set<string>()
      const toolLabel = group.name || 'Tool Result'
      const isHtmlRenderer = (group.name ?? '').toLowerCase() === 'html_renderer'
      if (isHtmlRenderer && typeof group.args?.html === 'string') {
        const normalized = normalizeHtml(group.args.html)
        if (normalized.length > 0) {
          htmlSeen.add(normalized)
          entries.push({
            key: `${message.id}-html-renderer-${group.id}`,
            html: normalized,
            label: toolLabel,
          })
        }
      }

      group.results.forEach((result, resultIdx) => {
        const maybeHtml = extractHtmlFromToolResult(result.content)
        if (typeof maybeHtml !== 'string') return
        const normalized = normalizeHtml(maybeHtml)
        if (!normalized || htmlSeen.has(normalized)) return
        htmlSeen.add(normalized)
        entries.push({
          key: `${message.id}-${group.id}-result-${resultIdx}`,
          html: normalized,
          label: `${toolLabel} result ${resultIdx + 1}`,
        })
      })
    })
  })

  return entries
}

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
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [settings, setSettings] = useState<HtmlToolsSettings>(DEFAULT_SETTINGS)
  const hiddenHostRef = useRef<HTMLDivElement | null>(null)
  const bootstrapInFlightRef = useRef(false)

  const syncEntries = useCallback(() => {
    setEntries(Array.from(entriesRef.current.values()))
  }, [])

  const removeRecord = useCallback((key: string) => {
    const record = recordsRef.current.get(key)
    if (!record) return
    logHtmlTools('iframe-remove', { key })
    record.cleanup()
    record.iframe.remove()
    recordsRef.current.delete(key)
  }, [])

  useEffect(() => {
    recordsRef.current.forEach(record => {
      record.cleanup()
      record.iframe.remove()
    })
    recordsRef.current.clear()
    targetsRef.current.clear()
    entriesRef.current.clear()
    setEntries([])
    setFocusKey(null)
    setIsModalOpen(false)
  }, [resetKey])

  const removeEntryInternal = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return false
      removeRecord(key)
      entriesRef.current.delete(key)
      targetsRef.current.delete(key)
      if (focusKey === key) {
        setFocusKey(null)
      }
      return true
    },
    [focusKey, removeRecord]
  )

  const enforceLimits = useCallback(
    (now = Date.now()) => {
      const currentEntries = Array.from(entriesRef.current.values())
      if (currentEntries.length === 0) return false

      const removeKeys = new Set<string>()
      const hibernateKeys = new Set<string>()
      let changed = false

      if (settings.ttlMinutes > 0) {
        const cutoff = now - settings.ttlMinutes * 60 * 1000
        currentEntries.forEach(entry => {
          if (!entry.favorite && entry.lastUsedAt < cutoff) {
            removeKeys.add(entry.key)
          }
        })
      }

      const remainingEntries = currentEntries.filter(entry => !removeKeys.has(entry.key))

      if (settings.hibernateAfterMinutes > 0) {
        const cutoff = now - settings.hibernateAfterMinutes * 60 * 1000
        remainingEntries.forEach(entry => {
          if (entry.status === 'active' && entry.lastUsedAt < cutoff) {
            hibernateKeys.add(entry.key)
          }
        })
      }

      if (settings.maxActive > 0) {
        const activeEntries = remainingEntries.filter(
          entry => entry.status === 'active' && !hibernateKeys.has(entry.key)
        )
        if (activeEntries.length > settings.maxActive) {
          const sorted = [...activeEntries].sort((a, b) => a.lastUsedAt - b.lastUsedAt)
          let remainingActive = activeEntries.length
          for (const entry of sorted) {
            if (remainingActive <= settings.maxActive) break
            hibernateKeys.add(entry.key)
            remainingActive -= 1
          }
        }
      }

      hibernateKeys.forEach(key => {
        const entry = entriesRef.current.get(key)
        if (!entry || entry.status === 'hibernated') return
        entriesRef.current.set(key, {
          ...entry,
          status: 'hibernated',
          updatedAt: now,
        })
        targetsRef.current.set(key, null)
        removeRecord(key)
        changed = true
      })

      removeKeys.forEach(key => {
        if (removeEntryInternal(key)) {
          changed = true
        }
      })

      if (settings.maxCached > 0) {
        const nextEntries = Array.from(entriesRef.current.values())
        if (nextEntries.length > settings.maxCached) {
          const evictable = nextEntries
            .filter(entry => !entry.favorite)
            .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
          for (const entry of evictable) {
            if (entriesRef.current.size <= settings.maxCached) break
            if (removeEntryInternal(entry.key)) {
              changed = true
            }
          }
        }
      }

      if (settings.maxBytes > 0) {
        let totalBytes = Array.from(entriesRef.current.values()).reduce((sum, entry) => sum + entry.sizeBytes, 0)
        if (totalBytes > settings.maxBytes) {
          const evictable = Array.from(entriesRef.current.values())
            .filter(entry => !entry.favorite)
            .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
          for (const entry of evictable) {
            if (totalBytes <= settings.maxBytes) break
            if (removeEntryInternal(entry.key)) {
              changed = true
              totalBytes -= entry.sizeBytes
            }
          }
        }
      }

      if (changed) {
        syncEntries()
      }

      return changed
    },
    [removeEntryInternal, removeRecord, settings, syncEntries]
  )

  const registerEntry = useCallback((key: string, html: string, label?: string | null) => {
    const now = Date.now()
    const existingEntry = entriesRef.current.get(key)
    const nextLabel = label ?? existingEntry?.label ?? null
    const sizeBytes = getHtmlSizeBytes(html)
    const lastUsedAt =
      existingEntry && existingEntry.html === html ? existingEntry.lastUsedAt : existingEntry?.lastUsedAt ?? now
    const nextEntry: HtmlIframeEntry = {
      key,
      html,
      label: nextLabel,
      favorite: existingEntry?.favorite ?? false,
      status: existingEntry?.status ?? 'active',
      sizeBytes,
      createdAt: existingEntry?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existingEntry && existingEntry.html === html ? lastUsedAt : now,
    }
    if (
      !existingEntry ||
      existingEntry.html !== html ||
      existingEntry.label !== nextLabel ||
      existingEntry.favorite !== nextEntry.favorite ||
      existingEntry.status !== nextEntry.status ||
      existingEntry.sizeBytes !== nextEntry.sizeBytes ||
      existingEntry.lastUsedAt !== nextEntry.lastUsedAt
    ) {
      entriesRef.current.set(key, nextEntry)
      syncEntries()
      enforceLimits(now)
    }
  }, [enforceLimits, syncEntries])

  const setTarget = useCallback((key: string, target: HTMLElement | null) => {
    targetsRef.current.set(key, target)
    const record = recordsRef.current.get(key)
    const host = target ?? hiddenHostRef.current
    if (record && host && record.iframe.parentElement !== host) {
      logHtmlTools('iframe-move', { key, host: target ? 'slot' : 'hidden' })
      host.appendChild(record.iframe)
    }
  }, [])

  const updateIframe = useCallback((key: string, html: string, fullHeight: boolean, label?: string | null) => {
    let record = recordsRef.current.get(key)
    if (!record) {
      record = createIframeRecord(html, fullHeight)
      recordsRef.current.set(key, record)
      logHtmlTools('iframe-create', { key, fullHeight })
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

    const now = Date.now()
    const existingEntry = entriesRef.current.get(key)
    const nextLabel = label ?? existingEntry?.label ?? null
    const sizeBytes = getHtmlSizeBytes(html)
    const nextEntry: HtmlIframeEntry = {
      key,
      html,
      label: nextLabel,
      favorite: existingEntry?.favorite ?? false,
      status: existingEntry?.status === 'hibernated' ? 'active' : existingEntry?.status ?? 'active',
      sizeBytes,
      createdAt: existingEntry?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: existingEntry?.lastUsedAt ?? now,
    }
    if (
      !existingEntry ||
      existingEntry.html !== html ||
      existingEntry.label !== nextLabel ||
      existingEntry.favorite !== nextEntry.favorite ||
      existingEntry.status !== nextEntry.status ||
      existingEntry.sizeBytes !== nextEntry.sizeBytes
    ) {
      entriesRef.current.set(key, nextEntry)
      syncEntries()
      enforceLimits(now)
    }

    const target = targetsRef.current.get(key)
    const host = target ?? hiddenHostRef.current
    if (host && record.iframe.parentElement !== host) {
      host.appendChild(record.iframe)
    }
  }, [enforceLimits, syncEntries])

  const touchEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      const now = Date.now()
      entriesRef.current.set(key, {
        ...entry,
        lastUsedAt: now,
        updatedAt: now,
      })
      syncEntries()
    },
    [syncEntries]
  )

  const toggleFavorite = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      entriesRef.current.set(key, {
        ...entry,
        favorite: !entry.favorite,
        updatedAt: Date.now(),
      })
      syncEntries()
    },
    [syncEntries]
  )

  const hibernateEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry || entry.status === 'hibernated') return
      entriesRef.current.set(key, {
        ...entry,
        status: 'hibernated',
        updatedAt: Date.now(),
      })
      logHtmlTools('entry-hibernate', { key })
      targetsRef.current.set(key, null)
      removeRecord(key)
      syncEntries()
    },
    [removeRecord, syncEntries]
  )

  const restoreEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      const now = Date.now()
      entriesRef.current.set(key, {
        ...entry,
        status: 'active',
        lastUsedAt: now,
        updatedAt: now,
      })
      logHtmlTools('entry-restore', { key })
      syncEntries()
      enforceLimits(now)
    },
    [enforceLimits, syncEntries]
  )

  const removeEntry = useCallback(
    (key: string) => {
      if (removeEntryInternal(key)) {
        logHtmlTools('entry-remove', { key })
        syncEntries()
      }
    },
    [removeEntryInternal, syncEntries]
  )

  const bootstrapFromLocalCache = useCallback(
    async (userId: string) => {
      if (!userId || bootstrapInFlightRef.current) return
      bootstrapInFlightRef.current = true
      try {
        if (entriesRef.current.size > 0) return
        logHtmlTools('bootstrap-start', { userId })
        const conversations = await localApi.get<Conversation[]>(`/local/conversations?userId=${userId}`)
        if (!Array.isArray(conversations) || conversations.length === 0) return
        const sorted = [...conversations].sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        )
        const maxEntries = settings.maxCached > 0 ? settings.maxCached : Number.POSITIVE_INFINITY
        let added = 0
        const seenKeys = new Set<string>()

        for (const conversation of sorted) {
          if (!conversation?.id) continue
          if (added >= maxEntries) break
          try {
            logHtmlTools('bootstrap-conversation', { id: conversation.id })
            const result = await localApi.get<{ messages: Message[] }>(
              `/local/conversations/${conversation.id}/messages/tree`
            )
            const messages = Array.isArray(result?.messages) ? result.messages : []
            const cachedEntries = buildHtmlEntriesFromMessages(messages)
            cachedEntries.forEach(entry => {
              if (added >= maxEntries) return
              if (seenKeys.has(entry.key) || entriesRef.current.has(entry.key)) return
              seenKeys.add(entry.key)
              registerEntry(entry.key, entry.html, entry.label)
              added += 1
            })
          } catch (err) {
            console.error('[HtmlTools] bootstrap conversation failed', conversation.id, err)
          }
        }

        logHtmlTools('bootstrap-entries', { count: added })
      } catch (err) {
        console.error('[HtmlTools] bootstrap failed', err)
      } finally {
        bootstrapInFlightRef.current = false
      }
    },
    [registerEntry, settings.maxCached]
  )

  const openModal = useCallback(
    (key?: string | null) => {
      if (key) {
        const entry = entriesRef.current.get(key)
        if (entry) {
          const now = Date.now()
          entriesRef.current.set(key, {
            ...entry,
            status: 'active',
            lastUsedAt: now,
            updatedAt: now,
          })
          syncEntries()
          enforceLimits(now)
        }
        setFocusKey(key)
      } else {
        setFocusKey(null)
      }
      setIsModalOpen(true)
    },
    [enforceLimits, syncEntries]
  )

  const closeModal = useCallback(() => {
    setIsModalOpen(false)
    setFocusKey(null)
  }, [])

  const updateSettings = useCallback((updates: Partial<HtmlToolsSettings>) => {
    setSettings(prev => {
      const merged = { ...prev, ...updates }
      return {
        ...merged,
        maxActive: normalizeLimit(merged.maxActive),
        maxCached: normalizeLimit(merged.maxCached),
        maxBytes: normalizeLimit(merged.maxBytes),
        ttlMinutes: normalizeLimit(merged.ttlMinutes),
        hibernateAfterMinutes: normalizeLimit(merged.hibernateAfterMinutes),
      }
    })
  }, [])

  useEffect(() => {
    enforceLimits()
  }, [enforceLimits, settings])

  useEffect(() => {
    const interval = window.setInterval(() => {
      enforceLimits()
    }, 60 * 1000)
    return () => window.clearInterval(interval)
  }, [enforceLimits])

  const contextValue = useMemo(
    () => ({
      entries,
      registerEntry,
      updateIframe,
      setTarget,
      isModalOpen,
      focusKey,
      openModal,
      closeModal,
      touchEntry,
      toggleFavorite,
      hibernateEntry,
      restoreEntry,
      removeEntry,
      bootstrapFromLocalCache,
      settings,
      updateSettings,
    }),
    [
      bootstrapFromLocalCache,
      closeModal,
      entries,
      focusKey,
      hibernateEntry,
      isModalOpen,
      openModal,
      registerEntry,
      removeEntry,
      restoreEntry,
      setTarget,
      settings,
      toggleFavorite,
      touchEntry,
      updateIframe,
      updateSettings,
    ]
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
  const registryRef = useRef(registry)
  const slotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    registryRef.current = registry
  }, [registry])

  useEffect(() => {
    logHtmlTools('slot-mount', { key: iframeKey })
    return () => {
      logHtmlTools('slot-unmount', { key: iframeKey })
    }
  }, [iframeKey])

  useEffect(() => {
    if (!registryRef.current) return
    registryRef.current.updateIframe(iframeKey, html, fullHeight)
  }, [iframeKey, html, fullHeight])

  useLayoutEffect(() => {
    const node = slotRef.current
    if (!node || !registryRef.current) return
    registryRef.current.setTarget(iframeKey, node)
    return () => {
      registryRef.current?.setTarget(iframeKey, null)
    }
  }, [iframeKey])

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
