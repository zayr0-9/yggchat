// This file contains types shared between client and server

// UUID-based ID types for Supabase compatibility
export type MessageId = string
export type ConversationId = string
export type ProjectId = string

export type StorageMode = 'cloud' | 'local'

export interface SelectedFileContent {
  path: string
  relativePath: string
  name?: string
  contents: string
  contentLength: number
  requestId?: number
}

export interface BaseMessage {
  id: MessageId
  conversation_id: ConversationId
  role: 'user' | 'assistant' | 'system' | 'ex_agent' | 'tool'
  thinking_block?: string
  // tool_calls can be string (SQLite) or parsed object/array (Supabase)
  // Frontend handles both formats transparently
  tool_calls?: string | any
  // tool_call_id links tool messages back to the assistant's tool_use block
  tool_call_id?: string | null
  // content_blocks can be string (SQLite) or parsed object/array (Supabase)
  // Structured content with thinking, tool_use, tool_result, text blocks
  content_blocks?: string | any
  content: string
  content_plain_text: string
  parent_id?: MessageId | null
  children_ids: MessageId[]
  created_at: string // ISO timestamp, consistent naming
  updated_at?: string
  model_name: string
  partial: boolean
  // Optional metadata for optimized attachment fetching
  has_attachments?: boolean
  attachments_count?: number
  note?: string
  // External agent fields (for Claude Code, etc.)
  ex_agent_session_id?: string | null
  ex_agent_type?: string | null
}

export interface SendMessageRequest {
  content: string
  messages?: any[]
  modelName?: string
  parentId?: string
  provider?: string
  systemPrompt?: string
  conversationContext?: string | null
  projectContext?: string | null
  think?: boolean
  selectedFiles?: any[]
  retrigger?: boolean
  executionMode?: 'server' | 'client'
  isBranch?: boolean
  attachmentsBase64?: any[]
  storageMode?: StorageMode
  isElectron?: boolean
}

export interface BaseModel {

  // Basic identification
  id: string
  name: string
  displayName: string
  version: string
  description: string

  // Context and limits
  contextLength: number
  maxCompletionTokens: number
  inputTokenLimit: number
  outputTokenLimit: number

  // Pricing
  promptCost: number
  completionCost: number
  requestCost: number

  // Capabilities
  thinking: boolean
  supportsImages: boolean
  supportsWebSearch: boolean
  supportsStructuredOutputs: boolean

  // Modality support - arrays to handle multiple modalities
  inputModalities: string[] // e.g., ['text', 'image'] or ['text']
  outputModalities: string[] // e.g., ['text'] or ['text', 'image']

  // Key parameters with defaults
  defaultTemperature: number | null
  defaultTopP: number | null
  defaultFrequencyPenalty: number | null

  // Provider info
  topProviderContextLength: number | null

  // Free tier eligibility (for UI to disable selection for free users)
  isFreeTier?: boolean
}

export interface Project {
  id: ProjectId
  name: string
  created_at: string
  updated_at: string
  context: string
  system_prompt: string
  storage_mode?: StorageMode
}

export interface ProjectWithLatestConversation extends Project {
  latest_conversation_updated_at: string | null
}

export interface ConversationRecord {
  id: ConversationId
  user_id: string
  project_id?: ProjectId | null
  title: string | null
  model_name: string
  system_prompt: string | null
  conversation_context: string | null
  research_note: string | null
  cwd?: string | null
  created_at: string
  updated_at: string
  storage_mode?: StorageMode
}

export interface ChatSession {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  messageCount: number
}

export interface ChatRequest {
  message: string
  chatId?: string
  model?: string
}

export interface ChatResponse {
  message: BaseMessage
  chatId: string
}

export interface ErrorResponse {
  error: boolean
  message?: string
}

// Linked file content metadata saved per message
export interface MessageFileContent {
  id: MessageId
  message_id: MessageId
  file_name: string
  file_path?: string | null
  relative_path?: string | null
  created_at: string
}
