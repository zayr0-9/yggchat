// server/src/routes/chat.ts
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import multer from 'multer'
import path from 'path'
import { MessageId } from '../../../shared/types'
import {
  AttachmentService,
  buildMessageTree,
  ConversationService,
  FileContentService,
  Message,
  MessageService,
  ProjectService,
  UserService,
} from '../database/models'
import { asyncHandler } from '../utils/asyncHandler'
import { modelService } from '../utils/modelService'
// import { generateResponse } from '../utils/ollama'
import { saveBase64ImageAttachmentsForMessage } from '../utils/attachments'
import { replaceFileMentionsWithContent, SelectedFileContent } from '../utils/fileMentionProcessor'
import { abortGeneration, clearGeneration, createGeneration } from '../utils/generationManager'
import { generateResponse } from '../utils/provider'
import { getToolByName, updateToolEnabled } from '../utils/tools/index'

const router = express.Router()

// Global search endpoint (userId query param required for proper scoping)
router.get(
  '/search',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) || ''
    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }
    // Default to local user UUID for local mode compatibility
    const userId = (req.query.userId as string | undefined) || 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
    const results = MessageService.searchAllUserMessages(q, userId, 50)
    res.json(results)
  })
)

//Search by project
router.get(
  '/search/project',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string) || ''
    if (!q.trim()) {
      return res.status(400).json({ error: 'Missing q parameter' })
    }
    const projectId = req.query.projectId as string | undefined
    if (!projectId) {
      return res.status(400).json({ error: 'Missing projectId parameter' })
    }
    const results = MessageService.searchMessagesByProject(q, projectId)
    res.json(results)
  })
)

//Fetch openai models on the server to keep API key private
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

      // OpenRouter returns { data: Model[] }
      const data = (await response.json()) as { data?: any[]; models?: any[] }
      const rawModels: any[] = Array.isArray(data?.data) ? data.data! : Array.isArray(data?.models) ? data.models! : []

      // Prefer the canonical model id; fallback to name if necessary
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

//Fetch openRouter models on the server to keep API key private
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

      // Map OpenRouter response to client Model shape (same as Gemini endpoint)
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

      // Map Anthropic response to the same shape as the Gemini endpoint
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

//fetch models ollama
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
    const models = MessageService.getRecentModels(limit)
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

      // Only include chat-capable models (support generateContent)
      const chatCapable = rawModels.filter(m => {
        const methods = m?.supportedGenerationMethods || m?.supportedActions || []
        return Array.isArray(methods) && methods.includes('generateContent')
      })
      // console.log('chatCapable', chatCapable)
      // Map Google response to client Model shape
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

      // Map LM Studio response to client Model shape
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
  asyncHandler(async (req, res) => {
    const { username } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Username required' })
    }

    let user = UserService.getByUsername(username)
    if (!user) {
      user = UserService.create(username)
    }

    res.json(user)
  })
)

// Get user conversations
router.get(
  '/users/:userId/conversations',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId
    const conversations = ConversationService.getByUser(userId)
    res.json(conversations)
  })
)

// Get recent user conversations (limit via ?limit=number, default 10)
router.get(
  '/users/:userId/conversations/recent',
  asyncHandler(async (req, res) => {
    const userId = req.params.userId
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10
    const conversations = ConversationService.getRecentByUser(userId, limit)
    res.json(conversations)
  })
)

//get conversation by projectID
router.get(
  '/conversations/project/:projectId',
  asyncHandler(async (req, res) => {
    const projectId = req.params.projectId
    const conversations = ConversationService.getByProjectId(projectId)
    res.json(conversations)
  })
)

//get all users
router.get(
  '/users/',
  asyncHandler(async (req, res) => {
    const users = UserService.getAll()
    res.json(users)
  })
)

// Get specific user
router.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const userId = req.params.id
    const user = UserService.getById(userId)

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(user)
  })
)

// Update user
router.put(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const userId = req.params.id
    const { username } = req.body

    if (!username) {
      return res.status(400).json({ error: 'Username required' })
    }

    const user = UserService.update(userId, username)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json(user)
  })
)

// Delete user (cascade delete conversations and messages)
router.delete(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const userId = req.params.id

    const user = UserService.getById(userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Get user conversations for cascade delete
    const conversations = ConversationService.getByUser(userId)

    // Delete all messages in all conversations
    conversations.forEach(conv => {
      MessageService.deleteByConversation(conv.id)
    })

    // Delete all user conversations
    ConversationService.deleteByUser(userId)

    // Delete user
    UserService.delete(userId)

    res.json({ message: 'User and all associated data deleted' })
  })
)

// Create conversation
router.post(
  '/conversations',
  asyncHandler(async (req, res) => {
    const { userId, title, modelName, projectId } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId required' })
    }

    const conversation = await ConversationService.create(userId, title, modelName, projectId)
    res.json(conversation)
  })
)

//update conversation title
router.patch(
  '/conversations/:id/',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { title } = req.body

    if (!title) {
      return res.status(400).json({ error: 'Title required' })
    }

    const existing = ConversationService.getById(conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const updated = ConversationService.updateTitle(conversationId, title)
    res.json(updated)
  })
)

// Get conversation system prompt
router.get(
  '/conversations/:id/system-prompt',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const conversation = ConversationService.getById(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    const systemPrompt = ConversationService.getSystemPrompt(conversationId)
    res.json({ systemPrompt })
  })
)

//Get conversation context
router.get(
  '/conversations/:id/context',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const conversation = ConversationService.getById(conversationId)

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    const context = ConversationService.getConversationContext(conversationId)

    res.json({ context })
  })
)

// Update conversation system prompt
router.patch(
  '/conversations/:id/system-prompt',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { systemPrompt } = req.body as { systemPrompt?: string | null }

    // Validate existence
    const existing = ConversationService.getById(conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    // Validate payload: allow string or null to clear; undefined is invalid
    if (typeof systemPrompt === 'undefined') {
      return res.status(400).json({ error: 'systemPrompt is required (string or null)' })
    }

    const updated = ConversationService.updateSystemPrompt(conversationId, systemPrompt ?? null)
    res.json(updated)
  })
)

//update conversation context
router.patch(
  '/conversations/:id/context',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const { context } = req.body as { context?: string | null }

    const existing = ConversationService.getById(conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    if (typeof context === 'undefined') {
      return res.status(400).json({ error: 'context is required (string or null)' })
    }
    if (context) {
      const updated = ConversationService.updateContext(conversationId, context)
      res.json(updated)
    } else {
      // return error if no context sent
      return res.status(400).json({ error: 'context is required (string or null)' })
    }
  })
)
// Clone conversation
router.post(
  '/conversations/:id/clone',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id

    const existing = ConversationService.getById(conversationId)
    if (!existing) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const cloned = ConversationService.clone(conversationId)
    if (!cloned) {
      return res.status(500).json({ error: 'Failed to clone conversation' })
    }

    res.json(cloned)
  })
)

//delete conversation
router.delete(
  '/conversations/:id/',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const conversation = ConversationService.getById(conversationId)
    if (conversation) {
      ConversationService.delete(conversationId)
      res.json({ message: 'Conversation deleted' })
    } else {
      res.status(404).json({ error: 'Conversation not found' })
    }
  })
)

// Get conversation messages
router.get(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const messages = MessageService.getByConversation(conversationId)
    res.json(messages)
  })
)

// get conversation children
router.get(
  '/conversations/:conversationId/messages/:messageId/children',
  asyncHandler(async (req, res) => {
    const { conversationId, messageId } = req.params
    const childrenIds = MessageService.getChildrenIds(messageId)
    res.json(childrenIds)
  })
)

//PROJECTS

//get projects
router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    const projects = ProjectService.getAll()
    res.json(projects)
  })
)

//get projects sorted by latest conversation
router.get(
  '/projects/sorted/latest-conversation',
  asyncHandler(async (req, res) => {
    const userId = (req.query.userId as string | undefined) || 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
    const projects = ProjectService.getAllSortedByLatestConversation(userId)
    res.json(projects)
  })
)

//get project by id
router.get(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const projectId = req.params.id
    const project = ProjectService.getById(projectId)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json(project)
  })
)

//create project
router.post(
  '/projects',
  asyncHandler(async (req, res) => {
    const { name, conversation_id, context, system_prompt, userId } = req.body

    if (!userId) {
      return res.status(400).json({ error: 'userId required' })
    }

    const now = new Date().toISOString()
    const project = await ProjectService.create(
      name,
      now, // created_at - server generated
      now, // updated_at - server generated
      conversation_id || null,
      context || null,
      system_prompt || null,
      userId
    )
    res.json(project)
  })
)

//update project
router.put(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const projectId = req.params.id
    const now = new Date().toISOString()
    const { name, context, system_prompt } = req.body
    const project = ProjectService.update(projectId, name, now, context, system_prompt)
    if (!project) {
      return res.status(404).json({ error: 'Project not found' })
    }
    res.json(project)
  })
)

//delete project
router.delete(
  '/projects/:id',
  asyncHandler(async (req, res) => {
    const projectId = req.params.id
    const project = ProjectService.getById(projectId)
    if (project) {
      ProjectService.delete(projectId)
      res.json({ message: 'Project deleted' })
    } else {
      res.status(404).json({ error: 'Project not found' })
    }
  })
)

//get message tree
router.get(
  '/conversations/:id/messages/tree',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const messages = MessageService.getByConversation(conversationId)

    const treeData = buildMessageTree(messages)
    res.json({ messages, tree: treeData })
  })
)

// Send message with streaming response (with repeat capability)
router.post(
  '/conversations/:id/messages/repeat',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const {
      content,
      modelName,
      parentId: requestedParentId,
      repeatNum = 1,
      provider = 'ollama',
      systemPrompt,
      think,
    } = req.body

    if (!content) {
      return res.status(400).json({ error: 'Message content required' })
    }

    // Verify conversation exists
    const conversation = ConversationService.getById(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    // Get project context and conversation context
    const projectId = ProjectService.getProjectIdFromConversation(conversationId)
    const projectContext = projectId ? ProjectService.getProjectContext(projectId) : null
    const conversationContext = ConversationService.getConversationContext(conversationId)

    // Combine contexts: project context first, then conversation context
    let combinedContext = ''
    if (projectContext) {
      combinedContext += projectContext
    }
    if (conversationContext) {
      if (combinedContext) combinedContext += '\n\n'
      combinedContext += conversationContext
    }

    // const conversationSystemPrompt = ConversationService.getSystemPrompt(conversationId)
    //we should ideally call this but rn we are just passing from front end, cleanup later

    // Use conversation's model or provided model or default
    const selectedModel = modelName || conversation.model_name || (await modelService.getDefaultModel())

    // Determine parent ID: use requested parentId if provided, otherwise get last message
    let parentId: MessageId | null = null
    if (requestedParentId !== undefined) {
      const parentMessage = MessageService.getById(requestedParentId)
      parentId = parentMessage ? requestedParentId : null
    } else {
      const lastMessage = MessageService.getLastMessage(conversationId)
      if (lastMessage) {
        const validParent = MessageService.getById(lastMessage.id)
        parentId = validParent ? lastMessage.id : null
      }
    }

    // Save user message with proper parent ID
    const userMessage = MessageService.create(conversationId, parentId, 'user', content, '', selectedModel)

    // Setup SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
    })

    // Send user message immediately
    res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`)
    const baseHistory = MessageService.getByConversation(conversationId)

    // Decode and persist any base64 attachments (images) for the user message
    const attachmentsBase64 = Array.isArray(req.body?.attachmentsBase64) ? req.body.attachmentsBase64 : null
    const createdAttachments: ReturnType<typeof AttachmentService.getById>[] = attachmentsBase64
      ? saveBase64ImageAttachmentsForMessage(userMessage.id, attachmentsBase64)
      : []

    try {
      const repeats = Math.max(1, parseInt(repeatNum as string, 10) || 1)
      const { id: messageId, controller } = createGeneration(userMessage.id)
      // Inform client of message id so it can cancel later
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: userMessage.id })}\n\n`)
      // Only clear on close; do NOT abort automatically
      // Don't clear on close - let it complete naturally or be aborted manually
      // req.on('close', () => clearGeneration(messageId))
      for (let i = 0; i < repeats; i++) {
        let assistantContent = ''
        let assistantThinking = ''
        let assistantToolCalls = ''

        // Create assistant message placeholder for cost tracking
        const assistantMessage = MessageService.create(
          conversationId,
          userMessage.id,
          'assistant',
          '...',
          '',
          selectedModel,
          ''
        )

        await generateResponse(
          baseHistory,
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
                assistantToolCalls += delta
                res.write(`data: ${JSON.stringify({ type: 'tool_call', delta, content: '', iteration: i })}\n\n`)
              } else {
                // Check if this delta contains tool calls and handle them
                const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
                if (delta.includes('{"') && toolCallRegex.test(delta)) {
                  // Extract tool calls from this delta
                  const matches = delta.match(toolCallRegex)
                  if (matches) {
                    // Add to tool calls buffer
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...matches)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    // Send tool call chunk
                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: matches.join(''), content: '', iteration: i })}\n\n`
                    )

                    // Clean the delta of tool calls before adding to content
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
              // Fallback: treat as plain text but still check for tool calls
              const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
              if (chunk.includes('{"') && toolCallRegex.test(chunk)) {
                const matches = chunk.match(toolCallRegex)
                if (matches) {
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(...matches)
                  assistantToolCalls = JSON.stringify(currentToolCalls)

                  res.write(
                    `data: ${JSON.stringify({ type: 'tool_call', delta: matches.join(''), content: '', iteration: i })}\n\n`
                  )

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
            filePath: (a as any)?.file_path,
          })),
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          assistantMessage.id,
          conversation.user_id
        )

        // Final cleanup: ensure tool calls are stripped from content before saving
        const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
        if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
          const matches = assistantContent.match(toolCallRegex)
          if (matches) {
            assistantToolCalls = JSON.stringify(matches)
          }
        }
        const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()

        if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
          // Update the existing assistant message with final content
          const updatedMessage = MessageService.update(
            assistantMessage.id,
            cleanedContent,
            assistantThinking,
            assistantToolCalls
          )

          const cleanedMessage = { ...updatedMessage, content: cleanedContent }
          res.write(`data: ${JSON.stringify({ type: 'complete', message: cleanedMessage, iteration: i })}\n\n`)
        } else {
          res.write(`data: ${JSON.stringify({ type: 'no_output', iteration: i })}\n\n`)
        }
      }

      // Clear generation on successful completion
      clearGeneration(messageId)

      if (!conversation.title && parentId === null) {
        const title = content.slice(0, 100) + (content.length > 100 ? '...' : '')
        ConversationService.updateTitle(conversationId, title)
      }
    } catch (error) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
    } finally {
      // Best-effort cleanup
      try {
        const { id: _ } = { id: '' }
      } catch {}
    }

    res.end()
  })
)

// Bulk insert messages (for copying message chains)
router.post(
  '/conversations/:id/messages/bulk',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
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

    // Verify conversation exists
    const conversation = ConversationService.getById(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    const createdMessages: Message[] = []
    let lastMessageId: MessageId | null = null

    // Insert messages sequentially, maintaining parent-child relationships
    for (const msg of messages) {
      const newMessage = MessageService.create(
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

    // Update conversation timestamp
    ConversationService.touch(conversationId)

    // Auto-generate title if this is the first message
    if (!conversation.title && messages.length > 0) {
      const firstContent = messages[0].content
      const title = firstContent.slice(0, 100) + (firstContent.length > 100 ? '...' : '')
      ConversationService.updateTitle(conversationId, title)
    }

    res.json({ messages: createdMessages })
  })
)

// Send message with streaming response
router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id
    const {
      content,
      messages,
      modelName,
      parentId: requestedParentId,
      provider = 'ollama',
      systemPrompt,
      think,
      selectedFiles,
      retrigger = false,
    } = req.body as {
      content: string
      messages?: any[]
      modelName?: string
      parentId?: MessageId
      provider?: string
      systemPrompt?: string
      think?: boolean
      selectedFiles?: SelectedFileContent[]
      retrigger?: boolean
    }

    if (!content && !retrigger) {
      return res.status(400).json({ error: 'Message content required' })
    }

    // If no selectedFiles provided, check database for existing file content from previous messages
    let filesToUse = selectedFiles || []
    if (!filesToUse || filesToUse.length === 0) {
      // Look for file content in recent messages from this conversation that might match file mentions
      const recentMessages = MessageService.getByConversation(conversationId)
      const fileContentMap = new Map<string, any>()

      // Collect all file content from recent messages
      for (const msg of recentMessages.slice(-10)) {
        // Check last 10 messages
        const fileContents = MessageService.getFileContents(msg.id)
        for (const fc of fileContents) {
          // Use file name and relative path as keys for lookup
          const fileName = fc.file_name
          const baseName = fc.relative_path.split('/').pop() || fc.file_name

          if (!fileContentMap.has(fileName)) {
            fileContentMap.set(fileName, fc)
          }
          if (!fileContentMap.has(baseName)) {
            fileContentMap.set(baseName, fc)
          }
        }
      }

      // Check if current content has file mentions that match our stored files
      const mentionRegex = /@([A-Za-z0-9._\/-]+)/g
      const mentions = [...content.matchAll(mentionRegex)].map(match => match[1])

      if (mentions.length > 0 && fileContentMap.size > 0) {
        // Convert matching database file content to SelectedFileContent format
        const matchingFiles: SelectedFileContent[] = []
        for (const mention of mentions) {
          const dbFile = fileContentMap.get(mention)
          if (dbFile) {
            // Use stored file content if available, otherwise try to read from disk
            let fileContents = dbFile.file_content || ''
            if (!fileContents && fs.existsSync(dbFile.absolute_path)) {
              try {
                fileContents = fs.readFileSync(dbFile.absolute_path, 'utf8')
              } catch (error) {
                console.warn('Could not read file from disk:', dbFile.absolute_path, error)
                fileContents = `[File content not available - ${dbFile.file_name}]`
              }
            } else if (!fileContents) {
              fileContents = `[File content not available - ${dbFile.file_name}]`
            }

            matchingFiles.push({
              path: dbFile.absolute_path,
              relativePath: dbFile.relative_path,
              name: dbFile.file_name,
              contents: fileContents,
              contentLength: fileContents.length,
            })
          }
        }
        filesToUse = matchingFiles
      }
    }

    // Process file mentions in the content
    const processedContent =
      filesToUse && filesToUse.length > 0 ? replaceFileMentionsWithContent(content, filesToUse) : content
    console.log('server | processedContent', processedContent)

    // Verify conversation exists
    const conversation = ConversationService.getById(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }
    // Get project context and conversation context
    const projectId = ProjectService.getProjectIdFromConversation(conversationId)
    const projectContext = projectId ? ProjectService.getProjectContext(projectId) : null
    // console.log(`projectContext ${projectContext}`)
    const conversationContext = ConversationService.getConversationContext(conversationId)

    // Combine contexts: project context first, then conversation context
    let combinedContext = ''
    if (projectContext) {
      combinedContext += projectContext
    }
    if (conversationContext) {
      if (combinedContext) combinedContext += '\n\n'
      combinedContext += conversationContext
    }

    // const conversationSystemPrompt = ConversationService.getSystemPrompt(conversationId)

    // Use conversation's model or provided model or default
    const selectedModel = modelName || conversation.model_name || (await modelService.getDefaultModel())
    // Determine parent ID: use requested parentId if provided, otherwise get last message
    let parentId: MessageId | null = null
    if (requestedParentId !== undefined) {
      const parentMessage = MessageService.getById(requestedParentId)
      parentId = parentMessage ? requestedParentId : null
      // console.log(`server | parent id - ${parentId}`)
    } else {
      const lastMessage = MessageService.getLastMessage(conversationId)
      if (lastMessage) {
        const validParent = MessageService.getById(lastMessage.id)
        parentId = validParent ? lastMessage.id : null
      }
    }

    // Save user message with proper parent ID (skip if retrigger)
    let userMessage
    if (retrigger) {
      // For retrigger, get the last user message instead of creating a new one
      const lastMessage = MessageService.getLastMessage(conversationId)
      if (!lastMessage || lastMessage.role !== 'user') {
        return res.status(400).json({ error: 'Cannot retrigger: last message is not from user' })
      }
      userMessage = lastMessage
    } else {
      userMessage = MessageService.create(conversationId, parentId, 'user', content, '', selectedModel)

      // Store file content in database if selectedFiles were provided
      if (selectedFiles && selectedFiles.length > 0) {
        for (const file of selectedFiles) {
          try {
            const fileContent = FileContentService.create({
              fileName: file.name || file.relativePath.split('/').pop() || 'unknown',
              absolutePath: file.path,
              relativePath: file.relativePath,
              fileContent: file.contents,
              sizeBytes: file.contentLength,
              messageId: userMessage.id,
            })
          } catch (error) {
            console.error('Error storing file content:', error)
          }
        }
      }
    }

    // Setup SSE headers
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
      // Decode and persist any base64 attachments (images)
      const attachmentsBase64 = Array.isArray(req.body?.attachmentsBase64) ? req.body.attachmentsBase64 : null
      const createdAttachments: ReturnType<typeof AttachmentService.getById>[] = attachmentsBase64
        ? saveBase64ImageAttachmentsForMessage(userMessage.id, attachmentsBase64)
        : []

      // // Get conversation history for context
      // const messages = MessageService.getByConversation(conversationId)
      // const messages = context
      // console.log('server | messages', messages)

      // Ensure latest prompt is included with prior context before generating
      // Use processed content for AI generation while keeping original in database
      const userMessageForAI = { ...userMessage, content: processedContent }
      const combinedMessages = Array.isArray(messages) ? [...messages, userMessageForAI] : [userMessageForAI]

      let assistantContent = ''
      let assistantThinking = ''
      let assistantToolCalls = ''
      let lastChunkId = ''

      // Credit checking removed for local environment
      const userId = conversation.user_id

      // Create assistant message placeholder for cost tracking
      const assistantMessage = MessageService.create(
        conversationId,
        userMessage.id,
        'assistant',
        '...',
        '',
        selectedModel,
        ''
      )

      // Stream AI response with manual abort control - use ASSISTANT message ID since that's what's being generated
      const { id: messageId, controller } = createGeneration(assistantMessage.id)
      res.write(`data: ${JSON.stringify({ type: 'generation_started', messageId: assistantMessage.id })}\n\n`)
      // Don't clear on close - let it complete naturally or be aborted manually
      // req.on('close', () => clearGeneration(messageId))
      try {
        await generateResponse(
          combinedMessages,
          chunk => {
            try {
              const obj = JSON.parse(chunk)
              const part = obj?.part as 'text' | 'reasoning' | 'tool_call' | undefined
              const delta = String(obj?.delta ?? '')
              const genId = obj?.chunkId
              // console.log('genId from chat.ts:', genId)

              // Store the last valid chunkId
              if (genId) lastChunkId = genId

              if (part === 'reasoning') {
                assistantThinking += delta
                res.write(`data: ${JSON.stringify({ type: 'chunk', part: 'reasoning', delta, content: '' })}\n\n`)
              } else if (part === 'tool_call') {
                assistantToolCalls += delta
                res.write(`data: ${JSON.stringify({ type: 'tool_call', delta, content: '' })}\n\n`)
              } else {
                // Check if this delta contains tool calls and handle them
                const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
                if (delta.includes('{"') && toolCallRegex.test(delta)) {
                  // Extract tool calls from this delta
                  const matches = delta.match(toolCallRegex)
                  if (matches) {
                    // Add to tool calls buffer
                    const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                    currentToolCalls.push(...matches)
                    assistantToolCalls = JSON.stringify(currentToolCalls)

                    // Send tool call chunk
                    res.write(
                      `data: ${JSON.stringify({ type: 'tool_call', delta: matches.join(''), content: '' })}\n\n`
                    )

                    // Clean the delta of tool calls before adding to content
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
              // Fallback: treat as plain text but still check for tool calls
              const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
              if (chunk.includes('{"') && toolCallRegex.test(chunk)) {
                const matches = chunk.match(toolCallRegex)
                if (matches) {
                  const currentToolCalls = assistantToolCalls ? JSON.parse(assistantToolCalls) : []
                  currentToolCalls.push(...matches)
                  assistantToolCalls = JSON.stringify(currentToolCalls)

                  res.write(`data: ${JSON.stringify({ type: 'tool_call', delta: matches.join(''), content: '' })}\n\n`)

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
            filePath: (a as any)?.file_path,
          })),
          systemPrompt,
          controller.signal,
          combinedContext ? combinedContext : null,
          think,
          assistantMessage.id,
          conversation.user_id
        )

        // Final cleanup: ensure tool calls are stripped from content before saving
        const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
        if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
          // Extract any remaining tool calls
          const matches = assistantContent.match(toolCallRegex)
          if (matches) {
            assistantToolCalls = JSON.stringify(matches)
          }
        }
        // Always clean content regardless of whether we found new tool calls
        const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()

        // Normal completion -> update assistant message with final content
        const updatedAssistantMessage = MessageService.update(
          assistantMessage.id,
          cleanedContent,
          assistantThinking,
          assistantToolCalls
          // TODO: Add lastChunkId as parameter once database field is added
          // lastChunkId
        )
        // Send completion with cleaned content to override any streamed raw content
        const cleanedMessage = { ...updatedAssistantMessage, content: cleanedContent }
        res.write(
          `data: ${JSON.stringify({
            type: 'complete',
            message: cleanedMessage,
          })}\n\n`
        )

        // Auto-generate title for new conversations (only if first message and no existing title)
        if (!conversation.title && parentId === null) {
        }

        // Decrement credits after successful generation (only if user has subscription)
        // if (hasSubscription) {
        //   const actualCredits = estimateCreditsForGeneration(
        //     Math.ceil((assistantContent.length + assistantThinking.length) / 4),
        //     selectedModel
        //   )
        //   const newBalance = decrementCredits(
        //     userId,
        //     actualCredits,
        //     `AI generation - ${selectedModel} - conversation ${conversationId}`
        //   )

        //   if (newBalance === null) {
        //     console.warn(`[Credits] Failed to decrement credits for user ${userId} after generation`)
        //   } else {
        //     console.log(`[Credits] Decremented ${actualCredits} credits for user ${userId}. New balance: ${newBalance}`)
        //   }
        // }
      } catch (error: any) {
        const isAbort =
          error?.name === 'AbortError' ||
          String(error || '')
            .toLowerCase()
            .includes('abort')
        if (isAbort) {
          // Final cleanup for aborted messages
          const toolCallRegex = /\{[^{}]*"[^"]*":\s*"[^"]*"[^{}]*\}/g
          if (!assistantToolCalls.trim() && assistantContent.includes('{"')) {
            const matches = assistantContent.match(toolCallRegex)
            if (matches) {
              assistantToolCalls = JSON.stringify(matches)
            }
          }
          const cleanedContent = assistantContent.replace(toolCallRegex, '').trim()

          // Persist whatever we have as a partial message
          if (cleanedContent.trim() || assistantThinking.trim() || assistantToolCalls.trim()) {
            const updatedMessage = MessageService.update(
              assistantMessage.id,
              cleanedContent,
              assistantThinking,
              assistantToolCalls
              // TODO: Add lastChunkId as parameter once database field is added
              // lastChunkId
            )
            const cleanedMessage = { ...updatedMessage, content: cleanedContent }
            res.write(`data: ${JSON.stringify({ type: 'complete', message: cleanedMessage, aborted: true })}\n\n`)
          } else {
            // Delete the placeholder message if no content was generated
          }
        } else {
          // Delete placeholder message on general error
          MessageService.delete(assistantMessage.id)
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              error: error instanceof Error ? error.message : 'Unknown error',
            })}\n\n`
          )
        }
      } finally {
        // Ensure cleanup
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
//update message
router.put(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { content, note } = req.body

    if (!content) return res.status(400).json({ error: 'Content required' })

    const updated = MessageService.update(messageId, content, undefined, undefined, note)
    if (!updated) return res.status(404).json({ error: 'Message not found' })

    res.json(updated)
  })
)

router.delete(
  '/messages/:id',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id

    const deleted = MessageService.delete(messageId)
    if (!deleted) return res.status(404).json({ error: 'Message not found' })

    res.json({ success: true })
  })
)

router.post(
  '/messages/deleteMany',
  asyncHandler(async (req, res) => {
    const { ids } = req.body as { ids?: Array<MessageId | string> }
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids (string[]) is required' })
    }

    const normalized = Array.from(
      new Set(ids.filter(id => typeof id === 'string' && id.trim().length > 0))
    ) as MessageId[]

    if (normalized.length === 0) {
      return res.status(400).json({ error: 'No valid ids provided' })
    }

    const deleted = MessageService.deleteMany(normalized)
    res.json({ deleted })
  })
)

// Delete conversation
router.delete(
  '/conversations/:id',
  asyncHandler(async (req, res) => {
    const conversationId = req.params.id

    const conversation = ConversationService.getById(conversationId)
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' })
    }

    ConversationService.delete(conversationId)
    res.json({ message: 'Conversation deleted' })
  })
)

// Attachments API

// Create an attachment metadata record (local file path or CDN URL). No binary upload here.
// Configure uploads directory and multer storage
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
    // If a file is uploaded, save metadata and create attachment
    const uploaded = (req as any).file as any | undefined
    if (uploaded) {
      const file = uploaded
      const messageIdRaw = req.body?.messageId
      const messageId = messageIdRaw || null
      const absolutePath = file.path
      const filename = path.basename(absolutePath)
      const filePathRel = path.relative(__dirname, absolutePath) // e.g. data/uploads/...
      const sizeBytes = file.size
      const mimeType = file.mimetype

      // Compute sha256
      const fileBuffer = fs.readFileSync(absolutePath)
      const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex')

      const created = AttachmentService.create({
        messageId,
        kind: 'image',
        mimeType,
        storage: 'file',
        url: `/uploads/${filename}`,
        filePath: filePathRel,
        width: null,
        height: null,
        sizeBytes,
        sha256,
      })

      return res.status(201).json(created)
    }

    // Fallback: metadata-only mode (no binary). Maintain backward compatibility.
    const {
      messageId,
      kind = 'image',
      mimeType,
      storage,
      url,
      filePath,
      width,
      height,
      sizeBytes,
      sha256,
    } = req.body as {
      messageId?: MessageId | null
      kind?: 'image'
      mimeType?: string
      storage?: 'file' | 'url'
      url?: string | null
      filePath?: string | null
      width?: number | null
      height?: number | null
      sizeBytes?: number | null
      sha256?: string | null
    }

    if (!mimeType) return res.status(400).json({ error: 'mimeType is required' })
    if (!url && !filePath) return res.status(400).json({ error: 'Either url or filePath is required' })
    if (kind !== 'image') return res.status(400).json({ error: 'Only kind="image" is supported' })

    const created = AttachmentService.create({
      messageId: messageId ?? null,
      kind: 'image',
      mimeType,
      storage,
      url: url ?? null,
      filePath: filePath ?? null,
      width: width ?? null,
      height: height ?? null,
      sizeBytes: sizeBytes ?? null,
      sha256: sha256 ?? null,
    })

    res.status(201).json(created)
  })
)

// Get a single attachment by id
router.get(
  '/attachments/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id
    const found = AttachmentService.getById(id)
    if (!found) return res.status(404).json({ error: 'Attachment not found' })
    res.json(found)
  })
)

// List attachments for a message
router.get(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const attachments = MessageService.getAttachments(messageId)
    res.json(attachments)
  })
)

// Link existing attachments to a message
router.post(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { attachmentIds } = req.body as { attachmentIds?: string[] }
    if (!Array.isArray(attachmentIds) || attachmentIds.length === 0) {
      return res.status(400).json({ error: 'attachmentIds must be a non-empty array' })
    }
    const attachments = MessageService.linkAttachments(messageId, attachmentIds)
    res.json(attachments)
  })
)

// Delete all attachments for a message
router.delete(
  '/messages/:id/attachments',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const deleted = AttachmentService.deleteByMessage(messageId)
    res.json({ deleted })
  })
)

// Unlink a single attachment from a message (preserve shared attachments)
router.delete(
  '/messages/:id/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const attachmentId = req.params.attachmentId
    if (!messageId || !attachmentId || !messageId.trim() || !attachmentId.trim()) {
      return res.status(400).json({ error: 'Invalid ids' })
    }
    const updated = MessageService.unlinkAttachment(messageId, attachmentId)
    res.json(updated)
  })
)

// File Content API

// Create a file content record (metadata only)
router.post(
  '/file-content',
  asyncHandler(async (req, res) => {
    const { fileName, absolutePath, relativePath, sizeBytes, messageId } = req.body as {
      fileName: string
      absolutePath: string
      relativePath: string
      sizeBytes?: number | null
      messageId?: MessageId | null
    }

    if (!fileName) return res.status(400).json({ error: 'fileName is required' })
    if (!absolutePath) return res.status(400).json({ error: 'absolutePath is required' })
    if (!relativePath) return res.status(400).json({ error: 'relativePath is required' })

    const created = FileContentService.create({
      fileName,
      absolutePath,
      relativePath,
      sizeBytes: sizeBytes ?? null,
      messageId: messageId ?? null,
    })

    res.status(201).json(created)
  })
)

// Get a single file content by id
router.get(
  '/file-content/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id
    const found = FileContentService.getById(id)
    if (!found) return res.status(404).json({ error: 'File content not found' })
    res.json(found)
  })
)

// List file content for a message
router.get(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const fileContents = MessageService.getFileContents(messageId)
    res.json(fileContents)
  })
)

// Link existing file content to a message
router.post(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const { fileContentIds } = req.body as { fileContentIds?: string[] }
    if (!Array.isArray(fileContentIds) || fileContentIds.length === 0) {
      return res.status(400).json({ error: 'fileContentIds must be a non-empty array' })
    }
    const fileContents = MessageService.linkFileContents(messageId, fileContentIds)
    res.json(fileContents)
  })
)

// Delete all file content links for a message
router.delete(
  '/messages/:id/file-content',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const deleted = FileContentService.deleteByMessage(messageId)
    res.json({ deleted })
  })
)

// Unlink a single file content from a message (preserve shared file content)
router.delete(
  '/messages/:id/file-content/:fileContentId',
  asyncHandler(async (req, res) => {
    const messageId = req.params.id
    const fileContentId = req.params.fileContentId
    if (!messageId || !fileContentId || !messageId.trim() || !fileContentId.trim()) {
      return res.status(400).json({ error: 'Invalid ids' })
    }
    const updated = MessageService.unlinkFileContent(messageId, fileContentId)
    res.json(updated)
  })
)

// Abort an in-flight generation by message id
router.post(
  '/messages/:id/abort',
  asyncHandler(async (req, res) => {
    const userMessageId = req.params.id
    const success = abortGeneration(userMessageId)

    // Check if the aborted assistant message is empty and delete it
    let messageDeleted = false
    if (success) {
      try {
        // Get children of the user message to find the assistant message
        const childrenIds = MessageService.getChildrenIds(userMessageId)

        // Find the most recent assistant message child
        for (const childId of childrenIds.reverse()) {
          const message = MessageService.getById(childId)
          if (message && message.role === 'assistant') {
            const hasContent =
              (message.content && message.content.trim() && message.content !== '...') ||
              (message.thinking_block && message.thinking_block.trim()) ||
              (message.tool_calls && message.tool_calls.trim())

            if (!hasContent) {
              MessageService.delete(childId)
              messageDeleted = true
            }
            break // Only check the first (most recent) assistant message
          }
        }
      } catch (error) {
        console.error('Error checking/deleting aborted message:', error)
      }
    }

    res.json({ success, messageDeleted })
  })
)

export default router
