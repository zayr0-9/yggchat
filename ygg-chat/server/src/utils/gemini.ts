import { google } from '@ai-sdk/google'
import { stepCountIs, streamText } from 'ai'
import fs from 'fs'
import path from 'path'
import tools from './tools'
export async function generateResponse(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  onChunk: (chunk: string) => void,
  model: string = 'gemini-2.5-flash',
  attachments?: Array<{ mimeType?: string; filePath?: string }>,
  abortSignal?: AbortSignal,
  think: boolean = false
): Promise<void> {
  // Start with simple role/content messages
  let formattedMessages: any[] = messages.map(msg => ({
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content,
  }))

  const imageAtts = (attachments || []).filter(a => a.filePath)
  if (imageAtts.length > 0) {
    // Convert user/assistant to structured parts; keep system as plain string per AI SDK requirements
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
        const baseDir = path.resolve(__dirname, '..') // server/src when running ts-node-dev
        let abs = path.isAbsolute(att.filePath!) ? att.filePath! : path.join(baseDir, att.filePath!)
        if (!fs.existsSync(abs)) {
          // Additional likely locations based on where uploads are saved
          const tryRoutes = path.resolve(__dirname, '..', 'routes', att.filePath!) // server/src/routes/...
          const tryHere = path.resolve(__dirname, att.filePath!) // server/src/utils/...
          // Fallbacks: server cwd (project/server), and dist/src guesses
          const tryCwd = path.resolve(process.cwd(), att.filePath!)
          const tryDist = path.resolve(process.cwd(), 'dist', att.filePath!)
          const trySrc = path.resolve(process.cwd(), 'src', att.filePath!)
          const candidates = [tryRoutes, tryHere, tryCwd, tryDist, trySrc]
          const found = candidates.find(p => fs.existsSync(p))
          if (found) {
            abs = found
            // console.log(`Resolved attachment path: ${abs}`)
          }
        }
        const buf = fs.readFileSync(abs)
        const mediaType = att.mimeType || 'image/jpeg'
        // Use unified file part; AI SDK will translate to provider-specific format
        parts.push({ type: 'file', data: buf, mediaType })
      } catch {
        // Ignore failed attachment read
      }
    }
    // Append image parts after the existing text to match provider expectations (text first)
    const existing = Array.isArray(formattedMessages[lastUserIdx].content)
      ? formattedMessages[lastUserIdx].content
      : [{ type: 'text', text: String(formattedMessages[lastUserIdx].content || '') }]
    formattedMessages[lastUserIdx] = { role: 'user', content: [...existing, ...parts] }
    // console.log(
    //   'final messages sent to gemini',
    //   formattedMessages.map(m => m.content)
    // )
  }
  let aborted = false
  let result: any
  try {
    result = await streamText({
      model: google(model),
      tools: tools.reduce(
        (acc, tool) => {
          acc[tool.name] = tool.tool
          return acc
        },
        {} as Record<string, any>
      ),

      stopWhen: stepCountIs(40),
      messages: formattedMessages as any,
      // Enable Gemini "thinking" support per provider guide
      providerOptions: think
        ? {
            google: {
              thinkingConfig: {
                thinkingBudget: 10000,
                includeThoughts: think,
              },
            },
          }
        : undefined,
      // forward aborts from the request or caller
      abortSignal,
      onAbort: () => {
        aborted = true
        console.log('Gemini stream aborted')
      },
    })
  } catch (err: any) {
    if (aborted || err?.name === 'AbortError') {
      return
    }
    // Send the specific error message as a chunk before throwing
    const errorMessage = err?.data?.error?.message || err?.message || String(err)
    onChunk(JSON.stringify({ part: 'error', delta: errorMessage }))
    throw err
  }

  // Prefer full stream (includes reasoning/text parts) when available
  const fullStream: AsyncIterable<any> | undefined =
    (result && (result.fullStream as AsyncIterable<any>)) || (result && (result.dataStream as AsyncIterable<any>))

  try {
    if (fullStream && typeof (fullStream as any)[Symbol.asyncIterator] === 'function') {
      for await (const part of fullStream) {
        try {
          const t = String((part as any)?.type || '')
          // Extract delta from common fields across providers/versions
          const delta: string =
            (part as any)?.delta ??
            (part as any)?.textDelta ??
            (part as any)?.text ??
            (typeof part === 'string' ? part : '')

          if (!delta) continue

          if (think && t.includes('reasoning')) {
            onChunk(JSON.stringify({ part: 'reasoning', delta }))
          } else if (t.includes('tool-call') || t.includes('tool_call') || t.includes('tool-use')) {
            onChunk(JSON.stringify({ part: 'tool_call', delta }))
          } else if (t.includes('text') || typeof part === 'string') {
            onChunk(JSON.stringify({ part: 'text', delta }))
          }
        } catch {
          // Ignore malformed parts
        }
      }
    } else {
      // Fallback: stream plain text deltas
      const { textStream } = result
      for await (const chunk of textStream as AsyncIterable<string>) {
        onChunk(JSON.stringify({ part: 'text', delta: chunk }))
      }
    }
  } catch (err: any) {
    if (aborted || err?.name === 'AbortError') {
      return
    }
    throw err
  }
}
