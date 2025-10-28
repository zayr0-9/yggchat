// server/src/routes/supaChat.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import {
  AttachmentService,
  buildMessageTree,
  ConversationService,
  createAuthenticatedClient,
  FileContentService,
  MessageService,
  ProjectService,
  UserService,
} from '../database/supamodels'
import {
  authEndpointsRateLimiter,
  authenticatedRateLimiter,
  expensiveOperationsRateLimiter,
} from '../middleware/rateLimiter'
import { asyncHandler } from '../utils/asyncHandler'
import { SelectedFileContent } from '../utils/fileMentionProcessor'
import { abortGeneration, clearGeneration, createGeneration } from '../utils/generationManager'
import { modelService } from '../utils/modelService'
import { generateResponse } from '../utils/provider'
import { saveBase64ImageAttachmentsForMessage } from '../utils/supaAttachments'
import { getToolByName, updateToolEnabled } from '../utils/tools/index'

const router = express.Router()

/**
 * Extract JWT token from Authorization header
 */
function getAuthToken(req: express.Request): string {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header. Expected format: Bearer <jwt>')
  }

  return authHeader.substring(7) // Remove 'Bearer ' prefix
}

/**
 * Decode JWT locally without network calls (server-side version)
 * Only decodes the payload - does NOT verify signature (assumes Supabase already validated)
 *
 * @param token - The JWT access token
 * @returns The decoded JWT payload or null if invalid
 */
function decodeJWT(token: string): Record<string, unknown> | null {
  try {
    // JWT format: header.payload.signature
    const parts = token.split('.')
    if (parts.length !== 3) {
      console.error('[supaChat] ❌ Invalid JWT format')
      return null
    }

    // Decode the payload (second part)
    const payload = parts[1]

    // Base64URL decode (handle URL-safe base64)
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8')

    return JSON.parse(jsonPayload)
  } catch (err) {
    console.error('[supaChat] ❌ Failed to decode JWT:', err)
    return null
  }
}

/**
 * Verify JWT token and return authenticated Supabase client + user ID
 * The client is authenticated with the user's JWT, so:
 * - RLS policies automatically filter by owner_id
 * - auth.uid() returns the user's actual UUID (not NULL)
 *
 * ZERO network calls - decodes JWT locally for instant validation
 */
async function verifyAuth(req: express.Request): Promise<{ userId: string; client: SupabaseClient }> {
  const jwt = getAuthToken(req)

  // Create authenticated client with user's JWT
  const client = createAuthenticatedClient(jwt)

  // Decode JWT LOCALLY (NO network call - pure base64 decode)
  const claims = decodeJWT(jwt)

  if (!claims) {
    throw new Error('Authentication failed: Invalid JWT format')
  }

  // Check expiry locally
  const exp = claims.exp as number
  if (!exp) {
    throw new Error('Authentication failed: Missing exp claim in JWT')
  }

  const now = Math.floor(Date.now() / 1000)
  if (exp < now) {
    throw new Error('Authentication failed: JWT has expired')
  }

  // Extract user ID from JWT claims (sub = subject = user ID)
  const userId = claims.sub as string

  if (!userId) {
    throw new Error('Authentication failed: Missing user ID in token claims')
  }

  // console.log('[supaChat] ✅ JWT decoded locally (ZERO network calls) for user:', userId)

  return { userId, client }
}

// Global search endpoint - Uses JWT auth so auth.uid() works correctly
router.get(
  '/search',
  expensiveOperationsRateLimiter, // Apply expensive operations rate limiter
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req) // ✅ Use user's JWT, not service_role
    const q = (req.query.q as string) || ''

    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }

    // Use RPC with authenticated client - auth.uid() will work!
    const { data, error } = await client.rpc('search_messages', {
      query_text: q,
    })

    if (error) {
      console.error('Search error:', error)
      throw error
    }

    res.json(data || [])
  })
)

// Search by project - Uses JWT auth so auth.uid() works correctly
router.get(
  '/search/project',
  asyncHandler(async (req, res) => {
    const { client } = await verifyAuth(req) // ✅ Use user's JWT
    const q = (req.query.q as string) || ''

    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }

    const projectId = req.query.projectId as string
    if (!projectId) {
      return res.status(400).json({ error: 'Missing projectId parameter' })
    }

    // Use RPC with authenticated client for project search
    const { data, error } = await client.rpc('search_messages_by_project', {
      query_text: q,
      project_id: projectId,
    })

    if (error) {
      console.error('Project search error:', error)
      throw error
    }

    res.json(data || [])
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
router.get(
  '/models/openrouter',
  asyncHandler(async (req, res) => {
    try {
      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        return res.status(400).json({ error: 'Missing OPENROUTER_API_KEY' })
      }

      const response = await fetch('https://openrouter.ai/api/v1/models', {
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

      const models = rawModels
        .map(m => {
          const rawId = String(m?.id || m?.name || '')
          const name = rawId.replace(/^models\//, '')
          if (!name) return null
          const displayName = String(m?.display_name || m?.displayName || name)
          const description = String(m?.description || '')
          const inputTokenLimit = Number(m?.context_length ?? m?.context_length_tokens ?? 0)
          const outputTokenLimit = Number(m?.output_token_limit ?? m?.max_output_tokens ?? 0)
          const supportedParams: string[] = Array.isArray(m?.supported_parameters) ? m.supported_parameters : []
          const capabilities = (m as any)?.capabilities || {}
          const thinking =
            supportedParams.includes('reasoning') ||
            supportedParams.includes('include_reasoning') ||
            !!capabilities?.reasoning ||
            /thinking/i.test(name) ||
            /thinking/i.test(displayName)
          return {
            name,
            version: String(m?.version || ''),
            displayName,
            description,
            inputTokenLimit,
            outputTokenLimit,
            thinking,
            supportedGenerationMethods: supportedParams,
          }
        })
        .filter(Boolean) as any[]

      const preferredDefault = 'gpt-4o'
      const defaultModel = models.find((m: any) => m.name === preferredDefault) || models[0] || null

      res.json({ models, default: defaultModel })
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error)
      res.status(500).json({ error: 'Failed to fetch OpenRouter models' })
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
    console.log('\n🔴🔴🔴 [SERVER] GET /users/:userId/conversations')
    console.log('🔴 Timestamp:', new Date().toISOString())
    console.log('🔴 User-Agent:', req.headers['user-agent'])
    console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    console.log('🔴 Origin:', req.headers['origin'])
    console.log('🔴 All Headers:', JSON.stringify(req.headers, null, 2))
    console.log('🔴 Stack:', new Error().stack)

    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getByUser(client)
    res.json(conversations)
  })
)

// Get recent user conversations
router.get(
  '/users/:userId/conversations/recent',
  asyncHandler(async (req, res) => {
    console.log('\n🔴🔴🔴 [SERVER] GET /users/:userId/conversations/recent')
    console.log('🔴 Timestamp:', new Date().toISOString())
    console.log('🔴 User-Agent:', req.headers['user-agent'])
    console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    console.log('🔴 Origin:', req.headers['origin'])
    console.log('🔴 Query params:', req.query)
    console.log('🔴 Stack:', new Error().stack)

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10
    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getRecentByUser(client, limit)
    res.json(conversations)
  })
)

// Get conversation by projectID
router.get(
  '/conversations/project/:projectId',
  asyncHandler(async (req, res) => {
    console.log('\n🔴🔴🔴 [SERVER] GET /conversations/project/:projectId')
    console.log('🔴 Timestamp:', new Date().toISOString())
    console.log('🔴 Project ID:', req.params.projectId)
    console.log('🔴 User-Agent:', req.headers['user-agent'])
    console.log('🔴 Referer:', req.headers['referer'] || req.headers['referrer'])
    console.log('🔴 Origin:', req.headers['origin'])
    console.log('🔴 Stack:', new Error().stack)

    const projectId = req.params.projectId
    const { client } = await verifyAuth(req)
    const conversations = await ConversationService.getByProjectId(client, projectId)
    res.json(conversations)
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
    const { title, modelName, projectId, systemPrompt, conversationContext } = req.body
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
        msg.note || undefined
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
    } = req.body

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
    const createdAttachments: Awaited<ReturnType<typeof AttachmentService.getById>>[] = attachmentsBase64
      ? await saveBase64ImageAttachmentsForMessage(client, userMessage.id, attachmentsBase64, userId)
      : []

    try {
      const repeats = Math.max(1, parseInt(repeatNum as string, 10) || 1)
      const { id: messageId, controller } = createGeneration(userMessage.id)
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: userMessage.id })}\n\n`)

      for (let i = 0; i < repeats; i++) {
        let assistantContent = ''
        let assistantThinking = ''
        let assistantToolCalls = ''

        // Don't create placeholder message - will create after each iteration completes
        await generateResponse(
          baseHistory as any,
          chunk => {
            try {
              const obj = JSON.parse(chunk)
              const part = obj?.part as 'text' | 'reasoning' | 'tool_call' | undefined
              const delta = String(obj?.delta ?? '')
              if (part === 'reasoning') {
                assistantThinking += delta
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta, content: '', iteration: i })}\n\n`
                )
              } else if (part === 'tool_call') {
                // Validate that delta is valid JSON before adding to tool_calls
                try {
                  // Try to parse delta as JSON to validate it
                  const parsedDelta = JSON.parse(delta)
                  // If it's valid JSON, add it to the array
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(delta)
                  assistantToolCalls = JSON.stringify(currentToolCalls)
                  res.write(`data: ${JSON.stringify({ type: 'tool_call', delta, content: '', iteration: i })}\n\n`)
                } catch (e) {
                  // If delta is not valid JSON, treat it as regular content instead
                  console.warn(
                    '⚠️  [supaChat repeats] Received invalid JSON in tool_call part, treating as content:',
                    delta
                  )
                  assistantContent += delta
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta, iteration: i })}\n\n`
                  )
                }
              } else {
                const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
                if (delta.includes('{"') && toolCallRegex.test(delta)) {
                  const matches = delta.match(toolCallRegex)
                  if (matches) {
                    // Validate each match is valid JSON before adding
                    const validMatches = matches.filter(match => {
                      try {
                        JSON.parse(match)
                        return true
                      } catch {
                        console.warn('⚠️  [supaChat repeats] Regex matched invalid JSON, skipping:', match)
                        return false
                      }
                    })

                    if (validMatches.length > 0) {
                      const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                      currentToolCalls.push(...validMatches)
                      assistantToolCalls = JSON.stringify(currentToolCalls)

                      res.write(
                        `data: ${JSON.stringify({ type: 'tool_call', delta: validMatches.join(''), content: '', iteration: i })}\n\n`
                      )
                    }

                    const cleanedDelta = delta.replace(toolCallRegex, '').trim()
                    if (cleanedDelta) {
                      assistantContent += cleanedDelta
                      res.write(
                        `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedDelta, content: cleanedDelta, iteration: i })}\n\n`
                      )
                    }
                  }
                } else {
                  assistantContent += delta
                  res.write(
                    `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta, iteration: i })}\n\n`
                  )
                }
              }
            } catch {
              const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
              if (chunk.includes('{"') && toolCallRegex.test(chunk)) {
                const matches = chunk.match(toolCallRegex)
                if (matches) {
                  // Validate each match is valid JSON before adding
                  const validMatches = matches.filter(match => {
                    try {
                      JSON.parse(match)
                      return true
                    } catch {
                      console.warn('⚠️  [supaChat repeats] Regex matched invalid JSON in catch block, skipping:', match)
                      return false
                    }
                  })

                  if (validMatches.length > 0) {
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...validMatches)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: validMatches.join(''), content: '', iteration: i })}\n\n`
                    )
                  }

                  const cleanedChunk = chunk.replace(toolCallRegex, '').trim()
                  if (cleanedChunk) {
                    assistantContent += cleanedChunk
                    res.write(
                      `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedChunk, content: cleanedChunk, iteration: i })}\n\n`
                    )
                  }
                }
              } else {
                assistantContent += chunk
                res.write(
                  `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: chunk, content: chunk, iteration: i })}\n\n`
                )
              }
            }
          },
          provider,
          selectedModel,
          createdAttachments.map(a => ({
            url: a?.url || undefined,
            mimeType: (a as any)?.mime_type,
            filePath: (a as any)?.storage_path,
          })),
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          undefined, // No assistant message ID yet (will create after streaming)
          userId,
          conversationId
        )

        const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
        if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
          const matches = assistantContent.match(toolCallRegex)
          if (matches) {
            assistantToolCalls = JSON.stringify(matches)
          }
        }
        const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()

        if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
          // Validate assistantToolCalls before passing to MessageService.create
          console.log('🔧 [supaChat/repeat] assistantToolCalls value:', assistantToolCalls)
          console.log('🔧 [supaChat/repeat] iteration:', i)

          // Create assistant message with final content (not update placeholder)
          try {
            const assistantMessage = await MessageService.create(
              client,
              userId,
              conversationId,
              userMessage.id,
              'assistant',
              cleanedContent,
              assistantThinking,
              selectedModel,
              assistantToolCalls
            )
            // console.log(assistantMessage)

            const cleanedMessage = { ...assistantMessage, content: cleanedContent }
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
      if (userMessage.parent_id === null) {
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
    console.log('\n🟢🟢🟢 [SERVER] POST /conversations/:id/messages - Message send received')
    console.log('🟢 Timestamp:', new Date().toISOString())
    console.log('🟢 Conversation ID:', req.params.id)

    const conversationId = req.params.id
    const { client, userId } = await verifyAuth(req)
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
    } = req.body as {
      content: string
      messages?: any[]
      modelName?: string
      parentId?: string
      provider?: string
      systemPrompt?: string
      conversationContext?: string | null
      projectContext?: string | null
      think?: boolean
      selectedFiles?: SelectedFileContent[]
      retrigger?: boolean
    }

    if (!content && !retrigger) {
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

    // Use client-provided parentId directly - RLS will enforce FK constraints
    let parentId: string | null = null
    if (requestedParentId !== undefined) {
      parentId = requestedParentId
    } else {
      const lastMessage = await MessageService.getLastMessage(client, conversationId)
      parentId = lastMessage?.id || null
    }

    // Save user message with proper parent ID (skip if retrigger)
    let userMessage
    if (retrigger) {
      // For retrigger, get the last user message instead of creating a new one
      const lastMessage = await MessageService.getLastMessage(client, conversationId)
      if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: 'Cannot retrigger: last message is not from user' })
      }
      userMessage = lastMessage
      // console.log('server | retriggering from existing user message', userMessage.id)
    } else {
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
      // console.log('server | user message', messages)

      if (selectedFiles && selectedFiles.length > 0) {
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
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    })

    // Send user message immediately (only if not retrigger)
    if (!retrigger) {
      res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`)
    }

    try {
      const attachmentsBase64 = Array.isArray(req.body?.attachmentsBase64) ? req.body.attachmentsBase64 : null
      const createdAttachments: Awaited<ReturnType<typeof AttachmentService.getById>>[] = attachmentsBase64
        ? await saveBase64ImageAttachmentsForMessage(client, userMessage.id, attachmentsBase64, userId)
        : []

      const userMessageForAI = { ...userMessage, content: processedContent }
      const combinedMessages = Array.isArray(messages) ? [...messages, userMessageForAI] : [userMessageForAI]

      let assistantContent = ''
      let assistantThinking = ''
      let assistantToolCalls = ''

      // Don't create placeholder message - will create after streaming completes
      const { id: messageId, controller } = createGeneration(userMessage.id)
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: userMessage.id })}\n\n`)

      try {
        await generateResponse(
          combinedMessages,
          chunk => {
            try {
              const obj = JSON.parse(chunk)
              const part = obj?.part as 'text' | 'reasoning' | 'tool_call' | undefined
              const delta = String(obj?.delta ?? '')
              if (part === 'reasoning') {
                assistantThinking += delta
                res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta, content: '' })}\n\n`)
              } else if (part === 'tool_call') {
                // Validate that delta is valid JSON before adding to tool_calls
                try {
                  // Try to parse delta as JSON to validate it
                  const parsedDelta = JSON.parse(delta)
                  // If it's valid JSON, add it to the array
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(delta)
                  assistantToolCalls = JSON.stringify(currentToolCalls)
                  res.write(`data: ${JSON.stringify({ type: 'tool_call', delta, content: '' })}\n\n`)
                } catch (e) {
                  // If delta is not valid JSON, treat it as regular content instead
                  console.warn('⚠️  [supaChat] Received invalid JSON in tool_call part, treating as content:', delta)
                  assistantContent += delta
                  res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta })}\n\n`)
                }
              } else {
                const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
                if (delta.includes('{"') && toolCallRegex.test(delta)) {
                  const matches = delta.match(toolCallRegex)
                  if (matches) {
                    // Validate each match is valid JSON before adding
                    const validMatches = matches.filter(match => {
                      try {
                        JSON.parse(match)
                        return true
                      } catch {
                        console.warn('⚠️  [supaChat] Regex matched invalid JSON, skipping:', match)
                        return false
                      }
                    })

                    if (validMatches.length > 0) {
                      const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                      currentToolCalls.push(...validMatches)
                      assistantToolCalls = JSON.stringify(currentToolCalls)

                      res.write(
                        `data: ${JSON.stringify({ type: 'tool_call', delta: validMatches.join(''), content: '' })}\n\n`
                      )
                    }

                    const cleanedDelta = delta.replace(toolCallRegex, '').trim()
                    if (cleanedDelta) {
                      assistantContent += cleanedDelta
                      res.write(
                        `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedDelta, content: cleanedDelta })}\n\n`
                      )
                    }
                  }
                } else {
                  assistantContent += delta
                  res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta, content: delta })}\n\n`)
                }
              }
            } catch {
              const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
              if (chunk.includes('{"') && toolCallRegex.test(chunk)) {
                const matches = chunk.match(toolCallRegex)
                if (matches) {
                  // Validate each match is valid JSON before adding
                  const validMatches = matches.filter(match => {
                    try {
                      JSON.parse(match)
                      return true
                    } catch {
                      console.warn('⚠️  [supaChat] Regex matched invalid JSON in catch block, skipping:', match)
                      return false
                    }
                  })

                  if (validMatches.length > 0) {
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...validMatches)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: validMatches.join(''), content: '' })}\n\n`
                    )
                  }

                  const cleanedChunk = chunk.replace(toolCallRegex, '').trim()
                  if (cleanedChunk) {
                    assistantContent += cleanedChunk
                    res.write(
                      `data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: cleanedChunk, content: cleanedChunk })}\n\n`
                    )
                  }
                }
              } else {
                assistantContent += chunk
                res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'text', delta: chunk, content: chunk })}\n\n`)
              }
            }
          },
          provider as 'ollama' | 'gemini' | 'anthropic' | 'openai' | 'openrouter' | 'lmstudio',
          selectedModel,
          createdAttachments.map(a => ({
            url: a?.url || undefined,
            mimeType: (a as any)?.mime_type,
            filePath: (a as any)?.storage_path,
          })),
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          undefined, // No assistant message ID yet (will create after streaming)
          userId
        )

        // Clean up content and extract tool calls after streaming completes
        const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
        if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
          const matches = assistantContent.match(toolCallRegex)
          if (matches) {
            assistantToolCalls = JSON.stringify(matches)
            console.log('Final extraction - found tool calls:', assistantToolCalls)
          }
        }
        const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()
        console.log('Original content length:', assistantContent.length, 'Cleaned length:', cleanedContent.length)

        // Validate assistantToolCalls before passing to MessageService.create
        console.log('🔧 [supaChat] assistantToolCalls value:', assistantToolCalls)
        console.log('🔧 [supaChat] assistantToolCalls type:', typeof assistantToolCalls)
        console.log('🔧 [supaChat] assistantToolCalls length:', assistantToolCalls?.length)

        // Create assistant message with final content (not update placeholder)
        try {
          const assistantMessage = await MessageService.create(
            client,
            userId,
            conversationId,
            userMessage.id,
            'assistant',
            cleanedContent,
            assistantThinking,
            selectedModel,
            assistantToolCalls
          )
          // console.log(assistantMessage)
          const cleanedMessage = { ...assistantMessage, content: cleanedContent }
          res.write(
            `data: ${JSON.stringify({
              type: 'complete',
              message: cleanedMessage,
            })}\n\n`
          )

          // Auto-generate title if this is the first message (no parent ID)
          if (userMessage.parent_id === null) {
            console.log('Auto-generating title for new conversation', conversationId)
            const title = content.slice(0, 100) + (content.length > 100 ? '...' : '')
            await ConversationService.updateTitle(client, conversationId, title)
          }
        } catch (createError) {
          console.error('❌ [supaChat] Failed to create assistant message:', createError)
          console.error('❌ [supaChat] Message details:', {
            conversationId,
            userId,
            parentId: userMessage.id,
            contentLength: cleanedContent.length,
            thinkingLength: assistantThinking.length,
            toolCallsValue: assistantToolCalls,
          })
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
          const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
          if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
            const matches = assistantContent.match(toolCallRegex)
            if (matches) {
              assistantToolCalls = JSON.stringify(matches)
            }
          }
          const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()

          if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
            // Create message with partial content from aborted generation
            console.log('🔧 [supaChat/abort] Saving partial content, toolCalls:', assistantToolCalls)
            try {
              const assistantMessage = await MessageService.create(
                client,
                userId,
                conversationId,
                userMessage.id,
                'assistant',
                cleanedContent,
                assistantThinking,
                selectedModel,
                assistantToolCalls
              )
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
          // Non-abort error - just send error event (no cleanup needed)
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            })}\n\n`
          )
        }
      } finally {
        clearGeneration(messageId)
      }

      res.end()
    } catch (error) {
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
    const { content, note } = req.body
    const { client, userId } = await verifyAuth(req)

    if (!content) return res.status(400).json({ error: 'Content required' })

    // Pass parameters in correct order: (client, id, content, thinking_block, tool_calls, note)
    // null for thinking_block and tool_calls preserves existing values
    const updated = await MessageService.update(client, messageId, content, null, null, note)
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
