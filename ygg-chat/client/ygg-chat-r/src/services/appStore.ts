import { supabase } from '../lib/supabase'
import { environment, localApi } from '../utils/api'

const APP_STORE_BUCKET = 'updates'
const APP_STORE_ROOT = 'apps'

export interface AppStoreDescription {
  name?: string
  title?: string
  description?: string
  shortDescription?: string
  publisher?: string
  version?: string
  size?: number | string
  tags?: string[]
  category?: string
  icon?: string
  iconUrl?: string
  zip?: string
  zipFile?: string
  archive?: string
  bundle?: string
  file?: string
  download?: string
}

export interface AppStoreApp {
  id: string
  name: string
  description: AppStoreDescription
  descriptionUrl: string | null
  zipName: string | null
  zipUrl: string | null
  updatedAt: string | null
}

export interface AppStoreInstallResult {
  success: boolean
  message?: string
  error?: string
  restartRequired?: boolean
  toolCount?: number
  extracted?: number
  skipped?: number
}

export interface AppStoreUninstallResult {
  success: boolean
  message?: string
  error?: string
  restartRequired?: boolean
  toolCount?: number
}

export interface CustomToolDefinition {
  name: string
  version?: string
  description?: string
  sourcePath?: string
}

export type AppStoreManifestEntry =
  | string
  | (AppStoreDescription & {
      id: string
      descriptionUrl?: string
      zipUrl?: string
      updatedAt?: string
    })

export interface AppStoreManifest {
  apps: AppStoreManifestEntry[]
}

const isAbsoluteUrl = (value: string) => /^https?:\/\//i.test(value)

const resolveZipHint = (description?: AppStoreDescription | null): string | null => {
  if (!description) return null
  return (
    description.zip ||
    description.zipFile ||
    description.archive ||
    description.bundle ||
    description.file ||
    description.download ||
    null
  )
}

const parseManifest = (data: unknown): AppStoreManifestEntry[] | null => {
  if (Array.isArray(data)) return data as AppStoreManifestEntry[]
  if (data && typeof data === 'object' && Array.isArray((data as AppStoreManifest).apps)) {
    return (data as AppStoreManifest).apps
  }
  return null
}

export async function fetchAppStoreApps(): Promise<AppStoreApp[]> {
  if (!supabase) {
    throw new Error('Supabase client not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
  }

  const storage = supabase.storage.from(APP_STORE_BUCKET)
  const manifestPath = `${APP_STORE_ROOT}/manifest.json`
  const manifestUrl = storage.getPublicUrl(manifestPath).data.publicUrl
  let manifestEntries: AppStoreManifestEntry[] | null = null

  try {
    const response = await fetch(manifestUrl, { cache: 'no-store' })
    if (response.ok) {
      manifestEntries = parseManifest(await response.json())
    }
  } catch {
    // Ignore manifest fetch errors; handled below
  }

  if (!manifestEntries || manifestEntries.length === 0) {
    throw new Error('App store manifest is missing or empty.')
  }

  const apps = await Promise.all(
    manifestEntries.map(async entry => {
      const isStringEntry = typeof entry === 'string'
      const appId = isStringEntry ? entry : entry.id
      if (!appId) {
        throw new Error('Manifest entry is missing an id.')
      }

      let manifestDescriptionUrl: string | undefined
      let manifestZipUrl: string | undefined
      let manifestUpdatedAt: string | undefined
      let description: AppStoreDescription = { name: appId }

      if (!isStringEntry) {
        const entryObject = entry as AppStoreDescription & AppStoreManifestEntry
        const { descriptionUrl, zipUrl, updatedAt, ...rest } = entryObject
        if ('id' in rest) {
          delete (rest as Record<string, unknown>).id
        }
        manifestDescriptionUrl = descriptionUrl
        manifestZipUrl = zipUrl
        manifestUpdatedAt = updatedAt
        description = { ...description, ...rest }
      }

      const descriptionPath = `${APP_STORE_ROOT}/${appId}/description.json`
      const descriptionUrl = manifestDescriptionUrl || storage.getPublicUrl(descriptionPath).data.publicUrl
      if (descriptionUrl) {
        try {
          const response = await fetch(descriptionUrl, { cache: 'no-store' })
          if (response.ok) {
            description = { ...description, ...(await response.json()) }
          }
        } catch {
          // Keep fallback description if fetch fails
        }
      }

      const zipHint = resolveZipHint(description)
      let zipName: string | null = null
      let zipUrl: string | null = null

      if (manifestZipUrl) {
        if (isAbsoluteUrl(manifestZipUrl)) {
          zipUrl = manifestZipUrl
        } else {
          zipName = manifestZipUrl
        }
      } else if (zipHint) {
        if (isAbsoluteUrl(zipHint)) {
          zipUrl = zipHint
        } else {
          zipName = zipHint
        }
      } else {
        zipName = `${appId}.zip`
      }

      if (!zipUrl && zipName) {
        const zipPath = `${APP_STORE_ROOT}/${appId}/${zipName}`
        zipUrl = storage.getPublicUrl(zipPath).data.publicUrl
      }

      const displayName = description.title || description.name || appId

      return {
        id: appId,
        name: displayName,
        description,
        descriptionUrl,
        zipName,
        zipUrl,
        updatedAt: manifestUpdatedAt || null,
      } as AppStoreApp
    })
  )

  return apps
}

export async function installAppFromStore(payload: {
  appId: string
  appName?: string
  zipUrl?: string | null
}): Promise<AppStoreInstallResult> {
  if (environment !== 'electron') {
    throw new Error('App installs are only available in the desktop app.')
  }

  if (!payload.zipUrl) {
    throw new Error('No download URL available for this app.')
  }

  return await localApi.post<AppStoreInstallResult>('/app-store/install', payload)
}

export async function uninstallAppFromStore(payload: { appId: string }): Promise<AppStoreUninstallResult> {
  if (environment !== 'electron') {
    throw new Error('App uninstalls are only available in the desktop app.')
  }

  return await localApi.post<AppStoreUninstallResult>('/app-store/uninstall', payload)
}

export async function fetchInstalledCustomTools(): Promise<CustomToolDefinition[]> {
  if (environment !== 'electron') {
    return []
  }

  const response = await localApi.get<{ success: boolean; tools?: CustomToolDefinition[] }>('/custom-tools')
  return response.tools ?? []
}

export async function restartDesktopApp(): Promise<{ success: boolean; error?: string }> {
  if (environment !== 'electron') {
    return { success: false, error: 'Restart is only available in the desktop app.' }
  }

  return await localApi.post('/app/restart')
}
