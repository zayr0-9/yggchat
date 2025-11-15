// server/src/utils/provider.ts
import { MessageId } from '../../../shared/types'
import { Message } from '../database/models'

import { generateResponse as anthropicGenerate } from './anthropic'
import { generateResponse as geminiGenerate } from './gemini'
import { generateResponse as lmstudioGenerate } from './lmstudio'
import { generateResponse as ollamaGenerate } from './ollama'
import { generateResponse as openaiGenerate } from './openai'
import { generateResponse as openrouterGenerate } from './openrouter'

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
  conversationId?: string
): Promise<void> {
  const providerModel = getProviderModel(provider, model)

  // Build a simple textual note for attachments when providers are text-only in our current setup
  const attachmentNote =
    Array.isArray(attachments) && attachments.length > 0
      ? `Attached ${attachments.length} image(s):\n${attachments
          .map((a, idx) => `  ${idx + 1}. ${a.url || '(inline image)'}${a.mimeType ? ` (${a.mimeType})` : ''}`)
          .join('\n')}`
      : ''

  // Convert a single message's content_blocks to OpenAI format messages
  // Handles sequential blocks: [text, tool_use, tool_result, text] -> multiple messages
  const convertContentBlocksToOpenAIMessages = (contentBlocks: any[]): any[] => {
    // console.log('📦 [provider] Converting content_blocks:', contentBlocks.length, 'blocks')
    // console.log('📦 [provider] Block types:', contentBlocks.map(b => b.type))

    const result: any[] = []
    let currentText = ''
    let currentToolCalls: any[] = []
    let pendingToolResults: any[] = []

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
          result.push({
            role: 'assistant',
            content: currentText || null,
            tool_calls: currentToolCalls,
          })
          currentText = textContent
          currentToolCalls = []
        } else {
          // Normal case: accumulate text
          currentText += textContent
        }
      } else if (block.type === 'thinking') {
        // Skip thinking blocks for OpenAI format (handled via reasoning param)
        // Could optionally prepend to text as a note
      } else if (block.type === 'tool_use') {
        // IMPORTANT: Flush any pending tool results FIRST before adding new tool call
        // This ensures proper interleaving: assistant(calls) → tool(results) → assistant(calls) → ...
        if (pendingToolResults.length > 0) {
          console.log(`🔄 [provider] Flushing ${pendingToolResults.length} pending tool results before new tool_use`)
          for (const toolResult of pendingToolResults) {
            result.push(toolResult)
          }
          pendingToolResults = []
        }

        // Convert to OpenAI tool_call format
        console.log(`🔧 [provider] Found tool_use: id=${block.id}, name=${block.name}`)
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
          result.push({
            role: 'assistant',
            content: currentText || null,
            tool_calls: currentToolCalls,
          })
          currentText = ''
          currentToolCalls = []
        }

        // Create tool result message
        const toolResultMsg = {
          role: 'tool' as const,
          tool_call_id: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content || ''),
        }
        console.log(`✅ [provider] Created tool result message: tool_call_id=${toolResultMsg.tool_call_id}`)
        pendingToolResults.push(toolResultMsg)
      }
    }

    // Flush any remaining content
    if (currentToolCalls.length > 0) {
      result.push({
        role: 'assistant',
        content: currentText || null,
        tool_calls: currentToolCalls,
      })
      currentText = ''
    }

    // Flush pending tool results
    for (const toolResult of pendingToolResults) {
      result.push(toolResult)
    }

    // If we have remaining text (after tool results), create final assistant message
    if (currentText.trim()) {
      result.push({
        role: 'assistant',
        content: currentText,
      })
    }

    console.log(`📦 [provider] Conversion result: ${result.length} messages`)
    result.forEach((msg, idx) => {
      if (msg.role === 'tool') {
        console.log(`  [${idx}] role=tool, tool_call_id=${msg.tool_call_id}`)
      } else if (msg.tool_calls) {
        console.log(`  [${idx}] role=assistant, tool_calls=${msg.tool_calls.length}`)
      } else {
        console.log(`  [${idx}] role=${msg.role}, content_length=${msg.content?.length || 0}`)
      }
    })

    return result
  }

  // Convert messages to OpenAI format, properly handling tool_calls and tool results
  const convertMessagesToOpenAIFormat = (msgs: Message[]): any[] => {
    console.log(`📤 [provider] Converting ${msgs.length} messages to OpenAI format`)
    const result: any[] = []

    for (let msgIdx = 0; msgIdx < msgs.length; msgIdx++) {
      const msg = msgs[msgIdx]
      const role = msg.role === 'ex_agent' ? 'assistant' : msg.role

      // Check if message has artifacts (images)
      const msgArtifacts = (msg as any).artifacts
      const hasArtifacts = Array.isArray(msgArtifacts) && msgArtifacts.length > 0

      console.log(
        `📤 [provider] Message ${msgIdx}: role=${msg.role}, has_content_blocks=${!!(msg.content_blocks && msg.content_blocks.length > 0)}, has_artifacts=${hasArtifacts}, content_length=${msg.content?.length || 0}`
      )

      // Check if message has content_blocks with tool information
      if (msg.content_blocks && Array.isArray(msg.content_blocks) && msg.content_blocks.length > 0) {
        console.log(`📤 [provider] Message ${msgIdx} has ${msg.content_blocks.length} content_blocks`)
        if (role === 'assistant') {
          // Convert content_blocks to proper OpenAI message sequence
          const convertedMessages = convertContentBlocksToOpenAIMessages(msg.content_blocks)
          console.log(`📤 [provider] Message ${msgIdx} expanded to ${convertedMessages.length} OpenAI messages`)
          result.push(...convertedMessages)
        } else {
          // For user messages, just extract text content
          const textContent = msg.content_blocks
            .filter((block: any) => block.type === 'text')
            .map((block: any) => block.content || block.text || '')
            .join('')
          if (textContent || msg.content) {
            // Check if user message has artifacts (images)
            if (hasArtifacts) {
              const contentParts: any[] = [{ type: 'text', text: textContent || msg.content || '' }]
              for (const artifact of msgArtifacts) {
                if (typeof artifact === 'string' && artifact.startsWith('data:')) {
                  contentParts.push({ type: 'image_url', image_url: { url: artifact } })
                }
              }
              console.log(`📤 [provider] Message ${msgIdx} (user with artifacts): ${contentParts.length} parts`)
              result.push({ role: 'user', content: contentParts })
            } else {
              result.push({
                role: role as 'user' | 'assistant',
                content: textContent || msg.content || '',
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
          result.push({
            role: 'assistant',
            content: msg.content || null,
            tool_calls: parsedToolCalls,
          })
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
          console.log(`📤 [provider] Message ${msgIdx} (user with artifacts): ${contentParts.length} parts`)
          result.push({ role: 'user', content: contentParts })
        } else {
          result.push({
            role: role as 'user' | 'assistant',
            content: msg.content,
          })
        }
      }
    }

    console.log(`📤 [provider] Final OpenAI format: ${result.length} messages total`)
    console.log(
      `📤 [provider] Message roles:`,
      result.map(m => m.role)
    )
    console.log(`📤 [provider] Tool messages count:`, result.filter(m => m.role === 'tool').length)
    console.log(`📤 [provider] Assistant messages with tool_calls:`, result.filter(m => m.tool_calls).length)

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
      const orAttachments = (attachments || []).map(a => ({ mimeType: a.mimeType, filePath: a.filePath }))
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
        conversationId
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
