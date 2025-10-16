import { useQueryClient } from '@tanstack/react-query'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { MessageId } from '../../../../shared/types'
import { Button, ChatMessage, Heimdall, InputTextArea, Select, SettingsPane, TextField } from '../components'
import {
  abortStreaming,
  chatSliceActions,
  deleteMessage,
  editMessageWithBranching,
  fetchModelsForCurrentProvider,
  initializeUserAndConversation,
  Message,
  Model,
  refreshCurrentPathAfterDelete,
  selectConversationMessages,
  selectCurrentConversationId,
  selectCurrentPath,
  selectDisplayMessages,
  selectFocusedChatMessageId,
  selectHeimdallCompactMode,
  selectHeimdallData,
  selectHeimdallError,
  selectHeimdallLoading,
  selectMessageInput,
  // Chat selectors
  selectModels,
  selectMultiReplyCount,
  selectProviderState,
  selectSelectedModel,
  selectSendingState,
  selectStreamState,
  sendMessage,
  updateConversationTitle,
  updateMessage,
} from '../features/chats'
import { buildBranchPathForMessage } from '../features/chats/pathUtils'
import {
  convContextSet,
  Conversation,
  conversationsLoaded,
  fetchRecentModels,
  makeSelectConversationById,
  selectRecentModels,
  systemPromptSet,
} from '../features/conversations'
import { removeSelectedFileForChat, updateIdeContext } from '../features/ideContext'
import { selectSelectedFilesForChat, selectWorkspace } from '../features/ideContext/ideContextSelectors'
import { selectSelectedProject } from '../features/projects/projectSelectors'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { useIdeContext } from '../hooks/useIdeContext'
import { useConversationMessages, useConversationsByProject } from '../hooks/useQueries'
import { cloneConversation } from '../utils/api'
import { parseId } from '../utils/helpers'

function Chat() {
  const dispatch = useAppDispatch()
  const { accessToken } = useAuth()
  const { ideContext } = useIdeContext()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Local state for input to completely avoid Redux dispatches during typing
  const [localInput, setLocalInput] = useState('')

  // Get conversation ID and project ID from URL params FIRST (before any hooks that depend on it)
  const { id: conversationIdParam, projectId: projectIdParam } = useParams<{ id?: string; projectId?: string }>()
  const conversationIdFromUrl = conversationIdParam ? parseId(conversationIdParam) : null
  const projectIdFromUrl = projectIdParam || null

  // Redux selectors
  const models = useAppSelector(selectModels)
  const selectedModel = useAppSelector(selectSelectedModel)
  const providers = useAppSelector(selectProviderState)
  const messageInput = useAppSelector(selectMessageInput)
  // const canSendFromRedux = useAppSelector(selectCanSend)
  const sendingState = useAppSelector(selectSendingState)
  const streamState = useAppSelector(selectStreamState)
  const conversationMessages = useAppSelector(selectConversationMessages)
  const displayMessages = useAppSelector(selectDisplayMessages)
  const currentConversationId = useAppSelector(selectCurrentConversationId)

  // React Query for message fetching (automatic deduplication and caching)
  // Use URL-derived ID to ensure correct fetching even on page refresh
  // Single request fetches both messages AND tree data to eliminate duplicate requests
  const { data: conversationData } = useConversationMessages(conversationIdFromUrl)
  const reactQueryMessages = conversationData?.messages || []
  const treeData = conversationData?.tree
  const selectedPath = useAppSelector(selectCurrentPath)
  const multiReplyCount = useAppSelector(selectMultiReplyCount)
  const focusedChatMessageId = useAppSelector(selectFocusedChatMessageId)
  // const ideContext = useAppSelector(selectIdeContext)
  const workspace = useAppSelector(selectWorkspace)
  // const isIdeConnected = useAppSelector(selectIsIdeConnected)
  // const activeFile = useAppSelector(selectActiveFile)
  const selectedFilesForChat = useAppSelector(selectSelectedFilesForChat)
  const optimisticMessage = useAppSelector(state => state.chat.composition.optimisticMessage)
  const optimisticBranchMessage = useAppSelector(state => state.chat.composition.optimisticBranchMessage)

  // File chip expanded modal state
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  // Temporary closing state to animate back to hover size before hiding
  const [closingFilePath, setClosingFilePath] = useState<string | null>(null)
  // Temporary opening state to blur content while expanding
  const [openingFilePath, setOpeningFilePath] = useState<string | null>(null)
  // Anchor position for fixed expanded panel (viewport coords)
  const [expandedAnchor, setExpandedAnchor] = useState<{ left: number; top: number } | null>(null)
  // Local copy of model list to prioritize recent models
  const [localModel, setLocalModel] = useState<Model[] | null>(null)
  // Dynamic input area height for adaptive padding
  const [inputAreaHeight, setInputAreaHeight] = useState(170)

  const handleCloseExpandedPreview = useCallback(() => {
    if (!expandedFilePath) return
    const path = expandedFilePath
    setExpandedFilePath(null)
    setClosingFilePath(path)
    // Match transition duration (100ms)
    window.setTimeout(() => setClosingFilePath(null), 130)
  }, [expandedFilePath])

  const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const handleRemoveFileSelection = useCallback(
    (file: { path: string; relativePath: string; name?: string }) => {
      // Remove from selected files in Redux
      dispatch(removeSelectedFileForChat(file.path))

      // Also remove the textual @mention from the local input value
      const mentionName = file.name || file.path.split('/').pop() || file.relativePath.split('/').pop() || ''
      if (mentionName) {
        const mentionRegex = new RegExp(`@${escapeRegExp(mentionName)}(\\b|$)\\s*`, 'g')
        setLocalInput(prev => prev.replace(mentionRegex, ''))
      }
    },
    [dispatch]
  )

  const replaceFileMentionsWithPath = useCallback(
    // Renamed for clarity; revert if preferred.
    (message: string): string => {
      // Input: a string message. Output: modified string with full paths inserted.
      if (!message || typeof message !== 'string') return message || '' // Early return for invalid/empty input.

      // Build a lookup map of mentionable names -> full paths (changed from contents).
      const nameToPath = new Map<string, string>() // Renamed Map for clarity.

      // Helper function to extract basename (filename without full path).
      // Handles both Windows (\) and Unix (/) path separators.
      const basename = (p: string) => {
        if (!p) return p
        const parts = p.split(/\\\\|\//) // Regex splits on \\ (escaped for JS) or /.
        return parts[parts.length - 1] // Returns the last part (e.g., 'api.ts' from '/src/api.ts').
      }

      // Populate the Map from selected files (assuming selectedFilesForChat is SelectedFileContent[]).
      // Adds multiple variations of the filename as keys for flexible matching.
      // Values are now f.path (full path).
      for (const f of selectedFilesForChat) {
        if (f.name && !nameToPath.has(f.name)) nameToPath.set(f.name, f.path)
        const baseRel = basename(f.relativePath)
        if (baseRel && !nameToPath.has(baseRel)) nameToPath.set(baseRel, f.path)
        const basePath = basename(f.path)
        if (basePath && !nameToPath.has(basePath)) nameToPath.set(basePath, f.path)
      }

      // Replace mentions in the message.
      // Regex: Matches @ followed by alphanumeric, dot (.), underscore (_), slash (/), dash (-).
      const mentionRegex = /@([A-Za-z0-9._\/-]+)/g // 'g' flag for global replacement.
      return message.replace(mentionRegex, (full: string, mName: string) => {
        // For each match: Look up full path by captured name (mName).
        // If found, replace with path; otherwise, keep original.
        const path = nameToPath.get(mName)
        return path != null ? path : full
      })
    },
    [selectedFilesForChat] // Dependency array: Re-creates if selectedFilesForChat changes.
  )

  // Ref for auto-scroll
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  // Track whether the upcoming selection change came from an explicit user click in Heimdall
  const selectionScrollCauseRef = useRef<'user' | null>(null)
  // Track if the user manually scrolled during the current stream; disables bottom pin until finished
  const userScrolledDuringStreamRef = useRef<boolean>(false)
  // Sentinel at the end of the list for robust bottom scrolling
  const bottomRef = useRef<HTMLDivElement>(null)
  // rAF id to coalesce frequent scroll requests during streaming
  const scrollRafRef = useRef<number | null>(null)
  // Remember the last focused message we already scrolled to (to avoid repeated jumps)
  const lastFocusedScrollIdRef = useRef<MessageId | null>(null)
  // Track the most visible message ID for Heimdall highlighting
  const [visibleMessageId, setVisibleMessageId] = useState<MessageId | null>(null)
  // Ref for input area to measure its height dynamically
  const inputAreaRef = useRef<HTMLDivElement>(null)

  // Track if we already applied the URL hash-based path to avoid overriding user branch switches
  const hashAppliedRef = useRef<MessageId | null>(null)

  // Lock page scroll while chat is mounted
  useEffect(() => {
    const prevDocOverflow = document.documentElement.style.overflow
    const prevBodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = 'hidden'
    document.body.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = prevDocOverflow
      document.body.style.overflow = prevBodyOverflow
    }
  }, [])

  // Measure input area height dynamically with ResizeObserver
  useEffect(() => {
    const inputArea = inputAreaRef.current
    if (!inputArea) return

    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const height = entry.contentRect.height
        if (height > 0) {
          setInputAreaHeight(height)
        }
      }
    })

    observer.observe(inputArea)

    // Initial measurement
    const initialHeight = inputArea.getBoundingClientRect().height
    if (initialHeight > 0) {
      setInputAreaHeight(initialHeight)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  // Consider the user to be "at the bottom" if within this many pixels
  const NEAR_BOTTOM_PX = 48
  const isNearBottom = (el: HTMLElement, threshold = NEAR_BOTTOM_PX) => {
    // Distance remaining to bottom within the scroll container
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    return remaining <= threshold
  }

  // Heimdall state from Redux
  const heimdallData = useAppSelector(selectHeimdallData)
  const loading = useAppSelector(selectHeimdallLoading)
  const error = useAppSelector(selectHeimdallError)
  const compactMode = useAppSelector(selectHeimdallCompactMode)
  const recentModels = useAppSelector(selectRecentModels)
  const selectedProject = useAppSelector(selectSelectedProject)
  // Conversation title editing
  const currentConversation = useAppSelector(
    currentConversationId ? makeSelectConversationById(currentConversationId) : () => null
  )
  // Fetch conversations for the current project using React Query
  // Use projectId from URL first (ensures correct cache is active on page refresh)
  const { data: projectConversations = [] } = useConversationsByProject(
    projectIdFromUrl || selectedProject?.id || currentConversation?.project_id || null
  )
  const [titleInput, setTitleInput] = useState(currentConversation?.title ?? '')
  const [editingTitle, setEditingTitle] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [cloningConversation, setCloningConversation] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setTitleInput(currentConversation?.title ?? '')
  }, [currentConversation?.title])

  // Close options dropdown on outside click
  useEffect(() => {
    if (!optionsOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [optionsOpen])

  // Debounce title updates to avoid dispatching on every keystroke
  useEffect(() => {
    if (!currentConversationId) return
    const trimmed = titleInput.trim()
    const currentTrimmed = (currentConversation?.title ?? '').trim()
    // No-op if unchanged
    if (trimmed === currentTrimmed) return
    const handle = setTimeout(() => {
      dispatch(updateConversationTitle({ id: currentConversationId, title: trimmed }))
        .unwrap()
        .then(() => {
          // Update React Query caches to reflect the new title
          const projectId = selectedProject?.id || currentConversation?.project_id

          // Update all conversations cache
          const conversationsCache = queryClient.getQueryData<Conversation[]>(['conversations'])
          if (conversationsCache) {
            queryClient.setQueryData(
              ['conversations'],
              conversationsCache.map(conv => (conv.id === currentConversationId ? { ...conv, title: trimmed } : conv))
            )
          }

          // Update project conversations cache if project exists
          if (projectId) {
            const projectConversationsCache = queryClient.getQueryData<Conversation[]>([
              'conversations',
              'project',
              projectId,
            ])
            if (projectConversationsCache) {
              queryClient.setQueryData(
                ['conversations', 'project', projectId],
                projectConversationsCache.map(conv =>
                  conv.id === currentConversationId ? { ...conv, title: trimmed } : conv
                )
              )
            }
          }

          // Update recent conversations cache
          const recentCache = queryClient.getQueryData<Conversation[]>(['conversations', 'recent'])
          if (recentCache) {
            queryClient.setQueryData(
              ['conversations', 'recent'],
              recentCache.map(conv => (conv.id === currentConversationId ? { ...conv, title: trimmed } : conv))
            )
          }
        })
        .catch(error => {
          console.error('Failed to update conversation title:', error)
        })
    }, 1000)
    return () => clearTimeout(handle)
  }, [titleInput, currentConversationId, currentConversation?.title, dispatch, queryClient, selectedProject?.id])

  // Sync React Query messages to Redux when they arrive
  // This keeps Redux state updated for components that still depend on it
  useEffect(() => {
    if (reactQueryMessages && reactQueryMessages.length > 0) {
      dispatch(chatSliceActions.messagesLoaded(reactQueryMessages))
    }
  }, [reactQueryMessages, dispatch])

  // Sync tree data to Redux when it arrives
  // Always dispatch even when treeData is null/undefined to keep Redux in sync with React Query
  useEffect(() => {
    dispatch(chatSliceActions.heimdallDataLoaded({ treeData }))
  }, [treeData, dispatch])

  // Sync React Query conversations to Redux to ensure system_prompt and conversation_context are available
  // This fixes the issue where refreshing the page doesn't load context and system prompt from query cache
  useEffect(() => {
    if (projectConversations && projectConversations.length > 0) {
      dispatch(conversationsLoaded(projectConversations))
    }
  }, [projectConversations, dispatch])

  // Conversations are now fetched via React Query in Homepage/ConversationPage/SideBar
  // No need to fetch here - React Query automatically shares cached data across all components
  // This eliminates duplicate requests and rate limiting issues

  // Sort conversations by updated_at descending for the Select dropdown
  const sortedConversations = useMemo(() => {
    const projectId = selectedProject?.id || currentConversation?.project_id
    if (!projectId) return []

    return [...projectConversations].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [projectConversations, selectedProject?.id, currentConversation?.project_id])

  // Resizable split-pane state
  const containerRef = useRef<HTMLDivElement>(null)
  const [leftWidthPct, setLeftWidthPct] = useState<number>(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('chat:leftWidthPct') : null
      const n = stored ? parseFloat(stored) : NaN
      return Number.isFinite(n) ? Math.min(80, Math.max(20, n)) : 55
    } catch {
      return 55
    }
  })
  const [isResizing, setIsResizing] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [think, setThink] = useState<boolean>(false)
  // One-time spin flags for icon buttons
  const [spinSettings, setSpinSettings] = useState(false)
  const [spinRefresh, setSpinRefresh] = useState(false)
  // Session-level delete confirmation preference and modal state
  const [confirmDel, setconfirmDel] = useState<boolean>(true)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState<boolean>(false)

  useEffect(() => {
    if (!isResizing) return

    const clamp = (v: number) => Math.max(20, Math.min(80, v))

    const handleMove = (clientX: number) => {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const pct = clamp(((clientX - rect.left) / rect.width) * 100)
      setLeftWidthPct(pct)
      try {
        window.localStorage.setItem('chat:leftWidthPct', pct.toFixed(2))
      } catch {}
    }

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX)
    const onMouseUp = () => setIsResizing(false)
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) handleMove(e.touches[0].clientX)
    }
    const onTouchEnd = () => setIsResizing(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd)

    const prevUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      document.body.style.userSelect = prevUserSelect
    }
  }, [isResizing])

  // Sync system prompt and context from current conversation
  // Read directly from React Query projectConversations to avoid Redux sync race conditions
  useEffect(() => {
    if (currentConversationId) {
      // Find the current conversation in projectConversations (React Query cache)
      const conversation = projectConversations.find(c => c.id === currentConversationId)
      // Extract system_prompt and conversation_context from the found conversation
      dispatch(systemPromptSet(conversation?.system_prompt ?? null))
      dispatch(convContextSet(conversation?.conversation_context ?? null))
    } else {
      // If no conversation is selected, clear prompts and context
      dispatch(systemPromptSet(null))
      dispatch(convContextSet(null))
    }
  }, [currentConversationId, projectConversations, dispatch])

  // Query invalidation is now handled directly in sendMessage and editMessageWithBranching success handlers
  // This prevents aggressive refetching and duplicate API requests

  // Coalesced scroll-to-bottom using double rAF to wait for DOM/layout to settle
  const scheduleScrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = messagesContainerRef.current
    if (!container) return
    const doScroll = () => {
      const c = messagesContainerRef.current
      if (!c) return
      c.scrollTo({ top: c.scrollHeight, behavior })
    }
    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
      scrollRafRef.current = requestAnimationFrame(() => requestAnimationFrame(doScroll))
    } else {
      doScroll()
    }
  }, [])

  // Auto-scroll to bottom when messages update, with refined behavior:
  // - While streaming: keep pinned unless user scrolled away. If user returns near bottom, re-enable pinning.
  // - After streaming completes: only auto-scroll when there is no explicit selection path
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // During streaming, keep pinned unless the user opted out by scrolling away.
    // If they scroll back near bottom, re-enable pinning and scroll.
    if (streamState.active) {
      if (!userScrolledDuringStreamRef.current) {
        // Use instant scroll during streaming to avoid smooth-scroll queuing/jitter
        scheduleScrollToBottom('auto')
      } else {
        const nearBottom = isNearBottom(container, NEAR_BOTTOM_PX)
        if (nearBottom) {
          userScrolledDuringStreamRef.current = false
          scheduleScrollToBottom('auto')
        }
      }
      return
    }

    // After streaming completes, only auto-scroll when there is no explicit selection path
    const noExplicitPath = !selectedPath || selectedPath.length === 0
    if (noExplicitPath) {
      // Smooth scroll when not streaming
      scheduleScrollToBottom('smooth')
    }
  }, [
    displayMessages,
    streamState.buffer,
    streamState.thinkingBuffer,
    streamState.toolCallsBuffer,
    streamState.active,
    streamState.finished,
    selectedPath,
    scheduleScrollToBottom,
  ])

  // Cleanup any pending rAF on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  // Listen for user scrolls; while streaming, toggle override based on proximity to bottom
  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el) return
    const onScroll = (e: Event) => {
      // Only treat as user scroll if the event is trusted (user-initiated)
      if (e.isTrusted && streamState.active) {
        const nearBottom = isNearBottom(el as HTMLElement, NEAR_BOTTOM_PX)
        // If the user is near the bottom, allow auto-pinning; otherwise, suppress it
        userScrolledDuringStreamRef.current = !nearBottom
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
    }
  }, [streamState.active])

  // Reset the user scroll override when the stream finishes
  useEffect(() => {
    if (streamState.finished) {
      userScrolledDuringStreamRef.current = false
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current)
        scrollRafRef.current = null
      }
    }
  }, [streamState.finished])

  // Scroll to selected node when path changes (only for user-initiated selections)
  useEffect(() => {
    if (selectionScrollCauseRef.current === 'user' && selectedPath && selectedPath.length > 0) {
      const targetId = focusedChatMessageId
      const tryScroll = (attempt = 0) => {
        const el = document.getElementById(`message-${targetId}`)
        const container = messagesContainerRef.current
        if (el && container) {
          // Compute element position relative to container and align its top to the container's top
          const containerRect = container.getBoundingClientRect()
          const elRect = el.getBoundingClientRect()
          const relativeTop = elRect.top - containerRect.top
          const targetTop = container.scrollTop + relativeTop
          container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
          // Record that we've scrolled to this focused target to avoid later auto-scrolls fighting it
          if (typeof targetId === 'number') {
            lastFocusedScrollIdRef.current = targetId
          }
          // After handling, reset so programmatic path changes (e.g., during send/stream) won't recenter
          selectionScrollCauseRef.current = null
          return
        }
        // Retry briefly if the element is not yet present
        if (attempt < 5) {
          setTimeout(() => tryScroll(attempt + 1), 50)
        } else {
          selectionScrollCauseRef.current = null
        }
      }

      // Defer until after DOM/layout has settled for this render
      if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
        requestAnimationFrame(() => requestAnimationFrame(() => tryScroll()))
      } else {
        setTimeout(() => tryScroll(), 0)
      }
    }
  }, [selectedPath, focusedChatMessageId])

  // Scroll to the focused message when focus changes via hash/search (non user-click cases)
  useEffect(() => {
    // Skip if no focus or a user-initiated selection will handle scrolling
    if (focusedChatMessageId == null) return
    if (selectionScrollCauseRef.current === 'user') return

    // If we've already scrolled to this focused message, don't re-run on every list change
    if (lastFocusedScrollIdRef.current === focusedChatMessageId) return

    // If focus changed programmatically during streaming, temporarily disable bottom pinning
    if (streamState.active) {
      userScrolledDuringStreamRef.current = true
    }

    const tryScroll = (attempt = 0) => {
      const container = messagesContainerRef.current
      if (!container) return
      const el = document.getElementById(`message-${focusedChatMessageId}`)
      if (el) {
        const containerRect = container.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const relativeTop = elRect.top - containerRect.top
        const targetTop = container.scrollTop + relativeTop
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
        // Mark this focus as handled so we don't keep re-centering on subsequent renders
        lastFocusedScrollIdRef.current = focusedChatMessageId
        return
      }
      // Retry briefly if the element is not yet present
      if (attempt < 5) {
        setTimeout(() => tryScroll(attempt + 1), 50)
      }
    }

    if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
      requestAnimationFrame(() => requestAnimationFrame(() => tryScroll()))
    } else {
      setTimeout(() => tryScroll(), 0)
    }
  }, [focusedChatMessageId, displayMessages])

  // Intersection Observer to track the most visible message
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // Map to store intersection ratios for each message
    const visibilityMap = new Map<MessageId, number>()

    const observer = new IntersectionObserver(
      entries => {
        // Update visibility map with new intersection ratios
        entries.forEach(entry => {
          const messageId = entry.target.getAttribute('id')?.replace('message-', '')
          if (messageId) {
            const parsedId = parseId(messageId)
            if ((typeof parsedId === 'number' && !isNaN(parsedId)) || typeof parsedId === 'string') {
              if (entry.isIntersecting) {
                visibilityMap.set(parsedId, entry.intersectionRatio)
              } else {
                visibilityMap.delete(parsedId)
              }
            }
          }
        })

        // Find the message with the highest intersection ratio
        let maxRatio = 0
        let mostVisibleId: MessageId | null = null
        visibilityMap.forEach((ratio, id) => {
          if (ratio > maxRatio) {
            maxRatio = ratio
            mostVisibleId = id
          }
        })

        // Update state with the most visible message ID
        setVisibleMessageId(mostVisibleId)
      },
      {
        root: container,
        threshold: [0, 0.25, 0.5, 0.75, 1.0],
      }
    )

    // Observe all message elements
    const messageElements = container.querySelectorAll('[id^="message-"]')
    messageElements.forEach(el => observer.observe(el))

    return () => {
      observer.disconnect()
    }
  }, [displayMessages])

  // If URL contains a #messageId fragment, capture it once
  const location = useLocation()
  const hashMessageId = React.useMemo(() => {
    if (location.hash && location.hash.startsWith('#')) {
      const idNum = parseId(location.hash.substring(1))
      return typeof idNum === 'number' && isNaN(idNum) ? null : idNum
    }
    return null
  }, [location.hash])

  // When we have messages loaded and a hashMessageId, build path to that message and set it ONCE per hash.
  // This avoids resetting currentPath when the user switches branches after landing from a search result.
  useEffect(() => {
    // If hash cleared, allow future re-application when a new hash appears
    if (!hashMessageId) {
      hashAppliedRef.current = null
      return
    }
    // Skip if we've already applied this hash
    if (hashAppliedRef.current === hashMessageId) return

    if (conversationMessages.length > 0) {
      // Guard: only proceed if the target hash message exists
      const exists = conversationMessages.some(m => m.id === hashMessageId)
      if (!exists) return

      const path = buildBranchPathForMessage(conversationMessages, hashMessageId)
      if (!path.length) return

      dispatch(chatSliceActions.conversationPathSet(path))
      // Keep Heimdall selection in sync (expects string IDs)
      dispatch(chatSliceActions.selectedNodePathSet(path.map(id => String(id))))
      // Ensure the focused message id is set so scrolling targets the correct element
      dispatch(chatSliceActions.focusedChatMessageSet(hashMessageId))
      hashAppliedRef.current = hashMessageId
    }
  }, [hashMessageId, conversationMessages, dispatch])

  // Reset the hash application guard when switching conversations
  useEffect(() => {
    hashAppliedRef.current = null
    // Allow programmatic focus in the new conversation to scroll once
    lastFocusedScrollIdRef.current = null
  }, [currentConversationId])

  // Clear selectedFilesForChat on route change
  useEffect(() => {
    dispatch(updateIdeContext({ selectedFilesForChat: [] }))
  }, [location.pathname, dispatch])

  // Also clear selectedFilesForChat on unmount
  useEffect(() => {
    return () => {
      dispatch(updateIdeContext({ selectedFilesForChat: [] }))
    }
  }, [dispatch])

  // useEffect(() => {
  //   if (focusedChatMessageId && conversationMessages.length > 0) {
  //     const path = getParentPath(conversationMessages, focusedChatMessageId)
  //     dispatch(chatSliceActions.conversationPathSet(path))
  //   }
  // }, [focusedChatMessageId, conversationMessages, dispatch])

  // Auto-select latest branch when messages first load
  useEffect(() => {
    if (conversationMessages.length > 0 && (!selectedPath || selectedPath.length === 0)) {
      // If URL has a hash message that exists, skip auto-selecting latest branch
      if (hashMessageId && conversationMessages.some(m => m.id === hashMessageId)) {
        return
      }
      // latest message by timestamp
      const latest = [...conversationMessages].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]
      if (latest) {
        // Use buildBranchPathForMessage to get the complete path including leaf nodes
        const pathNums = buildBranchPathForMessage(conversationMessages, latest.id)
        if (pathNums.length) {
          // console.log(`path nums ${pathNums}`)
          dispatch(chatSliceActions.conversationPathSet(pathNums))
        }
      }
    }
  }, [conversationMessages, selectedPath, dispatch, hashMessageId])

  // Load models on mount and when provider changes (consolidated to avoid duplicates)
  useEffect(() => {
    const loadModels = async () => {
      // Fetch models for current provider
      await dispatch(fetchModelsForCurrentProvider(true))
        .unwrap()
        .catch(() => {})
      // Then fetch recent models (only after provider models loaded)
      dispatch(fetchRecentModels({ limit: 5 }))
    }
    loadModels()
  }, [providers.currentProvider, dispatch])

  // Keep a local copy of models to allow reordering with recent models
  useEffect(() => {
    if (models && models.length > 0) {
      setLocalModel(models)
    } else {
      setLocalModel(null)
    }
  }, [models])

  // When recent models arrive, move them (alphabetically) to the front of the local list without duplicates
  useEffect(() => {
    if (!recentModels || recentModels.length === 0) return

    setLocalModel(prev => {
      const base = (prev && prev.length ? prev : models) || []
      if (base.length === 0) return prev

      // Only consider recent models that exist in the current base list
      const baseNames = new Set(base.map(m => m.name))
      const recentSorted = [...recentModels]
        .filter(m => baseNames.has(m.name))
        .sort((a, b) => a.name.localeCompare(b.name))

      // If no recent models intersect with the base list, keep existing ordering
      if (recentSorted.length === 0) return prev

      const recentNames = new Set(recentSorted.map(m => m.name))

      // Filter out any names that are in recent from the base list
      const filtered = base.filter(m => !recentNames.has(m.name))

      // Merge recent first
      const merged: Model[] = [...recentSorted, ...filtered]
      return merged
    })
  }, [recentModels, models])

  // Sync local input with Redux state when conversation changes
  useEffect(() => {
    setLocalInput(messageInput.content)
  }, [messageInput.content, currentConversationId])

  // Initialize or set conversation based on route param
  useEffect(() => {
    if (conversationIdFromUrl) {
      if (
        (typeof conversationIdFromUrl === 'number' && !isNaN(conversationIdFromUrl)) ||
        typeof conversationIdFromUrl === 'string'
      ) {
        dispatch(chatSliceActions.conversationSet(conversationIdFromUrl))
      }
    } else {
      dispatch(initializeUserAndConversation())
    }
  }, [conversationIdFromUrl, dispatch])

  // Handle input changes with pure local state - no Redux dispatches during typing
  const handleInputChange = useCallback((content: string) => {
    setLocalInput(content)
  }, [])

  // Handle model selection
  const handleModelSelect = useCallback(
    (modelName: string) => {
      const model = models.find(m => m.name === modelName)
      if (model) {
        dispatch(chatSliceActions.modelSelected({ model, persist: true }))
      } else {
        console.warn('Selected model not found:', modelName)
      }
    },
    [models, dispatch]
  )
  const handleProviderSelect = useCallback(
    (providerName: string) => {
      dispatch(chatSliceActions.providerSelected(providerName))
    },
    [dispatch]
  )
  // Local version of canSend that checks localInput instead of Redux state
  const canSendLocal = useMemo(() => {
    const hasInput = localInput.trim().length > 0
    const isNotSending = !sendingState.sending && !streamState.active
    const hasModel = !!selectedModel

    // Allow retrigger: empty input when last displayed message is from user
    const isRetrigger =
      localInput.trim().length === 0 &&
      displayMessages.length > 0 &&
      displayMessages[displayMessages.length - 1]?.role === 'user'

    return (hasInput || isRetrigger) && isNotSending && hasModel
  }, [localInput, sendingState.sending, streamState.active, selectedModel, displayMessages])

  // Helper: scroll to bottom immediately using the sentinel or container fallback
  const scrollToBottomNow = useCallback((behavior: ScrollBehavior = 'auto') => {
    const container = messagesContainerRef.current
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior })
      return
    }
    const sentinel = bottomRef.current
    if (sentinel && typeof sentinel.scrollIntoView === 'function') {
      sentinel.scrollIntoView({ block: 'end', inline: 'nearest', behavior })
    }
  }, [])

  const handleSend = useCallback(
    (value: number) => {
      // New send: re-enable auto-pinning until the user scrolls during this stream
      userScrolledDuringStreamRef.current = false
      if (canSendLocal && currentConversationId) {
        // Check if this is a retrigger scenario (empty input + last message is user)
        const isRetrigger =
          localInput.trim().length === 0 &&
          displayMessages.length > 0 &&
          displayMessages[displayMessages.length - 1]?.role === 'user'

        const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

        if (isRetrigger) {
          // Retrigger: Use the last user message's content and parent
          const lastUserMessage = displayMessages[displayMessages.length - 1]

          // Safety check: ensure lastUserMessage exists before accessing properties
          if (!lastUserMessage) {
            console.error('Cannot retrigger: No last user message found in displayMessages')
            return
          }

          const parent: MessageId | null = lastUserMessage.parent_id || null
          const contentToRetrigger = lastUserMessage.content

          // Immediately scroll to bottom
          scrollToBottomNow('auto')

          // Dispatch sendMessage with retrigger flag
          dispatch(
            sendMessage({
              conversationId: currentConversationId,
              input: { content: contentToRetrigger },
              parent,
              repeatNum: value,
              think: think,
              retrigger: true,
            })
          )
            .unwrap()
            .then(result => {
              if (!result?.userMessage) {
                console.warn('Server did not confirm user message')
              }
              // ✅ No refetch needed - messages already added to Redux via SSE stream
              // Stream sends: user_message event + complete event with full message data
              // Redux already updated via messageAdded() + messageBranchCreated() dispatches
            })
            .catch(error => {
              console.error('Failed to retrigger generation:', error)
            })
        } else {
          // Normal send flow
          // Process file mentions with actual content before sending
          const processedContent = replaceFileMentionsWithPath(localInput)

          // Update Redux state with processed content before sending
          dispatch(chatSliceActions.inputChanged({ content: processedContent }))

          const parent: MessageId | null = selectedPath.length > 0 ? selectedPath[selectedPath.length - 1] : null

          // Optimistically update conversation title if this is the first message
          if (parent === null) {
            const generatedTitle = processedContent.slice(0, 100) + (processedContent.length > 100 ? '...' : '')
            const projectId = selectedProject?.id || currentConversation?.project_id

            // Update all relevant React Query caches
            // Only update if cache exists to avoid creating invalid cache entries
            const conversationsCache = queryClient.getQueryData<Conversation[]>(['conversations'])
            if (conversationsCache) {
              queryClient.setQueryData(
                ['conversations'],
                conversationsCache.map(conv =>
                  conv.id === currentConversationId ? { ...conv, title: generatedTitle } : conv
                )
              )
            }

            if (projectId) {
              const projectConversationsCache = queryClient.getQueryData<Conversation[]>([
                'conversations',
                'project',
                projectId,
              ])
              if (projectConversationsCache) {
                queryClient.setQueryData(
                  ['conversations', 'project', projectId],
                  projectConversationsCache.map(conv =>
                    conv.id === currentConversationId ? { ...conv, title: generatedTitle } : conv
                  )
                )
              }
            }

            // Update recent conversations cache
            const recentCache = queryClient.getQueryData<Conversation[]>(['conversations', 'recent'])
            if (recentCache) {
              queryClient.setQueryData(
                ['conversations', 'recent'],
                recentCache.map(conv => (conv.id === currentConversationId ? { ...conv, title: generatedTitle } : conv))
              )
            }

            // Also update Redux to ensure components using Redux see the change immediately
            const updatedConversations = projectConversations.map(conv =>
              conv.id === currentConversationId ? { ...conv, title: generatedTitle } : conv
            )
            dispatch(conversationsLoaded(updatedConversations))
          }

          // Only create optimistic message in web mode for instant UI feedback
          if (isWebMode) {
            const optimisticUserMessage: Message = {
              id: `temp-${Date.now()}`,
              conversation_id: currentConversationId,
              role: 'user' as const,
              content: processedContent,
              content_plain_text: processedContent,
              parent_id: parent || null,
              children_ids: [],
              created_at: new Date().toISOString(),
              model_name: selectedModel?.name || '',
              partial: false,
              pastedContext: [],
              artifacts: [],
            }
            dispatch(chatSliceActions.optimisticMessageSet(optimisticUserMessage))
          }

          // Use processed content for immediate send
          const inputToSend = { content: processedContent }
          // Clear local input immediately after sending
          setLocalInput('')
          // Immediately scroll to bottom so the user sees the outgoing message/stream start
          scrollToBottomNow('auto')

          // Dispatch a single sendMessage with repeatNum set to value.
          dispatch(
            sendMessage({
              conversationId: currentConversationId,
              input: inputToSend,
              parent,
              repeatNum: value,
              think: think,
            })
          )
            .unwrap()
            .then(result => {
              // Optional: warn if server didn't confirm message
              if (!result?.userMessage) {
                console.warn('Server did not confirm user message')
              }
              // ✅ No refetch needed - messages already added to Redux via SSE stream
              // Stream sends: user_message event + complete event with full message data
              // Redux already updated via messageAdded() + messageBranchCreated() dispatches
            })
            .catch(error => {
              // Clear optimistic message on error (web mode only)
              // Note: Success case is handled in chatActions when user_message chunk arrives
              if (isWebMode) {
                dispatch(chatSliceActions.optimisticMessageCleared())
              }
              console.error('Failed to send message:', error)
            })
        }
      } else if (!currentConversationId) {
        console.error('📤 No conversation ID available')
      }
    },
    [
      canSendLocal,
      currentConversationId,
      selectedPath,
      think,
      dispatch,
      localInput,
      displayMessages,
      replaceFileMentionsWithPath,
      scrollToBottomNow,
      selectedModel,
    ]
  )

  const handleStopGeneration = useCallback(() => {
    if (streamState.streamingMessageId) {
      dispatch(abortStreaming({ messageId: streamState.streamingMessageId }))
    }
  }, [streamState.streamingMessageId, dispatch])

  const handleMessageEdit = useCallback(
    (id: string, newContent: string) => {
      const parsedId = parseId(id)
      // Only dispatch updateMessage thunk - it will dispatch messageUpdated internally on success
      // This prevents double updates and race conditions
      dispatch(updateMessage({ id: parsedId, content: newContent }))
      // console.log(parsedId)
    },
    [dispatch]
  )

  const handleMessageBranch = useCallback(
    (id: string, newContent: string) => {
      if (currentConversationId) {
        // Replace any @file mentions with actual file contents before branching
        const processed = replaceFileMentionsWithPath(newContent)
        console.log(processed)
        const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

        if (isWebMode) {
          // Find the original message to get its parent_id
          const parsedId = parseId(id)
          const originalMessage = conversationMessages.find(m => m.id === parsedId)

          if (originalMessage) {
            // Create optimistic branch message for instant UI feedback (web mode only)
            const optimisticBranchMessage: Message = {
              id: `branch-temp-${Date.now()}`,
              conversation_id: currentConversationId,
              role: 'user' as const,
              content: newContent,
              content_plain_text: newContent,
              parent_id: originalMessage.parent_id,
              children_ids: [],
              created_at: new Date().toISOString(),
              model_name: selectedModel?.name || '',
              partial: false,
              pastedContext: [],
              artifacts: [],
            }
            dispatch(chatSliceActions.optimisticBranchMessageSet(optimisticBranchMessage))
          }
        }

        dispatch(
          editMessageWithBranching({
            conversationId: currentConversationId,
            originalMessageId: parseId(id),
            newContent: newContent,
            modelOverride: selectedModel?.name,
            think: think,
          })
        )
          .unwrap()
          .then(() => {
            // Invalidate React Query cache after successful branch to fetch new messages
            // Note: messages query now includes tree data, so only one invalidation needed
            queryClient.invalidateQueries({
              queryKey: ['conversations', currentConversationId, 'messages'],
              refetchType: 'active',
            })
          })
          .catch(error => {
            // Clear optimistic branch message on error (web mode only)
            if (isWebMode) {
              dispatch(chatSliceActions.optimisticBranchMessageCleared())
            }
            console.error('Failed to branch message:', error)
          })
      }
    },
    [currentConversationId, selectedModel?.name, think, dispatch, replaceFileMentionsWithPath, conversationMessages]
  )

  const handleResend = useCallback(
    (id: string) => {
      // Find the message by id from displayed messages first, fallback to all conversation messages
      const parsedId = parseId(id)
      const msg = displayMessages.find(m => m.id === parsedId) || conversationMessages.find(m => m.id === parsedId)

      if (!msg) {
        console.warn('Resend requested for unknown message id:', id)
        return
      }

      // For resend, branch from the PARENT user message with the parent's content
      const parentId = msg.parent_id
      if (!parentId) {
        console.warn('Resend requested but message has no parent to branch from:', id)
        return
      }
      const parentMsg =
        displayMessages.find(m => m.id === parentId) || conversationMessages.find(m => m.id === parentId)
      if (!parentMsg) {
        console.warn('Parent message not found for resend. Parent id:', parentId)
        return
      }

      // Use parent message id and its content to create a sibling branch (resend)
      handleMessageBranch(parentId.toString(), parentMsg.content)
    },
    [displayMessages, conversationMessages, handleMessageBranch]
  )

  const handleNodeSelect = (nodeId: string, path: string[]) => {
    if (!nodeId || !path || path.length === 0) return // ignore clicks on empty space
    // console.log('Node selected:', nodeId, 'Path:', path)
    // Mark this selection as user-initiated so the scroll-to-selection effect may run
    selectionScrollCauseRef.current = 'user'
    // Treat user selection during streaming as an override to bottom pinning
    if (streamState.active) {
      userScrolledDuringStreamRef.current = true
    }
    dispatch(chatSliceActions.conversationPathSet(path.map(id => parseId(id))))
    dispatch(chatSliceActions.selectedNodePathSet(path))

    dispatch(chatSliceActions.focusedChatMessageSet(parseId(nodeId)))
  }

  // const handleOnResend = (id: string) => {
  //   if (currentConversationId) {
  //     dispatch(
  //       sendMessage({
  //         conversationId: currentConversationId,
  //         input: messageInput,
  //         repeatNum: 1,
  //         parent: parseInt(id),
  //       })
  //     )
  //   }
  // }

  const performDelete = useCallback(
    (id: string) => {
      const messageId = parseId(id)
      dispatch(chatSliceActions.messageDeleted(messageId))
      if (currentConversationId) {
        dispatch(deleteMessage({ id: messageId, conversationId: currentConversationId }))
        dispatch(refreshCurrentPathAfterDelete({ conversationId: currentConversationId, messageId }))
      }
    },
    [dispatch, currentConversationId]
  )

  const handleRequestDelete = useCallback(
    (id: string) => {
      if (!confirmDel) {
        performDelete(id)
      } else {
        setPendingDeleteId(id)
      }
    },
    [confirmDel, performDelete]
  )

  const closeDeleteModal = () => {
    setPendingDeleteId(null)
    setDontAskAgain(false)
  }

  const confirmDeleteModal = () => {
    if (dontAskAgain) setconfirmDel(false)
    if (pendingDeleteId) performDelete(pendingDeleteId)
    closeDeleteModal()
  }

  // Handle key press
  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend(multiReplyCount)
      }
    },
    [handleSend, multiReplyCount]
  )

  // const handleMultiReplyCountChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
  //   const value = e.target.value
  //   if (value === '' || !isNaN(Number(value))) {
  //     dispatch(chatActions.multiReplyCountSet(Number(value)))
  //   }
  // }

  // Clone conversation
  const handleCloneConversation = useCallback(async () => {
    if (!currentConversationId) return

    setCloningConversation(true)
    setOptionsOpen(false)

    try {
      const result = await cloneConversation(currentConversationId, accessToken)
      // Invalidate React Query cache to refetch conversations list
      // This updates the dropdown and sidebar without duplicate API calls
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      // Navigate to the cloned conversation
      navigate(`/chat/${result.project_id || projectIdFromUrl || 'unknown'}/${result.id}`)
    } catch (error) {
      console.error('Failed to clone conversation:', error)
      // Could add error toast/notification here
    } finally {
      setCloningConversation(false)
    }
  }, [currentConversationId, accessToken, navigate, queryClient])

  // Refresh models
  const handleRefreshModels = useCallback(() => {
    dispatch(fetchModelsForCurrentProvider(true))
  }, [dispatch])

  // Memoized message list to prevent re-rendering all messages when unrelated state changes
  const memoizedMessageList = useMemo(() => {
    // Filter out any undefined/null messages or messages with invalid IDs
    return displayMessages
      .filter(msg => msg && msg.id != null)
      .map(msg => (
        <ChatMessage
          key={msg.id}
          id={msg.id.toString()}
          role={msg.role}
          content={msg.content}
          thinking={msg.thinking_block}
          toolCalls={msg.tool_calls}
          timestamp={msg.created_at}
          width='w-full'
          modelName={msg.model_name}
          artifacts={msg.artifacts}
          onEdit={handleMessageEdit}
          onBranch={handleMessageBranch}
          onDelete={handleRequestDelete}
          onResend={handleResend}
        />
      ))
  }, [displayMessages, handleMessageEdit, handleMessageBranch, handleRequestDelete, handleResend])

  // Removed obsolete streaming completion effect that synthesized assistant messages.
  // The streaming thunks now dispatch messageAdded and messageBranchCreated directly,
  // and reducers update currentPath appropriately. This avoids race conditions and
  // incorrect parent linking that could break currentPath after branching.

  return (
    <div ref={containerRef} className='flex h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-900'>
      <div
        className='relative flex flex-col flex-none min-w-[280px] h-screen overflow-hidden'
        style={{ width: `${leftWidthPct}%` }}
      >
        {/* Conversation Title Editor */}
        {currentConversationId && (
          <div className='flex flex-col gap-2 mb-2 mt-2 mx-2 rounded-xl pr-2 shadow-[0_0px_12px_6px_rgba(0,0,0,0.06),0_0px_12px_-4px_rgba(0,0,0,0.02)] dark:shadow-[0_12px_12px_-6px_rgba(0,0,0,0.65),0_6px_12px_-4px_rgba(0,0,0,0.02)]'>
            <div className='flex items-center gap-2 p-1 '>
              <Button
                variant='outline2'
                size='medium'
                className='transition-transform duration-100 active:scale-95'
                aria-label='Conversations'
                onClick={() => {
                  const projectId = selectedProject?.id || currentConversation?.project_id
                  navigate(projectId ? `/conversationPage?projectId=${projectId}` : '/conversationPage')
                }}
              >
                <i className='bx bx-chat text-2xl' aria-hidden='true'></i>
              </Button>

              {editingTitle ? (
                <>
                  <TextField
                    value={titleInput}
                    onChange={val => {
                      setTitleInput(val)
                    }}
                    placeholder='Conversation title'
                    size='large'
                  />
                  <Button
                    variant='secondary'
                    size='medium'
                    className='transition-transform duration-100 active:scale-95'
                    aria-label='Confirm edit'
                    onClick={() => setEditingTitle(false)}
                  >
                    <i className='bx bx-check text-2xl' aria-hidden='true'></i>
                  </Button>
                </>
              ) : (
                <>
                  <Select
                    value={currentConversationId ? String(currentConversationId) : ''}
                    onChange={val => {
                      const conv = sortedConversations.find(c => String(c.id) === val)
                      // Use setTimeout to defer navigation and allow Select to close properly
                      setTimeout(() => navigate(`/chat/${conv?.project_id || projectIdFromUrl || 'unknown'}/${val}`), 0)
                    }}
                    options={sortedConversations.map(conv => ({
                      value: String(conv.id),
                      label: conv.title || 'Untitled Conversation',
                    }))}
                    placeholder='Select conversation...'
                    disabled={sortedConversations.length === 0}
                    className='flex-1 transition-transform min-w-0 duration-60 active:scale-97 outline-1 outline-neutral-200 dark:outline-neutral-700 rounded-lg'
                    searchBarVisible={true}
                  />
                  <div ref={optionsRef} className='relative'>
                    <Button
                      variant='outline2'
                      size='small'
                      className='transition-transform duration-100 active:scale-95'
                      aria-label='Options'
                      onClick={() => setOptionsOpen(!optionsOpen)}
                    >
                      <i className='bx bx-dots-vertical-rounded text-xl' aria-hidden='true'></i>
                    </Button>
                    {optionsOpen && (
                      <div className='absolute right-0 top-full mt-1 z-50 bg-white dark:bg-yBlack-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl w-max'>
                        <button
                          className='w-full text-left px-3 py-2 text-sm text-stone-800 dark:text-stone-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors rounded-t-lg whitespace-nowrap'
                          onClick={() => {
                            setEditingTitle(true)
                            setOptionsOpen(false)
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className='w-full text-left px-3 py-2 text-sm text-stone-800 dark:text-stone-200 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors rounded-b-lg whitespace-nowrap'
                          onClick={handleCloneConversation}
                          disabled={cloningConversation}
                        >
                          {cloningConversation ? 'Cloning...' : 'Clone Chat'}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Messages Display */}
        <div
          className='relative ml-2 flex flex-col thin-scrollbar rounded-lg bg-transparent dark:bg-neutral-900 flex-1 min-h-0'
          style={{ paddingBottom: `${inputAreaHeight}px` }}
        >
          <div
            ref={messagesContainerRef}
            className='px-2 dark:border-neutral-700 border-stone-200 rounded-lg py-4 overflow-y-auto thin-scrollbar overscroll-y-contain touch-pan-y p-3 bg-neutral-50 dark:bg-neutral-900 flex-1 min-h-0'
            style={{ ['overflowAnchor' as any]: 'none' }}
          >
            {displayMessages.length === 0 ? (
              <p className='text-stone-800 dark:text-stone-200'>No messages yet...</p>
            ) : (
              memoizedMessageList
            )}

            {/* Show optimistic message in web mode only */}
            {import.meta.env.VITE_ENVIRONMENT === 'web' && optimisticMessage && (
              <ChatMessage
                key={`optimistic-${optimisticMessage.id}`}
                id={optimisticMessage.id.toString()}
                role={optimisticMessage.role}
                content={optimisticMessage.content}
                timestamp={optimisticMessage.created_at}
                modelName={optimisticMessage.model_name}
                artifacts={optimisticMessage.artifacts}
                width='w-full'
                className='opacity-70'
              />
            )}

            {/* Show optimistic branch message in web mode only */}
            {import.meta.env.VITE_ENVIRONMENT === 'web' && optimisticBranchMessage && (
              <ChatMessage
                key={`optimistic-branch-${optimisticBranchMessage.id}`}
                id={optimisticBranchMessage.id.toString()}
                role={optimisticBranchMessage.role}
                content={optimisticBranchMessage.content}
                timestamp={optimisticBranchMessage.created_at}
                modelName={optimisticBranchMessage.model_name}
                artifacts={optimisticBranchMessage.artifacts}
                width='w-full'
                className='opacity-70'
              />
            )}

            {/* Show streaming content */}
            {streamState.active &&
              (Boolean(streamState.buffer) ||
                Boolean(streamState.thinkingBuffer) ||
                Boolean(streamState.toolCallsBuffer)) && (
                <ChatMessage
                  id='streaming'
                  role='assistant'
                  content={streamState.buffer}
                  thinking={streamState.thinkingBuffer}
                  toolCalls={streamState.toolCallsBuffer}
                  width='w-full'
                  modelName={selectedModel?.name || undefined}
                  className=''
                />
              )}
            {streamState.active && (
              <div className=' pb-4 px-3 text-stone-800 dark:text-stone-200 flex justify-end'>
                <i className='bx bx-loader-alt text-2xl animate-spin' style={{ animationDuration: '1s' }}></i>
              </div>
            )}
            {/* Bottom sentinel for robust scrolling */}
            <div ref={bottomRef} data-bottom-sentinel='true' className='h-px' />
          </div>
        </div>
        {/* Input area: controls row + textarea (absolutely positioned overlay) */}
        <div ref={inputAreaRef} className='absolute bottom-0 left-0 right-0 ml-2 mb-2 mr-2'>
          {/* Controls row (above) */}

          {/* Textarea (bottom, grows upward because wrapper is bottom-pinned) */}
          <div className='bg-neutral-100 px-4 pb-2 pt-4 outline-1 dark:outline-1 dark:outline-neutral-600 outline-indigo-300 rounded-t-4xl drop-shadow-xl shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.05),0_-6px_18px_-4px_rgba(0,0,0,0.02)] dark:shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.45),0_-6px_18px_-4px_rgba(0,0,0,0.02)] rounded-b-4xl dark:bg-yBlack-900'>
            <InputTextArea
              value={localInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              onBlur={() => dispatch(chatSliceActions.inputChanged({ content: localInput }))}
              placeholder='Type your message...'
              state='default'
              width='w-full'
              minRows={3}
              autoFocus={true}
              showCharCount={true}
            />
            {/* Selected file chips moved from InputTextArea */}
            {selectedFilesForChat && selectedFilesForChat.length > 0 && (
              <div className='mt-2 flex flex-wrap gap-2'>
                {selectedFilesForChat.map(file => {
                  const displayName =
                    file.name || file.relativePath.split('/').pop() || file.path.split('/').pop() || file.relativePath
                  const isExpanded = expandedFilePath === file.path
                  const isClosing = closingFilePath === file.path
                  const isOpening = openingFilePath === file.path
                  return (
                    <div
                      key={file.path}
                      className='relative group inline-flex items-center gap-2 max-w-full rounded-md border border-neutral-500 dark:bg-yBlack-900 dark:text-neutral-200 text-neutral-800 px-2 py-1 text-sm'
                      title={file.relativePath || file.path}
                      onClick={e => {
                        if (!isExpanded) {
                          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          setExpandedAnchor({ left: rect.left, top: rect.top })
                          setOpeningFilePath(file.path)
                          setExpandedFilePath(file.path)
                          // Clear opening state after transition completes
                          window.setTimeout(() => setOpeningFilePath(null), 130)
                        }
                      }}
                    >
                      <span className='truncate max-w-[220px]'>{displayName}</span>
                      <button
                        type='button'
                        className='rounded dark:hover:bg-blue-200 hover:bg-blue-700 p-0.5 text-blue-700 dark:text-blue-200'
                        aria-label={`Remove ${displayName}`}
                        onClick={e => {
                          e.stopPropagation()
                          handleRemoveFileSelection(file)
                        }}
                      >
                        ✕
                      </button>

                      {/* Hover tooltip that can expand into anchored modal */}
                      <div
                        className={`absolute bottom-full left-0 mb-2 origin-bottom-left rounded-lg shadow-xl border border-gray-600 p-3 transform transition-all duration-100 ease-out ${
                          isExpanded
                            ? 'hidden'
                            : 'z-50 dark:bg-neutral-900 bg-slate-100 opacity-0 invisible scale-95 pointer-events-none w-80 group-hover:opacity-100 group-hover:visible group-hover:scale-100'
                        }`}
                      >
                        <div className='text-xs text-blue-600 dark:text-blue-300 font-medium mb-2 truncate'>
                          {file.name || file.relativePath.split('/').pop() || file.path.split('/').pop()}
                        </div>
                        <div
                          className={`text-xs font-mono whitespace-pre-wrap break-words text-stone-800 dark:text-stone-300 ${isExpanded ? 'overflow-auto max-h-[60vh]' : isClosing ? 'overflow-hidden' : 'overflow-hidden line-clamp-6'} ${isOpening || isClosing ? 'opacity-50 ' : 'opacity-100 visible'} transition-opacity duration-50 overscroll-contain select-text`}
                        >
                          {file.contents}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <div className='bg-neutral-100 pt-2 rounded-b-lg dark:bg-yBlack-900 flex flex-col items-end'>
              {/* <h3 className='text-lg font-semibold text-stone-800 dark:text-stone-200 mb-3'>Send Message:</h3> */}

              {/* {messageInput.content.length > 0 && (
              <small className='text-stone-800 dark:text-stone-200 text-xs mb-3 block text-right w-full'>
                Press Enter to send, Shift+Enter for new line
              </small>
            )} */}

              {/* <h3 className='text-lg font-semibold text-stone-800 dark:text-stone-200 mb-1'>Model Selection:</h3> */}
              <div className='flex justify-between w-full mb-3'>
                <div className='flex items-center justify-start gap-3 flex-wrap flex-1'>
                  <div
                    className='ide-status text-neutral-900 max-w-2/12 dark:text-neutral-200 break-words line-clamp-2 text-right'
                    title={workspace?.name ? `Workspace: ${workspace.name} connected` : ''}
                  >
                    {ideContext?.extensionConnected ? '' : ''}
                    {workspace?.name && `${workspace.name}`}
                  </div>

                  <Button
                    variant='outline2'
                    className='rounded-full'
                    size='medium'
                    onClick={() => {
                      setSpinSettings(true)
                      setSettingsOpen(true)
                    }}
                  >
                    <i
                      className={`bx bx-cog text-xl ${spinSettings ? 'animate-[spin_0.6s_linear_1]' : ''}`}
                      aria-hidden='true'
                      onAnimationEnd={() => setSpinSettings(false)}
                    ></i>
                  </Button>

                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>Available: {providers.providers.length}</span> */}
                  <Select
                    value={providers.currentProvider || ''}
                    onChange={handleProviderSelect}
                    options={providers.providers.map(p => p.name)}
                    placeholder='Select a provider...'
                    disabled={providers.providers.length === 0}
                    className='flex-1 max-w-40 transition-transform duration-60 active:scale-97'
                    searchBarVisible={true}
                  />
                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>{models.length} models</span> */}
                  <Select
                    value={selectedModel?.name || ''}
                    onChange={handleModelSelect}
                    options={(localModel ?? models).map(m => m.name)}
                    placeholder='Select a model...'
                    disabled={(localModel ?? models).length === 0}
                    className='flex-1 max-w-2xs transition-transform duration-60 active:scale-99'
                    searchBarVisible={true}
                  />
                  <Button
                    variant='outline2'
                    className='rounded-full'
                    size='medium'
                    onClick={() => {
                      setSpinRefresh(true)
                      handleRefreshModels()
                    }}
                  >
                    <i
                      className={`bx bx-refresh text-xl ${spinRefresh ? 'animate-[spin_0.6s_linear_1]' : ''}`}
                      aria-hidden='true'
                      onAnimationEnd={() => setSpinRefresh(false)}
                    ></i>
                  </Button>
                  {selectedModel?.thinking && (
                    <Button variant='outline2' className='rounded-full' size='medium' onClick={() => setThink(t => !t)}>
                      {think ? (
                        <i className='bx bxs-bulb text-xl text-yellow-400' aria-hidden='true'></i>
                      ) : (
                        <i className='bx bx-bulb text-xl' aria-hidden='true'></i>
                      )}
                    </Button>
                  )}
                </div>
                <div className='flex items-center justify-end pl-2.5'>
                  {!currentConversationId ? (
                    'Creating...'
                  ) : sendingState.streaming ? (
                    <Button
                      variant='outline2'
                      onClick={handleStopGeneration}
                      disabled={!streamState.streamingMessageId}
                    >
                      <i className='bx bx-stop-circle text-xl' aria-hidden='true'></i>
                    </Button>
                  ) : sendingState.sending ? (
                    'Sending...'
                  ) : (
                    <Button
                      variant={canSendLocal && currentConversationId ? 'outline2' : 'outline2'}
                      size='medium'
                      disabled={!canSendLocal || !currentConversationId}
                      onClick={() => handleSend(multiReplyCount)}
                    >
                      <i className='bx bx-send text-2xl' aria-hidden='true'></i>
                    </Button>
                  )}
                </div>
                {/* <Button
                  variant={canSendLocal && currentConversationId ? 'primary' : 'secondary'}
                  disabled={!canSendLocal || !currentConversationId}
                  onClick={() => handleSend(multiReplyCount)}
                >
                  {!currentConversationId
                    ? 'Creating...'
                    : sendingState.streaming
                      ? 'Streaming...'
                      : sendingState.sending
                        ? 'Sending...'
                        : 'Send'}
                </Button> */}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* SEPARATOR */}
      <div
        className='w-2 dark:bg-transparent bg-transparent hover:dark:bg-neutral-800 hover:bg-neutral-200 cursor-col-resize select-none'
        style={{ border: 'none', outline: 'none', margin: 0, padding: 0 }}
        role='separator'
        aria-orientation='vertical'
        onMouseDown={() => setIsResizing(true)}
        onTouchStart={e => {
          e.preventDefault()
          setIsResizing(true)
        }}
        title='Drag to resize'
      />

      <div className='flex-1 min-w-0'>
        <Heimdall
          key={currentConversationId ?? 'none'}
          chatData={heimdallData}
          loading={loading}
          error={error}
          compactMode={compactMode}
          conversationId={currentConversationId}
          onNodeSelect={handleNodeSelect}
          visibleMessageId={visibleMessageId}
        />
      </div>
      <SettingsPane open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Centered custom delete confirmation modal */}
      {pendingDeleteId && confirmDel && (
        <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50' onClick={closeDeleteModal}>
          <div
            className='bg-white dark:bg-neutral-800 rounded-lg shadow-xl p-6 w-[90%] max-w-sm'
            onClick={e => e.stopPropagation()}
          >
            <h3 className='text-lg font-semibold mb-2 text-neutral-900 dark:text-neutral-100'>Delete message?</h3>
            <p className='text-sm text-neutral-700 dark:text-neutral-300 mb-4'>This action cannot be undone.</p>
            <label className='flex items-center gap-2 mb-4 text-sm text-neutral-700 dark:text-neutral-300'>
              <input type='checkbox' checked={dontAskAgain} onChange={e => setDontAskAgain(e.target.checked)} />
              Don't ask again this session
            </label>
            <div className='flex justify-end gap-2'>
              <Button variant='secondary' onClick={closeDeleteModal} className='active:scale-90'>
                Cancel
              </Button>
              <Button
                variant='primary'
                className='bg-red-600 hover:bg-red-700 border-red-700 text-white active:scale-90'
                onClick={confirmDeleteModal}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Fixed expanded panel rendered at root to sit above backdrop and allow scroll */}
      {(expandedFilePath || closingFilePath) &&
        (() => {
          const activePath = expandedFilePath || closingFilePath
          const file = selectedFilesForChat.find(f => f.path === activePath)
          if (!file) return null
          const isClosing = !!closingFilePath && closingFilePath === file.path
          const name = file.name || file.relativePath.split('/').pop() || file.path.split('/').pop()
          const left = expandedAnchor?.left ?? 16
          const top = (expandedAnchor?.top ?? 16) - 8
          return (
            <div
              className={`fixed z-[100000] -translate-y-full rounded-lg shadow-2xl border border-gray-600 p-3 transform transition-all duration-100 ease-out dark:bg-neutral-900 bg-slate-100 pointer-events-auto`}
              style={{ left, top, maxWidth: 'min(90vw, 56rem)', width: '56rem' }}
              onMouseDown={e => e.stopPropagation()}
              onMouseUp={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
              onWheel={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              onTouchMove={e => e.stopPropagation()}
              onTouchEnd={e => e.stopPropagation()}
            >
              <div className='flex items-center justify-between mb-2 gap-3'>
                <div className='text-xs text-blue-600 dark:text-blue-300 font-medium truncate'>{name}</div>
                <button
                  className='text-xs px-2 text-neutral-800 dark:text-neutral-300 py-1 rounded border border-neutral-500 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                  onClick={handleCloseExpandedPreview}
                >
                  Close
                </button>
              </div>
              <div
                className={`text-xs font-mono whitespace-pre-wrap break-words text-stone-800 dark:text-stone-200 ${isClosing ? 'opacity-50' : 'opacity-100'} transition-opacity duration-100 overflow-auto max-h-[60vh] overscroll-contain select-text`}
              >
                {file.contents}
              </div>
            </div>
          )
        })()}

      {/* Transparent backdrop to allow click-out close. Keep during closing to finish animation */}
      {(expandedFilePath || closingFilePath) && (
        <div className='fixed inset-0 z-[99998] bg-transparent' onClick={handleCloseExpandedPreview} />
      )}
    </div>
  )
}

export default Chat
