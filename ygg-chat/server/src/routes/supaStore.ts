import AdmZip from 'adm-zip'
import express from 'express'
import path from 'path'
import { createPublicApp, listPublicApps, uploadCommunityAppAssets } from '../database/supaAppModels'
import { verifyAuth } from '../middleware/supaAuth'
import { asyncHandler } from '../utils/asyncHandler'

const router = express.Router()

const EXECUTABLE_EXTENSIONS = new Set(['.exe', '.bat', '.sh'])
const MAX_UPLOAD_ENTRIES = 500
const MAX_UPLOAD_UNPACKED_BYTES = 500 * 1024 * 1024

function sanitizeZipEntryName(entryName: string): string {
  return entryName.replace(/\\/g, '/').replace(/^\/+/, '')
}

function detectZipStripPrefix(entries: { entryName: string }[]): string | null {
  const normalized = entries.map(entry => sanitizeZipEntryName(entry.entryName)).filter(Boolean)
  if (normalized.length === 0) return null
  const prefix = 'custom-tools/'
  if (normalized.every(name => name.startsWith(prefix))) {
    return prefix
  }
  return null
}

function isValidToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name)
}

function validateToolDefinition(definition: any): string | null {
  if (!definition || typeof definition !== 'object') return 'definition.json must be an object.'
  if (typeof definition.name !== 'string' || !isValidToolName(definition.name)) {
    return 'definition.json must include a valid "name" (lowercase letters, numbers, underscores).'
  }
  if (typeof definition.description !== 'string' || definition.description.trim().length === 0) {
    return 'definition.json must include a non-empty "description".'
  }
  if (!definition.inputSchema || typeof definition.inputSchema !== 'object') {
    return 'definition.json must include an "inputSchema" object.'
  }
  if (definition.inputSchema.type !== 'object') {
    return 'definition.json "inputSchema.type" must be "object".'
  }
  if (!definition.inputSchema.properties || typeof definition.inputSchema.properties !== 'object') {
    return 'definition.json "inputSchema.properties" must be an object.'
  }
  if (definition.enabled !== undefined && typeof definition.enabled !== 'boolean') {
    return 'definition.json "enabled" must be a boolean if provided.'
  }
  return null
}

function validateDescription(description: any): string | null {
  if (!description || typeof description !== 'object') return 'description.json must be an object.'
  const title = typeof description.title === 'string' ? description.title.trim() : ''
  const name = typeof description.name === 'string' ? description.name.trim() : ''
  if (!title && !name) {
    return 'description.json must include a "title" or "name".'
  }
  if (description.gitLink !== undefined) {
    if (typeof description.gitLink !== 'string' || !description.gitLink.trim()) {
      return 'description.json "gitLink" must be a non-empty string when provided.'
    }
    try {
      const url = new URL(description.gitLink)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'description.json "gitLink" must be an http(s) URL.'
      }
    } catch {
      return 'description.json "gitLink" must be a valid URL.'
    }
  }
  return null
}

function parseCommunityZip(zipBuffer: Buffer): {
  appId: string
  description: Record<string, any>
  definition: Record<string, any>
  containsExecutables: boolean
  warnings: string[]
} {
  const zip = new AdmZip(zipBuffer)
  const entries = zip.getEntries()

  if (!entries || entries.length === 0) {
    throw new Error('Zip file is empty.')
  }

  if (entries.length > MAX_UPLOAD_ENTRIES) {
    throw new Error('Zip file contains too many entries.')
  }

  const stripPrefix = detectZipStripPrefix(entries)
  const topLevel = new Set<string>()
  let totalUnpacked = 0
  let containsExecutables = false
  let hasRootFile = false
  const normalizedEntries: Array<{ entry: any; name: string }> = []

  for (const entry of entries) {
    let entryName = sanitizeZipEntryName(entry.entryName)
    if (stripPrefix && entryName.startsWith(stripPrefix)) {
      entryName = entryName.slice(stripPrefix.length)
    }
    if (!entryName) continue
    const lowerName = entryName.toLowerCase()
    if (lowerName.startsWith('__macosx/')) {
      continue
    }
    if (lowerName.endsWith('.ds_store') || lowerName.endsWith('thumbs.db')) {
      continue
    }
    if (entryName.split('/').some(part => part === '..')) {
      throw new Error('Zip contains invalid path traversal entries.')
    }

    const isDirectory = entry.isDirectory || entryName.endsWith('/')
    if (!entryName.includes('/') && !isDirectory) {
      hasRootFile = true
    }

    const parts = entryName.split('/')
    if (parts[0]) topLevel.add(parts[0])

    if (!isDirectory) {
      totalUnpacked += entry.header.size
      const ext = path.extname(entryName).toLowerCase()
      if (EXECUTABLE_EXTENSIONS.has(ext)) {
        containsExecutables = true
      }
    }

    normalizedEntries.push({ entry, name: entryName })
  }

  if (totalUnpacked > MAX_UPLOAD_UNPACKED_BYTES) {
    throw new Error('Zip file is too large when extracted.')
  }

  if (topLevel.size !== 1 || hasRootFile) {
    throw new Error('Zip must contain a single top-level folder that holds your tool files.')
  }

  const toolDir = Array.from(topLevel)[0]
  if (!toolDir || toolDir === '.' || toolDir === '..') {
    throw new Error('Invalid tool directory name in zip.')
  }

  const definitionPath = `${toolDir}/definition.json`
  const descriptionPath = `${toolDir}/description.json`
  const indexPath = `${toolDir}/index.js`

  const definitionEntry = normalizedEntries.find(item => item.name === definitionPath)
  const descriptionEntry = normalizedEntries.find(item => item.name === descriptionPath)
  const indexEntry = normalizedEntries.find(item => item.name === indexPath)

  if (!definitionEntry || !descriptionEntry) {
    throw new Error('Zip must include definition.json and description.json in the tool folder root.')
  }

  if (!indexEntry) {
    throw new Error('Zip must include index.js in the tool folder root.')
  }

  const extraDefinition = normalizedEntries.find(
    item => item.name.endsWith('/definition.json') && item.name !== definitionPath
  )
  if (extraDefinition) {
    throw new Error('Zip must include only one definition.json file.')
  }

  const extraDescription = normalizedEntries.find(
    item => item.name.endsWith('/description.json') && item.name !== descriptionPath
  )
  if (extraDescription) {
    throw new Error('Zip must include only one description.json file.')
  }

  let definitionJson: any
  let descriptionJson: any

  try {
    definitionJson = JSON.parse(definitionEntry.entry.getData().toString('utf-8'))
  } catch {
    throw new Error('definition.json must be valid JSON.')
  }

  try {
    descriptionJson = JSON.parse(descriptionEntry.entry.getData().toString('utf-8'))
  } catch {
    throw new Error('description.json must be valid JSON.')
  }

  const definitionError = validateToolDefinition(definitionJson)
  if (definitionError) {
    throw new Error(definitionError)
  }

  const descriptionError = validateDescription(descriptionJson)
  if (descriptionError) {
    throw new Error(descriptionError)
  }

  const warnings: string[] = []
  if (definitionJson.name !== toolDir && definitionJson.name !== toolDir.replace(/-/g, '_')) {
    warnings.push('Tool folder name does not match definition.json name.')
  }

  return {
    appId: definitionJson.name,
    description: descriptionJson,
    definition: definitionJson,
    containsExecutables,
    warnings,
  }
}

// GET /api/app-store/community - list community apps
router.get(
  '/app-store/community',
  asyncHandler(async (_req, res) => {
    const apps = await listPublicApps()
    res.json({ success: true, apps })
  })
)

// POST /api/app-store/community/upload - upload community app zip (server-side)
router.post(
  '/app-store/community/upload',
  express.raw({ type: 'application/zip', limit: '500mb' }),
  asyncHandler(async (req, res) => {
    if (!req.body || (req.body as Buffer).length === 0) {
      res.status(400).json({ success: false, error: 'Zip payload is required.' })
      return
    }

    const zipBuffer = req.body instanceof Buffer ? req.body : Buffer.from(req.body)

    let parsed
    try {
      parsed = parseCommunityZip(zipBuffer)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      res.status(400).json({ success: false, error: msg })
      return
    }

    const { appId, description, definition, containsExecutables } = parsed

    const { userId } = await verifyAuth(req)

    const { zipUrl, descriptionUrl } = await uploadCommunityAppAssets({
      appId,
      zipBuffer,
      description,
      definition,
    })

    const created = await createPublicApp({
      appId,
      uploaderUserId: userId,
      description,
      definition,
      descriptionUrl,
      zipUrl,
      containsExecutables,
    })

    res.json({ success: true, app: created })
  })
)

export default router
