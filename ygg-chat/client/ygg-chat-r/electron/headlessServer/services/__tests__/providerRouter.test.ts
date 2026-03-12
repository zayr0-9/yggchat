import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiChatgptProvider } from '../../providers/openaiChatgptProvider.js'
import { ProviderRouter, normalizeProviderRoute } from '../providerRouter.js'

describe('provider routing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })
  it('normalizes openai provider aliases', () => {
    expect(normalizeProviderRoute('OpenAIChatGPT')).toBe('openaichatgpt')
    expect(normalizeProviderRoute('openai(chatgpt)')).toBe('openaichatgpt')
    expect(normalizeProviderRoute('openai')).toBe('openaichatgpt')
    expect(normalizeProviderRoute('unknown-provider')).toBe('openaichatgpt')
  })

  it('routes openrouter and lmstudio through provider implementations', async () => {
    const router = new ProviderRouter()

    await expect(
      router.generate('openrouter', {
        modelName: 'openrouter/auto',
        history: [],
        userContent: 'hi',
        railwayTurn: {
          conversationId: 'c1',
        },
      })
    ).rejects.toThrow('Yggdrasil app auth token missing')

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'offline',
    } as any)

    await expect(
      router.generate('lmstudio', {
        modelName: 'local-model',
        history: [],
        userContent: 'hi',
      })
    ).rejects.toThrow('LM Studio request failed (503): offline')
  })

  it('openai provider fails fast when auth is missing', async () => {
    const provider = new OpenAiChatgptProvider()

    await expect(
      provider.generate({
        modelName: 'gpt-5.2-codex',
        history: [],
        userContent: 'hello',
      })
    ).rejects.toThrow('OpenAI ChatGPT auth missing')
  })
})
