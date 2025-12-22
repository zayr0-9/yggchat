import { useQueryClient } from '@tanstack/react-query'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { estimateTokenCount } from 'tokenx'
import { MessageId } from '../../../../shared/types'
import {
  ActionPopover,
  Button,
  ChatMessage,
  FreeGenerationsModal,
  Heimdall,
  InputTextArea,
  Select,
  SettingsPane,
  TextField,
  ToolPermissionDialog,
} from '../components'
import { ModelFilterUI } from '../components/ModelFilterUI/ModelFilterUI'
import {
  abortStreaming,
  blobToDataURL,
  chatSliceActions,
  deleteMessage,
  editMessageWithBranching,
  fetchCCSlashCommands,
  initializeUserAndConversation,
  Message,
  refreshCurrentPathAfterDelete,
  resolveAttachmentUrl,
  respondToToolPermission,
  respondToToolPermissionAndEnableAll,
  selectCCSlashCommands,
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
  selectMultiReplyCount,
  selectOperationMode,
  selectProviderState,
  selectSendingState,
  selectStreamState,
  sendCCBranch,
  sendCCMessage,
  sendMessage,
  syncConversationToLocal,
  updateConversationTitle,
  updateMessage,
} from '../features/chats'
import type { ContentBlock, ToolCall } from '../features/chats/chatTypes'
import { buildBranchPathForMessage } from '../features/chats/pathUtils'
import {
  convContextSet,
  Conversation,
  conversationsLoaded,
  makeSelectConversationById,
  systemPromptSet,
  updateResearchNote,
} from '../features/conversations'
import { updateCwd } from '../features/conversations/conversationActions'
import { removeSelectedFileForChat, updateIdeContext } from '../features/ideContext'
import { selectSelectedFilesForChat, selectWorkspace } from '../features/ideContext/ideContextSelectors'
import { selectSelectedProject } from '../features/projects/projectSelectors'
import { refreshUserCredits, selectCurrentUser } from '../features/users'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { useIdeContext } from '../hooks/useIdeContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import {
  ResearchNoteItem,
  useConversationMessages,
  useConversationsByProject,
  useConversationStorageMode,
  useFilteredModels,
  useModels,
  useSelectedModel,
  useSelectModel,
} from '../hooks/useQueries'
import { getPaymentProvider, type SubscriptionStatus } from '../lib/payments'
import { cloneConversation } from '../utils/api'
import { getAssetPath } from '../utils/assetPath'
import { parseId } from '../utils/helpers'
import { extractTextFromPdf } from '../utils/pdfUtils'

function Chat() {
  const dispatch = useAppDispatch()
  const { accessToken, userId } = useAuth()
  const navigate = useNavigate()
  const { ideContext } = useIdeContext()
  const queryClient = useQueryClient()

  // Local state for input to completely avoid Redux dispatches during typing
  const [localInput, setLocalInput] = useState('')

  // Subscription status for free/paid detection
  const [subscriptionStatus, setSubscriptionStatus] = useState<SubscriptionStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        const provider = await getPaymentProvider()
        if (!userId) return
        const status = await provider.getSubscriptionStatus(userId)
        if (!cancelled) setSubscriptionStatus(status)
      } catch (err) {
        console.warn('[Chat] Failed to fetch subscription status', err)
      }
    }
    loadStatus()
    return () => {
      cancelled = true
    }
  }, [userId])

  const hasActiveAccess = useMemo(() => {
    if (!subscriptionStatus || !subscriptionStatus.tier) return false
    const status = subscriptionStatus.status
    if (status === 'active') return true
    if ((status === 'past_due' || status === 'canceled') && subscriptionStatus.currentPeriodEnd) {
      const periodEnd = new Date(subscriptionStatus.currentPeriodEnd)
      return new Date() < periodEnd
    }
    return false
  }, [subscriptionStatus])

  const isFreeUser = !hasActiveAccess
  const modelSelectFooter = isFreeUser ? (
    <div className='p-1 space-y-2'>
      {/* <div className='text-sm text-neutral-700 dark:text-neutral-200'>Subscribe now for access to all 400+ models</div> */}
      <Button variant='outline2' size='medium' className='w-full' onClick={() => navigate('/payment')}>
        Subscribe now for access to all 400+ models
      </Button>
    </div>
  ) : null

  // Claude Code mode toggle (disabled in web mode)
  const [ccMode, setCCMode] = useState(import.meta.env.VITE_ENVIRONMENT === 'web' ? false : false)

  // Claude Code working directory input (disabled in web mode)
  const [ccCwd, setCcCwd] = useState('')

  // Check if CC mode should be available
  const ccModeAvailable = import.meta.env.VITE_ENVIRONMENT !== 'web'

  // Get conversation ID and project ID from URL params FIRST (before any hooks that depend on it)
  const { id: conversationIdParam, projectId: projectIdParam } = useParams<{ id?: string; projectId?: string }>()
  const conversationIdFromUrl = conversationIdParam ? parseId(conversationIdParam) : null
  const projectIdFromUrl = projectIdParam === 'null' ? null : projectIdParam || null

  // Get storageMode from navigation state (passed from Heimdall when creating new chat)
  // This is CRITICAL for immediate routing to local server before cache is populated
  const location = useLocation()
  const storageModeFromNav = location.state?.storageMode as 'local' | 'cloud' | undefined

  // Redux selectors
  const currentUser = useAppSelector(selectCurrentUser)
  const providers = useAppSelector(selectProviderState)
  const messageInput = useAppSelector(selectMessageInput)
  const operationMode = useAppSelector(selectOperationMode)
  // const canSendFromRedux = useAppSelector(selectCanSend)
  const sendingState = useAppSelector(selectSendingState)
  const streamState = useAppSelector(selectStreamState)
  const conversationMessages = useAppSelector(selectConversationMessages)
  const displayMessages = useAppSelector(selectDisplayMessages)
  const currentConversationId = useAppSelector(selectCurrentConversationId)
  const toolCallPermissionRequest = useAppSelector(state => state.chat.toolCallPermissionRequest)
  const toolAutoApprove = useAppSelector(state => state.chat.toolAutoApprove)
  const showFreeTierModal = useAppSelector(state => state.chat.freeTier.showLimitModal)
  // const freeGenerationsRemaining = useAppSelector(state => state.chat.freeTier.freeGenerationsRemaining)
  const inputAreaBorderClasses =
    operationMode === 'plan'
      ? 'outline-2 outline-blue-200/70 dark:outline-neutral-500/50'
      : 'outline-2 dark:outline-2 dark:outline-orange-700/70 outline-orange-700/70'

  // React Query for message fetching - MOVED BELOW after projectConversations is available
  // to enable passing storage_mode from cached conversations
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
  const ccSlashCommands = useAppSelector(selectCCSlashCommands)

  // File chip expanded modal state
  const [expandedFilePath, setExpandedFilePath] = useState<string | null>(null)
  // Temporary closing state to animate back to hover size before hiding
  const [closingFilePath, setClosingFilePath] = useState<string | null>(null)
  // Temporary opening state to blur content while expanding
  const [openingFilePath, setOpeningFilePath] = useState<string | null>(null)
  // Anchor position for fixed expanded panel (viewport coords)
  const [expandedAnchor, setExpandedAnchor] = useState<{ left: number; top: number } | null>(null)
  // Dynamic input area height for adaptive padding
  // const [inputAreaHeight, setInputAreaHeight] = useState(170)
  const [containerHeight, setContainerHeight] = useState(1100)
  // Credits refresh loading state
  const [isRefreshingCredits, setIsRefreshingCredits] = useState(false)

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

  const attachmentInputRef = useRef<HTMLInputElement>(null)

  // Track if we already applied the URL hash-based path to avoid overriding user branch switches
  const hashAppliedRef = useRef<MessageId | null>(null)

  // Helper function to find the last ex_agent session ID in a message path
  // This is used for CC mode to resume sessions
  const findLastExAgentSession = useCallback(
    (messageIds: MessageId[]): string | undefined => {
      if (!messageIds || messageIds.length === 0) return undefined

      // Iterate messageIds in reverse to find the last ex_agent message
      for (let i = messageIds.length - 1; i >= 0; i--) {
        const message = conversationMessages.find(m => m.id === messageIds[i])
        if (message?.role === 'ex_agent' && message?.ex_agent_session_id) {
          return message.ex_agent_session_id
        }
      }
      return undefined
    },
    [conversationMessages]
  )

  // Fetch CC slash commands when CC mode is enabled and conversation exists
  useEffect(() => {
    if (ccMode && ccModeAvailable && currentConversationId) {
      dispatch(fetchCCSlashCommands({ conversationId: currentConversationId, cwd: ccCwd || undefined }))
    } else if (!ccMode) {
      // Clear slash commands when CC mode is disabled
      dispatch(chatSliceActions.ccSlashCommandsCleared())
    }
  }, [ccMode, ccModeAvailable, currentConversationId, ccCwd, dispatch])

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
  // useEffect(() => {
  //   const inputArea = inputAreaRef.current
  //   if (!inputArea) return

  //   const observer = new ResizeObserver(entries => {
  //     for (const entry of entries) {
  //       let height = entry.contentRect.height
  //       // Use borderBoxSize if available for more accurate height including padding/borders
  //       if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
  //         height = entry.borderBoxSize[0].blockSize
  //       }

  //       // Add margin
  //       const style = window.getComputedStyle(inputArea)
  //       const marginBottom = parseFloat(style.marginBottom) || 0

  //       // if (height > 0) {
  //       //   setInputAreaHeight(height + marginBottom)
  //       // }
  //     }
  //   })

  //   observer.observe(inputArea)

  //   // Initial measurement
  //   const rect = inputArea.getBoundingClientRect()
  //   const style = window.getComputedStyle(inputArea)
  //   const marginBottom = parseFloat(style.marginBottom) || 0
  //   if (rect.height > 0) {
  //     setInputAreaHeight(rect.height + marginBottom)
  //   }

  //   return () => {
  //     observer.disconnect()
  //   }
  // }, [])

  // Measure messages container height dynamically
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => {
      setContainerHeight(container.clientHeight)
    })

    observer.observe(container)

    // Initial measurement
    if (container.clientHeight > 0) {
      setContainerHeight(container.clientHeight)
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

  // Helper: scroll to show latest message at top of viewport (for normal mode)
  const scrollToShowLatestAtTop = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // console.log('scrolling to top')
    const container = messagesContainerRef.current
    if (!container) return

    // Scroll to position the latest message near the top of the viewport
    // We scroll to the bottom, which naturally shows the newest message
    const targetScroll = container.scrollHeight - container.clientHeight
    // console.log('targetScroll', targetScroll, container.scrollHeight, container.clientHeight)
    container.scrollTo({ top: Math.max(0, targetScroll), behavior })
  }, [])

  // Heimdall state from Redux
  const heimdallData = useAppSelector(selectHeimdallData)
  const loading = useAppSelector(selectHeimdallLoading)
  const error = useAppSelector(selectHeimdallError)
  const compactMode = useAppSelector(selectHeimdallCompactMode)
  const selectedProject = useAppSelector(selectSelectedProject)

  // React Query hooks for model management
  const { data: modelsData } = useModels(providers.currentProvider)
  // const { data: recentModelsData } = useRecentModels(5)
  // const refreshModelsMutation = useRefreshModels()
  const selectModelMutation = useSelectModel()
  const selectedModel = useSelectedModel(providers.currentProvider)

  // Filtered models hook for local filtering and sorting
  const { filteredModels, filters, sortOptions, applyFilters, clearFilters, applySorting, refreshFavorites } =
    useFilteredModels(providers.currentProvider)

  // Extract models array and user tier status from React Query response
  const models = modelsData?.models || []
  const userIsFreeTier = modelsData?.userIsFreeTier ?? false

  // Compute disabled model options for free tier users
  // Free users can see all models but can only select free tier ones
  const disabledModelOptions = useMemo(() => {
    if (!userIsFreeTier) return [] // Paid users can select any model
    return models.filter(m => !m.isFreeTier).map(m => m.name)
  }, [userIsFreeTier, models])

  // Sort filtered models: free tier models appear first when user is on free tier
  const sortedFilteredModels = useMemo(() => {
    if (!userIsFreeTier) return filteredModels // Paid users see default order

    // Partition models into free and paid, preserving original order within each group
    const freeModels = filteredModels.filter(m => m.isFreeTier)
    const paidModels = filteredModels.filter(m => !m.isFreeTier)

    return [...freeModels, ...paidModels]
  }, [userIsFreeTier, filteredModels])
  // Conversation title editing
  const currentConversation = useAppSelector(
    currentConversationId ? makeSelectConversationById(currentConversationId) : () => null
  )
  // Fetch conversations for the current project using React Query
  // Use projectId from URL first (ensures correct cache is active on page refresh)
  const { data: projectConversations = [] } = useConversationsByProject(
    projectIdFromUrl || selectedProject?.id || currentConversation?.project_id || null
  )

  // Fetch storage mode using the robust hook
  const { data: storageModeFromHook } = useConversationStorageMode(conversationIdFromUrl)

  // Compute storage_mode from projectConversations (already loaded from ConversationPage)
  // This avoids unreliable cache lookups inside queryFn
  const conversationStorageMode = useMemo(() => {
    // Priority 1: Navigation state (immediate availability for new chats)
    if (storageModeFromNav) return storageModeFromNav

    // Priority 2: Hook result (robust check checking all caches + local fetch)
    if (storageModeFromHook) return storageModeFromHook

    if (!conversationIdFromUrl) {
      // console.log('[Chat] conversationStorageMode: No conversationIdFromUrl')
      return undefined
    }

    // Priority 3: Check project conversations cache
    const conv = projectConversations.find(c => String(c.id) === String(conversationIdFromUrl))
    if (conv?.storage_mode) return conv.storage_mode

    // Priority 4: Check all conversations cache (fallback)
    const allConvs = queryClient.getQueryData<Conversation[]>(['conversations'])
    const match = allConvs?.find(c => String(c.id) === String(conversationIdFromUrl))
    return match?.storage_mode
  }, [conversationIdFromUrl, projectConversations, storageModeFromNav, storageModeFromHook, queryClient])

  // React Query for message fetching (automatic deduplication and caching)
  // Use URL-derived ID to ensure correct fetching even on page refresh
  // Single request fetches both messages AND tree data to eliminate duplicate requests
  // Pass storage_mode from projectConversations to correctly route to local/cloud API
  const { data: conversationData } = useConversationMessages(conversationIdFromUrl, conversationStorageMode)
  const reactQueryMessages = conversationData?.messages || []
  const treeData = conversationData?.tree

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

      // Sync to local database in Electron mode
      // This handles syncing messages fetched from the server to the local SQLite DB
      if (import.meta.env.VITE_ENVIRONMENT === 'electron' && conversationIdFromUrl) {
        // Use type assertion or cast if the action is not properly typed in the dispatch
        // but since it's a thunk, dispatch handles it fine.
        ;(dispatch as any)(
          syncConversationToLocal({
            conversationId: String(conversationIdFromUrl),
            messages: reactQueryMessages,
          })
        )
      }

      // Process attachments from React Query response
      // This converts attachment URLs to base64 artifacts for display in ChatMessage
      reactQueryMessages.forEach(msg => {
        const includedAttachments = (msg as any).attachments
        if (includedAttachments && Array.isArray(includedAttachments) && includedAttachments.length > 0) {
          // Dispatch attachment metadata immediately
          dispatch(
            chatSliceActions.attachmentsSetForMessage({
              messageId: msg.id,
              attachments: includedAttachments,
            })
          )

          // Fetch and convert binaries to base64 asynchronously (don't await, let it run in background)
          Promise.all(
            includedAttachments.map(async (a: any) => {
              const url = resolveAttachmentUrl(a.url, a.storage_path || a.file_path, a.id)
              if (!url) return null
              try {
                const res = await fetch(url)
                if (!res.ok) return null
                const blob = await res.blob()
                return await blobToDataURL(blob)
              } catch {
                return null
              }
            })
          ).then(dataUrls => {
            const validUrls = dataUrls.filter((x): x is string => Boolean(x))
            if (validUrls.length > 0) {
              dispatch(chatSliceActions.messageArtifactsSet({ messageId: msg.id, artifacts: validUrls }))
            }
          })
        }
      })
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
  const [heimdallVisible, setHeimdallVisible] = useState<boolean>(() => {
    try {
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('chat:heimdallVisible') : null
      // Check if on mobile (< 768px) to set appropriate default
      const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768
      const defaultValue = isMobileDevice ? false : true
      return stored !== null ? stored === 'true' : defaultValue
    } catch {
      // Fallback: check if mobile
      const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768
      return isMobileDevice ? false : true
    }
  })
  // Detect if user is on mobile device (below md breakpoint: 768px)
  const isMobile = useIsMobile()
  // One-time spin flags for icon buttons
  const [spinSettings, setSpinSettings] = useState(false)
  // const [spinRefresh, setSpinRefresh] = useState(false)
  // Session-level delete confirmation preference and modal state
  const [confirmDel, setconfirmDel] = useState<boolean>(true)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [dontAskAgain, setDontAskAgain] = useState<boolean>(false)

  useEffect(() => {
    if (!isResizing) return

    const clamp = (v: number) => Math.max(20, Math.min(99, v))

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

  // Load cwd from conversation when conversation changes
  // This populates the Claude Code working directory from cached conversation data
  useEffect(() => {
    if (currentConversationId && projectConversations.length > 0) {
      // Find the current conversation in projectConversations (React Query cache)
      const conversation = projectConversations.find(c => c.id === currentConversationId)

      // Extract cwd from the conversation, default to empty string if not set
      const conversationCwd = conversation?.cwd ?? ''

      // Update ccCwd state with the loaded value
      setCcCwd(conversationCwd)
    } else {
      // If no conversation is selected, clear cwd
      setCcCwd('')
    }
  }, [currentConversationId, projectConversations])

  // Auto-sync cwd from IDE extension when connected
  useEffect(() => {
    // Only run if:
    // 1. IDE extension is connected
    // 2. workspace.rootPath is available
    // 3. There's an active conversation
    // 4. rootPath differs from current ccCwd (avoid redundant updates)
    if (
      ideContext?.extensionConnected &&
      workspace?.rootPath &&
      currentConversationId &&
      workspace.rootPath !== ccCwd
    ) {
      // Update local state
      setCcCwd(workspace.rootPath)

      // Persist to database
      dispatch(
        updateCwd({
          id: currentConversationId,
          cwd: workspace.rootPath,
        })
      )
    }
  }, [ideContext?.extensionConnected, workspace?.rootPath, currentConversationId, ccCwd, dispatch])

  // Debounce cwd updates to save manual input to database
  // Similar pattern to title update debounce (lines 503-556)
  useEffect(() => {
    if (!currentConversationId) return

    // Find current conversation to compare against stored value
    const conversation = projectConversations.find(c => c.id === currentConversationId)
    const storedCwd = conversation?.cwd ?? ''

    // Normalize for comparison (treat empty string same as null/undefined)
    const normalizedCcCwd = ccCwd.trim()
    const normalizedStoredCwd = (storedCwd || '').trim()

    // No-op if unchanged
    if (normalizedCcCwd === normalizedStoredCwd) return

    const handle = setTimeout(() => {
      dispatch(
        updateCwd({
          id: currentConversationId,
          cwd: normalizedCcCwd || null, // Convert empty string to null
        })
      )
        .unwrap()
        .then(() => {
          // Update React Query caches to reflect the new cwd
          const projectId = selectedProject?.id || conversation?.project_id

          // Update all conversations cache
          const conversationsCache = queryClient.getQueryData<Conversation[]>(['conversations'])
          if (conversationsCache) {
            queryClient.setQueryData(
              ['conversations'],
              conversationsCache.map(conv =>
                conv.id === currentConversationId ? { ...conv, cwd: normalizedCcCwd || null } : conv
              )
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
                  conv.id === currentConversationId ? { ...conv, cwd: normalizedCcCwd || null } : conv
                )
              )
            }
          }
        })
        .catch(error => {
          console.error('Failed to update conversation cwd:', error)
        })
    }, 1000) // 1 second debounce (same as title)

    return () => clearTimeout(handle)
  }, [ccCwd, currentConversationId, projectConversations, dispatch, queryClient, selectedProject?.id])

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
  // - Only enabled when CC mode is active
  // - While streaming: keep pinned unless user scrolled away. If user returns near bottom, re-enable pinning.
  // - After streaming completes: only auto-scroll when there is no explicit selection path
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    // Only enable auto-scroll when in CC mode
    if (!ccMode) return

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
    streamState.toolCalls,
    streamState.active,
    streamState.finished,
    selectedPath,
    scheduleScrollToBottom,
    ccMode,
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

  // Scroll to show new message at top when stream starts (normal mode only)
  useEffect(() => {
    if (streamState.active && !ccMode) {
      // Scroll to position new message at top of viewport
      // setTimeout(() => {
      //   scrollToShowLatestAtTop('smooth')
      // }, 450)
      scrollToShowLatestAtTop('smooth')
    }
  }, [streamState.active, ccMode, scrollToShowLatestAtTop])

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
  // const location = useLocation() // Moved to top
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

  // Models are now loaded automatically via React Query hooks
  // No manual loading needed - React Query handles caching and refetching
  // Filtering and sorting is handled by useFilteredModels hook

  // Sync local input with Redux state when conversation changes
  useEffect(() => {
    setLocalInput(messageInput.content)
  }, [messageInput.content, currentConversationId])

  // Set OpenRouter as default provider if no provider is selected
  useEffect(() => {
    if (!providers.currentProvider) {
      dispatch(chatSliceActions.providerSelected('OpenRouter'))
    }
  }, [providers.currentProvider, dispatch])

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
        selectModelMutation.mutate({ provider: providers.currentProvider, model })
      } else {
        console.warn('Selected model not found:', modelName)
      }
    },
    [models, selectModelMutation, providers.currentProvider]
  )
  // Commented out - provider selection removed from UI, defaulting to OpenRouter
  // const handleProviderSelect = useCallback(
  //   (providerName: string) => {
  //     dispatch(chatSliceActions.providerSelected(providerName))
  //   },
  //   [dispatch]
  // )
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
      // Re-enable auto-pinning for CC mode sends until the user scrolls during this stream
      if (ccMode) {
        userScrolledDuringStreamRef.current = false
      }
      if (canSendLocal && currentConversationId) {
        // Check if this is a retrigger scenario (empty input + last message is user)
        const isRetrigger =
          localInput.trim().length === 0 &&
          displayMessages.length > 0 &&
          displayMessages[displayMessages.length - 1]?.role === 'user'

        const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

        // CC Mode: Send via sendCCMessage instead of sendMessage (disabled in web mode)
        if (ccMode && ccModeAvailable) {
          const parent: MessageId | null = selectedPath.length > 0 ? selectedPath[selectedPath.length - 1] : null
          const lastExAgentSessionId = findLastExAgentSession(selectedPath)

          if (isRetrigger) {
            // Retrigger in CC mode: Use the last user message's content
            const lastUserMessage = displayMessages[displayMessages.length - 1]

            if (!lastUserMessage) {
              console.error('Cannot retrigger: No last user message found in displayMessages')
              return
            }

            const contentToRetrigger = lastUserMessage.content

            // Immediately scroll to bottom for CC mode retrigger
            scrollToBottomNow('auto')

            // Dispatch sendCCMessage with retrigger content
            dispatch(
              sendCCMessage({
                conversationId: currentConversationId,
                message: contentToRetrigger,
                cwd: ccCwd || undefined,
                permissionMode: 'default',
                resume: true,
                parentId: parent,
                sessionId: lastExAgentSessionId,
              })
            )
              .unwrap()
              .catch(error => {
                console.error('Failed to send CC retrigger message:', error)
              })
          } else {
            // Normal CC mode send
            const processedContent = replaceFileMentionsWithPath(localInput)

            // Update Redux state with processed content before sending
            dispatch(chatSliceActions.inputChanged({ content: processedContent }))

            // Clear local input immediately after sending
            setLocalInput('')

            // Immediately scroll to bottom for CC mode send
            scrollToBottomNow('auto')

            // Dispatch sendCCMessage
            dispatch(
              sendCCMessage({
                conversationId: currentConversationId,
                message: processedContent,
                cwd: ccCwd || undefined,
                permissionMode: 'default',
                resume: true,
                parentId: parent,
                sessionId: lastExAgentSessionId,
              })
            )
              .unwrap()
              .catch(error => {
                console.error('Failed to send CC message:', error)
              })
          }
        } else {
          // Regular message send (non-CC mode)
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
                  recentCache.map(conv =>
                    conv.id === currentConversationId ? { ...conv, title: generatedTitle } : conv
                  )
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
      ccMode,
      ccCwd,
      ccModeAvailable,
      projectConversations,
      queryClient,
      selectedProject,
      currentConversation,
      findLastExAgentSession,
    ]
  )

  const handleStopGeneration = useCallback(() => {
    if (streamState.streamingMessageId) {
      dispatch(abortStreaming({ messageId: streamState.streamingMessageId }))
    }
  }, [streamState.streamingMessageId, dispatch])

  const handleMessageEdit = useCallback(
    (id: string, newContent: string, newContentBlocks?: any) => {
      const parsedId = parseId(id)
      // Only dispatch updateMessage thunk - it will dispatch messageUpdated internally on success
      // This prevents double updates and race conditions
      const updatePayload: any = { id: parsedId, content: newContent }
      if (newContentBlocks) {
        updatePayload.content_blocks = newContentBlocks
      }
      dispatch(updateMessage(updatePayload))
      // console.log(parsedId)
    },
    [dispatch]
  )

  const handleMessageBranch = useCallback(
    (id: string, newContent: string, _newContentBlocks?: any) => {
      if (currentConversationId) {
        // Replace any @file mentions with actual file contents before branching
        const processed = replaceFileMentionsWithPath(newContent)
        const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'
        const parsedId = parseId(id)
        const originalMessage = conversationMessages.find(m => m.id === parsedId)

        // If Claude Code mode is enabled, fork the CC session instead of branching normally (disabled in web mode)
        if (ccMode && ccModeAvailable && originalMessage) {
          // Use shared helper to find last ex_agent session ID
          const lastExAgentSessionId = findLastExAgentSession(selectedPath)

          const branchParentId =
            originalMessage.role === 'ex_agent' ? originalMessage.id : (originalMessage.parent_id ?? null)

          // Always use sendCCBranch for branching operations, even when parentId is null (root branch)
          dispatch(
            sendCCBranch({
              conversationId: currentConversationId,
              message: processed,
              cwd: ccCwd || undefined,
              permissionMode: 'default',
              resume: true,
              parentId: branchParentId,
              sessionId: lastExAgentSessionId,
              forkSession: true,
            })
          )
            .unwrap()
            .catch(error => {
              console.error('Failed to fork CC branch session:', error)
            })
        } else {
          // Regular message branching logic (non-CC mode)
          if (isWebMode) {
            if (originalMessage) {
              // Create optimistic branch message for instant UI feedback (web mode only)
              const optimisticBranchMessage: Message = {
                id: `branch-temp-${Date.now()}`,
                conversation_id: currentConversationId,
                role: 'user' as const,
                content: processed,
                content_plain_text: processed,
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
              originalMessageId: parsedId,
              newContent: processed,
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
      }
    },
    [
      currentConversationId,
      selectedModel?.name,
      think,
      ccMode,
      ccCwd,
      ccModeAvailable,
      dispatch,
      replaceFileMentionsWithPath,
      conversationMessages,
      queryClient,
    ]
  )

  const handleExplainFromSelection = useCallback(
    (id: string, newContent: string) => {
      if (currentConversationId) {
        // Replace any @file mentions with actual file contents before branching
        const processed = replaceFileMentionsWithPath(newContent)
        // console.log(processed)

        // Find the message to check if it has children
        const parsedId = parseId(id)
        const originalMessage = conversationMessages.find(m => m.id === parsedId)

        if (!originalMessage) {
          console.error('Message not found:', id)
          return
        }

        // Check if message has children
        const hasChildren = originalMessage.children_ids && originalMessage.children_ids.length > 0

        if (!hasChildren) {
          // No children: send a new message with this message as parent (linear continuation)
          const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

          if (isWebMode) {
            // Create optimistic message for instant UI feedback
            const optimisticUserMessage: Message = {
              id: `temp-${Date.now()}`,
              conversation_id: currentConversationId,
              role: 'user' as const,
              content: newContent,
              content_plain_text: newContent,
              parent_id: parsedId,
              children_ids: [],
              created_at: new Date().toISOString(),
              model_name: selectedModel?.name || '',
              partial: false,
              pastedContext: [],
              artifacts: [],
            }
            dispatch(chatSliceActions.optimisticMessageSet(optimisticUserMessage))
          }

          // Send as a regular message with the selected message as parent
          dispatch(
            sendMessage({
              conversationId: currentConversationId,
              input: { content: newContent },
              parent: parsedId,
              repeatNum: 1,
              think: think,
            })
          )
            .unwrap()
            .then(result => {
              if (!result?.userMessage) {
                console.warn('Server did not confirm user message')
              }
              // Messages already added to Redux via SSE stream
            })
            .catch(error => {
              // Clear optimistic message on error
              if (isWebMode) {
                dispatch(chatSliceActions.optimisticMessageCleared())
              }
              console.error('Failed to send message:', error)
            })
        } else {
          // Has children: create a branch (same as branch button behavior)
          const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'

          if (isWebMode) {
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

          dispatch(
            editMessageWithBranching({
              conversationId: currentConversationId,
              originalMessageId: parsedId,
              newContent: processed,
              modelOverride: selectedModel?.name,
              think: think,
            })
          )
            .unwrap()
            .then(() => {
              // Invalidate React Query cache after successful branch to fetch new messages
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
      }
    },
    [
      currentConversationId,
      selectedModel?.name,
      think,
      dispatch,
      replaceFileMentionsWithPath,
      conversationMessages,
      queryClient,
    ]
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

    const parsedNodeId = parseId(nodeId)

    // Only trigger scroll if clicking a different node than currently visible
    // This allows re-scrolling after manual navigation, but prevents redundant scrolls
    if (parsedNodeId !== visibleMessageId) {
      // Mark this selection as user-initiated so the scroll-to-selection effect may run
      selectionScrollCauseRef.current = 'user'
    }

    // Treat user selection during streaming as an override to bottom pinning
    if (streamState.active) {
      userScrolledDuringStreamRef.current = true
    }
    dispatch(chatSliceActions.conversationPathSet(path.map(id => parseId(id))))
    dispatch(chatSliceActions.selectedNodePathSet(path))

    dispatch(chatSliceActions.focusedChatMessageSet(parsedNodeId))
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
      // console.log('[Chat] performDelete called:', {
      //   messageId,
      //   currentConversationId,
      //   conversationStorageMode,
      // })
      dispatch(chatSliceActions.messageDeleted(messageId))
      if (currentConversationId) {
        dispatch(
          deleteMessage({ id: messageId, conversationId: currentConversationId, storageMode: conversationStorageMode })
        )
        dispatch(refreshCurrentPathAfterDelete({ conversationId: currentConversationId, messageId }))
      }
    },
    [dispatch, currentConversationId, conversationStorageMode]
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

  // Handle adding text to research note
  const handleAddToNote = useCallback(
    (text: string) => {
      if (!currentConversationId) {
        console.warn('No active conversation to add note to')
        return
      }

      // Get current research note from conversation
      const existingNote = currentConversation?.research_note || ''

      // Create timestamp for the note entry
      const timestamp = new Date().toLocaleString()

      // Append new text with timestamp and separator
      const separator = existingNote ? '\n\n---\n\n' : ''
      const newEntry = `[${timestamp}]\n${text}`
      const updatedNote = existingNote + separator + newEntry

      // Dispatch update action
      dispatch(updateResearchNote({ id: currentConversationId, researchNote: updatedNote }))
        .unwrap()
        .then(() => {
          // Update React Query caches to reflect the new research note
          const projectId = selectedProject?.id || currentConversation?.project_id

          // Update all conversations cache
          const conversationsCache = queryClient.getQueryData<Conversation[]>(['conversations'])
          if (conversationsCache) {
            queryClient.setQueryData(
              ['conversations'],
              conversationsCache.map(conv =>
                conv.id === currentConversationId ? { ...conv, research_note: updatedNote } : conv
              )
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
                  conv.id === currentConversationId ? { ...conv, research_note: updatedNote } : conv
                )
              )
            }
          }

          // Update recent conversations cache
          const recentCache = queryClient.getQueryData<Conversation[]>(['conversations', 'recent'])
          if (recentCache) {
            queryClient.setQueryData(
              ['conversations', 'recent'],
              recentCache.map(conv =>
                conv.id === currentConversationId ? { ...conv, research_note: updatedNote } : conv
              )
            )
          }

          // Update research notes cache
          const researchNotesCache = queryClient.getQueryData<ResearchNoteItem[]>(['research-notes', userId])
          if (researchNotesCache) {
            // If note is empty or whitespace, remove from list
            if (!updatedNote || updatedNote.trim().length === 0) {
              queryClient.setQueryData(
                ['research-notes', userId],
                researchNotesCache.filter(item => item.id !== currentConversationId)
              )
            } else {
              // Update existing note or add new one
              const existingIndex = researchNotesCache.findIndex(item => item.id === currentConversationId)
              if (existingIndex >= 0) {
                // Update existing note
                queryClient.setQueryData(
                  ['research-notes', userId],
                  researchNotesCache.map(item =>
                    item.id === currentConversationId
                      ? {
                          ...item,
                          research_note: updatedNote,
                          updated_at: new Date().toISOString(),
                        }
                      : item
                  )
                )
              } else {
                // Add new note to the list
                queryClient.setQueryData(
                  ['research-notes', userId],
                  [
                    {
                      id: currentConversationId,
                      title: currentConversation?.title || `Conversation ${currentConversationId}`,
                      research_note: updatedNote,
                      updated_at: new Date().toISOString(),
                      project_id: projectId || null,
                    },
                    ...researchNotesCache,
                  ]
                )
              }
            }
          }

          // console.log('Added to research note successfully')
        })
        .catch(error => {
          console.error('Failed to update research note:', error)
        })
    },
    [currentConversationId, currentConversation, selectedProject, queryClient, dispatch, userId]
  )

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

  const handleAttachmentInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || [])
      if (files.length === 0) return

      const pdfFiles = files.filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      const imageFiles = files.filter(file => file.type.startsWith('image/'))

      if (pdfFiles.length > 0) {
        try {
          const pdfTexts = await Promise.all(
            pdfFiles.map(async file => {
              const text = await extractTextFromPdf(file)
              return `[Pdf Content for ${file.name}]:\n${text}`
            })
          )
          setLocalInput(prev => {
            const prefix = prev ? `${prev}\n\n` : ''
            return prefix + '```\n' + pdfTexts + '\n``` \n\n'
          })
          inputAreaRef.current?.querySelector('textarea')?.focus()
        } catch (err) {
          console.error('Failed to extract PDF text(s)', err)
        }
      }

      if (imageFiles.length > 0) {
        Promise.all(
          imageFiles.map(async image => {
            const dataUrl = await blobToDataURL(image)
            return { dataUrl, name: image.name, type: image.type, size: image.size }
          })
        )
          .then(drafts => {
            dispatch(chatSliceActions.imageDraftsAppended(drafts))
            if (focusedChatMessageId != null) {
              dispatch(
                chatSliceActions.messageArtifactsAppended({
                  messageId: focusedChatMessageId,
                  artifacts: drafts.map(d => d.dataUrl),
                })
              )
            }
          })
          .catch(err => console.error('Failed to read selected images', err))
      }

      e.target.value = ''
    },
    [dispatch, focusedChatMessageId]
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

  // Refresh models using React Query mutation
  // const handleRefreshModels = useCallback(() => {
  //   if (providers.currentProvider) {
  //     refreshModelsMutation.mutate(providers.currentProvider)
  //   }
  // }, [providers.currentProvider, refreshModelsMutation])

  // Memoized message list to prevent re-rendering all messages when unrelated state changes
  const memoizedMessageList = useMemo(() => {
    // Filter out any undefined/null messages or messages with invalid IDs
    return displayMessages
      .filter(msg => msg && msg.id != null)
      .map(msg => {
        // Parse tool_calls into structured ToolCall array if present
        // Handles both formats:
        // - String (from SQLite in local mode): needs JSON.parse()
        // - Object/Array (from Supabase in web mode): already parsed
        let toolCalls: ToolCall[] | undefined = undefined
        if (msg.tool_calls) {
          try {
            // If tool_calls is already an object/array (from Supabase), use it directly
            if (typeof msg.tool_calls === 'object') {
              toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [msg.tool_calls]
            } else if (typeof msg.tool_calls === 'string') {
              // If it's a string (from SQLite), parse it
              const parsed = JSON.parse(msg.tool_calls)
              toolCalls = Array.isArray(parsed) ? parsed : [parsed]
            }
          } catch (error) {
            console.warn(`Failed to parse tool_calls for message ${msg.id}:`, msg.tool_calls, error)
          }
        }

        // Parse content_blocks for assistant messages with sequential rendering
        // Handles both formats:
        // - String (from SQLite): needs JSON.parse()
        // - Object/Array (from Supabase): already parsed
        // Prioritize content_blocks over legacy fields (content, thinking_block, tool_calls)
        let contentBlocks: ContentBlock[] | undefined = undefined
        if ((msg.role === 'assistant' || msg.role === 'ex_agent') && msg.content_blocks) {
          try {
            if (typeof msg.content_blocks === 'object') {
              contentBlocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [msg.content_blocks]
            } else if (typeof msg.content_blocks === 'string') {
              const parsed = JSON.parse(msg.content_blocks)
              contentBlocks = Array.isArray(parsed) ? parsed : [parsed]
            }
            // Ensure all blocks have an index property, add if missing
            if (contentBlocks && contentBlocks.length > 0) {
              contentBlocks = contentBlocks.map((block, idx) => ({
                ...block,
                index: block.index !== undefined ? block.index : idx,
              }))
              // Sort by index to ensure chronological order
              contentBlocks.sort((a, b) => a.index - b.index)
            } else {
              // If content_blocks is empty after parsing, treat as undefined to use legacy rendering
              contentBlocks = undefined
            }
          } catch (error) {
            console.warn(`Failed to parse content_blocks for message ${msg.id}`, error)
            contentBlocks = undefined
          }
        }

        return (
          <ChatMessage
            key={msg.id}
            id={msg.id.toString()}
            role={msg.role}
            content={msg.content}
            thinking={msg.thinking_block}
            toolCalls={toolCalls}
            contentBlocks={contentBlocks}
            timestamp={msg.created_at}
            width='w-full'
            modelName={msg.model_name}
            artifacts={msg.artifacts}
            onEdit={handleMessageEdit}
            onBranch={handleMessageBranch}
            onDelete={handleRequestDelete}
            onResend={handleResend}
            onAddToNote={handleAddToNote}
            onExplainFromSelection={handleExplainFromSelection}
          />
        )
      })
  }, [
    displayMessages,
    handleMessageEdit,
    handleMessageBranch,
    handleRequestDelete,
    handleResend,
    handleAddToNote,
    handleExplainFromSelection,
  ])

  // Removed obsolete streaming completion effect that synthesized assistant messages.
  // The streaming thunks now dispatch messageAdded and messageBranchCreated directly,
  // and reducers update currentPath appropriately. This avoids race conditions and
  // incorrect parent linking that could break currentPath after branching.

  // Get current credits from user state (in USD cents)
  const current_credits = currentUser?.cached_current_credits ?? 0

  // Calculate token counts from displayed messages (current branch)
  // Includes system prompts and context from both project and conversation
  const tokenUsage = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0

    // Include project system prompt and context (counted as input tokens)
    if (selectedProject?.system_prompt) {
      inputTokens += estimateTokenCount(selectedProject.system_prompt)
    }
    if (selectedProject?.context) {
      inputTokens += estimateTokenCount(selectedProject.context)
    }

    // Include conversation system prompt and context (counted as input tokens)
    if (currentConversation?.system_prompt) {
      inputTokens += estimateTokenCount(currentConversation.system_prompt)
    }
    if (currentConversation?.conversation_context) {
      inputTokens += estimateTokenCount(currentConversation.conversation_context)
    }

    // Count tokens from messages
    displayMessages.forEach(msg => {
      if (!msg || !msg.content) return
      const tokens = estimateTokenCount(msg.content) + estimateTokenCount(JSON.stringify(msg.content_blocks))
      if (msg.role === 'user') {
        inputTokens += tokens
      } else if (msg.role === 'assistant' || msg.role === 'ex_agent') {
        outputTokens += tokens
      }
    })

    return { inputTokens, outputTokens }
  }, [
    displayMessages,
    selectedProject?.system_prompt,
    selectedProject?.context,
    currentConversation?.system_prompt,
    currentConversation?.conversation_context,
  ])

  // Calculate token limits: shared context budget between input and output
  const tokenLimits = useMemo(() => {
    const usdValue = current_credits / 100 // Convert credits to USD

    // Model context limit (shared between input + output)
    const totalContextLimit = selectedModel?.contextLength || 128_000
    // Hard cap on output tokens (some models have this limit regardless of context)
    const maxCompletionCap = selectedModel?.maxCompletionTokens || totalContextLimit

    // Cost is per 1K tokens: cost = (tokens / 1000) * costPer1K
    // So: tokens = (usd * 1000) / costPer1K
    const promptCostPer1K = selectedModel?.promptCost ?? 0
    const completionCostPer1K = selectedModel?.completionCost ?? 0

    // Calculate credit-based limits
    let creditInputLimit = Infinity
    let creditOutputLimit = Infinity

    if (promptCostPer1K > 0) {
      creditInputLimit = Math.floor((usdValue * 1000) / promptCostPer1K)
    }
    if (completionCostPer1K > 0) {
      creditOutputLimit = Math.floor((usdValue * 1000) / completionCostPer1K)
    }

    // Total budget is the minimum of context limit and credit-based limits
    const totalBudget = Math.min(totalContextLimit, creditInputLimit, creditOutputLimit)

    // Adaptive limits: as one grows, the other shrinks
    // Input limit = total budget minus output tokens already used
    // Output limit = total budget minus input tokens already used (capped by maxCompletionTokens)
    const maxInputTokens = Math.max(0, totalBudget - tokenUsage.outputTokens)
    const maxOutputTokens = Math.min(Math.max(0, totalBudget - tokenUsage.inputTokens), maxCompletionCap)

    return { maxInputTokens, maxOutputTokens, totalBudget }
  }, [
    selectedModel?.promptCost,
    selectedModel?.completionCost,
    selectedModel?.contextLength,
    selectedModel?.maxCompletionTokens,
    current_credits,
    tokenUsage.inputTokens,
    tokenUsage.outputTokens,
  ])

  // Calculate progress percentages
  const inputProgress = Math.min((tokenUsage.inputTokens / tokenLimits.maxInputTokens) * 100, 100)
  const outputProgress = Math.min((tokenUsage.outputTokens / tokenLimits.maxOutputTokens) * 100, 100)

  // Handler to refresh user credits
  const handleRefreshCredits = useCallback(async () => {
    if (!userId || !accessToken || isRefreshingCredits) return
    setIsRefreshingCredits(true)
    try {
      await dispatch(refreshUserCredits({ userId, accessToken })).unwrap()
    } catch (error) {
      console.error('Failed to refresh credits:', error)
    } finally {
      setIsRefreshingCredits(false)
    }
  }, [dispatch, userId, accessToken, isRefreshingCredits])

  return (
    <div ref={containerRef} className='flex h-full overflow-hidden bg-neutral-50 dark:bg-neutral-900'>
      <div
        className='relative flex flex-col flex-none min-w-0 sm:min-w-[240px] md:min-w-[280px] h-full dark:bg-neutral-900 bg-neutral-50 overflow-hidden'
        style={{ width: isMobile ? '100%' : heimdallVisible ? `${leftWidthPct}%` : '100%' }}
      >
        {/* Messages Display */}

        <div
          className={`relative ml-2 flex flex-col thin-scrollbar rounded-lg bg-transparent dark:bg-transparent flex-1 min-h-0 transition-[padding-bottom] duration-200 ${!heimdallVisible ? 'px-0 sm:px-0 md:px-0 lg:px-12 xl:px-20' : ''}`}
          style={{ paddingBottom: `0px` }}
        >
          {/* Conversation Title Editor */}
          {currentConversationId && (
            <div
              className={`absolute mb-2 top-0 left-0 px-2 z-10  mx-auto right-0 ${!heimdallVisible ? 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-3xl 2xl:max-w-4xl 3xl:max-w-6xl' : 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-4xl'}`}
            >
              <div className=' rounded-2xl flex items-center gap-2 py-1 xl:py-1 2xl:p-2 mt-1 bg-transparent acrylic shadow-[0_2px_5px_1px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_12px_-6px_rgba(0,0,0,0.65)]  '>
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

                <Button
                  variant='outline2'
                  size='medium'
                  className='transition-transform duration-100 active:scale-95'
                  aria-label={heimdallVisible ? 'Hide Tree View' : 'Show Tree View'}
                  onClick={() => {
                    const newValue = !heimdallVisible
                    setHeimdallVisible(newValue)
                    try {
                      window.localStorage.setItem('chat:heimdallVisible', String(newValue))
                    } catch {}
                  }}
                  title={heimdallVisible ? 'Hide Tree View' : 'Show Tree View'}
                >
                  <img
                    src={getAssetPath('img/branchlighmode.svg')}
                    alt='tree view'
                    className='w-[22px] h-[22px] sm:w-[18px] sm:h-[18px] md:w-[18px] md:h-[18px] lg:w-[20px] lg:h-[20px] 2xl:w-[22px] 2xl:h-[22px] 3xl:w-[24px] 3xl:h-[24px] 4xl:w-[24px] 4xl:h-[24px] dark:hidden'
                  />
                  <img
                    src={getAssetPath('img/branchdarkmode.svg')}
                    alt='tree view'
                    className='w-[22px] h-[22px] sm:w-[18px] sm:h-[18px] md:w-[18px] md:h-[18px] lg:w-[20px] lg:h-[20px] 2xl:w-[22px] 2xl:h-[22px] 3xl:w-[24px] 3xl:h-[24px] 4xl:w-[24px] 4xl:h-[24px] hidden dark:block'
                  />
                  {/* <i
                    className={`bx ${heimdallVisible ? 'bx-sidebar' : 'bx-layout'} text-2xl transition-transform duration-200`}
                    aria-hidden='true'
                  ></i> */}
                </Button>

                <Button
                  variant='outline2'
                  size='medium'
                  className='transition-transform duration-100 active:scale-95'
                  aria-label='Refresh Messages'
                  onClick={() => {
                    if (currentConversationId) {
                      queryClient.invalidateQueries({
                        queryKey: ['conversations', currentConversationId, 'messages'],
                      })
                    }
                  }}
                  title='Refresh Messages'
                >
                  <i className='bx bx-refresh text-2xl' aria-hidden='true'></i>
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
                      variant='outline2'
                      size='medium'
                      className=''
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
                        setTimeout(
                          () => navigate(`/chat/${conv?.project_id || projectIdFromUrl || 'unknown'}/${val}`),
                          0
                        )
                      }}
                      options={sortedConversations.map(conv => ({
                        value: String(conv.id),
                        label: conv.title || 'Untitled Conversation',
                      }))}
                      blur='high'
                      placeholder='Select conversation...'
                      disabled={sortedConversations.length === 0}
                      className='flex-1 transition-transform min-w-0 outline-1 outline-neutral-200/40 dark:outline-neutral-700 rounded-lg'
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

          <div
            ref={messagesContainerRef}
            className={`flex flex-col pt-20 gap-2 px-0 ease-in-out  dark:border-neutral-700 border-stone-200 rounded-lg overflow-y-auto thin-scrollbar overscroll-y-contain touch-pan-y bg-transparent dark:bg-neutral-900 flex-1 min-h-0`}
            style={{
              ['overflowAnchor' as any]: 'none',
              // transform: 'translateZ(0)',
              willChange: 'contents',
              paddingBottom: `${containerHeight - 220}px`,
            }}
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
                streamState.toolCalls.length > 0 ||
                streamState.events.length > 0) && (
                <ChatMessage
                  id='streaming'
                  role='assistant'
                  content={streamState.buffer}
                  thinking={streamState.thinkingBuffer}
                  toolCalls={streamState.toolCalls}
                  streamEvents={streamState.events}
                  width='w-full'
                  modelName={selectedModel?.name || undefined}
                  className=''
                />
              )}
            {/* {streamState.active && (
              <div className='pb-4 px-3 flex justify-end'>
                <video
                  src={getAssetPath('video/loadingoutput.webm')}
                  autoPlay
                  loop
                  muted
                  playsInline
                  className='h-6 xl:h-8 w-auto rounded-full overflow-hidden'
                  style={{ imageRendering: 'auto' }}
                />
              </div>
            )} */}
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
        <div
          ref={inputAreaRef}
          className={`absolute z-10 bottom-0 left-0 right-0 mx-auto mb-2 px-2 sm:px-3 md:px-4 lg:px-4 2xl:px-4 ${!heimdallVisible ? 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-3xl 2xl:max-w-4xl 3xl:max-w-6xl' : 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-4xl'}`}
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {/* Controls row (above) */}

          {/* Textarea (bottom, grows upward because wrapper is bottom-pinned) */}
          <div
            className={`acrylic-subtle pb-1 ${inputAreaBorderClasses} rounded-3xl shadow-[0_0px_12px_-3px_rgba(0,0,0,0.05)] dark:shadow-[0_0px_24px_1px_rgba(0,0,0,0.65)] dark:bg-yBlack-900`}
          >
            {toolCallPermissionRequest && (
              <ToolPermissionDialog
                toolCall={toolCallPermissionRequest.toolCall}
                onGrant={() => dispatch(respondToToolPermission(true))}
                onDeny={() => dispatch(respondToToolPermission(false))}
                onAllowAll={() => dispatch(respondToToolPermissionAndEnableAll())}
              />
            )}
            <InputTextArea
              value={localInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyPress}
              onBlur={() => dispatch(chatSliceActions.inputChanged({ content: localInput }))}
              placeholder='Type your message...'
              state='default'
              width='w-full'
              minRows={1}
              autoFocus={true}
              showCharCount={false}
              slashCommands={ccMode && ccModeAvailable ? ccSlashCommands : undefined}
            />
            {/* Selected file chips moved from InputTextArea */}
            {selectedFilesForChat && selectedFilesForChat.length > 0 && (
              <div className='m-2 flex flex-wrap gap-2'>
                {selectedFilesForChat.map(file => {
                  const displayName =
                    file.name || file.relativePath.split('/').pop() || file.path.split('/').pop() || file.relativePath
                  const isExpanded = expandedFilePath === file.path
                  const isClosing = closingFilePath === file.path
                  const isOpening = openingFilePath === file.path
                  return (
                    <div
                      key={file.path}
                      className='relative px-2 group inline-flex items-center gap-2 max-w-full rounded-md border border-neutral-500 dark:bg-yBlack-900/20 dark:text-neutral-200 text-neutral-800 text-sm'
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
                      <span className='truncate max-w-[100px] sm:max-w-[150px] md:max-w-[220px]'>{displayName}</span>
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
                            : 'z-50 dark:bg-neutral-900 bg-slate-100 opacity-0 invisible scale-95 pointer-events-none w-64 sm:w-72 md:w-80 group-hover:opacity-100 group-hover:visible group-hover:scale-100'
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
            {/* Token Usage Progress Bar - Stacked */}
            <div className='ml-4 mr-6 my-0 group relative cursor-pointer'>
              <div className='flex items-center gap-2'>
                <div className='flex-1 h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden relative'>
                  {/* Render larger bar first (bottom), smaller bar second (top) */}
                  {inputProgress >= outputProgress ? (
                    <>
                      <div
                        className='absolute inset-0 h-full bg-blue-500 dark:bg-blue-400 rounded-full transition-all duration-300'
                        style={{ width: `${inputProgress}%` }}
                      />
                      <div
                        className='absolute inset-0 h-full bg-emerald-500 dark:bg-emerald-400 rounded-full transition-all duration-300'
                        style={{ width: `${outputProgress}%` }}
                      />
                    </>
                  ) : (
                    <>
                      <div
                        className='absolute inset-0 h-full bg-emerald-500 dark:bg-emerald-600 rounded-full transition-all duration-300'
                        style={{ width: `${outputProgress}%` }}
                      />
                      <div
                        className='absolute inset-0 h-full bg-blue-500 dark:bg-blue-600 rounded-full transition-all duration-300'
                        style={{ width: `${inputProgress}%` }}
                      />
                    </>
                  )}
                </div>
                {/* Refresh credits button */}
                <button
                  onClick={handleRefreshCredits}
                  disabled={isRefreshingCredits}
                  className='p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50'
                  title='Refresh credits'
                >
                  <svg
                    className={`w-3 h-3 text-neutral-500 dark:text-neutral-400 ${isRefreshingCredits ? 'animate-spin' : ''}`}
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15'
                    />
                  </svg>
                </button>
              </div>
              {/* Hover Popup with Token Details */}
              <div className='absolute left-1/2 -translate-x-1/2 bottom-full mb-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50'>
                <div className='bg-neutral-100 dark:bg-neutral-900 text-black dark:text-white rounded-lg shadow-lg px-3 py-2 whitespace-nowrap'>
                  <div className='flex items-center gap-2 text-xs'>
                    <span className='text-blue-700 dark:text-blue-400'>Input:</span>
                    <span>
                      {tokenUsage.inputTokens.toLocaleString()} / {tokenLimits.maxInputTokens.toLocaleString()}
                    </span>
                  </div>
                  <div className='flex items-center gap-2 text-xs mt-1'>
                    <span className='text-emerald-600 dark:text-emerald-400'>Output:</span>
                    <span>
                      {tokenUsage.outputTokens.toLocaleString()} / {tokenLimits.maxOutputTokens.toLocaleString()}
                    </span>
                  </div>
                  <div className='flex items-center gap-2 text-xs mt-1'>
                    <span className='text-neutral-900 dark:text-neutral-200'>Credits:</span>
                    <span>{(current_credits * 100).toFixed(3)}</span>
                  </div>
                  {/* Tooltip Arrow */}
                  <div className='absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-neutral-800 dark:border-t-neutral-900' />
                </div>
              </div>
            </div>
            <div className='bg-transparent rounded-b-4xl dark:bg-transparent flex flex-col items-end pt-3 md:pt-0'>
              <div className='flex justify-between w-full mb-0'>
                <div className='flex items-center justify-start gap-3 flex-wrap flex-1'>
                  {import.meta.env.VITE_ENVIRONMENT === 'electron' && (
                    <div
                      className='ide-status text-neutral-900 pl-2 max-w-18 sm:max-w-18 md:max-w-22 lg:max-w-24 xl:max-w-24 text-[14px] sm:text-[12px] md:text-[12px] lg:text-[12px] xl:text-[12px] 2xl:text-[13px] 3xl:text-[12px] 4xl:text-[22px] dark:text-neutral-200 break-words line-clamp-1 text-right'
                      title={workspace?.name ? `Workspace: ${workspace.name} connected` : ''}
                    >
                      {/* {ideContext?.extensionConnected ? '' : ''} */}
                      {workspace?.name && `'🟢 ' + ${workspace.name}`}
                    </div>
                  )}
                  <Button
                    variant='outline2'
                    className='rounded-full'
                    size='medium'
                    onClick={() => {
                      setSpinSettings(true)
                      setSettingsOpen(true)
                    }}
                    title='Chat Settings'
                  >
                    <i
                      className={`bx bx-cog ml-0.5 text-[22px] sm:text-[18px] md:text-[16px] lg:text-[16px] 2xl:text-[22px] 3xl:text-[28px] 4xl:text-[24px] ${spinSettings ? 'animate-[spin_0.6s_linear_1]' : ''}`}
                      aria-hidden='true'
                      onAnimationEnd={() => setSpinSettings(false)}
                    ></i>
                  </Button>
                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>Available: {providers.providers.length}</span> */}
                  {/* Provider selector commented out - defaulting to OpenRouter */}
                  {/* <Select
                    value={providers.currentProvider || ''}
                    onChange={handleProviderSelect}
                    options={providers.providers.map(p => p.name)}
                    placeholder='Select a provider...'
                    disabled={providers.providers.length === 0}
                    className='flex-1 max-w-24 sm:max-w-32 md:max-w-40 transition-transform duration-60 active:scale-97'
                    searchBarVisible={true}
                  /> */}
                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>{models.length} models</span> */}
                  <Select
                    value={selectedModel?.name || ''}
                    onChange={handleModelSelect}
                    options={sortedFilteredModels.map(m => m.name)}
                    placeholder='Select a model...'
                    blur='high'
                    disabled={sortedFilteredModels.length === 0}
                    disabledOptions={disabledModelOptions}
                    className='flex-1 max-w-32 sm:max-w-32 md:max-w-42 lg:max-w-54 transition-transform duration-60 active:scale-99 rounded-4xl'
                    searchBarVisible={true}
                    modelData={Object.fromEntries(sortedFilteredModels.map(m => [m.name, m]))}
                    onFavoritesChange={refreshFavorites}
                    filterUI={
                      <ModelFilterUI
                        filters={filters}
                        sortOptions={sortOptions}
                        onFiltersChange={applyFilters}
                        onSortChange={applySorting}
                        onClearFilters={clearFilters}
                      />
                    }
                    modelSelect={true}
                    footerContent={modelSelectFooter}
                  />
                  {import.meta.env.VITE_ENVIRONMENT === 'electron' && conversationIdFromUrl && (
                    <ActionPopover
                      isActive={toolAutoApprove || operationMode === 'plan' || ccMode}
                      footer={
                        <input
                          type='text'
                          value={ccCwd}
                          onChange={e => setCcCwd(e.target.value)}
                          placeholder='Working directory (optional)'
                          className='w-full px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-900 rounded-lg bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-orange-500/60'
                          title='Specify the working directory for Claude Code agent'
                        />
                      }
                    >
                      {/* Claude Code toggle */}
                      <Button
                        variant={ccMode ? 'outline2' : 'outline2'}
                        size='medium'
                        onClick={() => setCCMode(!ccMode)}
                        title='Toggle Claude Code Agent Mode'
                      >
                        <i
                          className={`bx bx-terminal mr-1 ${ccMode ? 'text-blue-700 dark:text-blue-300' : 'text-neutral-600 dark:text-neutral-200'}`}
                          aria-hidden='true'
                        ></i>
                        <div
                          className={`${ccMode ? 'text-blue-700 dark:text-blue-300' : 'text-neutral-600 dark:text-neutral-200'}`}
                        >
                          {ccMode ? 'CC On' : 'CC Off'}
                        </div>
                      </Button>

                      {/* Allow All / Ask toggle */}
                      <Button
                        variant='outline2'
                        size='medium'
                        onClick={() => dispatch(chatSliceActions.toolAutoApproveToggled())}
                        className={
                          toolAutoApprove
                            ? 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700/50 dark:hover:bg-white/5'
                            : 'text-neutral-600 dark:text-neutral-200 border-neutral-200 dark:border-neutral-700/50 dark:hover:bg-white/5'
                        }
                        title={
                          toolAutoApprove
                            ? 'Auto-approving tools (click to disable)'
                            : 'Asking for permission (click to auto-approve)'
                        }
                        aria-label={toolAutoApprove ? 'Disable auto-approve' : 'Enable auto-approve'}
                      >
                        <i className='bx bx-shield-quarter mr-1'></i>
                        {toolAutoApprove ? 'Allow all' : 'Ask'}
                      </Button>

                      {/* Chat / Agent toggle */}
                      <Button
                        variant='outline2'
                        size='medium'
                        onClick={() => dispatch(chatSliceActions.operationModeToggled())}
                        className={
                          operationMode === 'plan'
                            ? 'text-fuchsia-700 dark:text-fuchsia-300 bg-blue-50 dark:bg-blue-900/30 border-fuchsia-200 dark:border-fuchsia-700/60 hover:bg-blue-100 dark:hover:bg-white/5'
                            : 'text-orange-700 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 border-orange-300 dark:border-orange-700/50 hover:bg-orange-100 dark:hover:bg-white/5'
                        }
                        title={
                          operationMode === 'plan'
                            ? 'Plan mode enabled (tools will be blocked)'
                            : 'Execution mode enabled (tools may modify files)'
                        }
                        aria-label={operationMode === 'plan' ? 'Switch to execution mode' : 'Switch to plan mode'}
                      >
                        <i className={`bx ${operationMode === 'plan' ? 'bx-clipboard' : 'bx-code-block'} mr-1`}></i>
                        {operationMode === 'plan' ? 'Chat' : 'Agent'}
                      </Button>
                    </ActionPopover>
                  )}
                  {/* Thinking toggle - next to popover, disabled when not supported */}
                  <Button
                    variant='outline2'
                    className='rounded-full'
                    size='large'
                    onClick={() => setThink(t => !t)}
                    disabled={!selectedModel?.thinking}
                    title={selectedModel?.thinking ? 'Enable thinking' : 'Thinking not supported by this model'}
                  >
                    {think ? (
                      <>
                        <img
                          src={getAssetPath('img/thinkingonlightmode.svg')}
                          alt='Thinking active'
                          className='w-[28px] h-[28px] sm:w-[28px] sm:h-[28px] md:w-[28px] md:h-[28px] lg:w-[24px] lg:h-[24px] 2xl:w-[28px] 2xl:h-[28px] 3xl:w-[28px] 3xl:h-[28px] 4xl:w-[24px] 4xl:h-[24px] dark:hidden'
                        />
                        <img
                          src={getAssetPath('img/thinkingondarkmode.svg')}
                          alt='Thinking active'
                          className='w-[28px] h-[28px] sm:w-[28px] sm:h-[28px] md:w-[28px] md:h-[28px] lg:w-[24px] lg:h-[24px] 2xl:w-[28px] 2xl:h-[28px] 3xl:w-[28px] 3xl:h-[28px] 4xl:w-[24px] 4xl:h-[24px] hidden dark:block'
                        />
                      </>
                    ) : (
                      <>
                        <img
                          src={getAssetPath('img/thinkingofflightmode.svg')}
                          alt='Thinking'
                          className='w-[28px] h-[28px] sm:w-[28px] sm:h-[28px] md:w-[28px] md:h-[28px] lg:w-[24px] lg:h-[24px] 2xl:w-[28px] 2xl:h-[28px] 3xl:w-[28px] 3xl:h-[28px] 4xl:w-[24px] 4xl:h-[24px] dark:hidden'
                        />
                        <img
                          src={getAssetPath('img/thinkingoffdarkmode.svg')}
                          alt='Thinking'
                          className='w-[28px] h-[28px] sm:w-[28px] sm:h-[28px] md:w-[28px] md:h-[28px] lg:w-[24px] lg:h-[24px] 2xl:w-[28px] 2xl:h-[28px] 3xl:w-[28px] 3xl:h-[28px] 4xl:w-[24px] 4xl:h-[24px] hidden dark:block'
                        />
                      </>
                    )}
                  </Button>

                  {/* Attachment upload button */}
                  <input
                    ref={attachmentInputRef}
                    type='file'
                    accept='application/pdf,image/*'
                    multiple
                    onChange={handleAttachmentInputChange}
                    className='hidden'
                    aria-hidden='true'
                  />
                  <Button
                    variant='outline2'
                    className='rounded-full'
                    size='large'
                    onClick={() => attachmentInputRef.current?.click()}
                    title='Attach files'
                  >
                    <i className='bx bx-paperclip text-[22px]' aria-hidden='true'></i>
                  </Button>
                </div>
                <div className='flex items-center justify-end gap-2 pl-2.5'>
                  {!currentConversationId ? (
                    'Creating...'
                  ) : sendingState.streaming ? (
                    <Button
                      variant='outline2'
                      onClick={handleStopGeneration}
                      size='large'
                      disabled={!streamState.streamingMessageId}
                      title='Stop generation'
                    >
                      <i className='bx bx-stop-circle text-[18px]' aria-hidden='true'></i>
                    </Button>
                  ) : sendingState.sending ? (
                    'Sending...'
                  ) : (
                    <Button
                      variant={canSendLocal && currentConversationId ? 'outline2' : 'outline2'}
                      size='medium'
                      rounded='lg'
                      className='mr-2'
                      disabled={!canSendLocal || !currentConversationId}
                      title='Send message'
                      onClick={() => {
                        if (ccMode && ccModeAvailable && localInput.trim()) {
                          // Send to Claude Code agent (disabled in web mode)
                          const parent: MessageId | null =
                            selectedPath.length > 0 ? selectedPath[selectedPath.length - 1] : null

                          // Use shared helper to find last ex_agent session ID
                          const lastExAgentSessionId = findLastExAgentSession(selectedPath)

                          dispatch(
                            sendCCMessage({
                              conversationId: currentConversationId,
                              message: localInput.trim(),
                              cwd: ccCwd || undefined,
                              permissionMode: 'default',
                              resume: true,
                              parentId: parent,
                              sessionId: lastExAgentSessionId,
                            })
                          )
                            .unwrap()
                            .then(() => {
                              setLocalInput('')
                            })
                            .catch(error => {
                              console.error('Failed to send CC message:', error)
                            })
                        } else {
                          // Send normal message
                          handleSend(multiReplyCount)
                        }
                      }}
                    >
                      <i className='bx bx-send text-[24px] p-0 ' aria-hidden='true'></i>
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

      {/* SEPARATOR - Hidden on mobile */}
      {heimdallVisible && !isMobile && (
        <div
          className='w-2 z-10 dark:bg-neutral-900 bg-neutral-50 hover:dark:bg-neutral-800 hover:bg-neutral-200 cursor-col-resize select-none'
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
      )}

      {/* Desktop: side-by-side layout */}
      {heimdallVisible && !isMobile && (
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
            storageMode={conversationStorageMode}
          />
        </div>
      )}

      {/* Mobile: bottom drawer with backdrop */}
      {isMobile && (
        <>
          {/* Backdrop */}
          <AnimatePresence>
            {heimdallVisible && (
              <motion.div
                className='fixed inset-0 bg-black/50 z-[90]'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => {
                  setHeimdallVisible(false)
                  try {
                    window.localStorage.setItem('chat:heimdallVisible', 'false')
                  } catch {}
                }}
              />
            )}
          </AnimatePresence>

          {/* Drawer */}
          <AnimatePresence>
            {heimdallVisible && (
              <motion.div
                className='fixed bottom-0 left-0 right-0 h-[85vh] z-[100] bg-neutral-50 dark:bg-neutral-900 rounded-t-2xl shadow-2xl overflow-hidden'
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              >
                {/* Drag handle indicator */}
                <div className='w-full flex justify-center py-3 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700'>
                  <div className='w-12 h-1.5 bg-neutral-400 dark:bg-neutral-600 rounded-full' />
                </div>

                {/* Heimdall component */}
                <div className='h-[calc(100%-3rem)] overflow-hidden'>
                  <Heimdall
                    key={currentConversationId ?? 'none'}
                    chatData={heimdallData}
                    loading={loading}
                    error={error}
                    compactMode={compactMode}
                    conversationId={currentConversationId}
                    onNodeSelect={handleNodeSelect}
                    visibleMessageId={visibleMessageId}
                    storageMode={conversationStorageMode}
                  />
                </div>

                {/* Collapse button - bottom right corner */}
                <button
                  onClick={() => {
                    setHeimdallVisible(false)
                    try {
                      window.localStorage.setItem('chat:heimdallVisible', 'false')
                    } catch {}
                  }}
                  className='fixed bottom-6 right-6 z-110 w-12 h-12 rounded-full bg-neutral-700 dark:bg-neutral-600 hover:bg-neutral-800 dark:hover:bg-neutral-500 text-white shadow-lg flex items-center justify-center transition-colors'
                  aria-label='Close tree view'
                >
                  <i className='bx bx-chevron-down text-2xl' aria-hidden='true'></i>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
      <SettingsPane open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Centered custom delete confirmation modal */}
      {pendingDeleteId && confirmDel && (
        <div className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50' onClick={closeDeleteModal}>
          <div
            className='bg-white dark:bg-yBlack-900 rounded-lg shadow-xl p-6 w-[90%] max-w-sm'
            onClick={e => e.stopPropagation()}
          >
            <h3 className='text-[20px] font-semibold mb-6 text-neutral-900 dark:text-neutral-100'>Delete message?</h3>
            <p className='text-[14px] text-neutral-700 dark:text-neutral-300 mb-4'>This action cannot be undone.</p>
            <label className='flex items-center gap-2 mb-4 text-sm text-neutral-700 dark:text-neutral-300'>
              <input type='checkbox' checked={dontAskAgain} onChange={e => setDontAskAgain(e.target.checked)} />
              Don't ask again this session
            </label>
            <div className='flex justify-end gap-2 mt-8'>
              <Button variant='outline2' onClick={closeDeleteModal} className='active:scale-90'>
                Cancel
              </Button>
              <Button
                variant='outline2'
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
              style={{ left, top, maxWidth: '30vw', width: 'clamp(90vw, 90vw, 56rem)' }}
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
                className={`text-xs font-mono whitespace-pre-wrap break-words text-stone-800 dark:text-stone-200 ${isClosing ? 'opacity-50' : 'opacity-100'} transition-opacity duration-100 overflow-auto thin-scrollbar max-h-[60vh] overscroll-contain select-text`}
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

      {/* Free Tier Limit Modal */}
      <FreeGenerationsModal
        isOpen={showFreeTierModal}
        onClose={() => dispatch(chatSliceActions.freeTierLimitModalHidden())}
      />
    </div>
  )
}

export default Chat
