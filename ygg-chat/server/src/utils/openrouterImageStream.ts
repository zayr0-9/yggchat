/**
 * Raw streaming for OpenRouter image generation models
 * Bypasses the SDK to get access to delta.images in SSE stream
 */

interface ImageStreamOptions {
  apiKey: string
  model: string
  messages: any[]
  maxTokens?: number
  abortSignal?: AbortSignal
}

interface StreamCallbacks {
  onText: (text: string) => void
  onImage: (imageUrl: string, mimeType: string) => void
  onUsage: (usage: any) => void
  onError: (error: string) => void
  onId?: (id: string) => void
}

export async function streamImageGeneration(options: ImageStreamOptions, callbacks: StreamCallbacks): Promise<void> {
  // console.log('[IMAGE STREAM] Starting raw image generation stream for model:', options.model)
  // console.log('[IMAGE STREAM] Messages count:', options.messages.length)
  // console.log('[IMAGE STREAM] Messages: ', JSON.stringify(options.messages, (_, v) =>
  //   typeof v === 'string' && v.length > 100 ? v.slice(0, 50) + '...[truncated]...' + v.slice(-50) : v
  // ))
  // Log each message structure to debug if images are included
  for (let i = 0; i < options.messages.length; i++) {
    const msg = options.messages[i]
    const contentType = Array.isArray(msg.content) ? 'multipart' : typeof msg.content
    const partCount = Array.isArray(msg.content) ? msg.content.length : 0
    const partTypes = Array.isArray(msg.content) ? msg.content.map((p: any) => p.type).join(',') : 'n/a'
    // console.log(
    //   `[IMAGE STREAM] Message[${i}]: role=${msg.role}, contentType=${contentType}, parts=${partCount}, partTypes=${partTypes}`
    // )
    // if (Array.isArray(msg.content)) {
    //   for (const part of msg.content) {
    //     if (part.type === 'image_url') {
    //       const urlPreview = part.image_url?.url?.substring(0, 50) || 'no url'
    //       // console.log(`[IMAGE STREAM]   -> image_url found, starts with: ${urlPreview}...`)
    //     }
    //   }
    //   }
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_REFERER || 'https://yggchat.com',
      'X-Title': process.env.OPENROUTER_TITLE || 'Yggdrasil',
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      modalities: ['image', 'text'],
      stream: true,
      max_tokens: options.maxTokens || 20000,
    }),
    signal: options.abortSignal,
  })

  if (!response.ok) {
    const error = await response.text()
    // console.log('[IMAGE STREAM] API error:', response.status, error)
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`)
  }

  // console.log('[IMAGE STREAM] Response OK, starting to read stream')
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()

  let chunkCount = 0
  let imageCount = 0
  let buffer = '' // Buffer for incomplete SSE data
  const sentImageUrls = new Set<string>() // Track sent images to prevent duplicates

  // Buffer for images found during the stream
  const bufferedImages: string[] = []

  while (reader) {
    const { done, value } = await reader.read()
    if (done) {
      // console.log('[IMAGE STREAM] Stream done. Total chunks:', chunkCount, 'Images found:', imageCount)

      // Emit the last buffered image if any
      if (bufferedImages.length > 0) {
        const lastImage = bufferedImages[bufferedImages.length - 1]
        // console.log('[IMAGE STREAM] Emitting final image (count: ' + bufferedImages.length + '), URL length:', lastImage.length)
        callbacks.onImage(lastImage, 'image/png')
      }

      break
    }

    // Append new data to buffer
    buffer += decoder.decode(value, { stream: true })

    // Process complete lines from buffer
    const lines = buffer.split('\n')
    // Keep the last (potentially incomplete) line in the buffer
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') {
          // console.log('[IMAGE STREAM] Received [DONE] signal')
          continue
        }

        try {
          const parsed = JSON.parse(data)
          chunkCount++

          // Extract Generation ID
          if (parsed.id && callbacks.onId) {
            callbacks.onId(parsed.id)
          }

          // Log chunks (truncate large ones to avoid flooding logs)
          const logStr = JSON.stringify(parsed)
          if (logStr.length > 500) {
            // console.log(
            //   // '[IMAGE STREAM] Chunk #' + chunkCount + ' (truncated, length=' + logStr.length + '):',
            //   logStr.substring(0, 500) + '...'
            // )
          }
          // else {
          //   console.log('[IMAGE STREAM] Chunk #' + chunkCount + ':', logStr)
          // }

          // Also check for message.images (not just delta.images)
          const choice = parsed.choices?.[0]
          // if (choice?.message?.images) {
          //   // console.log('[IMAGE STREAM] FOUND images in message.images!')
          // }
          // if (choice?.delta?.images) {
          //   console.log('[IMAGE STREAM] FOUND images in delta.images!')
          // }

          // Handle usage
          if (parsed.usage) {
            // console.log('[IMAGE STREAM] Usage received:', JSON.stringify(parsed.usage))
            callbacks.onUsage(parsed.usage)
          }

          if (parsed.choices?.[0]) {
            const delta = parsed.choices[0].delta

            // Handle text content
            if (delta?.content) {
              callbacks.onText(delta.content)
            }

            // Handle images - check both delta.images and message.images
            const images = delta?.images || parsed.choices?.[0]?.message?.images
            if (images && Array.isArray(images)) {
              // console.log('[IMAGE STREAM] FOUND IMAGES:', images.length)
              for (const image of images) {
                const imageUrl = image.image_url?.url || image.url
                if (imageUrl) {
                  // Buffer the image instead of sending immediately
                  if (!sentImageUrls.has(imageUrl)) {
                    bufferedImages.push(imageUrl)
                    sentImageUrls.add(imageUrl)
                    imageCount++
                    // console.log('[IMAGE STREAM] Buffered image #' + imageCount + ', URL length:', imageUrl.length)
                  }
                  // else {
                  //   console.log('[IMAGE STREAM] Skipping duplicate image URL during buffer:', imageUrl.substring(0, 50) + '...')
                  // }
                }
              }
            }
          }
        } catch (e) {
          // Log partial data that failed to parse (might be split across chunks)
          // console.log(
          //   '[IMAGE STREAM] JSON parse error, data length:',
          //   data.length,
          //   'starts with:',
          //   data.substring(0, 100)
          // )
        }
      }
    }
  }
}

// Helper to detect image generation models
export function isImageGenerationModel(model: string): boolean {
  const imageModelPatterns = [
    'gemini-2.5-flash-image',
    'gemini-2.0-flash-exp',
    'gemini-3-pro-image-preview',
    'gpt-5-image-mini',

    // May support image gen
    // Add more as needed
  ]
  return imageModelPatterns.some(pattern => model.includes(pattern))
}
