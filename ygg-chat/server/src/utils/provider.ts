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
  userId?: string
): Promise<void> {
  const providerModel = getProviderModel(provider, model)

  // Build a simple textual note for attachments when providers are text-only in our current setup
  const attachmentNote =
    Array.isArray(attachments) && attachments.length > 0
      ? `Attached ${attachments.length} image(s):\n${attachments
          .map((a, idx) => `  ${idx + 1}. ${a.url || '(inline image)'}${a.mimeType ? ` (${a.mimeType})` : ''}`)
          .join('\n')}`
      : ''

  // Prepare messages for AI SDK providers (text-only content objects)
  const aiSdkBase = messages
    .filter(msg => msg.content && msg.content.trim() !== '')
    .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content }))

  // Optionally prepend a dummy user context message
  const aiSdkMessages =
    conversationContext && conversationContext.trim()
      ? ([{ role: 'user' as const, content: conversationContext.trim() }, ...aiSdkBase] as Array<{
          role: 'user' | 'assistant'
          content: string
        }>)
      : aiSdkBase

  const aiSdkMessagesWithNote = attachmentNote
    ? [...aiSdkMessages, { role: 'user' as const, content: attachmentNote }]
    : aiSdkMessages

  // Prepend system prompt (for AI SDK providers) if provided
  const aiSdkForOpenAI = systemPrompt
    ? ([{ role: 'system' as const, content: systemPrompt }, ...aiSdkMessagesWithNote] as Array<{
        role: 'user' | 'assistant' | 'system'
        content: string
      }>)
    : (aiSdkMessagesWithNote as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>)

  const aiSdkForGemini = systemPrompt
    ? ([{ role: 'system' as const, content: systemPrompt }, ...aiSdkMessages] as Array<{
        role: 'user' | 'assistant' | 'system'
        content: string
      }>)
    : (aiSdkMessages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>)

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
        userId
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
