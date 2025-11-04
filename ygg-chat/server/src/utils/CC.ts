import { query } from '@anthropic-ai/claude-agent-sdk'
import { logMessageStats, parseAssistantMessage } from './CCParser'
import type { CCResponse, OnResponse, OnStreamingChunk } from './CCTypes'

// Session storage: key = "conversationId:cwd" -> SDK sessionId
const sessions = new Map<string, string>()

// Slash command storage: key = "conversationId:cwd" -> array of available commands
const slashCommands = new Map<string, string[]>()

/**
 * Create a composite key for session storage that accounts for working directory
 */
function createSessionKey(conversationId: string, cwd: string): string {
  return `${conversationId}:${cwd}`
}

/**
 * Check if a message is a slash command
 */
function isSlashCommand(message: string): boolean {
  return message.trim().startsWith('/')
}

/**
 * Get available slash commands for a conversation
 */
function getAvailableSlashCommands(conversationId: string, cwd: string): string[] {
  const sessionKey = createSessionKey(conversationId, cwd)
  return slashCommands.get(sessionKey) || []
}

/**
 * Store available slash commands from init message
 */
function storeSlashCommands(conversationId: string, cwd: string, commands: any[]): void {
  const sessionKey = createSessionKey(conversationId, cwd)
  const commandNames = commands.map(cmd => cmd.name || cmd).filter(name => typeof name === 'string')
  if (commandNames.length > 0) {
    slashCommands.set(sessionKey, commandNames)
    console.log(`[CC] Stored ${commandNames.length} slash commands for key "${sessionKey}"`)
  }
}

/**
 * Process an SDK message and emit structured response via callback
 * Detects message type and extracts content appropriately
 * Also emits streaming chunks for real-time delta streaming
 */
async function processSDKMessage(
  message: any,
  onResponse?: OnResponse,
  onStreamingChunk?: OnStreamingChunk
): Promise<string | null> {
  const messageType = message.type

  // Process assistant messages with content parsing
  if (messageType === 'assistant') {
    try {
      const parsed = parseAssistantMessage(
        message.message?.id || message.uuid || 'unknown',
        message.message?.content || [],
        message.message?.stop_reason,
        message.message?.usage
      )

      // Log statistics for debugging
      logMessageStats(parsed)

      // Emit structured response
      if (onResponse) {
        const response: CCResponse = {
          messageType: 'message',
          sessionId: message.session_id,
          timestamp: new Date(),
          messageId: parsed.id,
          message: parsed,
        }
        await onResponse(response)
      }

      return message.session_id
    } catch (error) {
      console.error('[CC] Error parsing assistant message:', error)
      if (onResponse) {
        await onResponse({
          messageType: 'error',
          timestamp: new Date(),
          error: {
            code: 'PARSE_ERROR',
            message: `Failed to parse assistant message: ${error instanceof Error ? error.message : String(error)}`,
          },
        })
      }
    }
    return message.session_id
  }

  // Process tool progress updates
  if (messageType === 'tool_progress') {
    if (onResponse) {
      const response: CCResponse = {
        messageType: 'progress',
        sessionId: message.session_id,
        timestamp: new Date(),
        progress: {
          type: 'tool_progress',
          toolUseId: message.tool_use_id,
          toolName: message.tool_name,
          elapsedTimeSeconds: message.elapsed_time_seconds,
        },
      }
      await onResponse(response)
    }
    return message.session_id
  }

  // Process system messages (init, compact_boundary, hook_response, auth_status)
  if (messageType === 'system') {
    if (onResponse) {
      const response: CCResponse = {
        messageType: 'system',
        sessionId: message.session_id,
        timestamp: new Date(),
        system: {
          subtype: message.subtype,
          ...message,
        },
      }
      await onResponse(response)
    }
    return message.session_id
  }

  // Process result messages (final completion)
  if (messageType === 'result') {
    if (onResponse) {
      const response: CCResponse = {
        messageType: 'result',
        sessionId: message.session_id,
        timestamp: new Date(),
        result: {
          subtype: message.subtype,
          duration_ms: message.duration_ms,
          is_error: message.is_error,
          num_turns: message.num_turns,
          result: message.result,
          errors: message.errors,
        },
      }
      await onResponse(response)
    }
    return message.session_id
  }

  // Process streaming events (partial messages - deltas)
  if (messageType === 'stream_event') {
    // Stream events contain real-time deltas - emit them immediately
    if (onStreamingChunk && message.event) {
      const event = message.event
      const eventType = event.type

      // Handle content block delta events
      if (eventType === 'content_block_delta' && event.delta) {
        const delta = event.delta
        if (delta.type === 'text_delta' && delta.text) {
          // Text content delta
          await onStreamingChunk({
            type: 'content_delta',
            delta: delta.text,
            contentType: 'text',
          })
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          // Extended thinking delta
          await onStreamingChunk({
            type: 'thinking_delta',
            delta: delta.thinking,
            contentType: 'thinking',
          })
        }
      }

      // Handle content block start events (for tool use)
      if (eventType === 'content_block_start' && event.content_block) {
        const block = event.content_block
        if (block.type === 'tool_use') {
          await onStreamingChunk({
            type: 'tool_start',
            toolName: block.name,
            toolId: block.id,
            contentType: 'text',
          })
        }
      }

      // Handle content block stop events (for tool use completion)
      if (eventType === 'content_block_stop') {
        // Tool call has completed
        await onStreamingChunk({
          type: 'tool_end',
          contentType: 'text',
        })
      }

      // Debug logging
      if (process.env.DEBUG_CC_STREAM) {
        console.log('[CC] Stream event processed:', eventType)
      }
    }
    return message.session_id
  }

  // Log unknown message types
  console.log(`[CC] Unhandled message type: ${messageType}`)
  return message.session_id
}

/**
 * Start a new chat with Claude Code Agent SDK
 * Parses responses and emits structured data via callback
 *
 * @param conversationId - Unique conversation identifier
 * @param userMessage - The user's message (can be a regular message or slash command)
 * @param cwd - Working directory context (supports multiple IDE instances)
 * @param onResponse - Optional callback to receive parsed responses
 * @param permissionMode - Optional permission mode ('default', 'plan', 'bypassPermissions', 'acceptEdits'). Defaults to 'default'
 * @param onStreamingChunk - Optional callback to receive streaming chunks for real-time delta emission
 */
async function startChat(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'default',
  onStreamingChunk?: OnStreamingChunk
) {
  const sessionKey = createSessionKey(conversationId, cwd)
  const isCommand = isSlashCommand(userMessage)

  console.log(`[CC] Starting new chat for conversation: ${conversationId}`)
  console.log(`[CC] Working directory: ${cwd}`)
  console.log(`[CC] Permission mode: ${permissionMode}`)
  console.log(`[CC] ${isCommand ? 'Slash command' : 'User message'}: ${userMessage}`)

  try {
    // Create appropriate prompt format based on message type
    let prompt: any
    if (isCommand) {
      // Slash commands are passed as plain strings
      prompt = userMessage
      console.log('[CC] Detected slash command, passing directly to query()')
    } else {
      // Regular messages use the message generator
      async function* generateMessages() {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: userMessage,
          },
        } as any
      }
      prompt = generateMessages() as any
    }

    for await (const message of query({
      prompt: prompt,
      options: {
        cwd: cwd,
        maxTurns: 10,
        permissionMode: permissionMode as any,
        maxThinkingTokens: 1024,
        model: 'claude-haiku-4-5-20251001',
        includePartialMessages: true,
      },
    })) {
      console.log('[CC] Message Type:', (message as any).type)
      console.log('[CC] Full Response:', JSON.stringify(message, null, 2))

      // Process message and emit structured response
      const sessionId = await processSDKMessage(message, onResponse, onStreamingChunk)

      // Capture session ID from response if available
      if (sessionId && !sessions.has(sessionKey)) {
        sessions.set(sessionKey, sessionId)
        console.log(`[CC] Session ID saved for key "${sessionKey}": ${sessionId}`)
      }

      // Capture slash commands from init message
      if (
        (message as any).type === 'system' &&
        (message as any).subtype === 'init' &&
        (message as any).slash_commands
      ) {
        storeSlashCommands(conversationId, cwd, (message as any).slash_commands)
      }

      // Validate cwd from init message
      if ((message as any).type === 'system' && (message as any).subtype === 'init') {
        if ((message as any).cwd !== cwd) {
          console.warn(`[CC] CWD mismatch! Expected: ${cwd}, Got: ${(message as any).cwd}`)
        }
      }
    }
  } catch (error) {
    console.error('[CC] Error in startChat:', error)
    if (onResponse) {
      await onResponse({
        messageType: 'error',
        timestamp: new Date(),
        error: {
          code: 'START_CHAT_ERROR',
          message: `Chat error: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
    throw error
  }
}

/**
 * Resume an existing chat with Claude Code Agent SDK
 * If no session exists, starts a new one
 *
 * @param conversationId - Unique conversation identifier
 * @param userMessage - The user's message (can be a regular message or slash command)
 * @param cwd - Working directory context (must match the original conversation's cwd)
 * @param onResponse - Optional callback to receive parsed responses
 * @param permissionMode - Optional permission mode ('default', 'plan', 'bypassPermissions', 'acceptEdits'). Defaults to 'default'
 * @param onStreamingChunk - Optional callback to receive streaming chunks for real-time delta emission
 */
async function resumeChat(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'default',
  onStreamingChunk?: OnStreamingChunk,
  providedSessionId?: string,
  forkSession?: boolean
) {
  const sessionKey = createSessionKey(conversationId, cwd)
  // Use provided session ID if given, otherwise look it up from sessions map
  let sessionId = providedSessionId || sessions.get(sessionKey)

  // Store provided session ID in the sessions Map so SDK can find it
  if (providedSessionId && !sessions.has(sessionKey)) {
    sessions.set(sessionKey, providedSessionId)
    console.log(`[CC] Registered provided session ID for key "${sessionKey}": ${providedSessionId}`)
  }

  const isCommand = isSlashCommand(userMessage)

  if (!sessionId) {
    console.log(`[CC] No session found for key "${sessionKey}", starting new chat`)
    return startChat(conversationId, userMessage, cwd, onResponse, permissionMode, onStreamingChunk)
  }

  console.log(`[CC] Resuming chat with session: ${sessionId}`)
  console.log(`[CC] Working directory: ${cwd}`)
  console.log(`[CC] Permission mode: ${permissionMode}`)
  console.log(`[CC] Fork session: ${forkSession || false}`)
  console.log(`[CC] ${isCommand ? 'Slash command' : 'User message'}: ${userMessage}`)

  try {
    // Create appropriate prompt format based on message type
    let prompt: any
    if (isCommand) {
      // Slash commands are passed as plain strings
      prompt = userMessage
      console.log('[CC] Detected slash command, passing directly to query()')
    } else {
      // Regular messages use the message generator
      async function* generateMessages() {
        yield {
          type: 'user' as const,
          message: {
            role: 'user' as const,
            content: userMessage,
          },
        } as any
      }
      prompt = generateMessages() as any
    }

    for await (const message of query({
      prompt: prompt,
      options: {
        cwd: cwd,
        maxTurns: 10,
        permissionMode: permissionMode as any,
        resume: sessionId,
        forkSession: forkSession,
        includePartialMessages: true,
      } as any,
    })) {
      console.log('[CC] Message Type:', (message as any).type)
      console.log('[CC] Full Response:', JSON.stringify(message, null, 2))

      // Process message and emit structured response
      await processSDKMessage(message, onResponse, onStreamingChunk)

      // Capture slash commands from init message (in case session was reset)
      if (
        (message as any).type === 'system' &&
        (message as any).subtype === 'init' &&
        (message as any).slash_commands
      ) {
        storeSlashCommands(conversationId, cwd, (message as any).slash_commands)
      }
    }
  } catch (error) {
    console.error('[CC] Error in resumeChat:', error)
    if (onResponse) {
      await onResponse({
        messageType: 'error',
        timestamp: new Date(),
        error: {
          code: 'RESUME_CHAT_ERROR',
          message: `Chat error: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
    throw error
  }
}

// Type exports
export type {
  CCResponse,
  CCStreamChunk,
  OnResponse,
  OnStreamingChunk,
  ParsedContent,
  ParsedMessage,
  ParsedTextContent,
  ParsedThinkingContent,
  ParsedToolResultContent,
  ParsedToolUseContent,
  ToolProgress,
} from './CCTypes'

// Main function exports
export { getAvailableSlashCommands, isSlashCommand, resumeChat, startChat }

// Parser utilities
export {
  extractTextContent,
  extractThinkingContent,
  extractToolCalls,
  getContentStats,
  logMessageStats,
  parseAssistantMessage,
} from './CCParser'
