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
import { createAuthenticatedClient } from '../database/supamodels'
import { MessageService, ConversationService, Message, Conversation } from '../database/supamodels'
import {
  startChat,
  resumeChat,
  CCResponse,
  OnResponse,
  ParsedMessage,
  ParsedContent,
  ParsedTextContent,
  ParsedThinkingContent,
  ParsedToolUseContent,
  ParsedToolResultContent,
} from './CC'

// ============================================================================
// Type Definitions
// ============================================================================

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
          const citationsText = textBlock.citations
            .map(c => `[Citation: ${c.type} - ${c.title || c.url}]`)
            .join('\n')
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

// ============================================================================
// Callback Factory Functions
// ============================================================================

/**
 * Creates an OnResponse callback that saves CC messages to the database
 *
 * This factory function returns a callback that:
 * - Saves assistant messages to database with ex_agent role
 * - Tracks parent_id for message threading
 * - Forwards all events to optional stream callback
 * - Handles errors gracefully
 *
 * @param client - Authenticated Supabase client
 * @param conversationId - Target conversation ID
 * @param ownerId - User ID
 * @param userMessageId - ID of the user message that triggered CC
 * @param onStream - Optional callback to stream events to client
 * @returns OnResponse callback for CC SDK
 */
function createCCResponseCallback(
  client: SupabaseClient,
  conversationId: string,
  ownerId: string,
  userMessageId: string,
  onStream?: (data: any) => void
): OnResponse {
  // Track the last saved message ID for parent linking
  let lastMessageId: string = userMessageId

  return async (response: CCResponse) => {
    try {
      // Forward all events to stream callback if provided
      if (onStream) {
        onStream(response)
      }

      // Handle different message types
      switch (response.messageType) {
        case 'message': {
          // Save assistant message to database
          if (response.sessionId && response.message) {
            const { message } = await saveCCMessageToDatabase(
              client,
              conversationId,
              ownerId,
              response,
              lastMessageId, // Parent is the user message or last agent message
              response.sessionId
            )

            // Update last message ID for next response in chain
            lastMessageId = message.id
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
          // Final result - log completion
          console.log('[CCSupabase] CC conversation completed:', {
            duration_ms: response.result?.duration_ms,
            num_turns: response.result?.num_turns,
            is_error: response.result?.is_error,
          })
          break
        }

        case 'error': {
          // Error - log and continue (don't break the flow)
          console.error('[CCSupabase] CC error:', response.error)
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

  // Create callback that saves CC responses
  const callback = createCCResponseCallback(client, conversationId, userId, userMsg.id, onStream)

  // Track session ID
  let ccSessionId: string | null = null

  // Wrapper callback to capture session ID
  const wrappedCallback: OnResponse = async (response: CCResponse) => {
    if (response.sessionId) {
      ccSessionId = response.sessionId
    }
    await callback(response)
  }

  // Start CC chat
  await startChat(conversationId, userMessage, cwd, wrappedCallback, permissionMode)

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
  const { conversationId, userMessage, cwd, userId, jwt, permissionMode = 'default', onStream } = options

  console.log('[CCSupabase] Resuming CC chat with database integration:', {
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

  // If no session found, start new chat instead
  if (!lastCCMessage?.ex_agent_session_id) {
    console.log('[CCSupabase] No previous CC session found, starting new chat')
    return startCCChatWithDB(options)
  }

  const sessionId = lastCCMessage.ex_agent_session_id
  console.log('[CCSupabase] Resuming CC session:', sessionId)

  // Get last message to determine parent ID
  const lastMessage = await MessageService.getLastMessage(client, conversationId)
  const parentId = lastMessage?.id || null

  // Save user message to database
  const userMsg = await saveUserMessage(client, conversationId, userId, userMessage, parentId)

  console.log('[CCSupabase] User message saved:', userMsg.id)

  // Create callback that saves CC responses
  const callback = createCCResponseCallback(client, conversationId, userId, userMsg.id, onStream)

  // Track session ID (might change if session reset)
  let ccSessionId: string = sessionId

  // Wrapper callback to capture session ID
  const wrappedCallback: OnResponse = async (response: CCResponse) => {
    if (response.sessionId) {
      ccSessionId = response.sessionId
    }
    await callback(response)
  }

  // Resume CC chat
  await resumeChat(conversationId, userMessage, cwd, wrappedCallback, permissionMode)

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

export type { CCChatOptions, CCChatResponse, SavedCCMessage }

export { assembleCCContent, saveCCMessageToDatabase, saveUserMessage, createCCResponseCallback }
