/**
 * Claude Code Integration for Electron Local Server
 *
 * Handles CC execution with path detection:
 * - WSL native paths (/home/..., /usr/...) -> Use SDK directly (installed in WSL)
 * - Windows paths (C:\..., /mnt/c/...) -> Use native Windows claude CLI
 */

import { spawn } from 'child_process'

// ============================================================================
// Type Definitions (from server CCTypes.ts)
// ============================================================================

export interface ParsedTextContent {
  type: 'text'
  text: string
  citations?: Array<{
    type: 'char_location' | 'page_location' | 'content_block_location' | 'search_result' | 'web_search_result'
    [key: string]: unknown
  }>
}

export interface ParsedThinkingContent {
  type: 'thinking'
  thinking: string
  signature?: string
}

export interface ParsedToolUseContent {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface ParsedToolResultContent {
  type: 'tool_result'
  tool_use_id: string
  tool_name: string
  content: string | Record<string, unknown>
  isError?: boolean
}

export type ParsedContent = ParsedTextContent | ParsedThinkingContent | ParsedToolUseContent | ParsedToolResultContent

export interface ParsedMessage {
  id: string
  type: 'message'
  content: ParsedContent[]
  stopReason?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens?: number
    cacheCreationInputTokens?: number
  }
}

export interface ToolProgress {
  type: 'tool_progress'
  toolUseId: string
  toolName: string
  elapsedTimeSeconds: number
}

export interface CCResponse {
  messageType: 'message' | 'progress' | 'system' | 'result' | 'error'
  sessionId?: string
  timestamp: Date
  messageId?: string
  message?: ParsedMessage
  progress?: ToolProgress
  system?: {
    subtype: 'init' | 'compact_boundary' | 'hook_response' | 'auth_status'
    [key: string]: unknown
  }
  result?: {
    subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
    duration_ms: number
    is_error: boolean
    num_turns: number
    result?: string
    errors?: string[]
    [key: string]: unknown
  }
  error?: {
    code?: string
    message: string
  }
}

export type OnResponse = (response: CCResponse) => void | Promise<void>

export interface CCStreamChunk {
  type: 'content_delta' | 'thinking_delta' | 'tool_start' | 'tool_end' | 'tool_progress'
  delta?: string
  toolName?: string
  toolId?: string
  contentType: 'text' | 'thinking'
}

export type OnStreamingChunk = (chunk: CCStreamChunk) => void | Promise<void>

// ============================================================================
// Path Detection
// ============================================================================

/**
 * Check if a path is a WSL native path (not a Windows mount)
 * WSL native: /home/..., /usr/..., /etc/..., /var/...
 * Windows mount: /mnt/c/..., /mnt/d/...
 */
export function isWSLPath(cwd: string): boolean {
  if (!cwd) return false
  // Must start with / but NOT /mnt/ (Windows drive mounts)
  return cwd.startsWith('/') && !cwd.startsWith('/mnt/')
}

/**
 * Check if a path is a Windows path
 */
export function isWindowsPath(cwd: string): boolean {
  if (!cwd) return false
  // C:\..., D:\..., or /mnt/c/..., /mnt/d/...
  return /^[A-Za-z]:[\\/]/.test(cwd) || cwd.startsWith('/mnt/')
}

/**
 * Convert /mnt/c/... to C:\... for Windows CLI
 */
export function wslMountToWindowsPath(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])\/(.*)$/)
  if (match) {
    const drive = match[1].toUpperCase()
    const rest = match[2].replace(/\//g, '\\')
    return `${drive}:\\${rest}`
  }
  return wslPath
}

// ============================================================================
// Session Management
// ============================================================================

// Session storage: key = "conversationId:cwd" -> SDK sessionId
const sessions = new Map<string, string>()

// Slash command storage
const slashCommands = new Map<string, string[]>()

function createSessionKey(conversationId: string, cwd: string): string {
  return `${conversationId}:${cwd}`
}

export function getSession(conversationId: string, cwd: string): string | undefined {
  return sessions.get(createSessionKey(conversationId, cwd))
}

export function setSession(conversationId: string, cwd: string, sessionId: string): void {
  sessions.set(createSessionKey(conversationId, cwd), sessionId)
}

export function getAvailableSlashCommands(conversationId: string, cwd: string): string[] {
  return slashCommands.get(createSessionKey(conversationId, cwd)) || []
}

function storeSlashCommands(conversationId: string, cwd: string, commands: any[]): void {
  const sessionKey = createSessionKey(conversationId, cwd)
  const commandNames = commands.map(cmd => cmd.name || cmd).filter(name => typeof name === 'string')
  if (commandNames.length > 0) {
    slashCommands.set(sessionKey, commandNames)
    // console.log(`[ClaudeCode] Stored ${commandNames.length} slash commands for key "${sessionKey}"`)
  }
}

// ============================================================================
// Parser Functions (from server CCParser.ts)
// ============================================================================

function isTextBlock(block: any): block is { type: 'text'; text: string; citations?: any[] } {
  return block && block.type === 'text' && typeof block.text === 'string'
}

function isThinkingBlock(block: any): block is { type: 'thinking'; thinking: string; signature?: string } {
  return block && block.type === 'thinking' && typeof block.thinking === 'string'
}

function isToolUseBlock(block: any): block is { type: 'tool_use'; id: string; name: string; input: unknown } {
  return (
    block &&
    block.type === 'tool_use' &&
    typeof block.id === 'string' &&
    typeof block.name === 'string' &&
    block.input !== undefined
  )
}

function isToolResultBlock(block: any): boolean {
  if (!block || !block.type) return false
  const toolResultTypes = [
    'tool_result',
    'bash_code_execution_tool_result',
    'code_execution_tool_result',
    'text_editor_code_execution_tool_result',
    'web_search_tool_result',
    'web_fetch_tool_result',
  ]
  return toolResultTypes.includes(block.type)
}

function extractToolResultContent(block: any): ParsedToolResultContent | null {
  if (!block || !isToolResultBlock(block)) return null

  const toolUseId = block.tool_use_id || ''
  const toolName = block.tool_name || ''
  let content: string | Record<string, unknown> = ''
  let isError = false

  if (block.type === 'bash_code_execution_tool_result' || block.type === 'code_execution_tool_result') {
    if (
      block.content?.type === 'bash_code_execution_tool_result_error' ||
      block.content?.type === 'code_execution_tool_result_error'
    ) {
      isError = true
      content = {
        errorCode: block.content.error_code || block.content.errorCode,
        message: `Tool execution failed: ${block.content.error_code || 'unknown error'}`,
      }
    } else {
      content = {
        stdout: block.stdout || '',
        stderr: block.stderr || '',
        returnCode: block.return_code || 0,
      }
    }
  } else if (block.type === 'text_editor_code_execution_tool_result') {
    content = {
      result: block.content?.result || block.result || '',
      file: block.content?.file || '',
    }
  } else if (block.type === 'web_search_tool_result') {
    content = { results: block.content || [] }
  } else if (block.type === 'web_fetch_tool_result') {
    if (block.content?.type === 'web_fetch_tool_result_error') {
      isError = true
      content = {
        errorCode: block.content.error_code,
        message: `Web fetch failed: ${block.content.error_code}`,
      }
    } else {
      content = block.content || {}
    }
  } else {
    content = block.content || block
  }

  return { type: 'tool_result', tool_use_id: toolUseId, tool_name: toolName, content, isError }
}

function parseContentBlock(block: any): ParsedContent | null {
  if (!block) return null

  if (isTextBlock(block)) {
    const parsed: ParsedTextContent = { type: 'text', text: block.text }
    if (block.citations && block.citations.length > 0) {
      parsed.citations = block.citations
    }
    return parsed
  }

  if (isThinkingBlock(block)) {
    return { type: 'thinking', thinking: block.thinking, signature: block.signature } as ParsedThinkingContent
  }

  if (isToolUseBlock(block)) {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input } as ParsedToolUseContent
  }

  const toolResult = extractToolResultContent(block)
  if (toolResult) return toolResult

  if (block.type) {
    console.log(`[ClaudeCode] Unhandled content block type: ${block.type}`)
  }

  return null
}

export function parseAssistantMessage(
  messageId: string,
  content: any[],
  stopReason?: string,
  usage?: any
): ParsedMessage {
  const parsedContent: ParsedContent[] = []

  if (Array.isArray(content)) {
    for (const block of content) {
      const parsed = parseContentBlock(block)
      if (parsed) parsedContent.push(parsed)
    }
  }

  const message: ParsedMessage = {
    id: messageId,
    type: 'message',
    content: parsedContent,
    stopReason: stopReason,
  }

  if (usage) {
    message.usage = {
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
    }
  }

  return message
}

export function logMessageStats(message: ParsedMessage): void {
  const stats = {
    textBlocks: message.content.filter(c => c.type === 'text').length,
    thinkingBlocks: message.content.filter(c => c.type === 'thinking').length,
    toolUseBlocks: message.content.filter(c => c.type === 'tool_use').length,
    toolResultBlocks: message.content.filter(c => c.type === 'tool_result').length,
  }
  console.log(`[ClaudeCode] Message ID: ${message.id}`)
  console.log(
    `[ClaudeCode] Content blocks: text=${stats.textBlocks}, thinking=${stats.thinkingBlocks}, tool_use=${stats.toolUseBlocks}, tool_result=${stats.toolResultBlocks}`
  )
  if (message.usage) {
    console.log(`[ClaudeCode] Usage: input=${message.usage.inputTokens}, output=${message.usage.outputTokens}`)
  }
}

// ============================================================================
// SDK Message Processing
// ============================================================================

async function processSDKMessage(
  message: any,
  conversationId: string,
  cwd: string,
  onResponse?: OnResponse,
  onStreamingChunk?: OnStreamingChunk
): Promise<string | null> {
  const messageType = message.type

  if (messageType === 'assistant') {
    try {
      const parsed = parseAssistantMessage(
        message.message?.id || message.uuid || 'unknown',
        message.message?.content || [],
        message.message?.stop_reason,
        message.message?.usage
      )
      // logMessageStats(parsed)

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
      console.error('[ClaudeCode] Error parsing assistant message:', error)
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

  if (messageType === 'user') {
    const contentBlocks = message.message?.content
    const hasToolResultBlock =
      Array.isArray(contentBlocks) && contentBlocks.some((block: any) => block?.type === 'tool_result')

    if (hasToolResultBlock) {
      try {
        const blocks = contentBlocks as any[]
        const generatedId =
          message.message?.id ||
          blocks.find((block: any) => typeof block?.tool_use_id === 'string')?.tool_use_id ||
          message.uuid ||
          `tool-result-${Date.now()}`

        const parsed = parseAssistantMessage(generatedId, blocks, message.message?.stop_reason, message.message?.usage)

        if (onResponse) {
          await onResponse({
            messageType: 'message',
            sessionId: message.session_id,
            timestamp: new Date(),
            messageId: parsed.id,
            message: parsed,
          })
        }
        return message.session_id
      } catch (error) {
        console.error('[ClaudeCode] Error parsing user tool_result message:', error)
      }
    }
    return message.session_id
  }

  if (messageType === 'tool_progress') {
    if (onResponse) {
      await onResponse({
        messageType: 'progress',
        sessionId: message.session_id,
        timestamp: new Date(),
        progress: {
          type: 'tool_progress',
          toolUseId: message.tool_use_id,
          toolName: message.tool_name,
          elapsedTimeSeconds: message.elapsed_time_seconds,
        },
      })
    }
    return message.session_id
  }

  if (messageType === 'system') {
    if (onResponse) {
      await onResponse({
        messageType: 'system',
        sessionId: message.session_id,
        timestamp: new Date(),
        system: { subtype: message.subtype, ...message },
      })
    }
    // Store slash commands from init
    if (message.subtype === 'init' && message.slash_commands) {
      storeSlashCommands(conversationId, cwd, message.slash_commands)
    }
    return message.session_id
  }

  if (messageType === 'result') {
    // console.log('[ClaudeCode] RAW RESULT MESSAGE:', JSON.stringify(message, null, 2))

    // if (message.result) {
    //   console.log('[ClaudeCode] Result received:', {
    //     subtype: message.subtype,
    //     is_error: message.is_error,
    //     has_result_output: !!message.result,
    //     result_length: message.result?.length || 0,
    //   })
    // }

    if (onResponse) {
      await onResponse({
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
      })
    }
    return message.session_id
  }

  if (messageType === 'stream_event') {
    if (onStreamingChunk && message.event) {
      const event = message.event
      const eventType = event.type

      if (eventType === 'content_block_delta' && event.delta) {
        const delta = event.delta
        if (delta.type === 'text_delta' && delta.text) {
          await onStreamingChunk({ type: 'content_delta', delta: delta.text, contentType: 'text' })
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          await onStreamingChunk({ type: 'thinking_delta', delta: delta.thinking, contentType: 'thinking' })
        }
      }

      if (eventType === 'content_block_start' && event.content_block) {
        const block = event.content_block
        if (block.type === 'tool_use') {
          await onStreamingChunk({ type: 'tool_start', toolName: block.name, toolId: block.id, contentType: 'text' })
        }
      }

      if (eventType === 'content_block_stop') {
        await onStreamingChunk({ type: 'tool_end', contentType: 'text' })
      }
    }
    return message.session_id
  }

  console.log(`[ClaudeCode] Unhandled message type: ${messageType}`)
  return message.session_id
}

// ============================================================================
// Execution Functions
// ============================================================================

function isSlashCommand(message: string): boolean {
  return message.trim().startsWith('/')
}

/**
 * Execute Claude Code using the WSL SDK (for WSL native paths)
 */
export async function executeClaudeCodeWSL(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'bypassPermissions',
  onStreamingChunk?: OnStreamingChunk,
  sessionId?: string,
  forkSession?: boolean
): Promise<string | null> {
  const sessionKey = createSessionKey(conversationId, cwd)
  const isCommand = isSlashCommand(userMessage)
  const existingSessionId = sessionId || sessions.get(sessionKey)

  // console.log(`[ClaudeCode] Executing via WSL SDK`)
  // console.log(`[ClaudeCode] Working directory: ${cwd}`)
  // console.log(`[ClaudeCode] Permission mode: ${permissionMode}`)
  // console.log(`[ClaudeCode] Session ID: ${existingSessionId || 'new'}`)
  // console.log(`[ClaudeCode] ${isCommand ? 'Slash command' : 'User message'}: ${userMessage}`)

  try {
    const { query } = await import('@anthropic-ai/claude-agent-sdk')

    let prompt: any
    if (isCommand) {
      prompt = userMessage
    } else {
      const generateMessages = async function* () {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: userMessage },
        } as any
      }
      prompt = generateMessages() as any
    }

    const options: any = {
      cwd: cwd,
      maxTurns: 10,
      permissionMode: permissionMode,
      maxThinkingTokens: 1024,
      model: 'claude-haiku-4-5-20251001',
      includePartialMessages: true,
    }

    if (existingSessionId) {
      options.resume = existingSessionId
      if (forkSession) options.forkSession = true
    }

    let capturedSessionId: string | null = null

    for await (const message of query({ prompt, options })) {
      // console.log('[ClaudeCode] Message Type:', (message as any).type)

      const msgSessionId = await processSDKMessage(message, conversationId, cwd, onResponse, onStreamingChunk)

      if (msgSessionId && !sessions.has(sessionKey)) {
        sessions.set(sessionKey, msgSessionId)
        capturedSessionId = msgSessionId
        // console.log(`[ClaudeCode] Session ID saved: ${msgSessionId}`)
      }
    }

    return capturedSessionId || existingSessionId || null
  } catch (error) {
    console.error('[ClaudeCode] Error in WSL execution:', error)
    if (onResponse) {
      await onResponse({
        messageType: 'error',
        timestamp: new Date(),
        error: {
          code: 'WSL_EXECUTION_ERROR',
          message: `WSL execution error: ${error instanceof Error ? error.message : String(error)}`,
        },
      })
    }
    throw error
  }
}

/**
 * Execute Claude Code using native Windows CLI (for Windows paths)
 */
export async function executeClaudeCodeWindows(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'bypassPermissions',
  onStreamingChunk?: OnStreamingChunk,
  sessionId?: string,
  forkSession?: boolean
): Promise<string | null> {
  const sessionKey = createSessionKey(conversationId, cwd)
  const existingSessionId = sessionId || sessions.get(sessionKey)

  // Convert /mnt/c/... to C:\... if needed
  const windowsCwd = cwd.startsWith('/mnt/') ? wslMountToWindowsPath(cwd) : cwd

  // console.log(`[ClaudeCode] Executing via Windows CLI`)
  // console.log(`[ClaudeCode] Working directory: ${windowsCwd}`)
  // console.log(`[ClaudeCode] Permission mode: ${permissionMode}`)
  // console.log(`[ClaudeCode] Session ID: ${existingSessionId || 'new'}`)

  return new Promise((resolve, reject) => {
    const args = ['--print', '--output-format', 'stream-json']

    if (existingSessionId) {
      args.push('--resume', existingSessionId)
      if (forkSession) args.push('--fork')
    }

    // Add permission mode
    if (permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions')
    }

    args.push(userMessage)

    console.log(`[ClaudeCode] Spawning: claude ${args.join(' ')}`)

    const proc = spawn('claude', args, {
      cwd: windowsCwd,
      shell: true,
      env: { ...process.env },
    })

    let capturedSessionId: string | null = null
    let buffer = ''

    proc.stdout.on('data', async (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const message = JSON.parse(line)
          const msgSessionId = await processSDKMessage(message, conversationId, cwd, onResponse, onStreamingChunk)

          if (msgSessionId && !capturedSessionId) {
            capturedSessionId = msgSessionId
            sessions.set(sessionKey, msgSessionId)
          }
        } catch (e) {
          // Non-JSON line, might be progress output
          console.log('[ClaudeCode] Non-JSON output:', line)
        }
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      console.error('[ClaudeCode] stderr:', data.toString())
    })

    proc.on('close', code => {
      // Process any remaining buffer
      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer)
          processSDKMessage(message, conversationId, cwd, onResponse, onStreamingChunk)
        } catch (e) {
          // Ignore
        }
      }

      if (code === 0) {
        resolve(capturedSessionId || existingSessionId || null)
      } else {
        const error = new Error(`Claude CLI exited with code ${code}`)
        if (onResponse) {
          onResponse({
            messageType: 'error',
            timestamp: new Date(),
            error: { code: 'CLI_EXIT_ERROR', message: error.message },
          })
        }
        reject(error)
      }
    })

    proc.on('error', error => {
      console.error('[ClaudeCode] Process error:', error)
      if (onResponse) {
        onResponse({
          messageType: 'error',
          timestamp: new Date(),
          error: { code: 'CLI_SPAWN_ERROR', message: error.message },
        })
      }
      reject(error)
    })
  })
}

/**
 * Unified execution function that routes to WSL SDK or Windows CLI based on path
 */
export async function executeClaudeCode(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'bypassPermissions',
  onStreamingChunk?: OnStreamingChunk,
  sessionId?: string,
  forkSession?: boolean
): Promise<string | null> {
  if (isWSLPath(cwd)) {
    // console.log('[ClaudeCode] Detected WSL path, using SDK')
    return executeClaudeCodeWSL(
      conversationId,
      userMessage,
      cwd,
      onResponse,
      permissionMode,
      onStreamingChunk,
      sessionId,
      forkSession
    )
  } else {
    // console.log('[ClaudeCode] Detected Windows path, using CLI')
    return executeClaudeCodeWindows(
      conversationId,
      userMessage,
      cwd,
      onResponse,
      permissionMode,
      onStreamingChunk,
      sessionId,
      forkSession
    )
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export async function startChat(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'bypassPermissions',
  onStreamingChunk?: OnStreamingChunk
): Promise<string | null> {
  return executeClaudeCode(conversationId, userMessage, cwd, onResponse, permissionMode, onStreamingChunk)
}

export async function resumeChat(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnResponse,
  permissionMode: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits' = 'bypassPermissions',
  onStreamingChunk?: OnStreamingChunk,
  sessionId?: string,
  forkSession?: boolean
): Promise<string | null> {
  return executeClaudeCode(
    conversationId,
    userMessage,
    cwd,
    onResponse,
    permissionMode,
    onStreamingChunk,
    sessionId,
    forkSession
  )
}
