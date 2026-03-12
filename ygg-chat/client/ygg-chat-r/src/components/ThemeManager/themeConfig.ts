import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark'
export type ChatThemeRoleKey = 'user' | 'assistant' | 'system' | 'ex_agent' | 'unknown'
export type HeimdallNodeThemeKey = 'user' | 'assistant' | 'ex_agent'

export interface ThemeColorPair {
  light: string
  dark: string
}

export interface ChatMessageRoleTheme {
  containerBg: ThemeColorPair
  border: ThemeColorPair
  roleText: ThemeColorPair
}

export interface HeimdallNodeTheme {
  fill: ThemeColorPair
  stroke: ThemeColorPair
  visibleStroke: ThemeColorPair
}

export interface CustomChatTheme {
  version: 1
  name: string
  colors: {
    chatPanelBg: ThemeColorPair
    chatMessageListBg: ThemeColorPair
    heimdallPanelBg: ThemeColorPair
    messageRoles: Record<ChatThemeRoleKey, ChatMessageRoleTheme>
    heimdallNodes: Record<HeimdallNodeThemeKey, HeimdallNodeTheme>
  }
}

export const CHAT_CUSTOM_THEME_STORAGE_KEY = 'chat:customTheme'
export const CHAT_CUSTOM_THEME_ENABLED_STORAGE_KEY = 'chat:customThemeEnabled'
export const CHAT_CUSTOM_THEME_CHANGE_EVENT = 'chatCustomThemeChange'

const MESSAGE_ROLE_KEYS: ChatThemeRoleKey[] = ['user', 'assistant', 'system', 'ex_agent', 'unknown']
const HEIMDALL_NODE_KEYS: HeimdallNodeThemeKey[] = ['user', 'assistant', 'ex_agent']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const pickString = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback)

const readColorPair = (value: unknown, fallback: ThemeColorPair): ThemeColorPair => {
  if (!isRecord(value)) {
    return { ...fallback }
  }

  return {
    light: pickString(value.light, fallback.light),
    dark: pickString(value.dark, fallback.dark),
  }
}

export const createDefaultCustomChatTheme = (): CustomChatTheme => ({
  version: 1,
  name: 'Custom Theme',
  colors: {
    chatPanelBg: {
      light: 'oklch(98.5% 0 0)',
      dark: 'oklch(20.5% 0 0)',
    },
    chatMessageListBg: {
      light: 'oklch(98.5% 0 0)',
      dark: 'oklch(20.5% 0 0)',
    },
    heimdallPanelBg: {
      light: '#fafafa',
      dark: '#0a0a0a',
    },
    messageRoles: {
      user: {
        containerBg: { light: '#fafafa', dark: '#171717' },
        border: { light: 'transparent', dark: 'transparent' },
        roleText: { light: '#3730a3', dark: '#f5f3ff' },
      },
      assistant: {
        containerBg: { light: 'transparent', dark: 'transparent' },
        border: { light: 'transparent', dark: 'transparent' },
        roleText: { light: '#3f6212', dark: '#fef3c7' },
      },
      system: {
        containerBg: { light: 'transparent', dark: 'transparent' },
        border: { light: 'transparent', dark: 'transparent' },
        roleText: { light: '#c084fc', dark: '#c084fc' },
      },
      ex_agent: {
        containerBg: { light: 'transparent', dark: 'transparent' },
        border: { light: 'transparent', dark: 'transparent' },
        roleText: { light: '#c2410c', dark: '#fb923c' },
      },
      unknown: {
        containerBg: { light: 'transparent', dark: 'transparent' },
        border: { light: 'transparent', dark: 'transparent' },
        roleText: { light: '#9ca3af', dark: '#9ca3af' },
      },
    },
    heimdallNodes: {
      user: {
        fill: { light: '#f5f5f5', dark: '#171717' },
        stroke: { light: '#d4d4d4', dark: '#262626' },
        visibleStroke: { light: '#34d399', dark: '#f97316' },
      },
      assistant: {
        fill: { light: '#f1f5f9', dark: '#171717' },
        stroke: { light: '#e5e5e5', dark: '#262626' },
        visibleStroke: { light: '#34d399', dark: '#f97316' },
      },
      ex_agent: {
        fill: { light: '#f8fafc', dark: '#0a0a0a' },
        stroke: { light: '#ea580c', dark: '#ea580c' },
        visibleStroke: { light: '#34d399', dark: '#ea580c' },
      },
    },
  },
})

const sanitizeCustomTheme = (value: unknown): CustomChatTheme => {
  const defaults = createDefaultCustomChatTheme()

  if (!isRecord(value)) {
    return defaults
  }

  const rawColors = isRecord(value.colors) ? value.colors : {}
  const rawRoleThemes = isRecord(rawColors.messageRoles) ? rawColors.messageRoles : {}
  const rawNodeThemes = isRecord(rawColors.heimdallNodes) ? rawColors.heimdallNodes : {}

  const messageRoles = MESSAGE_ROLE_KEYS.reduce(
    (acc, role) => {
      const fallback = defaults.colors.messageRoles[role]
      const rawRoleTheme = isRecord(rawRoleThemes[role]) ? rawRoleThemes[role] : {}

      acc[role] = {
        containerBg: readColorPair(rawRoleTheme.containerBg, fallback.containerBg),
        border: readColorPair(rawRoleTheme.border, fallback.border),
        roleText: readColorPair(rawRoleTheme.roleText, fallback.roleText),
      }

      return acc
    },
    {} as Record<ChatThemeRoleKey, ChatMessageRoleTheme>
  )

  const heimdallNodes = HEIMDALL_NODE_KEYS.reduce(
    (acc, sender) => {
      const fallback = defaults.colors.heimdallNodes[sender]
      const rawNodeTheme = isRecord(rawNodeThemes[sender]) ? rawNodeThemes[sender] : {}

      acc[sender] = {
        fill: readColorPair(rawNodeTheme.fill, fallback.fill),
        stroke: readColorPair(rawNodeTheme.stroke, fallback.stroke),
        visibleStroke: readColorPair(rawNodeTheme.visibleStroke, fallback.visibleStroke),
      }

      return acc
    },
    {} as Record<HeimdallNodeThemeKey, HeimdallNodeTheme>
  )

  return {
    version: 1,
    name: pickString(value.name, defaults.name),
    colors: {
      chatPanelBg: readColorPair(rawColors.chatPanelBg, defaults.colors.chatPanelBg),
      chatMessageListBg: readColorPair(rawColors.chatMessageListBg, defaults.colors.chatMessageListBg),
      heimdallPanelBg: readColorPair(rawColors.heimdallPanelBg, defaults.colors.heimdallPanelBg),
      messageRoles,
      heimdallNodes,
    },
  }
}

const emitCustomThemeChange = () => {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(CHAT_CUSTOM_THEME_CHANGE_EVENT))
}

export const getStoredCustomChatTheme = (): CustomChatTheme => {
  if (typeof window === 'undefined') {
    return createDefaultCustomChatTheme()
  }

  try {
    const stored = window.localStorage.getItem(CHAT_CUSTOM_THEME_STORAGE_KEY)
    if (!stored) {
      return createDefaultCustomChatTheme()
    }

    const parsed = JSON.parse(stored)
    return sanitizeCustomTheme(parsed)
  } catch {
    return createDefaultCustomChatTheme()
  }
}

export const saveCustomChatTheme = (theme: CustomChatTheme): void => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CHAT_CUSTOM_THEME_STORAGE_KEY, JSON.stringify(theme))
    emitCustomThemeChange()
  } catch {
    // Ignore localStorage write errors
  }
}

export const getCustomChatThemeEnabled = (): boolean => {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(CHAT_CUSTOM_THEME_ENABLED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export const setCustomChatThemeEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(CHAT_CUSTOM_THEME_ENABLED_STORAGE_KEY, String(enabled))
    emitCustomThemeChange()
  } catch {
    // Ignore localStorage write errors
  }
}

export const resetCustomChatTheme = (): void => {
  saveCustomChatTheme(createDefaultCustomChatTheme())
}

export const getThemeModeColor = (pair: ThemeColorPair, isDarkMode: boolean): string =>
  isDarkMode ? pair.dark : pair.light

export const resolveRoleThemeKey = (role: string): ChatThemeRoleKey => {
  switch (role) {
    case 'user':
      return 'user'
    case 'assistant':
      return 'assistant'
    case 'system':
      return 'system'
    case 'ex_agent':
      return 'ex_agent'
    default:
      return 'unknown'
  }
}

export const resolveHeimdallNodeThemeKey = (sender: string): HeimdallNodeThemeKey => {
  switch (sender) {
    case 'user':
      return 'user'
    case 'ex_agent':
      return 'ex_agent'
    default:
      return 'assistant'
  }
}

export const useHtmlDarkMode = (): boolean => {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof document === 'undefined') return false
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    if (typeof document === 'undefined') return

    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'))
    }

    checkDarkMode()

    const observer = new MutationObserver(checkDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  return isDarkMode
}

export const useCustomChatTheme = () => {
  const [theme, setTheme] = useState<CustomChatTheme>(() => getStoredCustomChatTheme())
  const [enabled, setEnabled] = useState<boolean>(() => getCustomChatThemeEnabled())

  useEffect(() => {
    if (typeof window === 'undefined') return

    const syncFromStorage = () => {
      setTheme(getStoredCustomChatTheme())
      setEnabled(getCustomChatThemeEnabled())
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key === CHAT_CUSTOM_THEME_STORAGE_KEY || event.key === CHAT_CUSTOM_THEME_ENABLED_STORAGE_KEY) {
        syncFromStorage()
      }
    }

    window.addEventListener(CHAT_CUSTOM_THEME_CHANGE_EVENT, syncFromStorage)
    window.addEventListener('storage', handleStorage)

    return () => {
      window.removeEventListener(CHAT_CUSTOM_THEME_CHANGE_EVENT, syncFromStorage)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  return { theme, enabled }
}
