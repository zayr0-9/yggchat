// Provider Settings Storage
// Simple localStorage-based persistence for provider visibility and default selection

const STORAGE_KEY = 'ygg_provider_settings'
export const PROVIDER_SETTINGS_CHANGE_EVENT = 'ygg-provider-settings-change'
export const MIN_OPENROUTER_TEMPERATURE = 0
export const MAX_OPENROUTER_TEMPERATURE = 2

export interface ProviderSettings {
  /** Whether the provider selector is visible in the chat UI */
  showProviderSelector: boolean
  /** Default provider to use when selector is hidden (provider name string) */
  defaultProvider: string | null
  /** Optional default temperature for OpenRouter generations. Null = provider/model default. */
  openRouterTemperature: number | null
}

const DEFAULT_SETTINGS: ProviderSettings = {
  showProviderSelector: true,
  defaultProvider: null,
  openRouterTemperature: null,
}

function normalizeOpenRouterTemperature(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const clamped = Math.max(MIN_OPENROUTER_TEMPERATURE, Math.min(MAX_OPENROUTER_TEMPERATURE, value))
  return Math.round(clamped * 100) / 100
}

/**
 * Load provider settings from localStorage
 */
export function loadProviderSettings(): ProviderSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }

    const parsed = JSON.parse(stored) as Partial<ProviderSettings>
    return {
      showProviderSelector: parsed.showProviderSelector ?? DEFAULT_SETTINGS.showProviderSelector,
      defaultProvider: parsed.defaultProvider ?? DEFAULT_SETTINGS.defaultProvider,
      openRouterTemperature: normalizeOpenRouterTemperature(parsed.openRouterTemperature),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Save provider settings to localStorage and emit change event
 */
export function saveProviderSettings(settings: ProviderSettings): void {
  const normalized: ProviderSettings = {
    ...settings,
    openRouterTemperature: normalizeOpenRouterTemperature(settings.openRouterTemperature),
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
