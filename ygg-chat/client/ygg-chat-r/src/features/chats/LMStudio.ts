// LMStudio adapter: OpenAI-compatible streaming + models
// Default base URL is LM Studio local server

import { ConversationId, MessageId, ToolDefinition as SharedToolDefinition } from '../../../../../shared/types'
import { v4 as uuidv4 } from 'uuid'
import { getEnabledTools } from './toolDefinitions'
import { ContentBlock, Message, Model, ToolCall } from './chatTypes'

const DEFAULT_LMSTUDIO_BASE = import.meta.env.VITE_LMSTUDIO_BASE || 'http://127.0.0.1:1234'

// Map internal ToolDefinition -> OpenAI tool schema
function mapTools(tools: SharedToolDefinition[]) {
  return tools
    .filter(t => t.enabled)
    .map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema || { type: 'object', properties: {} },
      },
    }))
}

// Fetch LM Studio models
export async function fetchLmStudioModels(baseUrl = DEFAULT_LMSTUDIO_BASE): Promise<Model[]> {
  const res = await fetch(`${baseUrl}/v1/models`)
  if (!res.ok) {
    throw new Error(`LM Studio models fetch failed: HTTP ${res.status}`)
  }
  const data = await res.json()
  // Normalize
  const models = Array.isArray(data?.data) ? data.data : []
  return models.map((m: any) => ({
    id: m.id || m.name || m.model || 'unknown-model',
    name: m.id || m.name || m.model || 'unknown-model',
    displayName: m.id || m.name || m.model || 'LM Studio Model',
    version: m.version || 'local',
    description: m.description || 'LM Studio local model',
    contextLength: m.context_length || m.contextLength || m.max_context_tokens || 4096,
    maxCompletionTokens: m.max_completion_tokens || m.context_length || m.contextLength || 4096,
    inputTokenLimit: m.context_length || m.contextLength || 4096,
    outputTokenLimit: m.max_completion_tokens || 2048,
    promptCost: 0,
    completionCost: 0,
    requestCost: 0,
    thinking: false,
    supportsImages: false,
    supportsWebSearch: false,
    supportsStructuredOutputs: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    defaultTemperature: null,
    defaultTopP: null,
    defaultFrequencyPenalty: null,
    topProviderContextLength: null,
    isFreeTier: true,
  }))
}

// Types for streaming
interface LmStudioDeltaToolCall {
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

interface LmStudioStreamChunk {
  choices?: Array<{ delta?: any; message?: any; finish_reason?: string | null }>
}

// Map OpenAI-like tool_calls delta to internal ToolCall
function mapToolCallsFromDelta(deltaToolCalls: LmStudioDeltaToolCall[]): ToolCall[] {
  const result: ToolCall[] = []
  for (const tc of deltaToolCalls || []) {
    const id = tc.id || uuidv4()
    const name = tc.function?.name || 'unknown_tool'
    const args = tc.function?.arguments || ''
    result.push({ id, name, arguments: args, status: 'pending' })
  }
  return result
}

// Build final Message from accumulated parts
function buildAssistantMessage(params: {
  id: string
  conversationId: ConversationId
  parentId: MessageId | null
  modelName: string
  text: string
  toolCalls: ToolCall[]
  contentBlocks: ContentBlock[]
}): Message {
  const { id, conversationId, parentId, modelName, text, toolCalls, contentBlocks } = params
  return {
    id,
    conversation_id: conversationId,
    parent_id: parentId,
    children_ids: [],
    role: 'assistant',
    content: text,
    content_plain_text: text,
    thinking_block: '',
    tool_calls: toolCalls,
    model_name: modelName,
    partial: false,
    created_at: new Date().toISOString(),
    artifacts: [],
    pastedContext: [],
    content_blocks: contentBlocks,
  }
}

export interface LmStudioStreamHandlers {
  onChunk: (chunk: any) => void
}

export interface LmStudioRequestPayload {
  conversationId: ConversationId
  parentId: MessageId | null
  modelName: string
  systemPrompt: string
  messages: any[] // OpenAI-like messages
  attachmentsBase64?: any[] | null
  selectedFiles?: any[] | null
  think?: boolean
  imageConfig?: any
  reasoningConfig?: any
  tools?: SharedToolDefinition[]
}

export async function createLmStudioStreamingRequest(
  payload: LmStudioRequestPayload,
  handlers: LmStudioStreamHandlers,
  baseUrl = DEFAULT_LMSTUDIO_BASE
) {
  const { onChunk } = handlers
  const tools = mapTools(payload.tools || getEnabledTools())

  const body: any = {
    model: payload.modelName,
    stream: true,
    messages: payload.messages,
    tools,
    tool_choice: 'auto',
  }

  let res: Response
  try {
    res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`LM Studio not reachable at ${baseUrl}: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!res.ok || !res.body) {
    throw new Error(`LM Studio request failed: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulators for final message
  let assistantText = ''
  let assistantToolCalls: ToolCall[] = []
  const contentBlocks: ContentBlock[] = []
  let assistantMessageId: string | null = null

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') {
          continue
        }

        let parsed: LmStudioStreamChunk | null = null
        try {
          parsed = JSON.parse(dataStr)
        } catch (e) {
          continue
        }
        if (!parsed?.choices || parsed.choices.length === 0) continue

        const choice = parsed.choices[0]
        const delta = choice.delta || choice

        // Tool calls delta
        if (delta?.tool_calls) {
          const newToolCalls = mapToolCallsFromDelta(delta.tool_calls)
          for (const tc of newToolCalls) {
            const exists = assistantToolCalls.some(t => t.id === tc.id)
            if (!exists) {
              assistantToolCalls.push(tc)
              contentBlocks.push({
                type: 'tool_use',
                index: contentBlocks.length,
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })
              onChunk({ type: 'chunk', part: 'tool_call', toolCall: tc })
            }
          }
        }

        // Text delta (OpenAI-style delta.content)
        if (delta?.content) {
          const textDelta = typeof delta.content === 'string' ? delta.content : ''
          if (textDelta) {
            assistantText += textDelta
            onChunk({ type: 'chunk', part: 'text', delta: textDelta })
          }
        }

        // finish_reason
        if (choice.finish_reason) {
          if (!assistantMessageId) assistantMessageId = uuidv4()
          const message = buildAssistantMessage({
            id: assistantMessageId,
            conversationId: payload.conversationId,
            parentId: payload.parentId,
            modelName: payload.modelName,
            text: assistantText,
            toolCalls: assistantToolCalls,
            contentBlocks,
          })
          onChunk({ type: 'complete', message })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
