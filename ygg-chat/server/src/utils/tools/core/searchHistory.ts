import { db } from '../../../database/db'

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
 * Search chat history using SQLite FTS5.
 * Supports filtering by conversation, project, or user.
 */
export async function searchHistory(params: SearchHistoryParams) {
  const { query, userId, projectId, conversationId, limit = 10 } = params

  if (!query || !String(query).trim()) return []

  try {
    const sanitized = sanitizeFTSQuery(String(query))
    const safeLimit = Math.max(1, Math.min(1000, Number(limit || 10)))

    let sql = `SELECT m.*, m.plain_text_content AS content_plain_text, highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
       FROM messages m
       JOIN messages_fts ON m.id = messages_fts.message_id
       WHERE messages_fts MATCH ?`
    const params_arr: any[] = [sanitized]

    // Add optional filters
    if (conversationId != null) {
      sql += ` AND m.conversation_id = ?`
      params_arr.push(String(conversationId))
    }

    if (projectId != null) {
      sql += ` AND m.conversation_id IN (
        SELECT id FROM conversations WHERE project_id = ?
      )`
      params_arr.push(String(projectId))
    }

    if (userId != null) {
      sql += ` AND m.owner_id = ?`
      params_arr.push(String(userId))
    }

    sql += ` ORDER BY rank LIMIT ?`
    params_arr.push(safeLimit)

    const stmt = db.prepare(sql)
    const rows = stmt.all(...params_arr)
    return rows
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('searchHistory error:', err)
    return []
  }
}

export default searchHistory
