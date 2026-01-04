import { createAsyncThunk } from '@reduxjs/toolkit'
import type { QueryClient } from '@tanstack/react-query'
import { ConversationId, MessageId } from '../../../../../shared/types'
import { getDefaultUserSystemPromptFromCache } from '../../hooks/useQueries'
import { dualSync } from '../../lib/sync/dualSyncManager'
import type { RootState } from '../../store/store'
import { ThunkExtraArgument } from '../../store/thunkExtra'
import { API_BASE, apiCall, createStreamingRequest, environment, localApi, shouldUseLocalApi } from '../../utils/api'
import { convContextSet, systemPromptSet } from '../conversations/conversationSlice'
import type { Conversation } from '../conversations/conversationTypes'
import { selectSelectedProject } from '../projects/projectSelectors'
import { chatSliceActions } from './chatSlice'
import {
  Attachment,
  BranchMessagePayload,
  EditMessagePayload,
  Message,
  Model,
  OperationMode,
  SendCCBranchPayload,
  SendCCMessagePayload,
  SendMessagePayload,
  ToolDefinition,
} from './chatTypes'
import { generateStreamId, STREAM_PRUNE_DELAY } from './streamHelpers'
import { getEnabledTools } from './toolDefinitions'

// TODO: Import when conversations feature is available
// import { conversationActions } from '../conversations'

// Local API base for tool execution
const LOCAL_API_BASE = 'http://127.0.0.1:3002/api'
// Remote API base for syncing from cloud (Railway)
const REMOTE_API_BASE = import.meta.env.VITE_API_URL || 'https://webdrasil-production.up.railway.app/api'

/*
The Complete Toolkit: ThunkAPI Object
When you create an async thunk, the second parameter receives what's called the ThunkAPI object.
This is like a toolbox that Redux Toolkit hands you, containing everything you need to interact with the Redux ecosystem
during async operations.
typescriptconst myAsyncThunk = createAsyncThunk(
  'feature/actionName',
  async (arg, thunkAPI) => {
    // thunkAPI contains all the utilities
    const { dispatch, getState, rejectWithValue, fulfillWithValue, signal, extra } = thunkAPI
  }
)
*/

// API base URL - configure based on environment
// const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api'

/**
 * Get storage_mode from React Query cache for a conversation
 * Searches all cached conversation queries (main list, project lists, etc.)
 * This is more reliable than Redux state which may not have storage_mode populated
 */
const getStorageModeFromCache = (
  queryClient: QueryClient | null,
  conversationId: ConversationId
): 'local' | 'cloud' => {
  if (!queryClient) return 'cloud'

  // Search ALL cached conversation lists
  const allConversationQueries = queryClient.getQueriesData<Conversation[]>({ queryKey: ['conversations'] })

  for (const [, data] of allConversationQueries) {
    if (Array.isArray(data)) {
      const match = data.find(c => String(c.id) === String(conversationId))
      if (match?.storage_mode) {
        return match.storage_mode
      }
    }
  }

  return 'cloud' // Default to cloud if not found
}

/**
 * Builds a ChatNode tree structure from a flat array of messages
 * Mimics server-side convertMessagesToHeimdall logic
 */
const buildTreeFromMessages = (messages: Message[]): any | null => {
  if (!messages || messages.length === 0) return null

  // Find root messages (parent_id is null/undefined)
  const rootMessages = messages.filter(msg => !msg.parent_id)
  if (rootMessages.length === 0) return null

  // Recursive function to build tree node
  const buildNode = (message: Message): any => {
    const children = messages
      .filter(msg => msg.parent_id === message.id)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map(buildNode)

    return {
      id: message.id.toString(),
      message: message.content,
      sender: message.role === 'user' ? 'user' : message.role === 'ex_agent' ? 'ex_agent' : 'assistant',
      children,
    }
  }

  // Single root - return it directly
  if (rootMessages.length === 1) {
    return buildNode(rootMessages[0])
  }

  // Multiple roots - create synthetic root
  const rootChildren = rootMessages
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map(buildNode)

  return {
    id: 'root',
    message: 'Conversation',
    sender: 'assistant',
    children: rootChildren,
  }
}

/**
 * Recursively adds a new message to the tree structure at the correct parent location
 * Uses parent_id to find where to insert the new message as a child
 */
const addMessageToTree = (tree: any | null, newMessage: Message, parentId: MessageId | null): any | null => {
  // No existing tree - create new root node
  if (!tree) {
    return {
      id: newMessage.id.toString(),
      message: newMessage.content,
      sender: newMessage.role === 'user' ? 'user' : newMessage.role === 'ex_agent' ? 'ex_agent' : 'assistant',
      children: [],
    }
  }

  // If this is a root message (no parent), handle specially
  if (!parentId || parentId === null) {
    // For root messages, check if tree has a synthetic root or is a single root
    if (tree.id === 'root') {
      // Synthetic root exists - add as child
      const newChild = {
        id: newMessage.id.toString(),
        message: newMessage.content,
        sender: newMessage.role === 'user' ? 'user' : newMessage.role === 'ex_agent' ? 'ex_agent' : 'assistant',
        children: [],
      }
      return {
        ...tree,
        children: [...tree.children, newChild],
      }
    } else {
      // Single root exists - create synthetic root with both
      const newChild = {
        id: newMessage.id.toString(),
        message: newMessage.content,
        sender: newMessage.role === 'user' ? 'user' : newMessage.role === 'ex_agent' ? 'ex_agent' : 'assistant',
        children: [],
      }
      return {
        id: 'root',
        message: 'Conversation',
        sender: 'assistant',
        children: [tree, newChild],
      }
    }
  }

  // Helper to recursively traverse and update tree
  const updateNode = (node: any): any => {
    // Found the parent - add new message as child
    if (node.id === parentId.toString()) {
      const newChild = {
        id: newMessage.id.toString(),
        message: newMessage.content,
        sender: newMessage.role === 'user' ? 'user' : newMessage.role === 'ex_agent' ? 'ex_agent' : 'assistant',
        children: [],
      }

      return {
        ...node,
        children: [...node.children, newChild],
      }
    }

    // Not the parent - recurse into children
    return {
      ...node,
      children: node.children.map(updateNode),
    }
  }

  return updateNode(tree)
}

/**
 * Removes deleted messages from React Query cache and rebuilds tree
 * Keeps React Query cache in sync when messages are deleted
 */
const removeMessagesFromCache = (
  queryClient: QueryClient | null,
  conversationId: ConversationId,
  deletedIds: MessageId[]
) => {
  if (!queryClient) return

  const cacheKey = ['conversations', conversationId, 'messages']
  const existingData = queryClient.getQueryData<{ messages: Message[]; tree: any }>(cacheKey)

  if (existingData) {
    const deletedSet = new Set(deletedIds.map(String))

    // Filter out deleted messages
    const remainingMessages = existingData.messages.filter(msg => !deletedSet.has(String(msg.id)))

    // Rebuild tree from remaining messages
    const newTree = buildTreeFromMessages(remainingMessages)

    queryClient.setQueryData(cacheKey, {
      messages: remainingMessages,
      tree: newTree,
    })
  }
}

/**
 * Updates an edited message in React Query cache and rebuilds tree
 * Keeps React Query cache in sync when messages are edited (not branched)
 */
const updateMessageInCache = (
  queryClient: QueryClient | null,
  conversationId: ConversationId,
  messageId: MessageId,
  updatedContent: string,
  updatedNote?: string,
  updatedContentBlocks?: any
) => {
  if (!queryClient) return

  const cacheKey = ['conversations', conversationId, 'messages']
  const existingData = queryClient.getQueryData<{ messages: Message[]; tree: any }>(cacheKey)

  if (existingData) {
    // Update the message content in the messages array
    const updatedMessages = existingData.messages.map(msg =>
      msg.id === messageId
        ? {
            ...msg,
            content: updatedContent,
            content_plain_text: updatedContent,
            ...(updatedNote !== undefined && { note: updatedNote }),
            ...(updatedContentBlocks && { content_blocks: updatedContentBlocks }),
          }
        : msg
    )

    // Rebuild tree from updated messages to reflect content changes
    const newTree = buildTreeFromMessages(updatedMessages)

    queryClient.setQueryData(cacheKey, {
      messages: updatedMessages,
      tree: newTree,
    })
  }
}

/**
 * Helper function to update React Query cache with new messages
 * Keeps React Query cache in sync with Redux state when messages are added via SSE stream
 * Updates both messages array AND tree structure incrementally
 */
const updateMessageCache = (queryClient: QueryClient | null, conversationId: ConversationId, newMessage: Message) => {
  if (!queryClient) return

  // Update the messages cache
  const cacheKey = ['conversations', conversationId, 'messages']
  const existingData = queryClient.getQueryData<{ messages: Message[]; tree: any }>(cacheKey)

  if (existingData) {
    const updatedMessages = [...existingData.messages, newMessage]
    const updatedTree = addMessageToTree(existingData.tree, newMessage, newMessage.parent_id ?? null)

    queryClient.setQueryData(cacheKey, {
      messages: updatedMessages,
      tree: updatedTree,
    })
  }
}

/**
 * Updates a message's artifacts in React Query cache
 * Keeps React Query cache in sync with Redux state when artifacts are appended
 * Essential for ensuring images/attachments appear immediately in sent messages
 */
const updateMessageArtifactsInCache = (
  queryClient: QueryClient | null,
  conversationId: ConversationId,
  messageId: MessageId,
  newArtifacts: string[]
) => {
  if (!queryClient || !newArtifacts.length) return

  const cacheKey = ['conversations', conversationId, 'messages']
  const existingData = queryClient.getQueryData<{ messages: Message[]; tree: any }>(cacheKey)

  if (existingData) {
    // Update the message artifacts in the messages array
    const updatedMessages = existingData.messages.map(msg =>
      msg.id === messageId ? { ...msg, artifacts: [...(msg.artifacts || []), ...newArtifacts] } : msg
    )

    queryClient.setQueryData(cacheKey, {
      messages: updatedMessages,
      tree: existingData.tree, // Tree structure doesn't need artifact updates
    })
  }
}

/**
 * Updates a project's updated_at timestamp in React Query cache
 * Called when a message is added to a conversation in this project
 * This ensures the project list reflects recent activity immediately
 */
const touchProjectTimestampInCache = (
  queryClient: QueryClient | null,
  projectId: string | null,
  userId: string | null
) => {
  if (!queryClient || !projectId) return

  const now = new Date().toISOString()

  // Update projects list cache (main list with all projects)
  const projectsCacheKey = ['projects', userId]
  const projectsData = queryClient.getQueryData<any[]>(projectsCacheKey)

  if (projectsData) {
    queryClient.setQueryData(
      projectsCacheKey,
      projectsData.map(project =>
        String(project.id) === String(projectId)
          ? { ...project, updated_at: now, latest_conversation_updated_at: now }
          : project
      )
    )
  }

  // Update individual project cache if it exists
  const projectCacheKey = ['projects', projectId]
  const projectData = queryClient.getQueryData<any>(projectCacheKey)

  if (projectData) {
    queryClient.setQueryData(projectCacheKey, {
      ...projectData,
      updated_at: now,
    })
  }
}

// Utility function for API calls
// const apiCall = async <T>(endpoint: string, options?: RequestInit): Promise<T> => {
//   const response = await fetch(`${API_BASE}${endpoint}`, {
//     headers: {
//       'Content-Type': 'application/json',
//       ...options?.headers,
//     },
//     ...options,
//   })

//   if (!response.ok) {
//     const errorText = await response.text()
//     throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
//   }

//   return response.json()
// }
// Helper: convert Blob to data URL
export const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise(resolve => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })

// Resolve an attachment's accessible URL from url or file_path
export const resolveAttachmentUrl = (
  urlOrPath?: string | null,
  filePath?: string | null,
  attachmentId?: string | null
): string | null => {
  const origin = API_BASE.replace(/\/?api\/?$/, '')

  // Helper to detect absolute paths (Unix: /path or Windows: C:/path, D:/path, etc.)
  const isAbsoluteLocalPath = (p: string): boolean => {
    // Unix absolute path (but not server paths like /uploads or /data)
    if (p.startsWith('/') && !p.startsWith('/uploads') && !p.startsWith('/data/')) {
      return true
    }
    // Windows absolute path (C:/, D:/, etc.)
    if (/^[A-Za-z]:\//.test(p)) {
      return true
    }
    return false
  }

  // For local mode with attachment ID, use the local file serving endpoint
  // This handles absolute paths like /home/user/.config/yggdrasil/user_images/...
  // or Windows paths like C:/Users/rajka/AppData/Roaming/yggdrasil/user_images/...
  if (attachmentId && environment === 'electron' && filePath) {
    const fp = filePath.replace(/\\/g, '/')
    // Check if it's an absolute path (not a relative server path)
    if (isAbsoluteLocalPath(fp)) {
      return `http://127.0.0.1:3002/api/local/attachments/${attachmentId}/file`
    }
  }

  if (urlOrPath) {
    if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath
    if (urlOrPath.startsWith('/')) return `${origin}${urlOrPath}`
  }
  if (filePath) {
    const fp = filePath.replace(/\\/g, '/')
    if (fp.startsWith('data/uploads/')) {
      const filename = fp.split('/').pop() || ''
      if (filename) return `${origin}/uploads/${filename}`
    }
    // For electron with absolute local paths but no attachment ID, we can't serve them
    if (environment === 'electron' && isAbsoluteLocalPath(fp)) {
      // Can't serve without ID, return null to indicate unavailable
      console.warn('[resolveAttachmentUrl] Local file path without attachment ID:', fp)
      return null
    }
    // Fallbacks for relative server paths only
    // Don't append absolute local paths to origin - they're not server paths
    if (isAbsoluteLocalPath(fp)) {
      console.warn('[resolveAttachmentUrl] Absolute local path in non-electron environment:', fp)
      return null
    }
    if (fp.startsWith('/')) return `${origin}${fp}`
    return `${origin}/${fp}`
  }
  return null
}

// Helper: Parse content_blocks from string or array format
const parseContentBlocks = (blocks: string | any[] | undefined): any[] => {
  if (!blocks) return []
  if (Array.isArray(blocks)) return blocks
  if (typeof blocks === 'string') {
    try {
      return JSON.parse(blocks)
    } catch {
      return []
    }
  }
  return []
}

const executeLocalTool = async (toolCall: any, rootPath: string | null, operationMode: OperationMode) => {
  // console.log(`🔧 Executing local tool: ${toolCall.name}`)
  // console.log(`[chatActions] rootPath passed to tool: ${rootPath}`)
  try {
    const response = await fetch(`${LOCAL_API_BASE}/tools/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: toolCall.name,
        args: toolCall.arguments,
        rootPath,
        operationMode,
      }),
    })

    if (!response.ok) {
      throw new Error(`Tool execution failed: ${response.statusText}`)
    }

    const data = await response.json()
    return data.result
  } catch (error) {
    console.error(`Local tool execution error:`, error)
    return `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`
  }
}

let pendingPermissionResolve: ((allowed: boolean) => void) | null = null

const executeToolWithPermissionCheck = async (
  dispatch: any,
  getState: any,
  toolCall: any,
  rootPath: string | null,
  operationMode: OperationMode
) => {
  // Check if auto-approve is enabled
  const state = getState() as RootState
  const autoApprove = state.chat.toolAutoApprove

  if (autoApprove) {
    // Auto-approve enabled: execute immediately without showing dialog
    return await executeLocalTool(toolCall, rootPath, operationMode)
  }

  // Auto-approve disabled: show dialog and wait for user response
  dispatch(chatSliceActions.toolPermissionRequested({ toolCall }))

  // Wait for user response
  const allowed = await new Promise<boolean>(resolve => {
    pendingPermissionResolve = resolve
  })

  // Execute or bail based on user decision
  if (allowed) {
    return await executeLocalTool(toolCall, rootPath, operationMode)
  }

  // User explicitly denied the tool execution — surface as an error to halt generation
  throw new Error('Tool execution denied by user')
}

// Model operations have been fully migrated to React Query
// See useModels, useRecentModels, useRefreshModels, and useSelectModel in hooks/useQueries.ts
// Model selection state is now managed entirely by React Query and localStorage

// Streaming message sending with proper error handling
export const sendMessage = createAsyncThunk<
  { messageId: MessageId | null; userMessage: any; streamId: string },
  SendMessagePayload & { streamId?: string },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/sendMessage',
  async (
    {
      conversationId,
      input,
      parent,
      repeatNum,
      think,
      retrigger = false,
      imageConfig,
      reasoningConfig,
      cwd,
      streamId: providedStreamId,
    },
    { dispatch, getState, extra, rejectWithValue, signal }
  ) => {
    const { auth } = extra

    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('primary')

    dispatch(
      chatSliceActions.sendingStarted({
        streamId,
        streamType: 'primary',
        lineage: {
          rootMessageId: parent,
        },
      })
    )

    let controller: AbortController | undefined

    try {
      controller = new AbortController()
      signal.addEventListener('abort', () => controller?.abort())

      const state = getState() as RootState
      const { messages: currentMessages } = state.chat.conversation
      const currentPathIds = state.chat.conversation.currentPath.filter(id => id !== 'root')
      const currentPathMessages = currentPathIds.map(id => currentMessages.find(m => m.id === id))
      const isFirstMessage = (currentMessages?.length || 0) === 0

      // Read selected model from React Query cache
      // Use original provider case for cache lookup (React Query keys are case-sensitive)
      const provider = state.chat.providerState.currentProvider
      const modelsData = extra.queryClient?.getQueryData<{
        models: Model[]
        default: Model
        selected: Model
      }>(['models', provider])
      const selectedName = modelsData?.selected?.name || modelsData?.default?.name
      const modelName = input.modelOverride || selectedName
      // Map UI provider to server provider id
      const appProvider = (state.chat.providerState.currentProvider || 'ollama').toLowerCase()
      const serverProvider = appProvider === 'google' ? 'gemini' : appProvider
      // Gather any image drafts (base64) to send along with the message. Nullable when empty.
      const drafts = state.chat.composition.imageDrafts || []
      const attachmentsBase64 = drafts.length
        ? drafts.map(d => ({ dataUrl: d.dataUrl, name: d.name, type: d.type, size: d.size }))
        : null

      // Combine system prompts in order: user default > project > conversation
      const selectedProject = selectSelectedProject(state)
      let systemPrompt = ''

      // 1. First, check for default user system prompt from React Query cache
      const defaultUserPrompt = getDefaultUserSystemPromptFromCache(extra.queryClient, auth.userId)
      if (defaultUserPrompt?.content) {
        systemPrompt = defaultUserPrompt.content
      }

      // 2. Then add project system prompt
      if (selectedProject?.system_prompt) {
        if (systemPrompt) systemPrompt += '\n\n'
        systemPrompt += selectedProject.system_prompt
      }

      // 3. Finally add conversation-specific system prompt
      if (state.conversations.systemPrompt) {
        if (systemPrompt) systemPrompt += '\n\n'
        systemPrompt += state.conversations.systemPrompt
      }
      const projectContext = selectedProject?.context || null
      const conversationContextSource = state.conversations.convContext || null
      const combinedContext =
        projectContext && conversationContextSource
          ? `${projectContext}\n\n${conversationContextSource}`
          : projectContext || conversationContextSource || null

      // Get selected files for chat from IDE context
      const selectedFilesForChat = state.ideContext.selectedFilesForChat || []

      const conversationMeta = state.conversations.items.find(c => c.id === conversationId)
      // Use React Query cache as fallback for storage mode detection (handles local conversations not yet in Redux)
      const storageMode = conversationMeta?.storage_mode || getStorageModeFromCache(extra.queryClient, conversationId)

      // Prepend cwd to system prompt if provided or stored on the conversation
      const payloadCwd = typeof cwd === 'string' ? cwd.trim() : cwd ?? null
      const effectiveCwd = payloadCwd || conversationMeta?.cwd || null
      if (effectiveCwd) {
        const cwdPrefix = `Current working directory: ${effectiveCwd}\n\n`
        systemPrompt = cwdPrefix + systemPrompt
      }

      // Determine execution mode
      const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'
      const isElectronMode =
        import.meta.env.VITE_ENVIRONMENT === 'electron' || (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__)
      // For local tool execution support (GemTools), we prefer client mode even in web environment
      // This allows the client to intercept tool calls and execute them via the local server (3002)
      const executionMode = 'client'

      let currentTurnHistory = [...currentPathMessages]
      let currentTurnContent = input.content.trim()
      let continueTurn = true
      let turnCount = 0
      const MAX_TURNS = 100

      let messageId: MessageId | null = null
      let userMessage: any = null

      while (continueTurn && turnCount < MAX_TURNS) {
        turnCount++
        continueTurn = false // Default to stop unless tool calls occur

        // Check if streaming was aborted by user (check this specific stream)
        const streamingActive = getState().chat.streaming.byId[streamId]?.active ?? false
        if (!streamingActive) {
          controller?.abort()
          break
        }

        let response = null

        if (!modelName) {
          throw new Error('No model selected')
        }

        if (repeatNum > 1 && turnCount === 1) {
          // Cloud server handles LLM generation; storageMode in body tells it whether to save to cloud DB
          const endpoint = `/conversations/${conversationId}/messages/repeat`

          response = await createStreamingRequest(endpoint, auth.accessToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: currentTurnHistory.map(m => ({
                id: m.id,
                conversation_id: m.conversation_id,
                parent_id: m.parent_id,
                children_ids: m.children_ids,
                role: m.role,
                thinking_block: m.thinking_block,
                tool_calls: m.tool_calls,
                content_blocks: m.content_blocks,
                content: m.content,
                content_plain_text: m.content_plain_text,
                created_at: m.created_at,
                model_name: m.model_name,
                partial: m.partial,
                artifacts: m.artifacts,
              })),
              content: currentTurnContent,
              modelName: modelName,
              // parentId: (currentPath && currentPath.length ? currentPath[currentPath.length - 1] : currentMessages?.at(-1)?.id) || undefined,
              parentId: parent,
              systemPrompt: systemPrompt,
              conversationContext: combinedContext,
              projectContext,
              provider: serverProvider,
              repeatNum: repeatNum,
              attachmentsBase64,
              selectedFiles: selectedFilesForChat,
              think,
              retrigger,
              executionMode,
              storageMode,
              isElectron: isElectronMode,
              imageConfig,
              reasoningConfig,
              tools: getEnabledTools(),
            }),
            signal: controller.signal,
          })
        } else {
          // Cloud server handles LLM generation; storageMode in body tells it whether to save to cloud DB
          const endpoint = `/conversations/${conversationId}/messages`

          response = await createStreamingRequest(endpoint, auth.accessToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: currentTurnHistory.map(m => ({
                id: m.id,
                conversation_id: m.conversation_id,
                parent_id: m.parent_id,
                children_ids: m.children_ids,
                role: m.role,
                thinking_block: m.thinking_block,
                tool_calls: m.tool_calls,
                content_blocks: m.content_blocks,
                content: m.content,
                content_plain_text: m.content_plain_text,
                created_at: m.created_at,
                model_name: m.model_name,
                partial: m.partial,
                artifacts: m.artifacts,
              })),
              content: currentTurnContent, // Empty for tool continuation
              modelName: modelName,
              // parentId: (currentPath && currentPath.length ? currentPath[currentPath.length - 1] : currentMessages?.at(-1)?.id) || undefined,
              parentId: parent,
              systemPrompt: systemPrompt,
              conversationContext: combinedContext,
              projectContext,
              provider: serverProvider,
              attachmentsBase64: turnCount === 1 ? attachmentsBase64 : undefined, // Only send attachments on first turn
              selectedFiles: turnCount === 1 ? selectedFilesForChat : undefined,
              think,
              retrigger: turnCount === 1 ? retrigger : false,
              executionMode,
              storageMode,
              isElectron: isElectronMode,
              imageConfig,
              reasoningConfig,
              tools: getEnabledTools(),
            }),
            signal: controller.signal,
          })
        }

        if (!response.ok) {
          // Handle free tier limit exceeded (403)
          if (response.status === 403) {
            const errorData = await response.json().catch(() => ({ error: 'unknown' }))
            if (errorData.error === 'generation_limit_reached') {
              dispatch(chatSliceActions.freeTierLimitModalShown())
              throw new Error(errorData.message || 'Free generations exhausted. Please upgrade to continue.')
            }
          }
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText || 'Failed to send message'}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No stream reader available')

        const decoder = new TextDecoder()
        // Guard to ensure we only try to update the title once per send
        let titleUpdated = false
        // Buffer for incomplete lines across chunks
        let buffer = ''

        // State for this turn
        let assistantMessageContent = ''
        let assistantThinking = ''
        let assistantToolCalls: any[] = []
        let turnAssistantMessageId: string | null = null
        // Track processed tool calls (already executed on server)
        const processedToolCallIds = new Set<string>()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // Append new data to buffer and split by newlines
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const chunk = JSON.parse(line.slice(6))

                if (chunk.type === 'user_message' && chunk.message) {
                  userMessage = chunk.message
                  // console.log('we got userMessage', userMessage)
                  if (!chunk.message.timestamp) {
                    chunk.message.timestamp = new Date().toISOString()
                  }
                  // Add to messages list
                  dispatch(chatSliceActions.messageAdded(chunk.message))
                  // And update currentPath to navigate to this new node
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync user message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })

                  // Touch project timestamp to reflect recent activity
                  if (selectedProject?.id) {
                    dualSync.touchProjectTimestamp(selectedProject.id)
                    // Update React Query cache immediately for instant UI update
                    touchProjectTimestampInCache(extra.queryClient, selectedProject.id, auth.userId)
                  }

                  // Save image attachments to local DB when in local mode
                  if (storageMode === 'local' && attachmentsBase64 && attachmentsBase64.length > 0) {
                    localApi
                      .post('/local/attachments/save-base64', {
                        messageId: chunk.message.id,
                        attachments: attachmentsBase64,
                      })
                      .catch(err => console.error('[sendMessage] Failed to save local attachments:', err))
                  }

                  // Add to local history tracking for next turn
                  currentTurnHistory.push(chunk.message)

                  // Clear optimistic message immediately when real user message confirmed (web mode only)
                  if (isWebMode) {
                    dispatch(chatSliceActions.optimisticMessageCleared())
                  }
                  // Live-update: append current image drafts to this new user message's artifacts
                  if (drafts.length > 0) {
                    const artifactDataUrls = drafts.map(d => d.dataUrl)
                    dispatch(
                      chatSliceActions.messageArtifactsAppended({
                        messageId: chunk.message.id,
                        artifacts: artifactDataUrls,
                      })
                    )
                    // Sync artifacts to React Query cache so images appear immediately
                    updateMessageArtifactsInCache(extra.queryClient, conversationId, chunk.message.id, artifactDataUrls)
                  }
                  // Auto-update conversation title with first 50 characters of the first user message
                  if (isFirstMessage && !titleUpdated) {
                    const contentForTitle = (chunk.message?.content || '').trim().replace(/\s+/g, ' ')
                    const baseTitle = contentForTitle.slice(0, 50)
                    const title = baseTitle ? `${baseTitle}...` : ''
                    if (title) {
                      ;(dispatch as any)(updateConversationTitle({ id: conversationId, title, storageMode }))
                      titleUpdated = true
                    }
                  }
                }

                // Handle tool results (accumulated server-side into content_blocks)
                if (chunk.part === 'tool_result' && chunk.toolResult) {
                  // Mark this tool call as processed by server
                  processedToolCallIds.add(chunk.toolResult.tool_use_id)

                  // Dispatch structured tool result data for proper rendering in streaming events
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_result',
                        toolResult: chunk.toolResult,
                      },
                    })
                  )
                  // Skip generic chunk handler to prevent duplicate dispatch
                } else if (chunk.part === 'tool_call' && chunk.toolCall) {
                  // Accumulate tool calls locally
                  // We assume server sends structured tool calls
                  // Check if we already have this tool call (by id) to avoid duplicates if server resends
                  const exists = assistantToolCalls.some(tc => tc.id === chunk.toolCall.id)
                  if (!exists) {
                    assistantToolCalls.push(chunk.toolCall)
                  }

                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_call',
                        toolCall: chunk.toolCall,
                      },
                    })
                  )
                } else if (chunk.type === 'generation_started') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  if (chunk.messageId) {
                    turnAssistantMessageId = chunk.messageId
                    // If this is the first assistant message (not continuation), it might not be in history yet
                    // But we usually get 'complete' event later
                  }
                } else if (chunk.type === 'chunk') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  // Accumulate text/reasoning for local reconstruction if needed
                  if (chunk.part === 'text' && chunk.content) {
                    assistantMessageContent += chunk.content // Note: chunk.content is delta usually, verify
                  } else if (chunk.part === 'text' && chunk.delta) {
                    assistantMessageContent += chunk.delta
                  } else if (chunk.part === 'reasoning' && chunk.delta) {
                    assistantThinking += chunk.delta
                  }
                } else if (chunk.type === 'complete' && chunk.message) {
                  // Push each assistant reply as its own message
                  dispatch(chatSliceActions.messageAdded(chunk.message))
                  // Update branch/path to point to the completed assistant message
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync assistant message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })

                  // Add to local history
                  currentTurnHistory.push(chunk.message)

                  // Sync provider cost if available
                  if (chunk.cost) {
                    dualSync.syncProviderCost({
                      ...chunk.cost,
                      message_id: chunk.message.id,
                    })
                  }
                  // Reset streaming buffer for next iteration
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'reset' } }))
                  messageId = chunk.message.id
                } else if (chunk.type === 'free_generations_update') {
                  // Update free generations remaining count
                  dispatch(
                    chatSliceActions.freeGenerationsUpdated({
                      remaining: chunk.remaining,
                      isFreeTier: true,
                    })
                  )
                } else if (chunk.type === 'aborted') {
                  // Server deleted the empty assistant message, no need to keep it in client state
                  dispatch(
                    chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: 'Generation aborted' } })
                  )
                } else if (chunk.type === 'error') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  throw new Error(chunk.error || 'Stream error')
                }
              } catch (parseError) {
                // Silently skip malformed JSON chunks (e.g., emoji-prefixed tool indicators)
                // These are often tool call markers from the server that aren't valid JSON
                if (line.length > 100) {
                  console.warn('Failed to parse chunk:', line.substring(0, 100) + '...', parseError)
                }
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        // End of stream for this turn. Check if we have pending tool calls to execute locally.
        // Also check if streaming is still active (user didn't click Stop)
        const isStreamActive = getState().chat.streaming.byId[streamId]?.active ?? false
        if (assistantToolCalls.length > 0 && executionMode === 'client' && isStreamActive) {
          // Filter out tool calls that were already processed by server
          const pendingToolCalls = assistantToolCalls.filter(tc => !processedToolCallIds.has(tc.id))

          if (pendingToolCalls.length > 0) {
            // console.log(`🛠️ [chatActions] Executing ${pendingToolCalls.length} tool calls locally...`)

            // if (processedToolCallIds.size > 0) {
            //   console.log(`⏩ [chatActions] Skipped ${processedToolCallIds.size} tool calls already handled by server`)
            // }

            // 1. Synthesize Assistant Message if we didn't get a 'complete' event
            // (In client mode, server aborts before sending 'complete')
            if (!messageId && turnAssistantMessageId) {
              // Create ephemeral assistant message
              const assistantMsg: any = {
                id: turnAssistantMessageId,
                conversation_id: conversationId,
                role: 'assistant',
                content: assistantMessageContent,
                thinking_block: assistantThinking,
                tool_calls: assistantToolCalls, // Store as array (or string if needed by backend, but we are client side now)
                content_blocks: assistantToolCalls.map(tc => ({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  input: tc.arguments,
                })),
                created_at: new Date().toISOString(),
                model_name: modelName,
                parent_id: userMessage?.id || parent, // Link to parent
              }

              // Dispatch to Redux
              dispatch(chatSliceActions.messageAdded(assistantMsg))
              dispatch(chatSliceActions.messageBranchCreated({ newMessage: assistantMsg }))
              updateMessageCache(extra.queryClient, conversationId, assistantMsg)

              // Sync to DB (so it persists)
              dualSync.syncMessage({
                ...assistantMsg,
                user_id: auth.userId,
                project_id: selectedProject?.id || null,
              })

              // Update history
              currentTurnHistory.push(assistantMsg)
              messageId = assistantMsg.id
            }

            // 2. Execute tools and append tool_result blocks to assistant message
            const toolResultBlocks: any[] = []

            // Get rootPath from conversation cwd first, falling back to IDE context
            const rootPath = conversationMeta?.cwd || state.ideContext.workspace?.rootPath || null
            const operationMode = state.chat.operationMode
            // console.log(`🛠️ [chatActions] rootPath passed to tool: ${rootPath}`)
            for (const toolCall of pendingToolCalls) {
              // Execute tool
              const result = await executeToolWithPermissionCheck(dispatch, getState, toolCall, rootPath, operationMode)

              // Create tool_result block (NOT a separate message)
              const toolResultBlock = {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
                is_error: false, // We handle errors in executeLocalTool returns
              }

              toolResultBlocks.push(toolResultBlock)

              // Inform UI of tool result for real-time display
              dispatch(
                chatSliceActions.streamChunkReceived({
                  streamId,
                  chunk: {
                    type: 'chunk',
                    part: 'tool_result',
                    toolResult: {
                      tool_use_id: toolCall.id,
                      content: toolResultBlock.content,
                      is_error: false,
                    },
                  },
                })
              )
            }

            // 3. Update assistant message with tool results
            if (toolResultBlocks.length > 0 && messageId) {
              // Find the assistant message from history
              const assistantMessage = currentTurnHistory.find(msg => msg.id === messageId)
              if (assistantMessage) {
                // Parse existing content_blocks
                const existingBlocks = parseContentBlocks(assistantMessage.content_blocks)
                const updatedContentBlocks = [...existingBlocks, ...toolResultBlocks]

                // Update message via updateMessage thunk (syncs to both local and cloud)
                await dispatch(
                  updateMessage({
                    id: assistantMessage.id,
                    content: assistantMessage.content,
                    content_blocks: updatedContentBlocks,
                  })
                )

                // Update the assistant message in currentTurnHistory
                const historyIndex = currentTurnHistory.findIndex(msg => msg.id === assistantMessage.id)
                if (historyIndex !== -1) {
                  currentTurnHistory[historyIndex] = {
                    ...currentTurnHistory[historyIndex],
                    content_blocks: updatedContentBlocks,
                  }
                }
              }
            }

            // 4. Prepare for next turn (continuation)
            currentTurnContent = '' // No new user input
            parent = messageId // Parent is the assistant message (not tool message)
            continueTurn = true // Loop again to send tool results to LLM

            // Reset buffers
            assistantMessageContent = ''
            assistantThinking = ''
            assistantToolCalls = []
          } else {
            // All tool calls handled by server (or none exist)
            // if (assistantToolCalls.length > 0 && processedToolCallIds.size > 0) {
            //   console.log('✅ [chatActions] All tool calls handled by server')
            //   // Ensure message state is complete if we have a messageId
            //   if (messageId) {
            //     // This might be redundant if server sent 'complete', but ensures safety
            //   }
            // }

            // If no pending calls, we're done with this turn
            continueTurn = false
          }
        } else {
          // No tool calls or server handled it -> finish
          continueTurn = false
        }
      } // end while loop

      if (messageId) {
        dispatch(chatSliceActions.streamCompleted({ streamId, messageId, updatePath: true }))
      }

      dispatch(chatSliceActions.sendingCompleted({ streamId }))
      dispatch(chatSliceActions.inputCleared())

      // Schedule stream cleanup after delay
      setTimeout(() => {
        dispatch(chatSliceActions.streamPruned({ streamId }))
      }, STREAM_PRUNE_DELAY)

      return { messageId, userMessage, streamId }
    } catch (error) {
      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      if (error instanceof Error && error.name === 'AbortError') {
        return rejectWithValue('Message cancelled')
      }

      const message = error instanceof Error ? error.message : 'Failed to send message'
      dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: message } }))
      return rejectWithValue(message)
    }
  }
)

export const updateMessage = createAsyncThunk<
  Message,
  { id: MessageId; content: string; note?: string; content_blocks?: any },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/updateMessage',
  async ({ id, content, note, content_blocks }, { dispatch, getState, extra, rejectWithValue }) => {
    const { auth } = extra
    try {
      const currentState = getState() as RootState
      const currentConversationId = currentState.chat.conversation.currentConversationId
      const conversation = currentState.conversations.items.find(c => c.id === currentConversationId)
      const isLocalMode = conversation?.storage_mode === 'local'

      let updated: Message

      if (isLocalMode) {
        // In local mode, the message doesn't exist on server, so we construct the update locally
        const existingMessage = currentState.chat.conversation.messages.find(m => m.id === id)
        if (!existingMessage) {
          throw new Error('Message not found locally')
        }

        updated = {
          ...existingMessage,
          content,
          note: note !== undefined ? note : existingMessage.note,
          content_blocks: content_blocks !== undefined ? content_blocks : existingMessage.content_blocks,
        }
      } else {
        const body: any = { content, note }
        if (content_blocks) {
          body.content_blocks = content_blocks
        }

        updated = await apiCall<Message>(`/messages/${id}`, auth.accessToken, {
          method: 'PUT',
          body: JSON.stringify(body),
        })
      }
      dispatch(chatSliceActions.messageUpdated({ id, content, note, content_blocks }))

      // Sync to React Query cache immediately
      const state = getState()
      const conversationId = state.chat.conversation.currentConversationId
      if (conversationId) {
        updateMessageInCache(extra.queryClient, conversationId, id, content, note, content_blocks)
      }

      // Sync message update to local SQLite (fire-and-forget)
      const selectedProject = selectSelectedProject(state)
      dualSync.syncMessage(
        {
          ...updated,
          content_blocks: content_blocks, // Explicitly include from request to ensure local sync
          user_id: auth.userId,
          project_id: selectedProject?.id || null,
        },
        'update'
      )

      return updated
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : 'Update failed')
    }
  }
)

// Fetch conversation messages from server
export const fetchConversationMessages = createAsyncThunk<
  Message[],
  ConversationId,
  { state: RootState; extra: ThunkExtraArgument }
>('chat/fetchConversationMessages', async (conversationId, { dispatch, extra, rejectWithValue, getState }) => {
  const { auth } = extra
  try {
    const raw = await apiCall<Message[]>(`/conversations/${conversationId}/messages`, auth.accessToken)
    // Ensure client-only fields exist
    const messages: Message[] = (raw || []).map(m => ({
      ...m,
      pastedContext: Array.isArray((m as any).pastedContext) ? (m as any).pastedContext : [],
      artifacts: Array.isArray((m as any).artifacts) ? (m as any).artifacts : [],
    }))

    dispatch(chatSliceActions.messagesLoaded(messages))

    // Conditional attachments fetch: only when metadata indicates or when metadata absent (back-compat)
    const state = getState() as RootState
    const attachmentsByMessage = state.chat.attachments.byMessage || {}

    for (const msg of messages) {
      const alreadyFetched = Array.isArray(attachmentsByMessage[msg.id]) && attachmentsByMessage[msg.id].length > 0
      const hasMeta = typeof msg.has_attachments !== 'undefined' || typeof msg.attachments_count !== 'undefined'
      const indicatesAttachments =
        msg.has_attachments === true || (typeof msg.attachments_count === 'number' && msg.attachments_count > 0)

      if (!alreadyFetched) {
        if ((hasMeta && indicatesAttachments) || !hasMeta /* fallback to previous behavior */) {
          // Fire-and-forget; errors handled inside thunk
          dispatch(fetchAttachmentsByMessage({ messageId: msg.id }))
        }
      }
    }

    return messages
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch messages')
  }
})

export const deleteMessage = createAsyncThunk<
  MessageId,
  { id: MessageId; conversationId: ConversationId; storageMode?: 'local' | 'cloud' },
  { extra: ThunkExtraArgument }
>('chat/deleteMessage', async ({ id, conversationId, storageMode }, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    // Use storageMode passed from caller (most reliable) or fallback to cache lookup
    const effectiveStorageMode = storageMode ?? getStorageModeFromCache(extra.queryClient, conversationId)
    const isLocalMode = shouldUseLocalApi(effectiveStorageMode)

    // console.log('[deleteMessage] Routing decision:', {
    //   passedStorageMode: storageMode,
    //   effectiveStorageMode,
    //   isLocalMode,
    //   environment,
    //   conversationId,
    //   messageId: id,
    // })

    if (isLocalMode) {
      // console.log('[deleteMessage] -> Routing to LOCAL API: /local/messages/' + id)
      await localApi.delete(`/local/messages/${id}`)
    } else {
      // console.log('[deleteMessage] -> Routing to CLOUD API: /messages/' + id)
      await apiCall(`/messages/${id}`, auth.accessToken, { method: 'DELETE' })
    }
    // Sync React Query cache immediately
    removeMessagesFromCache(extra.queryClient, conversationId, [id])
    // Sync message deletion to local SQLite (fire-and-forget)
    dualSync.syncMessage({ id }, 'delete')
    // Refetch conversation messages to ensure sync with server (cloud only)
    if (!isLocalMode) {
      await dispatch(fetchConversationMessages(conversationId))
    }
    return id
  } catch (error) {
    console.error('[deleteMessage] Error:', error)
    return rejectWithValue(error instanceof Error ? error.message : 'Delete failed')
  }
})

// Branch message when editing - creates new branch while preserving original
export const editMessageWithBranching = createAsyncThunk<
  { messageId: MessageId | null; userMessage: any; originalMessageId: MessageId; streamId: string },
  EditMessagePayload & { streamId?: string },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/editMessageWithBranching',
  async (
    { conversationId, originalMessageId, newContent, modelOverride, think, cwd, streamId: providedStreamId },
    { dispatch, getState, extra, rejectWithValue, signal }
  ) => {
    const { auth } = extra

    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('branch')

    // Get state early to find parent message ID for lineage
    const state = getState() as RootState
    const messagesCache = extra.queryClient?.getQueryData<{ messages: Message[]; tree: any }>([
      'conversations',
      conversationId,
      'messages',
    ])
    const cachedMessages = messagesCache?.messages || []
    const currentMessages = cachedMessages.length > 0 ? cachedMessages : state.chat.conversation.messages
    const originalMessage = currentMessages.find(m => m.id === originalMessageId)
    const parentMessageId = originalMessage?.parent_id

    console.log('[editMessageWithBranching] originalMessageId:', originalMessageId, 'parentMessageId:', parentMessageId, 'messagesCount:', currentMessages.length)

    dispatch(
      chatSliceActions.sendingStarted({
        streamId,
        streamType: 'branch',
        lineage: {
          originMessageId: originalMessageId,
          rootMessageId: parentMessageId, // Parent where new branch attaches
        },
      })
    )

    let controller: AbortController | undefined

    try {
      controller = new AbortController()
      signal.addEventListener('abort', () => controller?.abort())

      const currentPathIds = state.chat.conversation.currentPath.filter(id => id !== 'root')
      // Truncate path to only include messages strictly before the originalMessageId
      const idxOriginal = currentPathIds.indexOf(originalMessageId)
      const truncatedPathIds = idxOriginal >= 0 ? currentPathIds.slice(0, idxOriginal) : currentPathIds
      const currentPathMessages = truncatedPathIds
        .map(id => currentMessages.find(m => m.id === id))
        .filter(Boolean) as Message[]

      // Read selected model from React Query cache
      const provider = state.chat.providerState.currentProvider
      const modelsData = extra.queryClient?.getQueryData<{
        models: Model[]
        default: Model
        selected: Model
      }>(['models', provider])
      const selectedName = modelsData?.selected?.name || modelsData?.default?.name
      const modelName = modelOverride || selectedName
      let activeParentId = originalMessage.parent_id

      // Map UI provider to server provider id
      const appProvider = (state.chat.providerState.currentProvider || 'ollama').toLowerCase()
      const serverProvider = appProvider === 'google' ? 'gemini' : appProvider

      // Combine system prompts in order: user default > project > conversation
      const selectedProject = selectSelectedProject(state)
      let systemPrompt = ''

      // 1. First, check for default user system prompt from React Query cache
      const defaultUserPrompt = getDefaultUserSystemPromptFromCache(extra.queryClient, auth.userId)
      if (defaultUserPrompt?.content) {
        systemPrompt = defaultUserPrompt.content
      }

      // 2. Then add project system prompt
      if (selectedProject?.system_prompt) {
        if (systemPrompt) systemPrompt += '\n\n'
        systemPrompt += selectedProject.system_prompt
      }

      // 3. Finally add conversation-specific system prompt
      if (state.conversations.systemPrompt) {
        if (systemPrompt) systemPrompt += '\n\n'
        systemPrompt += state.conversations.systemPrompt
      }
      const projectContext = selectedProject?.context || null
      const conversationContextSource = state.conversations.convContext || null
      const combinedContext =
        projectContext && conversationContextSource
          ? `${projectContext}\n\n${conversationContextSource}`
          : projectContext || conversationContextSource || null

      // Gather image drafts (new images being added)
      const drafts = state.chat.composition.imageDrafts || []
      const draftDataUrls = drafts.map(d => d.dataUrl)

      // Build attachments: prioritize React Query cached artifacts, then Redux, plus new drafts
      // React Query cache has artifacts set via messageArtifactsSet after images are fetched
      const artifactsFromCache: string[] = Array.isArray(originalMessage?.artifacts)
        ? (originalMessage.artifacts as string[])
        : []
      // Also check Redux state for artifacts (fallback)
      const reduxMessage = state.chat.conversation.messages.find(m => m.id === originalMessageId)
      const artifactsFromRedux: string[] = Array.isArray(reduxMessage?.artifacts)
        ? (reduxMessage.artifacts as string[])
        : []
      // Use whichever has artifacts (prefer cache, fallback to Redux)
      const artifactsExisting = artifactsFromCache.length > 0 ? artifactsFromCache : artifactsFromRedux

      const deletedBackup: string[] = state.chat.attachments.backup?.[originalMessageId] || []
      const existingMinusDeleted = artifactsExisting.filter(a => !deletedBackup.includes(a))
      const combinedArtifacts = [...existingMinusDeleted, ...draftDataUrls]

      // Build attachmentsBase64 with full metadata like sendMessage does
      const attachmentsBase64 = combinedArtifacts.length
        ? combinedArtifacts.map(dataUrl => {
            // Try to find matching draft for full metadata
            const matchingDraft = drafts.find(d => d.dataUrl === dataUrl)
            if (matchingDraft) {
              return { dataUrl, name: matchingDraft.name, type: matchingDraft.type, size: matchingDraft.size }
            }
            // For existing artifacts (data URLs), extract type from the data URL
            const typeMatch = dataUrl.match(/^data:([^;]+);/)
            const mimeType = typeMatch ? typeMatch[1] : 'image/png'
            return { dataUrl, name: 'image', type: mimeType, size: 0 }
          })
        : null

      // Before sending, reflect current image drafts in the UI by appending them
      // to the artifacts of the message being branched from.
      if (drafts.length > 0) {
        const draftDataUrls = drafts.map(d => d.dataUrl)
        dispatch(
          chatSliceActions.messageArtifactsAppended({
            messageId: originalMessageId,
            artifacts: draftDataUrls,
          })
        )
        // Sync artifacts to React Query cache to keep UI consistent
        updateMessageArtifactsInCache(extra.queryClient, conversationId, originalMessageId, draftDataUrls)
      }

      if (!modelName) {
        throw new Error('No model selected')
      }

      const selectedFilesForChat = state.ideContext.selectedFilesForChat || []

      const conversationMeta = state.conversations.items.find(c => c.id === conversationId)
      // Use React Query cache as fallback for storage mode detection (handles local conversations not yet in Redux)
      const storageMode = conversationMeta?.storage_mode || getStorageModeFromCache(extra.queryClient, conversationId)

      // Prepend cwd to system prompt if provided or stored on the conversation
      const payloadCwd = typeof cwd === 'string' ? cwd.trim() : cwd ?? null
      const effectiveCwd = payloadCwd || conversationMeta?.cwd || null
      if (effectiveCwd) {
        const cwdPrefix = `Current working directory: ${effectiveCwd}\n\n`
        systemPrompt = cwdPrefix + systemPrompt
      }

      // Determine execution mode
      const isWebMode = import.meta.env.VITE_ENVIRONMENT === 'web'
      const isElectronMode =
        import.meta.env.VITE_ENVIRONMENT === 'electron' || (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__)
      const executionMode = 'client' // Prefer client execution for tools

      let currentTurnHistory = [...currentPathMessages]
      let currentTurnContent = newContent
      let continueTurn = true
      let turnCount = 0
      const MAX_TURNS = 100

      let messageId: MessageId | null = null
      let userMessage: any = null

      while (continueTurn && turnCount < MAX_TURNS) {
        turnCount++
        continueTurn = false

        // Create new user message as a branch (or continuation) - cloud server handles LLM, storageMode in body controls DB
        const response = await createStreamingRequest(`/conversations/${conversationId}/messages`, auth.accessToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: currentTurnHistory.map(m => ({
              id: m.id,
              conversation_id: m.conversation_id,
              parent_id: m.parent_id,
              children_ids: m.children_ids,
              role: m.role,
              thinking_block: m.thinking_block,
              tool_calls: m.tool_calls,
              content_blocks: m.content_blocks,
              content: m.content,
              content_plain_text: m.content_plain_text,
              created_at: m.created_at,
              model_name: m.model_name,
              partial: m.partial,
              artifacts: m.artifacts,
            })),
            content: currentTurnContent,
            modelName,
            parentId: activeParentId, // Branch from the same parent as original (or updated parent)
            systemPrompt: systemPrompt,
            conversationContext: combinedContext,
            projectContext,
            provider: serverProvider,
            attachmentsBase64: turnCount === 1 ? attachmentsBase64 : undefined,
            selectedFiles: turnCount === 1 ? selectedFilesForChat : undefined,
            think,
            executionMode,
            isBranch: true,
            storageMode,
            isElectron: isElectronMode,
            tools: getEnabledTools(),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          // Handle free tier limit exceeded (403)
          if (response.status === 403) {
            const errorData = await response.json().catch(() => ({ error: 'unknown' }))
            if (errorData.error === 'generation_limit_reached') {
              dispatch(chatSliceActions.freeTierLimitModalShown())
              throw new Error(errorData.message || 'Free generations exhausted. Please upgrade to continue.')
            }
          }
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No stream reader available')

        const decoder = new TextDecoder()
        // Buffer for incomplete lines across chunks
        let buffer = ''

        // State for this turn
        let assistantMessageContent = ''
        let assistantThinking = ''
        let assistantToolCalls: any[] = []
        let turnAssistantMessageId: string | null = null
        // Track processed tool calls (already executed on server)
        const processedToolCallIds = new Set<string>()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // Append new data to buffer and split by newlines
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const chunk = JSON.parse(line.slice(6))

                if (chunk.type === 'user_message' && chunk.message) {
                  userMessage = chunk.message
                  // Ensure message is in store
                  if (!chunk.message.timestamp) {
                    chunk.message.timestamp = new Date().toISOString()
                  }
                  dispatch(chatSliceActions.messageAdded(chunk.message))
                  // And update currentPath to this new user branch node
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Update stream lineage: assistant response will be child of this user message
                  dispatch(chatSliceActions.streamLineageUpdated({ streamId, targetParentId: chunk.message.id }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync user message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })

                  // Touch project timestamp to reflect recent activity
                  if (selectedProject?.id) {
                    dualSync.touchProjectTimestamp(selectedProject.id)
                    // Update React Query cache immediately for instant UI update
                    touchProjectTimestampInCache(extra.queryClient, selectedProject.id, auth.userId)
                  }

                  // Save image attachments to local DB when in local mode
                  if (storageMode === 'local' && attachmentsBase64 && attachmentsBase64.length > 0) {
                    localApi
                      .post('/local/attachments/save-base64', {
                        messageId: chunk.message.id,
                        attachments: attachmentsBase64,
                      })
                      .catch(err => console.error('[editMessageWithBranching] Failed to save local attachments:', err))
                  }

                  // Add to local history for next turn
                  currentTurnHistory.push(chunk.message)

                  // Live-update: ensure the new branched user message shows all intended artifacts immediately
                  // Use the combined list (existing - deleted + drafts) we computed prior to the request
                  if (combinedArtifacts.length > 0) {
                    dispatch(
                      chatSliceActions.messageArtifactsSet({
                        messageId: chunk.message.id,
                        artifacts: combinedArtifacts,
                      })
                    )
                    // Sync artifacts to React Query cache so images appear immediately in branched message
                    const cacheKey = ['conversations', conversationId, 'messages']
                    const existingData = extra.queryClient?.getQueryData<{ messages: Message[]; tree: any }>(cacheKey)
                    if (existingData) {
                      const updatedMessages = existingData.messages.map(msg =>
                        msg.id === chunk.message.id ? { ...msg, artifacts: combinedArtifacts } : msg
                      )
                      extra.queryClient?.setQueryData(cacheKey, {
                        messages: updatedMessages,
                        tree: existingData.tree,
                      })
                    }
                  }

                  // Clear optimistic branch message immediately when real branch message confirmed (web mode only)
                  if (isWebMode) {
                    dispatch(chatSliceActions.optimisticBranchMessageCleared())
                  }
                }

                // Handle tool results (accumulated server-side into content_blocks)
                if (chunk.part === 'tool_result' && chunk.toolResult) {
                  // console.log(
                  //   `✅ [editMessageWithBranching] Received tool_result for tool_use_id: ${chunk.toolResult.tool_use_id}`
                  // )

                  // Mark this tool call as processed by server
                  processedToolCallIds.add(chunk.toolResult.tool_use_id)

                  // Dispatch structured tool result data for proper rendering in streaming events
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_result',
                        toolResult: chunk.toolResult,
                      },
                    })
                  )
                  // Skip generic chunk handler to prevent duplicate dispatch
                } else if (chunk.part === 'tool_call' && chunk.toolCall) {
                  // Accumulate tool calls locally
                  const exists = assistantToolCalls.some(tc => tc.id === chunk.toolCall.id)
                  if (!exists) {
                    assistantToolCalls.push(chunk.toolCall)
                  }
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_call',
                        toolCall: chunk.toolCall,
                      },
                    })
                  )
                } else if (chunk.type === 'generation_started') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  if (chunk.messageId) {
                    turnAssistantMessageId = chunk.messageId
                  }
                } else if (chunk.type === 'chunk') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  if (chunk.part === 'text' && chunk.content) {
                    assistantMessageContent += chunk.content
                  } else if (chunk.part === 'text' && chunk.delta) {
                    assistantMessageContent += chunk.delta
                  } else if (chunk.part === 'reasoning' && chunk.delta) {
                    assistantThinking += chunk.delta
                  }
                } else if (chunk.type === 'complete' && chunk.message) {
                  messageId = chunk.message.id
                  // Store assistant message
                  dispatch(chatSliceActions.messageAdded(chunk.message))
                  // Navigate path to completed assistant reply
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync assistant message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })

                  // Add to local history
                  currentTurnHistory.push(chunk.message)

                  // Sync provider cost if available
                  if (chunk.cost) {
                    dualSync.syncProviderCost({
                      ...chunk.cost,
                      message_id: chunk.message.id,
                    })
                  }
                  // Reset streaming buffer for next iteration
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'reset' } }))
                } else if (chunk.type === 'free_generations_update') {
                  // Update free generations remaining count
                  dispatch(
                    chatSliceActions.freeGenerationsUpdated({
                      remaining: chunk.remaining,
                      isFreeTier: true,
                    })
                  )
                } else if (chunk.type === 'aborted') {
                  // Server deleted the empty assistant message, no need to keep it in client state
                  dispatch(
                    chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: 'Generation aborted' } })
                  )
                } else if (chunk.type === 'error') {
                  throw new Error(chunk.error || 'Stream error')
                }
              } catch (parseError) {
                // Silently skip malformed JSON chunks (e.g., emoji-prefixed tool indicators)
                // These are often tool call markers from the server that aren't valid JSON
                if (line.length > 100) {
                  console.warn('Failed to parse chunk:', line.substring(0, 100) + '...', parseError)
                }
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        // End of stream for this turn. Check if we have pending tool calls to execute locally.
        if (assistantToolCalls.length > 0 && executionMode === 'client') {
          // Filter out tool calls that were already processed by server
          const pendingToolCalls = assistantToolCalls.filter(tc => !processedToolCallIds.has(tc.id))

          if (pendingToolCalls.length > 0) {
            // console.log(`🛠️ [editMessageWithBranching] Executing ${pendingToolCalls.length} tool calls locally...`)

            // if (processedToolCallIds.size > 0) {
            //   console.log(
            //     `⏩ [editMessageWithBranching] Skipped ${processedToolCallIds.size} tool calls already handled by server`
            //   )
            // }

            // 1. Synthesize Assistant Message if we didn't get a 'complete' event
            if (!messageId && turnAssistantMessageId) {
              // Create ephemeral assistant message
              const assistantMsg: any = {
                id: turnAssistantMessageId,
                conversation_id: conversationId,
                role: 'assistant',
                content: assistantMessageContent,
                thinking_block: assistantThinking,
                tool_calls: assistantToolCalls,
                content_blocks: assistantToolCalls.map(tc => ({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  input: tc.arguments,
                })),
                created_at: new Date().toISOString(),
                model_name: modelName,
                parent_id: userMessage?.id || activeParentId, // Link to parent (user msg or previous parent)
              }

              // Dispatch to Redux
              dispatch(chatSliceActions.messageAdded(assistantMsg))
              dispatch(chatSliceActions.messageBranchCreated({ newMessage: assistantMsg }))
              updateMessageCache(extra.queryClient, conversationId, assistantMsg)

              // Sync to DB
              dualSync.syncMessage({
                ...assistantMsg,
                user_id: auth.userId,
                project_id: selectedProject?.id || null,
              })

              // Update history
              currentTurnHistory.push(assistantMsg)
              messageId = assistantMsg.id
            }

            // 2. Execute tools and append tool_result blocks to assistant message
            const toolResultBlocks: any[] = []
            const rootPath = conversationMeta?.cwd || state.ideContext.workspace?.rootPath || null
            const operationMode = state.chat.operationMode

            for (const toolCall of pendingToolCalls) {
              // Execute tool
              const result = await executeToolWithPermissionCheck(dispatch, getState, toolCall, rootPath, operationMode)

              // Create tool_result block
              const toolResultBlock = {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
                is_error: false,
              }

              toolResultBlocks.push(toolResultBlock)

              // Inform UI of tool result
              dispatch(
                chatSliceActions.streamChunkReceived({
                  type: 'chunk',
                  part: 'tool_result',
                  toolResult: {
                    tool_use_id: toolCall.id,
                    content: toolResultBlock.content,
                    is_error: false,
                  },
                })
              )
            }

            // 3. Update assistant message with tool results
            if (toolResultBlocks.length > 0 && messageId) {
              const assistantMessage = currentTurnHistory.find(msg => msg.id === messageId)
              if (assistantMessage) {
                const existingBlocks = parseContentBlocks(assistantMessage.content_blocks)
                const updatedContentBlocks = [...existingBlocks, ...toolResultBlocks]

                await dispatch(
                  updateMessage({
                    id: assistantMessage.id,
                    content: assistantMessage.content,
                    content_blocks: updatedContentBlocks,
                  })
                )

                // Update the assistant message in currentTurnHistory
                const historyIndex = currentTurnHistory.findIndex(msg => msg.id === assistantMessage.id)
                if (historyIndex !== -1) {
                  currentTurnHistory[historyIndex] = {
                    ...currentTurnHistory[historyIndex],
                    content_blocks: updatedContentBlocks,
                  }
                }
              }
            }

            // 4. Prepare for next turn
            currentTurnContent = ''
            activeParentId = messageId // Parent is the assistant message (not tool message)
            continueTurn = true
            assistantMessageContent = ''
            assistantThinking = ''
            assistantToolCalls = []
          } else {
            // if (assistantToolCalls.length > 0 && processedToolCallIds.size > 0) {
            //   console.log('✅ [editMessageWithBranching] All tool calls handled by server')
            // }
            continueTurn = false
          }
        } else {
          continueTurn = false
        }
      } // end while loop

      if (messageId) {
        dispatch(chatSliceActions.streamCompleted({ streamId, messageId, updatePath: true }))
        // Clear backup after successfully creating the branch
        dispatch(chatSliceActions.messageArtifactsBackupCleared({ messageId: originalMessageId }))
      }

      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      // Schedule stream cleanup after delay
      setTimeout(() => {
        dispatch(chatSliceActions.streamPruned({ streamId }))
      }, STREAM_PRUNE_DELAY)

      return { messageId, userMessage, originalMessageId, streamId }
    } catch (error) {
      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      if (error instanceof Error && error.name === 'AbortError') {
        return rejectWithValue('Message cancelled')
      }

      const message = error instanceof Error ? error.message : 'Failed to edit message'
      dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: message } }))
      return rejectWithValue(message)
    }
  }
)

// Send message to specific branch
export const sendMessageToBranch = createAsyncThunk<
  { messageId: MessageId | null; userMessage: any; streamId: string },
  BranchMessagePayload & { streamId?: string },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/sendMessageToBranch',
  async (
    { conversationId, parentId, content, modelOverride, systemPrompt, think, cwd, streamId: providedStreamId },
    { dispatch, getState, extra, rejectWithValue, signal }
  ) => {
    const { auth } = extra

    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('branch')

    console.log('[sendMessageToBranch] parentId:', parentId)

    dispatch(
      chatSliceActions.sendingStarted({
        streamId,
        streamType: 'branch',
        lineage: {
          rootMessageId: parentId,
        },
      })
    )

    let controller: AbortController | undefined

    try {
      controller = new AbortController()
      signal.addEventListener('abort', () => controller?.abort())

      const state = getState() as RootState

      // Read selected model from React Query cache
      const provider = state.chat.providerState.currentProvider
      const modelsData = extra.queryClient?.getQueryData<{
        models: Model[]
        default: Model
        selected: Model
      }>(['models', provider])
      const selectedName = modelsData?.selected?.name || modelsData?.default?.name
      const modelName = modelOverride || selectedName
      // Map UI provider to server provider id
      const appProvider = (state.chat.providerState.currentProvider || 'ollama').toLowerCase()
      const serverProvider = appProvider === 'google' ? 'gemini' : appProvider
      const drafts = state.chat.composition.imageDrafts || []
      const attachmentsBase64 = drafts.length
        ? drafts.map(d => ({ dataUrl: d.dataUrl, name: d.name, type: d.type, size: d.size }))
        : null

      // Retrieve project and conversation context to send with branch message
      const selectedProject = selectSelectedProject(state)
      const projectContext = selectedProject?.context || null
      const conversationContextSource = state.conversations.convContext || null
      const combinedContext =
        projectContext && conversationContextSource
          ? `${projectContext}\n\n${conversationContextSource}`
          : projectContext || conversationContextSource || null

      // Get selected files for chat from IDE context
      const selectedFilesForChat = state.ideContext.selectedFilesForChat || []

      const conversationMeta = state.conversations.items.find(c => c.id === conversationId)
      // Use React Query cache as fallback for storage mode detection (handles local conversations not yet in Redux)
      const storageMode = conversationMeta?.storage_mode || getStorageModeFromCache(extra.queryClient, conversationId)

      // Prepend cwd to system prompt if provided or stored on the conversation
      let effectiveSystemPrompt = systemPrompt
      const payloadCwd = typeof cwd === 'string' ? cwd.trim() : cwd ?? null
      const effectiveCwd = payloadCwd || conversationMeta?.cwd || null
      if (effectiveCwd) {
        const cwdPrefix = `Current working directory: ${effectiveCwd}\n\n`
        effectiveSystemPrompt = cwdPrefix + (effectiveSystemPrompt || '')
      }

      if (!modelName) {
        throw new Error('No model selected')
      }

      // Determine execution mode
      const isElectronMode =
        import.meta.env.VITE_ENVIRONMENT === 'electron' || (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__)
      const executionMode = 'client'

      let currentTurnContent = content
      let currentParentId = parentId
      let continueTurn = true
      let turnCount = 0
      const MAX_TURNS = 100
      let messageId: MessageId | null = null
      let userMessage: any = null

      while (continueTurn && turnCount < MAX_TURNS) {
        turnCount++
        continueTurn = false

        // Cloud server handles LLM generation; storageMode in body tells it whether to save to cloud DB
        const endpoint = `/conversations/${conversationId}/messages`

        const response = await createStreamingRequest(endpoint, auth.accessToken, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: currentTurnContent,
            modelName,
            parentId: currentParentId,
            systemPrompt: effectiveSystemPrompt,
            conversationContext: combinedContext,
            projectContext,
            provider: serverProvider,
            attachmentsBase64: turnCount === 1 ? attachmentsBase64 : undefined,
            selectedFiles: turnCount === 1 ? selectedFilesForChat : undefined,
            think,
            executionMode,
            isBranch: true,
            storageMode,
            isElectron: isElectronMode,
            tools: getEnabledTools(),
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          // Handle free tier limit exceeded (403)
          if (response.status === 403) {
            const errorData = await response.json().catch(() => ({ error: 'unknown' }))
            if (errorData.error === 'generation_limit_reached') {
              dispatch(chatSliceActions.freeTierLimitModalShown())
              throw new Error(errorData.message || 'Free generations exhausted. Please upgrade to continue.')
            }
          }
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No stream reader available')

        const decoder = new TextDecoder()
        // Buffer for incomplete lines across chunks
        let buffer = ''

        // State for this turn
        let assistantMessageContent = ''
        let assistantThinking = ''
        let assistantToolCalls: any[] = []
        let turnAssistantMessageId: string | null = null
        // Track processed tool calls (already executed on server)
        const processedToolCallIds = new Set<string>()

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            // Append new data to buffer and split by newlines
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')

            // Keep the last incomplete line in the buffer
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              try {
                const chunk = JSON.parse(line.slice(6))

                if (chunk.type === 'user_message' && chunk.message) {
                  userMessage = chunk.message
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync user message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })

                  // Touch project timestamp to reflect recent activity
                  if (selectedProject?.id) {
                    dualSync.touchProjectTimestamp(selectedProject.id)
                    // Update React Query cache immediately for instant UI update
                    touchProjectTimestampInCache(extra.queryClient, selectedProject.id, auth.userId)
                  }

                  // Save image attachments to local DB when in local mode
                  if (storageMode === 'local' && attachmentsBase64 && attachmentsBase64.length > 0) {
                    localApi
                      .post('/local/attachments/save-base64', {
                        messageId: chunk.message.id,
                        attachments: attachmentsBase64,
                      })
                      .catch(err => console.error('[sendMessageToBranch] Failed to save local attachments:', err))
                  }
                }

                // Handle tool results (accumulated server-side into content_blocks)
                if (chunk.part === 'tool_result' && chunk.toolResult) {
                  // Mark this tool call as processed by server
                  processedToolCallIds.add(chunk.toolResult.tool_use_id)

                  // Dispatch structured tool result data for proper rendering in streaming events
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_result',
                        toolResult: chunk.toolResult,
                      },
                    })
                  )
                  // Skip generic chunk handler to prevent duplicate dispatch
                } else if (chunk.part === 'tool_call' && chunk.toolCall) {
                  // Accumulate tool calls locally
                  const exists = assistantToolCalls.some(tc => tc.id === chunk.toolCall.id)
                  if (!exists) {
                    assistantToolCalls.push(chunk.toolCall)
                  }
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      streamId,
                      chunk: {
                        type: 'chunk',
                        part: 'tool_call',
                        toolCall: chunk.toolCall,
                      },
                    })
                  )
                } else if (chunk.type === 'generation_started') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  if (chunk.messageId) {
                    turnAssistantMessageId = chunk.messageId
                  }
                } else if (chunk.type === 'chunk') {
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk }))
                  if (chunk.part === 'text' && chunk.content) {
                    assistantMessageContent += chunk.content
                  } else if (chunk.part === 'text' && chunk.delta) {
                    assistantMessageContent += chunk.delta
                  } else if (chunk.part === 'reasoning' && chunk.delta) {
                    assistantThinking += chunk.delta
                  }
                } else if (chunk.type === 'complete' && chunk.message) {
                  messageId = chunk.message.id
                  dispatch(chatSliceActions.messageBranchCreated({ newMessage: chunk.message }))
                  // Sync to React Query cache immediately
                  updateMessageCache(extra.queryClient, conversationId, chunk.message)
                  // Sync assistant message to local SQLite (fire-and-forget)
                  dualSync.syncMessage({
                    ...chunk.message,
                    user_id: auth.userId,
                    project_id: selectedProject?.id || null,
                  })
                  // Sync provider cost if available
                  if (chunk.cost) {
                    dualSync.syncProviderCost({
                      ...chunk.cost,
                      message_id: chunk.message.id,
                    })
                  }
                  // Reset streaming buffer for next iteration
                  dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'reset' } }))
                } else if (chunk.type === 'free_generations_update') {
                  // Update free generations remaining count
                  dispatch(
                    chatSliceActions.freeGenerationsUpdated({
                      remaining: chunk.remaining,
                      isFreeTier: true,
                    })
                  )
                } else if (chunk.type === 'aborted') {
                  // Server deleted the empty assistant message, no need to keep it in client state
                  dispatch(
                    chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: 'Generation aborted' } })
                  )
                } else if (chunk.type === 'error') {
                  throw new Error(chunk.error || 'Stream error')
                }
              } catch (parseError) {
                // Silently skip malformed JSON chunks (e.g., emoji-prefixed tool indicators)
                // These are often tool call markers from the server that aren't valid JSON
                if (line.length > 100) {
                  console.warn('Failed to parse chunk:', line.substring(0, 100) + '...', parseError)
                }
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        // End of stream for this turn. Check if we have pending tool calls to execute locally.
        if (assistantToolCalls.length > 0 && executionMode === 'client') {
          // Filter out tool calls that were already processed by server
          const pendingToolCalls = assistantToolCalls.filter(tc => !processedToolCallIds.has(tc.id))

          if (pendingToolCalls.length > 0) {
            // console.log(`🛠️ [sendMessageToBranch] Executing ${pendingToolCalls.length} tool calls locally...`)

            // if (processedToolCallIds.size > 0) {
            //   console.log(
            //     `⏩ [sendMessageToBranch] Skipped ${processedToolCallIds.size} tool calls already handled by server`
            //   )
            // }

            // 1. Synthesize Assistant Message if we didn't get a 'complete' event
            if (!messageId && turnAssistantMessageId) {
              // Create ephemeral assistant message
              const assistantMsg: any = {
                id: turnAssistantMessageId,
                conversation_id: conversationId,
                role: 'assistant',
                content: assistantMessageContent,
                thinking_block: assistantThinking,
                tool_calls: assistantToolCalls,
                content_blocks: assistantToolCalls.map(tc => ({
                  type: 'tool_use',
                  id: tc.id,
                  name: tc.name,
                  input: tc.arguments,
                })),
                created_at: new Date().toISOString(),
                model_name: modelName,
                parent_id: userMessage?.id || currentParentId, // Link to parent
              }

              // Dispatch to Redux (optimistic)
              dispatch(chatSliceActions.messageBranchCreated({ newMessage: assistantMsg }))
              // Normally we'd check if it's already added, but branch created adds it to path?
              // Actually messageBranchCreated usually updates path.
              // We should also add message to store if not there?
              // 'messageBranchCreated' in chatSlice handles adding to messages array?
              // Let's check 'messageAdded' usage in previous thunk.
              // It calls 'messageAdded' THEN 'messageBranchCreated'.

              dispatch(chatSliceActions.messageAdded(assistantMsg))
              // Re-dispatch branch created to ensure path is correct?
              // Actually if we just do messageAdded, it might not update path.
              // messageBranchCreated logic usually takes the message and updates path.
              // Let's call both to be safe and consistent with loop above.

              updateMessageCache(extra.queryClient, conversationId, assistantMsg)

              // Sync to DB
              dualSync.syncMessage({
                ...assistantMsg,
                user_id: auth.userId,
                project_id: selectedProject?.id || null,
              })

              messageId = assistantMsg.id
            }

            // 2. Execute tools and append tool_result blocks to assistant message
            const toolResultBlocks: any[] = []
            const rootPath = conversationMeta?.cwd || state.ideContext.workspace?.rootPath || null
            const operationMode = state.chat.operationMode

            for (const toolCall of pendingToolCalls) {
              // Execute tool
              const result = await executeToolWithPermissionCheck(dispatch, getState, toolCall, rootPath, operationMode)

              // Create tool_result block
              const toolResultBlock = {
                type: 'tool_result',
                tool_use_id: toolCall.id,
                content: typeof result === 'string' ? result : JSON.stringify(result),
                is_error: false,
              }

              toolResultBlocks.push(toolResultBlock)

              // Inform UI of tool result
              dispatch(
                chatSliceActions.streamChunkReceived({
                  type: 'chunk',
                  part: 'tool_result',
                  toolResult: {
                    tool_use_id: toolCall.id,
                    content: toolResultBlock.content,
                    is_error: false,
                  },
                })
              )
            }

            // 3. Update assistant message with tool results
            if (toolResultBlocks.length > 0 && messageId) {
              // We need to fetch the message content to append blocks
              // Ideally we have it in `assistantMessageContent` + `assistantToolCalls`
              // But we better use `updateMessage` thunk which handles state update.
              // However, `updateMessage` takes `content`.

              // We need to construct the `content_blocks` array.
              // Existing blocks are `assistantToolCalls` (converted to blocks).
              // Plus `toolResultBlocks`.

              // Wait, if we synthesized the message, `content_blocks` is set.
              // If server sent it, we might not have local `content_blocks` in `assistantMsg` variable if we relied on server 'complete'.
              // But `messageId` is set.

              // Let's get the message from state to be sure.
              const currentMessages = getState().chat.conversation.messages
              const assistantMessage = currentMessages.find(m => m.id === messageId)

              if (assistantMessage) {
                const existingBlocks = parseContentBlocks(assistantMessage.content_blocks)
                const updatedContentBlocks = [...existingBlocks, ...toolResultBlocks]

                await dispatch(
                  updateMessage({
                    id: assistantMessage.id,
                    content: assistantMessage.content,
                    content_blocks: updatedContentBlocks,
                  })
                )
              }
            }

            // 4. Prepare for next turn
            currentTurnContent = ''
            currentParentId = messageId // Parent is the assistant message
            continueTurn = true
            assistantMessageContent = ''
            assistantThinking = ''
            assistantToolCalls = []
          } else {
            continueTurn = false
          }
        } else {
          continueTurn = false
        }
      } // end while loop

      if (messageId) {
        dispatch(chatSliceActions.streamCompleted({ streamId, messageId, updatePath: true }))
      }

      dispatch(chatSliceActions.sendingCompleted({ streamId }))
      dispatch(chatSliceActions.inputCleared())

      // Schedule stream cleanup after delay
      setTimeout(() => {
        dispatch(chatSliceActions.streamPruned({ streamId }))
      }, STREAM_PRUNE_DELAY)

      return { messageId, userMessage, streamId }
    } catch (error) {
      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      if (error instanceof Error && error.name === 'AbortError') {
        return rejectWithValue('Message cancelled')
      }

      const message = error instanceof Error ? error.message : 'Failed to send message'
      dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: message } }))
      return rejectWithValue(message)
    }
  }
)

// Sync a conversation and its messages to local SQLite (Electron only)
export const syncConversationToLocal = createAsyncThunk<
  void,
  { conversationId: ConversationId; messages: Message[] },
  { state: RootState; extra: ThunkExtraArgument }
>('chat/syncConversationToLocal', async ({ conversationId, messages }, { extra, getState }) => {
  // Only run in Electron mode
  if (import.meta.env.VITE_ENVIRONMENT !== 'electron') return

  const { auth } = extra
  const state = getState() as RootState

  try {
    const exists = await dualSync.checkConversationExists(conversationId)
    // Determine project ID from state or conversation data
    let projectId: string | null = selectSelectedProject(state)?.id || null

    if (!exists) {
      // Fetch conversation from REMOTE source of truth (Cloud), not local API
      let conversation: Conversation | null = null
      try {
        const res = await fetch(`${REMOTE_API_BASE}/conversations/${conversationId}`, {
          headers: {
            Authorization: `Bearer ${auth.accessToken}`,
            'Content-Type': 'application/json',
          },
        })
        if (res.ok) {
          conversation = await res.json()
        }
      } catch (e) {
        console.warn('Failed to fetch remote conversation for sync', e)
      }

      if (conversation) {
        projectId = conversation.project_id || projectId

        // Ensure project exists locally before syncing conversation
        if (projectId) {
          const projectExists = await dualSync.checkProjectExists(projectId)
          if (!projectExists) {
            // Try cache first
            const projectsCache = extra.queryClient?.getQueryData<any[]>(['projects', auth.userId])
            let project = projectsCache?.find(p => String(p.id) === String(projectId))

            // If not in cache, fetch from REMOTE API
            if (!project) {
              try {
                const projRes = await fetch(`${REMOTE_API_BASE}/projects/${projectId}`, {
                  headers: {
                    Authorization: `Bearer ${auth.accessToken}`,
                    'Content-Type': 'application/json',
                  },
                })
                if (projRes.ok) {
                  project = await projRes.json()
                }
              } catch (e) {
                console.warn(`Failed to fetch project ${projectId} for sync`, e)
              }
            }

            if (project) {
              dualSync.syncProject({
                id: project.id,
                name: project.name,
                user_id: auth.userId,
                context: project.context,
                system_prompt: project.system_prompt,
                created_at: project.created_at,
                updated_at: project.updated_at,
              })
            }
          }
        }

        dualSync.syncConversation(conversation)
      }
    }

    if (messages && messages.length > 0) {
      const operations = messages.map(msg => ({
        type: 'message',
        action: 'create',
        data: {
          ...msg,
          user_id: auth.userId,
          project_id: projectId, // Pass project_id context for potential stub creation
        },
      }))
      dualSync.syncBatch(operations)
    }
  } catch (error) {
    console.warn('Failed to sync conversation to local', error)
  }
})

// Fetch Heimdall message tree and messages combined (optimization: single endpoint)
export const fetchMessageTree = createAsyncThunk<
  any,
  ConversationId | { conversationId: ConversationId; storageMode?: 'local' | 'cloud' },
  { state: RootState; extra: ThunkExtraArgument }
>('chat/fetchMessageTree', async (payload, { dispatch, extra, rejectWithValue, getState }) => {
  const { auth } = extra

  // Handle both old (just conversationId) and new (object with storageMode) signatures
  const conversationId = typeof payload === 'object' ? payload.conversationId : payload
  const explicitStorageMode = typeof payload === 'object' ? payload.storageMode : undefined

  // Gating: avoid duplicate in-flight fetches and throttle rapid refetches
  const state = getState() as RootState
  const { heimdall } = state.chat
  const now = Date.now()
  if (heimdall.loading && heimdall.lastConversationId === conversationId) {
    // Skip: already fetching for this conversation
    return null as any
  }
  if (
    heimdall.lastConversationId === conversationId &&
    typeof heimdall.lastFetchedAt === 'number' &&
    now - heimdall.lastFetchedAt < 250
  ) {
    // Skip: fetched very recently for same conversation
    return null as any
  }

  dispatch(chatSliceActions.heimdallLoadingStarted())
  try {
    let response: { messages: Message[]; tree: any }

    // Use explicit storageMode if provided, otherwise check state
    const conversation = state.conversations.items.find(c => c.id === conversationId)
    const storageMode = explicitStorageMode || conversation?.storage_mode || 'cloud'

    // console.log(`[fetchMessageTree] ConversationId: ${conversationId}`)
    // console.log(`[fetchMessageTree] Found in state: ${!!conversation}`)
    // console.log(`[fetchMessageTree] Storage Mode: ${storageMode}`)
    // console.log(`[fetchMessageTree] Environment: ${environment}`)

    if (shouldUseLocalApi(storageMode, environment)) {
      // console.log('[fetchMessageTree] Routing to LOCAL API')
      response = await localApi.get<{ messages: Message[]; tree: any }>(
        `/local/conversations/${conversationId}/messages/tree`
      )
    } else {
      // console.log('[fetchMessageTree] Routing to CLOUD API')
      response = await apiCall<{ messages: Message[]; tree: any }>(
        `/conversations/${conversationId}/messages/tree`,
        auth.accessToken
      )
    }

    // Handle both old and new response formats for backward compatibility
    const treeData = response.tree || response
    const messages = response.messages

    // If messages are included, load them into state
    if (messages && Array.isArray(messages)) {
      // Ensure client-only fields exist
      const normalizedMessages: Message[] = messages.map(m => ({
        ...m,
        pastedContext: Array.isArray((m as any).pastedContext) ? (m as any).pastedContext : [],
        artifacts: Array.isArray((m as any).artifacts) ? (m as any).artifacts : [],
      }))

      dispatch(chatSliceActions.messagesLoaded(normalizedMessages))

      // Conditional attachments fetch: only when metadata indicates or when metadata absent
      const attachmentsByMessage = state.chat.attachments.byMessage || {}

      for (const msg of normalizedMessages) {
        const alreadyFetched = Array.isArray(attachmentsByMessage[msg.id]) && attachmentsByMessage[msg.id].length > 0

        // Check if attachments are included in the response (optimized path)
        const includedAttachments = (msg as any).attachments

        if (
          !alreadyFetched &&
          includedAttachments &&
          Array.isArray(includedAttachments) &&
          includedAttachments.length > 0
        ) {
          // Process included attachments - dispatch metadata immediately
          dispatch(
            chatSliceActions.attachmentsSetForMessage({
              messageId: msg.id,
              attachments: includedAttachments,
            })
          )

          // Fetch and convert binaries to base64 (async operation)
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
        } else if (!alreadyFetched) {
          // Fallback: use old individual fetch logic if attachments not included
          const hasMeta = typeof msg.has_attachments !== 'undefined' || typeof msg.attachments_count !== 'undefined'
          const indicatesAttachments =
            msg.has_attachments === true || (typeof msg.attachments_count === 'number' && msg.attachments_count > 0)

          if ((hasMeta && indicatesAttachments) || !hasMeta) {
            dispatch(fetchAttachmentsByMessage({ messageId: msg.id }))
          }
        }
      }
    }

    // console.log('treeData', treeData)
    dispatch(chatSliceActions.heimdallDataLoaded({ treeData }))

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch message tree'
    dispatch(chatSliceActions.heimdallError(message))
    return rejectWithValue(message)
  }
})

// Consolidated conversation initialization - fetches all required data in sequence to avoid rate limiting
export const initializeConversationData = createAsyncThunk<
  { messages: Message[]; treeData: any; systemPrompt: string | null; context: string | null },
  ConversationId,
  { state: RootState; extra: ThunkExtraArgument }
>('chat/initializeConversationData', async (conversationId, { dispatch, extra, rejectWithValue, getState }) => {
  const { auth } = extra

  try {
    // Check if we already have this conversation's data loaded recently
    const state = getState() as RootState
    const { heimdall, conversation } = state.chat
    const now = Date.now()

    // Skip if we just loaded this conversation (within 500ms)
    if (
      conversation.currentConversationId === conversationId &&
      typeof heimdall.lastFetchedAt === 'number' &&
      now - heimdall.lastFetchedAt < 500
    ) {
      return {
        messages: conversation.messages,
        treeData: heimdall.treeData,
        systemPrompt: state.conversations.systemPrompt,
        context: state.conversations.convContext,
      }
    }

    // Fetch all data sequentially to avoid rate limiting
    dispatch(chatSliceActions.heimdallLoadingStarted())

    // 1. Fetch tree data (now includes messages - optimized single call)
    const treeResponse = await dispatch(fetchMessageTree(conversationId)).unwrap()
    const messages = treeResponse.messages || []
    const treeData = treeResponse.tree || treeResponse

    // 2. Fetch system prompt and context in parallel (these are lightweight)
    const [systemPromptRes, contextRes] = await Promise.all([
      apiCall<{ systemPrompt: string | null }>(`/conversations/${conversationId}/system-prompt`, auth.accessToken),
      apiCall<{ context: string | null }>(`/conversations/${conversationId}/context`, auth.accessToken),
    ])

    const systemPrompt = systemPromptRes?.systemPrompt ?? null
    const context = contextRes?.context ?? null

    // Update state
    dispatch(systemPromptSet(systemPrompt))
    dispatch(convContextSet(context))

    return { messages, treeData, systemPrompt, context }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize conversation data'
    dispatch(chatSliceActions.heimdallError(message))
    return rejectWithValue(message)
  }
})

// Refresh currentPath after a cascade delete (server deletes a message and its subtree)
export const refreshCurrentPathAfterDelete = createAsyncThunk<
  { children: MessageId[]; newPath: MessageId[] },
  { conversationId: ConversationId; messageId: MessageId },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/refreshCurrentPathAfterDelete',
  async ({ conversationId, messageId }, { getState, dispatch, extra, rejectWithValue }) => {
    const { auth } = extra
    try {
      // Fetch direct children of the deleted message from the server
      const children = await apiCall<MessageId[]>(
        `/conversations/${conversationId}/messages/${messageId}/children`,
        auth.accessToken
      )

      const state = getState() as RootState
      const currentPath = state.chat.conversation.currentPath || []

      let newPath = currentPath

      // If the deleted message itself is on the path, truncate before it
      const idxDeleted = currentPath.indexOf(messageId)
      if (idxDeleted !== -1) {
        newPath = currentPath.slice(0, idxDeleted)
      } else if (children && children.length > 0) {
        // Otherwise, if any of its direct children are on the path, truncate before the first occurrence
        const childSet = new Set(children)
        const firstChildIdx = currentPath.findIndex(id => childSet.has(id))
        if (firstChildIdx !== -1) {
          newPath = currentPath.slice(0, firstChildIdx)
        }
      }

      // Only dispatch if the path actually changes
      if (newPath !== currentPath) {
        dispatch(chatSliceActions.conversationPathSet(newPath))
      }

      return { children, newPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to refresh path after delete'
      return rejectWithValue(message)
    }
  }
)

// Initialize user and conversation
export const initializeUserAndConversation = createAsyncThunk<
  { userId: number; conversationId: ConversationId },
  void,
  { extra: ThunkExtraArgument }
>('chat/initializeUserAndConversation', async (_arg, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  dispatch(chatSliceActions.initializationStarted())
  try {
    // Create test user
    const user = await apiCall<{ id: number }>('/users', auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({ username: 'test-user' }),
    })

    // Create new conversation
    const conversation = await apiCall<{ id: ConversationId }>(`/conversations`, auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({ userId: user.id }),
    })

    dispatch(chatSliceActions.initializationCompleted({ userId: String(user.id), conversationId: conversation.id }))
    return { userId: user.id, conversationId: conversation.id }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize'
    dispatch(chatSliceActions.initializationError(message))
    return rejectWithValue(message)
  }
})

// Delete multiple messages by their IDs
export const deleteSelectedNodes = createAsyncThunk<
  { deleted: number },
  { ids: MessageId[]; conversationId: ConversationId; storageMode?: 'local' | 'cloud' },
  { extra: ThunkExtraArgument }
>('chat/deleteSelectedNodes', async ({ ids, conversationId, storageMode }, { extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    // Use storageMode passed from caller (most reliable) or fallback to cache lookup
    const effectiveStorageMode = storageMode ?? getStorageModeFromCache(extra.queryClient, conversationId)
    const isLocalMode = shouldUseLocalApi(effectiveStorageMode)

    // console.log('[deleteSelectedNodes] Routing decision:', {
    //   passedStorageMode: storageMode,
    //   effectiveStorageMode,
    //   isLocalMode,
    //   environment,
    //   conversationId,
    //   messageCount: ids.length,
    // })

    let response: { deleted: number }
    if (isLocalMode) {
      // console.log('[deleteSelectedNodes] -> Routing to LOCAL API: /local/messages/deleteMany')
      response = await localApi.post<{ deleted: number }>('/local/messages/deleteMany', { ids })
    } else {
      // console.log('[deleteSelectedNodes] -> Routing to CLOUD API: /messages/deleteMany')
      response = await apiCall<{ deleted: number }>('/messages/deleteMany', auth.accessToken, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      })
    }
    // Sync React Query cache immediately
    removeMessagesFromCache(extra.queryClient, conversationId, ids)
    return response
  } catch (error) {
    console.error('[deleteSelectedNodes] Error:', error)
    const message = error instanceof Error ? error.message : 'Failed to delete messages'
    return rejectWithValue(message)
  }
})

// Update a conversation title (Chat feature convenience)
export const updateConversationTitle = createAsyncThunk<
  Conversation,
  { id: ConversationId; title: string; storageMode?: 'cloud' | 'local' },
  { extra: ThunkExtraArgument; state: RootState }
>('chat/updateConversationTitle', async ({ id, title, storageMode }, { extra, getState, rejectWithValue }) => {
  const { auth } = extra
  try {
    // Infer storage mode from state if not provided
    let effectiveMode = storageMode
    if (!effectiveMode) {
      const conversation = getState().conversations.items.find(c => c.id === id)
      effectiveMode = conversation?.storage_mode || 'cloud'
    }

    // Route to appropriate API based on storage mode
    if (shouldUseLocalApi(effectiveMode, environment)) {
      return await localApi.patch<Conversation>(`/local/conversations/${id}`, { title })
    }

    // Default to cloud API
    return await apiCall<Conversation>(`/conversations/${id}/`, auth.accessToken, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update conversation'
    return rejectWithValue(message)
  }
})

/* Attachments: upload, link, fetch, delete */

// Upload an image file as multipart/form-data to /api/attachments
export const uploadAttachment = createAsyncThunk<
  Attachment,
  { file: File; messageId?: number | null },
  { extra: ThunkExtraArgument }
>('chat/uploadAttachment', async ({ file, messageId }, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    const form = new FormData()
    form.append('file', file)
    if (messageId != null) form.append('messageId', String(messageId))

    const attachment = await apiCall<Attachment>('/attachments', auth.accessToken, {
      method: 'POST',
      body: form,
    })

    if (attachment.message_id != null) {
      dispatch(
        chatSliceActions.attachmentUpsertedForMessage({
          messageId: attachment.message_id,
          attachment,
        })
      )
    }

    return attachment
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to upload attachment'
    return rejectWithValue(message)
  }
})

// Link existing attachments to a message
export const linkAttachmentsToMessage = createAsyncThunk<
  Attachment[],
  { messageId: MessageId; attachmentIds: string[] },
  { extra: ThunkExtraArgument }
>('chat/linkAttachmentsToMessage', async ({ messageId, attachmentIds }, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    const attachments = await apiCall<Attachment[]>(`/messages/${messageId}/attachments`, auth.accessToken, {
      method: 'POST',
      body: JSON.stringify({ attachmentIds }),
    })

    dispatch(chatSliceActions.attachmentsSetForMessage({ messageId, attachments }))
    return attachments
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to link attachments'
    return rejectWithValue(message)
  }
})

// Fetch attachments for a message
export const fetchAttachmentsByMessage = createAsyncThunk<
  Attachment[],
  { messageId: MessageId },
  { extra: ThunkExtraArgument }
>('chat/fetchAttachmentsByMessage', async ({ messageId }, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    const attachments = await apiCall<Attachment[]>(`/messages/${messageId}/attachments`, auth.accessToken)
    dispatch(chatSliceActions.attachmentsSetForMessage({ messageId, attachments }))
    // Fetch binaries and convert to base64 data URLs
    const dataUrls: string[] = (
      await Promise.all(
        (attachments || []).map(async a => {
          const url = resolveAttachmentUrl(a.url, a.file_path, a.id)
          if (!url) return null
          try {
            const res = await fetch(url)
            if (!res.ok) return null
            const blob = await res.blob()
            const dataUrl = await blobToDataURL(blob)
            return dataUrl
          } catch {
            return null
          }
        })
      )
    ).filter((x): x is string => Boolean(x))

    dispatch(chatSliceActions.messageArtifactsSet({ messageId, artifacts: dataUrls }))
    return attachments
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch attachments'
    return rejectWithValue(message)
  }
})

// Delete all attachments for a message
export const deleteAttachmentsByMessage = createAsyncThunk<
  { deleted: number },
  { messageId: MessageId },
  { extra: ThunkExtraArgument }
>('chat/deleteAttachmentsByMessage', async ({ messageId }, { dispatch, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    const result = await apiCall<{ deleted: number }>(`/messages/${messageId}/attachments`, auth.accessToken, {
      method: 'DELETE',
    })
    dispatch(chatSliceActions.attachmentsClearedForMessage(messageId))
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete attachments'
    return rejectWithValue(message)
  }
})

// Fetch a single attachment by ID
export const fetchAttachmentById = createAsyncThunk<Attachment, { id: MessageId }, { extra: ThunkExtraArgument }>(
  'chat/fetchAttachmentById',
  async ({ id }, { dispatch, extra, rejectWithValue }) => {
    const { auth } = extra
    try {
      const attachment = await apiCall<Attachment>(`/attachments/${id}`, auth.accessToken)
      if (attachment.message_id != null) {
        dispatch(
          chatSliceActions.attachmentUpsertedForMessage({
            messageId: attachment.message_id,
            attachment,
          })
        )
      }
      return attachment
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch attachment'
      return rejectWithValue(message)
    }
  }
)

// Abort a running generation
export const abortStreaming = createAsyncThunk<
  { success: boolean; messageDeleted?: boolean },
  { messageId: MessageId },
  { state: RootState; extra: ThunkExtraArgument }
>('chat/abortStreaming', async ({ messageId }, { dispatch, getState, extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    const response = await apiCall<{ success: boolean; messageDeleted?: boolean }>(
      `/messages/${messageId}/abort`,
      auth.accessToken,
      {
        method: 'POST',
      }
    )

    if (response.success) {
      dispatch(chatSliceActions.streamingAborted())

      // If the assistant message was deleted, refetch messages to update the UI
      if (response.messageDeleted) {
        const state = getState()
        const conversationId = state.chat.conversation.currentConversationId
        if (conversationId) {
          // Stabilize the currentPath first by truncating past the deleted leaf
          // Pass the user messageId (the generation root); the thunk will truncate before any direct child on path
          // dispatch(
          //   refreshCurrentPathAfterDelete({ conversationId, messageId })
          // )
          dispatch(fetchConversationMessages(conversationId))
        }
      }
    }

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to abort generation'
    return rejectWithValue(message)
  }
})

// Fetch available tools - now returns local tool definitions
// Tools are defined locally in toolDefinitions.ts, not fetched from server
export const fetchTools = createAsyncThunk<ToolDefinition[], void, { state: RootState }>(
  'chat/fetchTools',
  async (_, { getState }) => {
    // Return tools from local state (already initialized from toolDefinitions.ts)
    const state = getState()
    return state.chat.tools
  }
)

// Update tool enabled status - now updates local state only
export const updateToolEnabled = createAsyncThunk<
  { success: boolean; toolName: string; enabled: boolean },
  { toolName: string; enabled: boolean },
  { state: RootState }
>('chat/updateToolEnabled', async ({ toolName, enabled }, { dispatch }) => {
  // Update local state
  dispatch(chatSliceActions.toolEnabledUpdated({ toolName, enabled }))

  // Return the updated status
  return { success: true, toolName, enabled }
})

// Bulk insert messages (for copying message chains to new conversation)
export const insertBulkMessages = createAsyncThunk<
  Message[],
  {
    conversationId: ConversationId
    messages: Array<{
      role: 'user' | 'assistant'
      content: string
      thinking_block?: string
      model_name?: string
      tool_calls?: string
      note?: string
      content_blocks?: any
    }>
    storageMode?: 'local' | 'cloud' // Optional: explicitly set storage mode (useful for newly created conversations)
  },
  { extra: ThunkExtraArgument }
>('chat/insertBulkMessages', async ({ conversationId, messages, storageMode }, { extra, rejectWithValue }) => {
  const { auth } = extra
  try {
    // Use provided storageMode if available, otherwise try cache lookup
    const effectiveStorageMode = storageMode || getStorageModeFromCache(extra.queryClient, conversationId)
    if (shouldUseLocalApi(effectiveStorageMode, environment)) {
      const response = await localApi.post<{ messages: Message[] }>(
        `/local/conversations/${conversationId}/messages/bulk`,
        { messages }
      )
      return response.messages
    }

    const response = await apiCall<{ messages: Message[] }>(
      `/conversations/${conversationId}/messages/bulk`,
      auth.accessToken,
      {
        method: 'POST',
        body: JSON.stringify({ messages }),
      }
    )
    return response.messages
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to insert bulk messages'
    return rejectWithValue(message)
  }
})

// ============================================================================
// CLAUDE CODE AGENT ENDPOINTS
// ============================================================================

/**
 * Fetch Claude Code session info for a conversation
 * Returns session metadata without starting/resuming a session
 * Always uses local server - CC is local-only
 */
export const getCCSessionInfo = createAsyncThunk<
  { hasSession: boolean; sessionId?: string; lastMessageAt?: string; messageCount?: number; cwd?: string },
  ConversationId,
  { state: RootState; extra: ThunkExtraArgument }
>('chat/getCCSessionInfo', async (conversationId, { rejectWithValue }) => {
  try {
    // CC always routes to local server
    const response = await localApi.get<{
      hasSession: boolean
      sessionId?: string
      lastMessageAt?: string
      messageCount?: number
      cwd?: string
    }>(`/agents/cc-session/${conversationId}`)

    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get CC session info'
    return rejectWithValue(message)
  }
})

/**
 * Fetch available slash commands for Claude Code session
 * Commands are discovered from SDK init message and include built-in + custom commands
 * Always uses local server - CC is local-only
 */
export const fetchCCSlashCommands = createAsyncThunk<
  string[],
  { conversationId: ConversationId; cwd?: string },
  { state: RootState; extra: ThunkExtraArgument }
>('chat/fetchCCSlashCommands', async ({ conversationId, cwd }, { dispatch, rejectWithValue }) => {
  try {
    const queryParams = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    const response = await localApi.get<{ commands: string[] }>(`/agents/cc-commands/${conversationId}${queryParams}`)

    const commands = response.commands || []
    dispatch(chatSliceActions.ccSlashCommandsLoaded(commands))
    return commands
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch CC slash commands'
    return rejectWithValue(message)
  }
})

/**
 * Send message to Claude Code agent with SSE streaming
 *
 * Similar to sendMessage but uses CC agent endpoints.
 * Automatically saves messages with ex_agent role.
 * Tracks CC session ID in message metadata.
 * Always uses local server - CC is local-only.
 */
export const sendCCMessage = createAsyncThunk<
  { sessionId: string; messageCount: number; userMessageId?: MessageId; streamId: string },
  SendCCMessagePayload & { streamId?: string },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/sendCCMessage',
  async (
    {
      conversationId,
      message,
      cwd,
      permissionMode = 'default',
      resume,
      sessionId: resumeSessionId,
      forkSession,
      streamId: providedStreamId,
    },
    { dispatch, extra, rejectWithValue, signal }
  ) => {
    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('primary')

    dispatch(
      chatSliceActions.sendingStarted({
        streamId,
        streamType: 'primary',
      })
    )

    let controller: AbortController | undefined

    try {
      controller = new AbortController()
      signal.addEventListener('abort', () => controller?.abort())

      // Prepare request body
      const requestBody: any = {
        message,
        permissionMode,
      }

      if (cwd) requestBody.cwd = cwd
      if (resume !== undefined) requestBody.resume = resume
      if (resumeSessionId) requestBody.sessionId = resumeSessionId
      if (forkSession !== undefined) requestBody.forkSession = forkSession

      // CC always routes to local server (no auth needed)
      const response = await fetch(`${LOCAL_API_BASE}/agents/cc-messages/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText || 'Failed to send CC message'}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream reader available')

      const decoder = new TextDecoder()
      let sessionId: string | null = null
      let messageCount = 0
      let userMessageId: MessageId | undefined
      let buffer = ''
      let shouldInvalidateMessages = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Buffer management - same pattern as sendMessage
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            try {
              const chunk = JSON.parse(line.slice(6))

              // Handle CC-specific event types
              if (chunk.type === 'chunk') {
                // Real-time streaming chunk (delta) - display incrementally
                // This comes from the onStreamingChunk callback for live streaming
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'chunk',
                    content: chunk.delta || chunk.content || '',
                    part: chunk.part || 'text',
                    chunkType: chunk.chunkType,
                  })
                )
              } else if (chunk.type === 'message' && chunk.message) {
                // CC assistant message with ex_agent role (complete message for persistence)
                // This comes after streaming completes for final database save
                const ccMessage: Message = {
                  ...chunk.message,
                  role: 'ex_agent',
                }
                dispatch(chatSliceActions.messageAdded(ccMessage))
                dispatch(chatSliceActions.messageBranchCreated({ newMessage: ccMessage }))
                updateMessageCache(extra.queryClient, conversationId, ccMessage)
              } else if (chunk.type === 'progress') {
                // Tool execution progress - show in streaming buffer
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'chunk',
                    content: chunk.toolName ? `Executing: ${chunk.toolName}` : 'Processing...',
                    part: 'text',
                  })
                )
              } else if (chunk.type === 'system') {
                // System events (init, auth, etc.) - log silently for now
                console.log('[CC System]', chunk.message)
              } else if (chunk.type === 'result') {
                // Result message from slash commands - backend streams output as chunks
                // But also handle direct result.result for compatibility
                if (chunk.result?.result) {
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      type: 'chunk',
                      content: chunk.result.result,
                      part: 'text',
                      chunkType: 'result_output',
                    })
                  )
                }
              } else if (chunk.type === 'complete') {
                sessionId = chunk.sessionId
                messageCount = chunk.messageCount
                shouldInvalidateMessages = true
              } else if (chunk.type === 'error') {
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'error',
                    error: chunk.error || 'CC error',
                  })
                )
                throw new Error(chunk.error || 'CC stream error')
              }
            } catch (parseError) {
              // Skip malformed chunks
              if (line.length > 100) {
                console.warn('Failed to parse CC chunk:', line.substring(0, 100) + '...', parseError)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (shouldInvalidateMessages) {
        await extra.queryClient.invalidateQueries({ queryKey: ['conversations', conversationId, 'messages'] })
      }

      if (!sessionId) {
        throw new Error('No session ID received from CC')
      }

      dispatch(chatSliceActions.sendingCompleted({ streamId }))
      dispatch(chatSliceActions.inputCleared())

      // Schedule stream cleanup after delay
      setTimeout(() => {
        dispatch(chatSliceActions.streamPruned({ streamId }))
      }, STREAM_PRUNE_DELAY)

      return { sessionId, messageCount, userMessageId, streamId }
    } catch (error) {
      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      if (error instanceof Error && error.name === 'AbortError') {
        return rejectWithValue('CC message cancelled')
      }

      const message = error instanceof Error ? error.message : 'Failed to send CC message'
      dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: message } }))
      return rejectWithValue(message)
    }
  }
)

/**
 * Send branch message to Claude Code agent with SSE streaming
 * Always uses local server - CC is local-only.
 */
export const sendCCBranch = createAsyncThunk<
  { sessionId: string; messageCount: number; userMessageId?: MessageId; streamId: string },
  SendCCBranchPayload & { streamId?: string },
  { state: RootState; extra: ThunkExtraArgument }
>(
  'chat/sendCCBranch',
  async (
    {
      conversationId,
      message,
      cwd,
      permissionMode = 'default',
      resume,
      parentId,
      sessionId: resumeSessionId,
      forkSession,
      streamId: providedStreamId,
    },
    { dispatch, extra, rejectWithValue, signal }
  ) => {
    // Generate or use provided stream ID
    const streamId = providedStreamId ?? generateStreamId('branch')

    dispatch(
      chatSliceActions.sendingStarted({
        streamId,
        streamType: 'branch',
        lineage: {
          rootMessageId: parentId,
        },
      })
    )

    let controller: AbortController | undefined

    try {
      controller = new AbortController()
      signal.addEventListener('abort', () => controller?.abort())

      if (!parentId) {
        throw new Error('parentId is required for CC branching')
      }

      // Prepare request body - parentId is required for branching
      const requestBody: any = {
        message,
        permissionMode,
        parentId, // Explicitly pass parentId for branching
      }

      if (cwd) requestBody.cwd = cwd
      if (resume !== undefined) requestBody.resume = resume
      if (resumeSessionId) requestBody.sessionId = resumeSessionId
      if (forkSession !== undefined) requestBody.forkSession = forkSession

      // CC always routes to local server (no auth needed)
      const response = await fetch(`${LOCAL_API_BASE}/agents/cc-messages-branch/${conversationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText || 'Failed to send CC branch message'}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No stream reader available')

      const decoder = new TextDecoder()
      let sessionId: string | null = null
      let messageCount = 0
      let userMessageId: MessageId | undefined
      let buffer = ''
      let shouldInvalidateMessages = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          // Buffer management - same pattern as sendMessage
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue

            try {
              const chunk = JSON.parse(line.slice(6))

              // Handle CC-specific event types
              if (chunk.type === 'chunk') {
                // Real-time streaming chunk (delta) - display incrementally
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'chunk',
                    content: chunk.delta || chunk.content || '',
                    part: chunk.part || 'text',
                    chunkType: chunk.chunkType,
                  })
                )
              } else if (chunk.type === 'message' && chunk.message) {
                // CC assistant message with ex_agent role (complete message for persistence)
                const ccMessage: Message = {
                  ...chunk.message,
                  role: 'ex_agent',
                }
                dispatch(chatSliceActions.messageAdded(ccMessage))
                dispatch(chatSliceActions.messageBranchCreated({ newMessage: ccMessage }))
                updateMessageCache(extra.queryClient, conversationId, ccMessage)
              } else if (chunk.type === 'progress') {
                // Tool execution progress - show in streaming buffer
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'chunk',
                    content: chunk.toolName ? `Executing: ${chunk.toolName}` : 'Processing...',
                    part: 'text',
                  })
                )
              } else if (chunk.type === 'system') {
                // System events (init, auth, etc.)
                console.log('[CC System]', chunk.message)
              } else if (chunk.type === 'result') {
                // Result message from slash commands - backend streams output as chunks
                // But also handle direct result.result for compatibility
                if (chunk.result?.result) {
                  dispatch(
                    chatSliceActions.streamChunkReceived({
                      type: 'chunk',
                      content: chunk.result.result,
                      part: 'text',
                      chunkType: 'result_output',
                    })
                  )
                }
              } else if (chunk.type === 'complete') {
                sessionId = chunk.sessionId
                messageCount = chunk.messageCount
                shouldInvalidateMessages = true
              } else if (chunk.type === 'error') {
                dispatch(
                  chatSliceActions.streamChunkReceived({
                    type: 'error',
                    error: chunk.error || 'CC error',
                  })
                )
                throw new Error(chunk.error || 'CC branch stream error')
              }
            } catch (parseError) {
              // Skip malformed chunks
              if (line.length > 100) {
                console.warn('Failed to parse CC branch chunk:', line.substring(0, 100) + '...', parseError)
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }

      if (shouldInvalidateMessages) {
        await extra.queryClient.invalidateQueries({ queryKey: ['conversations', conversationId, 'messages'] })
      }

      if (!sessionId) {
        throw new Error('No session ID received from CC branch')
      }

      dispatch(chatSliceActions.sendingCompleted({ streamId }))
      dispatch(chatSliceActions.inputCleared())

      // Schedule stream cleanup after delay
      setTimeout(() => {
        dispatch(chatSliceActions.streamPruned({ streamId }))
      }, STREAM_PRUNE_DELAY)

      return { sessionId, messageCount, userMessageId, streamId }
    } catch (error) {
      dispatch(chatSliceActions.sendingCompleted({ streamId }))

      if (error instanceof Error && error.name === 'AbortError') {
        return rejectWithValue('CC branch message cancelled')
      }

      const message = error instanceof Error ? error.message : 'Failed to send CC branch message'
      dispatch(chatSliceActions.streamChunkReceived({ streamId, chunk: { type: 'error', error: message } }))
      return rejectWithValue(message)
    }
  }
)

// export const fetchMessageTree = createAsyncThunk(
//   'chat/fetchMessageTree',
//   async (conversationId: number, { dispatch, rejectWithValue }) => {
//     dispatch(chatActions.messageTreeLoadingStarted())

//     try {
//       const treeData = await apiCall<any>(`/conversations/${conversationId}/messages/tree`)
//       dispatch(chatActions.messageTreeLoaded({ conversationId, treeData }))
//       return treeData
//     } catch (error) {
//       const message = error instanceof Error ? error.message : 'Failed to fetch message tree'
//       dispatch(chatActions.messageTreeError(message))
//       return rejectWithValue(message)
//     }
//   }
// )

export const respondToToolPermission = createAsyncThunk<void, boolean, { state: RootState; extra: ThunkExtraArgument }>(
  'chat/respondToToolPermission',
  async (allowed, { dispatch }) => {
    if (pendingPermissionResolve) {
      pendingPermissionResolve(allowed)
      pendingPermissionResolve = null
    }
    dispatch(chatSliceActions.toolPermissionResponded())
  }
)

export const respondToToolPermissionAndEnableAll = createAsyncThunk<
  void,
  void,
  { state: RootState; extra: ThunkExtraArgument }
>('chat/respondToToolPermissionAndEnableAll', async (_, { dispatch }) => {
  // Enable auto-approve mode for all future tools
  dispatch(chatSliceActions.toolAutoApproveEnabled())

  // Approve the current pending tool call
  if (pendingPermissionResolve) {
    pendingPermissionResolve(true)
    pendingPermissionResolve = null
  }

  // Clear the permission dialog
  dispatch(chatSliceActions.toolPermissionResponded())
})

/**
 * Fetch all user system prompts for the current user
 */
export const fetchUserSystemPrompts = createAsyncThunk<
  void,
  { accessToken: string | null },
  { state: RootState; extra: ThunkExtraArgument }
>('chat/fetchUserSystemPrompts', async ({ accessToken }, { dispatch, rejectWithValue }) => {
  dispatch(chatSliceActions.userSystemPromptsLoadingStarted())

  try {
    const prompts = await apiCall<any[]>('/system-prompts', accessToken)
    dispatch(chatSliceActions.userSystemPromptsLoaded(prompts))
    return
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch user system prompts'
    dispatch(chatSliceActions.userSystemPromptsError(message))
    return rejectWithValue(message)
  }
})
