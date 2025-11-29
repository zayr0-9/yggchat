// electron/electronChat.ts
// Local chat routes for local-only storage mode
// AI inference still uses cloud providers, only storage is local

import express from 'express'
import { v4 as uuidv4 } from 'uuid'

const router = express.Router()

// Type definitions
interface RequestBody {
  content?: string
  messages?: any[]
  modelName?: string
  parentId?: string | null
  provider?: string
  systemPrompt?: string
  think?: boolean
  selectedFiles?: any[]
  retrigger?: boolean
  attachmentsBase64?: any[]
}

// This function will be called after mounting to inject dependencies
let db: any = null
let statements: any = null

export function setDatabaseDependencies(database: any, preparedStatements: any) {
  db = database
  statements = preparedStatements
}

// POST /conversations/:id/messages
// Local message creation with cloud AI streaming
router.post('/conversations/:id/messages', async (req, res) => {
  const conversationId = req.params.id
  const {
    content,
    modelName,
    parentId,
    provider = 'ollama',
    systemPrompt,
    think,
    selectedFiles,
    retrigger = false,
    attachmentsBase64,
  } = req.body as RequestBody

  // Validation
  if (!content && !retrigger) {
    res.status(400).json({ error: 'Message content required' })
    return
  }

  if (!db || !statements) {
    res.status(500).json({ error: 'Database not initialized' })
    return
  }

  // Get conversation from local DB
  const conversation = statements.getConversationById.get(conversationId)
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' })
    return
  }

  // Verify this is a local-mode conversation
  if (conversation.storage_mode !== 'local') {
    res.status(400).json({
      error: 'This conversation is not in local storage mode. Use cloud API instead.'
    })
    return
  }

  // Setup SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  // Create user message (unless retrigger)
  let userMessage
  if (retrigger) {
    const lastMsg = statements.getLastMessageByConversationId.get(conversationId)
    if (!lastMsg || lastMsg.role !== 'user') {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Cannot retrigger: last message is not from user'
      })}\n\n`)
      res.end()
      return
    }
    userMessage = lastMsg
  } else {
    const now = new Date().toISOString()
    const userMsgId = uuidv4()

    try {
      statements.upsertMessage.run(
        userMsgId,
        conversationId,
        parentId || null,
        '[]',
        'user',
        content,
        content, // plain_text_content
        null, // thinking_block
        null, // tool_calls
        null, // tool_call_id
        modelName || 'unknown',
        null, // note
        null, // ex_agent_session_id
        null, // ex_agent_type
        null, // content_blocks
        now
      )
      userMessage = statements.getMessageById.get(userMsgId)
    } catch (error) {
      console.error('[LocalChat] Error creating user message:', error)
      res.write(`data: ${JSON.stringify({
        type: 'error',
        error: 'Failed to create user message'
      })}\n\n`)
      res.end()
      return
    }
  }

  // Send user message to client
  if (!retrigger) {
    res.write(`data: ${JSON.stringify({ type: 'user_message', message: userMessage })}\n\n`)
  }

  try {
    // Get conversation history from local DB
    const baseHistory = statements.getMessagesByConversationId.all(conversationId)

    // Create assistant placeholder
    const assistantMsgId = uuidv4()
    const now = new Date().toISOString()
    statements.upsertMessage.run(
      assistantMsgId,
      conversationId,
      userMessage.id,
      '[]',
      'assistant',
      '...',
      '...',
      null, // thinking_block
      null, // tool_calls
      null, // tool_call_id
      modelName || 'unknown',
      null, // note
      null, // ex_agent_session_id
      null, // ex_agent_type
      null, // content_blocks
      now
    )

    // Send assistant placeholder to client
    res.write(`data: ${JSON.stringify({
      type: 'assistant_placeholder',
      message: statements.getMessageById.get(assistantMsgId)
    })}\n\n`)

    // Stream AI generation by calling cloud provider
    // IMPORTANT: Call provider via HTTP to server (not direct import)
    // This keeps AI logic on server, only storage is local

    let assistantContent = ''
    let assistantThinking = ''
    let assistantToolCalls: any[] = []

    // Make streaming request to Railway server for AI generation
    const cloudApiBase = process.env.VITE_API_URL || 'http://localhost:3001/api'

    console.log(`[LocalChat] Forwarding to cloud API: ${cloudApiBase}/conversations/${conversationId}/messages`)

    const streamResponse = await fetch(`${cloudApiBase}/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        messages: baseHistory,
        modelName,
        parentId,
        provider,
        systemPrompt,
        think,
        selectedFiles,
        attachmentsBase64,
      }),
    })

    if (!streamResponse.ok) {
      throw new Error(`Cloud API error: ${streamResponse.status} ${streamResponse.statusText}`)
    }

    if (!streamResponse.body) {
      throw new Error('No response body from cloud API')
    }

    // Parse SSE stream and re-emit to local client
    const reader = streamResponse.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')

      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          try {
            const obj = JSON.parse(data)

            if (obj.type === 'chunk') {
              if (obj.part === 'reasoning') {
                assistantThinking += obj.delta || ''
              } else if (obj.part === 'tool_call' && obj.toolCall) {
                assistantToolCalls.push(obj.toolCall)
              } else {
                assistantContent += obj.delta || ''
              }
              // Forward to client
              res.write(`data: ${data}\n\n`)
            } else if (obj.type === 'tool_call' && obj.delta) {
              // Handle legacy tool call format
              try {
                const toolCalls = JSON.parse(obj.delta)
                if (Array.isArray(toolCalls)) {
                  assistantToolCalls.push(...toolCalls)
                }
              } catch (e) {
                console.warn('[LocalChat] Failed to parse tool_call delta:', e)
              }
              res.write(`data: ${data}\n\n`)
            } else if (obj.type === 'complete') {
              // Cloud has finished - update local message with final content
              const toolCallsJson = assistantToolCalls.length > 0 ? JSON.stringify(assistantToolCalls) : null

              statements.upsertMessage.run(
                assistantMsgId,
                conversationId,
                userMessage.id,
                '[]',
                'assistant',
                assistantContent.trim() || '...',
                assistantContent.trim() || '...',
                assistantThinking || null,
                toolCallsJson,
                null,
                modelName || 'unknown',
                null,
                null,
                null,
                null,
                now
              )

              const finalMsg = statements.getMessageById.get(assistantMsgId)
              res.write(`data: ${JSON.stringify({ type: 'complete', message: finalMsg })}\n\n`)
            } else if (obj.type === 'error') {
              res.write(`data: ${data}\n\n`)
            } else {
              // Forward any other event types
              res.write(`data: ${data}\n\n`)
            }
          } catch (e) {
            // Non-JSON line or parse error, skip
            console.warn('[LocalChat] Failed to parse SSE data:', data)
          }
        }
      }
    }

    res.end()
  } catch (error) {
    console.error('[LocalChat] Error during message streaming:', error)
    res.write(`data: ${JSON.stringify({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error during streaming'
    })}\n\n`)
    res.end()
  }
})

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'local-chat' })
})

export default router
