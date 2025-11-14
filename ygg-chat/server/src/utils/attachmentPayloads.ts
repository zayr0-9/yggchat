export type InlineBase64Attachment = {
  mimeType: string
  base64: string
}

export type ProviderAttachmentPayload = {
  url?: string
  mimeType?: string
  filePath?: string
  sha256?: string
  base64Data?: string
}

export const DATA_URL_REGEX = /^data:(.*?);base64,(.*)$/

export function parseInlineBase64Attachments(
  items?: Array<{ dataUrl?: string; type?: string } | null> | null
): Array<InlineBase64Attachment | null> {
  if (!Array.isArray(items)) return []
  return items.map(item => {
    if (!item?.dataUrl) return null
    return decodeDataUrl(item.dataUrl, item.type)
  })
}

export function decodeDataUrl(value: string, fallbackMimeType?: string): InlineBase64Attachment | null {
  if (!value) return null
  const match = DATA_URL_REGEX.exec(value)
  if (!match) {
    return {
      mimeType: fallbackMimeType || 'application/octet-stream',
      base64: value,
    }
  }
  const mimeType = fallbackMimeType || match[1] || 'application/octet-stream'
  const base64 = match[2]
  if (!base64) return null
  return { mimeType, base64 }
}
