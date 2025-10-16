import { BaseMessage, BaseModel, MessageId, ConversationId } from '../../../../../shared/types'

// Message types (shared with conversations)
export interface Message extends BaseMessage {
  //media: Blob or path to file
  pastedContext: string[]
  artifacts: string[]
  //should write a function which extracts text content
  //when user drags and drops it on the input component
}

export interface miniMessage {
  content: string
  media: Blob | null
}

// Stream-specific types
export interface StreamChunk {
  type: 'chunk' | 'complete' | 'error' | 'user_message' | 'reset' | 'generation_started' | 'tool_call'
  content?: string
  // delta is used for token-level updates from the server
  delta?: string
  // part distinguishes normal text from reasoning tokens from tool calls
  part?: 'text' | 'reasoning' | 'tool_call'
  message?: Message
  error?: string
  // optional iteration index for multi-reply endpoints
  iteration?: number
  messageId?: MessageId
}

export interface StreamState {
  active: boolean
  buffer: string
  // separate buffer for reasoning/thinking tokens while streaming
  thinkingBuffer: string
  // separate buffer for tool call tokens while streaming
  toolCallsBuffer: string
  messageId: MessageId | null
  error: string | null
  finished: boolean
  streamingMessageId: MessageId | null
}

export interface Model extends BaseModel {}

// Model types - simplified to match server
export interface ModelState {
  available: Model[] // Just model names
  selected: Model | null
  default: Model | null // Default model from server
  loading: boolean
  error: string | null
  lastRefresh: number | null
}

export interface Provider {
  name: string
  url: string
  description: string
}

export interface ProviderState {
  providers: Provider[]
  currentProvider: string | null
  loading: boolean
  error: string | null
}

// Message composition types
export interface ImageDraft {
  dataUrl: string
  name: string
  type: string
  size: number
}

export interface MessageInput {
  content: string
  modelOverride?: string
}

export interface CompositionState {
  input: MessageInput
  sending: boolean
  validationError: string | null
  draftMessage: String | null
  multiReplyCount: number
  imageDrafts: ImageDraft[] // base64-encoded images + metadata from drag/drop
  editingBranch: boolean // true when user is editing a branch; controls UI like hiding image drafts
  optimisticMessage: Message | null // temp message for instant UI feedback in web mode only
  optimisticBranchMessage: Message | null // temp branched message for instant UI feedback in web mode only
}

export interface ConversationState {
  currentConversationId: ConversationId | null
  focusedChatMessageId: MessageId | null
  currentPath: MessageId[] // Array of message IDs forming current branch
  messages: Message[] // Linear messages in current path order
  bookmarked: MessageId[] //each index contains id of a message selected
  excludedMessages: MessageId[] //id of each message which are NOT to be sent for chat,
  context: string
}

// Core chat state - ONLY chat concerns
export interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

export interface HeimdallState {
  treeData: ChatNode | null
  loading: boolean
  error: string | null
  compactMode: boolean
  lastFetchedAt: number | null
  lastConversationId: ConversationId | null
}

export interface InitializationState {
  loading: boolean
  error: string | null
  userId: string | null
}

export interface ChatState {
  models: ModelState
  providerState: ProviderState
  composition: CompositionState
  streaming: StreamState
  ui: {
    modelSelectorOpen: boolean
  }
  conversation: ConversationState
  heimdall: HeimdallState
  initialization: InitializationState
  selectedNodes: MessageId[]
  attachments: AttachmentsState
  tools: tools[]
}

// Action payloads
export interface SendMessagePayload {
  conversationId: ConversationId
  input: MessageInput
  parent: MessageId
  repeatNum: number
  think: boolean
  retrigger?: boolean
}

export interface EditMessagePayload {
  conversationId: ConversationId
  originalMessageId: MessageId
  newContent: string
  modelOverride?: string
  systemPrompt?: string
  think: boolean
}

export interface BranchMessagePayload {
  conversationId: ConversationId
  parentId: MessageId
  content: string
  modelOverride?: string
  systemPrompt?: string
  think: boolean
}

export interface ModelSelectionPayload {
  model: Model
  persist?: boolean
}

// Server response types
export interface ModelsResponse {
  models: Model[]
  default: Model
}

// Re-export for backward compatibility if needed
// export type Model = string

// Attachment types (mirror server `Attachment` interface)
export interface Attachment {
  id: MessageId
  message_id: MessageId | null
  kind: 'image'
  mime_type: string
  storage: 'file' | 'url'
  url?: string | null
  file_path?: string | null
  width?: number | null
  height?: number | null
  size_bytes?: number | null
  sha256?: string | null
  created_at: string
}

export interface AttachmentsState {
  byMessage: Record<string, Attachment[]>
  // Backup of deleted image artifacts (as base64 data URLs) per message during branch editing
  backup: Record<string, string[]>
}

export interface tools {
  name: string
  enabled: boolean
  tool: {
    description: string
    inputSchema: any
    execute: any
  }
}
