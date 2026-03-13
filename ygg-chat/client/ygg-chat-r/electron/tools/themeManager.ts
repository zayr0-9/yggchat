import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'

const YGG_DIR_NAME = '.ygg'
const CUSTOM_THEMES_DIR_NAME = 'custom-themes'
const THEME_FILE_EXTENSION = '.json'
const MAX_LIST_RESULTS = 50

export type ThemeManagerAction = 'template' | 'list' | 'read' | 'save' | 'delete'

type ChatThemeRoleKey = 'user' | 'assistant' | 'system' | 'ex_agent' | 'unknown'
type HeimdallNodeThemeKey = 'user' | 'assistant' | 'ex_agent'

interface ThemeColorPair {
  light: string
  dark: string
}

interface ChatMessageRoleTheme {
  containerBg: ThemeColorPair
  border: ThemeColorPair
  roleText: ThemeColorPair
}

interface HeimdallNodeTheme {
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
    conversationToolbarBg: ThemeColorPair
    settingsSolidColorSectionBg: ThemeColorPair
    appBackgroundColor: ThemeColorPair
    settingsPaneBodyBg: ThemeColorPair
    chatInputAreaBorder: ThemeColorPair
    chatProgressBarFill: ThemeColorPair
    actionPopoverBorder: ThemeColorPair
    sendButtonAnimationColor: ThemeColorPair
    streamingAnimationColor: ThemeColorPair
    heimdallNotePillBg: ThemeColorPair
    heimdallNotePillText: ThemeColorPair
    heimdallNotePillBorder: ThemeColorPair
    messageRoles: Record<ChatThemeRoleKey, ChatMessageRoleTheme>
    heimdallNodes: Record<HeimdallNodeThemeKey, HeimdallNodeTheme>
  }
}

export interface ThemeManagerArgs {
  action: ThemeManagerAction
  name?: string
  theme?: unknown
}

export interface ThemeManagerListItem {
  id: string
  fileName: string
  name: string
  modifiedAt: string
}

export interface ThemeManagerResult {
  success: boolean
  error?: string
  directory?: string
  action?: ThemeManagerAction
  themes?: ThemeManagerListItem[]
  totalCount?: number
  exists?: boolean
  id?: string
  fileName?: string
  modifiedAt?: string
  deleted?: boolean
  created?: boolean
  theme?: CustomChatTheme
}

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
    conversationToolbarBg: {
      light: 'rgba(255, 255, 255, 0.8)',
      dark: 'rgba(23, 23, 23, 0.8)',
    },
    settingsSolidColorSectionBg: {
      light: 'rgba(250, 250, 250, 0.7)',
      dark: 'rgba(24, 24, 27, 0.6)',
    },
    appBackgroundColor: {
      light: '#F7F9FB',
      dark: '#050505',
    },
    settingsPaneBodyBg: {
      light: 'oklch(97% 0 0)',
      dark: 'oklch(18% 0 0)',
    },
    chatInputAreaBorder: {
      light: 'rgba(194, 65, 12, 0.7)',
      dark: 'rgba(194, 65, 12, 0.7)',
    },
    chatProgressBarFill: {
      light: '#3b82f6',
      dark: '#60a5fa',
    },
    actionPopoverBorder: {
      light: '#dbeafe',
      dark: 'rgba(194, 65, 12, 0.4)',
    },
    sendButtonAnimationColor: {
      light: '#ffffff',
      dark: '#ffffff',
    },
    streamingAnimationColor: {
      light: '#ef4444',
      dark: '#ffffff',
    },
    heimdallNotePillBg: {
      light: '#3b82f6',
      dark: '#f59e0b',
    },
    heimdallNotePillText: {
      light: '#ffffff',
      dark: '#0c0a09',
    },
    heimdallNotePillBorder: {
      light: 'rgba(0,0,0,0.18)',
      dark: 'rgba(0,0,0,0.18)',
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

export const sanitizeCustomTheme = (value: unknown): CustomChatTheme => {
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
      conversationToolbarBg: readColorPair(rawColors.conversationToolbarBg, defaults.colors.conversationToolbarBg),
      settingsSolidColorSectionBg: readColorPair(
        rawColors.settingsSolidColorSectionBg,
        defaults.colors.settingsSolidColorSectionBg
      ),
      appBackgroundColor: readColorPair(rawColors.appBackgroundColor, defaults.colors.appBackgroundColor),
      settingsPaneBodyBg: readColorPair(rawColors.settingsPaneBodyBg, defaults.colors.settingsPaneBodyBg),
      chatInputAreaBorder: readColorPair(rawColors.chatInputAreaBorder, defaults.colors.chatInputAreaBorder),
      chatProgressBarFill: readColorPair(rawColors.chatProgressBarFill, defaults.colors.chatProgressBarFill),
      actionPopoverBorder: readColorPair(rawColors.actionPopoverBorder, defaults.colors.actionPopoverBorder),
      sendButtonAnimationColor: readColorPair(
        rawColors.sendButtonAnimationColor,
        defaults.colors.sendButtonAnimationColor
      ),
      streamingAnimationColor: readColorPair(rawColors.streamingAnimationColor, defaults.colors.streamingAnimationColor),
      heimdallNotePillBg: readColorPair(rawColors.heimdallNotePillBg, defaults.colors.heimdallNotePillBg),
      heimdallNotePillText: readColorPair(rawColors.heimdallNotePillText, defaults.colors.heimdallNotePillText),
      heimdallNotePillBorder: readColorPair(rawColors.heimdallNotePillBorder, defaults.colors.heimdallNotePillBorder),
      messageRoles,
      heimdallNodes,
    },
  }
}

function pathExists(targetPath: string): Promise<boolean> {
  return fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false)
}

async function copyMissingTree(sourcePath: string, targetPath: string): Promise<void> {
  const sourceStats = await fs.stat(sourcePath)

  if (sourceStats.isDirectory()) {
    await fs.mkdir(targetPath, { recursive: true })
    const entries = await fs.readdir(sourcePath, { withFileTypes: true })
    for (const entry of entries) {
      await copyMissingTree(path.join(sourcePath, entry.name), path.join(targetPath, entry.name))
    }
    return
  }

  if (await pathExists(targetPath)) {
    return
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  await fs.copyFile(sourcePath, targetPath)
}

function getManagedThemesDirectory(): string {
  const envOverride = process.env.YGG_THEME_DIRECTORY?.trim()
  if (envOverride) {
    return path.resolve(envOverride)
  }

  try {
    return path.join(app.getPath('userData'), YGG_DIR_NAME, CUSTOM_THEMES_DIR_NAME)
  } catch {
    return path.resolve(process.cwd(), YGG_DIR_NAME, CUSTOM_THEMES_DIR_NAME)
  }
}

function getBundledThemesDirectory(): string {
  const envOverride = process.env.YGG_THEME_TEMPLATE_DIRECTORY?.trim()
  if (envOverride) {
    return path.resolve(envOverride)
  }

  try {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, YGG_DIR_NAME, CUSTOM_THEMES_DIR_NAME)
    }
    return path.join(app.getAppPath(), YGG_DIR_NAME, CUSTOM_THEMES_DIR_NAME)
  } catch {
    return path.resolve(process.cwd(), YGG_DIR_NAME, CUSTOM_THEMES_DIR_NAME)
  }
}

export async function ensureManagedThemesInitialized(): Promise<string> {
  const managedThemesDir = getManagedThemesDirectory()
  await fs.mkdir(managedThemesDir, { recursive: true })

  const bundledThemesDir = getBundledThemesDirectory()
  const normalizedManaged = path.resolve(managedThemesDir)
  const normalizedBundled = path.resolve(bundledThemesDir)

  if (normalizedManaged === normalizedBundled) {
    return managedThemesDir
  }

  if (!(await pathExists(bundledThemesDir))) {
    return managedThemesDir
  }

  await copyMissingTree(bundledThemesDir, managedThemesDir)
  return managedThemesDir
}

function normalizeThemeId(rawName: string): string {
  const baseName = rawName.trim().replace(/\.json$/i, '')
  const normalized = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (!normalized) {
    throw new Error('Theme name must contain at least one letter or number')
  }

  return normalized
}

function getThemeFileName(id: string): string {
  return `${id}${THEME_FILE_EXTENSION}`
}

async function listThemes(): Promise<ThemeManagerResult> {
  const directory = await ensureManagedThemesInitialized()
  const entries = await fs.readdir(directory)
  const themeFiles = entries.filter(entry => entry.toLowerCase().endsWith(THEME_FILE_EXTENSION))

  const themes = await Promise.all(
    themeFiles.map(async fileName => {
      const filePath = path.join(directory, fileName)
      const stats = await fs.stat(filePath)
      const rawContent = await fs.readFile(filePath, 'utf8')

      let displayName = fileName.slice(0, -THEME_FILE_EXTENSION.length)
      try {
        const parsed = JSON.parse(rawContent)
        const sanitizedTheme = sanitizeCustomTheme(parsed)
        displayName = sanitizedTheme.name || displayName
      } catch {
        // Keep file-derived display name if the JSON cannot be parsed.
      }

      return {
        id: fileName.slice(0, -THEME_FILE_EXTENSION.length),
        fileName,
        name: displayName,
        modifiedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
      }
    })
  )

  themes.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return {
    success: true,
    action: 'list',
    directory,
    themes: themes.slice(0, MAX_LIST_RESULTS).map(theme => ({
      id: theme.id,
      fileName: theme.fileName,
      name: theme.name,
      modifiedAt: theme.modifiedAt,
    })),
    totalCount: themes.length,
  }
}

async function readTheme(name: string): Promise<ThemeManagerResult> {
  const directory = await ensureManagedThemesInitialized()
  const id = normalizeThemeId(name)
  const fileName = getThemeFileName(id)
  const filePath = path.join(directory, fileName)

  try {
    const rawContent = await fs.readFile(filePath, 'utf8')
    const parsed = JSON.parse(rawContent)
    const theme = sanitizeCustomTheme(parsed)
    const stats = await fs.stat(filePath)
    return {
      success: true,
      action: 'read',
      directory,
      exists: true,
      id,
      fileName,
      modifiedAt: stats.mtime.toISOString(),
      theme,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: true,
        action: 'read',
        directory,
        exists: false,
        id,
        fileName,
      }
    }

    throw error
  }
}

async function saveTheme(name: string | undefined, themeValue: unknown): Promise<ThemeManagerResult> {
  if (!themeValue) {
    throw new Error('theme is required for save')
  }

  const sanitizedTheme = sanitizeCustomTheme(themeValue)
  const id = normalizeThemeId(name || sanitizedTheme.name)
  const fileName = getThemeFileName(id)
  const directory = await ensureManagedThemesInitialized()
  const filePath = path.join(directory, fileName)
  const created = !(await pathExists(filePath))

  const themeToSave: CustomChatTheme = {
    ...sanitizedTheme,
    name: sanitizedTheme.name || name || id,
  }

  await fs.writeFile(filePath, `${JSON.stringify(themeToSave, null, 2)}\n`, 'utf8')
  const stats = await fs.stat(filePath)

  return {
    success: true,
    action: 'save',
    directory,
    id,
    fileName,
    modifiedAt: stats.mtime.toISOString(),
    created,
    theme: themeToSave,
  }
}

async function deleteTheme(name: string): Promise<ThemeManagerResult> {
  const directory = await ensureManagedThemesInitialized()
  const id = normalizeThemeId(name)
  const fileName = getThemeFileName(id)
  const filePath = path.join(directory, fileName)

  try {
    await fs.unlink(filePath)
    return {
      success: true,
      action: 'delete',
      directory,
      id,
      fileName,
      deleted: true,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        success: true,
        action: 'delete',
        directory,
        id,
        fileName,
        deleted: false,
      }
    }

    throw error
  }
}

export async function execute(args: ThemeManagerArgs): Promise<ThemeManagerResult> {
  const { action, name, theme } = args

  switch (action) {
    case 'template': {
      const directory = await ensureManagedThemesInitialized()
      return {
        success: true,
        action: 'template',
        directory,
        theme: createDefaultCustomChatTheme(),
      }
    }
    case 'list':
      return await listThemes()
    case 'read':
      if (!name) throw new Error('name is required for read')
      return await readTheme(name)
    case 'save':
      return await saveTheme(name, theme)
    case 'delete':
      if (!name) throw new Error('name is required for delete')
      return await deleteTheme(name)
    default:
      throw new Error(`Unsupported theme_manager action: ${String(action)}`)
  }
}
