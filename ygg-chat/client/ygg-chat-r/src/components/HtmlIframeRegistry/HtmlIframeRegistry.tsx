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
import { useQueryClient } from '@tanstack/react-query'
import type { Message, ContentBlock } from '../../features/chats/chatTypes'
import type { Conversation } from '../../features/conversations/conversationTypes'
import { useAuth } from '../../hooks/useAuth'
import { getHtmlToolsFromCache, htmlToolsQueryKey, type HtmlToolRecord, useHtmlToolsCache } from '../../hooks/useQueries'
import { environment, localApi } from '../../utils/api'

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
  conversationId?: string | null
  projectId?: string | null
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
  registerEntry: (
    key: string,
    html: string,
    label?: string | null,
    meta?: { conversationId?: string | null; projectId?: string | null }
  ) => void
  updateIframe: (
    key: string,
    html: string,
    fullHeight: boolean,
    label?: string | null,
    meta?: { conversationId?: string | null; projectId?: string | null }
  ) => void
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

const isElectronEnv =
  (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__) || environment === 'electron'

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

const toCacheRecord = (entry: HtmlIframeEntry, userId: string): HtmlToolRecord => ({
  key: entry.key,
  html: entry.html,
  label: entry.label,
  favorite: entry.favorite ? 1 : 0,
  status: entry.status,
  size_bytes: entry.sizeBytes,
  created_at: entry.createdAt,
  updated_at: entry.updatedAt,
  last_used_at: entry.lastUsedAt,
  user_id: userId,
  conversation_id: entry.conversationId ?? null,
  project_id: entry.projectId ?? null,
})

const fromCacheRecord = (record: HtmlToolRecord): HtmlIframeEntry => ({
  key: record.key,
  html: record.html,
  label: record.label ?? null,
  favorite: Boolean(record.favorite),
  status: record.status === 'hibernated' ? 'hibernated' : 'active',
  sizeBytes: Number.isFinite(record.size_bytes) ? record.size_bytes : getHtmlSizeBytes(record.html),
  createdAt: Number.isFinite(record.created_at) ? record.created_at : Date.now(),
  updatedAt: Number.isFinite(record.updated_at) ? record.updated_at : Date.now(),
  lastUsedAt: Number.isFinite(record.last_used_at) ? record.last_used_at : Date.now(),
  conversationId: record.conversation_id ?? null,
  projectId: record.project_id ?? null,
})

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
  const entries: Array<{ key: string; html: string; label: string; conversationId?: string | null }> = []

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
            conversationId: message.conversation_id ?? null,
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
          conversationId: message.conversation_id ?? null,
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
  const streamTargets = new Set<string>()
  const pendingStreamEvents = new Map<string, Array<{ type: string; payload: any }>>()
  let awaitingStreamResponse = 0
  const electronAPI = (window as any).electronAPI

  const emitStreamEvent = (type: string, payload: any) => {
    const streamId = payload?.streamId
    if (!streamId) return
    iframe.contentWindow?.postMessage({ type, ...payload }, '*')
    if (
      type === 'FS_READ_FILE_STREAM_END' ||
      type === 'FS_READ_FILE_STREAM_ERROR' ||
      type === 'FS_READ_FILE_STREAM_ABORTED'
    ) {
      streamTargets.delete(streamId)
      pendingStreamEvents.delete(streamId)
    }
  }

  const forwardStreamEvent = (type: string, payload: any) => {
    const streamId = payload?.streamId
    if (!streamId) return
    if (!streamTargets.has(streamId)) {
      if (awaitingStreamResponse > 0) {
        const pending = pendingStreamEvents.get(streamId) || []
        pending.push({ type, payload })
        pendingStreamEvents.set(streamId, pending)
      }
      return
    }
    emitStreamEvent(type, payload)
  }

  const flushPendingEvents = (streamId: string) => {
    const pending = pendingStreamEvents.get(streamId)
    if (!pending || pending.length === 0) return
    pending.forEach(entry => emitStreamEvent(entry.type, entry.payload))
    pendingStreamEvents.delete(streamId)
  }

  const streamCleanupFns: Array<(() => void) | undefined> = []
  if (electronAPI?.fs?.onReadFileStreamChunk) {
    streamCleanupFns.push(
      electronAPI.fs.onReadFileStreamChunk((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_CHUNK', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamProgress) {
    streamCleanupFns.push(
      electronAPI.fs.onReadFileStreamProgress((payload: any) =>
        forwardStreamEvent('FS_READ_FILE_STREAM_PROGRESS', payload)
      )
    )
  }
  if (electronAPI?.fs?.onReadFileStreamEnd) {
    streamCleanupFns.push(
      electronAPI.fs.onReadFileStreamEnd((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_END', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamError) {
    streamCleanupFns.push(
      electronAPI.fs.onReadFileStreamError((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_ERROR', payload))
    )
  }
  if (electronAPI?.fs?.onReadFileStreamAborted) {
    streamCleanupFns.push(
      electronAPI.fs.onReadFileStreamAborted((payload: any) => forwardStreamEvent('FS_READ_FILE_STREAM_ABORTED', payload))
    )
  }

  const handleMessage = async (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow) {
      return
    }

    const { type, requestId, options } = event.data || {}
    if (!type || !requestId) return

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
        case 'FS_READ_FILE_STREAM':
          if (electronAPI?.fs?.readFileStream) {
            awaitingStreamResponse += 1
            try {
              response = await electronAPI.fs.readFileStream(options?.filePath, {
                encoding: options?.encoding,
                highWaterMark: options?.highWaterMark,
              })
              if (response?.success && response?.streamId) {
                streamTargets.add(response.streamId)
                flushPendingEvents(response.streamId)
              }
            } catch (err) {
              response = { success: false, error: String(err) }
            } finally {
              awaitingStreamResponse = Math.max(0, awaitingStreamResponse - 1)
              if (awaitingStreamResponse === 0) {
                pendingStreamEvents.clear()
              }
            }
          } else {
            response = { success: false, error: 'File stream not available (not in Electron)' }
          }
          break
        case 'FS_STAT':
          if (electronAPI?.fs?.stat) {
            response = await electronAPI.fs.stat(options?.filePath)
          } else {
            response = { success: false, error: 'File stat not available (not in Electron)' }
          }
          break
        case 'FS_ABORT':
          if (electronAPI?.fs?.abortReadFileStream) {
            response = await electronAPI.fs.abortReadFileStream(options?.streamId)
          } else {
            response = { success: false, error: 'Stream abort not available (not in Electron)' }
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
  return () => {
    window.removeEventListener('message', handleMessage)
    streamCleanupFns.forEach(cleanup => cleanup?.())
    streamTargets.clear()
    pendingStreamEvents.clear()
  }
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
  const queryClient = useQueryClient()
  const { userId } = useAuth()
  const toolsQuery = useHtmlToolsCache(userId, isElectronEnv)
  const pendingUpsertsRef = useRef<Map<string, HtmlIframeEntry>>(new Map())
  const pendingDeletesRef = useRef<Set<string>>(new Set())
  const flushTimeoutRef = useRef<number | null>(null)
  const lastQuerySyncRef = useRef<string | null>(null)

  const syncEntries = useCallback((nextEntries?: HtmlIframeEntry[]) => {
    setEntries(nextEntries ?? Array.from(entriesRef.current.values()))
  }, [])

  const updateCacheEntry = useCallback(
    (entry: HtmlIframeEntry) => {
      if (!userId) return
      queryClient.setQueryData<HtmlToolRecord[]>(htmlToolsQueryKey(userId), prev => {
        const next = prev ? [...prev] : []
        const record = toCacheRecord(entry, userId)
        const index = next.findIndex(item => item.key === entry.key)
        if (index >= 0) {
          next[index] = { ...next[index], ...record }
        } else {
          next.push(record)
        }
        return next
      })
    },
    [queryClient, userId]
  )

  const removeCacheEntry = useCallback(
    (key: string) => {
      if (!userId) return
      queryClient.setQueryData<HtmlToolRecord[]>(htmlToolsQueryKey(userId), prev =>
        prev ? prev.filter(item => item.key !== key) : []
      )
    },
    [queryClient, userId]
  )

  const syncEntriesFromCache = useCallback(
    (records: HtmlToolRecord[]) => {
      if (!Array.isArray(records) || records.length === 0) return
      const nextEntries = records.map(fromCacheRecord)
      entriesRef.current = new Map(nextEntries.map(entry => [entry.key, entry]))
      syncEntries(nextEntries)
    },
    [syncEntries]
  )

  const flushPersist = useCallback(async () => {
    if (!userId || !isElectronEnv) return
    const pendingUpserts = Array.from(pendingUpsertsRef.current.values())
    const pendingDeletes = Array.from(pendingDeletesRef.current.values())
    pendingUpsertsRef.current.clear()
    pendingDeletesRef.current.clear()

    try {
      if (pendingUpserts.length > 0) {
        await localApi.post('/local/tools/bulk', {
          userId,
          tools: pendingUpserts.map(entry => ({
            key: entry.key,
            html: entry.html,
            label: entry.label,
            favorite: entry.favorite,
            status: entry.status,
            sizeBytes: entry.sizeBytes,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            lastUsedAt: entry.lastUsedAt,
            conversationId: entry.conversationId ?? null,
            projectId: entry.projectId ?? null,
          })),
        })
      }

      if (pendingDeletes.length > 0) {
        await Promise.all(
          pendingDeletes.map(key =>
            localApi.delete(`/local/tools/${encodeURIComponent(key)}?userId=${encodeURIComponent(userId)}`)
          )
        )
      }
    } catch (err) {
      console.error('[HtmlTools] persist failed', err)
    }
  }, [userId])

  const queuePersistUpsert = useCallback(
    (entry: HtmlIframeEntry) => {
      if (!userId || !isElectronEnv) return
      pendingUpsertsRef.current.set(entry.key, entry)
      pendingDeletesRef.current.delete(entry.key)
      if (flushTimeoutRef.current) return
      flushTimeoutRef.current = window.setTimeout(() => {
        flushTimeoutRef.current = null
        void flushPersist()
      }, 800)
    },
    [flushPersist, userId]
  )

  const queuePersistDelete = useCallback(
    (key: string) => {
      if (!userId || !isElectronEnv) return
      pendingUpsertsRef.current.delete(key)
      pendingDeletesRef.current.add(key)
      if (flushTimeoutRef.current) return
      flushTimeoutRef.current = window.setTimeout(() => {
        flushTimeoutRef.current = null
        void flushPersist()
      }, 800)
    },
    [flushPersist, userId]
  )

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
    pendingUpsertsRef.current.clear()
    pendingDeletesRef.current.clear()
    if (flushTimeoutRef.current) {
      window.clearTimeout(flushTimeoutRef.current)
      flushTimeoutRef.current = null
    }
    setEntries([])
    setFocusKey(null)
    setIsModalOpen(false)
  }, [resetKey])

  useEffect(() => {
    if (!userId || entriesRef.current.size > 0) return
    if (!toolsQuery.data || toolsQuery.data.length === 0) return
    syncEntriesFromCache(toolsQuery.data)
  }, [syncEntriesFromCache, toolsQuery.data, userId])

  useEffect(() => {
    if (!userId || entries.length > 0) return
    const cached = getHtmlToolsFromCache(queryClient, userId)
    if (cached.length === 0) return
    syncEntriesFromCache(cached)
  }, [entries.length, queryClient, syncEntriesFromCache, userId])

  useEffect(() => {
    if (!userId || !isElectronEnv) return
    const signature = entries.map(entry => `${entry.key}:${entry.updatedAt}`).join('|')
    if (signature === lastQuerySyncRef.current) return
    lastQuerySyncRef.current = signature
    queryClient.setQueryData<HtmlToolRecord[]>(htmlToolsQueryKey(userId), entries.map(entry => toCacheRecord(entry, userId)))
  }, [entries, queryClient, userId])

  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        window.clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      void flushPersist()
    }
  }, [flushPersist])

  const removeEntryInternal = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return false
      removeRecord(key)
      entriesRef.current.delete(key)
      targetsRef.current.delete(key)
      removeCacheEntry(key)
      queuePersistDelete(key)
      if (focusKey === key) {
        setFocusKey(null)
      }
      return true
    },
    [focusKey, queuePersistDelete, removeCacheEntry, removeRecord]
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
        const nextEntry: HtmlIframeEntry = {
          ...entry,
          status: 'hibernated',
          updatedAt: now,
        }
        entriesRef.current.set(key, nextEntry)
        targetsRef.current.set(key, null)
        removeRecord(key)
        updateCacheEntry(nextEntry)
        queuePersistUpsert(nextEntry)
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
    [queuePersistUpsert, removeEntryInternal, removeRecord, settings, syncEntries, updateCacheEntry]
  )

  const registerEntry = useCallback(
    (
      key: string,
      html: string,
      label?: string | null,
      meta?: { conversationId?: string | null; projectId?: string | null }
    ) => {
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
        conversationId: meta?.conversationId ?? existingEntry?.conversationId ?? null,
        projectId: meta?.projectId ?? existingEntry?.projectId ?? null,
      }
      if (
        !existingEntry ||
        existingEntry.html !== html ||
        existingEntry.label !== nextLabel ||
        existingEntry.favorite !== nextEntry.favorite ||
        existingEntry.status !== nextEntry.status ||
        existingEntry.sizeBytes !== nextEntry.sizeBytes ||
        existingEntry.lastUsedAt !== nextEntry.lastUsedAt ||
        existingEntry.conversationId !== nextEntry.conversationId ||
        existingEntry.projectId !== nextEntry.projectId
      ) {
        entriesRef.current.set(key, nextEntry)
        updateCacheEntry(nextEntry)
        queuePersistUpsert(nextEntry)
        syncEntries()
        enforceLimits(now)
      }
    },
    [enforceLimits, queuePersistUpsert, syncEntries, updateCacheEntry]
  )

  const setTarget = useCallback((key: string, target: HTMLElement | null) => {
    targetsRef.current.set(key, target)
    const record = recordsRef.current.get(key)
    const host = target ?? hiddenHostRef.current
    if (record && host && record.iframe.parentElement !== host) {
      logHtmlTools('iframe-move', { key, host: target ? 'slot' : 'hidden' })
      host.appendChild(record.iframe)
    }
  }, [])

  const updateIframe = useCallback(
    (
      key: string,
      html: string,
      fullHeight: boolean,
      label?: string | null,
      meta?: { conversationId?: string | null; projectId?: string | null }
    ) => {
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
        conversationId: meta?.conversationId ?? existingEntry?.conversationId ?? null,
        projectId: meta?.projectId ?? existingEntry?.projectId ?? null,
      }
      if (
        !existingEntry ||
        existingEntry.html !== html ||
        existingEntry.label !== nextLabel ||
        existingEntry.favorite !== nextEntry.favorite ||
        existingEntry.status !== nextEntry.status ||
        existingEntry.sizeBytes !== nextEntry.sizeBytes ||
        existingEntry.conversationId !== nextEntry.conversationId ||
        existingEntry.projectId !== nextEntry.projectId
      ) {
        entriesRef.current.set(key, nextEntry)
        updateCacheEntry(nextEntry)
        queuePersistUpsert(nextEntry)
        syncEntries()
        enforceLimits(now)
      }

      const target = targetsRef.current.get(key)
      const host = target ?? hiddenHostRef.current
      if (host && record.iframe.parentElement !== host) {
        host.appendChild(record.iframe)
      }
    },
    [enforceLimits, queuePersistUpsert, syncEntries, updateCacheEntry]
  )

  const touchEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      const now = Date.now()
      const nextEntry: HtmlIframeEntry = {
        ...entry,
        lastUsedAt: now,
        updatedAt: now,
      }
      entriesRef.current.set(key, nextEntry)
      updateCacheEntry(nextEntry)
      queuePersistUpsert(nextEntry)
      syncEntries()
    },
    [queuePersistUpsert, syncEntries, updateCacheEntry]
  )

  const toggleFavorite = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      const nextEntry: HtmlIframeEntry = {
        ...entry,
        favorite: !entry.favorite,
        updatedAt: Date.now(),
      }
      entriesRef.current.set(key, nextEntry)
      updateCacheEntry(nextEntry)
      queuePersistUpsert(nextEntry)
      syncEntries()
    },
    [queuePersistUpsert, syncEntries, updateCacheEntry]
  )

  const hibernateEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry || entry.status === 'hibernated') return
      const nextEntry: HtmlIframeEntry = {
        ...entry,
        status: 'hibernated',
        updatedAt: Date.now(),
      }
      entriesRef.current.set(key, nextEntry)
      logHtmlTools('entry-hibernate', { key })
      targetsRef.current.set(key, null)
      removeRecord(key)
      updateCacheEntry(nextEntry)
      queuePersistUpsert(nextEntry)
      syncEntries()
    },
    [queuePersistUpsert, removeRecord, syncEntries, updateCacheEntry]
  )

  const restoreEntry = useCallback(
    (key: string) => {
      const entry = entriesRef.current.get(key)
      if (!entry) return
      const now = Date.now()
      const nextEntry: HtmlIframeEntry = {
        ...entry,
        status: 'active',
        lastUsedAt: now,
        updatedAt: now,
      }
      entriesRef.current.set(key, nextEntry)
      logHtmlTools('entry-restore', { key })
      updateCacheEntry(nextEntry)
      queuePersistUpsert(nextEntry)
      syncEntries()
      enforceLimits(now)
    },
    [enforceLimits, queuePersistUpsert, syncEntries, updateCacheEntry]
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
        const cachedTools = getHtmlToolsFromCache(queryClient, userId)
        if (cachedTools.length > 0) {
          syncEntriesFromCache(cachedTools)
          return
        }

        if (isElectronEnv) {
          const tools = await localApi.get<HtmlToolRecord[]>(`/local/tools?userId=${userId}`)
          if (Array.isArray(tools) && tools.length > 0) {
            queryClient.setQueryData(htmlToolsQueryKey(userId), tools)
            syncEntriesFromCache(tools)
            return
          }
        }

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
              registerEntry(entry.key, entry.html, entry.label, { conversationId: entry.conversationId ?? null })
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
    [queryClient, registerEntry, settings.maxCached, syncEntriesFromCache]
  )

  const openModal = useCallback(
    (key?: string | null) => {
      if (key) {
        const entry = entriesRef.current.get(key)
        if (entry) {
          const now = Date.now()
          const nextEntry: HtmlIframeEntry = {
            ...entry,
            status: 'active',
            lastUsedAt: now,
            updatedAt: now,
          }
          entriesRef.current.set(key, nextEntry)
          updateCacheEntry(nextEntry)
          queuePersistUpsert(nextEntry)
          syncEntries()
          enforceLimits(now)
        }
        setFocusKey(key)
      } else {
        setFocusKey(null)
      }
      setIsModalOpen(true)
    },
    [enforceLimits, queuePersistUpsert, syncEntries, updateCacheEntry]
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
