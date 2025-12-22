/**
 * Raw streaming for Gemini models with tool calls via OpenRouter
 * Bypasses the SDK to preserve reasoning_details (thought_signature)
 * Required because the SDK's Zod validation strips unknown fields
 */

interface GeminiStreamOptions {
  apiKey: string
  model: string
  messages: any[]
  tools?: any[]
  maxTokens?: number
  reasoning?: { effort: 'low' | 'medium' | 'high' }
  abortSignal?: AbortSignal
}

interface StreamCallbacks {
  onText: (text: string) => void
  onReasoning: (text: string) => void
  onReasoningDetails: (details: any[]) => void
  onToolCall: (toolCall: { id: string; name: string; arguments: string }) => void
  onUsage: (usage: any) => void
  onError: (error: string) => void
  onId?: (id: string) => void
  onFinish?: (reason: string) => void
}

/**
 * Convert messages from SDK format (camelCase) to raw API format (snake_case)
 * This is required for the raw OpenRouter API
 */
function convertMessagesToRawFormat(messages: any[]): any[] {
  return messages.map(msg => {
    // Convert content - handle both string and array (multipart) content
    let rawContent = msg.content

    // If content is an array (multipart), convert imageUrl to image_url for raw API
    // The SDK uses camelCase (imageUrl) but raw OpenRouter API expects snake_case (image_url)
    if (Array.isArray(msg.content)) {
      rawContent = msg.content.map((part: any) => {
        // Convert imageUrl (camelCase SDK format) to image_url (snake_case raw API format)
        if (part.type === 'image_url' && part.imageUrl && !part.image_url) {
          return {
            type: 'image_url',
            image_url: part.imageUrl,
          }
        }
        return part
      })
    }

    const rawMsg: any = {
      role: msg.role,
      content: rawContent,
    }

    // Convert toolCalls to tool_calls (snake_case)
    if (msg.toolCalls) {
      rawMsg.tool_calls = msg.toolCalls.map((tc: any) => ({
        id: tc.id,
        type: tc.type || 'function',
        function: tc.function,
      }))
    }

    // Convert toolCallId to tool_call_id (snake_case)
    if (msg.toolCallId) {
      rawMsg.tool_call_id = msg.toolCallId
    }

    // Convert reasoningDetails to reasoning_details (snake_case)
    // This is the critical part - the SDK strips this field
    // Only include if the array is non-empty - empty arrays cause Gemini API errors for parallel tool calls
    if (msg.reasoningDetails && Array.isArray(msg.reasoningDetails) && msg.reasoningDetails.length > 0) {
      rawMsg.reasoning_details = msg.reasoningDetails
      // console.log('🧠 [geminiRaw] Including reasoning_details in message:', JSON.stringify(msg.reasoningDetails).substring(0, 200))
    }

    return rawMsg
  })
}

export async function streamGeminiWithReasoningDetails(
  options: GeminiStreamOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  // console.log('[GEMINI RAW] Starting raw stream for model:', options.model)
  // console.log('[GEMINI RAW] Messages count:', options.messages.length)

  // Convert messages to raw API format
  const rawMessages = convertMessagesToRawFormat(options.messages)

  // Log the raw messages being sent
  // console.log('[GEMINI RAW] Raw messages payload:', JSON.stringify(rawMessages, null, 2).substring(0, 3000))

  const requestBody: any = {
    model: options.model,
    messages: rawMessages,
    stream: true,
    max_tokens: options.maxTokens || 20000,
  }

  if (options.tools && options.tools.length > 0) {
    requestBody.tools = options.tools
  }

  if (options.reasoning) {
    requestBody.reasoning = options.reasoning
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://yggchat.com',
      'X-Title': process.env.OPENROUTER_TITLE || 'Yggdrasil',
    },
    body: JSON.stringify(requestBody),
    signal: options.abortSignal,
  })

  if (!response.ok) {
    const error = await response.text()
    console.error('[GEMINI RAW] API error:', response.status, error)
    callbacks.onError(`OpenRouter API error: ${response.status} - ${error}`)
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let currentToolCall: { id: string; name: string; arguments: string } | null = null
  let toolCallBuffer = ''

  while (reader) {
    const { done, value } = await reader.read()
    if (done) {
      // console.log('[GEMINI RAW] Stream done')
      break
    }

    buffer += decoder.decode(value, { stream: true })

    // Process complete SSE lines
    const lines = buffer.split('\n')
    buffer = lines.pop() || '' // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmedLine = line.trim()

      if (!trimmedLine || trimmedLine === 'data: [DONE]') {
        continue
      }

      if (trimmedLine.startsWith('data: ')) {
        const jsonStr = trimmedLine.slice(6)
        try {
          const chunk = JSON.parse(jsonStr)

          // Capture generation ID
          if (chunk.id && callbacks.onId) {
            callbacks.onId(chunk.id)
          }

          // Capture usage
          if (chunk.usage) {
            callbacks.onUsage(chunk.usage)
          }

          // Check for reasoning_details at chunk level (outside choices)
          // Only emit if the array is non-empty - empty arrays cause Gemini API errors
          if (chunk.reasoning_details || chunk.reasoningDetails) {
            const details = chunk.reasoning_details || chunk.reasoningDetails
            if (Array.isArray(details) && details.length > 0) {
              // console.log('🧠 [geminiRaw] Found reasoning_details at chunk level')
              callbacks.onReasoningDetails(details)
            }
          }

          const choice = chunk.choices?.[0]
          if (!choice) continue

          // Check for reasoning_details at choice level
          if (choice.reasoning_details || choice.reasoningDetails) {
            const details = choice.reasoning_details || choice.reasoningDetails
            if (Array.isArray(details) && details.length > 0) {
              // console.log('🧠 [geminiRaw] Found reasoning_details at choice level')
              callbacks.onReasoningDetails(details)
            }
          }

          const delta = choice.delta
          if (!delta) continue

          // Handle text content
          if (delta.content) {
            callbacks.onText(delta.content)
          }

          // Handle reasoning content
          if (delta.reasoning) {
            callbacks.onReasoning(delta.reasoning)
          }

          // Handle reasoning_details (the encrypted thought_signature) at delta level
          // Only emit if the array is non-empty - empty arrays cause Gemini API errors
          if (delta.reasoning_details || delta.reasoningDetails) {
            const details = delta.reasoning_details || delta.reasoningDetails
            if (Array.isArray(details) && details.length > 0) {
              // console.log('🧠 [geminiRaw] Found reasoning_details at delta level')
              callbacks.onReasoningDetails(details)
            }
          }

          // Handle tool calls
          if (delta.tool_calls || delta.toolCalls) {
            const toolCalls = delta.tool_calls || delta.toolCalls
            for (const tc of toolCalls) {
              if (tc.id && tc.function?.name) {
                // New tool call
                currentToolCall = {
                  id: tc.id,
                  name: tc.function.name,
                  arguments: tc.function.arguments || '',
                }
                toolCallBuffer = tc.function.arguments || ''
              } else if (currentToolCall && tc.function?.arguments) {
                // Continue existing tool call
                toolCallBuffer += tc.function.arguments
                currentToolCall.arguments = toolCallBuffer
              }

              // Try to emit complete tool call
              if (currentToolCall && toolCallBuffer) {
                try {
                  JSON.parse(toolCallBuffer)
                  // Valid JSON - emit the tool call
                  callbacks.onToolCall({
                    id: currentToolCall.id,
                    name: currentToolCall.name,
                    arguments: toolCallBuffer,
                  })
                  currentToolCall = null
                  toolCallBuffer = ''
                } catch {
                  // Not complete JSON yet, continue accumulating
                }
              }
            }
          }

          // Handle finish reason
          if (choice.finish_reason && callbacks.onFinish) {
            callbacks.onFinish(choice.finish_reason)
          }
        } catch (parseError) {
          console.error('[GEMINI RAW] Failed to parse SSE chunk:', jsonStr.substring(0, 200))
        }
      }
    }
  }

  // Emit any remaining tool call
  if (currentToolCall && toolCallBuffer) {
    try {
      JSON.parse(toolCallBuffer)
      callbacks.onToolCall({
        id: currentToolCall.id,
        name: currentToolCall.name,
        arguments: toolCallBuffer,
      })
    } catch {
      console.warn('[GEMINI RAW] Incomplete tool call at end of stream:', currentToolCall.name)
    }
  }
}

/**
 * Check if a message array contains reasoning_details that need to be preserved
 */
export function hasReasoningDetails(messages: any[]): boolean {
  return messages.some(msg => msg.reasoningDetails || msg.reasoning_details)
}

/**
 * Check if a model is a Gemini model that requires reasoning_details preservation
 */
export function isGeminiModelRequiringReasoningDetails(model: string): boolean {
  return model.includes('gemini-3') || model.includes('gemini-2.5')
}
