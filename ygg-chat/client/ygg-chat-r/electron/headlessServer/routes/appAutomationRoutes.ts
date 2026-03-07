import type Database from 'better-sqlite3'
import type { Express } from 'express'
import { v4 as uuidv4 } from 'uuid'

interface AppAutomationRouteDeps {
  db: Database.Database
  statements: any
}

interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

function buildMessageTree(messages: any[]): ChatNode | null {
  if (!messages || messages.length === 0) return null

  const messageMap = new Map<string, ChatNode>()
  const rootNodes: ChatNode[] = []

  messages.forEach(msg => {
    messageMap.set(msg.id, {
      id: String(msg.id),
      message: msg.content,
      sender: msg.role as 'user' | 'assistant',
      children: [],
    })
  })

  messages.forEach(msg => {
    const node = messageMap.get(String(msg.id))
    if (!node) return

    if (msg.parent_id === null) {
      rootNodes.push(node)
    }

    const childIds = Array.isArray(msg.children_ids)
      ? msg.children_ids
      : msg.children_ids
        ? JSON.parse(msg.children_ids)
        : []

    for (const childId of childIds) {
      const childNode = messageMap.get(String(childId))
      if (childNode) node.children.push(childNode)
    }
  })

  if (rootNodes.length === 0) return null
  if (rootNodes.length === 1) return rootNodes[0]

  return {
    id: 'root',
    message: 'Conversation',
    sender: 'assistant',
    children: rootNodes,
  }
}

export function registerAppAutomationRoutes(app: Express, deps: AppAutomationRouteDeps): void {
  const { db, statements } = deps

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  app.get('/api/app/projects', (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.query.user_id as string) || ''
      if (!userId) {
        res.status(400).json({ error: 'userId query param required' })
        return
      }

      const projects =
        typeof statements.getLocalProjects?.all === 'function'
          ? statements.getLocalProjects.all(userId)
          : db.prepare('SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC').all(userId)

      res.json(projects)
    } catch (error) {
      console.error('[HeadlessServer] Error listing app projects:', error)
      res.status(500).json({ error: 'Failed to fetch projects' })
    }
  })

  app.post('/api/app/projects', (req, res) => {
    try {
      const { id, name, user_id, context, system_prompt } = req.body
      if (!user_id) {
        res.status(400).json({ error: 'user_id required' })
        return
      }

      const projectId = id || uuidv4()
      const now = new Date().toISOString()

      statements.upsertProject.run(
        projectId,
        name || 'Untitled Project',
        user_id,
        context || null,
        system_prompt || null,
        'local',
        now,
        now
      )

      res.status(201).json(statements.getProjectById.get(projectId))
    } catch (error) {
      console.error('[HeadlessServer] Error creating app project:', error)
      res.status(500).json({ error: 'Failed to create project' })
    }
  })

  app.get('/api/app/projects/:id', (req, res) => {
    try {
      const { id } = req.params
      const project = statements.getProjectById.get(id)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }
      res.json(project)
    } catch (error) {
      console.error('[HeadlessServer] Error fetching app project:', error)
      res.status(500).json({ error: 'Failed to fetch project' })
    }
  })

  app.patch('/api/app/projects/:id', (req, res) => {
    try {
      const { id } = req.params
      const { name, context, system_prompt } = req.body

      const existing = statements.getProjectById.get(id) as any
      if (!existing) {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      db.prepare(
        `
        UPDATE projects SET
          name = COALESCE(?, name),
          context = ?,
          system_prompt = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
      ).run(
        name || existing.name,
        context !== undefined ? context : existing.context,
        system_prompt !== undefined ? system_prompt : existing.system_prompt,
        id
      )

      res.json(statements.getProjectById.get(id))
    } catch (error) {
      console.error('[HeadlessServer] Error updating app project:', error)
      res.status(500).json({ error: 'Failed to update project' })
    }
  })

  app.delete('/api/app/projects/:id', (req, res) => {
    try {
      const { id } = req.params
      const project = statements.getProjectById.get(id)
      if (!project) {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      db.prepare('UPDATE conversations SET project_id = NULL WHERE project_id = ?').run(id)
      db.prepare('DELETE FROM projects WHERE id = ?').run(id)

      res.json({ success: true })
    } catch (error) {
      console.error('[HeadlessServer] Error deleting app project:', error)
      res.status(500).json({ error: 'Failed to delete project' })
    }
  })

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  app.get('/api/app/conversations', (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.query.user_id as string) || ''
      const projectId = (req.query.projectId as string) || (req.query.project_id as string) || undefined

      if (!userId) {
        res.status(400).json({ error: 'userId required' })
        return
      }

      const conversations = projectId
        ? typeof statements.getLocalConversationsByUserAndProject?.all === 'function'
          ? statements.getLocalConversationsByUserAndProject.all(userId, projectId)
          : db
              .prepare('SELECT * FROM conversations WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC')
              .all(userId, projectId)
        : typeof statements.getLocalConversations?.all === 'function'
          ? statements.getLocalConversations.all(userId)
          : db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId)

      res.json(conversations)
    } catch (error) {
      console.error('[HeadlessServer] Error listing app conversations:', error)
      res.status(500).json({ error: 'Failed to fetch conversations' })
    }
  })

  app.get('/api/app/conversations/favorites', (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.query.user_id as string) || ''
      const limitParam = req.query.limit as string | undefined
      if (!userId) {
        res.status(400).json({ error: 'userId required' })
        return
      }

      const limit = limitParam ? Number(limitParam) : undefined
      const conversations = Number.isFinite(limit)
        ? statements.getFavoriteConversationsLimited.all(userId, limit)
        : statements.getFavoriteConversations.all(userId)

      res.json(conversations)
    } catch (error) {
      console.error('[HeadlessServer] Error fetching favorite app conversations:', error)
      res.status(500).json({ error: 'Failed to fetch favorite conversations' })
    }
  })

  app.get('/api/app/conversations/search', (req, res) => {
    try {
      const userId = (req.query.userId as string) || (req.query.user_id as string) || ''
      const rawQuery = (req.query.q as string) || ''
      const projectId = (req.query.projectId as string) || (req.query.project_id as string) || undefined
      const rawLimit = Number(req.query.limit ?? 20)
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20, 1), 50)

      if (!userId) {
        res.status(400).json({ error: 'userId required' })
        return
      }
      if (!rawQuery.trim()) {
        res.status(400).json({ error: 'q required' })
        return
      }

      const trimmedQuery = rawQuery.trim()
      const normalizedQuery = trimmedQuery.replace(/[\s_-]+/g, '')
      const likeQuery = `%${trimmedQuery}%`
      const normalizedLikeQuery = `%${normalizedQuery || trimmedQuery}%`

      const conversations = projectId
        ? statements.searchConversationsByTitleInProject.all(userId, projectId, likeQuery, normalizedLikeQuery, limit)
        : statements.searchConversationsByTitle.all(userId, likeQuery, normalizedLikeQuery, limit)

      res.json(conversations)
    } catch (error) {
      console.error('[HeadlessServer] Error searching app conversations:', error)
      res.status(500).json({ error: 'Failed to search conversations' })
    }
  })

  app.post('/api/app/conversations', (req, res) => {
    try {
      const { id, user_id, project_id, title, system_prompt, conversation_context, cwd } = req.body
      if (!user_id) {
        res.status(400).json({ error: 'user_id required' })
        return
      }

      const conversationId = id || uuidv4()
      const now = new Date().toISOString()

      statements.upsertConversation.run(
        conversationId,
        project_id || null,
        user_id,
        title || null,
        'unknown',
        system_prompt || null,
        conversation_context || null,
        null,
        cwd || null,
        'local',
        now,
        now
      )

      if (project_id) {
        db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, project_id)
      }

      res.status(201).json(statements.getConversationById.get(conversationId))
    } catch (error) {
      console.error('[HeadlessServer] Error creating app conversation:', error)
      res.status(500).json({ error: 'Failed to create conversation' })
    }
  })

  app.patch('/api/app/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      const { title, system_prompt, conversation_context, research_note, cwd, project_id, favorite } = req.body

      const existing = statements.getConversationById.get(id) as any
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      const updates: string[] = []
      const values: any[] = []

      if (title !== undefined) {
        updates.push('title = ?')
        values.push(title)
      }
      if (system_prompt !== undefined) {
        updates.push('system_prompt = ?')
        values.push(system_prompt)
      }
      if (conversation_context !== undefined) {
        updates.push('conversation_context = ?')
        values.push(conversation_context)
      }
      if (research_note !== undefined) {
        updates.push('research_note = ?')
        values.push(research_note)
      }
      if (cwd !== undefined) {
        const normalizedCwd = typeof cwd === 'string' ? (cwd.trim() || null) : cwd || null
        updates.push('cwd = ?')
        values.push(normalizedCwd)
      }
      if (project_id !== undefined) {
        updates.push('project_id = ?')
        values.push(project_id)
      }
      if (favorite !== undefined) {
        const normalizedFavorite = favorite === true || favorite === 1 || favorite === '1' || favorite === 'true' ? 1 : 0
        updates.push('favorite = ?')
        values.push(normalizedFavorite)
      }

      if (updates.length === 0) {
        res.json(existing)
        return
      }

      updates.push('updated_at = CURRENT_TIMESTAMP')
      values.push(id)

      const sql = `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`
      db.prepare(sql).run(...values)

      res.json(statements.getConversationById.get(id))
    } catch (error) {
      console.error('[HeadlessServer] Error updating app conversation:', error)
      res.status(500).json({ error: 'Failed to update conversation' })
    }
  })

  app.patch('/api/app/conversations/:id/favorite', (req, res) => {
    try {
      const { id } = req.params
      const { favorite } = req.body || {}

      if (favorite === undefined) {
        res.status(400).json({ error: 'favorite required' })
        return
      }

      const existing = statements.getConversationById.get(id)
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      const normalizedFavorite = favorite === true || favorite === 1 || favorite === '1' || favorite === 'true' ? 1 : 0
      statements.updateConversationFavorite.run(normalizedFavorite, id)

      res.json(statements.getConversationById.get(id))
    } catch (error) {
      console.error('[HeadlessServer] Error updating app conversation favorite:', error)
      res.status(500).json({ error: 'Failed to update favorite' })
    }
  })

  app.get('/api/app/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      const conversation = statements.getConversationById.get(id)
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }
      res.json(conversation)
    } catch (error) {
      console.error('[HeadlessServer] Error fetching app conversation:', error)
      res.status(500).json({ error: 'Failed to fetch conversation' })
    }
  })

  app.delete('/api/app/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteConversation.run(id)
      res.json({ success: true })
    } catch (error) {
      console.error('[HeadlessServer] Error deleting app conversation:', error)
      res.status(500).json({ error: 'Failed to delete conversation' })
    }
  })

  app.get('/api/app/conversations/:id/messages', (req, res) => {
    try {
      const { id } = req.params
      const messages = statements.getMessagesByConversationId.all(id)
      res.json(messages)
    } catch (error) {
      console.error('[HeadlessServer] Error fetching app conversation messages:', error)
      res.status(500).json({ error: 'Failed to fetch messages' })
    }
  })

  app.get('/api/app/conversations/:id/messages/top-level-users', (req, res) => {
    try {
      const { id } = req.params
      const topLevelUserMessages = statements.getTopLevelUserMessagesByConversationId.all(id)
      res.json(topLevelUserMessages)
    } catch (error) {
      console.error('[HeadlessServer] Error fetching app top-level user messages:', error)
      res.status(500).json({ error: 'Failed to fetch top-level user messages' })
    }
  })

  app.get('/api/app/conversations/:id/messages/tree', (req, res) => {
    try {
      const { id } = req.params
      const messages = statements.getMessagesByConversationId.all(id)

      const normalizedMessages = messages.map((msg: any) => {
        const attachments = statements.getAttachmentsByMessageId.all(msg.id) as any[]
        return {
          ...msg,
          children_ids: msg.children_ids ? JSON.parse(msg.children_ids) : [],
          tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
          content_blocks: msg.content_blocks ? JSON.parse(msg.content_blocks) : null,
          attachments,
          attachments_count: attachments.length,
          has_attachments: attachments.length > 0,
        }
      })

      const treeData = buildMessageTree(normalizedMessages)
      const conversation = statements.getConversationById.get(id) as { storage_mode?: string } | undefined
      const storage_mode = conversation?.storage_mode || 'local'

      res.json({ messages: normalizedMessages, tree: treeData, meta: { storage_mode } })
    } catch (error) {
      console.error('[HeadlessServer] Error fetching app message tree:', error)
      res.status(500).json({ error: 'Failed to fetch message tree' })
    }
  })

  app.post('/api/app/conversations/:id/messages/bulk', (req, res) => {
    try {
      const { id: conversationId } = req.params
      const { messages } = req.body as {
        messages: Array<{
          role: 'user' | 'assistant'
          content: string
          thinking_block?: string
          model_name?: string
          tool_calls?: string | any[]
          note?: string
          content_blocks?: any
        }>
      }

      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array required' })
        return
      }

      const conversation = statements.getConversationById.get(conversationId) as any
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      const createdMessages: any[] = []
      let lastMessageId: string | null = null
      const now = new Date().toISOString()

      for (const msg of messages) {
        const messageId = uuidv4()
        statements.upsertMessage.run(
          messageId,
          conversationId,
          lastMessageId,
          '[]',
          msg.role,
          msg.content,
          msg.content,
          msg.thinking_block || null,
          msg.tool_calls
            ? typeof msg.tool_calls === 'string'
              ? msg.tool_calls
              : JSON.stringify(msg.tool_calls)
            : null,
          null,
          msg.model_name || 'unknown',
          msg.note || null,
          null,
          null,
          msg.content_blocks
            ? typeof msg.content_blocks === 'string'
              ? msg.content_blocks
              : JSON.stringify(msg.content_blocks)
            : null,
          now
        )

        createdMessages.push({
          id: messageId,
          conversation_id: conversationId,
          parent_id: lastMessageId,
          children_ids: [],
          role: msg.role,
          content: msg.content,
          plain_text_content: msg.content,
          thinking_block: msg.thinking_block || null,
          tool_calls: msg.tool_calls || null,
          model_name: msg.model_name || 'unknown',
          note: msg.note || null,
          content_blocks: msg.content_blocks || null,
          created_at: now,
        })

        lastMessageId = messageId
      }

      if (!conversation.title && messages.length > 0) {
        const firstContent = messages[0].content
        const title = firstContent.slice(0, 100) + (firstContent.length > 100 ? '...' : '')
        statements.updateConversationTitle.run(title, conversationId)
      }

      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
      res.json({ messages: createdMessages })
    } catch (error) {
      console.error('[HeadlessServer] Error bulk inserting app messages:', error)
      res.status(500).json({ error: 'Failed to bulk insert messages' })
    }
  })

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  app.get('/api/app/messages', (req, res) => {
    try {
      const conversationId = req.query.conversation_id as string
      if (!conversationId) {
        res.status(400).json({ error: 'conversation_id query param is required' })
        return
      }

      const messages = statements.getMessagesByConversationId.all(conversationId)
      res.json(messages)
    } catch (error) {
      console.error('[HeadlessServer] Error listing app messages:', error)
      res.status(500).json({ error: 'Failed to list messages' })
    }
  })

  app.post('/api/app/messages', (req, res) => {
    try {
      const { conversation_id, parent_id, role, content, model_name, tool_calls, tool_call_id, content_blocks } = req.body

      if (!conversation_id) {
        res.status(400).json({ error: 'conversation_id is required' })
        return
      }
      if (!role || !['user', 'assistant', 'tool', 'system'].includes(role)) {
        res.status(400).json({ error: 'role must be user, assistant, tool, or system' })
        return
      }

      const messageId = uuidv4()
      const now = new Date().toISOString()

      statements.upsertMessage.run(
        messageId,
        conversation_id,
        parent_id || null,
        JSON.stringify([]),
        role,
        content || '',
        content || '',
        null,
        JSON.stringify(tool_calls || null),
        tool_call_id || null,
        model_name || 'unknown',
        null,
        null,
        null,
        JSON.stringify(content_blocks || null),
        now
      )

      if (parent_id) {
        const parent = statements.getMessageById.get(parent_id) as any
        if (parent) {
          const childrenIds = JSON.parse(parent.children_ids || '[]')
          if (!childrenIds.includes(messageId)) {
            childrenIds.push(messageId)
            db.prepare('UPDATE messages SET children_ids = ? WHERE id = ?').run(JSON.stringify(childrenIds), parent_id)
          }
        }
      }

      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversation_id)
      const conversation = statements.getConversationById.get(conversation_id) as any
      if (conversation?.project_id) {
        db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, conversation.project_id)
      }

      const message = statements.getMessageById.get(messageId)
      res.status(201).json(message)
    } catch (error) {
      console.error('[HeadlessServer] Error creating app message:', error)
      res.status(500).json({ error: 'Failed to create message' })
    }
  })

  const updateMessageHandler = (req: any, res: any) => {
    try {
      const { id } = req.params
      const { content, note, content_blocks } = req.body

      const existing = statements.getMessageById.get(id) as any
      if (!existing) {
        res.status(404).json({ error: 'Message not found' })
        return
      }

      let finalContent = content
      if (!finalContent && content_blocks) {
        const textBlocks = Array.isArray(content_blocks) ? content_blocks.filter((b: any) => b.type === 'text') : []
        finalContent = textBlocks.map((b: any) => b.text || b.content || '').join('\n')
      }

      const contentBlocksJson = content_blocks ? JSON.stringify(content_blocks) : null

      statements.updateMessage.run(
        finalContent || existing.content,
        note || existing.note,
        contentBlocksJson || existing.content_blocks,
        id
      )

      res.json(statements.getMessageById.get(id))
    } catch (error) {
      console.error('[HeadlessServer] Error updating app message:', error)
      res.status(500).json({ error: 'Failed to update message' })
    }
  }

  app.patch('/api/app/messages/:id', updateMessageHandler)
  app.put('/api/app/messages/:id', updateMessageHandler)

  app.post('/api/app/messages/:id/branch', (req, res) => {
    try {
      const { id } = req.params
      const { content, role = 'user' } = req.body

      const parentMessage = statements.getMessageById.get(id) as any
      if (!parentMessage) {
        res.status(404).json({ error: 'Parent message not found' })
        return
      }

      const messageId = uuidv4()
      const now = new Date().toISOString()

      statements.upsertMessage.run(
        messageId,
        parentMessage.conversation_id,
        id,
        JSON.stringify([]),
        role,
        content || '',
        content || '',
        null,
        JSON.stringify(null),
        null,
        'unknown',
        null,
        null,
        null,
        JSON.stringify(null),
        now
      )

      const childrenIds = JSON.parse(parentMessage.children_ids || '[]')
      childrenIds.push(messageId)
      db.prepare('UPDATE messages SET children_ids = ? WHERE id = ?').run(JSON.stringify(childrenIds), id)

      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, parentMessage.conversation_id)
      const conversation = statements.getConversationById.get(parentMessage.conversation_id) as any
      if (conversation?.project_id) {
        db.prepare('UPDATE projects SET updated_at = ? WHERE id = ?').run(now, conversation.project_id)
      }

      res.status(201).json(statements.getMessageById.get(messageId))
    } catch (error) {
      console.error('[HeadlessServer] Error branching app message:', error)
      res.status(500).json({ error: 'Failed to branch message' })
    }
  })

  app.delete('/api/app/messages/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteMessage.run(id)
      res.json({ success: true })
    } catch (error) {
      console.error('[HeadlessServer] Error deleting app message:', error)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  app.post('/api/app/messages/deleteMany', (req, res) => {
    try {
      const { ids } = req.body || {}
      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids must be a non-empty array' })
        return
      }

      const deleteTransaction = db.transaction((messageIds: string[]) => {
        for (const id of messageIds) {
          statements.deleteMessage.run(id)
        }
      })

      deleteTransaction(ids)
      res.json({ deleted: ids.length })
    } catch (error) {
      console.error('[HeadlessServer] Error bulk deleting app messages:', error)
      res.status(500).json({ error: 'Failed to bulk delete messages' })
    }
  })
}
