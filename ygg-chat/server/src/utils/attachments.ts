// server/src/utils/attachments.ts
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { AttachmentService } from '../database/models'
import { MessageId } from '../../../shared/types'

export type Base64AttachmentInput = {
  dataUrl: string
  name?: string
  type?: string
  size?: number
}

// Ensure uploads directory path consistent with server static path in index.ts
// index.ts serves: app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')))
// Here __dirname is server/src/utils, so rootSrcDir = path.resolve(__dirname, '..')
function getUploadsDir(): string {
  const rootSrcDir = path.resolve(__dirname, '..')
  return path.join(rootSrcDir, 'data', 'uploads')
}

function ensureUploadsDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function extFromMimeOrName(mimeType: string, name?: string): string {
  if (mimeType === 'image/png') return '.png'
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return '.jpg'
  if (mimeType === 'image/webp') return '.webp'
  if (mimeType === 'image/gif') return '.gif'
  const hinted = path.extname(name || '')
  return hinted || '.bin'
}

export function saveBase64ImageAttachmentsForMessage(messageId: MessageId, items: Base64AttachmentInput[]) {
  const created: ReturnType<typeof AttachmentService.getById>[] = []
  if (!Array.isArray(items) || items.length === 0) return created

  const uploadsDirAbs = getUploadsDir()
  ensureUploadsDir(uploadsDirAbs)
  const rootSrcDir = path.resolve(__dirname, '..')

  for (const item of items) {
    try {
      const match = /^data:(.*?);base64,(.*)$/.exec(item.dataUrl || '')
      if (!match) continue
      const mimeType = (item.type || match[1] || 'application/octet-stream') as string
      const base64 = match[2]
      const buffer = Buffer.from(base64, 'base64')
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
      // If an attachment with this hash already exists, just link it to this message and skip writing a new file
      const existing = AttachmentService.findBySha256(sha256)
      if (existing) {
        const linked = AttachmentService.linkToMessage(existing.id, messageId)
        if (linked) created.push(linked)
        continue
      }
      const safeBase = (item.name || 'image').replace(/[^a-zA-Z0-9-_]/g, '_')
      const ext = extFromMimeOrName(mimeType, item.name)
      const filename = `${Date.now()}_${safeBase}${ext}`
      const absolutePath = path.join(uploadsDirAbs, filename)

      fs.writeFileSync(absolutePath, buffer)

      // filePath relative to server/src (so it looks like 'data/uploads/filename')
      const filePathRel = path.relative(rootSrcDir, absolutePath)
      const createdRow = AttachmentService.create({
        messageId,
        kind: 'image',
        mimeType,
        storage: 'file',
        url: `/uploads/${filename}`,
        filePath: filePathRel,
        width: null,
        height: null,
        sizeBytes: buffer.length,
        sha256,
      })
      created.push(createdRow)
    } catch (e) {
      // Skip invalid entry silently
      continue
    }
  }

  return created
}
