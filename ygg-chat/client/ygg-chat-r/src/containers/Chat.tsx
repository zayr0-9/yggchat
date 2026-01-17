import { useQueryClient } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import 'boxicons' // Types
import 'boxicons/css/boxicons.min.css'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { estimateTokenCount } from 'tokenx'
import { ImageConfig, MessageId, ReasoningConfig } from '../../../../shared/types'
import {
  ActionPopover,
  Button,
  ChatMessage,
  FreeGenerationsModal,
  Heimdall,
  InputTextArea,
  ModelSelectControl,
  Select,
  SettingsPane,
  TextField,
  ToolJobsModal,
  ToolPermissionDialog,
} from '../components'
import { useHtmlIframeRegistry } from '../components/HtmlIframeRegistry/HtmlIframeRegistry'
import {
  getStoredSendButtonAnimation,
  getStoredSendButtonColor,
  SendButtonAnimationType,
  SendButtonLoadingAnimation,
} from '../components/SettingsPane/SendButtonAnimationSettings'
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
  // Chat selectors
  selectCurrentViewStream,
  selectDisplayMessages,
  selectFocusedChatMessageId,
  selectHeimdallCompactMode,
  selectHeimdallData,
  selectHeimdallError,
  selectHeimdallLoading,
  selectMessageInput,
  selectMultiReplyCount,
  selectOperationMode,
  selectProviderState,
  selectSendingState,
  sendCCBranch,
  sendCCMessage,
  sendMessage,
  syncConversationToLocal,
  updateConversationTitle,
  updateMessage,
} from '../features/chats'
import type { ContentBlock, ToolCall } from '../features/chats/chatTypes'
import { clearTokens as clearOpenAITokens, isOpenAIAuthenticated, saveTokens } from '../features/chats/openaiOAuth'
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
import { removeSelectedFileForChat, selectExtension, updateIdeContext } from '../features/ideContext'
import {
  selectExtensions,
  selectSelectedExtensionId,
  selectSelectedFilesForChat,
  selectWorkspace,
} from '../features/ideContext/ideContextSelectors'
import { selectSelectedProject } from '../features/projects/projectSelectors'
import { refreshUserCredits, selectCurrentUser } from '../features/users'
import { selectSttConfig, selectVoiceInputEnabled, selectWakeWordConfig } from '../features/voiceSettings'
import {
  loadProviderSettings,
  PROVIDER_SETTINGS_CHANGE_EVENT,
  ProviderSettings,
} from '../helpers/providerSettingsStorage'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { useAuth } from '../hooks/useAuth'
import { useIdeContext } from '../hooks/useIdeContext'
import { useIsMobile } from '../hooks/useMediaQuery'
import {
  ResearchNoteItem,
  useConversationMessages,
  useConversationsByProject,
  useConversationStorageMode,
  useModels,
  useProjects,
  useResearchNotes,
  useSelectedModel,
  useSelectModel,
} from '../hooks/useQueries'
import { useSubscriptionStatus } from '../hooks/useSubscriptionStatus'
import { useWakeWord } from '../hooks/useWakeWord'
import { useWhisperSpeechToText } from '../hooks/useWhisperSpeechToText'
import { cloneConversation } from '../utils/api'
import { getAssetPath } from '../utils/assetPath'
import { parseId } from '../utils/helpers'
import { extractTextFromPdf } from '../utils/pdfUtils'
import RightBar from './rightBar'
import SideBar from './sideBar'

function Chat() {
  const dispatch = useAppDispatch()
  const { accessToken, userId } = useAuth()
  const navigate = useNavigate()
  const { ideContext, requestContext } = useIdeContext()
  const queryClient = useQueryClient()
  const htmlRegistry = useHtmlIframeRegistry()

  // Local state for input to completely avoid Redux dispatches during typing
  const [localInput, setLocalInput] = useState('')

  // Subscription status for free/paid detection
  const { isFreeUser } = useSubscriptionStatus(userId)

  // Research notes for the right sidebar
  const { data: researchNotes = [], isLoading: isLoadingResearchNotes } = useResearchNotes()
  const modelSelectFooter = isFreeUser ? (
    <div className='space-y-2'>
      {/* <div className='text-sm text-neutral-700 dark:text-neutral-200'>Subscribe now for access to all 400+ models</div> */}
      <Button
        variant='outline2'
        size='medium'
        className='w-full text-[13px] sm:text-[13px] md:text-[13px] lg:text-[14px] 2xl:text-[16px] 3xl:text-[18px] 4xl:text-[20px] text-neutral-500 dark:text-neutral-200'
        onClick={() => navigate('/payment')}
      >
        Subscribe now for access to all 400+ models
      </Button>
    </div>
  ) : null

  // Claude Code mode toggle (disabled in web mode)
  const [ccMode, _setCCMode] = useState(import.meta.env.VITE_ENVIRONMENT === 'web' ? false : false)

  // Claude Code working directory input (disabled in web mode)
  const [ccCwd, setCcCwd] = useState('')

  // Image generation configuration (aspect ratio and size for Gemini image models)
  const [imageConfig, setImageConfig] = useState<ImageConfig>({})

  // Reasoning configuration (effort level for extended thinking models)
  const [reasoningConfig, setReasoningConfig] = useState<ReasoningConfig>({ effort: 'medium' })

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

  // Provider settings from localStorage
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings())

  // Redux selectors
  const currentUser = useAppSelector(selectCurrentUser)
  const providers = useAppSelector(selectProviderState)
  const messageInput = useAppSelector(selectMessageInput)
  const operationMode = useAppSelector(selectOperationMode)
  // const canSendFromRedux = useAppSelector(selectCanSend)
  const sendingState = useAppSelector(selectSendingState)
  // Current view stream - automatically selects the relevant stream based on currentPath
  const currentViewStream = useAppSelector(selectCurrentViewStream)
  const streamingRoot = useAppSelector(state => state.chat.streaming)
  // Derived streamState object for compatibility (combines current view stream data)
  const streamState = useMemo(
    () => ({
      active: currentViewStream?.active ?? false,
      buffer: currentViewStream?.buffer ?? '',
      thinkingBuffer: currentViewStream?.thinkingBuffer ?? '',
      toolCalls: currentViewStream?.toolCalls ?? [],
      events: currentViewStream?.events ?? [],
      messageId: currentViewStream?.messageId ?? null,
      error: currentViewStream?.error ?? null,
      finished: currentViewStream?.finished ?? false,
      streamingMessageId: currentViewStream?.streamingMessageId ?? null,
    }),
    [currentViewStream]
  )
  const conversationMessages = useAppSelector(selectConversationMessages)
  const displayMessages = useAppSelector(selectDisplayMessages)
  const currentConversationId = useAppSelector(selectCurrentConversationId)
  const toolCallPermissionRequest = useAppSelector(state => state.chat.toolCallPermissionRequest)
  const toolAutoApprove = useAppSelector(state => state.chat.toolAutoApprove)
  const showFreeTierModal = useAppSelector(state => state.chat.freeTier.showLimitModal)
  // const freeGenerationsRemaining = useAppSelector(state => state.chat.freeTier.freeGenerationsRemaining)

  // React Query for message fetching - MOVED BELOW after projectConversations is available
  // to enable passing storage_mode from cached conversations
  const selectedPath = useAppSelector(selectCurrentPath)
  const multiReplyCount = useAppSelector(selectMultiReplyCount)
  const focusedChatMessageId = useAppSelector(selectFocusedChatMessageId)

  // Debug logging for stream switching - only when streams are active
  useEffect(() => {
    if (streamingRoot.activeIds.length > 0) {
      console.log(
        '[Chat] activeStreams:',
        streamingRoot.activeIds.length,
        'displaying:',
        currentViewStream?.id?.slice(-8) || 'none',
        'pathEnd:',
        selectedPath?.slice(-1)?.[0]?.slice(0, 8)
      )
    }
  }, [streamingRoot.activeIds, currentViewStream?.id, selectedPath])
  // const ideContext = useAppSelector(selectIdeContext)
  const workspace = useAppSelector(selectWorkspace)
  const extensions = useAppSelector(selectExtensions)
  const selectedExtensionId = useAppSelector(selectSelectedExtensionId)
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
  // Todo list collapsed state
  const [todoListCollapsed, setTodoListCollapsed] = useState(false)
  // Tool jobs modal state
  const [jobsModalOpen, setJobsModalOpen] = useState(false)
  // OpenAI ChatGPT login modal state
  const [openaiLoginModalOpen, setOpenaiLoginModalOpen] = useState(false)
  const [openaiAuthFlow, setOpenaiAuthFlow] = useState<{ url: string; verifier: string; state: string } | null>(null)
  // const [openaiCallbackInput, setOpenaiCallbackInput] = useState('')
  const [openaiAuthError, setOpenaiAuthError] = useState<string | null>(null)
  const [openaiAuthLoading, setOpenaiAuthLoading] = useState(false)
  const isElectronEnv = useMemo(
    () =>
      import.meta.env.VITE_ENVIRONMENT === 'electron' ||
      (typeof window !== 'undefined' && (window as any).__IS_ELECTRON__),
    []
  )
  const inputAreaBorderClasses =
    operationMode === 'plan'
      ? 'outline-1 outline-blue-200/70 dark:outline-neutral-700/50'
      : 'outline-2 dark:outline-2 dark:outline-orange-700/70 outline-orange-700/70'

  // Get voice settings from Redux
  const voiceInputEnabled = useAppSelector(selectVoiceInputEnabled)
  const sttConfig = useAppSelector(selectSttConfig)
  const wakeWordConfig = useAppSelector(selectWakeWordConfig)

  // Speech-to-text hook for voice input (Whisper-based, works offline)
  const {
    isListening,
    transcript: _speechTranscript,
    error: speechError,
    isLoading: speechLoading,
    isModelLoaded: speechModelLoaded,
    loadProgress: speechLoadProgress,
    toggleListening,
    startListening: startWhisperListening,
    preloadModel: preloadSpeechModel,
  } = useWhisperSpeechToText({
    model: sttConfig.model,
    language: sttConfig.language,
    silenceThreshold: sttConfig.silenceThreshold,
    onFinalTranscript: (text: string) => {
      // Append final transcript to input with a space separator
      setLocalInput(prev => (prev ? prev + ' ' + text : text.trim()))
    },
  })

  // Wake word hook - listens for "Hey Jarvis" to trigger voice input
  const {
    isListening: isWakeWordListening,
    isLoading: wakeWordLoading,
    error: wakeWordError,
    lastDetected: wakeWordLastDetected,
    startListening: startWakeWord,
    stopListening: stopWakeWord,
  } = useWakeWord({
    keywords: wakeWordConfig.keywords,
    threshold: wakeWordConfig.threshold,
    cooldownMs: wakeWordConfig.cooldownMs,
    autoStart: wakeWordConfig.autoStart && voiceInputEnabled,
    onDetected: (keyword, score) => {
      console.log(`[Chat] Wake word "${keyword}" detected with score ${score}`)
      // When wake word is detected, start Whisper recording
      if (!isListening && !speechLoading) {
        startWhisperListening()
      }
    },
  })

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

  // Filtered messages for virtualization - removes nulls and invalid IDs
  const filteredMessages = useMemo(() => {
    return displayMessages.filter(msg => msg && msg.id != null)
  }, [displayMessages])

  // Calculate padding for end of list - allows last message to scroll to middle of viewport
  const virtualizerPaddingEnd = useMemo(() => {
    return Math.max(500, containerHeight * 0.6)
  }, [containerHeight])

  // Determine if optimistic messages should be shown (all modes for instant feedback)
  const showOptimisticMessage = !!optimisticMessage
  const showOptimisticBranchMessage = !!optimisticBranchMessage

  // Determine if streaming message should be shown (include in virtualizer)
  const showStreamingMessage = useMemo(
    () =>
      streamState.active &&
      (Boolean(streamState.buffer) ||
        Boolean(streamState.thinkingBuffer) ||
        streamState.toolCalls.length > 0 ||
        streamState.events.length > 0),
    [streamState.active, streamState.buffer, streamState.thinkingBuffer, streamState.toolCalls, streamState.events]
  )

  // Calculate extra items count for virtualizer (optimistic + streaming)
  const extraItemsCount =
    (showOptimisticMessage ? 1 : 0) + (showOptimisticBranchMessage ? 1 : 0) + (showStreamingMessage ? 1 : 0)

  // Virtualizer for efficient message list rendering
  const virtualizer = useVirtualizer({
    count: filteredMessages.length + extraItemsCount,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: () => 200, // Estimated average message height
    overscan: 5, // Buffer 5 messages above/below viewport
    paddingEnd: virtualizerPaddingEnd,
  })

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
  const models = modelsData?.models || []

  // Helper to check if selected model is an image generation model
  const isImageGenerationModel = useMemo(() => {
    const modelName = selectedModel?.name?.toLowerCase() || ''
    return modelName.includes('gemini-3-pro-image-preview') || modelName.includes('gemini-2.5-flash-image')
  }, [selectedModel?.name])
  // Conversation title editing
  const currentConversation = useAppSelector(
    currentConversationId ? makeSelectConversationById(currentConversationId) : () => null
  )
  // Fetch conversations for the current project using React Query
  // Use projectId from URL first (ensures correct cache is active on page refresh)
  const { data: projectConversations = [] } = useConversationsByProject(
    projectIdFromUrl || selectedProject?.id || currentConversation?.project_id || null
  )

  // Fetch all projects for SideBar
  const { data: allProjects = [] } = useProjects()

  // Fetch storage mode using the robust hook
  const { data: storageModeFromHook } = useConversationStorageMode(conversationIdFromUrl)

  // Compute storage_mode from projectConversations (already loaded from ConversationPage)
  // This avoids unreliable cache lookups inside queryFn
  const conversationStorageMode = useMemo(() => {
    console.log('[Chat] conversationStorageMode useMemo computing...', {
      storageModeFromNav,
      storageModeFromHook,
      conversationIdFromUrl,
      projectConversationsLength: projectConversations.length,
    })
    // Priority 1: Navigation state (immediate availability for new chats)
    if (storageModeFromNav) {
      console.log('[Chat] conversationStorageMode: using storageModeFromNav:', storageModeFromNav)
      return storageModeFromNav
    }

    // Priority 2: Hook result (robust check checking all caches + local fetch)
    if (storageModeFromHook) {
      console.log('[Chat] conversationStorageMode: using storageModeFromHook:', storageModeFromHook)
      return storageModeFromHook
    }

    if (!conversationIdFromUrl) {
      console.log('[Chat] conversationStorageMode: No conversationIdFromUrl, returning undefined')
      return undefined
    }

    // Priority 3: Check project conversations cache
    const conv = projectConversations.find(c => String(c.id) === String(conversationIdFromUrl))
    if (conv?.storage_mode) {
      console.log('[Chat] conversationStorageMode: found in projectConversations:', conv.storage_mode)
      return conv.storage_mode
    }

    // Priority 4: Check all conversations cache (fallback)
    const allConvs = queryClient.getQueryData<Conversation[]>(['conversations'])
    const match = allConvs?.find(c => String(c.id) === String(conversationIdFromUrl))
    console.log('[Chat] conversationStorageMode: fallback result:', match?.storage_mode || 'undefined')
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
      dispatch(
        updateConversationTitle({
          id: currentConversationId,
          title: trimmed,
          storageMode: currentConversation?.storage_mode,
        })
      )
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
            storageMode: conversationStorageMode,
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
  }, [reactQueryMessages, dispatch, conversationIdFromUrl, conversationStorageMode])

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
  // Font size offset for messages (synced from SettingsPane via custom event + localStorage)
  const [fontSizeOffset, setFontSizeOffset] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('chat:fontSizeOffset')
      return stored ? parseInt(stored, 10) : 0
    } catch {
      return 0
    }
  })
  useEffect(() => {
    // Listen for custom event from SettingsPane (same window)
    const handleCustomEvent = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail
      if (typeof detail === 'number') setFontSizeOffset(detail)
    }
    // Listen for storage event (cross-tab/window sync)
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'chat:fontSizeOffset' && e.newValue !== null) {
        const parsed = parseInt(e.newValue, 10)
        if (!isNaN(parsed)) setFontSizeOffset(parsed)
      }
    }
    window.addEventListener('fontSizeOffsetChange', handleCustomEvent)
    window.addEventListener('storage', handleStorageEvent)
    return () => {
      window.removeEventListener('fontSizeOffsetChange', handleCustomEvent)
      window.removeEventListener('storage', handleStorageEvent)
    }
  }, [])
  // Send button animation type and color (synced from SettingsPane via custom event + localStorage)
  const [sendButtonAnimation, setSendButtonAnimation] = useState<SendButtonAnimationType>(getStoredSendButtonAnimation)
  const [sendButtonColor, setSendButtonColor] = useState<string>(getStoredSendButtonColor)
  useEffect(() => {
    const handleAnimationEvent = (e: Event) => {
      const detail = (e as CustomEvent<SendButtonAnimationType>).detail
      if (detail) setSendButtonAnimation(detail)
    }
    const handleColorEvent = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail
      if (detail) setSendButtonColor(detail)
    }
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'chat:sendButtonAnimation' && e.newValue) {
        setSendButtonAnimation(e.newValue as SendButtonAnimationType)
      }
      if (e.key === 'chat:sendButtonColor' && e.newValue) {
        setSendButtonColor(e.newValue)
      }
    }
    window.addEventListener('sendButtonAnimationChange', handleAnimationEvent)
    window.addEventListener('sendButtonColorChange', handleColorEvent)
    window.addEventListener('storage', handleStorageEvent)
    return () => {
      window.removeEventListener('sendButtonAnimationChange', handleAnimationEvent)
      window.removeEventListener('sendButtonColorChange', handleColorEvent)
      window.removeEventListener('storage', handleStorageEvent)
    }
  }, [])
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
  // Only sync once when workspace connects - don't include ccCwd in deps to avoid infinite loop
  const hasAutoSyncedCwd = useRef<string | null>(null)
  useEffect(() => {
    // Only run if:
    // 1. IDE extension is connected
    // 2. workspace.rootPath is available
    // 3. There's an active conversation
    // 4. Haven't already synced this workspace path for this conversation
    if (
      ideContext?.extensionConnected &&
      workspace?.rootPath &&
      currentConversationId &&
      hasAutoSyncedCwd.current !== `${currentConversationId}:${workspace.rootPath}`
    ) {
      // Mark as synced to prevent re-running
      hasAutoSyncedCwd.current = `${currentConversationId}:${workspace.rootPath}`

      // Update local state
      setCcCwd(workspace.rootPath)

      // Persist to local database (cwd is Electron-only feature)
      dispatch(
        updateCwd({
          id: currentConversationId,
          cwd: workspace.rootPath,
          storageMode: 'local',
        })
      )
    }
  }, [ideContext?.extensionConnected, workspace?.rootPath, currentConversationId, dispatch])

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
          storageMode: 'local', // cwd is Electron-only feature
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
      // Find the index of the target message in filteredMessages for virtualizer
      const targetIndex = filteredMessages.findIndex(msg => msg.id === targetId)

      if (targetIndex !== -1) {
        // Use virtualizer to scroll to the message index
        virtualizer.scrollToIndex(targetIndex, { align: 'start', behavior: 'smooth' })

        // Record that we've scrolled to this focused target to avoid later auto-scrolls fighting it
        if (typeof targetId === 'number') {
          lastFocusedScrollIdRef.current = targetId
        }
      }

      // After handling, reset so programmatic path changes (e.g., during send/stream) won't recenter
      selectionScrollCauseRef.current = null
    }
  }, [selectedPath, focusedChatMessageId, filteredMessages, virtualizer])

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

    // Find the index of the target message in filteredMessages for virtualizer
    const targetIndex = filteredMessages.findIndex(msg => msg.id === focusedChatMessageId)

    if (targetIndex !== -1) {
      // Use virtualizer to scroll to the message index
      virtualizer.scrollToIndex(targetIndex, { align: 'start', behavior: 'smooth' })
      // Mark this focus as handled so we don't keep re-centering on subsequent renders
      lastFocusedScrollIdRef.current = focusedChatMessageId
    }
  }, [focusedChatMessageId, filteredMessages, virtualizer, streamState.active])

  // Helper to check if a message should be excluded from visibility tracking
  // (tool-only or reasoning-only messages without meaningful text content)
  const isToolOrReasoningOnly = useCallback((msg: Message): boolean => {
    if (msg.role === 'tool') return true

    if (msg.content_blocks) {
      try {
        const blocks = typeof msg.content_blocks === 'string' ? JSON.parse(msg.content_blocks) : msg.content_blocks
        const arr = Array.isArray(blocks) ? blocks : [blocks]

        // Helper to check if a block has text content
        const hasTextContent = (b: any): boolean => {
          if (b.type === 'text' || b.type === 'image') return true
          if (b.type === 'thinking' && b.content && typeof b.content === 'string' && b.content.trim()) return true
          if (b.type === 'reasoning_details' && Array.isArray(b.reasoningDetails)) {
            return b.reasoningDetails.some((r: any) => r.text && typeof r.text === 'string' && r.text.trim())
          }
          if (b.type === 'tool_result' && b.content) {
            if (typeof b.content === 'string' && b.content.trim()) return true
            if (Array.isArray(b.content)) {
              return b.content.some((c: any) => c.type === 'text' && c.text && c.text.trim())
            }
          }
          return false
        }

        // Exclude only if no blocks have meaningful text content
        return arr.length > 0 && !arr.some(hasTextContent)
      } catch {
        return false
      }
    }
    return false
  }, [])

  // Track the most visible message using virtualizer's virtual items on scroll
  // Since elements are virtualized, we compute visibility based on scroll position
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const updateVisibleMessage = () => {
      const virtualItems = virtualizer.getVirtualItems()

      // Helper to find the first allowed message in the list (fallback)
      const findFirstAllowedMessage = (): MessageId | null => {
        for (const msg of filteredMessages) {
          if (msg && !isToolOrReasoningOnly(msg)) {
            return msg.id
          }
        }
        return null
      }

      // Helper to find the last allowed message in the list (fallback)
      const findLastAllowedMessage = (): MessageId | null => {
        for (let i = filteredMessages.length - 1; i >= 0; i--) {
          const msg = filteredMessages[i]
          if (msg && !isToolOrReasoningOnly(msg)) {
            return msg.id
          }
        }
        return null
      }

      if (virtualItems.length === 0) {
        // No virtual items - fall back to first allowed message, never set null
        const fallback = findFirstAllowedMessage()
        if (fallback) {
          setVisibleMessageId(fallback)
        }
        // If no fallback found, keep current value (don't set null)
        return
      }

      const scrollTop = container.scrollTop
      const viewportHeight = container.clientHeight
      // Offset detection point 20px below scroll position for better alignment
      const detectionOffset = 20
      const adjustedScrollTop = scrollTop + detectionOffset

      // Find the first allowed message whose top edge is at or past the scroll position
      // (i.e., the message currently at the top of the viewport)
      let closestItem: (typeof virtualItems)[0] | null = null

      for (const item of virtualItems) {
        const msg = filteredMessages[item.index]
        if (!msg || isToolOrReasoningOnly(msg)) continue

        const itemTop = item.start
        const itemBottom = item.start + item.size

        // Message is visible if it overlaps the top 50% of the viewport (with offset)
        const topHalfEnd = adjustedScrollTop + viewportHeight * 0.5
        if (itemBottom < adjustedScrollTop || itemTop > topHalfEnd) continue

        // Pick the first (topmost) allowed message in the top half
        if (!closestItem || item.start < closestItem.start) {
          closestItem = item
        }
      }

      // If all visible items are excluded types, fall back to the last allowed message
      if (!closestItem) {
        const fallback = findLastAllowedMessage()
        if (fallback) {
          setVisibleMessageId(fallback)
        }
        // If no fallback found, keep current value (don't set null)
        return
      }

      const msg = filteredMessages[closestItem.index]
      if (msg) {
        setVisibleMessageId(msg.id)
      }
    }

    // Initial update
    updateVisibleMessage()

    // Update on scroll
    container.addEventListener('scroll', updateVisibleMessage, { passive: true })
    return () => {
      container.removeEventListener('scroll', updateVisibleMessage)
    }
  }, [filteredMessages, virtualizer, isToolOrReasoningOnly])

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

  // Listen for provider settings changes from Settings page
  useEffect(() => {
    const handleProviderSettingsChange = (e: CustomEvent<ProviderSettings>) => {
      setProviderSettings(e.detail)
    }

    window.addEventListener(PROVIDER_SETTINGS_CHANGE_EVENT, handleProviderSettingsChange as EventListener)
    return () =>
      window.removeEventListener(PROVIDER_SETTINGS_CHANGE_EVENT, handleProviderSettingsChange as EventListener)
  }, [])

  // Set default provider based on settings or fall back to OpenRouter
  useEffect(() => {
    if (!providers.currentProvider) {
      // If provider selector is hidden and a default is configured, use it
      if (!providerSettings.showProviderSelector && providerSettings.defaultProvider) {
        dispatch(chatSliceActions.providerSelected(providerSettings.defaultProvider))
      } else {
        dispatch(chatSliceActions.providerSelected('OpenRouter'))
      }
    }
  }, [providers.currentProvider, dispatch, providerSettings.showProviderSelector, providerSettings.defaultProvider])

  // Auto-apply default provider when visibility is toggled off
  useEffect(() => {
    if (!providerSettings.showProviderSelector && providerSettings.defaultProvider) {
      dispatch(chatSliceActions.providerSelected(providerSettings.defaultProvider))
    }
  }, [providerSettings.showProviderSelector, providerSettings.defaultProvider, dispatch])

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
    [models, selectModelMutation, providers.currentProvider, selectedModel?.name]
  )
  // Provider selection handler with OpenAI auth check
  const handleProviderSelect = useCallback(
    async (providerName: string) => {
      // Check if OpenAI ChatGPT provider is selected and user is not authenticated
      if (providerName === 'OpenAI (ChatGPT)' && !isOpenAIAuthenticated()) {
        // Request OAuth flow from local server (server generates and stores PKCE)
        try {
          const response = await fetch('http://localhost:3002/api/openai/auth/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          })
          const data = await response.json()
          if (data.success && data.authUrl && data.state) {
            setOpenaiAuthFlow({ url: data.authUrl, verifier: '', state: data.state })
            setOpenaiAuthError(null)
            // setOpenaiCallbackInput('')
            setOpenaiLoginModalOpen(true)
          } else {
            throw new Error(data.error || 'Failed to start OAuth flow')
          }
        } catch (error) {
          console.error('Failed to create OpenAI auth flow:', error)
          setOpenaiAuthError('Failed to start authentication flow. Make sure the app is running in Electron mode.')
          setOpenaiLoginModalOpen(true)
        }
        return // Don't select provider until authenticated
      }
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
                imageConfig: isImageGenerationModel ? imageConfig : undefined,
                reasoningConfig: think ? reasoningConfig : undefined,
                cwd: ccCwd || undefined,
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

            // Create optimistic message for instant UI feedback
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
                imageConfig: isImageGenerationModel ? imageConfig : undefined,
                reasoningConfig: think ? reasoningConfig : undefined,
                cwd: ccCwd || undefined,
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
                // Clear optimistic message on error
                // Note: Success case is handled in chatActions when user_message chunk arrives
                dispatch(chatSliceActions.optimisticMessageCleared())
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
    // Stop the current view's stream
    if (streamState.streamingMessageId) {
      console.log('[handleStopGeneration] stopping stream for messageId:', streamState.streamingMessageId)
      dispatch(abortStreaming({ messageId: streamState.streamingMessageId }))
    } else {
      console.log('[handleStopGeneration] no streamingMessageId in current view stream')
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
          if (originalMessage) {
            // Create optimistic branch message for instant UI feedback
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

          dispatch(
            editMessageWithBranching({
              conversationId: currentConversationId,
              originalMessageId: parsedId,
              newContent: processed,
              modelOverride: selectedModel?.name,
              think: think,
              cwd: ccCwd || undefined,
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
              // Clear optimistic branch message on error
              dispatch(chatSliceActions.optimisticBranchMessageCleared())
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

          // Send as a regular message with the selected message as parent
          dispatch(
            sendMessage({
              conversationId: currentConversationId,
              input: { content: newContent },
              parent: parsedId,
              repeatNum: 1,
              think: think,
              imageConfig: isImageGenerationModel ? imageConfig : undefined,
              reasoningConfig: think ? reasoningConfig : undefined,
              cwd: ccCwd || undefined,
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
              dispatch(chatSliceActions.optimisticMessageCleared())
              console.error('Failed to send message:', error)
            })
        } else {
          // Has children: create a branch (same as branch button behavior)
          // Create optimistic branch message for instant UI feedback
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

          dispatch(
            editMessageWithBranching({
              conversationId: currentConversationId,
              originalMessageId: parsedId,
              newContent: processed,
              modelOverride: selectedModel?.name,
              think: think,
              cwd: ccCwd || undefined,
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
              // Clear optimistic branch message on error
              dispatch(chatSliceActions.optimisticBranchMessageCleared())
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
      ccCwd,
      isImageGenerationModel,
      imageConfig,
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

  // OpenAI ChatGPT login modal handlers
  const closeOpenaiLoginModal = () => {
    setOpenaiLoginModalOpen(false)
    setOpenaiAuthFlow(null)
    // setOpenaiCallbackInput('')
    setOpenaiAuthError(null)
    setOpenaiAuthLoading(false)
  }

  const handleOpenaiLogin = async () => {
    if (!openaiAuthFlow) return

    // Open the authorization URL in the default browser
    if (window.electronAPI?.auth?.openExternal) {
      try {
        await window.electronAPI.auth.openExternal(openaiAuthFlow.url)
      } catch (error) {
        console.error('Failed to open browser:', error)
        setOpenaiAuthError('Failed to open browser. Please copy the URL manually.')
      }
    } else {
      // Fallback: open in new tab (web mode, though this provider is Electron-only)
      window.open(openaiAuthFlow.url, '_blank')
    }
  }

  const handleOpenaiAuthCallback = async () => {
    if (!openaiAuthFlow) return

    setOpenaiAuthLoading(true)
    setOpenaiAuthError(null)

    try {
      // Retrieve tokens from server using state (server already exchanged the code)
      const response = await fetch('http://localhost:3002/api/openai/auth/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: openaiAuthFlow.state }),
      })
      const data = await response.json()

      if (data.pending) {
        setOpenaiAuthError('Please complete the sign-in in your browser first, then click this button again.')
        setOpenaiAuthLoading(false)
        return
      }

      if (!data.success) {
        setOpenaiAuthError(data.error || 'Authentication failed. Please try again.')
        setOpenaiAuthLoading(false)
        return
      }

      // Save tokens to localStorage using the openaiOAuth module
      const tokens = {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        accountId: data.accountId,
      }
      saveTokens(tokens)

      // Successfully authenticated, select the provider
      dispatch(chatSliceActions.providerSelected('OpenAI (ChatGPT)'))
      closeOpenaiLoginModal()
    } catch (error) {
      console.error('OpenAI auth callback error:', error)
      setOpenaiAuthError('Authentication failed. Please try again.')
    } finally {
      setOpenaiAuthLoading(false)
    }
  }

  const handleOpenaiLogout = () => {
    clearOpenAITokens()
    // If currently on OpenAI provider, switch back to OpenRouter
    if (providers.currentProvider === 'OpenAI (ChatGPT)') {
      dispatch(chatSliceActions.providerSelected('OpenRouter'))
    }
    closeOpenaiLoginModal()
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

  const handleOpenToolHtmlModal = useCallback(
    (key?: string) => {
      htmlRegistry?.openModal(key)
    },
    [htmlRegistry]
  )
  const canOpenHtmlTools = Boolean(htmlRegistry)
  const openToolHtmlModal = canOpenHtmlTools ? handleOpenToolHtmlModal : undefined

  // Refresh models using React Query mutation
  // const handleRefreshModels = useCallback(() => {
  //   if (providers.currentProvider) {
  //     refreshModelsMutation.mutate(providers.currentProvider)
  //   }
  // }, [providers.currentProvider, refreshModelsMutation])

  // Helper to parse message data (tool_calls and content_blocks) for rendering
  const parseMessageData = useCallback((msg: Message) => {
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

    return { toolCalls, contentBlocks }
  }, [])

  // Helper: Parse todo items from markdown content
  const TODO_ITEM_REGEX = /^\s*[-*]\s*\[(x|X| )\]\s*(.*)$/
  const parseTodoItems = (markdownContent: string): { text: string; done: boolean }[] => {
    const items: { text: string; done: boolean }[] = []
    const lines = markdownContent.split('\n')
    for (const line of lines) {
      const match = TODO_ITEM_REGEX.exec(line)
      if (match) {
        items.push({
          done: match[1].toLowerCase() === 'x',
          text: match[2].trim(),
        })
      }
    }
    return items
  }

  // Extract the most recent todo_list tool result from displayMessages
  // This finds the latest tool_use block for 'todo_list' and its corresponding result
  const latestTodoList = useMemo(() => {
    // Iterate from most recent to oldest
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i]
      if ((msg.role === 'assistant' || msg.role === 'ex_agent') && msg.content_blocks) {
        let blocks: ContentBlock[] = []
        try {
          if (typeof msg.content_blocks === 'object') {
            blocks = Array.isArray(msg.content_blocks) ? msg.content_blocks : [msg.content_blocks]
          } else if (typeof msg.content_blocks === 'string') {
            const parsed = JSON.parse(msg.content_blocks)
            blocks = Array.isArray(parsed) ? parsed : [parsed]
          }
        } catch {
          continue
        }

        // Look for tool_use blocks for todo_list and find corresponding tool_result
        for (const block of blocks) {
          if (block.type === 'tool_use' && (block as any).name === 'todo_list') {
            const toolUseBlock = block as any
            // Find the corresponding tool_result
            const resultBlock = blocks.find(
              b => b.type === 'tool_result' && (b as any).tool_use_id === toolUseBlock.id
            ) as any
            if (resultBlock && !resultBlock.is_error) {
              const action = toolUseBlock.input?.action
              if (action === 'create' || action === 'read' || action === 'edit') {
                // Parse the result content to extract the markdown content
                let resultData: any = resultBlock.content

                // If content is a string, try to parse it as JSON
                if (typeof resultData === 'string') {
                  try {
                    resultData = JSON.parse(resultData)
                  } catch {
                    // If parsing fails, use the string as-is (might be raw markdown)
                  }
                }

                // Extract the markdown content from the result object
                let markdownContent = ''
                if (typeof resultData === 'object' && resultData !== null && 'content' in resultData) {
                  markdownContent = resultData.content || ''
                } else if (typeof resultData === 'string') {
                  markdownContent = resultData
                }

                // Parse the markdown into todo items
                const items = parseTodoItems(markdownContent)

                // Only return if there are actual todo items
                if (items.length > 0) {
                  return {
                    name: resultData?.name || toolUseBlock.input?.name || 'Todo List',
                    action,
                    items,
                    messageId: msg.id,
                  }
                }
              }
            }
          }
        }
      }
    }
    return null
  }, [displayMessages])

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
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      ref={containerRef}
      className='flex h-full overflow-hidden bg-neutral-50 dark:bg-neutral-900'
    >
      {/* Recent conversations sidebar */}
      {!isMobile && <SideBar limit={12} projects={allProjects} activeConversationId={currentConversationId} />}

      <div
        className={`relative flex flex-col ${heimdallVisible && !isMobile ? 'flex-none' : 'flex-1'} min-w-0 sm:min-w-[240px] md:min-w-[280px] h-full dark:bg-neutral-900 bg-neutral-50 overflow-hidden`}
        style={{ width: isMobile ? '100%' : heimdallVisible ? `${leftWidthPct}%` : 'auto' }}
      >
        {/* Messages Display */}

        <div
          className={`relative mx-4 flex flex-col thin-scrollbar rounded-lg bg-transparent dark:bg-transparent flex-1 min-h-0 min-w-0 overflow-hidden transition-[padding-bottom] duration-200 ${!heimdallVisible ? 'px-0 sm:px-0 md:pr-12 ' : ''}`}
          style={{ paddingBottom: `0px` }}
        >
          {/* Conversation Title Editor */}
          {currentConversationId && (
            <div
              className={`absolute mb-2 mt-4 top-0 left-0 px-2 z-10 mx-auto right-0 ${!heimdallVisible ? 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-3xl 2xl:max-w-4xl 3xl:max-w-6xl' : 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-4xl'}`}
            >
              <div className='flex items-center bg-white/80 dark:bg-neutral-900/80 backdrop-blur-[12px] border border-black/[0.08] dark:border-white/[0.08] rounded-full py-1 px-1.5 gap-1 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.2)] dark:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]'>
                {/* Workspace Actions */}
                <Button
                  variant='outline2'
                  size='medium'
                  className='!rounded-full !p-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5'
                  aria-label='Conversations'
                  onClick={() => {
                    const projectId = selectedProject?.id || currentConversation?.project_id
                    navigate(projectId ? `/conversationPage?projectId=${projectId}` : '/conversationPage')
                  }}
                  title='New Chat'
                >
                  <i className='bx bx-chat text-lg' aria-hidden='true'></i>
                </Button>

                <Button
                  variant='outline2'
                  size='medium'
                  className='!rounded-full !p-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5'
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
                  <img src={getAssetPath('img/branchlighmode.svg')} alt='tree view' className='w-4 h-4 dark:hidden' />
                  <img
                    src={getAssetPath('img/branchdarkmode.svg')}
                    alt='tree view'
                    className='w-4 h-4 hidden dark:block'
                  />
                </Button>

                {/* Divider */}
                <div className='w-px h-4 bg-black/[0.08] dark:bg-white/[0.08] mx-1' />

                {/* Session Pill */}
                {editingTitle ? (
                  <>
                    <TextField
                      value={titleInput}
                      onChange={val => {
                        setTitleInput(val)
                      }}
                      placeholder='Conversation title'
                      size='large'
                      className='rounded-full'
                    />
                    <Button
                      variant='outline2'
                      size='medium'
                      className='!rounded-full !p-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5'
                      aria-label='Confirm edit'
                      onClick={() => setEditingTitle(false)}
                    >
                      <i className='bx bx-check text-lg' aria-hidden='true'></i>
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
                      className='flex-1 transition-transform min-w-0 rounded-full border-transparent hover:border-black/5 dark:hover:border-white/5'
                      searchBarVisible={true}
                    />
                  </>
                )}

                {/* Divider */}
                <div className='w-px h-4 bg-black/[0.08] dark:bg-white/[0.08] mx-1' />

                {/* System Actions */}
                <Button
                  variant='outline2'
                  size='medium'
                  className='!rounded-full !p-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5'
                  aria-label='Refresh Messages'
                  onClick={() => {
                    if (currentConversationId) {
                      queryClient.invalidateQueries({
                        queryKey: ['conversations', currentConversationId, 'messages'],
                      })
                    }
                  }}
                  title='Sync / Refresh'
                >
                  <i className='bx bx-refresh text-lg' aria-hidden='true'></i>
                </Button>

                <div ref={optionsRef} className='relative'>
                  <Button
                    variant='outline2'
                    size='medium'
                    className='!rounded-full !p-2 transition-all duration-200 hover:bg-black/5 dark:hover:bg-white/5'
                    aria-label='Options'
                    onClick={() => setOptionsOpen(!optionsOpen)}
                    title='Settings'
                  >
                    <i className='bx bx-dots-vertical-rounded text-lg' aria-hidden='true'></i>
                  </Button>
                  {optionsOpen && (
                    <div className='absolute right-0 top-full mt-1 z-50 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-[12px] border border-black/[0.08] dark:border-white/[0.08] rounded-xl shadow-[0_10px_30px_-10px_rgba(0,0,0,0.3)] w-max'>
                      <button
                        className='w-full text-left px-3 py-2 text-sm text-neutral-500 hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded-t-xl whitespace-nowrap'
                        onClick={() => {
                          setEditingTitle(true)
                          setOptionsOpen(false)
                        }}
                      >
                        Edit
                      </button>
                      <button
                        className='w-full text-left px-3 py-2 text-sm text-neutral-500 hover:text-neutral-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors rounded-b-xl whitespace-nowrap'
                        onClick={handleCloneConversation}
                        disabled={cloningConversation}
                      >
                        {cloningConversation ? 'Cloning...' : 'Clone Chat'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            ref={messagesContainerRef}
            className={`flex flex-col pt-25 dark:border-neutral-700 border-stone-200 rounded-lg overflow-y-auto overflow-x-hidden thin-scrollbar overscroll-y-contain touch-pan-y bg-transparent dark:bg-neutral-900`}
            style={{
              ['overflowAnchor' as any]: 'none',
              willChange: 'scroll-position',
            }}
          >
            {filteredMessages.length === 0 && extraItemsCount === 0 ? (
              <p className='text-stone-800 dark:text-stone-200'>No messages yet...</p>
            ) : (
              <div
                style={{
                  minHeight: `${virtualizer.getTotalSize()}px`,
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                  flexShrink: 0,
                }}
              >
                {virtualizer.getVirtualItems().map(virtualRow => {
                  // Calculate indices for extra items (order: optimistic, optimisticBranch, streaming)
                  const optimisticIndex = showOptimisticMessage ? filteredMessages.length : -1
                  const optimisticBranchIndex = showOptimisticBranchMessage
                    ? filteredMessages.length + (showOptimisticMessage ? 1 : 0)
                    : -1
                  const streamingIndex = showStreamingMessage
                    ? filteredMessages.length +
                      (showOptimisticMessage ? 1 : 0) +
                      (showOptimisticBranchMessage ? 1 : 0)
                    : -1

                  // Render optimistic message
                  if (virtualRow.index === optimisticIndex && optimisticMessage) {
                    return (
                      <div
                        key={`optimistic-${optimisticMessage.id}`}
                        id={`message-optimistic-${optimisticMessage.id}`}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <ChatMessage
                          id={optimisticMessage.id.toString()}
                          role={optimisticMessage.role}
                          content={optimisticMessage.content}
                          timestamp={optimisticMessage.created_at}
                          modelName={optimisticMessage.model_name}
                          artifacts={optimisticMessage.artifacts}
                          width='w-full'
                          fontSizeOffset={fontSizeOffset}
                          className='opacity-70'
                          onOpenToolHtmlModal={openToolHtmlModal}
                        />
                      </div>
                    )
                  }

                  // Render optimistic branch message
                  if (virtualRow.index === optimisticBranchIndex && optimisticBranchMessage) {
                    return (
                      <div
                        key={`optimistic-branch-${optimisticBranchMessage.id}`}
                        id={`message-optimistic-branch-${optimisticBranchMessage.id}`}
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <ChatMessage
                          id={optimisticBranchMessage.id.toString()}
                          role={optimisticBranchMessage.role}
                          content={optimisticBranchMessage.content}
                          timestamp={optimisticBranchMessage.created_at}
                          modelName={optimisticBranchMessage.model_name}
                          artifacts={optimisticBranchMessage.artifacts}
                          width='w-full'
                          fontSizeOffset={fontSizeOffset}
                          className='opacity-70'
                          onOpenToolHtmlModal={openToolHtmlModal}
                        />
                      </div>
                    )
                  }

                  // Render streaming message
                  if (virtualRow.index === streamingIndex) {
                    return (
                      <div
                        key='streaming'
                        id='message-streaming'
                        data-index={virtualRow.index}
                        ref={virtualizer.measureElement}
                        style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          width: '100%',
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <ChatMessage
                          id='streaming'
                          role='assistant'
                          content={streamState.buffer}
                          thinking={streamState.thinkingBuffer}
                          toolCalls={streamState.toolCalls}
                          streamEvents={streamState.events}
                          width='w-full'
                          fontSizeOffset={fontSizeOffset}
                          modelName={selectedModel?.name || undefined}
                          className=''
                          onOpenToolHtmlModal={openToolHtmlModal}
                        />
                      </div>
                    )
                  }

                  // Render regular message
                  const msg = filteredMessages[virtualRow.index]
                  const { toolCalls, contentBlocks } = parseMessageData(msg)
                  return (
                    <div
                      key={msg.id}
                      id={`message-${msg.id}`}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ChatMessage
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
                        fontSizeOffset={fontSizeOffset}
                        onEdit={handleMessageEdit}
                        onBranch={handleMessageBranch}
                        onDelete={handleRequestDelete}
                        onResend={handleResend}
                        onAddToNote={handleAddToNote}
                        onExplainFromSelection={handleExplainFromSelection}
                        onOpenToolHtmlModal={openToolHtmlModal}
                      />
                    </div>
                  )
                })}
              </div>
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
            {/* {streamState.active && (
              <div className=' pb-4 px-3 text-stone-800 dark:text-stone-200 flex justify-end'>
                <i className='bx bx-loader-alt text-2xl animate-spin' style={{ animationDuration: '1s' }}></i>
              </div>
            )} */}
            {/* Bottom sentinel and padding for scrolling past last message */}
            <div ref={bottomRef} data-bottom-sentinel='true' style={{ height: Math.max(100, containerHeight - 300) }} />
          </div>
        </div>
        {/* Input area: controls row + textarea (absolutely positioned overlay) */}
        <div
          ref={inputAreaRef}
          className={`absolute z-10 bottom-0 left-0 right-0 mx-auto mb-2 px-2 sm:px-0 md:px-4 lg:px-4 2xl:px-4  ${!heimdallVisible ? 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-3xl 2xl:max-w-4xl 3xl:max-w-6xl' : 'max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl xl:max-w-4xl 2xl:max-w-4xl'}`}
          style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
        >
          {/* Controls row (above) */}

          {/* Textarea (bottom, grows upward because wrapper is bottom-pinned) */}
          <div
            className={`slate-input-wrapper ${inputAreaBorderClasses}  bg-neutral-100/40 dark:bg-neutral-900/40 backdrop-blur-xl rounded-3xl px-2 py-3 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.5)] transition-all duration-300  }`}
          >
            {toolCallPermissionRequest && (
              <ToolPermissionDialog
                toolCall={toolCallPermissionRequest.toolCall}
                onGrant={() => dispatch(respondToToolPermission(true))}
                onDeny={() => dispatch(respondToToolPermission(false))}
                onAllowAll={() => dispatch(respondToToolPermissionAndEnableAll())}
              />
            )}
            {/* Todo List Display - shows latest todo_list tool result */}
            {latestTodoList && latestTodoList.items && latestTodoList.items.length > 0 && (
              <div className='mx-2 mt-2 mb-1 px-2 py-0.5 rounded-[16px] bg-neutral-100/80 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700'>
                <div className='flex items-center justify-between'>
                  <span className='text-xs font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5'>
                    <i className='bx bx-list-check text-2xl'></i>
                    <span className='text-[12px]'>{latestTodoList.name || 'Todo List'}</span>
                    {todoListCollapsed && (
                      <span className='text-[10px] text-neutral-400 dark:text-neutral-500 ml-1'>
                        ({latestTodoList.items.filter(i => i.done).length}/{latestTodoList.items.length})
                      </span>
                    )}
                  </span>
                  <div className='flex items-center gap-2'>
                    <span className='text-[10px] text-neutral-400 dark:text-neutral-500'>
                      {latestTodoList.action === 'create'
                        ? 'Created'
                        : latestTodoList.action === 'edit'
                          ? 'Updated'
                          : ''}
                    </span>
                    <button
                      onClick={() => setTodoListCollapsed(!todoListCollapsed)}
                      className='py-0.5 mt-1 px-2 rounded-lg hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors'
                      title={todoListCollapsed ? 'Expand todo list' : 'Collapse todo list'}
                    >
                      <i
                        className={`bx ${todoListCollapsed ? 'bx-chevron-down' : 'bx-chevron-up'} text-sm text-neutral-500`}
                      ></i>
                    </button>
                  </div>
                </div>
                {!todoListCollapsed && (
                  <ul className='space-y-1 pb-2 mt-1.5 max-h-40 overflow-y-auto thin-scrollbar'>
                    {latestTodoList.items.map((item, idx) => (
                      <li
                        key={`todo-item-${idx}`}
                        className={`flex items-center gap-2 text-xs ${
                          item.done
                            ? 'text-neutral-500 dark:text-neutral-400'
                            : 'text-neutral-800 dark:text-neutral-200'
                        }`}
                      >
                        <span className={item.done ? 'text-green-600 dark:text-green-400' : 'text-neutral-400'}>
                          {item.done ? '[✓]' : '[ ]'}
                        </span>
                        <span className={item.done ? 'line-through opacity-80' : ''}>{item.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {/* Textarea with shortcut hint */}
            <div className=''>
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
            </div>
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
            <div className='mx-1 mb-0.5 group relative cursor-pointer'>
              <div className='flex items-center gap-2'>
                <div className='flex-1 h-1 bg-neutral-300/50 dark:bg-neutral-700/50 rounded-full overflow-hidden relative'>
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
            {/* Controls row */}
            <div className='flex items-center justify-between gap-0 flex-wrap'>
              {/* Left side controls */}
              <div className='flex items-center'>
                <button
                  className='pt-1.5 px-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/10 dark:hover:bg-white/5 transition-all duration-200'
                  onClick={() => {
                    setSpinSettings(true)
                    setSettingsOpen(true)
                  }}
                  title='Chat Settings'
                >
                  <i
                    className={`bx bx-cog text-[22px] ${spinSettings ? 'animate-[spin_0.6s_linear_1]' : ''}`}
                    aria-hidden='true'
                    onAnimationEnd={() => setSpinSettings(false)}
                  ></i>
                </button>
                <div className='flex items-center gap-1 flex-wrap'>
                  {import.meta.env.VITE_ENVIRONMENT === 'electron' && extensions.length > 0 && (
                    <div className='flex items-center gap-2 transition-transform duration-300'>
                      <Select
                        value={selectedExtensionId || ''}
                        onChange={val => {
                          dispatch(selectExtension(val || null))
                          // Immediately request context for the chosen extension
                          requestContext(val || null)
                        }}
                        blur='low'
                        options={
                          extensions.length > 0
                            ? extensions.map(ext => ({
                                value: ext.id,
                                label: ext.workspaceName || `Extension ${ext.id.slice(0, 6)}`,
                              }))
                            : [{ value: '', label: 'No extensions connected' }]
                        }
                        placeholder='Select extension'
                        disabled={extensions.length === 0}
                        className=' min-w-[70px] max-w-[120px] lg:max-w-[200px] ml-2 text-xs sm:text-sm text-[14px] sm:text-[12px] md:text-[12px] lg:text-[12px] xl:text-[12px] 2xl:text-[13px] 3xl:text-[12px] 4xl:text-[22px] dark:text-neutral-200 break-words line-clamp-1 text-right'
                        size='small'
                      />
                      {/* <div
                        className='ide-status text-neutral-900 pl-2 max-w-18 sm:max-w-18 md:max-w-22 lg:max-w-24 xl:max-w-24 text-[14px] sm:text-[12px] md:text-[12px] lg:text-[12px] xl:text-[12px] 2xl:text-[13px] 3xl:text-[12px] 4xl:text-[22px] dark:text-neutral-200 break-words line-clamp-1 text-right'
                        title={workspace?.name ? `Workspace: ${workspace.name} connected` : ''}
                      >
                        {workspace?.name && ` ${'🟢 ' + workspace.name}`}
                      </div> */}
                    </div>
                  )}

                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>Available: {providers.providers.length}</span> */}
                  {/* Provider selector - visibility controlled by user settings */}
                  {import.meta.env.VITE_ENVIRONMENT === 'electron' && providerSettings.showProviderSelector && (
                    <Select
                      value={providers.currentProvider || ''}
                      onChange={handleProviderSelect}
                      options={providers.providers.map(p => p.name)}
                      placeholder='Select a provider...'
                      disabled={providers.providers.length === 0}
                      className='flex-1 max-w-24 sm:max-w-32 md:max-w-40 lg:max-w-32 transition-transform duration-60 active:scale-97'
                      searchBarVisible={true}
                    />
                  )}
                  {/* <span className='text-stone-800 dark:text-stone-200 text-sm'>{models.length} models</span> */}
                  <ModelSelectControl
                    provider={providers.currentProvider}
                    selectedModelName={selectedModel?.name || ''}
                    onChange={handleModelSelect}
                    placeholder='Select a model...'
                    blur='low'
                    className='flex-1 max-w-32 sm:max-w-32 md:max-w-42 lg:max-w-43 transition-transform duration-60 active:scale-99 rounded-4xl'
                    showFilters={true}
                    footerContent={modelSelectFooter}
                  />
                </div>
              </div>
              {/* Right side controls */}
              <div className='flex items-center gap-1 mr-2'>
                {(isImageGenerationModel ||
                  think ||
                  (import.meta.env.VITE_ENVIRONMENT === 'electron' && conversationIdFromUrl)) && (
                  <ActionPopover
                    isActive={
                      toolAutoApprove ||
                      operationMode === 'plan' ||
                      ccMode ||
                      !!imageConfig.aspectRatio ||
                      !!imageConfig.imageSize ||
                      (think && reasoningConfig.effort !== 'medium')
                    }
                    footer={
                      <div className='flex flex-col gap-2'>
                        {import.meta.env.VITE_ENVIRONMENT === 'electron' && conversationIdFromUrl && (
                          <>
                            <span className='text-black dark:text-neutral-200 text-[16px]'>Work directory:</span>
                            <div className='flex gap-2'>
                              <input
                                type='text'
                                value={ccCwd}
                                onChange={e => setCcCwd(e.target.value)}
                                placeholder='Working directory (optional)'
                                className='flex-1 px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-900 rounded-lg bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-orange-500/60'
                                title='Specify the working directory for Claude Code agent'
                              />
                              <button
                                type='button'
                                onClick={async () => {
                                  const result = await window.electronAPI?.dialog?.selectFolder()
                                  if (result?.success && result.path) {
                                    setCcCwd(result.path)
                                  }
                                }}
                                className='px-3 py-2 text-sm border border-neutral-300 dark:border-neutral-900 rounded-lg bg-white dark:bg-neutral-900 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:focus:ring-orange-500/60'
                                title='Select Folder to let the AI work in'
                              >
                                <svg
                                  xmlns='http://www.w3.org/2000/svg'
                                  className='h-4 w-4'
                                  fill='none'
                                  viewBox='0 0 24 24'
                                  stroke='currentColor'
                                >
                                  <path
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                    strokeWidth={2}
                                    d='M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z'
                                  />
                                </svg>
                              </button>
                            </div>
                          </>
                        )}

                        {/* Image Generation Options - shown only for image generation models */}
                        {isImageGenerationModel && (
                          <>
                            <h1 className='text-black dark:text-neutral-200 text-[16px]'>Image Options</h1>
                            <div className='flex flex-col gap-1'>
                              <label className='text-xs text-neutral-500 dark:text-neutral-400'>Aspect Ratio</label>
                              <Select
                                value={imageConfig.aspectRatio || ''}
                                options={[
                                  { value: '', label: 'Default' },
                                  { value: '1:1', label: '1:1 (Square)' },
                                  { value: '16:9', label: '16:9 (Landscape)' },
                                  { value: '9:16', label: '9:16 (Portrait)' },
                                  { value: '4:3', label: '4:3' },
                                  { value: '3:4', label: '3:4' },
                                  { value: '3:2', label: '3:2' },
                                  { value: '2:3', label: '2:3' },
                                  { value: '4:5', label: '4:5' },
                                  { value: '5:4', label: '5:4' },
                                  { value: '21:9', label: '21:9 (Ultrawide)' },
                                ]}
                                onChange={value =>
                                  setImageConfig(prev => ({
                                    ...prev,
                                    aspectRatio: (value as ImageConfig['aspectRatio']) || undefined,
                                  }))
                                }
                                placeholder='Select aspect ratio'
                                size='small'
                              />
                            </div>
                            <div className='flex flex-col gap-1'>
                              <label className='text-xs text-neutral-500 dark:text-neutral-400'>Image Size</label>
                              <Select
                                value={imageConfig.imageSize || ''}
                                options={[
                                  { value: '', label: 'Default' },
                                  { value: '1K', label: '1K' },
                                  { value: '2K', label: '2K' },
                                  { value: '4K', label: '4K' },
                                ]}
                                onChange={value =>
                                  setImageConfig(prev => ({
                                    ...prev,
                                    imageSize: (value as ImageConfig['imageSize']) || undefined,
                                  }))
                                }
                                placeholder='Select image size'
                                size='small'
                              />
                            </div>
                          </>
                        )}
                        {/* Reasoning Effort Options - shown when thinking is enabled */}
                        {selectedModel?.thinking && (
                          <>
                            <h1 className='text-black dark:text-neutral-200 text-[16px]'>Reasoning Options</h1>
                            <div className='flex flex-col gap-1'>
                              <label className='text-xs text-neutral-500 dark:text-neutral-400'>Effort Level</label>
                              <Select
                                value={reasoningConfig.effort}
                                options={[
                                  { value: 'low', label: 'Low' },
                                  { value: 'medium', label: 'Medium (Default)' },
                                  { value: 'high', label: 'High' },
                                  { value: 'xhigh', label: 'X-High' },
                                ]}
                                onChange={value =>
                                  setReasoningConfig(prev => ({
                                    ...prev,
                                    effort: value as ReasoningConfig['effort'],
                                  }))
                                }
                                placeholder='Select effort level'
                                size='small'
                              />
                            </div>
                          </>
                        )}
                      </div>
                    }
                  >
                    {import.meta.env.VITE_ENVIRONMENT === 'electron' && conversationIdFromUrl && (
                      <>
                        <Button
                          variant='outline2'
                          className='rounded-full'
                          size='medium'
                          onClick={() => setJobsModalOpen(true)}
                          title={isElectronEnv ? 'View tool jobs' : 'Tool jobs are available in the desktop app'}
                          disabled={!isElectronEnv}
                        >
                          <i className='bx bx-task pb-0.5' aria-hidden='true'></i>
                          Jobs
                        </Button>
                        {/* <Button
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
                          </Button> */}

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
                          <i className='bx bx-shield-quarter pr-1 pb-0.5'></i>
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
                          <i
                            className={`bx ${operationMode === 'plan' ? 'bx-clipboard' : 'bx-code-block'} mr-1 pb-0.5`}
                          ></i>
                          {operationMode === 'plan' ? 'Chat' : 'Agent'}
                        </Button>
                      </>
                    )}
                    {/* Claude Code toggle */}
                  </ActionPopover>
                )}
                {/* Thinking toggle - next to popover, disabled when not supported */}
                <button
                  className={`p-2 rounded-lg transition-all duration-200 ${
                    selectedModel?.thinking
                      ? 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/10 dark:hover:bg-white/5'
                      : 'text-neutral-300 dark:text-neutral-600 cursor-not-allowed'
                  }`}
                  onClick={() => setThink(t => !t)}
                  disabled={!selectedModel?.thinking}
                  title={selectedModel?.thinking ? 'Enable thinking' : 'Thinking not supported by this model'}
                >
                  {think ? (
                    <>
                      <img
                        src={getAssetPath('img/thinkingonlightmode.svg')}
                        alt='Thinking active'
                        className='w-[22px] h-[22px] dark:hidden'
                      />
                      <img
                        src={getAssetPath('img/thinkingondarkmode.svg')}
                        alt='Thinking active'
                        className='w-[22px] h-[22px] hidden dark:block'
                      />
                    </>
                  ) : (
                    <>
                      <img
                        src={getAssetPath('img/thinkingofflightmode.svg')}
                        alt='Thinking'
                        className='w-[22px] h-[22px] dark:hidden'
                      />
                      <img
                        src={getAssetPath('img/thinkingoffdarkmode.svg')}
                        alt='Thinking'
                        className='w-[22px] h-[22px] hidden dark:block'
                      />
                    </>
                  )}
                </button>
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
                <button
                  className='p-2 rounded-lg text-neutral-500 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200 hover:bg-white/10 dark:hover:bg-white/5 transition-all duration-200'
                  onClick={() => attachmentInputRef.current?.click()}
                  title='Attach files'
                >
                  <svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2'>
                    <path d='m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.51a2 2 0 0 1-2.83-2.83l8.49-8.48' />
                  </svg>
                </button>
                {/* Speech-to-text microphone button (Whisper-based, offline) */}
                {/* {import.meta.env.VITE_ENVIRONMENT === 'electron' && ( */}
                {false && (
                  <>
                    <Button
                      variant='outline2'
                      className={`rounded-full relative ${
                        isListening
                          ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700/50'
                          : speechLoading
                            ? 'bg-blue-100 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700/50'
                            : ''
                      }`}
                      size='large'
                      onClick={toggleListening}
                      onMouseEnter={() => {
                        // Preload model on hover for faster first use
                        if (!speechModelLoaded && !speechLoading) {
                          preloadSpeechModel()
                        }
                      }}
                      disabled={speechLoading}
                      title={
                        speechError
                          ? `Speech error: ${speechError}`
                          : speechLoading
                            ? `Loading speech model... ${speechLoadProgress.toFixed(0)}%`
                            : isListening
                              ? 'Stop listening (processing will begin)'
                              : speechModelLoaded
                                ? 'Start voice input (Whisper)'
                                : 'Start voice input (will download ~40MB model)'
                      }
                    >
                      {speechLoading ? (
                        <div className='relative'>
                          <i
                            className='bx bx-loader-alt text-[22px] text-blue-600 dark:text-blue-400 animate-spin'
                            aria-hidden='true'
                          ></i>
                          <span className='absolute -bottom-3 left-1/2 -translate-x-1/2 text-[10px] text-blue-600 dark:text-blue-400'>
                            {speechLoadProgress.toFixed(0)}%
                          </span>
                        </div>
                      ) : (
                        <i
                          className={`bx ${isListening ? 'bx-stop' : 'bx-microphone'} text-[22px] ${
                            isListening ? 'text-red-600 dark:text-red-400 animate-pulse' : ''
                          }`}
                          aria-hidden='true'
                        ></i>
                      )}
                    </Button>
                    {/* Wake word toggle button - "Hey Jarvis" detection */}
                    <Button
                      variant='outline2'
                      className={`rounded-full relative ${
                        isWakeWordListening
                          ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-700/50'
                          : wakeWordLoading
                            ? 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 dark:border-yellow-700/50'
                            : ''
                      }`}
                      size='large'
                      onClick={() => {
                        if (isWakeWordListening) {
                          stopWakeWord()
                        } else {
                          startWakeWord()
                        }
                      }}
                      disabled={wakeWordLoading}
                      title={
                        wakeWordError
                          ? `Wake word error: ${wakeWordError}`
                          : wakeWordLoading
                            ? 'Loading wake word engine...'
                            : isWakeWordListening
                              ? 'Wake word active - say "Hey Jarvis" to start voice input'
                              : 'Enable wake word detection ("Hey Jarvis")'
                      }
                    >
                      {wakeWordLoading ? (
                        <i
                          className='bx bx-loader-alt text-[22px] text-yellow-600 dark:text-yellow-400 animate-spin'
                          aria-hidden='true'
                        ></i>
                      ) : (
                        <i
                          className={`bx bx-bot text-[22px] ${
                            isWakeWordListening ? 'text-purple-600 dark:text-purple-400 animate-pulse' : ''
                          }`}
                          aria-hidden='true'
                        ></i>
                      )}
                      {/* Visual indicator when wake word is detected */}
                      {wakeWordLastDetected && Date.now() - wakeWordLastDetected.timestamp < 2000 && (
                        <span className='absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-ping'></span>
                      )}
                    </Button>
                  </>
                )}
                {!currentConversationId ? (
                  <span className='text-xs text-neutral-400 dark:text-neutral-500 px-2'>Creating...</span>
                ) : sendingState.streaming || sendingState.sending ? (
                  <button
                    onClick={handleStopGeneration}
                    disabled={!streamState.active}
                    title={streamState.active ? 'Stop generation' : 'Generating...'}
                    className='cursor-pointer hover:scale-105 active:scale-95 transition-transform'
                  >
                    <SendButtonLoadingAnimation animationType={sendButtonAnimation} bgColor={sendButtonColor} />
                  </button>
                ) : (
                  <button
                    className={`ml-1 w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      canSendLocal && currentConversationId
                        ? 'bg-white dark:bg-neutral-200 text-black hover:bg-blue-500 hover:text-white hover:scale-105 active:scale-95 cursor-pointer'
                        : 'bg-neutral-300 dark:bg-neutral-700 text-neutral-500 dark:text-neutral-400 cursor-not-allowed'
                    }`}
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
                    <svg
                      className='w-[24px] h-[24px] -rotate-45 relative'
                      fill='none'
                      viewBox='0 0 24 24'
                      stroke='currentColor'
                      strokeWidth={3}
                    >
                      <path d='m5 12 14 0' />
                      <path d='m12 5 7 7-7 7' />
                    </svg>
                  </button>
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

      {/* Research notes sidebar */}
      {!isMobile && (
        <RightBar
          conversationId={currentConversationId}
          notes={researchNotes}
          isLoadingNotes={isLoadingResearchNotes}
        />
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
      <ToolJobsModal isOpen={jobsModalOpen} onClose={() => setJobsModalOpen(false)} />

      {/* OpenAI ChatGPT Login Modal */}
      {openaiLoginModalOpen && (
        <div
          className='fixed inset-0 z-[100] flex items-center justify-center bg-black/50'
          onClick={closeOpenaiLoginModal}
        >
          <div
            className='bg-white dark:bg-yBlack-900 rounded-lg shadow-xl p-6 w-[90%] max-w-md'
            onClick={e => e.stopPropagation()}
          >
            <h3 className='text-[20px] font-semibold mb-2 text-neutral-900 dark:text-neutral-100'>Sign in to OpenAI</h3>
            <p className='text-[14px] text-neutral-600 dark:text-neutral-400 mb-4'>
              Use your ChatGPT Plus or Pro subscription to access GPT-4o and GPT-5 models locally.
            </p>

            {isOpenAIAuthenticated() ? (
              // Already authenticated - show logout option
              <div className='space-y-4'>
                <div className='flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg'>
                  <i className='bx bx-check-circle text-green-600 dark:text-green-400 text-xl'></i>
                  <span className='text-green-700 dark:text-green-300 text-sm'>You are signed in to OpenAI</span>
                </div>
                <div className='flex justify-end gap-2'>
                  <Button variant='outline2' onClick={closeOpenaiLoginModal} className='active:scale-90'>
                    Cancel
                  </Button>
                  <Button
                    variant='outline2'
                    className='bg-red-600 hover:bg-red-700 border-red-700 text-white active:scale-90'
                    onClick={handleOpenaiLogout}
                  >
                    Sign Out
                  </Button>
                  <Button
                    variant='outline2'
                    className='bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white active:scale-90'
                    onClick={() => {
                      dispatch(chatSliceActions.providerSelected('OpenAI (ChatGPT)'))
                      closeOpenaiLoginModal()
                    }}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            ) : (
              // Not authenticated - show login flow
              <div className='space-y-4'>
                {openaiAuthError && (
                  <div className='flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg'>
                    <i className='bx bx-error-circle text-red-600 dark:text-red-400 text-xl'></i>
                    <span className='text-red-700 dark:text-red-300 text-sm'>{openaiAuthError}</span>
                  </div>
                )}

                <div className='space-y-3'>
                  <div className='text-sm text-neutral-700 dark:text-neutral-300'>
                    <strong>Step 1:</strong> Click the button below to sign in with your OpenAI account in your browser.
                  </div>
                  <Button
                    variant='outline2'
                    className='w-full bg-neutral-800 hover:bg-neutral-900 border-neutral-700 text-white active:scale-98'
                    onClick={handleOpenaiLogin}
                    disabled={!openaiAuthFlow}
                  >
                    <i className='bx bx-link-external mr-2'></i>
                    Open OpenAI Login
                  </Button>
                </div>

                <div className='space-y-3'>
                  <div className='text-sm text-neutral-700 dark:text-neutral-300'>
                    <strong>Step 2:</strong> After completing sign-in in your browser, click the button below.
                  </div>
                </div>

                <div className='flex justify-end gap-2 mt-6'>
                  <Button variant='outline2' onClick={closeOpenaiLoginModal} className='active:scale-90'>
                    Cancel
                  </Button>
                  <Button
                    variant='outline2'
                    className='bg-emerald-600 hover:bg-emerald-700 border-emerald-700 text-white active:scale-90'
                    onClick={handleOpenaiAuthCallback}
                    disabled={!openaiAuthFlow || openaiAuthLoading}
                  >
                    {openaiAuthLoading ? (
                      <>
                        <i className='bx bx-loader-alt animate-spin mr-2'></i>
                        Verifying...
                      </>
                    ) : (
                      'Complete Sign In'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </motion.div>
  )
}

export default Chat
