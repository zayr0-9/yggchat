import { spawn } from 'child_process'
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

const sessions = new Map<string, string>()

type BridgeLauncher = {
  command: string
  args: string[]
  spawnCwd: string
}

function resolveBridgeLauncher(bridgeArgs: string[]): BridgeLauncher {
  const configuredRoot = process.env.HERMES_AGENT_ROOT?.trim()
  const defaultRoot = process.platform === 'win32' ? 'D:\\hermes-agent' : '/opt/hermes-agent'
  const hermesRoot = configuredRoot || defaultRoot
  const spawnCwd = existsSync(hermesRoot) ? hermesRoot : process.cwd()

  const configuredPython = process.env.HERMES_PYTHON?.trim()
  const defaultPython =
    process.platform === 'win32'
      ? path.join(hermesRoot, 'venv', 'Scripts', 'python.exe')
      : path.join(hermesRoot, 'venv', 'bin', 'python')
  const pythonPath = configuredPython || defaultPython
  const mainScript = path.join(hermesRoot, 'hermes_cli', 'main.py')

  if (existsSync(pythonPath) && existsSync(mainScript)) {
    return {
      command: pythonPath,
      args: [mainScript, 'bridge', ...bridgeArgs],
      spawnCwd,
    }
  }

  const configuredHermes = process.env.HERMES_BIN?.trim()
  if (configuredHermes && existsSync(configuredHermes)) {
    return {
      command: configuredHermes,
      args: ['bridge', ...bridgeArgs],
      spawnCwd,
    }
  }

  return {
    command: 'hermes',
    args: ['bridge', ...bridgeArgs],
    spawnCwd,
  }
}

function createSessionKey(conversationId: string, cwd: string): string {
  return `${conversationId}:${cwd}`
}

export function getHermesSession(conversationId: string, cwd: string): string | undefined {
  return sessions.get(createSessionKey(conversationId, cwd))
}

export function setHermesSession(conversationId: string, cwd: string, sessionId: string): void {
  sessions.set(createSessionKey(conversationId, cwd), sessionId)
}

function toEventMessageType(eventType: string): HermesResponse['messageType'] {
  if (eventType === 'session') return 'session'
  if (eventType === 'assistant_message') return 'assistant_message'
  if (eventType === 'tool_start') return 'tool_start'
  if (eventType === 'tool_result') return 'tool_result'
  if (eventType === 'final') return 'final'
  if (eventType === 'conversation_end') return 'conversation_end'
  if (eventType === 'error') return 'error'
  return 'event'
}

function extractSessionId(event: HermesBridgeEvent): string | undefined {
  return event.session_id || event.sessionId
}

function normalizeHermesModel(model?: string): string | undefined {
  if (!model) return undefined

  const raw = model.trim()
  if (!raw) return undefined

  const aliases: Record<string, string> = {
    'gpt-5.1 codex mini': 'openai/gpt-5-mini',
    'gpt-5-mini': 'openai/gpt-5-mini',
    'openai/gpt-5.1-codex-mini': 'openai/gpt-5-mini',
  }

  return aliases[raw.toLowerCase()] || raw
}

async function emitResponse(
  event: HermesBridgeEvent,
  conversationId: string,
  cwd: string,
  onResponse?: OnHermesResponse
): Promise<string | undefined> {
  const sessionId = extractSessionId(event)
  if (sessionId) {
    setHermesSession(conversationId, cwd, sessionId)
  }

  if (onResponse) {
    await onResponse({
      messageType: toEventMessageType(event.type),
      timestamp: new Date(),
      sessionId,
      event,
      error:
        event.type === 'error'
          ? {
              code: typeof event.code === 'string' ? event.code : undefined,
              message: typeof event.message === 'string' ? event.message : 'Hermes bridge error',
            }
          : undefined,
    })
  }

  return sessionId
}

export async function executeHermesAgent(
  conversationId: string,
  userMessage: string,
  cwd: string,
  onResponse?: OnHermesResponse,
  onStreamingChunk?: OnHermesStreamingChunk,
  sessionId?: string,
  _forkSession?: boolean,
  model?: string,
  maxIterations?: number
): Promise<string | null> {
  const existingSessionId = sessionId || getHermesSession(conversationId, cwd)
  const normalizedModel = normalizeHermesModel(model)

  return new Promise((resolve, reject) => {
    // Enable native Hermes streaming by default for Yggdrasil integration.
    // Request payload still carries explicit flags as an extra safeguard.
    const bridgeArgs = ['--once', '--native-stream', '--assistant-delta', '--native-assistant-delta']
    if (normalizedModel) bridgeArgs.push('--model', normalizedModel)
    if (typeof maxIterations === 'number' && Number.isFinite(maxIterations) && maxIterations > 0) {
      bridgeArgs.push('--max-iterations', String(Math.floor(maxIterations)))
    }

    const launcher = resolveBridgeLauncher(bridgeArgs)

    const proc = spawn(launcher.command, launcher.args, {
      cwd: launcher.spawnCwd,
      shell: false,
      env: { ...process.env },
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let latestSessionId: string | null = existingSessionId || null
    let lineProcessingQueue: Promise<void> = Promise.resolve()

    const handleLine = async (line: string) => {
      if (!line.trim()) return

      let event: HermesBridgeEvent
      try {
        event = JSON.parse(line)
      } catch {
        return
      }

      if (event.type === 'assistant_delta' && typeof event.delta === 'string') {
        if (onStreamingChunk) {
          await onStreamingChunk({
            type: 'content_delta',
            delta: event.delta,
            contentType: 'text',
          })
        }
      } else if (event.type === 'reasoning_delta' && typeof event.delta === 'string') {
        if (onStreamingChunk) {
          await onStreamingChunk({
            type: 'thinking_delta',
            delta: event.delta,
            contentType: 'thinking',
          })
        }
      } else if (event.type === 'tool_start') {
        if (onStreamingChunk) {
          await onStreamingChunk({
            type: 'tool_start',
            contentType: 'text',
            toolName: typeof event.name === 'string' ? event.name : undefined,
            toolId: typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined,
          })
        }
      } else if (event.type === 'tool_result') {
        if (onStreamingChunk) {
          await onStreamingChunk({
            type: 'tool_end',
            contentType: 'text',
            toolName: typeof event.name === 'string' ? event.name : undefined,
            toolId: typeof event.tool_call_id === 'string' ? event.tool_call_id : undefined,
          })
        }
      }

      const emittedSessionId = await emitResponse(event, conversationId, cwd, onResponse)
      if (emittedSessionId) latestSessionId = emittedSessionId
    }

    const enqueueLine = (line: string) => {
      lineProcessingQueue = lineProcessingQueue
        .then(() => handleLine(line))
        .catch(error => {
          console.error('[HermesAgent] Failed to process bridge event line:', error)
        })
    }

    proc.stdout.on('data', (data: Buffer) => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() || ''

      for (const line of lines) {
        enqueueLine(line)
      }
    })

    proc.stderr.on('data', (data: Buffer) => {
      stderrBuffer += data.toString()
    })

    proc.on('error', async error => {
      const spawnMessage = `Failed to spawn Hermes bridge via '${launcher.command}': ${error.message}`
      if (onResponse) {
        await onResponse({
          messageType: 'error',
          timestamp: new Date(),
          sessionId: latestSessionId || undefined,
          event: {
            type: 'error',
            message: spawnMessage,
          },
          error: {
            code: 'HERMES_SPAWN_ERROR',
            message: spawnMessage,
          },
        })
      }
      reject(new Error(spawnMessage))
    })

    proc.on('close', async code => {
      if (stdoutBuffer.trim()) {
        enqueueLine(stdoutBuffer)
      }

      await lineProcessingQueue

      if (code !== 0) {
        const launchHint = `command='${launcher.command} ${launcher.args.join(' ')}'`
        const errorMessage = stderrBuffer.trim() || `Hermes bridge exited with code ${code} (${launchHint})`
        if (onResponse) {
          await onResponse({
            messageType: 'error',
            timestamp: new Date(),
            sessionId: latestSessionId || undefined,
            event: {
              type: 'error',
              message: errorMessage,
              code,
            },
            error: {
              code: 'HERMES_EXIT_ERROR',
              message: errorMessage,
            },
          })
        }
        reject(new Error(errorMessage))
        return
      }

      resolve(latestSessionId)
    })

    const requestPayload = {
      type: 'run',
      request_id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      session_id: existingSessionId,
      message: userMessage,
      cwd,
      max_iterations: maxIterations,
      resume: !!existingSessionId,
      model: normalizedModel,
      // Explicitly request native streaming semantics from Hermes bridge.
      assistant_delta: true,
      native_assistant_delta: true,
      native_stream: true,
    }

    proc.stdin.write(`${JSON.stringify(requestPayload)}\n`)
    proc.stdin.end()
  })
}
