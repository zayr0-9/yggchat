/**
 * Supabase Agent Routes
 *
 * This module contains all routes related to external AI agents (Claude Code, etc.)
 * Mounted at: /api/agents
 *
 * Endpoints:
 * - GET /cc-session/:conversationId - Get Claude Code session info
 * - POST /cc-messages/:conversationId - Send message to Claude Code agent
 */

import express from 'express'
import { asyncHandler } from '../utils/asyncHandler'
import { authenticatedRateLimiter, expensiveOperationsRateLimiter } from '../middleware/rateLimiter'
import { verifyAuth, getAuthToken } from '../middleware/supaAuth'
import { startCCChatWithDB, resumeCCChatWithDB, getCCSessionInfo } from '../utils/CCSupabase'

const router = express.Router()

// ============================================================================
// CLAUDE CODE AGENT ENDPOINTS
// ============================================================================

/**
 * Get Claude Code session info for a conversation
 *
 * Returns:
 * - hasSession: boolean
 * - sessionId: string (if exists)
 * - lastMessageAt: timestamp (if exists)
 * - messageCount: number (if exists)
 * - cwd: working directory (if exists)
 *
 * URL: GET /api/agents/cc-session/:conversationId
 */
router.get(
  '/cc-session/:conversationId',
  authenticatedRateLimiter,
  asyncHandler(async (req, res) => {
    const conversationId = req.params.conversationId
    const { client } = await verifyAuth(req)

    const sessionInfo = await getCCSessionInfo(client, conversationId)

    if (!sessionInfo) {
      return res.json({ hasSession: false })
    }

    res.json({
      hasSession: true,
      ...sessionInfo,
    })
  })
)

/**
 * Send message to Claude Code Agent with database persistence
 *
 * This endpoint integrates Claude Code SDK with Supabase database:
 * - Saves user message to database
 * - Starts or resumes CC session based on conversation state
 * - Automatically saves all CC responses with ex_agent role
 * - Tracks CC session ID in message metadata
 * - Streams responses to client in real-time via Server-Sent Events
 *
 * Request body:
 * - message: User message text (required)
 * - cwd: Working directory for CC (optional, defaults to project root)
 * - permissionMode: CC permission mode (optional, defaults to 'default')
 *   - 'default': Normal prompting for tool use
 *   - 'plan': Plan mode (research only, no execution)
 *   - 'bypassPermissions': Auto-approve all tool use
 *   - 'acceptEdits': Auto-accept all file edits
 * - resume: Whether to resume existing session (optional, auto-detected if omitted)
 *
 * Response: Server-Sent Events stream with:
 * - message events: CC assistant responses
 * - progress events: Tool execution progress
 * - system events: Init, auth status, etc.
 * - complete event: Final completion with sessionId
 * - error event: Error details if something fails
 *
 * URL: POST /api/agents/cc-messages/:conversationId
 */
router.post(
  '/cc-messages/:conversationId',
  expensiveOperationsRateLimiter, // CC is expensive, use same limits as AI streaming
  asyncHandler(async (req, res) => {
    console.log('\n🤖🤖🤖 [SERVER] POST /api/agents/cc-messages - Claude Code message received')
    console.log('🤖 Timestamp:', new Date().toISOString())
    console.log('🤖 Conversation ID:', req.params.conversationId)

    const conversationId = req.params.conversationId
    const jwt = getAuthToken(req)
    const { userId } = await verifyAuth(req)

    const {
      message,
      cwd = process.cwd(),
      permissionMode = 'default',
      resume,
      sessionId,
    } = req.body as {
      message: string
      cwd?: string
      permissionMode?: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits'
      resume?: boolean
      sessionId?: string
    }

    if (!message) {
      return res.status(400).json({ error: 'Message content required' })
    }

    console.log('🤖 CC Request:', {
      message: message.substring(0, 100),
      cwd,
      permissionMode,
      resume,
    })

    // Set up SSE (Server-Sent Events) for streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    try {
      // Stream callback for real-time updates
      const onStream = (data: any) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        } catch (error) {
          console.error('[CC Endpoint] Error writing stream data:', error)
        }
      }

      // Determine whether to start or resume based on session existence
      const shouldResume = resume !== undefined ? resume : true // Default to auto-detect

      let result
      if (shouldResume) {
        // Try to resume, will fall back to start if no session found
        result = await resumeCCChatWithDB({
          conversationId,
          userMessage: message,
          cwd,
          userId,
          jwt,
          permissionMode,
          onStream,
          sessionId,
        })
      } else {
        // Explicitly start new session
        result = await startCCChatWithDB({
          conversationId,
          userMessage: message,
          cwd,
          userId,
          jwt,
          permissionMode,
          onStream,
        })
      }

      // Send final completion event
      res.write(
        `data: ${JSON.stringify({
          type: 'complete',
          sessionId: result.sessionId,
          messageCount: result.messages.length,
        })}\n\n`
      )

      console.log('🤖 CC conversation completed successfully')
    } catch (error) {
      console.error('[CC Endpoint] Error:', error)

      // Send error event
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
    }

    res.end()
  })
)

// ============================================================================
// FUTURE: Additional agent endpoints can be added here
// ============================================================================

// Example: OpenAI Assistant API integration
// router.post('/openai-assistant/:conversationId', ...)

// Example: Langchain agent execution
// router.post('/langchain-agent/:conversationId', ...)

export default router
