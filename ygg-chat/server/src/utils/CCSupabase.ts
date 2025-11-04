/**
 * CCSupabase - Claude Code Supabase Integration
 *
 * This module integrates the Claude Code Agent SDK with Supabase database persistence.
 * It provides functions to save CC messages, manage sessions, and handle conversation state.
 *
 * Key features:
 * - Automatic message persistence via OnResponse callbacks
 * - Session tracking with ex_agent_session_id
 * - Content assembly from ParsedContent blocks
 * - Parent-child message threading
 * - Error handling and recovery
 */

import { SupabaseClient } from '@supabase/supabase-js'
import {
  Conversation,
  ConversationService,
  createAuthenticatedClient,
  Message,
  MessageService,
} from '../database/supamodels'
import {
  CCResponse,
  CCStreamChunk,
  OnResponse,
  OnStreamingChunk,
  ParsedContent,
  ParsedTextContent,
  ParsedThinkingContent,
  ParsedToolResultContent,
  ParsedToolUseContent,
  resumeChat,
  startChat,
} from './CC'

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A single content block in chronological sequence
 */
interface ContentBlock {
  type: 'thinking' | 'tool_use' | 'text' | 'tool_result'
  index: number
}

interface ThinkingBlock extends ContentBlock {
  type: 'thinking'
  content: string
}

interface ToolUseBlock extends ContentBlock {
  type: 'tool_use'
  id: string
  name: string
  input: any
}

interface TextBlock extends ContentBlock {
  type: 'text'
  content: string
}

interface ToolResultBlock extends ContentBlock {
  type: 'tool_result'
  tool_use_id: string
  content: any
  is_error: boolean
}

type ContentBlockSequence = (ThinkingBlock | ToolUseBlock | TextBlock | ToolResultBlock)[]

/**
 * Result of saving a CC message to the database
 */
interface SavedCCMessage {
  message: Message
  sessionId: string
}

/**
 * Options for starting/resuming CC chat with database integration
 */
interface CCChatOptions {
  conversationId: string
  userMessage: string
  cwd: string
  userId: string
  jwt: string
  permissionMode?: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits'
  onStream?: (data: any) => void
  sessionId?: string
}

/**
 * Response from CC chat with database integration
 */
interface CCChatResponse {
  conversation: Conversation
  messages: Message[]
  sessionId: string
}

// ============================================================================
// Content Assembly Functions
// ============================================================================

/**
 * Assembles CC parsed content into database-compatible message fields
 *
 * Takes an array of ParsedContent blocks and extracts:
 * - Text content → content field
 * - Thinking blocks → thinking_block field
 * - Tool calls → tool_calls JSONB field
 * - Tool results → appended to content with formatting
 *
 * @param parsedContent - Array of parsed content blocks from CC response
 * @returns Object with content, thinking_block, and tool_calls
 */
function assembleCCContent(parsedContent: ParsedContent[]): {
  content: string
  thinking_block: string
  tool_calls: any[] | null
} {
  const contentParts: string[] = []
  const thinkingParts: string[] = []
  const toolCalls: any[] = []

  for (const block of parsedContent) {
    switch (block.type) {
      case 'text': {
        const textBlock = block as ParsedTextContent
        contentParts.push(textBlock.text)

        // Include citations if present
        if (textBlock.citations && textBlock.citations.length > 0) {
          const citationsText = textBlock.citations.map(c => `[Citation: ${c.type} - ${c.title || c.url}]`).join('\n')
          contentParts.push(citationsText)
        }
        break
      }

      case 'thinking': {
        const thinkingBlock = block as ParsedThinkingContent
        thinkingParts.push(thinkingBlock.thinking)
        break
      }

      case 'tool_use': {
        const toolUseBlock = block as ParsedToolUseContent
        toolCalls.push({
          id: toolUseBlock.id,
          name: toolUseBlock.name,
          input: toolUseBlock.input,
        })

        // Also add readable version to content for display
        contentParts.push(`[Tool: ${toolUseBlock.name}]`)
        break
      }

      case 'tool_result': {
        const toolResultBlock = block as ParsedToolResultContent
        const resultText = Array.isArray(toolResultBlock.content)
          ? toolResultBlock.content.map(c => (c as any).text || JSON.stringify(c)).join('\n')
          : String(toolResultBlock.content)

        const status = toolResultBlock.isError ? 'ERROR' : 'SUCCESS'
        contentParts.push(`[Tool Result ${status}: ${toolResultBlock.tool_use_id}]\n${resultText}`)
        break
      }

      default:
        // Unknown block type - log and stringify
        console.warn('[CCSupabase] Unknown content block type:', (block as any).type)
        contentParts.push(JSON.stringify(block))
    }
  }

  return {
    content: contentParts.join('\n\n').trim() || '',
    thinking_block: thinkingParts.join('\n\n').trim() || '',
    tool_calls: toolCalls.length > 0 ? toolCalls : null,
  }
}

// ============================================================================
// Database Save Functions
// ============================================================================

/**
 * Saves a CC assistant message to the database
 *
 * Converts a CCResponse (assistant message) into a database Message record with:
 * - role set to 'ex_agent'
 * - ex_agent_session_id set to CC session ID
 * - ex_agent_type set to 'claude_code'
 * - Content assembled from ParsedContent blocks
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Target conversation ID
 * @param ownerId - User ID (owner of the message)
 * @param ccResponse - CC response containing the assistant message
 * @param parentId - Parent message ID for threading
 * @param sessionId - CC session ID
 * @returns Saved message with session ID
 */
async function saveCCMessageToDatabase(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  ccResponse: CCResponse,
  parentId: string | null,
  sessionId: string
): Promise<SavedCCMessage> {
  // Only handle assistant messages (actual CC responses)
  if (ccResponse.messageType !== 'message' || !ccResponse.message) {
    throw new Error(`Cannot save non-message CC response type: ${ccResponse.messageType}`)
  }

  const parsedMessage = ccResponse.message

  // Assemble content from parsed blocks
  const { content, thinking_block, tool_calls } = assembleCCContent(parsedMessage.content)

  // Extract model name from usage or default to unknown
  const modelName = 'claude-sonnet-4-5' // CC uses Sonnet 4.5

  console.log('[CCSupabase] Saving CC message to database:', {
    conversationId,
    messageId: ccResponse.messageId,
    sessionId,
    contentLength: content.length,
    thinkingLength: thinking_block.length,
    toolCallsCount: tool_calls?.length || 0,
  })

  // Create message in database with ex_agent role
  // Note: We'll need to temporarily modify MessageService.create to accept ex_agent role
  // For now, we'll insert directly with proper fields
  const { data: message, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      owner_id: ownerId,
      parent_id: parentId,
      role: 'ex_agent', // External agent role
      content,
      thinking_block: thinking_block || '',
      tool_calls: tool_calls ? JSON.stringify(tool_calls) : null,
      model_name: modelName,
      ex_agent_session_id: sessionId,
      ex_agent_type: 'claude_code',
      note: ccResponse.message.stopReason || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[CCSupabase] Error saving CC message:', error)
    throw error
  }

  console.log('[CCSupabase] Successfully saved CC message:', message.id)

  return {
    message: message as Message,
    sessionId,
  }
}

/**
 * Saves a user message to the database
 *
 * Creates a standard user message record that will be the parent
 * for subsequent CC agent responses.
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Target conversation ID
 * @param ownerId - User ID
 * @param userMessage - The user's message text
 * @param parentId - Parent message ID (usually the last agent response)
 * @returns Created user message
 */
async function saveUserMessage(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  userMessage: string,
  parentId: string | null
): Promise<Message> {
  console.log('[CCSupabase] Saving user message to database')

  const message = await MessageService.create(
    client,
    ownerId,
    conversationId,
    parentId,
    'user',
    userMessage,
    '', // no thinking block for user messages
    'user-input', // model name
    undefined, // no tool calls
    undefined // no note
  )

  return message
}

/**
 * Saves accumulated CC message data to the database
 *
 * This is called after all steps have been accumulated into one logical message.
 * Stores content blocks in chronological sequence and text content for search.
 *
 * For Claude Code messages:
 * - content_blocks: JSONB array with all blocks in order (source of truth)
 * - content: Text-only content for search indexing
 * - thinking_block: NULL (data in content_blocks)
 * - tool_calls: NULL (data in content_blocks)
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Target conversation ID
 * @param ownerId - User ID (owner of the message)
 * @param contentBlocks - Ordered sequence of all content blocks
 * @param textOnlyContent - Text-only content for search indexing
 * @param sessionId - CC session ID
 * @param messageId - CC message ID
 * @param parentId - Parent message ID for threading
 * @param isError - Whether this is an error completion
 * @returns Saved message with session ID
 */
async function saveCCMessageToDatabaseAccumulated(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  contentBlocks: ContentBlockSequence,
  textOnlyContent: string,
  sessionId: string,
  messageId: string,
  parentId: string | null,
  isError: boolean
): Promise<SavedCCMessage> {
  const modelName = 'claude-sonnet-4-5' // CC uses Sonnet 4.5

  const blockStats = {
    thinking: contentBlocks.filter(b => b.type === 'thinking').length,
    toolUse: contentBlocks.filter(b => b.type === 'tool_use').length,
    text: contentBlocks.filter(b => b.type === 'text').length,
    toolResult: contentBlocks.filter(b => b.type === 'tool_result').length,
  }

  console.log('[CCSupabase] Saving accumulated CC message to database:', {
    conversationId,
    messageId,
    sessionId,
    contentTextLength: textOnlyContent.length,
    contentBlocksCount: contentBlocks.length,
    blockStats,
    isError,
  })

  // Create message in database with ex_agent role
  const { data: message, error } = await client
    .from('messages')
    .insert({
      conversation_id: conversationId,
      owner_id: ownerId,
      parent_id: parentId,
      role: 'ex_agent', // External agent role
      content: textOnlyContent || '', // Text-only for search
      thinking_block: null, // Skip - stored in content_blocks
      tool_calls: null, // Skip - stored in content_blocks
      content_blocks: contentBlocks, // NEW: Full ordered structure
      model_name: modelName,
      ex_agent_session_id: sessionId,
      ex_agent_type: 'claude_code',
      note: isError ? 'Generation completed with error' : null,
    })
    .select()
    .single()

  if (error) {
    console.error('[CCSupabase] Error saving accumulated CC message:', error)
    throw error
  }

  console.log('[CCSupabase] Successfully saved accumulated CC message:', {
    id: message.id,
    contentTextLength: (message.content || '').length,
    contentBlocksCount: contentBlocks.length,
    blockStats,
  })

  return {
    message: message as Message,
    sessionId,
  }
}

// ============================================================================
// Callback Factory Functions
// ============================================================================

/**
 * Creates OnResponse and OnStreamingChunk callbacks for CC SDK integration
 *
 * This factory function returns dual callbacks that:
 * - Stream chunks in real-time for delta-based display
 * - ACCUMULATE all agent response steps into a single message
 * - Save complete assistant messages only when generation completes
 * - Track parent_id for message threading
 * - Forward all events to optional stream callback
 * - Handle errors gracefully
 *
 * Key change: Instead of saving on EVERY message event, accumulate content
 * across all response events and save only when the agent is finished (on 'result').
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Target conversation ID
 * @param ownerId - User ID
 * @param userMessageId - ID of the user message that triggered CC
 * @param onStream - Optional callback to stream events to client
 * @returns Object with onResponse and onStreamingChunk callbacks for CC SDK
 */
function createCCResponseCallback(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  userMessageId: string,
  onStream?: (data: any) => void
): { onResponse: OnResponse; onStreamingChunk: OnStreamingChunk } {
  // Track the last saved message ID for parent linking
  let lastMessageId: string = userMessageId

  // ===== ACCUMULATION STATE =====
  // Track content blocks in chronological sequence
  let contentBlocksSequence: ContentBlockSequence = []
  let textOnlyParts: string[] = [] // For search indexing
  let sequenceIndex = 0 // Track order of blocks
  let currentSessionId: string | null = null
  let currentMessageId: string | undefined = undefined
  let isAccumulating = false

  console.log('[CCSupabase] Callback factory initialized for user message:', userMessageId)

  // Streaming chunk handler - forwards deltas to client in real-time
  const onStreamingChunk: OnStreamingChunk = async (chunk: CCStreamChunk) => {
    try {
      if (onStream) {
        // Transform CC chunk format to OpenRouter-compatible format
        const streamEvent = {
          type: 'chunk',
          part: chunk.contentType === 'thinking' ? 'reasoning' : 'text',
          delta: chunk.delta || '',
          content: chunk.delta || '',
          toolName: chunk.toolName,
          toolId: chunk.toolId,
          chunkType: chunk.type,
        }
        onStream(streamEvent)
      }
    } catch (error) {
      console.error('[CCSupabase] Error in streaming chunk callback:', error)
      // Don't throw - continue streaming
    }
  }

  // Response handler - ACCUMULATES and saves only on completion
  const onResponse: OnResponse = async (response: CCResponse) => {
    try {
      // Forward all events to stream callback if provided
      if (onStream) {
        onStream(response)
      }

      // Handle different message types
      switch (response.messageType) {
        case 'message': {
          // ACCUMULATION: Extract blocks in chronological order
          if (response.sessionId && response.message) {
            console.log('[CCSupabase] [ACCUMULATE] Message event received. Session:', response.sessionId)

            // Track session and message IDs
            currentSessionId = response.sessionId
            currentMessageId = response.messageId
            isAccumulating = true

            // Extract blocks in order from parsed content
            for (const block of response.message.content) {
              switch (block.type) {
                case 'thinking': {
                  const thinkingBlock = block as ParsedThinkingContent
                  contentBlocksSequence.push({
                    type: 'thinking',
                    content: thinkingBlock.thinking,
                    index: sequenceIndex++,
                  })
                  console.log('[CCSupabase] [ACCUMULATE] Thinking block added at index', sequenceIndex - 1)
                  break
                }

                case 'tool_use': {
                  const toolBlock = block as ParsedToolUseContent
                  contentBlocksSequence.push({
                    type: 'tool_use',
                    id: toolBlock.id,
                    name: toolBlock.name,
                    input: toolBlock.input,
                    index: sequenceIndex++,
                  })
                  console.log(
                    '[CCSupabase] [ACCUMULATE] Tool call',
                    toolBlock.name,
                    'added at index',
                    sequenceIndex - 1
                  )
                  break
                }

                case 'text': {
                  const textBlock = block as ParsedTextContent
                  contentBlocksSequence.push({
                    type: 'text',
                    content: textBlock.text,
                    index: sequenceIndex++,
                  })
                  textOnlyParts.push(textBlock.text)

                  // Include citations if present
                  if (textBlock.citations && textBlock.citations.length > 0) {
                    const citationsText = textBlock.citations
                      .map(c => `[Citation: ${c.type} - ${c.title || c.url}]`)
                      .join('\n')
                    textOnlyParts.push(citationsText)
                  }
                  console.log('[CCSupabase] [ACCUMULATE] Text block added at index', sequenceIndex - 1)
                  break
                }

                case 'tool_result': {
                  const resultBlock = block as ParsedToolResultContent
                  const resultText = Array.isArray(resultBlock.content)
                    ? resultBlock.content.map(c => (c as any).text || JSON.stringify(c)).join('\n')
                    : String(resultBlock.content)

                  contentBlocksSequence.push({
                    type: 'tool_result',
                    tool_use_id: resultBlock.tool_use_id,
                    content: resultBlock.content,
                    is_error: resultBlock.isError || false,
                    index: sequenceIndex++,
                  })

                  const status = resultBlock.isError ? 'ERROR' : 'SUCCESS'
                  textOnlyParts.push(`[Tool Result ${status}: ${resultBlock.tool_use_id}]\n${resultText}`)
                  console.log('[CCSupabase] [ACCUMULATE] Tool result added at index', sequenceIndex - 1)
                  break
                }

                default:
                  console.warn('[CCSupabase] [ACCUMULATE] Unknown block type:', (block as any).type)
              }
            }

            console.log('[CCSupabase] [ACCUMULATE] Total blocks so far:', contentBlocksSequence.length)
          }
          break
        }

        case 'progress': {
          // Tool progress - just stream, don't save
          console.log('[CCSupabase] Tool progress:', response.progress?.toolName)
          break
        }

        case 'system': {
          // System messages (init, auth, etc.) - just stream, don't save
          console.log('[CCSupabase] System message:', response.system?.subtype)
          break
        }

        case 'result': {
          // COMPLETION: Agent is done, save accumulated content blocks in order
          console.log('[CCSupabase] [SAVE] Result received. Is accumulating:', isAccumulating)
          console.log('[CCSupabase] [SAVE] Accumulated content blocks:', {
            totalBlocks: contentBlocksSequence.length,
            thinking: contentBlocksSequence.filter(b => b.type === 'thinking').length,
            toolUse: contentBlocksSequence.filter(b => b.type === 'tool_use').length,
            text: contentBlocksSequence.filter(b => b.type === 'text').length,
            toolResult: contentBlocksSequence.filter(b => b.type === 'tool_result').length,
            sessionId: currentSessionId,
          })

          if (isAccumulating && currentSessionId) {
            try {
              // Assemble text content for search indexing
              const textOnlyContent = textOnlyParts.join('\n\n').trim()

              console.log('[CCSupabase] [SAVE] Final content blocks:', {
                blockCount: contentBlocksSequence.length,
                textLength: textOnlyContent.length,
              })

              // Save ONCE with all accumulated blocks in chronological order
              const { message } = await saveCCMessageToDatabaseAccumulated(
                client,
                conversationId,
                ownerId,
                contentBlocksSequence,
                textOnlyContent,
                currentSessionId,
                currentMessageId || 'unknown',
                lastMessageId,
                response.result?.is_error || false
              )

              // Update last message ID for next response in chain
              lastMessageId = message.id
              console.log('[CCSupabase] [SAVE] Message saved successfully:', message.id)
            } catch (saveError) {
              console.error('[CCSupabase] [SAVE] Failed to save accumulated message:', saveError)
              // Continue - don't break the flow
            }
          }

          // Reset accumulation state for next agent response
          contentBlocksSequence = []
          textOnlyParts = []
          sequenceIndex = 0
          isAccumulating = false
          currentSessionId = null
          currentMessageId = undefined

          // Final result - log completion
          console.log('[CCSupabase] CC conversation completed:', {
            duration_ms: response.result?.duration_ms,
            num_turns: response.result?.num_turns,
            is_error: response.result?.is_error,
          })
          break
        }

        case 'error': {
          // ERROR: Save whatever we have accumulated
          console.error('[CCSupabase] [ERROR] CC error occurred:', response.error)
          console.log('[CCSupabase] [ERROR] Accumulated so far:', {
            totalBlocks: contentBlocksSequence.length,
            thinking: contentBlocksSequence.filter(b => b.type === 'thinking').length,
            toolUse: contentBlocksSequence.filter(b => b.type === 'tool_use').length,
            text: contentBlocksSequence.filter(b => b.type === 'text').length,
          })

          if (isAccumulating && currentSessionId) {
            try {
              const textOnlyContent = textOnlyParts.join('\n\n').trim()

              // Save partial message with error flag
              const { message } = await saveCCMessageToDatabaseAccumulated(
                client,
                conversationId,
                ownerId,
                contentBlocksSequence,
                textOnlyContent,
                currentSessionId,
                currentMessageId || 'unknown',
                lastMessageId,
                true // is_error = true
              )

              lastMessageId = message.id
              console.log('[CCSupabase] [ERROR] Partial message saved on error:', message.id)
            } catch (saveError) {
              console.error('[CCSupabase] [ERROR] Failed to save partial message on error:', saveError)
            }
          }

          // Reset accumulation state
          contentBlocksSequence = []
          textOnlyParts = []
          sequenceIndex = 0
          isAccumulating = false
          currentSessionId = null
          currentMessageId = undefined
          break
        }

        default:
          console.warn('[CCSupabase] Unknown response type:', response.messageType)
      }
    } catch (error) {
      console.error('[CCSupabase] Error in response callback:', error)
      // Don't throw - continue processing other messages
    }
  }

  return { onResponse, onStreamingChunk }
}

// ============================================================================
// High-Level Integration Functions
// ============================================================================

/**
 * Starts a new CC chat with database persistence
 *
 * This function:
 * 1. Verifies conversation exists and user has access
 * 2. Saves user message to database
 * 3. Starts CC chat with OnResponse callback that saves messages
 * 4. Returns updated conversation state
 *
 * @param options - Chat options including conversation ID, message, cwd, auth
 * @returns Promise with conversation, messages, and session ID
 */
export async function startCCChatWithDB(options: CCChatOptions): Promise<CCChatResponse> {
  const { conversationId, userMessage, cwd, userId, jwt, permissionMode = 'default', onStream } = options

  console.log('[CCSupabase] Starting CC chat with database integration:', {
    conversationId,
    cwd,
    permissionMode,
  })

  // Create authenticated Supabase client
  const client = createAuthenticatedClient(jwt)

  // Verify conversation exists and user has access
  const conversation = await ConversationService.getById(client, conversationId)
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found or access denied`)
  }

  // Get last message to determine parent ID
  const lastMessage = await MessageService.getLastMessage(client, conversationId)
  const parentId = lastMessage?.id || null

  // Save user message to database
  const userMsg = await saveUserMessage(client, conversationId, userId, userMessage, parentId)

  console.log('[CCSupabase] User message saved:', userMsg.id)

  // Create dual callbacks that save CC responses and stream chunks
  const callbackSet = createCCResponseCallback(client, conversationId, userId, userMsg.id, onStream)

  const baseOnResponse = callbackSet?.onResponse
  const baseOnStreamingChunk = callbackSet?.onStreamingChunk

  if (typeof baseOnResponse !== 'function') {
    console.error('[CCSupabase] Invalid onResponse callback returned from factory', {
      type: typeof baseOnResponse,
    })
  }

  if (baseOnStreamingChunk && typeof baseOnStreamingChunk !== 'function') {
    console.error('[CCSupabase] Invalid onStreamingChunk callback returned from factory', {
      type: typeof baseOnStreamingChunk,
    })
  }

  const safeOnResponse: OnResponse = async response => {
    if (typeof baseOnResponse === 'function') {
      await baseOnResponse(response)
    }
  }

  const safeOnStreamingChunk: OnStreamingChunk | undefined =
    typeof baseOnStreamingChunk === 'function' ? baseOnStreamingChunk : undefined

  if (process.env.DEBUG_CC_CALLBACKS) {
    console.log('[CCSupabase] Callback factory result', {
      hasOnResponse: typeof baseOnResponse === 'function',
      hasOnStreamingChunk: typeof safeOnStreamingChunk === 'function',
    })
  }

  // Track session ID
  let ccSessionId: string | null = null

  // Wrapper callback to capture session ID
  const wrappedCallback: OnResponse = async (response: CCResponse) => {
    if (response.sessionId) {
      ccSessionId = response.sessionId
    }
    await safeOnResponse(response)
  }

  // Start CC chat with both callbacks
  await startChat(conversationId, userMessage, cwd, wrappedCallback, permissionMode, safeOnStreamingChunk)

  // Update conversation's cwd if provided
  if (cwd && conversation.cwd !== cwd) {
    await client.from('conversations').update({ cwd }).eq('id', conversationId)
  }

  // Touch conversation to update timestamp
  await ConversationService.touch(client, conversationId)

  // Get all messages to return
  const messages = await MessageService.getByConversation(client, conversationId)

  console.log('[CCSupabase] CC chat completed. Session ID:', ccSessionId)

  return {
    conversation: conversation,
    messages,
    sessionId: ccSessionId || 'unknown',
  }
}

/**
 * Resumes an existing CC chat with database persistence
 *
 * This function:
 * 1. Retrieves the last CC session ID from database
 * 2. Verifies conversation exists and user has access
 * 3. Saves user message to database
 * 4. Resumes CC chat with OnResponse callback that saves messages
 * 5. Returns updated conversation state
 *
 * If no session ID found, falls back to starting a new chat.
 *
 * @param options - Chat options including conversation ID, message, cwd, auth
 * @returns Promise with conversation, messages, and session ID
 */
export async function resumeCCChatWithDB(options: CCChatOptions): Promise<CCChatResponse> {
  const { conversationId, userMessage, cwd, userId, jwt, permissionMode = 'default', onStream, sessionId: providedSessionId } = options

  console.log('[CCSupabase] Resuming CC chat with database integration:', {
    conversationId,
    cwd,
    permissionMode,
    providedSessionId,
  })

  // Create authenticated Supabase client
  const client = createAuthenticatedClient(jwt)

  // Verify conversation exists and user has access
  const conversation = await ConversationService.getById(client, conversationId)
  if (!conversation) {
    throw new Error(`Conversation ${conversationId} not found or access denied`)
  }

  // Use provided session ID if available, otherwise look up from database
  let sessionId = providedSessionId

  if (!sessionId) {
    // Get last CC message to retrieve session ID
    const { data: lastCCMessage } = await client
      .from('messages')
      .select('ex_agent_session_id')
      .eq('conversation_id', conversationId)
      .eq('role', 'ex_agent')
      .not('ex_agent_session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    sessionId = lastCCMessage?.ex_agent_session_id
  }

  // If no session found, start new chat instead
  if (!sessionId) {
    console.log('[CCSupabase] No previous CC session found, starting new chat')
    return startCCChatWithDB(options)
  }

  console.log('[CCSupabase] Resuming CC session:', sessionId)

  // Get last message to determine parent ID
  const lastMessage = await MessageService.getLastMessage(client, conversationId)
  const parentId = lastMessage?.id || null

  // Save user message to database
  const userMsg = await saveUserMessage(client, conversationId, userId, userMessage, parentId)

  console.log('[CCSupabase] User message saved:', userMsg.id)

  // Create dual callbacks that save CC responses and stream chunks
  const resumeCallbackSet = createCCResponseCallback(client, conversationId, userId, userMsg.id, onStream)

  const resumeOnResponse = resumeCallbackSet?.onResponse
  const resumeOnStreamingChunk = resumeCallbackSet?.onStreamingChunk

  if (typeof resumeOnResponse !== 'function') {
    console.error('[CCSupabase] Invalid onResponse callback returned from factory (resume)', {
      type: typeof resumeOnResponse,
    })
  }

  if (resumeOnStreamingChunk && typeof resumeOnStreamingChunk !== 'function') {
    console.error('[CCSupabase] Invalid onStreamingChunk callback returned from factory (resume)', {
      type: typeof resumeOnStreamingChunk,
    })
  }

  const safeResumeOnResponse: OnResponse = async response => {
    if (typeof resumeOnResponse === 'function') {
      await resumeOnResponse(response)
    }
  }

  const safeResumeOnStreamingChunk: OnStreamingChunk | undefined =
    typeof resumeOnStreamingChunk === 'function' ? resumeOnStreamingChunk : undefined

  if (process.env.DEBUG_CC_CALLBACKS) {
    console.log('[CCSupabase] Resume callback factory result', {
      hasOnResponse: typeof resumeOnResponse === 'function',
      hasOnStreamingChunk: typeof safeResumeOnStreamingChunk === 'function',
    })
  }

  // Track session ID (might change if session reset)
  let ccSessionId: string = sessionId

  // Wrapper callback to capture session ID
  const wrappedCallback: OnResponse = async (response: CCResponse) => {
    if (response.sessionId) {
      ccSessionId = response.sessionId
    }
    await safeResumeOnResponse(response)
  }

  // Resume CC chat with both callbacks
  await resumeChat(conversationId, userMessage, cwd, wrappedCallback, permissionMode, safeResumeOnStreamingChunk)

  // Update conversation's cwd if provided
  if (cwd && conversation.cwd !== cwd) {
    await client.from('conversations').update({ cwd }).eq('id', conversationId)
  }

  // Touch conversation to update timestamp
  await ConversationService.touch(client, conversationId)

  // Get all messages to return
  const messages = await MessageService.getByConversation(client, conversationId)

  console.log('[CCSupabase] CC chat resumed and completed. Session ID:', ccSessionId)

  return {
    conversation: conversation,
    messages,
    sessionId: ccSessionId,
  }
}

/**
 * Gets the current CC session info for a conversation
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Conversation ID
 * @returns Session info or null if no CC session exists
 */
export async function getCCSessionInfo(
  client: SupabaseClient,
  conversationId: string
): Promise<{
  sessionId: string
  lastMessageAt: string
  messageCount: number
  cwd: string | null
} | null> {
  // Get last CC message
  const { data: lastCCMessage } = await client
    .from('messages')
    .select('ex_agent_session_id, created_at')
    .eq('conversation_id', conversationId)
    .eq('role', 'ex_agent')
    .not('ex_agent_session_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!lastCCMessage?.ex_agent_session_id) {
    return null
  }

  // Count messages in this session
  const { count } = await client
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('ex_agent_session_id', lastCCMessage.ex_agent_session_id)

  // Get conversation cwd
  const conversation = await ConversationService.getById(client, conversationId)

  return {
    sessionId: lastCCMessage.ex_agent_session_id,
    lastMessageAt: lastCCMessage.created_at,
    messageCount: count || 0,
    cwd: conversation?.cwd || null,
  }
}

// ============================================================================
// Exports
// ============================================================================

export type {
  CCChatOptions,
  CCChatResponse,
  ContentBlock,
  ContentBlockSequence,
  SavedCCMessage,
  TextBlock,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
}

export {
  assembleCCContent,
  createCCResponseCallback,
  saveCCMessageToDatabase,
  saveCCMessageToDatabaseAccumulated,
  saveUserMessage,
}
