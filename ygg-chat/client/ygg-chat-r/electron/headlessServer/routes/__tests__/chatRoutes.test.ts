import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerChatRoutes } from '../chatRoutes.js'

describe('registerChatRoutes', () => {
  let appServer: Server
  let baseUrl = ''
  const seenOperations: string[] = []

  beforeEach(() => {
    seenOperations.length = 0

    const app = express()
    app.use(express.json())

    registerChatRoutes(app, {
      orchestrator: {
        async runMessage(request, emit) {
          seenOperations.push(request.operation)
          emit({
            type: 'started',
            operation: request.operation,
            conversationId: request.conversationId,
            parentId: request.parentId,
            provider: request.provider,
            modelName: request.modelName,
          })
          emit({ type: 'chunk', part: 'text', delta: 'hello' })
          emit({ type: 'complete', message: { id: 'assistant-1' } })
        },
      },
    })

    appServer = app.listen(0)
    const address = appServer.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      appServer.close(error => {
        if (error) reject(error)
        else resolve()
      })
    })
  })

  it('streams SSE events from orchestrator', async () => {
    const res = await fetch(`${baseUrl}/api/conversations/c1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'test' }),
    })

    expect(res.status).toBe(200)

    const raw = await res.text()
    const dataLines = raw
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice('data: '.length)))

    expect(dataLines[0]).toMatchObject({
      type: 'started',
      conversationId: 'c1',
      provider: 'openaichatgpt',
      modelName: 'gpt-5.1-codex-mini',
    })
    expect(dataLines[1]).toMatchObject({ type: 'chunk', part: 'text', delta: 'hello' })
    expect(dataLines[2]).toMatchObject({ type: 'complete', message: { id: 'assistant-1' } })
    expect(seenOperations).toEqual(['send'])
  })

  it('maps endpoints to continuation operations', async () => {
    await fetch(`${baseUrl}/api/conversations/c1/messages/repeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messageId: 'm1' }),
    })

    await fetch(`${baseUrl}/api/conversations/c1/messages/m1/branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'branch text' }),
    })

    await fetch(`${baseUrl}/api/conversations/c1/messages/m1/edit-branch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'edited branch text' }),
    })

    expect(seenOperations).toEqual(['repeat', 'branch', 'edit-branch'])
  })
})
