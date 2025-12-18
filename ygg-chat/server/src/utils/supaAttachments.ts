// server/src/utils/supaAttachments.ts
import crypto from 'crypto'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AttachmentService } from '../database/supamodels'
import { supabase } from '../database/supamodels'
import { cacheAttachmentBase64 } from './attachmentCache'

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

      cacheAttachmentBase64({ sha256, mimeType, base64, sizeBytes: buffer.length })

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

/**
 * Content block types that may contain images
 */
export type ImageContentBlock = {
  type: 'image'
  url: string
  mimeType?: string
}

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | ImageContentBlock

/**
 * Process AI-generated images in content_blocks and save them to Supabase Storage
 * This ensures generated images are persisted in our own storage rather than relying on external URLs
 *
 * @param client - Authenticated Supabase client for RLS
 * @param contentBlocks - Array of content blocks from AI response
 * @param messageId - The assistant message ID to link attachments to
 * @param ownerId - The owner/user ID for organizing files
 * @returns Updated content_blocks array with bucket URLs replacing external/data URLs
 */
export async function saveGeneratedImagesToStorage(
  client: SupabaseClient,
  contentBlocks: ContentBlock[],
  messageId: string,
  ownerId: string
): Promise<ContentBlock[]> {
  if (!Array.isArray(contentBlocks) || contentBlocks.length === 0) {
    return contentBlocks
  }

  // Ensure bucket exists before processing
  await ensureBucketExists()

  const updatedBlocks: ContentBlock[] = []

  for (const block of contentBlocks) {
    // Only process image blocks
    if (block.type !== 'image' || !('url' in block)) {
      updatedBlocks.push(block)
      continue
    }

    const imageBlock = block as ImageContentBlock
    const imageUrl = imageBlock.url

    // Skip if no URL or already a Supabase URL
    if (!imageUrl) {
      updatedBlocks.push(block)
      continue
    }

    // Check if already stored in our bucket (avoid re-processing)
    if (imageUrl.includes(STORAGE_BUCKET) && imageUrl.includes('supabase')) {
      updatedBlocks.push(block)
      continue
    }

    try {
      let buffer: Buffer | null = null
      let mimeType = imageBlock.mimeType || 'image/png'

      // Handle data URLs (base64 encoded)
      if (imageUrl.startsWith('data:')) {
        const match = /^data:(.*?);base64,(.*)$/.exec(imageUrl)
        if (match) {
          mimeType = match[1] || mimeType
          const base64 = match[2]
          buffer = Buffer.from(base64, 'base64')
        }
      }
      // Handle external URLs (http/https)
      else if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
        try {
          const response = await fetch(imageUrl, {
            signal: AbortSignal.timeout(30000), // 30 second timeout
          })

          if (response.ok) {
            const contentType = response.headers.get('content-type')
            if (contentType && contentType.startsWith('image/')) {
              mimeType = contentType.split(';')[0] // Remove charset if present
            }
            const arrayBuffer = await response.arrayBuffer()
            buffer = Buffer.from(arrayBuffer)
          } else {
            console.warn(`[saveGeneratedImages] Failed to fetch image: ${response.status} ${imageUrl.substring(0, 100)}`)
          }
        } catch (fetchError) {
          console.warn(`[saveGeneratedImages] Error fetching image: ${fetchError}`)
        }
      }

      // If we couldn't get the image data, keep the original block
      if (!buffer) {
        console.warn(`[saveGeneratedImages] Could not extract image data, keeping original URL`)
        updatedBlocks.push(block)
        continue
      }

      // Calculate SHA256 for deduplication
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

      // Check for existing attachment with same hash
      const existing = await AttachmentService.findBySha256(client, sha256)
      if (existing && existing.url) {
        console.log(`[saveGeneratedImages] Found existing image with same hash, reusing URL`)
        // Link to this message
        await AttachmentService.linkToMessage(client, existing.id, messageId, ownerId)
        updatedBlocks.push({
          type: 'image',
          url: existing.url,
          mimeType: mimeType,
        })
        continue
      }

      // Cache the base64 for future use
      const base64ForCache = buffer.toString('base64')
      cacheAttachmentBase64({ sha256, mimeType, base64: base64ForCache, sizeBytes: buffer.length })

      // Generate unique filename
      const ext = extFromMimeOrName(mimeType, undefined)
      const timestamp = Date.now()
      const filename = `${ownerId}/${timestamp}_generated${ext}`

      // Upload to Supabase Storage
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filename, buffer, {
          contentType: mimeType,
          upsert: false,
          cacheControl: '3600',
        })

      if (uploadError) {
        console.error('[saveGeneratedImages] Failed to upload:', uploadError)
        updatedBlocks.push(block) // Keep original on failure
        continue
      }

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filename)

      const publicUrl = urlData?.publicUrl || null

      if (!publicUrl) {
        console.error('[saveGeneratedImages] Failed to get public URL')
        updatedBlocks.push(block)
        continue
      }

      // Create attachment record
      await AttachmentService.create(client, ownerId, {
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

      console.log(`[saveGeneratedImages] Saved generated image to bucket: ${filename}`)

      // Update the block with the new URL
      updatedBlocks.push({
        type: 'image',
        url: publicUrl,
        mimeType: mimeType,
      })
    } catch (error) {
      console.error('[saveGeneratedImages] Error processing image block:', error)
      updatedBlocks.push(block) // Keep original on error
    }
  }

  return updatedBlocks
}
