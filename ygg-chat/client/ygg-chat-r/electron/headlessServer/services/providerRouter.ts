import { LmStudioProvider } from '../providers/lmStudioProvider.js'
import { OpenAiChatgptProvider } from '../providers/openaiChatgptProvider.js'
import { OpenRouterProvider, type HeadlessProvider, type ProviderGenerateInput, type ProviderGenerateOutput } from '../providers/openRouterProvider.js'
import type { ProviderTokenStore } from '../providers/tokenStore.js'

export type ProviderRoute = 'openrouter' | 'openaichatgpt' | 'lmstudio'

export function normalizeProviderRoute(providerName: string): ProviderRoute {
  const normalized = providerName.trim().toLowerCase().replace(/\s+/g, '')
  if (normalized === 'openaichatgpt' || normalized === 'openai(chatgpt)' || normalized === 'openai') {
    return 'openaichatgpt'
  }
  if (normalized === 'lmstudio') return 'lmstudio'
  if (normalized === 'openrouter') return 'openrouter'
  // MVP default path is OpenAI ChatGPT.
  return 'openaichatgpt'
}

interface ProviderRouterDeps {
  tokenStore?: ProviderTokenStore
}

export class ProviderRouter {
  private readonly providers: Record<ProviderRoute, HeadlessProvider>

  constructor(deps: ProviderRouterDeps = {}) {
    this.providers = {
      openrouter: new OpenRouterProvider(),
      openaichatgpt: new OpenAiChatgptProvider({ tokenStore: deps.tokenStore }),
      lmstudio: new LmStudioProvider(),
    }
  }

  async generate(providerName: string, input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const route = normalizeProviderRoute(providerName)
    const provider = this.providers[route]
    return provider.generate(input)
  }
}
