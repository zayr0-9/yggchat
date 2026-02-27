import { clearActiveLocalFontBlob, getActiveLocalFontBlob, storeActiveLocalFontBlob } from './fontSettingsDb'

const STORAGE_KEY = 'ygg_font_settings'
const GOOGLE_FONT_LINK_ELEMENT_ID = 'ygg-google-font-link'
const LOCAL_FONT_FAMILY_NAME = 'YggLocalFont'

export const FONT_SETTINGS_STORAGE_KEY = STORAGE_KEY
export const FONT_SETTINGS_CHANGE_EVENT = 'ygg-font-settings-change'
export const DEFAULT_APP_FONT_STACK = "'DM Sans', Inter, system-ui, sans-serif"
export const MAX_FONT_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 // 5MB

export type AppFontSource = 'default' | 'google' | 'local'

export interface AppFontSettings {
  source: AppFontSource
  googleFontUrl: string | null
  googleFontFamily: string | null
}

export interface GoogleFontValidationResult {
  valid: boolean
  normalizedUrl?: string
  family?: string
  error?: string
}

const DEFAULT_SETTINGS: AppFontSettings = {
  source: 'default',
  googleFontUrl: null,
  googleFontFamily: null,
}

const GOOGLE_FONT_CSS_PATHS = new Set(['/css', '/css2'])

const sanitizeFontFamily = (family: string): string => family.replace(/["']/g, '').trim()

const toFontStack = (family: string): string => {
  const cleaned = sanitizeFontFamily(family)
  if (!cleaned) return DEFAULT_APP_FONT_STACK
  return `'${cleaned}', Inter, system-ui, sans-serif`
}

const removeGoogleFontLink = () => {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(GOOGLE_FONT_LINK_ELEMENT_ID)
  if (existing?.parentElement) {
    existing.parentElement.removeChild(existing)
  }
}

const ensureGoogleFontLink = (href: string) => {
  if (typeof document === 'undefined') return

  let link = document.getElementById(GOOGLE_FONT_LINK_ELEMENT_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = GOOGLE_FONT_LINK_ELEMENT_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }

  if (link.href !== href) {
    link.href = href
  }
}

const setFontStack = (stack: string) => {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--font-sans', stack)
}

const normalizeSettings = (settings: Partial<AppFontSettings> | null | undefined): AppFontSettings => {
  const source: AppFontSource =
    settings?.source === 'google' || settings?.source === 'local' || settings?.source === 'default'
      ? settings.source
      : 'default'

  return {
    source,
    googleFontUrl: typeof settings?.googleFontUrl === 'string' && settings.googleFontUrl.trim() ? settings.googleFontUrl : null,
    googleFontFamily:
      typeof settings?.googleFontFamily === 'string' && settings.googleFontFamily.trim() ? settings.googleFontFamily : null,
  }
}

export function validateGoogleFontUrl(rawUrl: string): GoogleFontValidationResult {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return { valid: false, error: 'Google Font URL is required.' }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { valid: false, error: 'Invalid URL format.' }
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: 'Google Font URL must use HTTPS.' }
  }

  if (parsed.hostname !== 'fonts.googleapis.com') {
    return { valid: false, error: 'Only fonts.googleapis.com links are allowed.' }
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '') || '/'
  if (!GOOGLE_FONT_CSS_PATHS.has(normalizedPath)) {
    return { valid: false, error: 'Google Font URL must point to /css or /css2.' }
  }

  const families = parsed.searchParams.getAll('family').filter(Boolean)
  if (families.length === 0) {
    return { valid: false, error: 'Google Font URL must include at least one family= parameter.' }
  }

  const extractedFamily = decodeURIComponent(families[0]).split(':')[0].replace(/\+/g, ' ').trim()
  if (!extractedFamily || !/^[A-Za-z0-9 -]+$/.test(extractedFamily)) {
    return { valid: false, error: 'Could not extract a valid font family name from the URL.' }
  }

  return {
    valid: true,
    normalizedUrl: parsed.toString(),
    family: extractedFamily,
  }
}

export function loadAppFontSettings(): AppFontSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (!stored) return DEFAULT_SETTINGS

    const parsed = JSON.parse(stored) as Partial<AppFontSettings>
    return normalizeSettings(parsed)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveAppFontSettings(settings: AppFontSettings): AppFontSettings {
  const normalized = normalizeSettings(settings)

  if (typeof window === 'undefined') {
    return normalized
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    window.dispatchEvent(new CustomEvent<AppFontSettings>(FONT_SETTINGS_CHANGE_EVENT, { detail: normalized }))
  } catch (error) {
    console.error('Failed to persist font settings', error)
  }

  return normalized
}

export async function saveUploadedLocalFont(file: File): Promise<void> {
  await storeActiveLocalFontBlob(file)
}

export async function hasStoredLocalFont(): Promise<boolean> {
  const blob = await getActiveLocalFontBlob()
  return Boolean(blob)
}

export async function clearStoredLocalFont(): Promise<void> {
  await clearActiveLocalFontBlob()
}

export function isSupportedLocalFontFile(file: File): boolean {
  return /\.(woff2|ttf|otf)$/i.test(file.name)
}

const applyDefaultFont = () => {
  removeGoogleFontLink()
  setFontStack(DEFAULT_APP_FONT_STACK)
}

const applyGoogleFont = (settings: AppFontSettings) => {
  if (!settings.googleFontUrl || !settings.googleFontFamily) {
    applyDefaultFont()
    return
  }

  ensureGoogleFontLink(settings.googleFontUrl)
  setFontStack(toFontStack(settings.googleFontFamily))
}

const applyLocalFont = async () => {
  removeGoogleFontLink()

  const blob = await getActiveLocalFontBlob()
  if (!blob) {
    applyDefaultFont()
    return
  }

  const objectUrl = URL.createObjectURL(blob)

  try {
    const face = new FontFace(LOCAL_FONT_FAMILY_NAME, `url(${objectUrl})`)
    await face.load()
    document.fonts.add(face)
    setFontStack(toFontStack(LOCAL_FONT_FAMILY_NAME))
  } catch (error) {
    console.error('Failed to apply local font', error)
    applyDefaultFont()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function applyAppFontSettings(settings: AppFontSettings = loadAppFontSettings()): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return
  }

  if (settings.source === 'google') {
    applyGoogleFont(settings)
    return
  }

  if (settings.source === 'local') {
    await applyLocalFont()
    return
  }

  applyDefaultFont()
}
