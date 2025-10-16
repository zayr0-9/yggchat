// server/src/utils/fileMentionProcessor.ts

export interface SelectedFileContent {
  path: string
  relativePath: string
  name?: string
  contents: string
  contentLength: number
  requestId?: number
}

/**
 * Replaces file mentions (e.g., @filename) in a message with the actual file content
 * @param message - The message containing file mentions
 * @param selectedFiles - Array of file content objects
 * @returns The message with file mentions replaced by their content
 */
export function replaceFileMentionsWithContent(
  message: string,
  selectedFiles: SelectedFileContent[]
): string {
  if (!message || typeof message !== 'string') return message || ''
  if (!selectedFiles || selectedFiles.length === 0) return message

  // Build a lookup map of mentionable names -> contents
  const nameToContent = new Map<string, string>()
  
  const basename = (p: string) => {
    if (!p) return p
    const parts = p.split(/\\\\|\//) // split on both \\ and /
    return parts[parts.length - 1]
  }

  for (const f of selectedFiles) {
    if (f.name && !nameToContent.has(f.name)) {
      nameToContent.set(f.name, f.contents)
    }
    const baseRel = basename(f.relativePath)
    if (baseRel && !nameToContent.has(baseRel)) {
      nameToContent.set(baseRel, f.contents)
    }
    const basePath = basename(f.path)
    if (basePath && !nameToContent.has(basePath)) {
      nameToContent.set(basePath, f.contents)
    }
  }

  // Replace tokens like @filename with the corresponding contents
  // Allow letters, numbers, underscore, dot, dash, and path separators in the token
  const mentionRegex = /@([A-Za-z0-9._\/-]+)/g
  return message.replace(mentionRegex, (full: string, mName: string) => {
    const content = nameToContent.get(mName)
    return content != null ? content : full
  })
}
