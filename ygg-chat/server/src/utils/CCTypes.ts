/**
 * Type definitions for Claude Code Agent SDK responses
 * Provides structured types for frontend consumption
 */

/**
 * Text content block - normal assistant responses
 */
export interface ParsedTextContent {
  type: 'text';
  text: string;
  citations?: Array<{
    type: 'char_location' | 'page_location' | 'content_block_location' | 'search_result' | 'web_search_result';
    [key: string]: unknown;
  }>;
}

/**
 * Thinking/reasoning content block - extended thinking responses
 */
export interface ParsedThinkingContent {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

/**
 * Tool use content block - when the assistant wants to call a tool
 */
export interface ParsedToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result content block - result from a tool execution
 */
export interface ParsedToolResultContent {
  type: 'tool_result';
  tool_use_id: string;
  tool_name: string;
  content: string | Record<string, unknown>;
  isError?: boolean;
}

/**
 * Union type for all parseable content types
 */
export type ParsedContent =
  | ParsedTextContent
  | ParsedThinkingContent
  | ParsedToolUseContent
  | ParsedToolResultContent;

/**
 * Parsed assistant message with structured content
 */
export interface ParsedMessage {
  /** Unique message ID */
  id: string;
  /** Type of message content */
  type: 'message';
  /** Array of parsed content blocks */
  content: ParsedContent[];
  /** Stop reason for the message (e.g., 'end_turn', 'tool_use', 'max_tokens') */
  stopReason?: string;
  /** Usage statistics */
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  };
}

/**
 * Tool progress update
 */
export interface ToolProgress {
  type: 'tool_progress';
  toolUseId: string;
  toolName: string;
  elapsedTimeSeconds: number;
}

/**
 * Complete response wrapper from CC functions
 */
export interface CCResponse {
  /** Type of response ('message', 'progress', 'system', 'result', 'error') */
  messageType: 'message' | 'progress' | 'system' | 'result' | 'error';
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Timestamp when response was generated */
  timestamp: Date;
  /** Message ID (if applicable) */
  messageId?: string;
  /** Parsed message data (for 'message' type) */
  message?: ParsedMessage;
  /** Tool progress (for 'progress' type) */
  progress?: ToolProgress;
  /** System message data (for 'system' type) */
  system?: {
    subtype: 'init' | 'compact_boundary' | 'hook_response' | 'auth_status';
    [key: string]: unknown;
  };
  /** Final result (for 'result' type) */
  result?: {
    subtype: 'success' | 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd';
    duration_ms: number;
    is_error: boolean;
    num_turns: number;
    result?: string;
    errors?: string[];
    [key: string]: unknown;
  };
  /** Error details (for 'error' type) */
  error?: {
    code?: string;
    message: string;
  };
}

/**
 * Callback function type for streaming responses
 */
export type OnResponse = (response: CCResponse) => void | Promise<void>;
