import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProviderTokenStore } from '../../providers/tokenStore.js'
import { registerEphemeralGenerateRoutes } from '../ephemeralGenerateRoutes.js'

describe('registerEphemeralGenerateRoutes', () => {
  let appServer: Server
  let baseUrl = ''

  beforeEach(() => {
    const app = express()
    app.use(express.json())
    registerEphemeralGenerateRoutes(app, {
      tokenStore: new ProviderTokenStore(),
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

  it('direct provider responses endpoint fails fast without auth', async () => {
    const res = await fetch(`${baseUrl}/api/headless/provider/openai/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello', modelName: 'gpt-5.1-codex-mini', history: [] }),
    })

    expect(res.status).toBe(500)
    const payload = (await res.json()) as any
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('OpenAI ChatGPT auth missing')
  })

  it('ephemeral chat alias fails fast without auth', async () => {
    const res = await fetch(`${baseUrl}/api/headless/ephemeral/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hello', modelName: 'gpt-5.1-codex-mini', history: [] }),
    })

    expect(res.status).toBe(500)
    const payload = (await res.json()) as any
    expect(payload.success).toBe(false)
    expect(payload.error).toContain('OpenAI ChatGPT auth missing')
  })
})
