function looksLikeHtmlString(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return /^<(?:!doctype\s+html|html|head|body|div|span|section|article|main|p|h[1-6]|ul|ol|li|table|tr|td|th|script|style|svg|canvas|iframe)\b/i.test(
    trimmed
  )
}

function parseJson(raw: string): any | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function extractHtmlPayload(content: any): { html: string; toolName?: string | null } | null {
  let resolved = content

  if (typeof resolved === 'string') {
    const trimmed = resolved.trim()
    if (!trimmed) return null
    if (looksLikeHtmlString(trimmed)) {
      return { html: trimmed }
    }

    const parsed = parseJson(trimmed)
    if (parsed == null) {
      return null
    }
    resolved = parsed
  }

  if (typeof resolved === 'string') {
    if (looksLikeHtmlString(resolved)) {
      return { html: resolved }
    }
    return null
  }

  if (typeof resolved === 'object' && resolved !== null) {
    if (typeof (resolved as any).html === 'string') {
      return {
        html: (resolved as any).html,
        toolName: (resolved as any).toolName ?? (resolved as any).tool_name ?? null,
      }
    }
    if ((resolved as any).type === 'text/html' && typeof (resolved as any).content === 'string') {
      return {
        html: (resolved as any).content,
        toolName: (resolved as any).toolName ?? (resolved as any).tool_name ?? null,
      }
    }
  }

  return null
}

export function getToolCallName(tc: any): string {
  if (!tc) return ''
  if (typeof tc.name === 'string') return tc.name
  if (typeof tc?.function?.name === 'string') return tc.function.name
  return ''
}

function parseToolCalls(value: any): any[] {
  if (!value) return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const parsed = parseJson(value)
    return Array.isArray(parsed) ? parsed : []
  }
  return []
}

export function buildToolNameMap(history: any[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const msg of history || []) {
    if (!msg || msg.role !== 'assistant') continue
    const toolCalls = parseToolCalls(msg.tool_calls)
    for (const tc of toolCalls) {
      const id = tc?.id
      const name = getToolCallName(tc)
      if (typeof id === 'string' && id && name) {
        map.set(id, name)
      }
    }
  }
  return map
}

export function sanitizeToolResultContentForModel(content: any, toolName?: string | null): any {
  const htmlPayload = extractHtmlPayload(content)
  if (htmlPayload?.html) {
    const resolvedName = toolName ?? htmlPayload.toolName ?? null
    return `displaying ${resolvedName || 'custom tool'} ui now`
  }
  return content
}
