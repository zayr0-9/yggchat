import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HermesAcpClient } from '../hermesAcpClient.js'

type JsonMessage = Record<string, any>

type FakeChildProcess = EventEmitter & {
  stdout: PassThrough
  stderr: PassThrough
  stdin: PassThrough
  kill: ReturnType<typeof vi.fn>
}

function createFakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess
  proc.stdout = new PassThrough()
  proc.stderr = new PassThrough()
  proc.stdin = new PassThrough()
  proc.kill = vi.fn()
  return proc
}

function watchJsonLines(stream: PassThrough, onMessage: (message: JsonMessage) => void) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', chunk => {
    buffer += String(chunk)
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const rawLine = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      const line = rawLine.trim()
      if (line) {
        onMessage(JSON.parse(line))
      }
      newlineIndex = buffer.indexOf('\n')
    }
  })
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HermesAcpClient', () => {
  it('initializes, streams prompt updates, and falls back when setting the model', async () => {
    const proc = createFakeChildProcess()
    const outbound: JsonMessage[] = []
    const responses: string[] = []
    const chunks: Array<{ type: string; delta?: string; toolName?: string }> = []

    watchJsonLines(proc.stdin, message => {
      outbound.push(message)

      if (message.method === 'initialize') {
        proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { authMethods: [] } })}\n`)
        return
      }

      if (message.method === 'session/new') {
        proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'session-1' } })}\n`)
        return
      }

      if (message.method === 'session/set_model') {
        proc.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { message: 'method not found' } })}\n`
        )
        return
      }

      if (message.method === 'session/setModel') {
        proc.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { ok: true } })}\n`)
        return
      }

      if (message.method === 'session/prompt') {
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: [{ type: 'content', content: { text: 'Hello ' } }],
              },
            },
          })}\n`
        )
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: [{ type: 'content', content: { text: 'world' } }],
              },
            },
          })}\n`
        )
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'agent_thought_chunk',
                content: [{ type: 'content', content: { text: 'thinking...' } }],
              },
            },
          })}\n`
        )
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'tool_call',
                toolCallId: 'tool-1',
                title: 'bash',
                kind: 'execute',
                rawInput: { command: 'pwd' },
                status: 'pending',
              },
            },
          })}\n`
        )
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: 'session-1',
              update: {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'tool-1',
                title: 'bash',
                kind: 'execute',
                status: 'completed',
                content: [{ type: 'content', content: { text: 'ok' } }],
                rawOutput: { stdout: 'ok' },
              },
            },
          })}\n`
        )
        proc.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              stopReason: 'completed',
              usage: { totalTokens: 7 },
            },
          })}\n`
        )
      }
    })

    const client = new HermesAcpClient(proc as any, {
      cwd: 'D:/workspace',
      onResponse: async response => {
        responses.push(response.messageType)
      },
      onStreamingChunk: async chunk => {
        chunks.push({
          type: chunk.type,
          delta: chunk.delta,
          toolName: chunk.toolName,
        })
      },
    })

    const initializeResult = await client.initialize()
    expect(initializeResult).toEqual({ authMethods: [] })

    const sessionId = await client.newSession('D:/workspace')
    expect(sessionId).toBe('session-1')

    await client.setSessionModel(sessionId, 'openai/gpt-5-mini')

    const promptResult = await client.prompt(sessionId, 'hello')

    expect(promptResult).toEqual({
      stopReason: 'completed',
      usage: { totalTokens: 7 },
      finalText: 'Hello world',
      finalReasoning: 'thinking...',
    })

    expect(chunks).toEqual([
      { type: 'content_delta', delta: 'Hello ', toolName: undefined },
      { type: 'content_delta', delta: 'world', toolName: undefined },
      { type: 'thinking_delta', delta: 'thinking...', toolName: undefined },
      { type: 'tool_start', delta: undefined, toolName: 'bash' },
      { type: 'tool_end', delta: undefined, toolName: 'bash' },
    ])
    expect(responses).toEqual(['tool_start', 'tool_result'])
    expect(outbound.some(message => message.method === 'session/setModel')).toBe(true)

    client.close()
  })

  it('routes ACP permission requests through the supplied handler', async () => {
    const proc = createFakeChildProcess()
    const outbound: JsonMessage[] = []

    watchJsonLines(proc.stdin, message => {
      outbound.push(message)
    })

    const client = new HermesAcpClient(proc as any, {
      cwd: 'D:/workspace',
      onPermissionRequest: async request => {
        expect(request.sessionId).toBe('session-1')
        expect(request.toolCall).toMatchObject({
          id: 'perm-1',
          name: 'rm -rf ./tmp',
          arguments: { description: 'delete temp files' },
          status: 'pending',
        })
        return 'deny'
      },
    })

    proc.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'session/request_permission',
        params: {
          sessionId: 'session-1',
          toolCall: {
            id: 'perm-1',
            title: 'rm -rf ./tmp',
            rawInput: { description: 'delete temp files' },
          },
          options: [
            { optionId: 'allow_once', kind: 'allow_once', name: 'Allow once' },
            { optionId: 'allow_always', kind: 'allow_always', name: 'Allow always' },
            { optionId: 'deny', kind: 'reject_once', name: 'Deny' },
          ],
        },
      })}\n`
    )

    await waitForCondition(() => outbound.length > 0)

    expect(outbound[0]).toMatchObject({
      jsonrpc: '2.0',
      id: 99,
      result: {
        outcome: {
          outcome: 'selected',
          optionId: 'deny',
        },
      },
    })

    client.close()
  })

  it('sends session/cancel and rejects the prompt when aborted', async () => {
    const proc = createFakeChildProcess()
    const outbound: JsonMessage[] = []
    const controller = new AbortController()

    watchJsonLines(proc.stdin, message => {
      outbound.push(message)
      if (message.method === 'session/prompt') {
        controller.abort()
      }
    })

    const client = new HermesAcpClient(proc as any, {
      cwd: 'D:/workspace',
      abortSignal: controller.signal,
    })

    const promptPromise = client.prompt('session-1', 'hello')

    await expect(promptPromise).rejects.toMatchObject({ name: 'AbortError' })
    await waitForCondition(() => outbound.some(message => message.method === 'session/cancel'))

    expect(outbound.some(message => message.method === 'session/cancel')).toBe(true)
    expect(proc.kill).toHaveBeenCalled()
  })
})
