import { localApi } from '../../utils/api'

export interface ChatHookLineage {
  rootMessageId?: string | null
  ancestorIds?: string[]
  depth?: number | null
  isRoot?: boolean
}

export interface ChatHookLookup {
  localApiBase?: string | null
}

export interface ChatHookTurnContext {
  lastUserMessageId?: string | null
  lastAssistantMessageId?: string | null
}

export type ChatHookEventName = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' | 'Stop'

export interface ChatHookRequest {
  event: ChatHookEventName
  conversationId?: string | null
  streamId?: string | null
  cwd?: string | null
  provider?: string | null
  model?: string | null
  operation?: string | null
  prompt?: string | null
  toolCall?: any
  toolResult?: any
  error?: string | null
  lastAssistantMessage?: string | null
  messageId?: string | null
  parentId?: string | null
  lineage?: ChatHookLineage | null
  lookup?: ChatHookLookup | null
  turn?: ChatHookTurnContext | null
}

export interface ChatHookResult {
  matched: boolean
  hookCount: number
  blocked?: boolean
  reason?: string
  updatedPrompt?: string
  updatedInput?: Record<string, unknown>
  permissionDecision?: 'allow' | 'deny' | 'ask'
  permissionDecisionReason?: string
  additionalContext?: string
  errors?: string[]
}

export async function runChatHook(request: ChatHookRequest): Promise<ChatHookResult> {
  const isElectronMode =
    import.meta.env.VITE_ENVIRONMENT === 'electron' ||
    (typeof __IS_ELECTRON__ !== 'undefined' && __IS_ELECTRON__)

  if (!isElectronMode) {
    return { matched: false, hookCount: 0 }
  }

  try {
    return await localApi.post<ChatHookResult>('/hooks/run', request)
  } catch (error) {
    console.warn('[chatHookClient] Hook execution failed:', error)
    return {
      matched: false,
      hookCount: 0,
      errors: [error instanceof Error ? error.message : String(error)],
    }
  }
}
