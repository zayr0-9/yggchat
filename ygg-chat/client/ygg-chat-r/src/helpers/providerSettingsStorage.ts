// Provider Settings Storage
// Simple localStorage-based persistence for provider visibility and default selection

const STORAGE_KEY = 'ygg_provider_settings'
export const PROVIDER_SETTINGS_CHANGE_EVENT = 'ygg-provider-settings-change'

export interface ProviderSettings {
  /** Whether the provider selector is visible in the chat UI */
  showProviderSelector: boolean
  /** Default provider to use when selector is hidden (provider name string) */
  defaultProvider: string | null
}

const DEFAULT_SETTINGS: ProviderSettings = {
  showProviderSelector: true,
  defaultProvider: null,
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
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * Save provider settings to localStorage and emit change event
 */
export function saveProviderSettings(settings: ProviderSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent(PROVIDER_SETTINGS_CHANGE_EVENT, { detail: settings }))
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
