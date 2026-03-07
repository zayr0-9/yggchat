import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerCapabilityRoutes } from '../capabilityRoutes.js'

describe('registerCapabilityRoutes', () => {
  let appServer: Server
  let baseUrl = ''

  beforeEach(() => {
    const app = express()
    registerCapabilityRoutes(app, {
      getDefaultTools: () => [
        { name: 'read_file', description: 'Read file' },
        { name: 'edit_file', description: 'Edit file' },
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

  it('serves capabilities in both compatibility and v1 paths', async () => {
    const [legacyRes, v1Res] = await Promise.all([
      fetch(`${baseUrl}/api/headless/capabilities`),
      fetch(`${baseUrl}/api/v1/capabilities`),
    ])

    expect(legacyRes.status).toBe(200)
    expect(v1Res.status).toBe(200)

    const legacyPayload = (await legacyRes.json()) as any
    const v1Payload = (await v1Res.json()) as any

    expect(legacyPayload.apiVersion).toBe('v1')
    expect(v1Payload.apiVersion).toBe('v1')
    expect(legacyPayload.chat.operations).toContain('send')
    expect(v1Payload.tools.map((tool: any) => tool.name)).toContain('read_file')
  })
})
