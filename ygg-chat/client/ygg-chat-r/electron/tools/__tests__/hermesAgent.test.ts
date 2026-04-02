import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildHermesYggMcpServerName,
  normalizeHermesModel,
  resolveHermesAcpMcpServers,
} from '../hermesAgent.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeHermesModel', () => {
  it('normalizes common Ygg display names to Hermes model ids only for Hermes sends', () => {
    expect(normalizeHermesModel('GPT-5.4')).toBe('gpt-5.4')
    expect(normalizeHermesModel('GPT-5.4 Mini')).toBe('gpt-5.4-mini')
    expect(normalizeHermesModel('GPT-5.3 Codex')).toBe('gpt-5.3-codex')
    expect(normalizeHermesModel('GPT-5.3 Codex Spark')).toBe('gpt-5.3-codex-spark')
    expect(normalizeHermesModel('GPT-5.2')).toBe('gpt-5.2')
    expect(normalizeHermesModel('GPT-5.2 Codex')).toBe('gpt-5.2-codex')
    expect(normalizeHermesModel('GPT-5.1 Codex Max')).toBe('gpt-5.1-codex-max')
    expect(normalizeHermesModel('GPT-5.1 Codex Mini')).toBe('gpt-5.1-codex-mini')
  })

  it('leaves unknown model strings unchanged', () => {
    expect(normalizeHermesModel('some-custom-model')).toBe('some-custom-model')
    expect(normalizeHermesModel('openai/gpt-5-mini')).toBe('openai/gpt-5-mini')
    expect(normalizeHermesModel(undefined)).toBeUndefined()
  })
})

describe('resolveHermesAcpMcpServers', () => {
  it('returns no MCP servers when auth token or base URL is unavailable', () => {
    vi.stubEnv('YGG_HERMES_MCP_AUTH_TOKEN', '')
    vi.stubEnv('YGG_LOCAL_SERVER_URL', '')
    vi.stubEnv('YGG_LOCAL_SERVER_LAN_URL', '')
    expect(resolveHermesAcpMcpServers('conv-1', 'D:/workspace/project', 'native')).toEqual([])

    vi.stubEnv('YGG_HERMES_MCP_AUTH_TOKEN', 'secret-token')
    expect(resolveHermesAcpMcpServers('conv-1', 'D:/workspace/project', 'native')).toEqual([])
  })

  it('builds an HTTP MCP server against the local server endpoint for native Hermes', () => {
    vi.stubEnv('YGG_HERMES_MCP_AUTH_TOKEN', 'secret-token')
    vi.stubEnv('YGG_LOCAL_SERVER_URL', 'http://127.0.0.1:3002')
    vi.stubEnv('YGG_LOCAL_SERVER_LAN_URL', 'http://192.168.1.50:3002')

    expect(resolveHermesAcpMcpServers('conv-1', 'D:/workspace/project', 'native')).toEqual([
      {
        name: buildHermesYggMcpServerName('conv-1', 'D:/workspace/project'),
        transport: 'http',
        type: 'http',
        enabled: true,
        url: 'http://127.0.0.1:3002/api/mcp/ygg',
        headers: {
          Authorization: 'Bearer secret-token',
          'X-Ygg-Hermes-Conversation-Id': 'conv-1',
          'X-Ygg-Hermes-Cwd': 'D:/workspace/project',
        },
      },
    ])
  })

  it('prefers the LAN-advertised local server URL when Hermes runs in WSL', () => {
    vi.stubEnv('YGG_HERMES_MCP_AUTH_TOKEN', 'secret-token')
    vi.stubEnv('YGG_LOCAL_SERVER_URL', 'http://127.0.0.1:3002')
    vi.stubEnv('YGG_LOCAL_SERVER_LAN_URL', 'http://192.168.1.50:3002')

    expect(resolveHermesAcpMcpServers('conv-1', 'D:/workspace/project', 'wsl')).toEqual([
      {
        name: buildHermesYggMcpServerName('conv-1', 'D:/workspace/project'),
        transport: 'http',
        type: 'http',
        enabled: true,
        url: 'http://192.168.1.50:3002/api/mcp/ygg',
        headers: {
          Authorization: 'Bearer secret-token',
          'X-Ygg-Hermes-Conversation-Id': 'conv-1',
          'X-Ygg-Hermes-Cwd': 'D:/workspace/project',
        },
      },
    ])
  })
})
