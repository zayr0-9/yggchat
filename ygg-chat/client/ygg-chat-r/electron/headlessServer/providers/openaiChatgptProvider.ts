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
  ProviderStreamEventHandler,
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

  if (m.includes('gpt-5.4-mini')) return 'gpt-5.4-mini'
  if (m.includes('gpt-5.4-pro')) return 'gpt-5.4-pro'
  if (m.includes('gpt-5.4')) return 'gpt-5.4'
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

function shouldUseGPT53StrictTextAssembly(model: string): boolean {
  return normalizeModel(model) === 'gpt-5.3-codex'
}

const GPT53_INTERNAL_PROTOCOL_MARKERS: RegExp[] = [
  /assistant to=functions\./i,
  /to=functions\./i,
  /tool read [^\n]* lines/i,
  /\{\s*"path"\s*:\s*".*localServer\.ts"/i,
]

function sanitizeGPT53Text(text: string): string {
  if (!text) return ''

  const firstMarker = GPT53_INTERNAL_PROTOCOL_MARKERS.reduce((first, marker) => {
    const idx = text.search(marker)
    if (idx < 0) return first
    return first < 0 ? idx : Math.min(first, idx)
  }, -1)

  if (firstMarker < 0) {
    return text
  }

  const prefix = text.slice(0, firstMarker).trim()
  if (!prefix) return ''

  if (prefix.length < 600 && /\b(need|inspect|gather|tool|maybe|let'?s)\b/i.test(prefix)) {
    return ''
  }

  return prefix
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

function normalizeResponseMessageContent(content: any): Array<{ type: 'output_text'; text: string }> {
  if (!Array.isArray(content)) return []

  return content
    .map(part => {
      if (!part || typeof part !== 'object') return null
      if (part.type === 'output_text' && typeof part.text === 'string' && part.text.trim().length > 0) {
        return { type: 'output_text' as const, text: part.text }
      }
      if (part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0) {
        return { type: 'output_text' as const, text: part.text }
      }
      return null
    })
    .filter((part): part is { type: 'output_text'; text: string } => Boolean(part))
}

function normalizeResponseOutputItemsForReplay(items: any[]): any[] {
  const normalized: any[] = []

  for (const item of items || []) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string') continue

    if (item.type === 'message') {
      const role = typeof item.role === 'string' ? item.role : 'assistant'
      const content = normalizeResponseMessageContent(item.content)
      if (content.length === 0) continue

      const messageItem: any = {
        type: 'message',
        role,
        content,
      }
      if (typeof item.id === 'string') messageItem.id = item.id
      if (typeof item.phase === 'string') messageItem.phase = item.phase
      if (typeof item.output_index === 'number') messageItem.output_index = item.output_index
      if (typeof item.outputIndex === 'number') messageItem.output_index = item.outputIndex
      normalized.push(messageItem)
      continue
    }

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

      const functionCallItem: any = {
        type: 'function_call',
        call_id: callId,
        name,
        arguments: args,
      }
      if (typeof item.id === 'string') functionCallItem.id = item.id
      if (typeof item.output_index === 'number') functionCallItem.output_index = item.output_index
      if (typeof item.outputIndex === 'number') functionCallItem.output_index = item.outputIndex
      normalized.push(functionCallItem)
      continue
    }

    if (item.type === 'reasoning') {
      const reasoningItem: any = { type: 'reasoning' }
      if (typeof item.id === 'string') reasoningItem.id = item.id
      if (Array.isArray(item.summary)) reasoningItem.summary = item.summary
      if (Array.isArray(item.content)) reasoningItem.content = item.content
      if (typeof item.output_index === 'number') reasoningItem.output_index = item.output_index
      if (typeof item.outputIndex === 'number') reasoningItem.output_index = item.outputIndex
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

function extractAssistantMessageTextFromReplayItem(item: any): string {
  if (!item || item.type !== 'message' || !Array.isArray(item.content)) return ''

  return item.content
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('')
}

function extractReasoningTextFromReplayItem(item: any): string {
  if (!item || item.type !== 'reasoning') return ''

  const parts: string[] = []

  if (Array.isArray(item.summary)) {
    for (const part of item.summary) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        parts.push(part.text)
      }
    }
  }

  if (Array.isArray(item.content)) {
    for (const part of item.content) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        parts.push(part.text)
      }
    }
  }

  return parts.join('\n\n').trim()
}

function extractToolCallsFromReplayItems(items: any[]): ProviderToolCall[] {
  return (items || [])
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

function selectFinalTextFromReplayItems(replayItems: any[], fallbackText: string, useGPT53StrictTextAssembly: boolean): string {
  const assistantMessages = (replayItems || [])
    .filter(item => item?.type === 'message' && item?.role === 'assistant')
    .map((item: any) => {
      const rawText = extractAssistantMessageTextFromReplayItem(item)
      const text = useGPT53StrictTextAssembly ? sanitizeGPT53Text(rawText) : rawText
      return {
        text,
        phase: typeof item?.phase === 'string' ? item.phase : undefined,
      }
    })
    .filter((entry: { text: string }) => entry.text.trim().length > 0)

  const finalAnswerEntry = [...assistantMessages].reverse().find(entry => entry.phase === 'final_answer')
  const fallbackEntry = [...assistantMessages].reverse().find(entry => entry.phase !== 'commentary')
  const lastEntry = assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null
  const fallback = useGPT53StrictTextAssembly ? sanitizeGPT53Text(fallbackText) : fallbackText

  return finalAnswerEntry?.text || fallbackEntry?.text || lastEntry?.text || fallback
}

function selectReasoningFromReplayItems(replayItems: any[], fallbackReasoning: string): string {
  const reasoningSegments = (replayItems || [])
    .map((item: any) => extractReasoningTextFromReplayItem(item))
    .filter((text: string) => text.trim().length > 0)

  return reasoningSegments.join('\n\n').trim() || fallbackReasoning
}

async function readCodexSseOutput(params: {
  reader: ReadableStreamDefaultReader<Uint8Array>
  firstRead?: ReadableStreamReadResult<Uint8Array> | null
  emit?: ProviderStreamEventHandler
  modelName: string
}): Promise<{
  text: string
  reasoning: string
  toolCalls: ProviderToolCall[]
  responseOutputItems: any[]
}> {
  const { reader, firstRead, emit, modelName } = params
  const decoder = new TextDecoder()
  let buffer = ''

  const useGPT53StrictTextAssembly = shouldUseGPT53StrictTextAssembly(modelName)
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
  const responseOutputItemsById = new Map<
    string,
    {
      id: string
      type?: string
      role?: string
      phase?: string
      outputIndex?: number
      seq: number
    }
  >()
  const responseTextByItem = new Map<
    string,
    {
      text: string
      outputIndex?: number
      seq: number
      fromDone: boolean
    }
  >()
  const reasoningByKey = new Map<string, string>()
  let callSeq = 0
  let responseSeq = 0
  let pendingRead: ReadableStreamReadResult<Uint8Array> | null = firstRead ?? null

  const extractItemId = (evt: any): string => {
    const raw = evt?.item_id ?? evt?.itemId ?? evt?.id ?? ''
    return typeof raw === 'string' ? raw : ''
  }

  const extractIndex = (evt: any, snakeKey: string, camelKey: string): number | undefined => {
    const raw = evt?.[snakeKey] ?? evt?.[camelKey]
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
  }

  const mergeOutputItem = (item: any) => {
    if (!item?.id || typeof item.id !== 'string') return

    const existing = responseOutputItemsById.get(item.id)
    const outputIndex =
      typeof item.output_index === 'number'
        ? item.output_index
        : typeof item.outputIndex === 'number'
          ? item.outputIndex
          : existing?.outputIndex

    responseOutputItemsById.set(item.id, {
      id: item.id,
      type: typeof item.type === 'string' ? item.type : existing?.type,
      role: typeof item.role === 'string' ? item.role : existing?.role,
      phase: typeof item.phase === 'string' ? item.phase : existing?.phase,
      outputIndex,
      seq: existing?.seq ?? responseSeq++,
    })
  }

  const upsertResponseText = (itemId: string, text: string, outputIndex?: number, fromDone: boolean = false) => {
    const existing = responseTextByItem.get(itemId)
    responseTextByItem.set(itemId, {
      text: fromDone ? text : (existing?.text || '') + text,
      outputIndex: typeof outputIndex === 'number' ? outputIndex : existing?.outputIndex,
      seq: existing?.seq ?? responseSeq++,
      fromDone: fromDone || Boolean(existing?.fromDone),
    })
  }

  const shouldEmitTextForEvent = (evt: any): boolean => {
    if (!useGPT53StrictTextAssembly) return true
    const itemId = extractItemId(evt)
    if (!itemId) return false
    const meta = responseOutputItemsById.get(itemId)
    if (!meta) return false
    if (meta.type && meta.type !== 'message') return false
    if (meta.role && meta.role !== 'assistant') return false
    if (meta.phase && meta.phase !== 'final_answer') return false
    return true
  }

  const emitReasoning = (delta: string) => {
    if (!delta) return
    streamedReasoning += delta
    emit?.({ type: 'chunk', part: 'reasoning', delta })
  }

  const applyReasoningDelta = (key: string, delta: string) => {
    if (!delta) return
    const prev = reasoningByKey.get(key) || ''
    reasoningByKey.set(key, prev + delta)
    emitReasoning(delta)
  }

  const applyReasoningDone = (key: string, fullText: string) => {
    if (!fullText) return

    const prev = reasoningByKey.get(key) || ''
    reasoningByKey.set(key, fullText)

    if (fullText.startsWith(prev)) {
      emitReasoning(fullText.slice(prev.length))
      return
    }

    if (prev) {
      return
    }

    emitReasoning(fullText)
  }

  const extractReasoningFromOutputItem = (item: any) => {
    if (!item || item.type !== 'reasoning') return

    const itemId = typeof item.id === 'string' ? item.id : 'unknown-reasoning-item'

    if (Array.isArray(item.content)) {
      item.content.forEach((part: any, contentIndex: number) => {
        if (part?.type === 'reasoning_text' && typeof part.text === 'string' && part.text) {
          applyReasoningDone(`reasoning_text:${itemId}:${contentIndex}`, part.text)
        }
      })
    }

    if (Array.isArray(item.summary)) {
      item.summary.forEach((part: any, summaryIndex: number) => {
        if (typeof part?.text === 'string' && part.text) {
          applyReasoningDone(`reasoning_summary:${itemId}:${summaryIndex}`, part.text)
        }
      })
    }
  }

  const buildFallbackResponseOutputItems = (): any[] => {
    const fallbackMessages = Array.from(responseOutputItemsById.values())
      .filter(item => (!item.type || item.type === 'message') && (!item.role || item.role === 'assistant'))
      .sort((a, b) => {
        if (typeof a.outputIndex === 'number' && typeof b.outputIndex === 'number') return a.outputIndex - b.outputIndex
        if (typeof a.outputIndex === 'number') return -1
        if (typeof b.outputIndex === 'number') return 1
        return a.seq - b.seq
      })
      .map(item => {
        const textEntry = responseTextByItem.get(item.id)
        const text = textEntry?.text || ''
        if (!text.trim()) return null
        return {
          type: 'message',
          id: item.id,
          role: item.role || 'assistant',
          phase: item.phase,
          output_index: item.outputIndex,
          content: [{ type: 'output_text', text }],
        }
      })
      .filter(Boolean)

    const fallbackFunctionCalls = Array.from(callByItemId.values())
      .sort((a, b) => {
        if (typeof a.outputIndex === 'number' && typeof b.outputIndex === 'number') return a.outputIndex - b.outputIndex
        if (typeof a.outputIndex === 'number') return -1
        if (typeof b.outputIndex === 'number') return 1
        return a.seq - b.seq
      })
      .map(call => ({
        type: 'function_call',
        call_id: call.id,
        name: call.name,
        arguments: call.arguments || '',
        output_index: call.outputIndex,
      }))
      .filter(call => call.call_id && call.name)

    return normalizeResponseOutputItemsForReplay([...fallbackMessages, ...fallbackFunctionCalls])
  }

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

      if (parsed.type === 'response.output_item.added' || parsed.type === 'response.output_item.done') {
        const item = parsed.item
        mergeOutputItem(item)

        if (item?.type === 'function_call' && item?.id) {
          const existing = callByItemId.get(item.id)
          const outputIndex =
            typeof item.output_index === 'number'
              ? item.output_index
              : typeof item.outputIndex === 'number'
                ? item.outputIndex
                : existing?.outputIndex
          if (existing) {
            existing.id = item.call_id || item.id
            existing.name = item.name || existing.name
            existing.arguments = item.arguments ?? existing.arguments
            existing.outputIndex = outputIndex
          } else {
            callByItemId.set(item.id, {
              id: item.call_id || item.id,
              name: item.name || '',
              arguments: item.arguments || '',
              outputIndex,
              seq: callSeq++,
            })
          }
        }

        if (parsed.type === 'response.output_item.done') {
          if (item?.type === 'message' && item?.id) {
            const text = extractAssistantMessageTextFromReplayItem({
              type: 'message',
              content: normalizeResponseMessageContent(item.content),
            })
            if (text) {
              upsertResponseText(item.id, text, extractIndex(item, 'output_index', 'outputIndex'), true)
            }
          }
          extractReasoningFromOutputItem(item)
        }
        continue
      }

      if (parsed.type === 'response.output_text.delta') {
        const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
        if (!delta) continue

        const itemId = extractItemId(parsed)
        const outputIndex = extractIndex(parsed, 'output_index', 'outputIndex')
        if (itemId) {
          upsertResponseText(itemId, delta, outputIndex, false)
        }

        if (shouldEmitTextForEvent(parsed)) {
          streamedText += delta
          emit?.({ type: 'chunk', part: 'text', delta })
        }
        continue
      }

      if (parsed.type === 'response.output_text.done') {
        const fullText = typeof parsed.text === 'string' ? parsed.text : ''
        if (!fullText) continue

        const itemId = extractItemId(parsed)
        if (!itemId) continue
        upsertResponseText(itemId, fullText, extractIndex(parsed, 'output_index', 'outputIndex'), true)
        continue
      }

      if (parsed.type === 'response.reasoning_text.delta' && typeof parsed.delta === 'string') {
        const itemId = extractItemId(parsed) || 'reasoning'
        applyReasoningDelta(`reasoning_text:${itemId}:${extractIndex(parsed, 'content_index', 'contentIndex') || 0}`, parsed.delta)
        continue
      }

      if (parsed.type === 'response.reasoning_summary_text.delta' && typeof parsed.delta === 'string') {
        const itemId = extractItemId(parsed) || 'reasoning'
        applyReasoningDelta(`reasoning_summary:${itemId}:${extractIndex(parsed, 'summary_index', 'summaryIndex') || 0}`, parsed.delta)
        continue
      }

      if (
        parsed.type === 'response.reasoning_text.done' ||
        parsed.type === 'response.reasoning_summary_text.done' ||
        parsed.type === 'response.reasoning_summary_part.done' ||
        parsed.type === 'response.content_part.done' ||
        parsed.type === 'response.reasoning.delta'
      ) {
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

      if (parsed.type === 'response.failed' || parsed.type === 'response.incomplete') {
        const responseError = parsed?.response?.error
        const message =
          typeof responseError?.message === 'string' && responseError.message.trim().length > 0
            ? responseError.message
            : parsed.type === 'response.incomplete'
              ? 'OpenAI response was incomplete.'
              : 'OpenAI response failed.'
        throw new Error(message)
      }

      if (parsed.type === 'response.completed' || parsed.type === 'response.done') {
        if (Array.isArray(parsed?.response?.output)) {
          completedOutputItems = parsed.response.output
        }
      }
    }
  }

  const normalizedCompletedOutputItems = normalizeResponseOutputItemsForReplay(completedOutputItems || [])
  const responseOutputItems =
    normalizedCompletedOutputItems.length > 0 ? normalizedCompletedOutputItems : buildFallbackResponseOutputItems()
  const text = selectFinalTextFromReplayItems(responseOutputItems, streamedText, useGPT53StrictTextAssembly)
  const reasoning = selectReasoningFromReplayItems(responseOutputItems, streamedReasoning)
  const toolCalls = extractToolCallsFromReplayItems(responseOutputItems)

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

    if (this.tokenStore) {
      const record = input.userId
        ? this.tokenStore.get('openaichatgpt', input.userId)
        : this.tokenStore.getLatest('openaichatgpt')
      if (record) {
        if (shouldRefresh(record.expiresAt ?? null) && record.refreshToken) {
          const refreshed = await refreshOpenAiAccessToken(record.refreshToken)
          this.tokenStore.upsert({
            provider: 'openaichatgpt',
            userId: record.userId,
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

  async generate(input: ProviderGenerateInput, emit?: ProviderStreamEventHandler): Promise<ProviderGenerateOutput> {
    const auth = await this.resolveAuth(input)

    const requestTools = mapTools(input.tools || [])
    const requestBody = {
      model: normalizeModel(input.modelName),
      instructions: input.systemPrompt && input.systemPrompt.trim() ? input.systemPrompt : 'You are ChatGPT.',
      input: transformMessagesForCodex(input.history || [], input.userContent),
      tools: requestTools.length ? requestTools : undefined,
      tool_choice: requestTools.length ? 'auto' : undefined,
      parallel_tool_calls: requestTools.length ? true : undefined,
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
      emit,
      modelName: input.modelName,
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
