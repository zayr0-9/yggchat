import express from 'express'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerTestHarnessRoutes } from '../testHarnessRoutes.js'

describe('registerTestHarnessRoutes', () => {
  let appServer: Server
  let baseUrl = ''

  beforeEach(() => {
    const app = express()
    app.use(express.json())
    registerTestHarnessRoutes(app, {
      getDefaultTools: () => [
        { name: 'read_file', description: 'Read a file' },
        { name: 'ripgrep', description: 'Search file text' },
      ],
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

  it('serves the in-browser OpenAI OAuth test harness', async () => {
    const res = await fetch(`${baseUrl}/headless/openai-test`)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('Headless OpenAI OAuth + Chat Harness')
    expect(html).toContain('gpt-5.1-codex-mini')
    expect(html).toContain('/api/openai/auth/start')
    expect(html).toContain('/api/headless/ephemeral/chat')
    expect(html).toContain('/api/headless/ephemeral/tools')
    expect(html).toContain('/api/headless/ephemeral/harness.js')
    expect(html).toContain('Loaded Tools')
  })

  it('serves external harness client script', async () => {
    const res = await fetch(`${baseUrl}/api/headless/ephemeral/harness.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/javascript')

    const script = await res.text()
    expect(script).toContain('window.__headlessHarnessBooted')
    expect(script).toContain('/api/headless/ephemeral/tools')
    expect(script).toContain('/api/headless/provider/openai/responses')
  })

  it('lists loaded tools for harness selection', async () => {
    const res = await fetch(`${baseUrl}/api/headless/ephemeral/tools`)
    expect(res.status).toBe(200)

    const payload = (await res.json()) as any
    expect(payload.success).toBe(true)
    expect(payload.count).toBe(2)
    expect(payload.tools.map((tool: any) => tool.name)).toEqual(['read_file', 'ripgrep'])
  })
})
