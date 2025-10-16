import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { stepCountIs, streamText } from 'ai'
import fs from 'fs'
import path from 'path'
import tools from './tools'

export async function generateResponse(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk: (chunk: string) => void,
  model: string = 'llama-3.2-1b',
  attachments?: Array<{ mimeType?: string; filePath?: string }>,
  abortSignal?: AbortSignal,
  think: boolean = false
): Promise<void> {
  // Create LM Studio provider
  const lmstudio = createOpenAICompatible({
    name: 'lmstudio',
    baseURL: 'http://localhost:1234/v1',
  })

  // Build LM Studio-compatible messages. Start with simple messages
  let formattedMessages: any[] = messages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
  }))

  const imageAtts = (attachments || []).filter(a => a.filePath)
  if (imageAtts.length > 0) {
    // Convert user/assistant to structured content parts; keep system as plain string per AI SDK rules
    formattedMessages = formattedMessages.map((m: any) =>
      m.role === 'system'
        ? { role: m.role, content: String(m.content || '') }
        : { role: m.role, content: [{ type: 'text', text: String(m.content || '') }] }
    )

    // Find last user message index
    let lastUserIdx = -1
    for (let i = formattedMessages.length - 1; i >= 0; i--) {
      if (formattedMessages[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }

    // If none, append a new user message for attachments
    if (lastUserIdx === -1) {
      formattedMessages.push({ role: 'user', content: [{ type: 'text', text: '' }] })
      lastUserIdx = formattedMessages.length - 1
    }

    const parts: any[] = []
    for (const att of imageAtts) {
      try {
        const baseDir = path.resolve(__dirname, '..') // dist root
        let abs = path.isAbsolute(att.filePath!) ? att.filePath! : path.join(baseDir, att.filePath!)
        if (!fs.existsSync(abs)) {
          // Fallbacks: server cwd (e.g., project/server), and dist/src guesses
          const tryCwd = path.resolve(process.cwd(), att.filePath!)
          const tryDist = path.resolve(process.cwd(), 'dist', att.filePath!)
          const trySrc = path.resolve(process.cwd(), 'src', att.filePath!)
          abs = [tryCwd, tryDist, trySrc].find(p => fs.existsSync(p)) || abs
        }
        const buf = fs.readFileSync(abs)
        const mediaType = att.mimeType || 'image/jpeg'
        // Use unified file part (AI SDK will translate to provider-specific format)
        parts.push({ type: 'file', data: buf, mediaType })
      } catch {
        // Ignore failed attachment read
      }
    }
    // Prepend file parts before the existing text part to preserve user text
    const existing = Array.isArray(formattedMessages[lastUserIdx].content)
      ? formattedMessages[lastUserIdx].content
      : [{ type: 'text', text: String(formattedMessages[lastUserIdx].content || '') }]
    formattedMessages[lastUserIdx] = { role: 'user', content: [...parts, ...existing] }
  }

  let result: any
  let aborted = false
  try {
    result = await streamText({
      model: lmstudio(model),
      tools: tools.reduce(
        (acc, t) => {
          acc[t.name] = t.tool
          return acc
        },
        {} as Record<string, any>
      ),
      stopWhen: stepCountIs(20),
      messages: formattedMessages as any,
      abortSignal,
      onAbort: () => {
        aborted = true
        console.log('LM Studio stream aborted')
      },
      maxRetries: 1,
    })
  } catch (err: any) {
    if (aborted || err?.name === 'AbortError') {
      return
    }
    throw err
  }

  // Prefer full/data stream (may include reasoning/text parts); fallback to text stream
  const fullStream: AsyncIterable<any> | undefined =
    (result && (result.fullStream as AsyncIterable<any>)) || (result && (result.dataStream as AsyncIterable<any>))

  try {
    if (fullStream && typeof (fullStream as any)[Symbol.asyncIterator] === 'function') {
      for await (const part of fullStream) {
        if (aborted || abortSignal?.aborted) {
          return
        }
        try {
          const t = String((part as any)?.type || '')
          const delta: string =
            (part as any)?.delta ??
            (part as any)?.textDelta ??
            (part as any)?.text ??
            (typeof part === 'string' ? part : '')

          if (!delta) continue

          // Route reasoning vs text vs tool call parts
          const isReason = t.includes('reason') || t.includes('thinking')
          const isToolCall = t.includes('tool-call') || t.includes('tool_call') || t.includes('tool-use')
          if (isReason) {
            if (think) {
              onChunk(JSON.stringify({ part: 'reasoning', delta }))
            } else {
              // Suppress reasoning output when thinking is disabled
              continue
            }
          } else if (isToolCall) {
            onChunk(JSON.stringify({ part: 'tool_call', delta }))
          } else {
            // Check if this delta contains tool calls mixed in with text
            const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
            if (delta.includes('{"') && toolCallRegex.test(delta)) {
              // Extract tool calls from this delta
              const matches = delta.match(toolCallRegex)
              if (matches) {
                // Send tool calls separately
                onChunk(JSON.stringify({ part: 'tool_call', delta: matches.join('') }))

                // Send cleaned text separately
                const cleanedDelta = delta.replace(toolCallRegex, '').trim()
                if (cleanedDelta) {
                  onChunk(JSON.stringify({ part: 'text', delta: cleanedDelta }))
                }
              }
            } else {
              onChunk(JSON.stringify({ part: 'text', delta }))
            }
          }
        } catch {
          // Ignore malformed parts
        }
      }
    } else {
      const { textStream } = result
      for await (const chunk of textStream as AsyncIterable<string>) {
        if (aborted || abortSignal?.aborted) {
          return
        }
        // Filter tool calls from textStream fallback as well
        const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
        if (chunk.includes('{"') && toolCallRegex.test(chunk)) {
          const matches = chunk.match(toolCallRegex)
          if (matches) {
            // Send tool calls separately
            onChunk(JSON.stringify({ part: 'tool_call', delta: matches.join('') }))

            // Send cleaned text separately
            const cleanedChunk = chunk.replace(toolCallRegex, '').trim()
            if (cleanedChunk) {
              onChunk(JSON.stringify({ part: 'text', delta: cleanedChunk }))
            }
          }
        } else {
          onChunk(JSON.stringify({ part: 'text', delta: chunk }))
        }
      }
    }
  } catch (err: any) {
    if (aborted || err?.name === 'AbortError') {
      return
    }
    throw err
  }
}