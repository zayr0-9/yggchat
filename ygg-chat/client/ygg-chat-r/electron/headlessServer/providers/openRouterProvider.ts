import { buildToolNameMap, sanitizeToolResultContentForModel } from './toolResultSanitizer.js'

export interface ProviderToolDefinition {
  name: string
  description?: string
  inputSchema?: Record<string, any>
}

export interface ProviderGenerateInput {
  modelName: string
  systemPrompt?: string | null
  history: any[]
  userContent: string
  userId?: string | null
  accessToken?: string | null
  accountId?: string | null
  tools?: ProviderToolDefinition[]
}

export interface ProviderToolCall {
  id: string
  name: string
  arguments: any
  status?: 'pending' | 'executing' | 'complete'
  result?: string
}

export interface ProviderGenerateOutput {
  content: string
  reasoning?: string
  toolCalls?: ProviderToolCall[]
  contentBlocks?: any[]
  raw?: any
}

export interface HeadlessProvider {
  name: string
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput>
}

interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

function parseJson(value: any, fallback: any): any {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return fallback
    }
  }
  return value
}

function parseContentBlocks(value: any): any[] {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function parseToolCalls(value: any): any[] {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed : []
}

function asText(value: any): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item
        if (item?.type === 'text' && typeof item?.text === 'string') return item.text
        if (typeof item?.content === 'string') return item.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (value == null) return ''
  return String(value)
}

function toOpenRouterToolSchema(tools?: ProviderToolDefinition[]): any[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined

  const mapped = tools
    .filter(tool => tool?.name)
    .map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.inputSchema || { type: 'object', properties: {} },
      },
    }))

  return mapped.length ? mapped : undefined
}

function appendToolOutputsFromBlocks(
  messages: OpenRouterChatMessage[],
  assistantMsg: any,
  fallbackToolNameById: Map<string, string>
): void {
  const toolCalls = parseToolCalls(assistantMsg?.tool_calls)
  const callNames = new Map<string, string>()

  for (const call of toolCalls) {
    const id = typeof call?.id === 'string' ? call.id : ''
    if (!id) continue
    const name = typeof call?.name === 'string' ? call.name : typeof call?.function?.name === 'string' ? call.function.name : ''
    if (!name) continue
    callNames.set(id, name)
  }

  const blocks = parseContentBlocks(assistantMsg?.content_blocks)
  for (const block of blocks) {
    if (block?.type !== 'tool_result') continue
    const callId = typeof block?.tool_use_id === 'string' ? block.tool_use_id : ''
    if (!callId) continue

    const toolName = callNames.get(callId) || fallbackToolNameById.get(callId) || null
    const sanitized = sanitizeToolResultContentForModel(block?.content, toolName)
    const output = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized ?? null)

    messages.push({
      role: 'tool',
      tool_call_id: callId,
      content: output,
    })
  }
}

function transformHistoryToMessages(history: any[], userContent: string, systemPrompt?: string | null): OpenRouterChatMessage[] {
  const messages: OpenRouterChatMessage[] = []
  const toolNameById = buildToolNameMap(history)

  if (systemPrompt && systemPrompt.trim()) {
    messages.push({ role: 'system', content: systemPrompt.trim() })
  }

  for (const msg of history || []) {
    if (!msg) continue
    const role = msg.role

    if (role === 'system') continue

    if (role === 'user') {
      const content = asText(msg.content).trim()
      if (content) {
        messages.push({ role: 'user', content })
      }
      continue
    }

    if (role === 'assistant') {
      const content = asText(msg.content)
      const toolCalls = parseToolCalls(msg.tool_calls)
        .map((call: any) => {
          const id = typeof call?.id === 'string' ? call.id : ''
          const name = typeof call?.name === 'string' ? call.name : typeof call?.function?.name === 'string' ? call.function.name : ''
          const argsRaw = call?.arguments ?? call?.function?.arguments ?? '{}'
          const args = typeof argsRaw === 'string' ? argsRaw : JSON.stringify(argsRaw || {})
          if (!id || !name) return null
          return {
            id,
            type: 'function' as const,
            function: { name, arguments: args },
          }
        })
        .filter((call): call is NonNullable<typeof call> => Boolean(call))

      messages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls.length ? toolCalls : undefined,
      })

      appendToolOutputsFromBlocks(messages, msg, toolNameById)
      continue
    }

    if (role === 'tool' && msg.tool_call_id) {
      const toolCallId = String(msg.tool_call_id)
      const sanitized = sanitizeToolResultContentForModel(msg.content, toolNameById.get(toolCallId) || null)
      messages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized ?? null),
      })
    }
  }

  const trimmedUserContent = userContent.trim()
  const hasAnyUser = messages.some(message => message.role === 'user')
  if (trimmedUserContent && !hasAnyUser) {
    messages.push({ role: 'user', content: trimmedUserContent })
  }

  return messages
}

function parseResponseToolCalls(message: any): ProviderToolCall[] {
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : []

  return toolCalls
    .map((call: any) => {
      const id = typeof call?.id === 'string' ? call.id : ''
      const name = typeof call?.function?.name === 'string' ? call.function.name : ''
      const argsRaw = call?.function?.arguments
      if (!id || !name) return null

      let args: any = argsRaw ?? {}
      if (typeof argsRaw === 'string') {
        try {
          args = JSON.parse(argsRaw)
        } catch {
          args = argsRaw
        }
      }

      return {
        id,
        name,
        arguments: args,
        status: 'pending' as const,
      }
    })
    .filter((call: ProviderToolCall | null): call is ProviderToolCall => Boolean(call))
}

function extractReasoning(message: any): string {
  if (typeof message?.reasoning === 'string') return message.reasoning
  if (typeof message?.reasoning_text === 'string') return message.reasoning_text
  if (Array.isArray(message?.reasoning)) {
    return message.reasoning
      .map((part: any) => (typeof part === 'string' ? part : typeof part?.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export class OpenRouterProvider implements HeadlessProvider {
  readonly name = 'openrouter'

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const apiKey = input.accessToken || process.env.OPENROUTER_API_KEY || ''
    if (!apiKey) {
      throw new Error('OpenRouter API key missing. Provide accessToken or set OPENROUTER_API_KEY.')
    }

    const model = input.modelName || process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini'
    const messages = transformHistoryToMessages(input.history || [], input.userContent, input.systemPrompt)
    const tools = toOpenRouterToolSchema(input.tools)

    const body: Record<string, any> = {
      model,
      messages,
      stream: false,
    }

    if (tools?.length) {
      body.tools = tools
      body.tool_choice = 'auto'
    }

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'http-referer': 'https://yggdrasil.local',
        'x-title': 'ygg-headless-server',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`OpenRouter request failed (${response.status}): ${text}`)
    }

    const json = (await response.json()) as any
    const message = json?.choices?.[0]?.message || {}

    const content = asText(message?.content)
    const reasoning = extractReasoning(message)
    const toolCalls = parseResponseToolCalls(message)

    const contentBlocks: any[] = []
    if (reasoning) {
      contentBlocks.push({ type: 'thinking', content: reasoning })
    }
    if (content) {
      contentBlocks.push({ type: 'text', content })
    }
    for (const toolCall of toolCalls) {
      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments,
      })
    }

    return {
      content,
      reasoning: reasoning || undefined,
      toolCalls,
      contentBlocks,
      raw: json,
    }
  }
}
