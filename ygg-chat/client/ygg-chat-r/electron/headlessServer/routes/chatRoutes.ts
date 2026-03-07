import type { Express, Request, Response } from 'express'
import type { HeadlessChatOperation, HeadlessMessageRequest } from '../contracts/headlessApi.js'
import type { HeadlessChatOrchestrator } from '../services/chatOrchestrator.js'
import { initializeSse, startSseHeartbeat, writeSseEvent } from '../stream/sseWriter.js'

interface RegisterChatRoutesDeps {
  orchestrator: HeadlessChatOrchestrator
}

function buildHeadlessMessageRequest(req: Request, operation: HeadlessChatOperation): HeadlessMessageRequest {
  const body = req.body ?? {}

  const headerUserId = req.headers['x-user-id']
  const userIdFromHeader = Array.isArray(headerUserId) ? headerUserId[0] : headerUserId

  const authorizationHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization

  const headerAccountId = req.headers['chatgpt-account-id']
  const accountIdFromHeader = Array.isArray(headerAccountId) ? headerAccountId[0] : headerAccountId

  const conversationIdParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
  const messageIdParam = Array.isArray(req.params.messageId) ? req.params.messageId[0] : req.params.messageId

  return {
    operation,
    conversationId: conversationIdParam || '',
    parentId: body.parentId ?? body.parent_id ?? null,
    messageId: messageIdParam ?? body.messageId ?? body.message_id ?? null,
    content: body.content ?? '',
    provider: body.provider ?? 'openaichatgpt',
    modelName: body.modelName ?? body.model_name ?? 'gpt-5.1-codex-mini',
    userId: body.userId ?? body.user_id ?? userIdFromHeader ?? null,
    accessToken: body.accessToken ?? body.access_token ?? (authorizationHeader?.replace(/^Bearer\s+/i, '') ?? null),
    accountId: body.accountId ?? body.account_id ?? accountIdFromHeader ?? null,
    systemPrompt: body.systemPrompt ?? body.system_prompt ?? null,
    storageMode: body.storageMode ?? body.storage_mode ?? 'local',
    selectedFiles: body.selectedFiles ?? body.selected_files ?? [],
    attachmentsBase64: body.attachmentsBase64 ?? body.attachments_base64 ?? null,
    tools: Array.isArray(body.tools) ? body.tools : undefined,
    rootPath: body.rootPath ?? body.root_path ?? body.cwd ?? null,
    operationMode: body.operationMode ?? body.operation_mode ?? 'execute',
    streamId: body.streamId ?? body.stream_id ?? null,
    toolTimeoutMs:
      typeof body.toolTimeoutMs === 'number'
        ? body.toolTimeoutMs
        : typeof body.tool_timeout_ms === 'number'
          ? body.tool_timeout_ms
          : undefined,
  }
}

async function runSseOrchestrator(
  orchestrator: HeadlessChatOrchestrator,
  req: Request,
  res: Response,
  operation: HeadlessChatOperation
): Promise<void> {
  initializeSse(res)
  const stopHeartbeat = startSseHeartbeat(res)

  try {
    const request = buildHeadlessMessageRequest(req, operation)
    await orchestrator.runMessage(request, event => {
      writeSseEvent(res, event)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    writeSseEvent(res, { type: 'error', error: message })
  } finally {
    stopHeartbeat()
    res.end()
  }
}

export function registerChatRoutes(app: Express, deps: RegisterChatRoutesDeps): void {
  const { orchestrator } = deps

  app.post('/api/conversations/:id/messages', async (req, res) => {
    await runSseOrchestrator(orchestrator, req, res, 'send')
  })

  app.post('/api/conversations/:id/messages/repeat', async (req, res) => {
    await runSseOrchestrator(orchestrator, req, res, 'repeat')
  })

  app.post('/api/conversations/:id/messages/:messageId/branch', async (req, res) => {
    await runSseOrchestrator(orchestrator, req, res, 'branch')
  })

  app.post('/api/conversations/:id/messages/:messageId/edit-branch', async (req, res) => {
    await runSseOrchestrator(orchestrator, req, res, 'edit-branch')
  })
}
