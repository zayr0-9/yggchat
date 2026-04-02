export const BROWSER_SETTINGS_STORAGE_KEY = 'ygg_browser_settings'
export const BROWSER_SETTINGS_CHANGE_EVENT = 'ygg-browser-settings-change'

export interface BrowserSettings {
  guestDevToolsEnabled: boolean
}

const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  guestDevToolsEnabled: true,
}

const normalizeBrowserSettings = (settings: Partial<BrowserSettings> | null | undefined): BrowserSettings => ({
  guestDevToolsEnabled:
    typeof settings?.guestDevToolsEnabled === 'boolean'
      ? settings.guestDevToolsEnabled
      : DEFAULT_BROWSER_SETTINGS.guestDevToolsEnabled,
})

const syncBrowserSettingsToElectronStore = async (settings: BrowserSettings): Promise<void> => {
  if (typeof window === 'undefined') return

  const electronStorage = window.electronAPI?.storage
  if (!electronStorage?.set) return

  try {
    await electronStorage.set(BROWSER_SETTINGS_STORAGE_KEY, settings)
  } catch (error) {
    console.error('Failed to sync browser settings to Electron storage:', error)
  }
}

const persistBrowserSettings = (settings: BrowserSettings): void => {
  try {
    localStorage.setItem(BROWSER_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<BrowserSettings>(BROWSER_SETTINGS_CHANGE_EVENT, { detail: settings }))
    }
  } catch (error) {
    console.error('Failed to persist browser settings:', error)
  }
}

export function loadBrowserSettings(): BrowserSettings {
  try {
    const stored = localStorage.getItem(BROWSER_SETTINGS_STORAGE_KEY)
    if (!stored) return { ...DEFAULT_BROWSER_SETTINGS }

    return normalizeBrowserSettings(JSON.parse(stored) as Partial<BrowserSettings>)
  } catch {
    return { ...DEFAULT_BROWSER_SETTINGS }
  }
}

export function hydrateBrowserSettings(settings: Partial<BrowserSettings> | null | undefined): BrowserSettings {
  const normalized = normalizeBrowserSettings(settings)
  persistBrowserSettings(normalized)
  return normalized
}

export function saveBrowserSettings(settings: Partial<BrowserSettings> | null | undefined): BrowserSettings {
  const normalized = normalizeBrowserSettings(settings)
  persistBrowserSettings(normalized)
  void syncBrowserSettingsToElectronStore(normalized)
  return normalized
}
