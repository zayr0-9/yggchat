// This file contains types shared between client and server

// UUID-based ID types for Supabase compatibility
export type MessageId = string
export type ConversationId = string
export type ProjectId = string

export interface BaseMessage {
  id: MessageId
  conversation_id: ConversationId
  role: 'user' | 'assistant'
  thinking_block?: string
  tool_calls?: string
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
}

export interface BaseModel {
  name: string
  version: string
  displayName: string
  description: string
  inputTokenLimit: number
  outputTokenLimit: number
  thinking: boolean
  supportedGenerationMethods: string[]
}

export interface Project {
  id: ProjectId
  name: string
  created_at: string
  updated_at: string
  context: string
  system_prompt: string
}

export interface ProjectWithLatestConversation extends Project {
  latest_conversation_updated_at: string | null
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
