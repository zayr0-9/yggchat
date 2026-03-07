import {
  CHATGPT_BASE_URL,
  CHATGPT_CODEX_ENDPOINT,
  JWT_CLAIM_PATH,
  OPENAI_CLIENT_ID,
  OPENAI_TOKEN_URL,
} from '../../../src/features/chats/openaiOAuth.js'
import type { ProviderTokenStore } from './tokenStore.js'
import { openStreamingWithPreFirstByteRetry } from './streamResilience.js'
import { buildToolNameMap, sanitizeToolResultContentForModel } from './toolResultSanitizer.js'
import type {
  HeadlessProvider,
  ProviderGenerateInput,
  ProviderGenerateOutput,
  ProviderToolCall,
  ProviderToolDefinition,
} from './openRouterProvider.js'

interface OpenAiChatgptProviderDeps {
  tokenStore?: ProviderTokenStore
}

interface ResolvedAuth {
  accessToken: string
  accountId: string
}

interface RefreshedTokenPayload {
  accessToken: string
  refreshToken: string
  expiresAtIso: string
  accountId: string
}

function normalizeModel(model: string): string {
  const m = (model || '').toLowerCase().replace(/\s+/g, '-')

  if (m.includes('gpt-5.3-codex')) return 'gpt-5.3-codex'
  if (m.includes('gpt-5.2-codex')) return 'gpt-5.2-codex'
  if (m.includes('gpt-5.2')) return 'gpt-5.2'
  if (m.includes('gpt-5.1-codex-max')) return 'gpt-5.1-codex-max'
  if (m.includes('gpt-5.1-codex-mini')) return 'gpt-5.1-codex-mini'
  if (m.includes('gpt-5.1-codex')) return 'gpt-5.1-codex'
  if (m.includes('gpt-5.1')) return 'gpt-5.1'
  if (m.includes('gpt-5-codex-mini') || m.includes('codex-mini-latest')) return 'gpt-5.1-codex-mini'
  if (m.includes('gpt-5-codex')) return 'gpt-5.1-codex'
  if (m.includes('gpt-5')) return 'gpt-5.1'
  if (m.includes('gpt-4o')) return 'gpt-5.1-codex-mini'

  return model
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const payload = parts[1]
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

function extractAccountId(accessToken: string): string | null {
  const decoded = decodeJwtPayload(accessToken)
  if (!decoded) return null
  const authClaim = decoded[JWT_CLAIM_PATH]
  return authClaim?.chatgpt_account_id || null
}

function shouldRefresh(expiresAtIso?: string | null): boolean {
  if (!expiresAtIso) return false
  const expiresAt = Date.parse(expiresAtIso)
  if (!Number.isFinite(expiresAt)) return false
  return Date.now() >= expiresAt - 5 * 60 * 1000
}

async function refreshOpenAiAccessToken(refreshToken: string): Promise<RefreshedTokenPayload> {
  const response = await fetch(OPENAI_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OPENAI_CLIENT_ID,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OpenAI token refresh failed (${response.status}): ${text}`)
  }

  const json = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('OpenAI token refresh response missing required fields')
  }

  const accountId = extractAccountId(json.access_token)
  if (!accountId) {
    throw new Error('OpenAI token refresh succeeded but account_id could not be derived from JWT')
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAtIso: new Date(Date.now() + json.expires_in * 1000).toISOString(),
    accountId,
  }
}

function parseContentBlocks(blocks: any): any[] {
  if (!blocks) return []
  if (Array.isArray(blocks)) return blocks
  if (typeof blocks === 'string') {
    try {
      const parsed = JSON.parse(blocks)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function toInputTextContent(value: any): Array<{ type: 'input_text'; text: string }> {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [{ type: 'input_text', text: trimmed }] : []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return { type: 'input_text' as const, text: item }
        if (item?.type === 'text' && typeof item?.content === 'string') return { type: 'input_text' as const, text: item.content }
        if (item?.type === 'text' && typeof item?.text === 'string') return { type: 'input_text' as const, text: item.text }
        if (item?.type === 'input_text' && typeof item?.text === 'string') return { type: 'input_text' as const, text: item.text }
        return null
      })
      .filter((item): item is { type: 'input_text'; text: string } => Boolean(item && item.text.trim()))
  }

  return []
}

function toOutputTextContent(value: any): Array<{ type: 'output_text'; text: string }> {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? [{ type: 'output_text', text: trimmed }] : []
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return { type: 'output_text' as const, text: item }
        if (item?.type === 'text' && typeof item?.content === 'string') {
          return { type: 'output_text' as const, text: item.content }
        }
        if (item?.type === 'text' && typeof item?.text === 'string') {
          return { type: 'output_text' as const, text: item.text }
        }
        if (item?.type === 'output_text' && typeof item?.text === 'string') {
          return { type: 'output_text' as const, text: item.text }
        }
        return null
      })
      .filter((item): item is { type: 'output_text'; text: string } => Boolean(item && item.text.trim()))
  }

  return []
}

function getToolCallName(raw: any): string {
  if (typeof raw?.name === 'string') return raw.name
  if (typeof raw?.function?.name === 'string') return raw.function.name
  return ''
}

function parseStoredResponseOutputItems(raw: any): any[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function normalizeResponseOutputItemsForReplay(items: any[]): any[] {
  const normalized: any[] = []

  for (const item of items || []) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') continue

    if (item.type === 'function_call') {
      const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.id === 'string' ? item.id : ''
      const name = typeof item.name === 'string' ? item.name : ''
      const args =
        typeof item.arguments === 'string'
          ? item.arguments
          : item.arguments !== undefined
            ? JSON.stringify(item.arguments)
            : ''
      if (!callId || !name) continue
      normalized.push({
        type: 'function_call',
        call_id: callId,
        name,
        arguments: args,
      })
      continue
    }

    if (item.type === 'reasoning') {
      const reasoningItem: any = { type: 'reasoning' }
      if (typeof item.id === 'string') reasoningItem.id = item.id
      if (Array.isArray(item.summary)) reasoningItem.summary = item.summary
      if (Array.isArray(item.content)) reasoningItem.content = item.content
      if ((item as any).encrypted_content) reasoningItem.encrypted_content = (item as any).encrypted_content
      normalized.push(reasoningItem)
    }
  }

  return normalized
}

function extractStoredResponseOutputItemsFromMessage(msg: any): any[] {
  const direct = normalizeResponseOutputItemsForReplay(parseStoredResponseOutputItems(msg?.responses_output_items))
  if (direct.length > 0) return direct

  const contentBlocks = parseContentBlocks(msg?.content_blocks)
  for (const block of contentBlocks) {
    if (block?.type === 'responses_output_items' && Array.isArray(block?.items)) {
      const fromBlock = normalizeResponseOutputItemsForReplay(block.items)
      if (fromBlock.length > 0) return fromBlock
    }
  }

  return []
}

function collectToolOutputCallIds(messages: any[]): Set<string> {
  const ids = new Set<string>()

  for (const msg of messages || []) {
    if (msg?.role === 'assistant' && msg?.content_blocks) {
      const contentBlocks = parseContentBlocks(msg.content_blocks)
      for (const block of contentBlocks) {
        if (block?.type !== 'tool_result') continue
        const callId = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
        if (callId) ids.add(callId)
      }
    }

    if (msg?.role === 'tool' && typeof msg?.tool_call_id === 'string' && msg.tool_call_id) {
      ids.add(msg.tool_call_id)
    }
  }

  return ids
}

function transformMessagesForCodex(history: any[], fallbackUserContent: string): any[] {
  const input: any[] = []
  const toolCallIds = new Set<string>()
  const toolOutputIds = new Set<string>()
  const availableToolOutputCallIds = collectToolOutputCallIds(history)
  const toolNameById = buildToolNameMap(history)

  for (const msg of history || []) {
    if (msg?.role === 'system') continue

    if (msg?.role === 'user') {
      const content = toInputTextContent(msg?.content)
      if (content.length) {
        input.push({ type: 'message', role: 'user', content })
      }
      continue
    }

    if (msg?.role === 'assistant') {
      const storedResponseItems = extractStoredResponseOutputItemsFromMessage(msg)
      let hasStoredFunctionCalls = false

      for (const item of storedResponseItems) {
        if (item?.type === 'reasoning') {
          input.push(item)
          continue
        }

        if (item?.type === 'function_call') {
          const callId = typeof item.call_id === 'string' ? item.call_id : ''
          if (!callId) continue
          if (!availableToolOutputCallIds.has(callId)) continue
          hasStoredFunctionCalls = true
          toolCallIds.add(callId)
          input.push(item)
        }
      }

      const assistantContent = toOutputTextContent(msg?.content)
      if (assistantContent.length > 0) {
        input.push({ type: 'message', role: 'assistant', content: assistantContent })
      }

      if (!hasStoredFunctionCalls && Array.isArray(msg?.tool_calls)) {
        for (const toolCall of msg.tool_calls) {
          const callId = typeof toolCall?.id === 'string' ? toolCall.id : ''
          if (!callId) continue
          if (!availableToolOutputCallIds.has(callId)) continue

          const name = getToolCallName(toolCall)
          if (!name) continue

          const args =
            typeof toolCall?.arguments === 'string'
              ? toolCall.arguments
              : JSON.stringify(toolCall?.arguments ?? toolCall?.input ?? {})

          toolCallIds.add(callId)
          input.push({
            type: 'function_call',
            call_id: callId,
            name,
            arguments: args,
          })
        }
      }

      const contentBlocks = parseContentBlocks(msg?.content_blocks)
      for (const block of contentBlocks) {
        if (block?.type !== 'tool_result') continue
        const callId = typeof block?.tool_use_id === 'string' ? block.tool_use_id : ''
        if (!callId || toolOutputIds.has(callId) || !toolCallIds.has(callId)) continue

        const sanitized = sanitizeToolResultContentForModel(block.content, toolNameById.get(callId) || null)

        toolOutputIds.add(callId)
        input.push({
          type: 'function_call_output',
          call_id: callId,
          output: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized ?? null),
        })
      }

      continue
    }

    if (msg?.role === 'tool' && msg?.tool_call_id) {
      const callId = String(msg.tool_call_id)
      if (toolOutputIds.has(callId)) continue
      if (!toolCallIds.has(callId)) continue

      const sanitized = sanitizeToolResultContentForModel(msg?.content, toolNameById.get(callId) || null)
      toolOutputIds.add(callId)
      input.push({
        type: 'function_call_output',
        call_id: callId,
        output: typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized ?? null),
      })
      continue
    }
  }

  const hasUserMessage = input.some(item => item?.type === 'message' && item?.role === 'user')
  if (!hasUserMessage && fallbackUserContent.trim()) {
    input.push({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: fallbackUserContent.trim() }],
    })
  }

  return input
}

function mapTools(tools: ProviderToolDefinition[]): any[] {
  return (tools || [])
    .filter(tool => tool?.name)
    .map(tool => ({
      type: 'function',
      name: tool.name,
      description: tool.description || '',
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    }))
}

function extractTextFromCompletedOutput(output: any[]): string {
  const chunks: string[] = []

  for (const item of output || []) {
    if (item?.type !== 'message' || item?.role !== 'assistant') continue
    const content = Array.isArray(item?.content) ? item.content : []
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part?.text === 'string' && part.text) {
        chunks.push(part.text)
      }
    }
  }

  return chunks.join('')
}

function extractReasoningFromCompletedOutput(output: any[]): string {
  const chunks: string[] = []

  for (const item of output || []) {
    if (item?.type !== 'reasoning') continue

    if (Array.isArray(item?.content)) {
      for (const part of item.content) {
        if (part?.type === 'reasoning_text' && typeof part?.text === 'string' && part.text) {
          chunks.push(part.text)
        }
      }
    }

    if (Array.isArray(item?.summary)) {
      for (const part of item.summary) {
        if (typeof part?.text === 'string' && part.text) {
          chunks.push(part.text)
        }
      }
    }
  }

  return chunks.join('')
}

function extractToolCallsFromCompletedOutput(output: any[]): ProviderToolCall[] {
  return (output || [])
    .filter(item => item?.type === 'function_call' && (item?.call_id || item?.id) && item?.name)
    .map(item => {
      const callId = typeof item.call_id === 'string' ? item.call_id : item.id
      const argsRaw = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {})

      let parsedArgs: any = argsRaw
      try {
        parsedArgs = JSON.parse(argsRaw)
      } catch {
        // keep raw string
      }

      return {
        id: callId,
        name: item.name,
        arguments: parsedArgs,
        status: 'pending' as const,
      }
    })
}

async function readCodexSseOutput(params: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  firstRead?: ReadableStreamReadResult<Uint8Array> | null
}): Promise<{
  text: string
  reasoning: string
  toolCalls: ProviderToolCall[]
  responseOutputItems: any[]
}> {
  const { reader, firstRead } = params
  const decoder = new TextDecoder()
  let buffer = ''

  let streamedText = ''
  let streamedReasoning = ''
  let completedOutputItems: any[] | null = null

  const callByItemId = new Map<
    string,
    {
      id: string
      name: string
      arguments: string
      outputIndex?: number
      seq: number
    }
  >()
  let callSeq = 0

  let pendingRead: ReadableStreamReadResult<Uint8Array> | null = firstRead ?? null

  while (true) {
    const readResult = pendingRead ?? (await reader.read())
    pendingRead = null

    const { done, value } = readResult
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue

      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let parsed: any = null
      try {
        parsed = JSON.parse(payload)
      } catch {
        continue
      }

      if (!parsed) continue

      if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
        streamedText += parsed.delta
        continue
      }

      if (parsed.type === 'response.reasoning_text.delta' && typeof parsed.delta === 'string') {
        streamedReasoning += parsed.delta
        continue
      }

      if (parsed.type === 'response.reasoning_summary_text.delta' && typeof parsed.delta === 'string') {
        streamedReasoning += parsed.delta
        continue
      }

      if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
        const item = parsed.item
        if (item?.type === 'function_call' && item?.id) {
          const existing = callByItemId.get(item.id)
          if (existing) {
            existing.id = item.call_id || item.id
            existing.name = item.name || existing.name
            existing.arguments = item.arguments ?? existing.arguments
            if (typeof item.output_index === 'number') existing.outputIndex = item.output_index
          } else {
            callByItemId.set(item.id, {
              id: item.call_id || item.id,
              name: item.name || '',
              arguments: item.arguments || '',
              outputIndex: typeof item.output_index === 'number' ? item.output_index : undefined,
              seq: callSeq++,
            })
          }
        }
        continue
      }

      if (parsed.type === 'response.function_call_arguments.delta') {
        const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : null
        if (!itemId) continue

        const existing = callByItemId.get(itemId)
        if (existing) {
          existing.arguments += parsed.delta || ''
        } else {
          callByItemId.set(itemId, {
            id: itemId,
            name: '',
            arguments: parsed.delta || '',
            seq: callSeq++,
          })
        }
        continue
      }

      if (parsed.type === 'response.function_call_arguments.done') {
        const itemId = typeof parsed.item_id === 'string' ? parsed.item_id : null
        if (!itemId) continue

        const existing = callByItemId.get(itemId)
        if (existing) {
          existing.arguments = parsed.arguments || existing.arguments
        } else {
          callByItemId.set(itemId, {
            id: itemId,
            name: '',
            arguments: parsed.arguments || '',
            seq: callSeq++,
          })
        }
        continue
      }

      if ((parsed.type === 'response.completed' || parsed.type === 'response.done') && Array.isArray(parsed?.response?.output)) {
        completedOutputItems = parsed.response.output
      }
    }
  }

  const responseOutputItems = normalizeResponseOutputItemsForReplay(completedOutputItems || [])

  const text =
    Array.isArray(completedOutputItems) && completedOutputItems.length > 0
      ? extractTextFromCompletedOutput(completedOutputItems) || streamedText
      : streamedText

  const reasoning =
    Array.isArray(completedOutputItems) && completedOutputItems.length > 0
      ? extractReasoningFromCompletedOutput(completedOutputItems) || streamedReasoning
      : streamedReasoning

  const toolCalls =
    Array.isArray(completedOutputItems) && completedOutputItems.length > 0
      ? extractToolCallsFromCompletedOutput(completedOutputItems)
      : Array.from(callByItemId.values())
          .sort((a, b) => {
            if (typeof a.outputIndex === 'number' && typeof b.outputIndex === 'number') {
              return a.outputIndex - b.outputIndex
            }
            if (typeof a.outputIndex === 'number') return -1
            if (typeof b.outputIndex === 'number') return 1
            return a.seq - b.seq
          })
          .map(call => {
            let parsedArgs: any = call.arguments
            try {
              parsedArgs = call.arguments ? JSON.parse(call.arguments) : {}
            } catch {
              // keep string
            }
            return {
              id: call.id,
              name: call.name,
              arguments: parsedArgs,
              status: 'pending' as const,
            }
          })
          .filter(call => call.id && call.name)

  return {
    text,
    reasoning,
    toolCalls,
    responseOutputItems,
  }
}

export class OpenAiChatgptProvider implements HeadlessProvider {
  readonly name = 'openaichatgpt'
  private readonly tokenStore?: ProviderTokenStore

  constructor(deps: OpenAiChatgptProviderDeps = {}) {
    this.tokenStore = deps.tokenStore
  }

  private async resolveAuth(input: ProviderGenerateInput): Promise<ResolvedAuth> {
    if (input.accessToken) {
      const accountId = input.accountId || extractAccountId(input.accessToken)
      if (!accountId) {
        throw new Error('ChatGPT account ID missing. Provide accountId or use a token that includes chatgpt_account_id claim.')
      }
      return {
        accessToken: input.accessToken,
        accountId,
      }
    }

    if (this.tokenStore && input.userId) {
      const record = this.tokenStore.get('openaichatgpt', input.userId)
      if (record) {
        if (shouldRefresh(record.expiresAt ?? null) && record.refreshToken) {
          const refreshed = await refreshOpenAiAccessToken(record.refreshToken)
          this.tokenStore.upsert({
            provider: 'openaichatgpt',
            userId: input.userId,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: refreshed.expiresAtIso,
            accountId: refreshed.accountId,
          })

          return {
            accessToken: refreshed.accessToken,
            accountId: refreshed.accountId,
          }
        }

        const accountId = record.accountId || extractAccountId(record.accessToken)
        if (!accountId) {
          throw new Error('Stored OpenAI token is missing account context (chatgpt_account_id).')
        }

        return {
          accessToken: record.accessToken,
          accountId,
        }
      }
    }

    const envToken = process.env.OPENAI_CHATGPT_ACCESS_TOKEN || process.env.OPENAI_ACCESS_TOKEN || null
    const envAccountId = process.env.OPENAI_CHATGPT_ACCOUNT_ID || null

    if (envToken) {
      const derived = envAccountId || extractAccountId(envToken)
      if (!derived) {
        throw new Error('OPENAI_CHATGPT_ACCOUNT_ID is required when access token lacks chatgpt_account_id claim.')
      }
      return { accessToken: envToken, accountId: derived }
    }

    throw new Error('OpenAI ChatGPT auth missing. Provide token+account_id or store OAuth tokens via provider-auth route.')
  }

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const auth = await this.resolveAuth(input)

    const requestTools = mapTools(input.tools || [])
    const requestBody = {
      model: normalizeModel(input.modelName),
      instructions: input.systemPrompt && input.systemPrompt.trim() ? input.systemPrompt : 'You are ChatGPT.',
      input: transformMessagesForCodex(input.history || [], input.userContent),
      tools: requestTools.length ? requestTools : undefined,
      tool_choice: requestTools.length ? 'auto' : undefined,
      store: false,
      include: ['reasoning.encrypted_content'],
      reasoning: {
        effort: 'medium',
        summary: 'auto',
      },
      stream: true,
    }

    const endpoint = `${CHATGPT_BASE_URL}${CHATGPT_CODEX_ENDPOINT}`
    const streamOpen = await openStreamingWithPreFirstByteRetry({
      endpoint,
      openAttempt: signal =>
        fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.accessToken}`,
            'chatgpt-account-id': auth.accountId,
            'OpenAI-Beta': 'responses=experimental',
            originator: 'opencode',
            accept: 'text/event-stream',
          },
          body: JSON.stringify(requestBody),
          signal,
        }),
    })

    if (!streamOpen.response.ok) {
      const text = await streamOpen.response.text().catch(() => '')
      throw new Error(`ChatGPT backend request failed (${streamOpen.response.status}): ${text}`)
    }

    if (!streamOpen.reader) {
      throw new Error('ChatGPT backend returned no readable stream body')
    }

    const parsed = await readCodexSseOutput({
      reader: streamOpen.reader,
      firstRead: streamOpen.firstRead,
    })
    const contentBlocks: any[] = []

    if (parsed.reasoning) {
      contentBlocks.push({ type: 'thinking', content: parsed.reasoning })
    }

    if (parsed.text) {
      contentBlocks.push({ type: 'text', content: parsed.text })
    }

    for (const toolCall of parsed.toolCalls) {
      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments,
      })
    }

    if (parsed.responseOutputItems.length > 0) {
      contentBlocks.push({
        type: 'responses_output_items',
        items: parsed.responseOutputItems,
      })
    }

    return {
      content: parsed.text,
      reasoning: parsed.reasoning || undefined,
      toolCalls: parsed.toolCalls,
      contentBlocks,
      raw: {
        responses_output_items: parsed.responseOutputItems,
      },
    }
  }
}
