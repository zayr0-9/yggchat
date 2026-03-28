import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'

export interface HermesBridgeEvent {
  type: string
  request_id?: string
  session_id?: string
  [key: string]: any
}

export interface HermesResponse {
  messageType: 'session' | 'assistant_message' | 'tool_start' | 'tool_result' | 'final' | 'conversation_end' | 'error' | 'event'
  timestamp: Date
  sessionId?: string
  event: HermesBridgeEvent
  error?: {
    code?: string
    message: string
  }
}

export interface HermesStreamChunk {
  type: 'content_delta' | 'thinking_delta' | 'tool_start' | 'tool_end'
  delta?: string
  contentType: 'text' | 'thinking'
  toolName?: string
  toolId?: string
}

export type OnHermesResponse = (response: HermesResponse) => void | Promise<void>
export type OnHermesStreamingChunk = (chunk: HermesStreamChunk) => void | Promise<void>

export type BridgeLauncher = {
  command: string
  args: string[]
  spawnCwd: string
}

type JsonRpcMessage = {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, any>
  result?: any
  error?: {
    code?: number | string
    message?: string
    data?: any
  }
}

type PendingRequest = {
  method: string
  resolve: (value: any) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

type PromptHandlers = {
  sessionId: string
  onResponse?: OnHermesResponse
  onStreamingChunk?: OnHermesStreamingChunk
  textParts: string[]
  reasoningParts: string[]
  toolCalls: Map<string, { title?: string; kind?: string; rawInput?: any }>
}

type PromptResult = {
  stopReason?: string
  usage?: any
  finalText: string
  finalReasoning: string
}

export type HermesPermissionDecision = 'allow_once' | 'allow_always' | 'deny'

export type HermesPermissionOption = {
  optionId?: string
  kind?: string
  name?: string
}

export type HermesPermissionRequest = {
  sessionId?: string
  toolCall: Record<string, any> | null
  options: HermesPermissionOption[]
  rawParams: Record<string, any>
}

export type OnHermesPermissionRequest = (
  request: HermesPermissionRequest
) => Promise<HermesPermissionDecision> | HermesPermissionDecision

type HermesAcpClientOptions = {
  cwd: string
  onResponse?: OnHermesResponse
  onStreamingChunk?: OnHermesStreamingChunk
  onPermissionRequest?: OnHermesPermissionRequest
  abortSignal?: AbortSignal
}

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const STDERR_TAIL_LIMIT = 40

function createAbortError(message = 'Hermes ACP request aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  return undefined
}

function normalizeAuthMethods(result: any): Array<{ id?: string }> {
  if (Array.isArray(result?.authMethods)) return result.authMethods
  if (Array.isArray(result?.auth_methods)) return result.auth_methods
  return []
}

function normalizeStopReason(result: any): string | undefined {
  if (typeof result?.stopReason === 'string') return result.stopReason
  if (typeof result?.stop_reason === 'string') return result.stop_reason
  return undefined
}

function normalizeUsage(result: any): any {
  return result?.usage ?? null
}

function truncateStderr(lines: string[]): string {
  return lines.slice(-STDERR_TAIL_LIMIT).join('\n').trim()
}

function stringifyForDisplay(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizePermissionOptions(params: Record<string, any>): HermesPermissionOption[] {
  const rawOptions = Array.isArray(params?.options) ? params.options : []
  return rawOptions.map(option => ({
    optionId:
      typeof option?.optionId === 'string'
        ? option.optionId
        : typeof option?.option_id === 'string'
          ? option.option_id
          : undefined,
    kind: typeof option?.kind === 'string' ? option.kind : undefined,
    name: typeof option?.name === 'string' ? option.name : undefined,
  }))
}

function buildPermissionToolCall(params: Record<string, any>): Record<string, any> | null {
  const rawToolCall =
    params?.toolCall && typeof params.toolCall === 'object'
      ? params.toolCall
      : params?.tool_call && typeof params.tool_call === 'object'
        ? params.tool_call
        : null

  if (!rawToolCall) return null

  const id =
    typeof rawToolCall.id === 'string'
      ? rawToolCall.id
      : typeof rawToolCall.toolCallId === 'string'
        ? rawToolCall.toolCallId
        : typeof rawToolCall.tool_call_id === 'string'
          ? rawToolCall.tool_call_id
          : 'hermes-permission'

  const name =
    typeof rawToolCall.title === 'string'
      ? rawToolCall.title
      : typeof rawToolCall.name === 'string'
        ? rawToolCall.name
        : typeof rawToolCall.kind === 'string'
          ? rawToolCall.kind
          : 'hermes_permission'

  const argumentsObject: Record<string, any> =
    rawToolCall.rawInput && typeof rawToolCall.rawInput === 'object'
      ? rawToolCall.rawInput
      : rawToolCall.raw_input && typeof rawToolCall.raw_input === 'object'
        ? rawToolCall.raw_input
        : {}

  if (typeof params?.description === 'string' && !('description' in argumentsObject)) {
    argumentsObject.description = params.description
  }

  return {
    id,
    name,
    arguments: argumentsObject,
    status: 'pending',
  }
}

function findPermissionOption(
  options: HermesPermissionOption[],
  kinds: string[],
  optionIds: string[] = []
): HermesPermissionOption | undefined {
  const byKind = options.find(option => option.kind != null && kinds.includes(option.kind))
  if (byKind) return byKind
  return options.find(option => option.optionId != null && optionIds.includes(option.optionId))
}

function extractTextContent(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(item => {
        if (!item || typeof item !== 'object') return stringifyForDisplay(item)
        if (item.type === 'content') {
          const inner = (item as any).content
          if (typeof inner?.text === 'string') return inner.text
          return stringifyForDisplay(inner)
        }
        if (item.type === 'diff') {
          const pathText = typeof item.path === 'string' ? item.path : 'unknown path'
          return `[diff] ${pathText}`
        }
        if (item.type === 'terminal') {
          const terminalId = typeof item.terminalId === 'string' ? item.terminalId : 'terminal'
          return `[terminal] ${terminalId}`
        }
        return stringifyForDisplay(item)
      })
      .filter(Boolean)
      .join('\n\n')
  }
  if (typeof content?.text === 'string') return content.text
  if (typeof content?.content?.text === 'string') return content.content.text
  return stringifyForDisplay(content)
}

async function emitResponse(
  event: HermesBridgeEvent,
  sessionId: string | undefined,
  onResponse?: OnHermesResponse
): Promise<void> {
  if (!onResponse) return
  const messageType =
    event.type === 'session'
      ? 'session'
      : event.type === 'assistant_message'
        ? 'assistant_message'
        : event.type === 'tool_start'
          ? 'tool_start'
          : event.type === 'tool_result'
            ? 'tool_result'
            : event.type === 'final'
              ? 'final'
              : event.type === 'conversation_end'
                ? 'conversation_end'
                : event.type === 'error'
                  ? 'error'
                  : 'event'

  await onResponse({
    messageType,
    timestamp: new Date(),
    sessionId,
    event,
    error:
      event.type === 'error'
        ? {
            code: typeof event.code === 'string' ? event.code : undefined,
            message: typeof event.message === 'string' ? event.message : 'Hermes ACP error',
          }
        : undefined,
  })
}

export function resolveAcpLauncher(): BridgeLauncher {
  const configuredRoot = process.env.HERMES_AGENT_ROOT?.trim()
  const defaultRoot = process.platform === 'win32' ? 'D:\\hermes-agent' : '/opt/hermes-agent'
  const hermesRoot = configuredRoot || defaultRoot
  const spawnCwd = existsSync(hermesRoot) ? hermesRoot : process.cwd()

  const configuredPython = process.env.HERMES_PYTHON?.trim()
  const pythonCandidates = process.platform === 'win32'
    ? [
        path.join(hermesRoot, '.venv', 'Scripts', 'python.exe'),
        path.join(hermesRoot, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(hermesRoot, '.venv', 'bin', 'python'),
        path.join(hermesRoot, 'venv', 'bin', 'python'),
      ]
  const pythonPath = configuredPython || pythonCandidates.find(candidate => existsSync(candidate))
  const mainScript = path.join(hermesRoot, 'hermes_cli', 'main.py')

  if (pythonPath && existsSync(pythonPath) && existsSync(mainScript)) {
    return {
      command: pythonPath,
      args: [mainScript, 'acp'],
      spawnCwd,
    }
  }

  const configuredHermes = process.env.HERMES_BIN?.trim()
  if (configuredHermes && existsSync(configuredHermes)) {
    return {
      command: configuredHermes,
      args: ['acp'],
      spawnCwd,
    }
  }

  return {
    command: 'hermes',
    args: ['acp'],
    spawnCwd,
  }
}

export class HermesAcpClient {
  private readonly proc: ChildProcessWithoutNullStreams
  private readonly cwd: string
  private readonly onResponse?: OnHermesResponse
  private readonly onStreamingChunk?: OnHermesStreamingChunk
  private readonly onPermissionRequest?: OnHermesPermissionRequest
  private readonly abortSignal?: AbortSignal
  private readonly pending = new Map<number, PendingRequest>()
  private readonly stderrLines: string[] = []
  private stdoutBuffer = ''
  private nextId = 1
  private closed = false
  private activePrompt: PromptHandlers | null = null

  constructor(proc: ChildProcessWithoutNullStreams, options: HermesAcpClientOptions) {
    this.proc = proc
    this.cwd = options.cwd
    this.onResponse = options.onResponse
    this.onStreamingChunk = options.onStreamingChunk
    this.onPermissionRequest = options.onPermissionRequest
    this.abortSignal = options.abortSignal

    this.proc.stdout.setEncoding('utf8')
    this.proc.stderr.setEncoding('utf8')
    this.proc.stdout.on('data', chunk => this.handleStdout(chunk))
    this.proc.stderr.on('data', chunk => this.handleStderr(chunk))
    this.proc.on('error', error => this.rejectAllPending(new Error(`Hermes ACP process error: ${error.message}`)))
    this.proc.on('close', code => {
      this.closed = true
      const stderrText = truncateStderr(this.stderrLines)
      const message =
        code === 0
          ? 'Hermes ACP process closed'
          : stderrText || `Hermes ACP process exited with code ${code ?? 'unknown'}`
      this.rejectAllPending(new Error(message))
    })

    if (this.abortSignal) {
      if (this.abortSignal.aborted) {
        this.handleAbort()
      } else {
        this.abortSignal.addEventListener('abort', this.handleAbort, { once: true })
      }
    }
  }

  private handleAbort = () => {
    const error = createAbortError()
    const sessionId = this.activePrompt?.sessionId
    if (sessionId) {
      try {
        this.sendNotification('session/cancel', { sessionId })
      } catch {
        // Ignore notification failures during shutdown.
      }
    }
    this.rejectAllPending(error)
    this.close()
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk
    let newlineIndex = this.stdoutBuffer.indexOf('\n')

    while (newlineIndex >= 0) {
      const rawLine = this.stdoutBuffer.slice(0, newlineIndex)
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)
      const line = rawLine.trim()
      if (line) {
        void this.handleMessageLine(line)
      }
      newlineIndex = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleStderr(chunk: string) {
    const normalized = String(chunk)
    const lines = normalized.split(/\r?\n/).filter(Boolean)
    for (const line of lines) {
      this.stderrLines.push(line)
    }
    if (this.stderrLines.length > STDERR_TAIL_LIMIT) {
      this.stderrLines.splice(0, this.stderrLines.length - STDERR_TAIL_LIMIT)
    }
  }

  private async handleMessageLine(line: string): Promise<void> {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }

    if (typeof message.method === 'string') {
      await this.handleInboundMethod(message)
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(
          new Error(
            `Hermes ACP ${pending.method} failed: ${message.error.message || stringifyForDisplay(message.error)}`
          )
        )
        return
      }
      pending.resolve(message.result)
    }
  }

  private async handleInboundMethod(message: JsonRpcMessage): Promise<void> {
    const method = message.method
    if (!method) return

    if (method === 'session/update') {
      await this.handleSessionUpdate(message.params || {})
      return
    }

    if (method === 'session/request_permission') {
      await this.handlePermissionRequest(message)
      return
    }

    if (message.id !== undefined) {
      this.writeJson({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: -32601,
          message: `ACP client method '${method}' is not supported by Ygg yet.`,
        },
      })
    }
  }

  private async handleSessionUpdate(params: Record<string, any>): Promise<void> {
    const activePrompt = this.activePrompt
    if (!activePrompt) return

    const sessionId = normalizeSessionId(params.sessionId) || activePrompt.sessionId
    if (sessionId !== activePrompt.sessionId) return

    const update = params.update || {}
    const sessionUpdate = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : update.session_update
    if (typeof sessionUpdate !== 'string') return

    if (sessionUpdate === 'agent_message_chunk') {
      const text = extractTextContent(update.content)
      if (!text) return
      activePrompt.textParts.push(text)
      if (activePrompt.onStreamingChunk) {
        await activePrompt.onStreamingChunk({
          type: 'content_delta',
          delta: text,
          contentType: 'text',
        })
      }
      return
    }

    if (sessionUpdate === 'agent_thought_chunk') {
      const text = extractTextContent(update.content)
      if (!text) return
      activePrompt.reasoningParts.push(text)
      if (activePrompt.onStreamingChunk) {
        await activePrompt.onStreamingChunk({
          type: 'thinking_delta',
          delta: text,
          contentType: 'thinking',
        })
      }
      return
    }

    if (sessionUpdate === 'tool_call') {
      const toolCallId = normalizeSessionId(update.toolCallId) || `tool-${Date.now()}`
      const title = typeof update.title === 'string' ? update.title : undefined
      const kind = typeof update.kind === 'string' ? update.kind : undefined
      const rawInput = update.rawInput ?? update.raw_input ?? {}
      activePrompt.toolCalls.set(toolCallId, { title, kind, rawInput })

      if (activePrompt.onStreamingChunk) {
        await activePrompt.onStreamingChunk({
          type: 'tool_start',
          contentType: 'text',
          toolName: title || kind || 'tool',
          toolId: toolCallId,
        })
      }

      await emitResponse(
        {
          type: 'tool_start',
          session_id: sessionId,
          tool_call_id: toolCallId,
          name: title || kind || 'tool',
          title,
          kind,
          arguments: rawInput,
          status: typeof update.status === 'string' ? update.status : 'pending',
        },
        sessionId,
        activePrompt.onResponse
      )
      return
    }

    if (sessionUpdate === 'tool_call_update') {
      const toolCallId = normalizeSessionId(update.toolCallId)
      if (!toolCallId) return

      const previous = activePrompt.toolCalls.get(toolCallId)
      const title = typeof update.title === 'string' ? update.title : previous?.title
      const kind = typeof update.kind === 'string' ? update.kind : previous?.kind
      const rawInput = update.rawInput ?? update.raw_input ?? previous?.rawInput ?? {}
      activePrompt.toolCalls.set(toolCallId, { title, kind, rawInput })

      const status = typeof update.status === 'string' ? update.status : undefined
      if (status !== 'completed' && status !== 'failed') {
        return
      }

      if (activePrompt.onStreamingChunk) {
        await activePrompt.onStreamingChunk({
          type: 'tool_end',
          contentType: 'text',
          toolName: title || kind || 'tool',
          toolId: toolCallId,
        })
      }

      const content = extractTextContent(update.content)
      await emitResponse(
        {
          type: 'tool_result',
          session_id: sessionId,
          tool_call_id: toolCallId,
          name: title || kind || 'tool',
          title,
          kind,
          arguments: rawInput,
          status,
          ok: status !== 'failed',
          content: content || stringifyForDisplay(update.rawOutput ?? update.raw_output ?? ''),
          result: update.rawOutput ?? update.raw_output ?? content,
        },
        sessionId,
        activePrompt.onResponse
      )
    }
  }

  private async handlePermissionRequest(message: JsonRpcMessage): Promise<void> {
    if (message.id === undefined) return

    if (this.abortSignal?.aborted) {
      this.writeJson({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          outcome: {
            outcome: 'cancelled',
          },
        },
      })
      return
    }

    const rawParams = message.params && typeof message.params === 'object' ? message.params : {}
    const options = normalizePermissionOptions(rawParams)
    const request: HermesPermissionRequest = {
      sessionId: normalizeSessionId(rawParams.sessionId ?? rawParams.session_id),
      toolCall: buildPermissionToolCall(rawParams),
      options,
      rawParams,
    }

    let decision: HermesPermissionDecision = 'allow_once'
    if (this.onPermissionRequest) {
      try {
        decision = await this.onPermissionRequest(request)
      } catch {
        decision = 'deny'
      }
    }

    const selectedOption =
      decision === 'allow_always'
        ? findPermissionOption(options, ['allow_always'], ['allow_always']) ||
          findPermissionOption(options, ['allow_once'], ['allow_once']) ||
          options[0]
        : decision === 'deny'
          ? findPermissionOption(options, ['reject_once', 'reject_always'], ['deny'])
          : findPermissionOption(options, ['allow_once'], ['allow_once']) ||
            findPermissionOption(options, ['allow_always'], ['allow_always']) ||
            options[0]

    this.writeJson({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        outcome: selectedOption?.optionId
          ? {
              outcome: 'selected',
              optionId: selectedOption.optionId,
            }
          : {
              outcome: 'cancelled',
            },
      },
    })
  }

  private writeJson(message: Record<string, any>) {
    if (this.closed || !this.proc.stdin.writable) {
      throw new Error('Hermes ACP process is not writable')
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private rejectAllPending(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
  }

  async request(method: string, params: Record<string, any>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
    if (this.abortSignal?.aborted) {
      throw createAbortError()
    }
    if (this.closed) {
      throw new Error('Hermes ACP process is already closed')
    }

    const id = this.nextId++
    return await new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`Timed out waiting for Hermes ACP response to ${method}`))
          }, timeoutMs)
        : null

      this.pending.set(id, { method, resolve, reject, timer })
      try {
        this.writeJson({
          jsonrpc: '2.0',
          id,
          method,
          params,
        })
      } catch (error) {
        if (timer) clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  sendNotification(method: string, params: Record<string, any>) {
    if (this.closed) return
    try {
      this.writeJson({
        jsonrpc: '2.0',
        method,
        params,
      })
    } catch {
      // Ignore best-effort notification failures during shutdown.
    }
  }

  async initialize(): Promise<any> {
    return await this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: {
        name: 'ygg-chat',
        title: 'Ygg Chat',
        version: '0.0.0',
      },
    })
  }

  async maybeAuthenticate(initializeResult: any): Promise<void> {
    const authMethods = normalizeAuthMethods(initializeResult)
    const firstMethod = authMethods.find(method => typeof method?.id === 'string' && method.id.trim())
    if (!firstMethod?.id) return
    await this.request('authenticate', { methodId: firstMethod.id })
  }

  async newSession(cwd: string): Promise<string> {
    const result = await this.request('session/new', { cwd, mcpServers: [] })
    const sessionId = normalizeSessionId(result?.sessionId ?? result?.session_id)
    if (!sessionId) {
      throw new Error('Hermes ACP did not return a sessionId for session/new')
    }
    return sessionId
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    const result = await this.request('session/load', { cwd, sessionId, mcpServers: [] })
    if (result == null) {
      throw new Error(`Hermes ACP could not load session ${sessionId}`)
    }
  }

  async forkSession(sessionId: string, cwd: string): Promise<string> {
    const result = await this.request('session/fork', { cwd, sessionId, mcpServers: [] })
    const forkedSessionId = normalizeSessionId(result?.sessionId ?? result?.session_id)
    if (!forkedSessionId) {
      throw new Error(`Hermes ACP did not return a sessionId for fork of ${sessionId}`)
    }
    return forkedSessionId
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    const trimmedModel = modelId.trim()
    if (!trimmedModel) return

    try {
      await this.request('session/set_model', { sessionId, modelId: trimmedModel })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/method not found|not supported|session\/set_model/i.test(message)) {
        throw error instanceof Error ? error : new Error(message)
      }
      await this.request('session/setModel', { sessionId, modelId: trimmedModel })
    }
  }

  async prompt(sessionId: string, promptText: string): Promise<PromptResult> {
    this.activePrompt = {
      sessionId,
      onResponse: this.onResponse,
      onStreamingChunk: this.onStreamingChunk,
      textParts: [],
      reasoningParts: [],
      toolCalls: new Map(),
    }

    try {
      const result = await this.request('session/prompt', {
        sessionId,
        prompt: [
          {
            type: 'text',
            text: promptText,
          },
        ],
      })

      return {
        stopReason: normalizeStopReason(result),
        usage: normalizeUsage(result),
        finalText: this.activePrompt.textParts.join(''),
        finalReasoning: this.activePrompt.reasoningParts.join(''),
      }
    } finally {
      this.activePrompt = null
    }
  }

  close() {
    if (this.closed) return
    this.closed = true
    if (this.abortSignal) {
      this.abortSignal.removeEventListener('abort', this.handleAbort)
    }
    try {
      this.proc.stdin.end()
    } catch {
      // Ignore shutdown issues.
    }
    try {
      this.proc.kill()
    } catch {
      // Ignore shutdown issues.
    }
  }
}

export function spawnHermesAcpProcess(): { client: HermesAcpClient; launcher: BridgeLauncher } {
  const launcher = resolveAcpLauncher()
  const proc = spawn(launcher.command, launcher.args, {
    cwd: launcher.spawnCwd,
    shell: false,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const client = new HermesAcpClient(proc, {
    cwd: launcher.spawnCwd,
  })

  return { client, launcher }
}
