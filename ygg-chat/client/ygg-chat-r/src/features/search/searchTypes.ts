// searchTypes.ts
// Define types for the search feature

import { ConversationId } from '../../../../../shared/types'

export interface SearchHistoryItem {
  id: string // uuid timestamp or similar
  query: string
  timestamp: number
}

export interface SearchResult {
  conversationId: ConversationId
  messageId: string
  content: string
  createdAt: string
  highlighted?: string
  conversationTitle?: string
}

export interface SearchState {
  query: string
  results: SearchResult[]
  history: SearchHistoryItem[]
  loading: boolean
  error: string | null
  // When user selects a result we store it so chat screen can scroll/focus
  focusedMessageId: string | null
  focusedConversationId: ConversationId | null
}
