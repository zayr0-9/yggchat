const STORAGE_KEY = 'ygg_tool_execution_settings'
export const TOOL_EXECUTION_SETTINGS_CHANGE_EVENT = 'ygg-tool-execution-settings-change'

export const MIN_BASH_TIMEOUT_MS = 1000
export const MAX_BASH_TIMEOUT_MS = 600000
export const DEFAULT_BASH_TIMEOUT_MS = 60000

export interface ToolExecutionSettings {
  bashTimeoutMs: number
}

const DEFAULT_SETTINGS: ToolExecutionSettings = {
  bashTimeoutMs: DEFAULT_BASH_TIMEOUT_MS,
}

function clampBashTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_BASH_TIMEOUT_MS
  }
  return Math.max(MIN_BASH_TIMEOUT_MS, Math.min(MAX_BASH_TIMEOUT_MS, Math.floor(value)))
}

export function loadToolExecutionSettings(): ToolExecutionSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }

    const parsed = JSON.parse(stored) as Partial<ToolExecutionSettings>
    return {
      bashTimeoutMs: clampBashTimeoutMs(parsed.bashTimeoutMs),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveToolExecutionSettings(settings: ToolExecutionSettings): void {
  const normalized: ToolExecutionSettings = {
    bashTimeoutMs: clampBashTimeoutMs(settings.bashTimeoutMs),
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(TOOL_EXECUTION_SETTINGS_CHANGE_EVENT, { detail: normalized }))
    }
  } catch (error) {
    console.error('Failed to save tool execution settings:', error)
  }
}

export function getDefaultBashTimeoutMs(): number {
  return loadToolExecutionSettings().bashTimeoutMs
}
