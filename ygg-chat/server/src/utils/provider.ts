// server/src/utils/provider.ts
import { MessageId, ReasoningConfig } from '../../../shared/types'
import { Message } from '../database/models'

import { generateResponse as anthropicGenerate } from './anthropic'
import { generateResponse as geminiGenerate } from './gemini'
import { generateResponse as lmstudioGenerate } from './lmstudio'
import { generateResponse as ollamaGenerate } from './ollama'
import { generateResponse as openaiGenerate } from './openai'
import { generateResponse as openrouterGenerate } from './openrouter'
import { ImageConfig, isImageGenerationModel } from './openrouterImageStream'

export type ProviderType = 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'lmstudio'

function getProviderModel(provider: ProviderType, model?: string): string {
  switch (provider) {
    case 'ollama':
      return model || 'llama3.1:8b' // Use ollama model as-is
    case 'gemini':
      return model || 'gemini-2.5-flash' // Respect client-selected Gemini model, default to gemini-2.5-flash
    case 'anthropic':
      return model || 'claude-3-5-sonnet-latest' // Respect client-selected Anthropic model, default to Claude 3.5 Sonnet
    case 'openai':
      return model || 'gpt-4o' // Respect client-selected OpenAI model, default to gpt-4o
    case 'openrouter':
      return model || 'openrouter/auto' // Respect client-selected OpenRouter model, default to auto selection
    case 'lmstudio':
      return model || 'llama-3.2-1b' // Respect client-selected LM Studio model, default to llama-3.2-1b
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export async function generateResponse(
  messages: Message[],
  onChunk: (chunk: string) => void,
  provider: ProviderType,
  model?: string,
  attachments?: Array<{ url?: string; mimeType?: string; filePath?: string }>,
  systemPrompt?: string,
  abortSignal?: AbortSignal,
  conversationContext?: string | null,
  think?: boolean,
  messageId?: MessageId,
  userId?: string,
  conversationId?: string,
  executionMode: 'server' | 'client' = 'server',
  storageMode: 'cloud' | 'local' = 'cloud',
  isElectron: boolean = false,
  imageConfig?: ImageConfig,
  reasoningConfig?: ReasoningConfig
): Promise<void> {
  const providerModel = getProviderModel(provider, model)

  // Build a simple textual note for attachments when providers are text-only in our current setup
  // Note: Don't include the full data URL - just describe the image to avoid duplicating massive base64 data
  const attachmentNote =
    Array.isArray(attachments) && attachments.length > 0
      ? `Attached ${attachments.length} image(s):\n${attachments
          .map((a, idx) => {
            const urlDesc = a.url?.startsWith('data:') ? '(inline base64 image)' : a.url || '(inline image)'
            return `  ${idx + 1}. ${urlDesc}${a.mimeType ? ` (${a.mimeType})` : ''}`
          })
          .join('\n')}`
      : ''

  // Auto-attach logic for OpenRouter image editing
  if (provider === 'openrouter' && isImageGenerationModel(providerModel)) {
    // Only applies if we have at least 2 messages (assistant -> user)
    if (messages.length >= 2) {
      const lastMsg = messages[messages.length - 1] as any
      const prevMsg = messages[messages.length - 2] as any

      if (lastMsg?.role === 'user' && prevMsg?.role === 'assistant') {
        const prevContentBlocks = (prevMsg.content_blocks || []) as any[]
        // Check if previous message had an image
        const imageBlock = prevContentBlocks.find((b: any) => b.type === 'image')

        if (imageBlock && imageBlock.url) {
          // Check if current user message already handles images (uploaded by user)
          const userContentBlocks = (lastMsg.content_blocks || []) as any[]
          const userHasImages = userContentBlocks.some((b: any) => b.type === 'image' || b.type === 'image_url')

          if (!userHasImages) {
            console.log(
              '🖼️ [provider] Auto-attaching previous generated image to user message for image-to-image editing context'
            )

            // Ensure content_blocks array exists
            if (!lastMsg.content_blocks) {
              lastMsg.content_blocks = []
            }
            // If starting empty but has text content, migrate text to block first
            if (lastMsg.content_blocks.length === 0 && lastMsg.content) {
              lastMsg.content_blocks.push({ type: 'text', text: lastMsg.content })
            }

            // Append the image block
            // Note: We use 'image' type here, standard provider conversion will handle it
            lastMsg.content_blocks.push({
              type: 'image',
              url: imageBlock.url,
              mimeType: imageBlock.mimeType || 'image/png',
            })
          }
        }
      }
    }
  }

  // Convert a single message's content_blocks to OpenAI format messages
  // Handles sequential blocks: [text, tool_use, tool_result, text, image] -> multiple messages
  const convertContentBlocksToOpenAIMessages = (contentBlocks: any[]): any[] => {
    // console.log('📦 [provider] Converting content_blocks:', contentBlocks.length, 'blocks')
    // console.log('📦 [provider] Block types:', contentBlocks.map(b => b.type))

    const result: any[] = []
    let currentText = ''
    let currentImages: Array<{ url: string; mimeType?: string }> = [] // Track images for multipart content
    let currentToolCalls: any[] = []
    let pendingToolResults: any[] = []
    let currentReasoningDetails: any[] = [] // Track reasoning_details for Gemini models

    for (let i = 0; i < contentBlocks.length; i++) {
      const block = contentBlocks[i]
      // console.log(`📦 [provider] Processing block ${i}: type=${block.type}`)

      if (block.type === 'text') {
        const textContent = block.content || block.text || ''

        // If we have pending tool results, we need to flush them first
        // then this text becomes a new assistant message
        if (pendingToolResults.length > 0) {
          // Flush tool results
          for (const toolResult of pendingToolResults) {
            result.push(toolResult)
          }
          pendingToolResults = []

          // This text is the assistant's response after tool execution
          // We'll accumulate it in case there are more text blocks
          currentText = textContent
        } else if (currentToolCalls.length > 0) {
          // We have tool calls but haven't flushed them yet
          // This shouldn't happen (tool_result should come before next text)
          // But handle it by flushing the tool calls first
          const assistantMsg: any = {
            role: 'assistant',
            content: currentText || null,
            tool_calls: currentToolCalls,
          }
          // Attach reasoning_details if present (required by Gemini for parallel tool calls)
          if (currentReasoningDetails.length > 0) {
            assistantMsg.reasoningDetails = currentReasoningDetails
            // console.log('🧠 [provider] Attached reasoningDetails to assistant message:', currentReasoningDetails.length, 'entries')
            currentReasoningDetails = []
          }
          result.push(assistantMsg)
          currentText = textContent
          currentToolCalls = []
        } else {
          // Normal case: accumulate text
          currentText += textContent
        }
      } else if (block.type === 'image') {
        // Handle assistant-generated images
        // PROPER HANDLING: OpenAI/OpenRouter spec does NOT allow image_url in assistant messages.
        // We must convert this to a text representation to pass validation.
        const imageUrl = block.url || block.image_url?.url
        if (imageUrl) {
          if (currentText) currentText += '\n\n'

          // Safety: If it's a data URI (base64), use a placeholder to avoid exploding context window
          if (imageUrl.startsWith('data:')) {
            currentText += '[Generated Image]'
          } else {
            // For remote URLs, it's safe to include the link
            currentText += `[Generated Image: ${imageUrl}]`
          }
          // console.log(`📦 [provider] Converted assistant image to text placeholder for validation safety`)
        }
      } else if (block.type === 'thinking') {
        // Skip thinking blocks for OpenAI format (handled via reasoning param)
        // Could optionally prepend to text as a note
      } else if (block.type === 'reasoning_details') {
        // Extract reasoning_details (Gemini thought_signature) - required for parallel tool calls
        const details = block.reasoningDetails || block.reasoning_details
        if (Array.isArray(details) && details.length > 0) {
          currentReasoningDetails.push(...details)
          // console.log('🧠 [provider] Extracted reasoning_details from content_blocks:', details.length, 'entries')
        }
      } else if (block.type === 'tool_use') {
        // Skip invalid tool_use blocks that are missing required fields
        if (!block.id || !block.name) {
          console.error(`❌ [provider] Skipping invalid tool_use block: id=${block.id}, name=${block.name}`)
          continue
        }

        // IMPORTANT: Flush any pending tool results FIRST before adding new tool call
        // This ensures proper interleaving: assistant(calls) → tool(results) → assistant(calls) → ...
        if (pendingToolResults.length > 0) {
          // console.log(`🔄 [provider] Flushing ${pendingToolResults.length} pending tool results before new tool_use`)
          for (const toolResult of pendingToolResults) {
            result.push(toolResult)
          }
          pendingToolResults = []
        }

        // Convert to OpenAI tool_call format
        // console.log(`🔧 [provider] Found tool_use: id=${block.id}, name=${block.name}`)
        const toolCall = {
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
          },
        }
        currentToolCalls.push(toolCall)
      } else if (block.type === 'tool_result') {
        // console.log(`✅ [provider] Found tool_result: tool_use_id=${block.tool_use_id}`)
        // If we have accumulated tool calls, flush them first
        if (currentToolCalls.length > 0) {
          // console.log(`🔄 [provider] Flushing ${currentToolCalls.length} tool calls before tool_result`)
          const assistantMsg: any = {
            role: 'assistant',
            content: currentText || null,
            tool_calls: currentToolCalls,
          }
          // Attach reasoning_details if present (required by Gemini for parallel tool calls)
          if (currentReasoningDetails.length > 0) {
            assistantMsg.reasoningDetails = currentReasoningDetails
            // console.log('🧠 [provider] Attached reasoningDetails to assistant message:', currentReasoningDetails.length, 'entries')
            currentReasoningDetails = []
          }
          result.push(assistantMsg)
          currentText = ''
          currentToolCalls = []
        }

        // Create tool result message
        const toolResultMsg = {
          role: 'tool' as const,
          tool_call_id: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
        }
        // console.log(`✅ [provider] Created tool result message: tool_call_id=${toolResultMsg.tool_call_id}`)
        pendingToolResults.push(toolResultMsg)
      }
    }

    // Flush any remaining content
    if (currentToolCalls.length > 0) {
      // If we have images alongside tool calls, use multipart format
      let toolCallContent: any = currentText || null
      if (currentImages.length > 0) {
        const contentParts: any[] = []
        if (currentText.trim()) {
          contentParts.push({ type: 'text', text: currentText })
        }
        for (const img of currentImages) {
          contentParts.push({ type: 'image_url', image_url: { url: img.url } })
        }
        toolCallContent = contentParts
        currentImages = []
      }
      const assistantMsg: any = {
        role: 'assistant',
        content: toolCallContent,
        tool_calls: currentToolCalls,
      }
      // Attach reasoning_details if present (required by Gemini for parallel tool calls)
      if (currentReasoningDetails.length > 0) {
        assistantMsg.reasoningDetails = currentReasoningDetails
        // console.log('🧠 [provider] Attached reasoningDetails to final assistant message:', currentReasoningDetails.length, 'entries')
        currentReasoningDetails = []
      }
      result.push(assistantMsg)
      currentText = ''
    }

    // Flush pending tool results
    for (const toolResult of pendingToolResults) {
      result.push(toolResult)
    }

    // If we have remaining text/images (after tool results), create final assistant message
    if (currentText.trim() || currentImages.length > 0) {
      if (currentImages.length > 0) {
        // Use multipart format when we have images
        const contentParts: any[] = []
        if (currentText.trim()) {
          contentParts.push({ type: 'text', text: currentText })
        }
        for (const img of currentImages) {
          contentParts.push({ type: 'image_url', image_url: { url: img.url } })
        }
        result.push({ role: 'assistant', content: contentParts })
      } else {
        result.push({ role: 'assistant', content: currentText })
      }
    }

    // console.log(`📦 [provider] Conversion result: ${result.length} messages`)
    // result.forEach((msg, idx) => {
    //   if (msg.role === 'tool') {
    //     console.log(`  [${idx}] role=tool, tool_call_id=${msg.tool_call_id}`)
    //   } else if (msg.tool_calls) {
    //     console.log(`  [${idx}] role=assistant, tool_calls=${msg.tool_calls.length}`)
    //   } else {
    //     console.log(`  [${idx}] role=${msg.role}, content_length=${msg.content?.length || 0}`)
    //   }
    // })

    return result
  }

  // Convert messages to OpenAI format, properly handling tool_calls and tool results
  const convertMessagesToOpenAIFormat = (msgs: Message[]): any[] => {
    // console.log(`📤 [provider] Converting ${msgs.length} messages to OpenAI format`)
    const result: any[] = []

    for (let msgIdx = 0; msgIdx < msgs.length; msgIdx++) {
      const msg = msgs[msgIdx]
      const role = msg.role === 'ex_agent' ? 'assistant' : msg.role

      // Check if message has artifacts (images)
      const msgArtifacts = (msg as any).artifacts
      const hasArtifacts = Array.isArray(msgArtifacts) && msgArtifacts.length > 0

      // console.log(
      //   `📤 [provider] Message ${msgIdx}: role=${msg.role}, has_content_blocks=${!!(msg.content_blocks && msg.content_blocks.length > 0)}, has_artifacts=${hasArtifacts}, content_length=${msg.content?.length || 0}`
      // )

      // Check if message has content_blocks with tool information
      if (msg.content_blocks && Array.isArray(msg.content_blocks) && msg.content_blocks.length > 0) {
        // console.log(`📤 [provider] Message ${msgIdx} has ${msg.content_blocks.length} content_blocks`)
        if (role === 'assistant') {
          // Convert content_blocks to proper OpenAI message sequence
          const convertedMessages = convertContentBlocksToOpenAIMessages(msg.content_blocks)
          // console.log(`📤 [provider] Message ${msgIdx} expanded to ${convertedMessages.length} OpenAI messages`)
          result.push(...convertedMessages)
        } else {
          // For user messages, extract text AND images from content_blocks
          const textBlocks = msg.content_blocks
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.content || block.text || '')
            .join('')

          const imageBlocks = msg.content_blocks.filter(
            (block: any) => block.type === 'image' || block.type === 'image_url'
          )

          const mergedText = (textBlocks || '') + (msg.content || '')

          if (mergedText || imageBlocks.length > 0) {
            // Check if user message has artifacts (images) from attachments
            // Combine everything into multipart content
            if (hasArtifacts || imageBlocks.length > 0) {
              const contentParts: any[] = []

              if (mergedText) {
                contentParts.push({ type: 'text', text: mergedText })
              }

              // Add images from content_blocks (auto-attached context)
              for (const imgBlock of imageBlocks) {
                const url = imgBlock.url || imgBlock.image_url?.url
                if (url) {
                  contentParts.push({ type: 'image_url', image_url: { url } })
                }
              }

              // Add images from artifacts (user uploads)
              if (hasArtifacts) {
                for (const artifact of msgArtifacts) {
                  if (typeof artifact === 'string' && artifact.startsWith('data:')) {
                    contentParts.push({ type: 'image_url', image_url: { url: artifact } })
                  }
                }
              }

              result.push({ role: 'user', content: contentParts })
            } else {
              // Just text
              result.push({
                role: role as 'user' | 'assistant',
                content: mergedText,
              })
            }
          }
        }
      } else if (msg.tool_calls && msg.role === 'assistant') {
        // Fallback: handle old format with tool_calls as JSON string
        let parsedToolCalls: any[] = []
        try {
          const toolCallsData = typeof msg.tool_calls === 'string' ? JSON.parse(msg.tool_calls) : msg.tool_calls
          parsedToolCalls = (Array.isArray(toolCallsData) ? toolCallsData : [toolCallsData]).map((tc: any) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments:
                typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || tc.input || {}),
            },
          }))
        } catch (e) {
          // If parsing fails, skip tool_calls
        }

        if (parsedToolCalls.length > 0) {
          const assistantMsg: any = {
            role: 'assistant',
            content: msg.content || null,
            tool_calls: parsedToolCalls,
          }
          // Preserve reasoning_details if present on the message (required by Gemini for parallel tool calls)
          const msgReasoningDetails = (msg as any).reasoningDetails || (msg as any).reasoning_details
          if (Array.isArray(msgReasoningDetails) && msgReasoningDetails.length > 0) {
            assistantMsg.reasoningDetails = msgReasoningDetails
            // console.log('🧠 [provider] Attached reasoningDetails from message:', msgReasoningDetails.length, 'entries')
          }
          result.push(assistantMsg)
        } else if (msg.content && msg.content.trim()) {
          result.push({
            role: 'assistant',
            content: msg.content,
          })
        }
      } else if (msg.content && msg.content.trim()) {
        // Regular message without tool_calls - check for artifacts
        if (role === 'user' && hasArtifacts) {
          // User message with images - convert to multipart format
          const contentParts: any[] = [{ type: 'text', text: msg.content }]
          for (const artifact of msgArtifacts) {
            if (typeof artifact === 'string' && artifact.startsWith('data:')) {
              contentParts.push({ type: 'image_url', image_url: { url: artifact } })
            }
          }
          // console.log(`📤 [provider] Message ${msgIdx} (user with artifacts): ${contentParts.length} parts`)
          result.push({ role: 'user', content: contentParts })
        } else {
          result.push({
            role: role as 'user' | 'assistant',
            content: msg.content,
          })
        }
      }
    }

    // console.log(`📤 [provider] Final OpenAI format: ${result.length} messages total`)
    // console.log(
    //   `📤 [provider] Message roles:`,
    //   result.map(m => m.role)
    // )
    // console.log(`📤 [provider] Tool messages count:`, result.filter(m => m.role === 'tool').length)
    // console.log(`📤 [provider] Assistant messages with tool_calls:`, result.filter(m => m.tool_calls).length)

    return result
  }

  // Prepare messages for AI SDK providers (with proper OpenAI format)
  const aiSdkBase = convertMessagesToOpenAIFormat(messages)

  // Optionally prepend a dummy user context message
  const aiSdkMessages =
    conversationContext && conversationContext.trim()
      ? [{ role: 'user' as const, content: conversationContext.trim() }, ...aiSdkBase]
      : aiSdkBase

  const aiSdkMessagesWithNote = attachmentNote
    ? [...aiSdkMessages, { role: 'user' as const, content: attachmentNote }]
    : aiSdkMessages

  // Prepend system prompt (for AI SDK providers) if provided
  // Note: aiSdkBase may contain tool messages and tool_calls, so we use 'any' for flexibility
  const aiSdkForOpenAI = systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...aiSdkMessagesWithNote]
    : aiSdkMessagesWithNote

  const aiSdkForGemini = systemPrompt
    ? [{ role: 'system' as const, content: systemPrompt }, ...aiSdkMessages]
    : aiSdkMessages

  const aiSdkForAnthropic = aiSdkForGemini

  // Prepare messages for Ollama (expects Message[], but we only use role/content fields)
  const ollamaBase: any[] = (() => {
    const cloned = messages.map(m => ({ ...m })) as any[]
    if (conversationContext && conversationContext.trim()) {
      const template = cloned[0] ?? {}
      // Prepend synthetic user context message
      return [{ ...template, role: 'user', content: conversationContext.trim() }, ...cloned]
    }
    return cloned
  })()

  const ollamaMessagesWithNote: Message[] = (() => {
    if (!attachmentNote) return ollamaBase as Message[]
    // Clone and append note to the last user message to preserve chronology
    const cloned: any[] = ollamaBase.map(m => ({ ...m }))
    for (let i = cloned.length - 1; i >= 0; i--) {
      if (cloned[i].role === 'user') {
        cloned[i].content = `${cloned[i].content}\n\n${attachmentNote}`
        return cloned as Message[]
      }
    }
    // If no user message found, append a synthetic trailing user note
    return [
      ...cloned,
      { ...(cloned[cloned.length - 1] || {}), role: 'user', content: attachmentNote },
    ] as any as Message[]
  })()

  switch (provider) {
    case 'ollama':
      return ollamaGenerate(ollamaMessagesWithNote, onChunk, providerModel, systemPrompt, true)
    case 'gemini': {
      // Forward attachments so Gemini can inline images
      const geminiAttachments = (attachments || []).map(a => ({ mimeType: a.mimeType, filePath: a.filePath }))
      return geminiGenerate(aiSdkForGemini, onChunk, providerModel, geminiAttachments, abortSignal, think)
    }
    case 'anthropic': {
      // For Anthropic, forward attachments so we can construct image+text content parts
      const anthroAttachments = (attachments || []).map(a => ({
        url: a.url,
        mimeType: a.mimeType,
        filePath: a.filePath,
      }))
      return anthropicGenerate(aiSdkForAnthropic, onChunk, providerModel, anthroAttachments, abortSignal, think)
    }
    case 'openai':
      return openaiGenerate(aiSdkForOpenAI, onChunk, providerModel)
    case 'openrouter': {
      // Forward attachments for OpenRouter (AI SDK OpenAI adapter will translate file parts)
      const orAttachments = (attachments || []).map(a => ({ mimeType: a.mimeType, filePath: a.filePath, url: a.url }))
      return openrouterGenerate(
        aiSdkForOpenAI,
        onChunk,
        providerModel,
        orAttachments,
        abortSignal,
        think,
        messageId,
        userId,
        true,
        conversationId,
        executionMode,
        storageMode,
        isElectron,
        imageConfig,
        reasoningConfig
      )
    }
    case 'lmstudio': {
      // Forward attachments for LM Studio (AI SDK OpenAI-compatible adapter will translate file parts)
      const lmAttachments = (attachments || []).map(a => ({ mimeType: a.mimeType, filePath: a.filePath }))
      return lmstudioGenerate(aiSdkForOpenAI, onChunk, providerModel, lmAttachments, abortSignal, think)
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}
export type ProviderAttachment = {
  url?: string
  mimeType?: string
  filePath?: string
  sha256?: string
  base64Data?: string
}
