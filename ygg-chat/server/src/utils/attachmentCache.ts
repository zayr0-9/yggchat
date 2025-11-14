import { redisClient, ATTACHMENT_CACHE_MAX_BYTES, ATTACHMENT_CACHE_TTL_SECONDS } from '../config/redis'

export interface CachedAttachmentPayload {
  mimeType: string
  base64: string
  sizeBytes?: number
}

export const ATTACHMENT_CACHE_PREFIX = 'attachment:sha256:'

function getCacheKey(sha256?: string | null): string | null {
  if (!sha256) return null
  return `${ATTACHMENT_CACHE_PREFIX}${sha256}`
}

/**
 * Cache base64 data for an attachment. Fire-and-forget; failures are logged but do not block request flow.
 */
export function cacheAttachmentBase64(params: {
  sha256?: string | null
  mimeType?: string | null
  base64?: string | null
  sizeBytes?: number | null
  ttlSeconds?: number
}) {
  const key = getCacheKey(params.sha256)
  if (!key) return

  const mimeType = params.mimeType || 'application/octet-stream'
  const base64 = params.base64
  const sizeBytes = params.sizeBytes ?? null

  if (!base64 || base64.length === 0) return

  const maxBytes = ATTACHMENT_CACHE_MAX_BYTES > 0 ? ATTACHMENT_CACHE_MAX_BYTES : null
  if (maxBytes && sizeBytes && sizeBytes > maxBytes) {
    return
  }

  const ttl = params.ttlSeconds && params.ttlSeconds > 0 ? params.ttlSeconds : Math.max(ATTACHMENT_CACHE_TTL_SECONDS, 1)

  const payload: CachedAttachmentPayload = { mimeType, base64, sizeBytes: sizeBytes ?? undefined }

  try {
    void redisClient.set(key, JSON.stringify(payload), 'EX', ttl)
  } catch (error) {
    console.error('Failed to cache attachment base64:', error)
  }
}

export async function getCachedAttachmentBase64(sha256?: string | null): Promise<CachedAttachmentPayload | null> {
  const key = getCacheKey(sha256)
  if (!key) return null

  try {
    const cached = await redisClient.get(key)
    if (!cached) return null
    const parsed = JSON.parse(cached) as CachedAttachmentPayload
    if (!parsed?.base64) return null
    return parsed
  } catch (error) {
    console.error('Failed to read attachment base64 cache:', error)
    return null
  }
}
