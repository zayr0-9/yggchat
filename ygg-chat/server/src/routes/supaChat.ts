// server/src/routes/supaChat.ts
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { SendMessageRequest } from '../../../shared/types'
import {
  AttachmentService,
  buildMessageTree,
  ConversationService,
  FileContentService,
  MessageService,
  ProjectService,
  UserService,
  UserSystemPromptService,
} from '../database/supamodels'
import {
  authEndpointsRateLimiter,
  authenticatedRateLimiter,
  expensiveOperationsRateLimiter,
} from '../middleware/rateLimiter'
import { verifyAuth } from '../middleware/supaAuth'
import { asyncHandler } from '../utils/asyncHandler'
import { canAccessPaidModels, canUserGenerate, decrementFreeGeneration, isFreeTierModel } from '../utils/freeTier'
import { abortGeneration, clearGeneration, createGeneration } from '../utils/generationManager'
import { extractJsonObjects } from '../utils/jsonExtractor'
import { modelService } from '../utils/modelService'
import { getCachedOpenRouterModels } from '../utils/openrouterModelsCache'
import { generateResponse } from '../utils/provider'
import { saveBase64ImageAttachmentsForMessage, saveGeneratedImagesToStorage } from '../utils/supaAttachments'
import { getToolByName, updateToolEnabled } from '../utils/tools/index'

console.error('[supaChat] 🚀 Router file loaded/executing')

const router = express.Router()

/**
 * Accumulates consecutive events of the same type into single blocks
 * Matches client-side rendering logic in ChatMessage.tsx
 */
function accumulateContentBlocks(events: any[]): any[] {
  if (!events || events.length === 0) return []

  const accumulated: any[] = []
  let i = 0

  while (i < events.length) {
    const event = events[i]

    if (event.type === 'text' && event.delta) {
      // Accumulate consecutive text events
      let accumulatedText = event.delta
      let j = i + 1
      while (j < events.length && events[j].type === 'text' && events[j].delta) {
        accumulatedText += events[j].delta
        j++
      }
      accumulated.push({ type: 'text', content: accumulatedText })
      i = j
    } else if (event.type === 'reasoning' && event.delta) {
      // Accumulate consecutive reasoning events
      let accumulatedReasoning = event.delta
      let j = i + 1
      while (j < events.length && events[j].type === 'reasoning' && events[j].delta) {
        accumulatedReasoning += events[j].delta
        j++
      }
      accumulated.push({ type: 'thinking', content: accumulatedReasoning })
      i = j
    } else if (event.type === 'tool_call' && event.toolCall && event.complete) {
      // Tool calls are already complete, add as-is (only if valid)
      if (event.toolCall.id && event.toolCall.name) {
        accumulated.push({
          type: 'tool_use',
          id: event.toolCall.id,
          name: event.toolCall.name,
          input: event.toolCall.arguments || {},
        })
      } else {
        console.warn('⚠️ [supaChat] Skipping invalid tool_call event:', event.toolCall)
      }
      i++
    } else if (event.type === 'tool_result' && event.toolResult) {
      // Tool result events - add as tool_result block
      accumulated.push({
        type: 'tool_result',
        tool_use_id: event.toolResult.tool_use_id,
        content: event.toolResult.content,
        is_error: event.toolResult.is_error || false,
      })
      i++
    } else if (event.type === 'image' && event.url) {
      // Image events from image generation models
      accumulated.push({
        type: 'image',
        url: event.url,
        mimeType: event.mimeType || 'image/png',
      })
      i++
    } else if (event.type === 'reasoning_details' && event.reasoningDetails) {
      // Encrypted reasoning details (Gemini thought_signature) - preserve as-is
      accumulated.push({
        type: 'reasoning_details',
        reasoningDetails: event.reasoningDetails,
      })
      i++
    } else {
      i++
    }
  }

  return accumulated
}

// Global search endpoint - Search conversations by title
router.get(
  '/search',
  expensiveOperationsRateLimiter, // Apply expensive operations rate limiter
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req) // ✅ Use user's JWT, not service_role
    const q = (req.query.q as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50)

    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }

    // Search conversations by title using ILIKE (uses GIN trigram index)
    const { data, error } = await client
      .from('conversations')
      .select('id, title, model_name, project_id, created_at, updated_at')
      .ilike('title', `%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Search conversations error:', error)
      return res.status(500).json({ error: 'Failed to search conversations' })
    }

    res.json(data || [])
  })
)

// Search conversations by title within a specific project
router.get(
  '/search/project',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req) // ✅ Use user's JWT
    const q = (req.query.q as string) || ''
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50)

    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }

    const projectId = req.query.projectId as string
    if (!projectId) {
      return res.status(400).json({ error: 'Missing projectId parameter' })
    }

    // Search conversations by title within project using ILIKE (uses GIN trigram index)
    const { data, error } = await client
      .from('conversations')
      .select('id, title, model_name, project_id, created_at, updated_at')
      .eq('project_id', projectId)
      .ilike('title', `%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('Search conversations by project error:', error)
      return res.status(500).json({ error: 'Failed to search conversations' })
    }

    res.json(data || [])
  })
)

// Ephemeral generation endpoint for custom tools and subagent execution
// This allows tool UIs to make one-off LLM generation requests without creating messages/conversations
// Supports image input (attachmentsBase64), image output (for image generation models),
// tool calling (for agentic subagents), and multi-turn conversation history
router.post(
  '/generate/ephemeral',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const { userId } = await verifyAuth(req)
    const {
      prompt,
      model,
      maxTokens,
      temperature,
      systemPrompt,
      attachmentsBase64,
      tools,
      messages: inputMessages,
    } = req.body

    // Either prompt or messages must be provided
    if (!prompt && (!inputMessages || inputMessages.length === 0)) {
      return res.status(400).json({ error: 'Missing prompt or messages' })
    }

    // Check if user can generate
    const canGenerateResult = await canUserGenerate(userId)
    if (!canGenerateResult.canGenerate) {
      return res.status(403).json({ error: canGenerateResult.reason || 'Generation not allowed' })
    }

    // Check if user has paid access for non-free models
    const selectedModel = model || 'anthropic/claude-sonnet-4'
    const hasPaidAccess = await canAccessPaidModels(userId)

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    // Handle client disconnect
    const abortController = new AbortController()
    req.on('close', () => {
      console.log('[ephemeral] Client disconnected')
      abortController.abort()
    })

    try {
      // Use provided messages or create from prompt
      const messages: any[] = inputMessages?.length > 0 ? inputMessages : [{ role: 'user', content: prompt }]

      // Determine provider from model string
      let provider: 'openrouter' | 'anthropic' | 'openai' | 'gemini' = 'openrouter'
      if (selectedModel.startsWith('claude-') && !selectedModel.includes('/')) {
        provider = 'anthropic'
      } else if (selectedModel.startsWith('gpt-') || selectedModel.startsWith('o1')) {
        provider = 'openai'
      } else if (selectedModel.startsWith('gemini-')) {
        provider = 'gemini'
      }

      // Convert base64 attachments to the format expected by generateResponse
      // Format: { url: dataUrl, mimeType: string }
      const attachmentsForGeneration = Array.isArray(attachmentsBase64)
        ? attachmentsBase64.map((att: any) => ({
            url: att.dataUrl,
            mimeType: att.type || 'image/jpeg',
          }))
        : undefined

      await generateResponse(
        messages,
        chunk => {
          try {
            const parsed = JSON.parse(chunk)
            const part = parsed?.part
            const delta = parsed?.delta ?? ''

            if (part === 'text' && delta) {
              res.write(`data: ${JSON.stringify({ text: delta })}\n\n`)
            } else if (part === 'reasoning' && delta) {
              res.write(`data: ${JSON.stringify({ reasoning: delta })}\n\n`)
            } else if (part === 'image') {
              // Handle image output from image generation models
              res.write(
                `data: ${JSON.stringify({ image: parsed.url, mimeType: parsed.mimeType || 'image/png' })}\n\n`
              )
            } else if (part === 'tool_call') {
              // Handle tool call events for agentic subagents
              if (parsed?.toolCall) {
                res.write(`data: ${JSON.stringify({ toolCall: parsed.toolCall })}\n\n`)
              }
            } else if (part === 'tool_result') {
              // Handle tool result events (for multi-turn tool execution)
              if (parsed?.toolResult) {
                res.write(`data: ${JSON.stringify({ toolResult: parsed.toolResult })}\n\n`)
              }
            }
          } catch {
            // If chunk is not valid JSON, treat as raw text
            if (chunk.trim()) {
              res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`)
            }
          }
        },
        provider,
        selectedModel,
        attachmentsForGeneration, // image attachments for vision models
        systemPrompt || undefined,
        abortController.signal,
        undefined, // conversationContext
        false, // think
        undefined, // messageId
        userId,
        undefined, // conversationId
        tools && tools.length > 0 ? 'client' : 'server', // Use client mode when tools provided so server executes SERVER_ONLY_TOOLS and returns others
        tools && tools.length > 0 ? 'local' : 'cloud', // Use local mode when tools are provided (subagent)
        tools && tools.length > 0, // isElectron: true when tools provided to allow all tools
        undefined, // imageConfig
        undefined, // reasoningConfig
        tools // tool definitions for agentic subagents
      )

      // If user doesn't have paid access, decrement free generation count
      if (!hasPaidAccess) {
        await decrementFreeGeneration(userId)
      }

      res.write('data: [DONE]\n\n')
      res.end()
    } catch (error: any) {
      console.error('[ephemeral] Generation error:', error)
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Generation failed' })
      } else {
        res.write(`data: ${JSON.stringify({ error: error.message || 'Generation failed' })}\n\n`)
        res.end()
      }
    }
  })
)

// Fetch openai models on the server to keep API key private
router.get(
  '/models/openai',
  asyncHandler(async (req, res) => {
    try {
      const abortController = new AbortController()
      req.on('close', () => abortController.abort())
      const apiKey = process.env.OPENAI_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing OPENAI_API_KEY' })
      }

      const response = await fetch('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        const text = await response.text()
        return res.status(response.status).json({ error: text || response.statusText })
      }

      const data = (await response.json()) as { data?: any[]; models?: any[] }
      const rawModels: any[] = Array.isArray(data?.data) ? data.data! : Array.isArray(data?.models) ? data.models! : []

      const names: string[] = rawModels.map(m => String(m?.id || m?.name || '')).filter(n => n.length > 0)

      const preferredDefault = 'gpt-4o'
      const defaultModel = names.includes(preferredDefault) ? preferredDefault : names[0] || ''

      res.json({ models: names, default: defaultModel })
    } catch (error) {
      console.error('Error fetching OpenAI models:', error)
      res.status(500).json({ error: 'Failed to fetch OpenAI models' })
    }
  })
)

// Fetch openRouter models on the server to keep API key private
// Uses Redis cache with 30 min TTL to avoid hitting OpenRouter API on every request
router.get(
  '/models/openrouter',
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing OPENROUTER_API_KEY' })
      }

      // Extract userId and check tier (optional auth - works without)
      let userId: string | null = null
      let canAccessPaid = true

      try {
        const authHeader = req.headers.authorization
        if (authHeader?.startsWith('Bearer ')) {
          const { userId: authenticatedUserId } = await verifyAuth(req)
          userId = authenticatedUserId
          canAccessPaid = await canAccessPaidModels(userId)
        }
      } catch (authError) {
        // Unauthenticated - show all models
        console.error(authError)
      }

      // Get models from Redis cache (fetches from API if cache miss)
      const models = await getCachedOpenRouterModels()

      // Mark each model with isFreeTier flag instead of filtering
      // This allows free users to see all models but UI will disable non-free ones
      const modelsWithFreeTierFlag = models.map(model => ({
        ...model,
        isFreeTier: isFreeTierModel(model),
      }))

      const preferredDefault = 'gpt-4o'
      const defaultModel =
        modelsWithFreeTierFlag.find((m: any) => m.name === preferredDefault) || modelsWithFreeTierFlag[0] || null

      res.json({
        models: modelsWithFreeTierFlag,
        default: defaultModel,
        userIsFreeTier: !canAccessPaid, // User's tier status for client-side logic
      })
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error)
      res.status(500).json({ error: 'Failed to fetch OpenRouter models' })
    }
  })
)

// Fetch openRouter ZDR-capable endpoints
router.get(
  '/models/openrouter/zdr',
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing OPENROUTER_API_KEY' })
      }

      const response = await fetch('https://openrouter.ai/api/v1/endpoints/zdr', {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        const text = await response.text()
        return res.status(response.status).json({ error: text || response.statusText })
      }

      const data = (await response.json()) as { data?: any[] }
      const endpoints: any[] = Array.isArray(data?.data) ? data.data! : []

      const normalized = endpoints.map(endpoint => {
        // name format is "Provider | model/id" (e.g., "Groq | qwen/qwen3-32b-04-28")
        // Extract the actual model ID from after the " | " separator
        const nameStr = String(endpoint?.name || '')
        const modelId = nameStr.includes(' | ') ? nameStr.split(' | ')[1] : nameStr

        return {
          id: modelId || '',  // Extracted model ID for API calls (e.g., "qwen/qwen3-32b-04-28")
          displayName: String(endpoint?.model_name || nameStr || ''),  // Human-readable name (e.g., "Qwen: Qwen3 32B")
          providerName: String(endpoint?.provider_name || endpoint?.provider || ''),
          contextLength: Number(endpoint?.context_length ?? 0),
          supportsImplicitCaching: Boolean(endpoint?.supports_implicit_caching),
          pricing: endpoint?.pricing || {},
          supportedParameters: Array.isArray(endpoint?.supported_parameters) ? endpoint.supported_parameters : [],
          raw: endpoint,
        }
      })

      res.json({ endpoints: normalized })
    } catch (error) {
      console.error('Error fetching OpenRouter ZDR endpoints:', error)
      res.status(500).json({ error: 'Failed to fetch OpenRouter ZDR endpoints' })
    }
  })
)

// Fetch Anthropic models on the server to keep API key private
router.get(
  '/models/anthropic',
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.ANTHROPIC_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing ANTHROPIC_API_KEY' })
      }

      const response = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        const text = await response.text()
        return res.status(response.status).json({ error: text || response.statusText })
      }

      const data = (await response.json()) as { data?: any[]; models?: any[] }

      const list: any[] = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : []

      const anthropicThinkingIds = new Set([
        'claude-opus-4-1-20250805',
        'claude-opus-4-20250514',
        'claude-sonnet-4-20250514',
        'claude-3-7-sonnet-20250219',
      ])
      const models = list
        .map(m => {
          const id = String(m?.id || m?.name || '')
          if (!id) return null
          const displayName = String(m?.display_name || m?.displayName || id)
          return {
            name: id,
            version: '',
            displayName,
            description: '',
            inputTokenLimit: 0,
            outputTokenLimit: 0,
            thinking: anthropicThinkingIds.has(id) || /thinking/i.test(id) || /thinking/i.test(displayName),
            supportedGenerationMethods: [] as string[],
          }
        })
        .filter(Boolean) as any[]

      const preferredDefault = 'claude-3-5-sonnet-latest'
      const defaultModel = models.find((m: any) => m.name === preferredDefault) || models[0] || null

      res.json({ models, default: defaultModel })
    } catch (error) {
      console.error('Failed to fetch Anthropic models:', error)
      res.status(500).json({ error: 'Failed to fetch Anthropic models' })
    }
  })
)

// Fetch models ollama
router.get(
  '/models',
  asyncHandler(async (req, res) => {
    const data = await modelService.getAvailableModels()
    res.json(data)
  })
)

// Fetch most recently used model names from messages
router.get(
  '/models/recent',
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5
    const { client, userId } = await verifyAuth(req)
    const models = await MessageService.getRecentModels(client, limit)
    res.json({ models })
  })
)

// Fetch Google Gemini models on the server to keep API key private
router.get(
  '/models/gemini',
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY' })
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) })

      if (!response.ok) {
        const text = await response.text()
        return res.status(response.status).json({ error: text || response.statusText })
      }

      const data = (await response.json()) as { models?: any[] }
      const rawModels: any[] = Array.isArray(data.models) ? data.models : []

      const chatCapable = rawModels.filter(m => {
        const methods = m?.supportedGenerationMethods || m?.supportedActions || []
        return Array.isArray(methods) && methods.includes('generateContent')
      })

      const models = chatCapable
        .map(m => {
          const rawName = String(m?.name || '')
          const name = rawName.replace(/^models\//, '')
          const methods = Array.isArray(m?.supportedGenerationMethods)
            ? m.supportedGenerationMethods
            : Array.isArray(m?.supportedActions)
              ? m.supportedActions
              : []
          const displayName = String(m?.displayName || name)
          const description = String(m?.description || '')
          const inputTokenLimit = Number(m?.inputTokenLimit ?? m?.inputTokenLimitTokens ?? 0)
          const outputTokenLimit = Number(m?.outputTokenLimit ?? m?.outputTokenLimitTokens ?? 0)
          const version = String(m?.version ?? '')
          const thinking = /thinking/i.test(name) || /thinking/i.test(displayName)
          return {
            name,
            version,
            displayName,
            description,
            inputTokenLimit,
            outputTokenLimit,
            thinking,
            supportedGenerationMethods: methods,
          }
        })
        .filter(m => m.name.length > 0)

      const preferredDefault = 'gemini-2.5-flash'
      const defaultModel = models.find(m => m.name === preferredDefault) || models[0] || null
      res.json({ models, default: defaultModel })
    } catch (error) {
      console.error('Failed to fetch Gemini models:', error)
      res.status(500).json({ error: 'Failed to fetch Gemini models' })
    }
  })
)

// Fetch LM Studio models from local LM Studio server
router.get(
  '/models/lmstudio',
  asyncHandler(async (req, res) => {
    try {
      const baseUrl = process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234'
      const response = await fetch(`${baseUrl}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return res.status(response.status).json({ error: `LM Studio server error: ${response.statusText}` })
      }

      const data = (await response.json()) as { data?: any[]; models?: any[] }
      const rawModels: any[] = Array.isArray(data?.data) ? data.data! : Array.isArray(data?.models) ? data.models! : []

      const models = rawModels
        .map(m => {
          const id = String(m?.id || m?.name || '')
          if (!id) return null
          const displayName = String(m?.display_name || m?.displayName || id)
          const description = String(m?.description || '')
          const inputTokenLimit = Number(m?.context_length ?? m?.max_tokens ?? 0)
          const outputTokenLimit = Number(m?.max_output_tokens ?? 0)
          const thinking = /thinking/i.test(id) || /thinking/i.test(displayName)
          return {
            name: id,
            version: String(m?.version || ''),
            displayName,
            description,
            inputTokenLimit,
            outputTokenLimit,
            thinking,
            supportedGenerationMethods: ['chat', 'completion'],
          }
        })
        .filter(Boolean) as any[]

      const preferredDefault = 'llama-3.2-1b'
      const defaultModel = models.find((m: any) => m.name === preferredDefault) || models[0] || null

      res.json({ models, default: defaultModel })
    } catch (error) {
      console.error('Error fetching LM Studio models:', error)
      res.status(500).json({ error: 'Failed to fetch LM Studio models. Ensure LM Studio is running locally.' })
    }
  })
)

// Force refresh models cache
router.post(
  '/models/refresh',
  asyncHandler(async (req, res) => {
    const data = await modelService.refreshModels()
    res.json(data)
  })
)

// Update tool enabled status
router.patch(
  '/tools/:toolName',
  asyncHandler(async (req, res) => {
    const { toolName } = req.params
    const { enabled } = req.body

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean value' })
    }

    const success = updateToolEnabled(toolName, enabled)
    if (!success) {
      return res.status(404).json({ error: 'Tool not found' })
    }

    const updatedTool = getToolByName(toolName)
    res.json({
      success: true,
      tool: updatedTool,
      message: `Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`,
    })
  })
)

// Create or get user
router.post(
  '/users',
  authEndpointsRateLimiter, // Apply auth endpoints rate limiter (strict IP-based)
  asyncHandler(async (req, res) => {
    const { username, id } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Username required' })
    }

    let user = await UserService.getByUsername(username)
    if (!user) {
      user = await UserService.create(username, id)
    }

    res.json(user)
  })
)

// Get user conversations
router.get(
  '/users/:userId/conversations',
  authenticatedRateLimiter, // Apply authenticated user rate limiter
  asyncHandler(async (req, res) => {
    // console.log('\n🔴🔴🔴 [SERVER] GET /users/:userId/conversations')
    // console.log('🔴 Timestamp:', new Date().toISOString())
    // console.log('🔴 User-Agent:', req.headers['user-agent'])
    // console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    // console.log('🔴 Origin:', req.headers['origin'])
    // console.log('🔴 All Headers:', JSON.stringify(req.headers, null, 2))
    // console.log('🔴 Stack:', new Error().stack)

    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getByUser(client)
    res.json(conversations)
  })
)

// Get recent user conversations
router.get(
  '/users/:userId/conversations/recent',
  asyncHandler(async (req, res) => {
    // console.log('\n🔴🔴🔴 [SERVER] GET /users/:userId/conversations/recent')
    // console.log('🔴 Timestamp:', new Date().toISOString())
    // console.log('🔴 User-Agent:', req.headers['user-agent'])
    // console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    // console.log('🔴 Origin:', req.headers['origin'])
    // console.log('🔴 Query params:', req.query)
    // console.log('🔴 Stack:', new Error().stack)

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10
    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getRecentByUser(client, limit)
    res.json(conversations)
  })
)

// Get paginated user conversations with cursor-based pagination
router.get(
  '/users/:userId/conversations/paginated',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50
    const cursor = req.query.cursor as string | undefined

    const { client } = await verifyAuth(req)
    const result = await ConversationService.getByUserPaginated(client, limit, cursor)
    res.json(result)
  })
)

// Get all research notes for user
router.get(
  '/users/:userId/research-notes',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const notes = await ConversationService.getResearchNotesByUser(client)
    res.json(notes)
  })
)

// Get conversation by projectID
router.get(
  '/conversations/project/:projectId',
  asyncHandler(async (req, res) => {
    // console.log('\n🔴🔴🔴 [SERVER] GET /conversations/project/:projectId')
    // console.log('🔴 Timestamp:', new Date().toISOString())
    // console.log('🔴 Project ID:', req.params.projectId)
    // console.log('🔴 User-Agent:', req.headers['user-agent'])
    // console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    // console.log('🔴 Origin:', req.headers['origin'])
    // console.log('🔴 Stack:', new Error().stack)

    const projectId = req.params.projectId
    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getByProjectId(client, projectId)
    res.json(conversations)
  })
)

// Get paginated project conversations with cursor-based pagination
router.get(
  '/conversations/project/:projectId/paginated',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50
    const cursor = req.query.cursor as string | undefined

    const { client } = await verifyAuth(req)
    const result = await ConversationService.getByProjectIdPaginated(client, projectId, limit, cursor)
    res.json(result)
  })
)

// Get all users
router.get(
  '/users/',
  asyncHandler(async (req, res) => {
    const users = await UserService.getAll()
    res.json(users)
  })
)

// Get specific user
router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const userId = req.params.id
    const user = await UserService.getById(userId)

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(user)
  })
)

// Update user
router.put(
  '/users/:id',
  authEndpointsRateLimiter, // Apply auth endpoints rate limiter (strict IP-based)
  asyncHandler(async (req, res) => {
    const userId = req.params.id
    const { username } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Username required' })
    }

    const user = await UserService.update(userId, username)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(user)
  })
)

// Delete user (cascade delete conversations and messages)
router.delete(
  '/users/:id',
  authEndpointsRateLimiter, // Apply auth endpoints rate limiter (strict IP-based)
  asyncHandler(async (req, res) => {
    const userId = req.params.id

    const user = await UserService.getById(userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Supabase handles cascade deletes via foreign key constraints
    await UserService.delete(userId)

    res.json({ message: 'User and all associated data deleted' })
  })
)

// Create conversation
router.post(
  '/conversations',
  authenticatedRateLimiter, // Apply authenticated user rate limiter
  asyncHandler(async (req, res) => {
    const { title, modelName, projectId, systemPrompt, conversationContext, storageMode } = req.body
    const { client, userId } = await verifyAuth(req)

    const conversation = await ConversationService.create(
      client,
      userId,
      title,
      modelName,
      projectId,
      systemPrompt,
      conversationContext
    )
    res.json(conversation)
  })
)

// Update conversation title
router.patch(
  '/conversations/:id/',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { title } = req.body
    const { client } = await verifyAuth(req)

    if (!title) {
      return res.status(400).json({ error: 'Title required' })
    }

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const updated = await ConversationService.updateTitle(client, conversationId, title)
    res.json(updated)
  })
)

// Get conversation by ID
router.get(
  '/conversations/:id',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)

    const conversation = await ConversationService.getById(client, conversationId)

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    res.json(conversation)
  })
)

// Get conversation system prompt
router.get(
  '/conversations/:id/system-prompt',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)
    const conversation = await ConversationService.getById(client, conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    const systemPrompt = await ConversationService.getSystemPrompt(client, conversationId)
    res.json({ systemPrompt })
  })
)

// Get conversation context
router.get(
  '/conversations/:id/context',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)
    const conversation = await ConversationService.getById(client, conversationId)

    if (!conversation) {
      console.log('Conversation not found')
      return res.status(404).json({ error: 'Conversation not found' })
    }
    const context = await ConversationService.getConversationContext(client, conversationId)

    res.json({ context })
  })
)

// Update conversation system prompt
router.patch(
  '/conversations/:id/system-prompt',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { systemPrompt } = req.body as { systemPrompt?: string | null }
    const { client } = await verifyAuth(req)

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (typeof systemPrompt === 'undefined') {
      return res.status(400).json({ error: 'systemPrompt is required (string or null)' })
    }

    const updated = await ConversationService.updateSystemPrompt(client, conversationId, systemPrompt ?? null)
    res.json(updated)
  })
)

// Update conversation context
router.patch(
  '/conversations/:id/context',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { context } = req.body as { context?: string | null }
    const { client } = await verifyAuth(req)

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (typeof context === 'undefined') {
      return res.status(400).json({ error: 'context is required (string or null)' })
    }
    if (context !== null && typeof context !== 'string') {
      return res.status(400).json({ error: 'context must be a string or null' })
    }

    const normalizedContext =
      typeof context === 'string' && context.trim().length === 0 ? null : (context as string | null)

    const updated = await ConversationService.updateContext(client, conversationId, normalizedContext)
    res.json(updated)
  })
)

// Update conversation research note
router.patch(
  '/conversations/:id/research-note',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { researchNote } = req.body as { researchNote?: string | null }
    const { client } = await verifyAuth(req)

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (typeof researchNote === 'undefined') {
      return res.status(400).json({ error: 'researchNote is required (string or null)' })
    }
    if (researchNote !== null && typeof researchNote !== 'string') {
      return res.status(400).json({ error: 'researchNote must be a string or null' })
    }

    const normalizedResearchNote =
      typeof researchNote === 'string' && researchNote.trim().length === 0 ? null : (researchNote as string | null)

    const updated = await ConversationService.updateResearchNote(client, conversationId, normalizedResearchNote)
    res.json(updated)
  })
)

// Move conversation to different project
router.patch(
  '/conversations/:id/project',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { projectId } = req.body as { projectId?: string | null }
    const { client } = await verifyAuth(req)

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    // projectId can be null (unassign from project) or a valid project UUID
    if (projectId !== undefined && projectId !== null && typeof projectId !== 'string') {
      return res.status(400).json({ error: 'projectId must be a string or null' })
    }

    const updated = await ConversationService.updateProjectId(client, conversationId, projectId ?? null)
    res.json(updated)
  })
)

// Clone conversation
router.post(
  '/conversations/:id/clone',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)

    const existing = await ConversationService.getById(client, conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const cloned = await ConversationService.clone(client, conversationId)
    if (!cloned) {
      return res.status(500).json({ error: 'Failed to clone conversation' })
    }

    res.json(cloned)
  })
)

// Bulk insert messages (for copying message chains)
router.post(
  '/conversations/:id/messages/bulk',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const { messages } = req.body as {
      messages: Array<{
        role: 'user' | 'assistant'
        content: string
        thinking_block?: string
        model_name?: string
        tool_calls?: string
        note?: string
        content_blocks?: any
      }>
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array required' })
    }

    // Verify conversation exists and user has access (RLS will enforce this)
    const conversation = await ConversationService.getById(client, conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const createdMessages: any[] = []
    let lastMessageId: string | null = null

    // Insert messages sequentially, maintaining parent-child relationships (linear chain)
    for (const msg of messages) {
      const newMessage = await MessageService.create(
        client,
        userId,
        conversationId,
        lastMessageId, // Parent is the previous message in the chain
        msg.role,
        msg.content,
        msg.thinking_block || '',
        msg.model_name || 'unknown',
        msg.tool_calls || undefined,
        msg.note || undefined,
        msg.content_blocks || undefined
      )
      createdMessages.push(newMessage)
      lastMessageId = newMessage.id
    }

    // Auto-generate title if this is the first message
    if (!conversation.title && messages.length > 0) {
      const firstContent = messages[0].content
      const title = firstContent.slice(0, 100) + (firstContent.length > 100 ? '...' : '')
      await ConversationService.updateTitle(client, conversationId, title)
    }

    res.json({ messages: createdMessages })
  })
)

// Delete conversation
router.delete(
  '/conversations/:id/',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)

    // RLS will prevent unauthorized deletes, no need to check existence first
    await ConversationService.delete(client, conversationId)
    res.json({ message: 'Conversation deleted' })
  })
)

// Get conversation messages
router.get(
  '/conversations/:id/messages',
  authenticatedRateLimiter, // Apply authenticated user rate limiter
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)
    const messages = await MessageService.getByConversation(client, conversationId)
    res.json(messages)
  })
)

// Get conversation children
router.get(
  '/conversations/:conversationId/messages/:messageId/children',
  asyncHandler(async (req, res) => {
    const { messageId } = req.params
    const { client } = await verifyAuth(req)
    const childrenIds = await MessageService.getChildrenIds(client, messageId)
    res.json(childrenIds)
  })
)

// PROJECTS

// Get projects sorted by latest conversation - RLS enforced via function parameter
router.get(
  '/projects/sorted/latest-conversation',
  asyncHandler(async (req, res) => {
    const { client, userId } = await verifyAuth(req)

    const projects = await ProjectService.getAllSortedByLatestConversation(client, userId)
    res.json(projects)
  })
)

// Get projects - RLS automatically filters by owner_id
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)

    const { data, error } = await client.from('projects').select('*').order('updated_at', { ascending: false })

    if (error) throw error
    res.json(data || [])
  })
)

// Get project by id - RLS automatically verifies ownership
router.get(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const projectId = req.params.id

    const { data, error } = await client.from('projects').select('*').eq('id', projectId).single()

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned
        return res.status(404).json({ error: 'Project not found' })
      }
      throw error
    }

    res.json(data)
  })
)

// Create project
router.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const { client, userId } = await verifyAuth(req)
    const { name, context, system_prompt } = req.body
    const now = new Date().toISOString()

    const { data, error } = await client
      .from('projects')
      .insert({
        name,
        created_at: now,
        updated_at: now,
        context: context || null,
        system_prompt: system_prompt || null,
        owner_id: userId,
      })
      .select()
      .single()

    if (error) throw error
    res.status(201).json(data)
  })
)

// Update project
router.put(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const projectId = req.params.id
    const { name, context, system_prompt } = req.body
    const now = new Date().toISOString()

    const { data, error } = await client
      .from('projects')
      .update({
        name,
        updated_at: now,
        context: context || null,
        system_prompt: system_prompt || null,
      })
      .eq('id', projectId)
      .select()
      .single()

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Project not found' })
      }
      throw error
    }

    res.json(data)
  })
)

// Delete project
router.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const projectId = req.params.id

    const { error } = await client.from('projects').delete().eq('id', projectId)

    if (error) throw error

    res.json({ message: 'Project deleted', id: projectId })
  })
)

// USER SYSTEM PROMPTS

// Get all user system prompts
router.get(
  '/system-prompts',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const prompts = await UserSystemPromptService.getAll(client)
    res.json(prompts)
  })
)

// Get user's default system prompt
router.get(
  '/system-prompts/default',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const prompt = await UserSystemPromptService.getDefault(client)
    res.json(prompt || null)
  })
)

// Get specific system prompt by id
router.get(
  '/system-prompts/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const promptId = req.params.id

    const prompt = await UserSystemPromptService.getById(client, promptId)
    if (!prompt) {
      return res.status(404).json({ error: 'System prompt not found' })
    }

    res.json(prompt)
  })
)

// Create new system prompt
router.post(
  '/system-prompts',
  asyncHandler(async (req, res) => {
    const { client, userId } = await verifyAuth(req)
    const { name, content, description, isDefault } = req.body

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' })
    }
    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'Content is required' })
    }

    const prompt = await UserSystemPromptService.create(client, userId, {
      name: name.trim(),
      content,
      description: description || null,
      isDefault: isDefault === true,
    })

    res.status(201).json(prompt)
  })
)

// Update system prompt
router.put(
  '/system-prompts/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const promptId = req.params.id
    const { name, content, description, isDefault } = req.body

    const existing = await UserSystemPromptService.getById(client, promptId)
    if (!existing) {
      return res.status(404).json({ error: 'System prompt not found' })
    }

    const updateParams: { name?: string; content?: string; description?: string | null; isDefault?: boolean } = {}

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name cannot be empty' })
      }
      updateParams.name = name.trim()
    }
    if (content !== undefined) {
      if (typeof content !== 'string') {
        return res.status(400).json({ error: 'Content must be a string' })
      }
      updateParams.content = content
    }
    if (description !== undefined) {
      updateParams.description = description
    }
    if (isDefault !== undefined) {
      updateParams.isDefault = isDefault === true
    }

    const updated = await UserSystemPromptService.update(client, promptId, updateParams)
    res.json(updated)
  })
)

// Set system prompt as default
router.patch(
  '/system-prompts/:id/default',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const promptId = req.params.id

    const existing = await UserSystemPromptService.getById(client, promptId)
    if (!existing) {
      return res.status(404).json({ error: 'System prompt not found' })
    }

    const updated = await UserSystemPromptService.setDefault(client, promptId)
    res.json(updated)
  })
)

// Clear default system prompt (no prompt will be default)
router.delete(
  '/system-prompts/default',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    await UserSystemPromptService.clearDefault(client)
    res.json({ message: 'Default system prompt cleared' })
  })
)

// Delete system prompt
router.delete(
  '/system-prompts/:id',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req)
    const promptId = req.params.id

    const deleted = await UserSystemPromptService.delete(client, promptId)
    if (!deleted) {
      return res.status(404).json({ error: 'System prompt not found' })
    }

    res.json({ message: 'System prompt deleted', id: promptId })
  })
)

// Get message tree and messages combined
router.get(
  '/conversations/:id/messages/tree',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)
    const messages = await MessageService.getByConversation(client, conversationId)

    const treeData = buildMessageTree(messages)
    res.json({ messages, tree: treeData })
  })
)

// Send message with streaming response (with repeat capability)
router.post(
  '/conversations/:id/messages/repeat',
  expensiveOperationsRateLimiter, // Apply expensive operations rate limiter (AI streaming)
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client, userId } = await verifyAuth(req)

    // Check if user can generate (checks subscription, credits, OR free generations)
    const { canGenerate, freeGenerationsRemaining, reason } = await canUserGenerate(userId)

    if (!canGenerate) {
      return res.status(403).json({
        error: 'generation_limit_reached',
        message: reason,
        freeGenerationsRemaining: 0,
      })
    }

    const {
      content,
      messages,
      modelName,
      parentId: requestedParentId,
      repeatNum = 1,
      provider = 'ollama',
      systemPrompt,
      conversationContext: clientConversationContext,
      projectContext: clientProjectContext,
      think,
      retrigger = false,
      isBranch = false,
      storageMode = 'cloud',
      imageConfig,
      reasoningConfig,
      tools: clientTools,
    } = req.body as SendMessageRequest & { repeatNum?: number }

    if (!content && !retrigger) {
      return res.status(400).json({ error: 'Message content required' })
    }

    // ✅ OPTIMIZATION: Use client-sent context (already validated via RLS when client fetched it)
    // RLS will prevent unauthorized message creation, no need to verify conversation exists
    const conversationContext = clientConversationContext ?? null
    const projectContext = clientProjectContext ?? null

    let combinedContext = ''
    if (projectContext) {
      combinedContext += projectContext
    }
    if (conversationContext) {
      if (combinedContext) combinedContext += '\n\n'
      combinedContext += conversationContext
    }

    const selectedModel = modelName || (await modelService.getDefaultModel())

    // Use client-provided parentId directly - RLS will enforce FK constraints
    let parentId: string | null = null
    if (requestedParentId !== undefined) {
      parentId = requestedParentId
    } else {
      const lastMessage = await MessageService.getLastMessage(client, conversationId)
      parentId = lastMessage?.id || null
    }

    // Determine local/cloud mode for repeat endpoint
    let isLocalMode = storageMode === 'local'

    if (storageMode === 'cloud') {
      const conversation = await ConversationService.getById(client, conversationId)
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' })
      }
      if (conversation.storage_mode === 'local') {
        console.warn('[supaChat/repeat] Client declared cloud but Supabase reports local:', conversationId)
        return res.status(400).json({ error: 'Storage mode mismatch' })
      }
      isLocalMode = false
    }

    const userMessage = await MessageService.create(
      client,
      userId,
      conversationId,
      parentId,
      'user',
      content,
      '',
      selectedModel
    )

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    })

    res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`)
    // ✅ OPTIMIZATION: Use client-sent message history instead of fetching from DB
    const baseHistory = Array.isArray(messages) ? messages : []

    const attachmentsBase64 = Array.isArray(req.body?.attachmentsBase64) ? req.body.attachmentsBase64 : null
    // Only save attachments to Supabase if NOT in local mode
    const savedAttachments: Awaited<ReturnType<typeof AttachmentService.getById>>[] =
      attachmentsBase64 && !isLocalMode
        ? await saveBase64ImageAttachmentsForMessage(client, userMessage.id, attachmentsBase64, userId)
        : []

    // For local mode, create attachment objects directly from base64 data URLs
    const attachmentsForGeneration =
      isLocalMode && attachmentsBase64
        ? attachmentsBase64.map((att: any) => ({
            url: att.dataUrl,
            mimeType: att.type || 'image/jpeg',
          }))
        : savedAttachments.map(a => ({
            url: a?.url || undefined,
            mimeType: (a as any)?.mime_type,
            filePath: (a as any)?.storage_path,
            sha256: (a as any)?.sha256,
          }))

    try {
      const repeats = Math.max(1, typeof repeatNum === 'number' ? repeatNum : parseInt(String(repeatNum), 10) || 1)
      // Pre-generate assistant message ID so clients can use it as parent for subagent messages
      const assistantMessageId = crypto.randomUUID()
      const { id: messageId, controller } = createGeneration(assistantMessageId)
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: assistantMessageId })}\n\n`)

      for (let i = 0; i < repeats; i++) {
        let assistantContent = ''
        let assistantThinking = ''
        let assistantToolCalls = ''
        // Sequential events array for this iteration
        const contentBlocksEvents: any[] = []

        // Don't create placeholder message - will create after each iteration completes
        await generateResponse(
          baseHistory as any,
          chunk => {
            try {
              const obj = JSON.parse(chunk)
              const part = obj?.part as
                | 'text'
                | 'reasoning'
                | 'reasoning_details'
                | 'tool_call'
                | 'tool_result'
                | 'image'
                | undefined
              const delta = String(obj?.delta ?? '')
              if (part === 'reasoning') {
                assistantThinking += delta
                // Log reasoning event
                contentBlocksEvents.push({ type: 'reasoning', delta })
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta, content: '', iteration: i })}\n\n`
                )
              } else if (part === 'reasoning_details') {
                // Handle encrypted reasoning details (Gemini thought_signature)
                if (obj?.reasoningDetails) {
                  console.log('🧠 [supaChat/repeat] Captured reasoning_details for storage')
                  contentBlocksEvents.push({ type: 'reasoning_details', reasoningDetails: obj.reasoningDetails })
                }
              } else if (part === 'tool_result') {
                // Handle tool result events (from tool execution)
                if (obj?.toolResult) {
                  // console.log(`✅ [supaChat/repeat] Tool result received: ${obj.toolResult.tool_use_id}`)
                  // Log tool result event
                  contentBlocksEvents.push({ type: 'tool_result', toolResult: obj.toolResult })
                  // Forward to client with structured data
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'tool_result', toolResult: obj.toolResult, iteration: i })}\n\n`
                  )
                }
              } else if (part === 'tool_call') {
                // Get structured tool call from obj.toolCall (not from delta)
                if (obj?.toolCall) {
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(obj.toolCall)
                  assistantToolCalls = JSON.stringify(currentToolCalls)
                  // console.log(`✅ [supaChat/repeat] Accumulated tool call: ${obj.toolCall.name}`)
                  // Log tool call event with complete flag
                  contentBlocksEvents.push({ type: 'tool_call', toolCall: obj.toolCall, complete: true })
                  // Forward to client with structured data
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'tool_call', toolCall: obj.toolCall, iteration: i })}\n\n`
                  )
                } else {
                  // Fallback: treat as content if no structured toolCall
                  console.warn(
                    '⚠️  [supaChat repeats] Received tool_call part but no toolCall object:',
                    delta.substring(0, 100)
                  )
                  assistantContent += delta
                  // Log as text event
                  contentBlocksEvents.push({ type: 'text', delta })
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta, iteration: i })}\n\n`
                  )
                }
              } else if (part === 'image') {
                // Handle image events from image generation models
                const imageUrl = obj?.url || delta
                // Check if we already have this image event
                const exists = contentBlocksEvents.some((e: any) => e.type === 'image' && e.url === imageUrl)
                if (!exists) {
                  contentBlocksEvents.push({
                    type: 'image',
                    url: imageUrl,
                    mimeType: obj?.mimeType || 'image/png',
                  })
                }
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'image', url: imageUrl, mimeType: obj?.mimeType || 'image/png', content: '', iteration: i })}\n\n`
                )
              } else {
                if (delta.includes('{')) {
                  const { jsonObjects, cleanedText } = extractJsonObjects(delta)
                  if (jsonObjects.length > 0) {
                    // Add extracted JSON objects to tool calls
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...jsonObjects)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    // Log each tool call as complete event (only if valid)
                    for (const tc of jsonObjects) {
                      if (tc.id && tc.name) {
                        contentBlocksEvents.push({ type: 'tool_call', toolCall: tc, complete: true })
                      }
                    }

                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: JSON.stringify(jsonObjects), content: '', iteration: i })}\n\n`
                    )
                  }

                  if (cleanedText) {
                    assistantContent += cleanedText
                    // Log text event
                    contentBlocksEvents.push({ type: 'text', delta: cleanedText })
                    res.write(
                      `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedText, content: cleanedText, iteration: i })}\n\n`
                    )
                  }
                } else {
                  assistantContent += delta
                  // Log text event
                  contentBlocksEvents.push({ type: 'text', delta })
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta, iteration: i })}\n\n`
                  )
                }
              }
            } catch {
              if (chunk.includes('{')) {
                const { jsonObjects, cleanedText } = extractJsonObjects(chunk)
                if (jsonObjects.length > 0) {
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(...jsonObjects)
                  assistantToolCalls = JSON.stringify(currentToolCalls)

                  // Log each tool call as complete event (only if valid)
                  for (const tc of jsonObjects) {
                    if (tc.id && tc.name) {
                      contentBlocksEvents.push({ type: 'tool_call', toolCall: tc, complete: true })
                    }
                  }

                  res.write(
                    `data: ${JSON.stringify({ type: 'tool_call', delta: JSON.stringify(jsonObjects), content: '', iteration: i })}\n\n`
                  )
                }

                if (cleanedText) {
                  assistantContent += cleanedText
                  // Log text event
                  contentBlocksEvents.push({ type: 'text', delta: cleanedText })
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedText, content: cleanedText, iteration: i })}\n\n`
                  )
                }
              } else {
                assistantContent += chunk
                // Log text event
                contentBlocksEvents.push({ type: 'text', delta: chunk })
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: chunk, content: chunk, iteration: i })}\n\n`
                )
              }
            }
          },
          provider as 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'lmstudio',
          selectedModel,
          attachmentsForGeneration,
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          undefined, // No assistant message ID yet (will create after streaming)
          userId,
          conversationId,
          undefined, // executionMode defaults to 'server'
          storageMode,
          false, // isElectron defaults to false
          imageConfig,
          reasoningConfig,
          clientTools
        )

        if (!assistantToolCalls.trim() && assistantContent.includes('{')) {
          const { jsonObjects, cleanedText } = extractJsonObjects(assistantContent)
          if (jsonObjects.length > 0) {
            assistantToolCalls = JSON.stringify(jsonObjects)
            // Update assistantContent to remove extracted JSON objects
            assistantContent = cleanedText
          }
        }
        const cleanedContent = assistantContent.trim()

        if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
          // Validate assistantToolCalls before passing to MessageService.create
          console.log('🔧 [supaChat/repeat] assistantToolCalls value:', assistantToolCalls)
          console.log('🔧 [supaChat/repeat] iteration:', i)
          console.log('🔧 [supaChat/repeat] Saving content_blocks with', contentBlocksEvents.length, 'events')
          const accumulatedBlocks = accumulateContentBlocks(contentBlocksEvents)
          console.log('🔧 [supaChat/repeat] Accumulated into', accumulatedBlocks.length, 'blocks')

          // Create assistant message with final content (not update placeholder)
          try {
            let assistantMessage = await MessageService.create(
              client,
              userId,
              conversationId,
              userMessage.id,
              'assistant',
              cleanedContent,
              '',
              selectedModel,
              undefined,
              undefined,
              accumulatedBlocks
            )

            // Process AI-generated images: save to storage bucket and update content_blocks
            // Skip for local mode - images stay as external URLs
            if (!isLocalMode) {
              const hasImageBlocks = accumulatedBlocks.some((block: any) => block.type === 'image' && block.url)
              if (hasImageBlocks) {
                try {
                  const updatedBlocks = await saveGeneratedImagesToStorage(
                    client,
                    accumulatedBlocks,
                    assistantMessage.id,
                    userId
                  )
                  // Update message with new content_blocks containing bucket URLs
                  const { error: updateError } = await client
                    .from('messages')
                    .update({ content_blocks: updatedBlocks })
                    .eq('id', assistantMessage.id)

                  if (updateError) {
                    console.error('[supaChat/repeat] Failed to update content_blocks with bucket URLs:', updateError)
                  } else {
                    assistantMessage = { ...assistantMessage, content_blocks: updatedBlocks }
                    console.log('[supaChat/repeat] Successfully saved generated images to storage bucket')
                  }
                } catch (imageError) {
                  console.error('[supaChat/repeat] Error saving generated images to storage:', imageError)
                }
              }
            }

            const cleanedMessage = { ...assistantMessage, content: cleanedContent }

            // Decrement free generation counter if applicable
            try {
              const newCount = await decrementFreeGeneration(userId)
              if (newCount >= 0) {
                // Send update to client via SSE
                res.write(
                  `data: ${JSON.stringify({
                    type: 'free_generations_update',
                    remaining: newCount,
                    iteration: i,
                  })}\n\n`
                )
              }
            } catch (error) {
              console.error('[Generation/repeat] Failed to decrement free generation:', error)
              // Don't fail the generation - just log
            }

            res.write(`data: ${JSON.stringify({ type: 'complete', message: cleanedMessage, iteration: i })}\n\n`)
          } catch (createError) {
            console.error('❌ [supaChat/repeat] Failed to create assistant message:', createError)
            console.error('❌ [supaChat/repeat] Iteration:', i, 'toolCalls:', assistantToolCalls)
            res.write(`data: ${JSON.stringify({ type: 'error', error: String(createError), iteration: i })}\n\n`)
          }
        } else {
          res.write(`data: ${JSON.stringify({ type: 'no_output', iteration: i })}\n\n`)
        }
      }

      clearGeneration(messageId)

      // const messages = await MessageService.getByConversation(client, conversationId)
      if (userMessage.parent_id === null && !isBranch) {
        const title = content.slice(0, 100) + (content.length > 100 ? '...' : '')
        await ConversationService.updateTitle(client, conversationId, title)
      }
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
    } finally {
      try {
        const { id: _ } = { id: '' }
      } catch {}
    }

    res.end()
  })
)

// Send message with streaming response
router.post(
  '/conversations/:id/messages',
  expensiveOperationsRateLimiter, // Apply expensive operations rate limiter (AI streaming)
  asyncHandler(async (req, res) => {
    // console.log('\n🟢🟢🟢 [SERVER] POST /conversations/:id/messages - Message send received')
    // console.log('🟢 Timestamp:', new Date().toISOString())
    // console.log('🟢 Conversation ID:', req.params.id)

    const conversationId = req.params.id
    const { client, userId } = await verifyAuth(req)

    // Check if user can generate (checks subscription, credits, OR free generations)
    const { canGenerate, freeGenerationsRemaining, reason } = await canUserGenerate(userId)

    if (!canGenerate) {
      return res.status(403).json({
        error: 'generation_limit_reached',
        message: reason,
        freeGenerationsRemaining: 0,
      })
    }

    const {
      content,
      messages,
      modelName,
      parentId: requestedParentId,
      provider = 'ollama',
      systemPrompt,
      conversationContext: clientConversationContext,
      projectContext: clientProjectContext,
      think,
      selectedFiles,
      retrigger = false,
      executionMode = 'server',
      isBranch = false,
      storageMode = 'cloud',
      isElectron = false,
      imageConfig,
      reasoningConfig,
      tools: clientTools,
    } = req.body as SendMessageRequest

    // console.log(`[supaChat] Processing message request for conversation ${conversationId}`)
    // console.log(`[supaChat] Execution Mode: ${executionMode}`)
    // console.log(`[supaChat] Model: ${modelName}`)
    // console.log(`[supaChat] Provider: ${provider}`)

    const isContinuation = !content && Array.isArray(messages) && messages.length > 0

    if (!content && !retrigger && !isContinuation) {
      return res.status(400).json({ error: 'Message content required' })
    }
    // console.log('server | test', systemPrompt, clientProjectContext, clientConversationContext)

    // let filesToUse = selectedFiles || []
    // if (!filesToUse || filesToUse.length === 0) {
    //   const recentMessages = await MessageService.getByConversation(client, conversationId)
    //   const fileContentMap = new Map<string, any>()

    //   for (const msg of recentMessages.slice(-10)) {
    //     const fileContents = await MessageService.getFileContents(client, msg.id, userId)
    //     for (const fc of fileContents) {
    //       const fileName = fc.file_name
    //       const baseName = fc.relative_path.split('/').pop() || fc.file_name

    //       if (!fileContentMap.has(fileName)) {
    //         fileContentMap.set(fileName, fc)
    //       }
    //       if (!fileContentMap.has(baseName)) {
    //         fileContentMap.set(baseName, fc)
    //       }
    //     }
    //   }

    //   const mentionRegex = /@([A-Za-z0-9._\/-]+)/g
    //   const mentions = [...content.matchAll(mentionRegex)].map(match => match[1])

    //   if (mentions.length > 0 && fileContentMap.size > 0) {
    //     const matchingFiles: SelectedFileContent[] = []
    //     for (const mention of mentions) {
    //       const dbFile = fileContentMap.get(mention)
    //       if (dbFile) {
    //         let fileContents = dbFile.content || ''
    //         if (!fileContents && dbFile.storage_path && fs.existsSync(dbFile.storage_path)) {
    //           try {
    //             fileContents = fs.readFileSync(dbFile.storage_path, 'utf8')
    //           } catch (error) {
    //             console.warn('Could not read file from disk:', dbFile.storage_path, error)
    //             fileContents = `[File content not available - ${dbFile.file_name}]`
    //           }
    //         } else if (!fileContents) {
    //           fileContents = `[File content not available - ${dbFile.file_name}]`
    //         }

    //         matchingFiles.push({
    //           path: dbFile.storage_path || dbFile.relative_path,
    //           relativePath: dbFile.relative_path,
    //           name: dbFile.file_name,
    //           contents: fileContents,
    //           contentLength: fileContents.length,
    //         })
    //       }
    //     }
    //     filesToUse = matchingFiles
    //     console.log('server | using database file content:', filesToUse.length, 'files')
    //   }
    // }

    const processedContent = content
    // filesToUse && filesToUse.length > 0 ? replaceFileMentionsWithContent(content, filesToUse) : content
    // console.log('server | processedContent', processedContent)

    // ✅ OPTIMIZATION: Use client-sent context (already validated via RLS when client fetched it)
    // Client sends conversationContext and projectContext to eliminate DB query
    // RLS will prevent unauthorized message creation, no need to verify conversation exists
    const conversationContext = clientConversationContext ?? null
    const projectContext = clientProjectContext ?? null

    let combinedContext = ''
    if (projectContext) {
      combinedContext += projectContext
    }
    if (conversationContext) {
      if (combinedContext) combinedContext += '\n\n'
      combinedContext += conversationContext
    }

    const selectedModel = modelName || (await modelService.getDefaultModel())

    // Get conversation to check storage mode
    let isLocalMode = storageMode === 'local'

    if (storageMode === 'cloud') {
      const conversation = await ConversationService.getById(client, conversationId)
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' })
      }

      if (conversation.storage_mode === 'local') {
        console.warn('[supaChat] Client declared cloud but Supabase reports local:', conversationId)
        return res.status(400).json({ error: 'Storage mode mismatch' })
      }

      isLocalMode = false
    }

    // Use client-provided parentId directly - RLS will enforce FK constraints
    let parentId: string | null = null
    if (requestedParentId !== undefined) {
      parentId = requestedParentId
    } else {
      const lastMessage = await MessageService.getLastMessage(client, conversationId)
      parentId = lastMessage?.id || null
    }

    // Save user message with proper parent ID (skip if retrigger or continuation)
    let userMessage
    if (retrigger) {
      // For retrigger, get the last user message instead of creating a new one
      const lastMessage = await MessageService.getLastMessage(client, conversationId)
      if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: 'Cannot retrigger: last message is not from user' })
      }
      userMessage = lastMessage
      // console.log('server | retriggering from existing user message', userMessage.id)
    } else if (isContinuation) {
      // For continuation, use the last message from provided history as the "user" context anchor
      // or find the last actual user message in the history
      const lastMsg = messages![messages!.length - 1]
      userMessage = { ...lastMsg, id: lastMsg.id || 'temp-continuation-id' }
    } else {
      // Check if local mode - skip Supabase saves
      if (isLocalMode) {
        // Create ephemeral user message object without saving to DB
        // console.log('[supaChat] Local mode - skipping Supabase save for user message')
        userMessage = {
          id: crypto.randomUUID(),
          conversation_id: conversationId,
          parent_id: parentId,
          role: 'user',
          content,
          model_name: selectedModel,
          created_at: new Date().toISOString(),
        }
      } else {
        // Save to Supabase
        userMessage = await MessageService.create(
          client,
          userId,
          conversationId,
          parentId,
          'user',
          content,
          '',
          selectedModel
        )
      }
    }
    // console.log('server | user message', messages)

    // Only save files to Supabase if NOT in local mode
    if (selectedFiles && selectedFiles.length > 0 && !isLocalMode) {
      for (const file of selectedFiles) {
        try {
          const fileContent = await FileContentService.create(client, userId, {
            fileName: file.name || file.relativePath.split('/').pop() || 'unknown',
            relativePath: file.relativePath,
            fileContent: file.contents,
            sizeBytes: file.contentLength,
            messageId: userMessage.id,
          })
          console.log('Stored file content:', fileContent.file_name)
        } catch (error) {
          console.error('Error storing file content:', error)
        }
      }
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    })

    // Send user message immediately (only if not retrigger and not continuation)
    if (!retrigger && !isContinuation) {
      res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`)
    }

    try {
      const attachmentsBase64 = Array.isArray(req.body?.attachmentsBase64) ? req.body.attachmentsBase64 : null
      // Only save attachments to Supabase if NOT in local mode
      const savedAttachments: Awaited<ReturnType<typeof AttachmentService.getById>>[] =
        attachmentsBase64 && !isLocalMode
          ? await saveBase64ImageAttachmentsForMessage(client, userMessage.id, attachmentsBase64, userId)
          : []

      // For local mode, create attachment objects directly from base64 data URLs
      // This ensures images are passed to generateResponse even without Supabase storage
      const attachmentsForGeneration =
        isLocalMode && attachmentsBase64
          ? attachmentsBase64.map((att: any) => ({
              url: att.dataUrl,
              mimeType: att.type || 'image/jpeg',
            }))
          : savedAttachments.map(a => ({
              url: a?.url || undefined,
              mimeType: (a as any)?.mime_type,
              filePath: a?.url || (a as any)?.storage_path,
              sha256: (a as any)?.sha256,
            }))

      const userMessageForAI = { ...userMessage, content: processedContent }

      let combinedMessages: any[] = []
      if (isContinuation) {
        combinedMessages = messages || []
      } else {
        combinedMessages = Array.isArray(messages) ? [...messages, userMessageForAI] : [userMessageForAI]
      }

      let assistantContent = ''
      let assistantThinking = ''
      let assistantToolCalls = ''
      // Sequential events array to preserve order of chunks as received (for content_blocks)
      const contentBlocksEvents: any[] = []

      // Pre-generate assistant message ID so clients can use it as parent for subagent messages
      const assistantMessageId = crypto.randomUUID()
      const { id: messageId, controller } = createGeneration(assistantMessageId)
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: assistantMessageId })}\n\n`)

      try {
        await generateResponse(
          combinedMessages,
          chunk => {
            // console.log('[supaChat] Received chunk length:', chunk.length)
            // console.log('[supaChat] Received chunk:', chunk.substring(0, 50) + '...')
            try {
              const obj = JSON.parse(chunk)
              const part = obj?.part as
                | 'text'
                | 'reasoning'
                | 'reasoning_details'
                | 'tool_call'
                | 'tool_result'
                | 'image'
                | undefined
              const delta = String(obj?.delta ?? '')
              if (part === 'reasoning') {
                assistantThinking += delta
                // Log reasoning event
                contentBlocksEvents.push({ type: 'reasoning', delta })
                res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta, content: '' })}\n\n`)
              } else if (part === 'reasoning_details') {
                // Handle encrypted reasoning details (Gemini thought_signature)
                if (obj?.reasoningDetails) {
                  // console.log('🧠 [supaChat] Captured reasoning_details for storage')
                  contentBlocksEvents.push({ type: 'reasoning_details', reasoningDetails: obj.reasoningDetails })
                }
              } else if (part === 'tool_result') {
                // Handle tool result events (from tool execution)
                if (obj?.toolResult) {
                  // console.log(`✅ [supaChat] Tool result received: ${obj.toolResult.tool_use_id}`)
                  // Log tool result event
                  contentBlocksEvents.push({ type: 'tool_result', toolResult: obj.toolResult })
                  // Forward to client with structured data
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'tool_result', toolResult: obj.toolResult, content: '' })}\n\n`
                  )
                }
              } else if (part === 'tool_call') {
                // Get structured tool call from obj.toolCall (not from delta)
                if (obj?.toolCall) {
                  // console.log(`✅ [supaChat] Received structured tool call: ${obj.toolCall.name}`)
                  // If it's valid tool call, add it to the array
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(obj.toolCall)
                  assistantToolCalls = JSON.stringify(currentToolCalls)
                  // console.log('✅ [supaChat] Updated assistantToolCalls, current length:', currentToolCalls.length)
                  // Log tool call event with complete flag
                  contentBlocksEvents.push({ type: 'tool_call', toolCall: obj.toolCall, complete: true })
                  // Forward to client with structured data
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'tool_call', toolCall: obj.toolCall, content: '' })}\n\n`
                  )
                } else {
                  // If no structured toolCall, treat delta as regular content
                  // console.warn(
                  //   '⚠️  [supaChat] Received tool_call part but no toolCall object:',
                  //   delta.substring(0, 150)
                  // )
                  assistantContent += delta
                  // Log as text event
                  contentBlocksEvents.push({ type: 'text', delta })
                  res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta })}\n\n`)
                }
              } else if (part === 'image') {
                // Handle image events from image generation models
                const imageUrl = obj?.url || delta
                // Check if we already have this image event
                const exists = contentBlocksEvents.some((e: any) => e.type === 'image' && e.url === imageUrl)
                if (!exists) {
                  contentBlocksEvents.push({
                    type: 'image',
                    url: imageUrl,
                    mimeType: obj?.mimeType || 'image/png',
                  })
                }
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'image', url: imageUrl, mimeType: obj?.mimeType || 'image/png', content: '' })}\n\n`
                )
              } else {
                if (delta.includes('{')) {
                  const { jsonObjects, cleanedText } = extractJsonObjects(delta)
                  if (jsonObjects.length > 0) {
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...jsonObjects)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    // Log each tool call as complete event (only if valid)
                    for (const tc of jsonObjects) {
                      if (tc.id && tc.name) {
                        contentBlocksEvents.push({ type: 'tool_call', toolCall: tc, complete: true })
                      }
                    }

                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: JSON.stringify(jsonObjects), content: '' })}\n\n`
                    )
                  }

                  if (cleanedText) {
                    assistantContent += cleanedText
                    // Log text event
                    contentBlocksEvents.push({ type: 'text', delta: cleanedText })
                    res.write(
                      `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedText, content: cleanedText })}\n\n`
                    )
                  }
                } else {
                  assistantContent += delta
                  // Log text event
                  contentBlocksEvents.push({ type: 'text', delta })
                  res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta })}\n\n`)
                }
              }
            } catch {
              if (chunk.includes('{')) {
                const { jsonObjects, cleanedText } = extractJsonObjects(chunk)
                if (jsonObjects.length > 0) {
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(...jsonObjects)
                  assistantToolCalls = JSON.stringify(currentToolCalls)

                  // Log each tool call as complete event (only if valid)
                  for (const tc of jsonObjects) {
                    if (tc.id && tc.name) {
                      contentBlocksEvents.push({ type: 'tool_call', toolCall: tc, complete: true })
                    }
                  }

                  res.write(
                    `data: ${JSON.stringify({ type: 'tool_call', delta: JSON.stringify(jsonObjects), content: '' })}\n\n`
                  )
                }

                if (cleanedText) {
                  assistantContent += cleanedText
                  // Log text event
                  contentBlocksEvents.push({ type: 'text', delta: cleanedText })
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedText, content: cleanedText })}\n\n`
                  )
                }
              } else {
                assistantContent += chunk
                // Log text event
                contentBlocksEvents.push({ type: 'text', delta: chunk })
                res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: chunk, content: chunk })}\n\n`)
              }
            }
          },
          provider as 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'lmstudio',
          selectedModel,
          attachmentsForGeneration,
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          undefined, // No assistant message ID yet (will create after streaming)
          userId,
          conversationId,
          executionMode,
          storageMode,
          isElectron,
          imageConfig,
          reasoningConfig,
          clientTools
        )

        // Clean up content and extract tool calls after streaming completes
        // if (!assistantToolCalls.trim() && assistantContent.includes('{')) {
        //   const { jsonObjects, cleanedText } = extractJsonObjects(assistantContent)
        //   if (jsonObjects.length > 0) {
        //     assistantToolCalls = JSON.stringify(jsonObjects)
        //     assistantContent = cleanedText
        //     console.log('Final extraction - found tool calls:', assistantToolCalls)
        //   }
        // }
        const cleanedContent = assistantContent.trim()
        console.log('Original content length:', assistantContent.length, 'Cleaned length:', cleanedContent.length)

        // Validate assistantToolCalls before passing to MessageService.create
        // console.log('🔧 [supaChat] assistantToolCalls value:', assistantToolCalls)
        // console.log('🔧 [supaChat] assistantToolCalls type:', typeof assistantToolCalls)
        // console.log('🔧 [supaChat] assistantToolCalls length:', assistantToolCalls?.length)
        // console.log('🔧 [supaChat] assistantToolCalls is empty string?:', assistantToolCalls === '')
        // console.log('🔧 [supaChat] assistantToolCalls is truthy?:', !!assistantToolCalls)

        if (assistantToolCalls) {
          try {
            const parsed = JSON.parse(assistantToolCalls)
            // console.log('🔧 [supaChat] Parsed assistantToolCalls successfully:', JSON.stringify(parsed))
          } catch (e) {
            console.error(
              // '🔧 [supaChat] Failed to parse assistantToolCalls:',
              e instanceof Error ? e.message : String(e)
            )
          }
        }

        // Create assistant message with final content (not update placeholder)
        try {
          console.log(
            // '📤 [supaChat] Calling MessageService.create with tool_calls:',
            assistantToolCalls ? assistantToolCalls.substring(0, 100) : 'empty'
          )
          // console.log('📤 [supaChat] Saving content_blocks with', contentBlocksEvents.length, 'events')
          const accumulatedBlocks = accumulateContentBlocks(contentBlocksEvents)
          // console.log('📤 [supaChat] Accumulated into', accumulatedBlocks.length, 'blocks')

          let assistantMessage
          // Check if local mode - skip Supabase saves
          if (isLocalMode) {
            // Create ephemeral assistant message object without saving to DB
            // Use the pre-generated assistantMessageId so it matches what was sent in generation_started
            // console.log('[supaChat] Local mode - skipping Supabase save for assistant message')
            assistantMessage = {
              id: assistantMessageId,
              conversation_id: conversationId,
              parent_id: userMessage.id,
              role: 'assistant',
              content: cleanedContent,
              model_name: selectedModel,
              content_blocks: accumulatedBlocks,
              created_at: new Date().toISOString(),
            }
          } else {
            // Save to Supabase
            assistantMessage = await MessageService.create(
              client,
              userId,
              conversationId,
              userMessage.id,
              'assistant',
              cleanedContent,
              '',
              selectedModel,
              undefined,
              undefined,
              accumulatedBlocks
            )

            // Process AI-generated images: save to storage bucket and update content_blocks
            const hasImageBlocks = accumulatedBlocks.some((block: any) => block.type === 'image' && block.url)
            if (hasImageBlocks) {
              try {
                const updatedBlocks = await saveGeneratedImagesToStorage(
                  client,
                  accumulatedBlocks,
                  assistantMessage.id,
                  userId
                )
                // Update message with new content_blocks containing bucket URLs
                const { error: updateError } = await client
                  .from('messages')
                  .update({ content_blocks: updatedBlocks })
                  .eq('id', assistantMessage.id)

                if (updateError) {
                  console.error('[supaChat] Failed to update content_blocks with bucket URLs:', updateError)
                } else {
                  // Update the assistantMessage object with new content_blocks
                  assistantMessage = { ...assistantMessage, content_blocks: updatedBlocks }
                  // console.log('[supaChat] Successfully saved generated images to storage bucket')
                }
              } catch (imageError) {
                console.error('[supaChat] Error saving generated images to storage:', imageError)
                // Continue with original content_blocks - images will use external URLs
              }
            }
          }
          // console.log(assistantMessage)
          const cleanedMessage = { ...assistantMessage, content: cleanedContent }

          // Decrement free generation counter if applicable
          if (!isLocalMode) {
            try {
              const newCount = await decrementFreeGeneration(userId)
              if (newCount >= 0) {
                // Send update to client via SSE
                res.write(
                  `data: ${JSON.stringify({
                    type: 'free_generations_update',
                    remaining: newCount,
                  })}\n\n`
                )
              }
            } catch (error) {
              console.error('[Generation] Failed to decrement free generation:', error)
              // Don't fail the generation - just log
            }
          }

          res.write(
            `data: ${JSON.stringify({
              type: 'complete',
              message: cleanedMessage,
            })}\n\n`
          )

          // Auto-generate title if this is the first message (no parent ID)
          // Skip for local mode - client will handle title updates
          if (userMessage.parent_id === null && !isLocalMode) {
            console.log('Auto-generating title for new conversation', conversationId)
            const title = content.slice(0, 100) + (content.length > 100 ? '...' : '')
            await ConversationService.updateTitle(client, conversationId, title)
          }
        } catch (createError) {
          // console.error('❌ [supaChat] Failed to create assistant message:', createError)
          // console.error('❌ [supaChat] Message details:', {
          //   conversationId,
          //   userId,
          //   parentId: userMessage.id,
          //   contentLength: cleanedContent.length,
          //   thinkingLength: assistantThinking.length,
          //   toolCallsValue: assistantToolCalls,
          // })
          // Send error to client but don't throw - let outer catch handle it
          throw createError
        }
      } catch (error: any) {
        // Simplified error handling - no placeholder message to delete
        const isAbort =
          error?.name === 'AbortError' ||
          String(error || '')
            .toLowerCase()
            .includes('abort')

        if (isAbort) {
          // If aborted with content, create message with what we have
          if (!assistantToolCalls.trim() && assistantContent.includes('{')) {
            const { jsonObjects, cleanedText } = extractJsonObjects(assistantContent)
            if (jsonObjects.length > 0) {
              assistantToolCalls = JSON.stringify(jsonObjects)
              assistantContent = cleanedText
            }
          }
          const cleanedContent = assistantContent.trim()

          if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
            // Create message with partial content from aborted generation
            console.log('🔧 [supaChat/abort] Saving partial content, toolCalls:', assistantToolCalls)
            try {
              const accumulatedBlocks = accumulateContentBlocks(contentBlocksEvents)
              let assistantMessage
              if (isLocalMode) {
                // Create ephemeral message - don't save to Supabase
                assistantMessage = {
                  id: crypto.randomUUID(),
                  conversation_id: conversationId,
                  parent_id: userMessage.id,
                  role: 'assistant',
                  content: cleanedContent,
                  model_name: selectedModel,
                  content_blocks: accumulatedBlocks,
                  created_at: new Date().toISOString(),
                }
              } else {
                // Save to Supabase
                assistantMessage = await MessageService.create(
                  client,
                  userId,
                  conversationId,
                  userMessage.id,
                  'assistant',
                  cleanedContent,
                  '',
                  selectedModel,
                  undefined,
                  undefined,
                  accumulatedBlocks
                )
              }
              const cleanedMessage = { ...assistantMessage, content: cleanedContent }
              res.write(`data: ${JSON.stringify({ type: 'complete', message: cleanedMessage, aborted: true })}\n\n`)
            } catch (createError) {
              console.error('❌ [supaChat/abort] Failed to save partial message:', createError)
              res.write(`data: ${JSON.stringify({ type: 'aborted', error: String(createError) })}\n\n`)
            }
          } else {
            // Nothing to save - just notify client
            res.write(`data: ${JSON.stringify({ type: 'aborted' })}\n\n`)
          }
        } else {
          // Non-abort error - save partial content if available before sending error
          const cleanedContent = assistantContent.trim()

          if (
            cleanedContent.trim() ||
            assistantThinking.trim() ||
            assistantToolCalls.trim() ||
            contentBlocksEvents.length > 0
          ) {
            // We have accumulated content/events - save them before reporting error
            try {
              const accumulatedBlocks = accumulateContentBlocks(contentBlocksEvents)
              console.log('🔧 [supaChat/error] Saving partial content before error, toolCalls:', assistantToolCalls)

              let assistantMessage
              if (isLocalMode) {
                // Create ephemeral message - don't save to Supabase
                assistantMessage = {
                  id: crypto.randomUUID(),
                  conversation_id: conversationId,
                  parent_id: userMessage.id,
                  role: 'assistant',
                  content: cleanedContent,
                  model_name: selectedModel,
                  content_blocks: accumulatedBlocks,
                  created_at: new Date().toISOString(),
                }
              } else {
                // Save to Supabase
                assistantMessage = await MessageService.create(
                  client,
                  userId,
                  conversationId,
                  userMessage.id,
                  'assistant',
                  cleanedContent,
                  '',
                  selectedModel,
                  undefined,
                  undefined,
                  accumulatedBlocks
                )
              }
              // Send completion with accumulated content - treat as successful partial generation
              // The error is logged on server but client sees it as a complete message
              const cleanedMessage = { ...assistantMessage, content: cleanedContent }
              res.write(`data: ${JSON.stringify({ type: 'complete', message: cleanedMessage })}\n\n`)
              console.log(
                '✅ [supaChat/error] Successfully saved partial content despite error:',
                error instanceof Error ? error.message : String(error)
              )
            } catch (saveError) {
              // Failed to save partial content - report the error
              console.error('❌ [supaChat/error] Failed to save partial message on error:', saveError)
              res.write(
                `data: ${JSON.stringify({
                  type: 'error',
                  error: error instanceof Error ? error.message : 'Unknown error',
                })}\n\n`
              )
            }
          } else {
            // No accumulated content - just send error event
            res.write(
              `data: ${JSON.stringify({
                type: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
              })}\n\n`
            )
          }
        }
      } finally {
        clearGeneration(messageId)
      }

      res.end()
    } catch (error) {
      console.error('[supaChat] Error in message handler:', error)
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
      res.end()
    }
  })
)

// Update message
router.put(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { content, note, content_blocks } = req.body
    const { client, userId } = await verifyAuth(req)

    // Allow empty content if content_blocks is present, otherwise require content
    if (!content && !content_blocks) {
      return res.status(400).json({ error: 'Content or content_blocks required' })
    }

    // Derive content from content_blocks if content is empty
    let finalContent = content
    if (!content && content_blocks) {
      // Extract text from text blocks in content_blocks
      const textBlocks = Array.isArray(content_blocks)
        ? content_blocks.filter((block: any) => block.type === 'text')
        : []

      if (textBlocks.length > 0) {
        finalContent = textBlocks.map((block: any) => block.text || '').join('\n')
      } else {
        // No text blocks, use empty string (tool-only message)
        finalContent = ''
      }
    }

    // Pass parameters in correct order: (client, id, content, thinking_block, tool_calls, note, content_blocks)
    // null for thinking_block and tool_calls preserves existing values
    const updated = await MessageService.update(client, messageId, finalContent, null, null, note, content_blocks)
    if (!updated) return res.status(404).json({ error: 'Message not found' })

    res.json(updated)
  })
)

router.delete(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client } = await verifyAuth(req)

    const deleted = await MessageService.delete(client, messageId)
    if (!deleted) return res.status(404).json({ error: 'Message not found' })

    res.json({ success: true })
  })
)

router.post(
  '/messages/deleteMany',
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids?: Array<string> }
    const { client } = await verifyAuth(req)
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids (string[]) is required' })
    }

    const normalized = Array.from(new Set(ids.filter(id => typeof id === 'string' && id.length > 0)))

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'No valid ids provided' })
    }

    const deleted = await MessageService.deleteMany(client, normalized)
    res.json({ deleted })
  })
)

// Delete conversation
router.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { client } = await verifyAuth(req)

    // const conversation = await ConversationService.getById(client, conversationId)
    // if (!conversation) {
    //   return res.status(404).json({ error: 'Conversation not found' })
    // }

    await ConversationService.delete(client, conversationId)
    res.json({ message: 'Conversation deleted' })
  })
)

// Attachments API

const uploadsDir = path.join(path.resolve(__dirname, '..'), 'data', 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}
const storage = multer.diskStorage({
  destination: (_req: express.Request, _file: any, cb: (error: Error | null, destination: string) => void) =>
    cb(null, uploadsDir),
  filename: (_req: express.Request, file: any, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname)
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_')
    cb(null, `${Date.now()}_${base}${ext}`)
  },
})
const upload = multer({ storage })

router.post(
  '/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { client, userId } = await verifyAuth(req)
    const uploaded = (req as any).file as any | undefined
    if (uploaded) {
      const file = uploaded
      const messageIdRaw = req.body?.messageId
      const messageId = messageIdRaw || null
      const absolutePath = file.path
      const filename = path.basename(absolutePath)
      const storagePath = path.relative(__dirname, absolutePath)
      const sizeBytes = file.size
      const mimeType = file.mimetype

      const fileBuffer = fs.readFileSync(absolutePath)
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex')

      const created = await AttachmentService.create(client, userId, {
        messageId,
        kind: 'image',
        mimeType,
        storage: 'file',
        url: `/uploads/${filename}`,
        storagePath,
        width: null,
        height: null,
        sizeBytes,
        sha256,
      })

      return res.status(201).json(created)
    }

    const {
      messageId,
      kind = 'image',
      mimeType,
      storage: storageType,
      url,
      storagePath,
      width,
      height,
      sizeBytes,
      sha256,
    } = req.body as {
      messageId?: string | null
      kind?: 'image'
      mimeType?: string
      storage?: 'file' | 'url'
      url?: string | null
      storagePath?: string | null
      width?: number | null
      height?: number | null
      sizeBytes?: number | null
      sha256?: string | null
    }

    if (!mimeType) return res.status(400).json({ error: 'mimeType is required' })
    if (!url && !storagePath) return res.status(400).json({ error: 'Either url or storagePath is required' })
    if (kind !== 'image') return res.status(400).json({ error: 'Only kind="image" is supported' })

    const created = await AttachmentService.create(client, userId, {
      messageId: messageId ?? null,
      kind: 'image',
      mimeType,
      storage: storageType,
      url: url ?? null,
      storagePath: storagePath ?? null,
      width: width ?? null,
      height: height ?? null,
      sizeBytes: sizeBytes ?? null,
      sha256: sha256 ?? null,
    })

    res.status(201).json(created)
  })
)

router.get(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id
    const { client } = await verifyAuth(req)
    const found = await AttachmentService.getById(client, id)
    if (!found) return res.status(404).json({ error: 'Attachment not found' })
    res.json(found)
  })
)

router.get(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const attachments = await MessageService.getAttachments(client, messageId, userId)
    res.json(attachments)
  })
)

router.post(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const { attachmentIds } = req.body as { attachmentIds?: string[] }
    if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
      return res.status(400).json({ error: 'attachmentIds must be a non-empty array' })
    }
    const attachments = await MessageService.linkAttachments(client, messageId, attachmentIds, userId)
    res.json(attachments)
  })
)

router.delete(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const deleted = await AttachmentService.deleteByMessage(client, messageId, userId)
    res.json({ deleted })
  })
)

router.delete(
  '/messages/:id/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const attachmentId = req.params.attachmentId
    const { client, userId } = await verifyAuth(req)
    const updated = await MessageService.unlinkAttachment(client, messageId, attachmentId, userId)
    res.json(updated)
  })
)

// File Content API

router.post(
  '/file-content',
  asyncHandler(async (req, res) => {
    const { fileName, relativePath, sizeBytes, messageId, fileContent } = req.body as {
      fileName: string
      relativePath: string
      sizeBytes?: number | null
      messageId?: string | null
      fileContent?: string | null
    }
    const { client, userId } = await verifyAuth(req)

    if (!fileName) return res.status(400).json({ error: 'fileName is required' })
    if (!relativePath) return res.status(400).json({ error: 'relativePath is required' })

    const created = await FileContentService.create(client, userId, {
      fileName,
      relativePath,
      fileContent: fileContent ?? null,
      sizeBytes: sizeBytes ?? null,
      messageId: messageId ?? null,
    })

    res.status(201).json(created)
  })
)

router.get(
  '/file-content/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id
    const { client } = await verifyAuth(req)
    const found = await FileContentService.getById(client, id)
    if (!found) return res.status(404).json({ error: 'File content not found' })
    res.json(found)
  })
)

router.get(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const fileContents = await MessageService.getFileContents(client, messageId, userId)
    res.json(fileContents)
  })
)

router.post(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const { fileContentIds } = req.body as { fileContentIds?: string[] }
    if (!Array.isArray(fileContentIds) || fileContentIds.length === 0) {
      return res.status(400).json({ error: 'fileContentIds must be a non-empty array' })
    }
    const fileContents = await MessageService.linkFileContents(client, messageId, fileContentIds, userId)
    res.json(fileContents)
  })
)

router.delete(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { client, userId } = await verifyAuth(req)
    const deleted = await FileContentService.deleteByMessage(client, messageId, userId)
    res.json({ deleted })
  })
)

router.delete(
  '/messages/:id/file-content/:fileContentId',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const fileContentId = req.params.fileContentId
    const { client, userId } = await verifyAuth(req)
    const updated = await MessageService.unlinkFileContent(client, messageId, fileContentId, userId)
    res.json(updated)
  })
)

// Abort an in-flight generation by message id
router.post(
  '/messages/:id/abort',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const success = abortGeneration(messageId)
    res.json({ success })
  })
)

export default router
