import { supabaseAdmin } from './supamodels'

const APP_STORE_BUCKET = 'updates'
const COMMUNITY_APP_STORE_ROOT = 'publicApps'

export type PublicAppInsert = {
  appId: string
  uploaderUserId: string | null
  description: Record<string, any>
  definition: Record<string, any>
  descriptionUrl: string
  zipUrl: string
  containsExecutables: boolean
}

export type PublicAppRow = {
  app_id: string
  description: Record<string, any>
  description_url: string
  zip_url: string
  contains_executables: boolean
  created_at: string | null
  updated_at: string | null
  uploader_user_id: string | null
  uploader?: { username?: string | null }
}

export async function listPublicApps(): Promise<PublicAppRow[]> {
  const { data, error } = await supabaseAdmin
    .from('public_apps')
    .select(
      'app_id, description, description_url, zip_url, contains_executables, created_at, updated_at, uploader_user_id, uploader:profiles(username)'
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message || 'Failed to load public apps')
  }

  return (data || []) as PublicAppRow[]
}

export async function uploadCommunityAppAssets(payload: {
  appId: string
  zipBuffer: Buffer
  description: Record<string, any>
  definition: Record<string, any>
}): Promise<{ zipUrl: string; descriptionUrl: string; uploadedPaths: string[] }> {
  const storage = supabaseAdmin.storage.from(APP_STORE_BUCKET)
  const basePath = `${COMMUNITY_APP_STORE_ROOT}/${payload.appId}`
  const zipName = `${payload.appId}.zip`
  const zipPath = `${basePath}/${zipName}`
  const descriptionPath = `${basePath}/description.json`
  const definitionPath = `${basePath}/definition.json`
  const uploadedPaths: string[] = []

  const { error: zipError } = await storage.upload(zipPath, payload.zipBuffer, {
    contentType: 'application/zip',
    upsert: false,
  })
  if (zipError) {
    throw new Error(zipError.message || 'Failed to upload zip')
  }
  uploadedPaths.push(zipPath)

  const { error: descError } = await storage.upload(descriptionPath, JSON.stringify(payload.description), {
    contentType: 'application/json',
    upsert: false,
  })
  if (descError) {
    await storage.remove(uploadedPaths)
    throw new Error(descError.message || 'Failed to upload description')
  }
  uploadedPaths.push(descriptionPath)

  const { error: defError } = await storage.upload(definitionPath, JSON.stringify(payload.definition), {
    contentType: 'application/json',
    upsert: false,
  })
  if (defError) {
    await storage.remove(uploadedPaths)
    throw new Error(defError.message || 'Failed to upload definition')
  }
  uploadedPaths.push(definitionPath)

  const zipUrl = storage.getPublicUrl(zipPath).data.publicUrl
  const descriptionUrl = storage.getPublicUrl(descriptionPath).data.publicUrl

  return { zipUrl, descriptionUrl, uploadedPaths }
}

export async function createPublicApp(payload: PublicAppInsert): Promise<PublicAppRow> {
  const { data, error } = await supabaseAdmin
    .from('public_apps')
    .insert({
      app_id: payload.appId,
      uploader_user_id: payload.uploaderUserId,
      description: payload.description,
      definition: payload.definition,
      description_url: payload.descriptionUrl,
      zip_url: payload.zipUrl,
      contains_executables: payload.containsExecutables,
    })
    .select(
      'app_id, description, description_url, zip_url, contains_executables, created_at, updated_at, uploader_user_id, uploader:profiles(username)'
    )
    .single()

  if (error) {
    throw new Error(error.message || 'Failed to create public app')
  }

  return data as PublicAppRow
}
