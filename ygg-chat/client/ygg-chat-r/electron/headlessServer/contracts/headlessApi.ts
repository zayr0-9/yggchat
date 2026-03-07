export type HeadlessChatOperation = 'send' | 'repeat' | 'branch' | 'edit-branch'

export interface HeadlessMessageRequest {
  operation: HeadlessChatOperation
  conversationId: string
  parentId: string | null
  messageId?: string | null
  content: string
  provider: string
  modelName: string
  userId?: string | null
  accessToken?: string | null
  accountId?: string | null
  systemPrompt?: string | null
  storageMode?: 'local' | 'cloud'
  selectedFiles?: any[]
  attachmentsBase64?: any[] | null
  tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, any> }>
  rootPath?: string | null
  operationMode?: 'plan' | 'execute'
  streamId?: string | null
  toolTimeoutMs?: number
}

export type HeadlessStreamEvent =
  | {
      type: 'started'
      operation: HeadlessChatOperation
      conversationId: string
      parentId: string | null
      provider: string
      modelName: string
    }
  | { type: 'user_message_persisted'; message: any }
  | { type: 'provider_routed'; provider: string; modelName: string }
  | {
      type: 'tool_loop'
      status: 'turn_started' | 'turn_completed' | 'max_turns_reached'
      turn: number
      maxTurns: number
      continued?: boolean
    }
  | {
      type: 'tool_execution'
      status: 'started' | 'completed' | 'failed'
      toolCallId: string
      toolName: string
      durationMs?: number
      error?: string
    }
  | { type: 'chunk'; part: 'text' | 'reasoning'; delta: string }
  | { type: 'chunk'; part: 'tool_call'; toolCall: any }
  | { type: 'chunk'; part: 'tool_result'; toolResult: any }
  | { type: 'assistant_message_persisted'; message: any }
  | { type: 'complete'; message: any }
  | { type: 'error'; error: string }
