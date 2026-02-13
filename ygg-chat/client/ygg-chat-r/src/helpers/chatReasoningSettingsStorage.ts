const STORAGE_KEY = 'ygg_chat_reasoning_settings'
export const CHAT_REASONING_SETTINGS_CHANGE_EVENT = 'ygg-chat-reasoning-settings-change'

export const REASONING_EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh'] as const
export type ReasoningEffort = (typeof REASONING_EFFORT_OPTIONS)[number]

export interface ChatReasoningSettings {
  defaultThinkingEnabled: boolean
  defaultReasoningEffort: ReasoningEffort
}

const DEFAULT_SETTINGS: ChatReasoningSettings = {
  defaultThinkingEnabled: false,
  defaultReasoningEffort: 'medium',
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (typeof value !== 'string') return DEFAULT_SETTINGS.defaultReasoningEffort
  return REASONING_EFFORT_OPTIONS.includes(value as ReasoningEffort)
    ? (value as ReasoningEffort)
    : DEFAULT_SETTINGS.defaultReasoningEffort
}

export function loadChatReasoningSettings(): ChatReasoningSettings {
  try {
    if (typeof localStorage === 'undefined') return { ...DEFAULT_SETTINGS }
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return { ...DEFAULT_SETTINGS }

    const parsed = JSON.parse(stored) as Partial<ChatReasoningSettings>
    return {
      defaultThinkingEnabled: Boolean(parsed.defaultThinkingEnabled),
      defaultReasoningEffort: normalizeReasoningEffort(parsed.defaultReasoningEffort),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveChatReasoningSettings(settings: ChatReasoningSettings): void {
  const normalized: ChatReasoningSettings = {
    defaultThinkingEnabled: Boolean(settings.defaultThinkingEnabled),
    defaultReasoningEffort: normalizeReasoningEffort(settings.defaultReasoningEffort),
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(CHAT_REASONING_SETTINGS_CHANGE_EVENT, { detail: normalized }))
    }
  } catch (error) {
    console.error('Failed to save chat reasoning settings:', error)
  }
}
