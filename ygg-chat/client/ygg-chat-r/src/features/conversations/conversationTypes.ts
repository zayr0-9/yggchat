import { BaseModel, ConversationId, ProjectId } from '../../../../../shared/types'

export interface Conversation {
  id: ConversationId
  user_id: string
  title: string | null
  project_id?: ProjectId | null
  created_at: string
  updated_at: string
  system_prompt: string | null
  conversation_context: string | null
}

export interface ConversationsState {
  items: Conversation[]
  loading: boolean
  error: string | null
  activeConversationId: ConversationId | null
  systemPrompt: string | null
  convContext: string | null
  // Recently updated conversations for quick access
  recent: RecentConversationsState
  // Recently used model names (normalized to BaseModel)
  recentModels: RecentModelState
}

export interface RecentConversationsState {
  items: Conversation[]
  loading: boolean
  error: string | null
}

export interface RecentModelState {
  items: BaseModel[]
  loading: boolean
  error: string | null
}
