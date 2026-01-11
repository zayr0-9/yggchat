// OpenAI ChatGPT Streaming Adapter
// Uses ChatGPT backend API with OAuth tokens from user's Plus/Pro subscription
// Runs locally only (Electron mode) for TOS compliance

import { v4 as uuidv4 } from 'uuid'
import { ConversationId, MessageId, ToolDefinition as SharedToolDefinition } from '../../../../../shared/types'
import { ContentBlock, Message, ToolCall } from './chatTypes'
import { CHATGPT_BASE_URL, CHATGPT_CODEX_ENDPOINT, getCodexInstructions, getValidTokens } from './openaiOAuth'
import sysPromptConfig from './sys_prompt.json'
import { getToolsForAI } from './toolDefinitions'

// Map internal ToolDefinition -> OpenAI tool schema
function mapTools(tools: SharedToolDefinition[]) {
  return tools
    .filter(t => t.enabled)
    .map(t => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    }))
}

// Normalize model names to what ChatGPT backend expects
function normalizeModel(model: string): string {
  const m = model.toLowerCase()

  // GPT-5.2 Codex variants
  if (m.includes('gpt-5.2-codex')) return 'gpt-5.2-codex'
  if (m.includes('gpt-5.2')) return 'gpt-5.2'

  // GPT-5.1 variants
  if (m.includes('gpt-5.1-codex-max')) return 'gpt-5.1-codex-max'
  if (m.includes('gpt-5.1-codex-mini')) return 'gpt-5.1-codex-mini'
  if (m.includes('gpt-5.1-codex')) return 'gpt-5.1-codex'
  if (m.includes('gpt-5.1')) return 'gpt-5.1'

  // Legacy GPT-5.0 → GPT-5.1
  if (m.includes('gpt-5-codex-mini') || m.includes('codex-mini-latest')) return 'gpt-5.1-codex-mini'
  if (m.includes('gpt-5-codex')) return 'gpt-5.1-codex'
  if (m.includes('gpt-5')) return 'gpt-5.1'

  // GPT-4o
  if (m.includes('gpt-4o')) return 'gpt-5.1-codex-mini'

  // Default
  return model
}

// Get reasoning configuration based on model
function getReasoningConfig(model: string) {
  const normalized = normalizeModel(model)

  // Codex models default to medium reasoning
  if (normalized.includes('codex')) {
    return {
      effort: 'medium',
      summary: 'auto',
    }
  }

  return {
    effort: 'medium',
    summary: 'auto',
  }
}

// Types for streaming
interface ChatGPTDeltaToolCall {
  index?: number
  id?: string
  type?: 'function'
  function?: {
    name?: string
    arguments?: string
  }
}

interface ChatGPTStreamChunk {
  choices?: Array<{ delta?: any; message?: any; finish_reason?: string | null }>
  id?: string
  type?: string
}

interface ChatGPTResponseOutputItem {
  id?: string
  type?: string
  status?: string
  arguments?: string
  call_id?: string
  name?: string
  output_index?: number
}

// Accumulator for incremental tool call building
interface ToolCallAccumulator {
  id: string
  name: string
  arguments: string
}

// Process incremental tool call deltas and accumulate them
function processToolCallDeltas(
  deltaToolCalls: ChatGPTDeltaToolCall[],
  accumulators: Map<number, ToolCallAccumulator>
): { newToolCalls: ToolCall[]; updatedIndices: number[] } {
  const newToolCalls: ToolCall[] = []
  const updatedIndices: number[] = []

  for (const tc of deltaToolCalls || []) {
    const index = tc.index ?? 0

    if (!accumulators.has(index)) {
      const id = tc.id || uuidv4()
      const name = tc.function?.name || ''
      const args = tc.function?.arguments || ''
      accumulators.set(index, { id, name, arguments: args })

      if (name) {
        newToolCalls.push({ id, name, arguments: args, status: 'pending' })
      }
    } else {
      const acc = accumulators.get(index)!
      if (tc.id) acc.id = tc.id
      if (tc.function?.name) acc.name = tc.function.name
      if (tc.function?.arguments) {
        acc.arguments += tc.function.arguments
      }
      updatedIndices.push(index)
    }
  }

  return { newToolCalls, updatedIndices }
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

export interface OpenAIChatGPTStreamHandlers {
  onChunk: (chunk: any) => void
}

export interface OpenAIChatGPTRequestPayload {
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

function toInputTextContent(content: any): Array<{ type: 'input_text'; text: string }> {
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') {
        return { type: 'input_text', text: item }
      }
      return item
    })
  }
  if (typeof content === 'string') {
    return [{ type: 'input_text', text: content }]
  }
  if (content == null) {
    return []
  }
  return [{ type: 'input_text', text: String(content) }]
}

function toOutputTextContent(content: any): Array<{ type: 'output_text'; text: string }> {
  if (Array.isArray(content)) {
    return content.map(item => {
      if (typeof item === 'string') {
        return { type: 'output_text', text: item }
      }
      if (item && typeof item === 'object' && item.type === 'input_text' && typeof item.text === 'string') {
        return { type: 'output_text', text: item.text }
      }
      return item
    })
  }
  if (typeof content === 'string') {
    return [{ type: 'output_text', text: content }]
  }
  if (content == null) {
    return []
  }
  return [{ type: 'output_text', text: String(content) }]
}

function parseContentBlocks(blocks: any): any[] {
  if (!blocks) return []
  if (Array.isArray(blocks)) return blocks
  if (typeof blocks === 'string') {
    try {
      return JSON.parse(blocks)
    } catch {
      return []
    }
  }
  return []
}

function getToolCallNameAndArgs(tc: any): { name: string; args: any } {
  const name = typeof tc?.name === 'string' ? tc.name : typeof tc?.function?.name === 'string' ? tc.function.name : ''
  const args =
    tc?.arguments !== undefined
      ? tc.arguments
      : tc?.function?.arguments !== undefined
        ? tc.function.arguments
        : undefined
  return { name, args }
}

// Transform messages to ChatGPT backend (responses API) format
function transformMessagesForChatGPT(messages: any[], developerPrompt?: string, codexUserPrompt?: string): any[] {
  const input: any[] = []
  const toolCallIds = new Set<string>()
  const toolOutputIds = new Set<string>()

  if (codexUserPrompt && codexUserPrompt.trim()) {
    input.push({
      type: 'message',
      role: 'user',
      content: toInputTextContent(codexUserPrompt),
    })
  }

  if (developerPrompt && developerPrompt.trim()) {
    input.push({
      type: 'message',
      role: 'developer',
      content: toInputTextContent(developerPrompt),
    })
  }

  // Transform each message
  for (const msg of messages) {
    if (msg.role === 'system') {
      // System prompts are sent via instructions for the Codex backend
      continue
    } else if (msg.role === 'user') {
      input.push({
        type: 'message',
        role: 'user',
        content: toInputTextContent(msg.content),
      })
    } else if (msg.role === 'assistant') {
      const content = toOutputTextContent(msg.content || '')
      if (content.length > 0) {
        input.push({
          type: 'message',
          role: 'assistant',
          content,
        })
      }

      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const { name, args } = getToolCallNameAndArgs(tc)
          if (!name) {
            console.warn('[OpenAI ChatGPT] Skipping tool call without name:', tc)
            continue
          }
          const serializedArgs = typeof args === 'string' ? args : JSON.stringify(args || {})
          toolCallIds.add(tc.id)
          input.push({
            type: 'function_call',
            call_id: tc.id,
            name,
            arguments: serializedArgs,
          })
        }
      }

      const contentBlocks = parseContentBlocks(msg.content_blocks)
      for (const block of contentBlocks) {
        if (block?.type !== 'tool_result') continue
        const callId = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        if (!callId || toolOutputIds.has(callId)) continue
        if (!toolCallIds.has(callId)) continue
        toolOutputIds.add(callId)
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
        })
      }
    } else if (msg.role === 'tool' && msg.tool_call_id) {
      if (toolOutputIds.has(msg.tool_call_id)) {
        continue
      }
      if (!toolCallIds.has(msg.tool_call_id)) {
        continue
      }
      toolOutputIds.add(msg.tool_call_id)
      input.push({
        type: 'function_call_output',
        call_id: msg.tool_call_id,
        output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      })
    }
  }

  return input
}

// Build request body for ChatGPT Codex backend
function buildCodexRequestBody(
  model: string,
  input: any[],
  tools: any[],
  instructions: string,
  reasoningConfig?: { effort?: string; summary?: string }
) {
  const normalizedModel = normalizeModel(model)
  const reasoning = reasoningConfig || getReasoningConfig(model)

  return {
    model: normalizedModel,
    instructions: instructions && instructions.trim() ? instructions : 'You are ChatGPT.',
    input,
    tools: tools.length > 0 ? tools : undefined,
    tool_choice: tools.length > 0 ? 'auto' : undefined,
    // Required for stateless operation with ChatGPT backend
    store: false,
    include: ['reasoning.encrypted_content'],
    // Reasoning configuration
    reasoning: {
      effort: reasoning.effort || 'medium',
      summary: reasoning.summary || 'auto',
    },
    // Stream mode
    stream: true,
  }
}

export async function createOpenAIChatGPTStreamingRequest(
  payload: OpenAIChatGPTRequestPayload,
  handlers: OpenAIChatGPTStreamHandlers
) {
  const { onChunk } = handlers

  // Get valid tokens (refreshes if needed)
  const tokens = await getValidTokens()
  if (!tokens) {
    throw new Error('OpenAI authentication required. Please sign in with your ChatGPT Plus/Pro account.')
  }

  const codexInstructions = await getCodexInstructions(payload.modelName)

  // Get tools
  const allTools = payload.tools || getToolsForAI()
  const tools = mapTools(allTools)

  console.log('[OpenAI ChatGPT] Total tools count:', allTools.length)
  console.log('[OpenAI ChatGPT] Model:', payload.modelName)

  // Transform messages to ChatGPT format
  const input = transformMessagesForChatGPT(payload.messages, payload.systemPrompt, sysPromptConfig.codexUserPrompt)

  // Build request body
  const body = buildCodexRequestBody(payload.modelName, input, tools, codexInstructions, payload.reasoningConfig)

  // Build URL for Codex endpoint
  const url = `${CHATGPT_BASE_URL}${CHATGPT_CODEX_ENDPOINT}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens.accessToken}`,
        'chatgpt-account-id': tokens.accountId,
        'OpenAI-Beta': 'responses=experimental',
        originator: 'opencode',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`ChatGPT API not reachable: ${e instanceof Error ? e.message : String(e)}`)
  }

  if (!res.ok || !res.body) {
    const errorText = await res.text().catch(() => '')
    console.error('[OpenAI ChatGPT] Request failed:', res.status, errorText)

    // Handle usage limits
    if (res.status === 404 || res.status === 429) {
      const lower = errorText.toLowerCase()
      if (lower.includes('usage_limit') || lower.includes('rate_limit')) {
        throw new Error('ChatGPT usage limit reached. Please try again later or check your subscription.')
      }
    }

    throw new Error(`ChatGPT request failed: HTTP ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Accumulators for final message
  let assistantText = ''
  let assistantReasoning = ''
  let assistantMessageId: string | null = null

  // Tool call accumulator for incremental streaming
  const toolCallAccumulators = new Map<number, ToolCallAccumulator>()
  const responseToolCallAccumulators = new Map<string, ToolCallAccumulator & { outputIndex?: number; seq: number }>()
  let responseToolCallSeq = 0

  const addOrUpdateResponseToolCall = (itemId: string, item: ChatGPTResponseOutputItem) => {
    const existing = responseToolCallAccumulators.get(itemId)
    const callId = item.call_id || item.id || itemId
    const name = item.name || existing?.name || ''
    const args = item.arguments ?? existing?.arguments ?? ''
    const outputIndex = typeof item.output_index === 'number' ? item.output_index : existing?.outputIndex

    if (existing) {
      existing.id = callId
      existing.name = name
      existing.arguments = args
      if (outputIndex != null) {
        existing.outputIndex = outputIndex
      }
    } else {
      responseToolCallAccumulators.set(itemId, {
        id: callId,
        name,
        arguments: args,
        outputIndex,
        seq: responseToolCallSeq++,
      })
    }
  }

  const buildFinalToolCalls = (): { toolCalls: ToolCall[]; contentBlocks: ContentBlock[] } => {
    const finalToolCalls: ToolCall[] = []
    const finalContentBlocks: ContentBlock[] = []
    const seen = new Set<string>()

    const responseEntries = Array.from(responseToolCallAccumulators.values()).sort((a, b) => {
      if (typeof a.outputIndex === 'number' && typeof b.outputIndex === 'number') {
        return a.outputIndex - b.outputIndex
      }
      if (typeof a.outputIndex === 'number') return -1
      if (typeof b.outputIndex === 'number') return 1
      return a.seq - b.seq
    })

    for (const acc of responseEntries) {
      let parsedArgs: any = acc.arguments
      try {
        if (acc.arguments) {
          parsedArgs = JSON.parse(acc.arguments)
        }
      } catch {
        // Keep as string
      }

      if (acc.id && !seen.has(acc.id)) {
        seen.add(acc.id)
        finalToolCalls.push({
          id: acc.id,
          name: acc.name,
          arguments: parsedArgs,
          status: 'pending',
        })
        finalContentBlocks.push({
          type: 'tool_use',
          index: finalContentBlocks.length,
          id: acc.id,
          name: acc.name,
          input: parsedArgs,
        })
      }
    }

    toolCallAccumulators.forEach((acc, index) => {
      let parsedArgs: any = acc.arguments
      try {
        if (acc.arguments) {
          parsedArgs = JSON.parse(acc.arguments)
        }
      } catch {
        // Keep as string
      }

      if (acc.id && !seen.has(acc.id)) {
        seen.add(acc.id)
        finalToolCalls.push({
          id: acc.id,
          name: acc.name,
          arguments: parsedArgs,
          status: 'pending',
        })
        finalContentBlocks.push({
          type: 'tool_use',
          index: index,
          id: acc.id,
          name: acc.name,
          input: parsedArgs,
        })
      }
    })

    return { toolCalls: finalToolCalls, contentBlocks: finalContentBlocks }
  }

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

        let parsed: ChatGPTStreamChunk | null = null
        try {
          parsed = JSON.parse(dataStr)
        } catch (e) {
          continue
        }

        if (!parsed) continue

        // Handle response.output_item events (ChatGPT format)
        if (parsed.type === 'response.output_item.added') {
          const item = (parsed as any).item as ChatGPTResponseOutputItem | undefined
          if (item?.type === 'function_call' && item.id) {
            addOrUpdateResponseToolCall(item.id, item)
          }
          continue
        }

        if (parsed.type === 'response.output_text.delta') {
          // Text delta
          const delta = (parsed as any).delta || ''
          if (delta) {
            assistantText += delta
            onChunk({ type: 'chunk', part: 'text', delta })
          }
          continue
        }

        if (parsed.type === 'response.reasoning.delta') {
          // Reasoning delta
          const delta = (parsed as any).delta || ''
          if (delta) {
            assistantReasoning += delta
            onChunk({ type: 'chunk', part: 'reasoning', delta })
          }
          continue
        }

        if (parsed.type === 'response.function_call_arguments.delta') {
          const itemId = (parsed as any).item_id as string | undefined
          const delta = (parsed as any).delta as string | undefined
          if (itemId) {
            const existing = responseToolCallAccumulators.get(itemId)
            if (existing) {
              existing.arguments += delta || ''
            } else {
              responseToolCallAccumulators.set(itemId, {
                id: itemId,
                name: '',
                arguments: delta || '',
                seq: responseToolCallSeq++,
              })
            }
          }
          continue
        }

        if (parsed.type === 'response.function_call_arguments.done') {
          const itemId = (parsed as any).item_id as string | undefined
          const args = (parsed as any).arguments as string | undefined
          if (itemId) {
            const existing = responseToolCallAccumulators.get(itemId)
            if (existing) {
              existing.arguments = args || existing.arguments
            } else {
              responseToolCallAccumulators.set(itemId, {
                id: itemId,
                name: '',
                arguments: args || '',
                seq: responseToolCallSeq++,
              })
            }
          }
          continue
        }

        if (parsed.type === 'response.output_item.done') {
          const item = (parsed as any).item as ChatGPTResponseOutputItem | undefined
          if (item?.type === 'function_call' && item.id) {
            addOrUpdateResponseToolCall(item.id, item)
          }
          continue
        }

        if (parsed.type === 'response.done' || parsed.type === 'response.completed') {
          // Response complete - build final message
          if (!assistantMessageId) assistantMessageId = uuidv4()

          const { toolCalls: finalToolCalls, contentBlocks: finalContentBlocks } = buildFinalToolCalls()

          if (assistantText) {
            finalContentBlocks.unshift({
              type: 'text',
              index: 0,
              content: assistantText,
            })
          }

          if (assistantReasoning) {
            finalContentBlocks.unshift({
              type: 'thinking',
              index: 0,
              content: assistantReasoning,
            })
          }

          const message = buildAssistantMessage({
            id: assistantMessageId,
            conversationId: payload.conversationId,
            parentId: payload.parentId,
            modelName: payload.modelName,
            text: assistantText,
            toolCalls: finalToolCalls,
            contentBlocks: finalContentBlocks,
          })

          if (assistantReasoning) {
            message.thinking_block = assistantReasoning
          }

          if (finalToolCalls.length > 0) {
            console.log(
              '[OpenAI ChatGPT] Parsed tool calls from responses API:',
              finalToolCalls.map(tc => tc.name)
            )
          }

          onChunk({ type: 'complete', message })
          continue
        }

        // Handle OpenAI-style streaming (choices array)
        if (!parsed?.choices || parsed.choices.length === 0) continue

        const choice = parsed.choices[0]
        const delta = choice.delta || choice

        // Tool calls delta
        if (delta?.tool_calls) {
          processToolCallDeltas(delta.tool_calls, toolCallAccumulators)
        }

        // Text delta (OpenAI-style)
        if (delta?.content) {
          const textDelta = typeof delta.content === 'string' ? delta.content : ''
          if (textDelta) {
            assistantText += textDelta
            onChunk({ type: 'chunk', part: 'text', delta: textDelta })
          }
        }

        // Reasoning delta
        if (delta?.reasoning) {
          const reasoningDelta = typeof delta.reasoning === 'string' ? delta.reasoning : ''
          if (reasoningDelta) {
            assistantReasoning += reasoningDelta
            onChunk({ type: 'chunk', part: 'reasoning', delta: reasoningDelta })
          }
        }

        // finish_reason - build final message
        if (choice.finish_reason) {
          if (!assistantMessageId) assistantMessageId = uuidv4()

          const { toolCalls: finalToolCalls, contentBlocks: finalContentBlocks } = buildFinalToolCalls()

          if (assistantText) {
            finalContentBlocks.unshift({
              type: 'text',
              index: 0,
              content: assistantText,
            })
          }

          if (assistantReasoning) {
            finalContentBlocks.unshift({
              type: 'thinking',
              index: 0,
              content: assistantReasoning,
            })
          }

          const message = buildAssistantMessage({
            id: assistantMessageId,
            conversationId: payload.conversationId,
            parentId: payload.parentId,
            modelName: payload.modelName,
            text: assistantText,
            toolCalls: finalToolCalls,
            contentBlocks: finalContentBlocks,
          })

          if (assistantReasoning) {
            message.thinking_block = assistantReasoning
          }

          if (finalToolCalls.length > 0) {
            console.log(
              '[OpenAI ChatGPT] Parsed tool calls from responses API:',
              finalToolCalls.map(tc => tc.name)
            )
          }

          onChunk({ type: 'complete', message })
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
