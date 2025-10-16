import { db } from '../../../database/db'
import { MessageService } from '../../../database/models'

export interface SearchHistoryParams {
  query: string
  userId?: string | null
  projectId?: string | null
  conversationId?: string | null
  limit?: number
}

function sanitizeFTSQuery(query: string): string {
  // Simple sanitizer similar to models.ts: escape double-quotes and wrap in double quotes
  return `"${query.replace(/"/g, '""')}"`
}

/**
 * Search chat history across conversation / project / user or globally.
 *
 * Priority:
 *  - conversationId -> MessageService.searchInConversation
 *  - projectId -> MessageService.searchMessagesByProject
 *  - userId -> MessageService.searchAllUserMessages
 *  - otherwise -> global FTS search across all messages
 */
export async function searchHistory(params: SearchHistoryParams) {
  const { query, userId, projectId, conversationId, limit = 10 } = params

  if (!query || !String(query).trim()) return []

  try {
    if (conversationId != null) {
      // search within a single conversation
      return MessageService.searchInConversation(String(query), String(conversationId))
    }

    if (projectId != null) {
      return MessageService.searchMessagesByProject(String(query), String(projectId))
    }

    if (userId != null) {
      return MessageService.searchAllUserMessages(String(query), String(userId), Number(limit || 10))
    }

    // Fallback: perform a global FTS search across all messages
    const sanitized = sanitizeFTSQuery(String(query))
    const safeLimit = Math.max(1, Math.min(1000, Number(limit || 10)))

    const stmt = db.prepare(
      `SELECT m.*, m.plain_text_content AS content_plain_text, highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
       FROM messages m
       JOIN messages_fts ON m.id = messages_fts.message_id
       WHERE messages_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )

    const rows = stmt.all(sanitized, safeLimit)
    return rows
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('searchHistory error:', err)
    return []
  }
}

export default searchHistory
