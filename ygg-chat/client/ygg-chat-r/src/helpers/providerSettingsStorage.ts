// Provider Settings Storage
// Simple localStorage-based persistence for provider visibility and default selection

import { isCommunityMode } from '../config/runtimeMode'

const STORAGE_KEY = 'ygg_provider_settings'
export const PROVIDER_SETTINGS_CHANGE_EVENT = 'ygg-provider-settings-change'
export const MIN_OPENROUTER_TEMPERATURE = 0
export const MAX_OPENROUTER_TEMPERATURE = 2
export const DEFAULT_COMPACTION_SYSTEM_PROMPT =
  'You compact chat history. Return concise markdown that preserves goals, hard requirements, key facts, decisions, pending tasks, and unresolved questions. Do not include tool protocol chatter.'

export interface ProviderSettings {
  /** Whether the provider selector is visible in the chat UI */
  showProviderSelector: boolean
  /** Default provider to use when selector is hidden (provider name string) */
  defaultProvider: string | null
  /** Optional default temperature for OpenRouter generations. Null = provider/model default. */
  openRouterTemperature: number | null
  /** Preferred provider for automatic branch compaction. Null = use current chat provider. */
  compactionProvider: string | null
  /** Preferred model for automatic branch compaction. Null = use provider default/current model. */
  compactionModel: string | null
  /** System prompt used by auto-compaction summarization. */
  compactionSystemPrompt: string
}

const DEFAULT_SETTINGS: ProviderSettings = {
  showProviderSelector: true,
  defaultProvider: null,
  openRouterTemperature: null,
  compactionProvider: null,
  compactionModel: null,
  compactionSystemPrompt: DEFAULT_COMPACTION_SYSTEM_PROMPT,
}

const COMMUNITY_ALLOWED_PROVIDERS = new Set(['LM Studio', 'OpenAI (ChatGPT)'])
const COMMUNITY_FALLBACK_PROVIDER = 'LM Studio'

function normalizeOpenRouterTemperature(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const clamped = Math.max(MIN_OPENROUTER_TEMPERATURE, Math.min(MAX_OPENROUTER_TEMPERATURE, value))
  return Math.round(clamped * 100) / 100
}

function normalizeCompactionSystemPrompt(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_COMPACTION_SYSTEM_PROMPT
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : DEFAULT_COMPACTION_SYSTEM_PROMPT
}

/**
 * Load provider settings from localStorage
 */
export function loadProviderSettings(): ProviderSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    const parsed = stored ? (JSON.parse(stored) as Partial<ProviderSettings>) : DEFAULT_SETTINGS

    const resolvedDefaultProvider = parsed.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider
    const communityDefaultProvider =
      resolvedDefaultProvider && COMMUNITY_ALLOWED_PROVIDERS.has(resolvedDefaultProvider)
        ? resolvedDefaultProvider
        : COMMUNITY_FALLBACK_PROVIDER

    return {
      showProviderSelector: isCommunityMode ? true : (parsed.showProviderSelector ?? DEFAULT_SETTINGS.showProviderSelector),
      defaultProvider: isCommunityMode ? communityDefaultProvider : resolvedDefaultProvider,
      openRouterTemperature: normalizeOpenRouterTemperature(parsed.openRouterTemperature),
      compactionProvider: parsed.compactionProvider ?? DEFAULT_SETTINGS.compactionProvider,
      compactionModel: parsed.compactionModel ?? DEFAULT_SETTINGS.compactionModel,
      compactionSystemPrompt: normalizeCompactionSystemPrompt(parsed.compactionSystemPrompt),
    }
  } catch {
    return {
      ...DEFAULT_SETTINGS,
      defaultProvider: isCommunityMode ? COMMUNITY_FALLBACK_PROVIDER : DEFAULT_SETTINGS.defaultProvider,
    }
  }
}

/**
 * Save provider settings to localStorage and emit change event
 */
export function saveProviderSettings(settings: ProviderSettings): void {
  const normalized: ProviderSettings = {
    ...settings,
    openRouterTemperature: normalizeOpenRouterTemperature(settings.openRouterTemperature),
    compactionSystemPrompt: normalizeCompactionSystemPrompt(settings.compactionSystemPrompt),
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new CustomEvent(PROVIDER_SETTINGS_CHANGE_EVENT, { detail: normalized }))
  } catch (error) {
    console.error('Failed to save provider settings:', error)
  }
}

/**
 * Update a single setting and persist
 */
export function updateProviderSetting<K extends keyof ProviderSettings>(
  key: K,
  value: ProviderSettings[K]
): ProviderSettings {
  const current = loadProviderSettings()
  const updated = { ...current, [key]: value }
  saveProviderSettings(updated)
  return updated
}
