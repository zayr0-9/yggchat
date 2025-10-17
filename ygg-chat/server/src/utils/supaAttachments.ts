// server/src/utils/supaAttachments.ts
import crypto from 'crypto'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AttachmentService } from '../database/supamodels'
import { supabase } from '../database/supamodels'

export type Base64AttachmentInput = {
  dataUrl: string
  name?: string
  type?: string
  size?: number
}

const STORAGE_BUCKET = 'attachments'

function extFromMimeOrName(mimeType: string, name?: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  const hinted = path.extname(name || '')
  return hinted || '.bin'
}

/**
 * Ensure the storage bucket exists, create if not
 */
async function ensureBucketExists(): Promise<void> {
  try {
    const { data: buckets } = await supabase.storage.listBuckets()
    const bucketExists = buckets?.some(b => b.name === STORAGE_BUCKET)

    if (!bucketExists) {
      const { error } = await supabase.storage.createBucket(STORAGE_BUCKET, {
        public: true, // Make bucket public so images can be accessed via URL
        fileSizeLimit: 10485760, // 10MB limit
        allowedMimeTypes: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
      })

      if (error) {
        console.error('Failed to create storage bucket:', error)
      }
    }
  } catch (error) {
    console.error('Error checking/creating bucket:', error)
  }
}

/**
 * Save base64-encoded image attachments to Supabase Storage and link to message
 * @param client - Authenticated Supabase client for RLS
 * @param messageId - The message ID to link attachments to
 * @param items - Array of base64 attachment inputs
 * @param ownerId - The owner/user ID for organizing files
 * @returns Array of created attachment records
 */
export async function saveBase64ImageAttachmentsForMessage(
  client: SupabaseClient,
  messageId: string,
  items: Base64AttachmentInput[],
  ownerId: string
): Promise<Awaited<ReturnType<typeof AttachmentService.getById>>[]> {
  const created: Awaited<ReturnType<typeof AttachmentService.getById>>[] = []
  if (!Array.isArray(items) || items.length === 0) return created

  // Ensure bucket exists before uploading
  await ensureBucketExists()

  for (const item of items) {
    try {
      // Parse data URL
      const match = /^data:(.*?);base64,(.*)$/.exec(item.dataUrl || '')
      if (!match) continue

      const mimeType = (item.type || match[1] || 'application/octet-stream') as string
      const base64 = match[2]
      const buffer = Buffer.from(base64, 'base64')
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      // Check if an attachment with this hash already exists (deduplication)
      const existing = await AttachmentService.findBySha256(client, sha256)
      if (existing) {
        const linked = await AttachmentService.linkToMessage(client, existing.id, messageId, ownerId)
        if (linked) created.push(linked)
        continue
      }

      // Generate unique filename
      const safeBase = (item.name || 'image').replace(/[^a-zA-Z0-9-_]/g, '_')
      const ext = extFromMimeOrName(mimeType, item.name)
      const timestamp = Date.now()
      const filename = `${ownerId}/${timestamp}_${safeBase}${ext}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filename, buffer, {
          contentType: mimeType,
          upsert: false,
          cacheControl: '3600',
        })

      if (uploadError) {
        console.error('Failed to upload to Supabase Storage:', uploadError)
        continue
      }

      // Get public URL for the uploaded file
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filename)

      const publicUrl = urlData?.publicUrl || null

      // Create attachment record in database
      const createdRow = await AttachmentService.create(client, ownerId, {
        messageId,
        kind: 'image',
        mimeType,
        storage: 'file',
        url: publicUrl,
        storagePath: uploadData.path,
        width: null,
        height: null,
        sizeBytes: buffer.length,
        sha256,
      })

      created.push(createdRow)
    } catch (e) {
      console.error('Error processing attachment:', e)
      // Skip invalid entry
      continue
    }
  }

  return created
}

/**
 * Delete a file from Supabase Storage
 * @param storagePath - The path in the storage bucket
 * @returns true if successful
 */
export async function deleteFileFromStorage(storagePath: string): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove([storagePath])

    if (error) {
      console.error('Failed to delete file from storage:', error)
      return false
    }

    return true
  } catch (error) {
    console.error('Error deleting file from storage:', error)
    return false
  }
}

/**
 * Delete multiple files from Supabase Storage
 * @param storagePaths - Array of paths in the storage bucket
 * @returns Number of successfully deleted files
 */
export async function deleteFilesFromStorage(storagePaths: string[]): Promise<number> {
  if (!storagePaths || storagePaths.length === 0) return 0

  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .remove(storagePaths)

    if (error) {
      console.error('Failed to delete files from storage:', error)
      return 0
    }

    return data?.length || 0
  } catch (error) {
    console.error('Error deleting files from storage:', error)
    return 0
  }
}

/**
 * Get a signed URL for temporary access to a private file
 * @param storagePath - The path in the storage bucket
 * @param expiresIn - Expiration time in seconds (default 3600 = 1 hour)
 * @returns Signed URL or null
 */
export async function getSignedUrl(storagePath: string, expiresIn: number = 3600): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(storagePath, expiresIn)

    if (error) {
      console.error('Failed to create signed URL:', error)
      return null
    }

    return data?.signedUrl || null
  } catch (error) {
    console.error('Error creating signed URL:', error)
    return null
  }
}

/**
 * Upload a file buffer directly to Supabase Storage
 * @param buffer - File buffer
 * @param filename - Destination filename
 * @param mimeType - MIME type of the file
 * @param ownerId - Owner/user ID for organizing files
 * @returns Storage path and public URL
 */
export async function uploadFileToStorage(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  ownerId: string
): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    await ensureBucketExists()

    const safeFilename = filename.replace(/[^a-zA-Z0-9-_.]/g, '_')
    const timestamp = Date.now()
    const storagePath = `${ownerId}/${timestamp}_${safeFilename}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
        cacheControl: '3600',
      })

    if (uploadError) {
      console.error('Failed to upload file:', uploadError)
      return null
    }

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(uploadData.path)

    return {
      storagePath: uploadData.path,
      publicUrl: urlData?.publicUrl || '',
    }
  } catch (error) {
    console.error('Error uploading file:', error)
    return null
  }
}

/**
 * Download a file from Supabase Storage
 * @param storagePath - The path in the storage bucket
 * @returns File buffer or null
 */
export async function downloadFileFromStorage(storagePath: string): Promise<Buffer | null> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(storagePath)

    if (error) {
      console.error('Failed to download file:', error)
      return null
    }

    const arrayBuffer = await data.arrayBuffer()
    return Buffer.from(arrayBuffer)
  } catch (error) {
    console.error('Error downloading file:', error)
    return null
  }
}

/**
 * List files in a user's directory
 * @param ownerId - Owner/user ID
 * @returns Array of file metadata
 */
export async function listUserFiles(ownerId: string): Promise<any[]> {
  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(ownerId, {
        limit: 100,
        offset: 0,
        sortBy: { column: 'created_at', order: 'desc' }
      })

    if (error) {
      console.error('Failed to list files:', error)
      return []
    }

    return data || []
  } catch (error) {
    console.error('Error listing files:', error)
    return []
  }
}
