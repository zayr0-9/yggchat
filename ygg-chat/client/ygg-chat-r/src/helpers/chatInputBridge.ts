export const CHAT_INSERT_FILE_PATH_EVENT = 'ygg-chat-insert-file-path'

export type ChatInsertFilePathDetail = {
  path: string
}

export function dispatchChatInsertFilePath(path: string): void {
  if (typeof window === 'undefined') return

  const normalizedPath = typeof path === 'string' ? path.trim() : ''
  if (!normalizedPath) return

  window.dispatchEvent(
    new CustomEvent<ChatInsertFilePathDetail>(CHAT_INSERT_FILE_PATH_EVENT, {
      detail: { path: normalizedPath },
    })
  )
}
