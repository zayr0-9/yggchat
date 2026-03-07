import type { MobileMessage, ParsedRenderItem, ToolCallLike, ToolGroup, ToolResultLike } from './types'

const parseMaybeJson = <T>(value: unknown): T | null => {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

const extractReasoningTextsFromResponsesOutputItems = (items: unknown): string[] => {
  if (!Array.isArray(items)) return []

  const reasoningTexts: string[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type !== 'reasoning') continue

    const content = Array.isArray(itemRecord.content) ? itemRecord.content : []
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const partRecord = part as Record<string, unknown>
      if (partRecord.type === 'reasoning_text' && typeof partRecord.text === 'string' && partRecord.text.trim()) {
        reasoningTexts.push(partRecord.text)
      }
    }

    const summary = Array.isArray(itemRecord.summary) ? itemRecord.summary : []
    for (const part of summary) {
      if (!part || typeof part !== 'object') continue
      const partRecord = part as Record<string, unknown>
      if (typeof partRecord.text === 'string' && partRecord.text.trim()) {
        reasoningTexts.push(partRecord.text)
      }
    }
  }

  return reasoningTexts
}

const toToolCallArray = (message: MobileMessage): ToolCallLike[] => {
  const raw = parseMaybeJson<unknown>(message.tool_calls)
  if (Array.isArray(raw)) return raw as ToolCallLike[]
  if (raw && typeof raw === 'object') return [raw as ToolCallLike]
  return []
}

const ensureToolGroup = (groups: Map<string, ToolGroup>, order: string[], id: string, name: string, args?: Record<string, unknown>) => {
  if (groups.has(id)) {
    const existing = groups.get(id)!
    if (!existing.name && name) existing.name = name
    if (!existing.args && args) existing.args = args
    return existing
  }

  const next: ToolGroup = {
    id,
    name: name || 'tool',
    args,
    results: [],
  }

  groups.set(id, next)
  order.push(id)
  return next
}

export const buildRenderItemsForMessage = (message: MobileMessage): ParsedRenderItem[] => {
  const renderItems: ParsedRenderItem[] = []
  const toolGroups = new Map<string, ToolGroup>()
  const toolOrder: string[] = []

  const contentBlocks = parseMaybeJson<any[]>(message.content_blocks)
  if (Array.isArray(contentBlocks) && contentBlocks.length > 0) {
    const sorted = [...contentBlocks].sort((a, b) => {
      const left = typeof a?.index === 'number' ? a.index : 0
      const right = typeof b?.index === 'number' ? b.index : 0
      return left - right
    })

    sorted.forEach((block, index) => {
      if (!block || typeof block !== 'object') return

      if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
        renderItems.push({ type: 'text', key: `text-${index}`, text: block.content })
        return
      }

      if (block.type === 'thinking' && typeof block.content === 'string' && block.content.trim()) {
        renderItems.push({ type: 'reasoning', key: `thinking-${index}`, text: block.content })
        return
      }

      if (block.type === 'reasoning_details' && Array.isArray(block.reasoningDetails)) {
        const text = block.reasoningDetails
          .map((detail: any) => (typeof detail?.text === 'string' ? detail.text : ''))
          .filter(Boolean)
          .join('\n')
        if (text.trim()) {
          renderItems.push({ type: 'reasoning', key: `reasoning-details-${index}`, text })
        }
        return
      }

      if (block.type === 'tool_use') {
        const id = String(block.id || `tool-${index}`)
        ensureToolGroup(toolGroups, toolOrder, id, String(block.name || 'tool'), block.input)
        return
      }

      if (block.type === 'tool_result') {
        const id = String(block.tool_use_id || `tool-result-${index}`)
        const group = ensureToolGroup(toolGroups, toolOrder, id, 'tool')
        group.results.push({
          tool_use_id: id,
          content: block.content,
          is_error: Boolean(block.is_error),
        })
        return
      }

      if (block.type === 'responses_output_items') {
        const extracted = extractReasoningTextsFromResponsesOutputItems(block.items)
        extracted.forEach((text, reasoningIndex) => {
          if (!text.trim()) return
          renderItems.push({
            type: 'reasoning',
            key: `responses-reasoning-${index}-${reasoningIndex}`,
            text,
          })
        })
      }
    })
  } else if (typeof message.content === 'string' && message.content.trim()) {
    renderItems.push({ type: 'text', key: 'message-content', text: message.content })
  }

  const legacyToolCalls = toToolCallArray(message)
  for (const toolCall of legacyToolCalls) {
    const id = String(toolCall.id || `legacy-tool-${toolOrder.length}`)
    const group = ensureToolGroup(toolGroups, toolOrder, id, String(toolCall.name || 'tool'), toolCall.arguments)
    if (toolCall.result) {
      group.results.push({
        tool_use_id: id,
        content: toolCall.result,
        is_error: toolCall.status === 'failed',
      })
    }
  }

  toolOrder.forEach((id, index) => {
    const group = toolGroups.get(id)
    if (!group) return
    renderItems.push({ type: 'tool', key: `tool-group-${index}-${id}`, group })
  })

  return renderItems
}

export const toReadableToolResult = (result: ToolResultLike): string => {
  if (typeof result.content === 'string') return result.content
  try {
    return JSON.stringify(result.content, null, 2)
  } catch {
    return String(result.content)
  }
}
