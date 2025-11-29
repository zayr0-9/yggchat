// electron/localServer.ts
// Embedded local SQLite server for dual-sync in Electron mode
// This server runs on port 3002 and handles sync operations from Railway to local SQLite

import Database from 'better-sqlite3'
import cors from 'cors'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { WebSocket, WebSocketServer } from 'ws'

// Tool imports
import { browseWeb } from './tools/browseWeb.js'
import { createTextFile } from './tools/createFile.js'
import { deleteFile, safeDeleteFile } from './tools/deleteFile.js'
import { extractDirectoryStructure } from './tools/directory.js'
import { editFile } from './tools/editFile.js'
import { globSearch } from './tools/glob.js'
import { readFileContinuation, readTextFile } from './tools/readFile.js'
import { readMultipleTextFiles } from './tools/readFiles.js'
import { ripgrepSearch } from './tools/ripgrep.js'

const app = express()
let server: any = null
let wss: WebSocketServer | null = null
let db: Database.Database | null = null
let statements: any = {}

// Initialize database at specified path
function initializeLocalDatabase(dbPath: string) {
  console.log('[LocalServer] Initializing database at:', dbPath)

  // Ensure directory exists
  const dbDir = path.dirname(dbPath)
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  // DEV MODE: Delete old database if it exists to force schema recreation
  // Remove this in production and add proper migrations
  // if (fs.existsSync(dbPath)) {
  //   console.log('[LocalServer] DEV MODE: Deleting old database to recreate with new schema')
  //   fs.unlinkSync(dbPath)
  // }

  db = new Database(dbPath)
  db.pragma('foreign_keys = ON')

  // Create tables (minimal schema for sync operations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT,
      context TEXT,
      system_prompt TEXT,
      storage_mode TEXT NOT NULL CHECK (storage_mode IN ('cloud','local')) DEFAULT 'cloud',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT NOT NULL,
      title TEXT,
      model_name TEXT DEFAULT 'unknown',
      system_prompt TEXT,
      conversation_context TEXT,
      research_note TEXT,
      cwd TEXT,
      storage_mode TEXT NOT NULL CHECK (storage_mode IN ('cloud','local')) DEFAULT 'cloud',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      children_ids TEXT DEFAULT '[]',
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'ex_agent', 'tool')),
      content TEXT NOT NULL,
      plain_text_content TEXT,
      thinking_block TEXT,
      tool_calls TEXT,
      tool_call_id TEXT,
      model_name TEXT DEFAULT 'unknown',
      note TEXT,
      ex_agent_session_id TEXT,
      ex_agent_type TEXT,
      content_blocks TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('image')),
      mime_type TEXT NOT NULL,
      storage TEXT NOT NULL CHECK (storage IN ('file','url')) DEFAULT 'file',
      url TEXT,
      file_path TEXT,
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      sha256 TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachment_links (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES message_attachments(id) ON DELETE CASCADE,
      UNIQUE(message_id, attachment_id)
    )
  `)

  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_cost (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      prompt_tokens INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      approx_cost REAL DEFAULT 0.0,
      api_credit_cost REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
  `)

  // Update statements
  statements = {
    // Users
    upsertUser: db.prepare(`
        INSERT INTO users (id, username, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET username = excluded.username
      `),

    // Projects
    upsertProject: db.prepare(`
        INSERT INTO projects (id, name, user_id, context, system_prompt, storage_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          context = excluded.context,
          system_prompt = excluded.system_prompt,
          storage_mode = excluded.storage_mode,
          updated_at = excluded.updated_at
      `),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    getProjectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    getLocalProjects: db.prepare(
      "SELECT * FROM projects WHERE user_id = ? AND storage_mode = 'local' ORDER BY updated_at DESC"
    ),

    // Conversations
    upsertConversation: db.prepare(`
        INSERT INTO conversations (id, project_id, user_id, title, model_name, system_prompt, conversation_context, research_note, cwd, storage_mode, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          project_id = excluded.project_id,
          title = excluded.title,
          model_name = excluded.model_name,
          system_prompt = excluded.system_prompt,
          conversation_context = excluded.conversation_context,
          research_note = excluded.research_note,
          cwd = excluded.cwd,
          storage_mode = excluded.storage_mode,
          updated_at = excluded.updated_at
      `),
    deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
    getConversationById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
    getLocalConversations: db.prepare(
      "SELECT * FROM conversations WHERE user_id = ? AND storage_mode = 'local' ORDER BY updated_at DESC"
    ),
    updateConversationResearchNote: db.prepare(
      'UPDATE conversations SET research_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),
    updateConversationCwd: db.prepare('UPDATE conversations SET cwd = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    updateConversationTitle: db.prepare(
      'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),

    // Messages
    upsertMessage: db.prepare(`
        INSERT INTO messages (id, conversation_id, parent_id, children_ids, role, content, plain_text_content, thinking_block, tool_calls, tool_call_id, model_name, note, ex_agent_session_id, ex_agent_type, content_blocks, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          plain_text_content = excluded.plain_text_content,
          thinking_block = excluded.thinking_block,
          tool_calls = excluded.tool_calls,
          tool_call_id = excluded.tool_call_id,
          note = excluded.note,
          content_blocks = excluded.content_blocks
      `),
    deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
    getMessageById: db.prepare('SELECT * FROM messages WHERE id = ?'),
    getMessagesByConversationId: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'),
    getLastMessageByConversationId: db.prepare(
      'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'
    ),

    // Attachments
    upsertAttachment: db.prepare(`
        INSERT INTO message_attachments (id, message_id, kind, mime_type, storage, url, file_path, width, height, size_bytes, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          url = excluded.url,
          file_path = excluded.file_path
      `),
    linkAttachment: db.prepare(`
        INSERT OR IGNORE INTO message_attachment_links (id, message_id, attachment_id, created_at)
        VALUES (?, ?, ?, ?)
      `),

    // Provider Cost
    upsertProviderCost: db.prepare(`
        INSERT INTO provider_cost (id, user_id, message_id, prompt_tokens, completion_tokens, reasoning_tokens, approx_cost, api_credit_cost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          prompt_tokens = excluded.prompt_tokens,
          completion_tokens = excluded.completion_tokens,
          reasoning_tokens = excluded.reasoning_tokens,
          approx_cost = excluded.approx_cost,
          api_credit_cost = excluded.api_credit_cost
      `),

    // Message updates (for local editing)
    updateMessage: db.prepare('UPDATE messages SET content = ?, note = ?, content_blocks = ? WHERE id = ?'),
  }

  console.log('[LocalServer] Database initialized successfully')
}

// Helper functions to ensure dependencies exist before sync operations
function ensureUserExists(userId: string) {
  if (!db) return
  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(userId)
  if (!existing) {
    console.log('[LocalServer] Auto-creating user stub:', userId)
    db.prepare('INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)').run(
      userId,
      `synced-user-${userId.substring(0, 8)}`,
      new Date().toISOString()
    )
  }
}

function ensureProjectExists(projectId: string, userId: string) {
  if (!db) return
  ensureUserExists(userId) // Project requires user to exist
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)
  if (!existing) {
    console.log('[LocalServer] Auto-creating project stub:', projectId)
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO projects (id, name, user_id, context, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(projectId, 'Synced Project', userId, null, null, now, now)
  }
}

function ensureConversationExists(conversationId: string, userId: string, projectId?: string | null) {
  if (!db) return
  ensureUserExists(userId) // Conversation requires user to exist
  if (projectId) {
    ensureProjectExists(projectId, userId) // If project is set, ensure it exists
  }
  const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(conversationId)
  if (!existing) {
    console.log('[LocalServer] Auto-creating conversation stub:', conversationId)
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO conversations (id, project_id, user_id, title, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(conversationId, projectId || null, userId, 'Synced Conversation', 'unknown', now, now)
  }
}

// ChatNode interface for message tree structure
interface ChatNode {
  id: string
  message: string
  sender: 'user' | 'assistant'
  children: ChatNode[]
}

// Build tree structure from flat message array with children_ids
function buildMessageTree(messages: any[]): ChatNode | null {
  if (!messages || messages.length === 0) return null

  const messageMap = new Map<string, ChatNode>()
  const rootNodes: ChatNode[] = []

  // Create nodes
  messages.forEach(msg => {
    messageMap.set(msg.id, {
      id: msg.id.toString(),
      message: msg.content,
      sender: msg.role as 'user' | 'assistant',
      children: [],
    })
  })

  // Build tree using children_ids and collect all root nodes
  messages.forEach(msg => {
    const node = messageMap.get(msg.id)!

    if (msg.parent_id === null) {
      rootNodes.push(node)
    }

    // Add children using children_ids array
    const childIds = msg.children_ids || []
    childIds.forEach((childId: string) => {
      const childNode = messageMap.get(childId)
      if (childNode) {
        node.children.push(childNode)
      }
    })
  })

  if (rootNodes.length === 0) return null

  // If only one root message, return it directly
  if (rootNodes.length === 1) {
    return rootNodes[0]
  }

  // Multiple roots → create a synthetic root node containing all root branches
  // This preserves all independent conversation trees
  return {
    id: 'root',
    message: 'Conversation',
    sender: 'assistant',
    children: rootNodes,
  }
}

interface ConnectedClient {
  ws: WebSocket
  type: 'extension' | 'frontend'
  id: string
}

const clients = new Set<ConnectedClient>()

function initializeWebSocketServer(serverInstance: any) {
  console.log('[LocalServer] Initializing WebSocket Server on /ide-context')

  wss = new WebSocketServer({ server: serverInstance, path: '/ide-context' })

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url!, `http://${request.headers.host}`)
    const clientType = url.searchParams.get('type') as 'extension' | 'frontend'
    const clientId = url.searchParams.get('id') || 'anonymous'

    const client: ConnectedClient = {
      ws,
      type: clientType || 'frontend',
      id: clientId,
    }

    clients.add(client)
    console.log(`[LocalServer] Client connected: ${client.type} (${client.id})`)

    ws.on('message', data => {
      try {
        const message = JSON.parse(data.toString())

        if (message.type === 'ping') {
          client.ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }))
          return // don’t broadcast heartbeat traffic
        }

        // Relay messages from extension to all frontend clients
        if (client.type === 'extension') {
          const outgoing = {
            ...message,
            // Normalize requestId to be present at the top-level if available in data
            requestId: message.requestId ?? message.data?.requestId,
          }

          clients.forEach(c => {
            if (c.type === 'frontend' && c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify(outgoing))
            }
          })
        }

        // Handle frontend requests to extension
        if (client.type === 'frontend') {
          if (message.type === 'request_context') {
            const extensionClients = Array.from(clients).filter(
              c => c.type === 'extension' && c.ws.readyState === WebSocket.OPEN
            )

            clients.forEach(c => {
              if (c.type === 'extension' && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(
                  JSON.stringify({
                    type: 'request_context',
                    requestId: message.requestId,
                  })
                )
              }
            })

            if (extensionClients.length === 0) {
              console.warn('[LocalServer] No extensions available to handle context request')
              // Send back an empty response so frontend stops waiting
              client.ws.send(
                JSON.stringify({
                  type: 'context_response',
                  requestId: message.requestId,
                  data: {
                    workspace: { name: null, rootPath: null },
                    openFiles: [],
                    allFiles: [],
                    activeFile: null,
                    currentSelection: null,
                  },
                })
              )
            }
          } else if (message.type === 'request_file_content') {
            clients.forEach(c => {
              if (c.type === 'extension' && c.ws.readyState === WebSocket.OPEN) {
                c.ws.send(
                  JSON.stringify({
                    type: 'request_file_content',
                    requestId: message.requestId,
                    data: {
                      path: message.data.path,
                    },
                  })
                )
              }
            })
          }
        }
      } catch (error) {
        console.error('[LocalServer] Failed to parse WebSocket message:', error)
      }
    })

    ws.on('close', () => {
      clients.delete(client)
      console.log(`[LocalServer] Client disconnected: ${client.type} (${client.id})`)
    })

    ws.on('error', error => {
      console.error(`[LocalServer] WebSocket error for ${client.type}:`, error)
      clients.delete(client)
    })
  })
}

// Setup Express app
function setupServer() {
  app.use(cors())
  app.use(express.json({ limit: '25mb' }))

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'local-sync' })
  })

  // Sync User
  app.post('/api/sync/user', (req, res) => {
    try {
      const { id, username, created_at } = req.body
      statements.upsertUser.run(id, username, created_at || new Date().toISOString())
      console.log('[LocalServer] Synced user:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error syncing user:', error)
      res.status(500).json({ error: 'Failed to sync user' })
    }
  })

  // Sync Project
  app.post('/api/sync/project', (req, res) => {
    try {
      const { id, name, user_id, owner_id, context, system_prompt, storage_mode, created_at, updated_at } = req.body

      // Handle owner_id -> user_id mapping (Railway sends owner_id)
      const effectiveUserId = user_id || owner_id
      if (!effectiveUserId) {
        res.status(400).json({ error: 'Missing user_id or owner_id' })
        return
      }

      // Ensure user exists before upserting project
      ensureUserExists(effectiveUserId)

      statements.upsertProject.run(
        id,
        name,
        effectiveUserId,
        context || null,
        system_prompt || null,
        storage_mode || 'cloud',
        created_at || new Date().toISOString(),
        updated_at || new Date().toISOString()
      )
      console.log('[LocalServer] Synced project:', id, '- storage_mode:', storage_mode || 'cloud')
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error syncing project:', error)
      res.status(500).json({ error: 'Failed to sync project' })
    }
  })

  app.delete('/api/sync/project/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteProject.run(id)
      console.log('[LocalServer] Deleted project:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error deleting project:', error)
      res.status(500).json({ error: 'Failed to delete project' })
    }
  })

  // Get Project (for checking existence)
  app.get('/api/sync/project/:id', (req, res) => {
    try {
      const { id } = req.params
      const project = statements.getProjectById.get(id)
      if (project) {
        res.json({ exists: true, project })
      } else {
        res.json({ exists: false })
      }
    } catch (error) {
      console.error('[LocalServer] Error getting project:', error)
      res.status(500).json({ error: 'Failed to get project' })
    }
  })

  // Sync Conversation
  app.post('/api/sync/conversation', (req, res) => {
    try {
      const {
        id,
        project_id,
        user_id,
        owner_id, // Railway uses owner_id, local uses user_id
        title,
        model_name,
        system_prompt,
        conversation_context,
        research_note,
        cwd,
        storage_mode,
        created_at,
        updated_at,
      } = req.body

      console.log(
        '[LocalServer] 🔄 POST /api/sync/conversation - conversationId:',
        id,
        'title:',
        title,
        'storage_mode:',
        storage_mode
      )

      // Handle owner_id -> user_id mapping (Railway sends owner_id)
      const effectiveUserId = user_id || owner_id
      if (!effectiveUserId) {
        console.log('[LocalServer] ❌ Missing user_id or owner_id')
        res.status(400).json({ error: 'Missing user_id or owner_id' })
        return
      }

      console.log('[LocalServer] 👤 Effective userId:', effectiveUserId, 'projectId:', project_id)

      // Ensure dependencies exist before upserting conversation
      ensureUserExists(effectiveUserId)
      if (project_id) {
        ensureProjectExists(project_id, effectiveUserId)
      }

      statements.upsertConversation.run(
        id,
        project_id || null,
        effectiveUserId,
        title || null,
        model_name || 'unknown',
        system_prompt || null,
        conversation_context || null,
        research_note || null,
        cwd || null,
        storage_mode || 'cloud',
        created_at || new Date().toISOString(),
        updated_at || new Date().toISOString()
      )
      console.log('[LocalServer] ✅ Synced conversation successfully:', id, '- title:', title)

      // Verify the conversation was saved
      const saved = statements.getConversationById.get(id)
      if (saved) {
        console.log(
          '[LocalServer] ✅ Verified conversation exists in DB:',
          id,
          '- storage_mode:',
          (saved as any).storage_mode
        )
      } else {
        console.log('[LocalServer] ⚠️  Warning: Conversation not found after save:', id)
      }

      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] ❌ Error syncing conversation:', error)
      res.status(500).json({ error: 'Failed to sync conversation' })
    }
  })

  app.delete('/api/sync/conversation/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteConversation.run(id)
      console.log('[LocalServer] Deleted conversation:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error deleting conversation:', error)
      res.status(500).json({ error: 'Failed to delete conversation' })
    }
  })

  // Get Conversation (for checking existence)
  app.get('/api/sync/conversation/:id', (req, res) => {
    try {
      const { id } = req.params
      const conversation = statements.getConversationById.get(id)
      if (conversation) {
        res.json({ exists: true, conversation })
      } else {
        res.json({ exists: false })
      }
    } catch (error) {
      console.error('[LocalServer] Error getting conversation:', error)
      res.status(500).json({ error: 'Failed to get conversation' })
    }
  })

  // Sync Message
  app.post('/api/sync/message', (req, res) => {
    try {
      const {
        id,
        conversation_id,
        parent_id,
        children_ids,
        role,
        content,
        plain_text_content,
        thinking_block,
        tool_calls,
        tool_call_id,
        model_name,
        note,
        ex_agent_session_id,
        ex_agent_type,
        content_blocks,
        created_at,
        // Additional context for dependency creation
        user_id,
        owner_id,
        project_id,
      } = req.body

      console.log(
        '[LocalServer] 💾 POST /api/sync/message - messageId:',
        id,
        'conversationId:',
        conversation_id,
        'role:',
        role
      )
      console.log('[LocalServer] 📝 Message content preview:', content?.substring(0, 50))

      if (!conversation_id) {
        console.log('[LocalServer] ❌ Missing conversation_id')
        res.status(400).json({ error: 'Missing conversation_id' })
        return
      }

      // Ensure conversation exists before upserting message
      // Try to get user_id from request body or from existing conversation
      let effectiveUserId = user_id || owner_id
      let effectiveProjectId = project_id

      // If no user_id provided, try to get it from the existing conversation
      if (!effectiveUserId && db) {
        const existingConv = db
          .prepare('SELECT user_id, project_id FROM conversations WHERE id = ?')
          .get(conversation_id) as { user_id: string; project_id: string | null } | undefined
        if (existingConv) {
          effectiveUserId = existingConv.user_id
          effectiveProjectId = effectiveProjectId || existingConv.project_id
        }
      }

      // If we have user context, ensure dependencies exist
      if (effectiveUserId) {
        ensureConversationExists(conversation_id, effectiveUserId, effectiveProjectId || null)
      } else {
        // No user context and conversation doesn't exist - this will fail on FK constraint
        // Log warning but proceed anyway (might succeed if conversation exists)
        console.warn('[LocalServer] No user context for message sync, conversation may not exist:', conversation_id)
      }

      statements.upsertMessage.run(
        id,
        conversation_id,
        parent_id || null,
        typeof children_ids === 'string' ? children_ids : JSON.stringify(children_ids || []),
        role,
        content,
        plain_text_content || null,
        thinking_block || null,
        typeof tool_calls === 'string' ? tool_calls : JSON.stringify(tool_calls || null),
        tool_call_id || null,
        model_name || 'unknown',
        note || null,
        ex_agent_session_id || null,
        ex_agent_type || null,
        typeof content_blocks === 'string' ? content_blocks : JSON.stringify(content_blocks || null),
        created_at || new Date().toISOString()
      )
      console.log(
        '[LocalServer] ✅ Synced message successfully:',
        id,
        '- role:',
        role,
        'conversation:',
        conversation_id
      )

      // Verify the message was saved
      const saved = statements.getMessageById.get(id)
      if (saved) {
        console.log('[LocalServer] ✅ Verified message exists in DB:', id)
      } else {
        console.log('[LocalServer] ⚠️  Warning: Message not found after save:', id)
      }

      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] ❌ Error syncing message:', error)
      res.status(500).json({ error: 'Failed to sync message' })
    }
  })

  app.delete('/api/sync/message/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteMessage.run(id)
      console.log('[LocalServer] Deleted message:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error deleting message:', error)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  // Sync Attachment
  app.post('/api/sync/attachment', (req, res) => {
    try {
      const {
        id,
        message_id,
        kind,
        mime_type,
        storage,
        url,
        file_path,
        width,
        height,
        size_bytes,
        sha256,
        created_at,
      } = req.body

      statements.upsertAttachment.run(
        id,
        message_id || null,
        kind,
        mime_type,
        storage || 'url',
        url || null,
        file_path || null,
        width || null,
        height || null,
        size_bytes || null,
        sha256 || null,
        created_at || new Date().toISOString()
      )

      // Link attachment to message if message_id provided
      if (message_id) {
        const linkId = uuidv4()
        statements.linkAttachment.run(linkId, message_id, id, new Date().toISOString())
      }

      console.log('[LocalServer] Synced attachment:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error syncing attachment:', error)
      res.status(500).json({ error: 'Failed to sync attachment' })
    }
  })

  // Sync Provider Cost
  app.post('/api/sync/provider-cost', (req, res) => {
    try {
      const {
        id,
        user_id,
        message_id,
        prompt_tokens,
        completion_tokens,
        reasoning_tokens,
        approx_cost,
        api_credit_cost,
        created_at,
      } = req.body

      statements.upsertProviderCost.run(
        id,
        user_id,
        message_id,
        prompt_tokens || 0,
        completion_tokens || 0,
        reasoning_tokens || 0,
        approx_cost || 0,
        api_credit_cost || 0,
        created_at || new Date().toISOString()
      )
      console.log('[LocalServer] Synced provider cost:', id)
      res.json({ success: true, id })
    } catch (error) {
      console.error('[LocalServer] Error syncing provider cost:', error)
      res.status(500).json({ error: 'Failed to sync provider cost' })
    }
  })

  // Batch sync endpoint for efficiency
  app.post('/api/sync/batch', (req, res) => {
    const { operations } = req.body as { operations: Array<{ type: string; action: string; data: any }> }

    if (!Array.isArray(operations)) {
      res.status(400).json({ error: 'Operations must be an array' })
      return
    }

    const results: Array<{ success: boolean; type: string; id?: string; error?: string }> = []

    // Use transaction for atomicity
    const transaction = db!.transaction(() => {
      for (const op of operations) {
        try {
          switch (op.type) {
            case 'user':
              if (op.action === 'create' || op.action === 'update') {
                statements.upsertUser.run(op.data.id, op.data.username, op.data.created_at || new Date().toISOString())
                results.push({ success: true, type: 'user', id: op.data.id })
              }
              break

            case 'project':
              if (op.action === 'create' || op.action === 'update') {
                statements.upsertProject.run(
                  op.data.id,
                  op.data.name,
                  op.data.user_id,
                  op.data.context || null,
                  op.data.system_prompt || null,
                  op.data.storage_mode || 'cloud',
                  op.data.created_at || new Date().toISOString(),
                  op.data.updated_at || new Date().toISOString()
                )
                results.push({ success: true, type: 'project', id: op.data.id })
              } else if (op.action === 'delete') {
                statements.deleteProject.run(op.data.id)
                results.push({ success: true, type: 'project', id: op.data.id })
              }
              break

            case 'conversation':
              if (op.action === 'create' || op.action === 'update') {
                statements.upsertConversation.run(
                  op.data.id,
                  op.data.project_id || null,
                  op.data.user_id,
                  op.data.title || null,
                  op.data.model_name || 'unknown',
                  op.data.system_prompt || null,
                  op.data.conversation_context || null,
                  op.data.research_note || null,
                  op.data.cwd || null,
                  op.data.created_at || new Date().toISOString(),
                  op.data.updated_at || new Date().toISOString()
                )
                results.push({ success: true, type: 'conversation', id: op.data.id })
              } else if (op.action === 'delete') {
                statements.deleteConversation.run(op.data.id)
                results.push({ success: true, type: 'conversation', id: op.data.id })
              }
              break

            case 'message':
              if (op.action === 'create' || op.action === 'update') {
                statements.upsertMessage.run(
                  op.data.id,
                  op.data.conversation_id,
                  op.data.parent_id || null,
                  typeof op.data.children_ids === 'string'
                    ? op.data.children_ids
                    : JSON.stringify(op.data.children_ids || []),
                  op.data.role,
                  op.data.content,
                  op.data.plain_text_content || null,
                  op.data.thinking_block || null,
                  typeof op.data.tool_calls === 'string'
                    ? op.data.tool_calls
                    : JSON.stringify(op.data.tool_calls || null),
                  op.data.tool_call_id || null,
                  op.data.model_name || 'unknown',
                  op.data.note || null,
                  op.data.ex_agent_session_id || null,
                  op.data.ex_agent_type || null,
                  typeof op.data.content_blocks === 'string'
                    ? op.data.content_blocks
                    : JSON.stringify(op.data.content_blocks || null),
                  op.data.created_at || new Date().toISOString()
                )
                results.push({ success: true, type: 'message', id: op.data.id })
              } else if (op.action === 'delete') {
                statements.deleteMessage.run(op.data.id)
                results.push({ success: true, type: 'message', id: op.data.id })
              }
              break

            default:
              results.push({ success: false, type: op.type, error: `Unknown operation type: ${op.type}` })
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          results.push({ success: false, type: op.type, error: errorMsg })
        }
      }
    })

    try {
      transaction()
      console.log(
        `[LocalServer] Batch sync completed: ${results.filter(r => r.success).length}/${operations.length} succeeded`
      )
      res.json({ success: true, results })
    } catch (error) {
      console.error('[LocalServer] Batch sync failed:', error)
      res.status(500).json({ error: 'Batch sync failed', results })
    }
  })

  // Tool Execution Endpoint
  app.post('/api/tools/execute', async (req, res) => {
    try {
      const { toolName, args, rootPath } = req.body
      console.log(`[LocalServer] Executing tool: ${toolName}`)

      let result: any = `Tool ${toolName} not implemented on local server`
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args

      switch (toolName) {
        case 'read_file': {
          const { path: filePath, maxBytes, startLine, endLine, ranges } = parsedArgs
          if (!filePath) throw new Error('path is required')

          const fileRes = await readTextFile(filePath, { maxBytes, startLine, endLine, ranges })
          result = { success: true, ...fileRes }
          break
        }
        case 'read_file_continuation': {
          const { path: filePath, afterLine, numLines, maxBytes } = parsedArgs
          if (!filePath) throw new Error('path is required')
          if (afterLine === undefined) throw new Error('afterLine is required')
          if (!numLines) throw new Error('numLines is required')

          const fileRes = await readFileContinuation(filePath, afterLine, numLines, { maxBytes })
          result = { success: true, ...fileRes }
          break
        }
        case 'read_files': {
          const { paths, baseDir, maxBytes, startLine, endLine } = parsedArgs
          if (!paths) throw new Error('paths are required')

          const filesRes = await readMultipleTextFiles(paths, { baseDir, maxBytes, startLine, endLine })
          result = { success: true, ...filesRes }
          break
        }
        case 'create_file': {
          const { path: filePath, content, directory, createParentDirs, overwrite, executable } = parsedArgs
          if (!filePath) throw new Error('path is required')

          result = await createTextFile(filePath, content, { directory, createParentDirs, overwrite, executable })
          break
        }
        case 'edit_file': {
          const {
            path: filePath,
            operation,
            searchPattern,
            replacement,
            content,
            createBackup,
            encoding,
            enableFuzzyMatching,
            fuzzyThreshold,
            preserveIndentation,
          } = parsedArgs
          if (!filePath) throw new Error('path is required')

          result = await editFile(filePath, operation, {
            searchPattern,
            replacement,
            content,
            createBackup,
            encoding,
            enableFuzzyMatching,
            fuzzyThreshold,
            preserveIndentation,
          })
          break
        }
        case 'delete_file': {
          const { path: filePath, allowedExtensions } = parsedArgs
          if (!filePath) throw new Error('path is required')

          if (allowedExtensions) {
            await safeDeleteFile(filePath, allowedExtensions)
          } else {
            await deleteFile(filePath)
          }
          result = { success: true, path: filePath }
          break
        }
        case 'directory': {
          const { path: dirPath, maxDepth, includeHidden, includeSizes } = parsedArgs
          // Use rootPath from request if dirPath is not absolute or not provided?
          // The directory tool logic resolves against process.cwd() if relative.
          // If rootPath is sent by client, maybe we should change CWD?
          // But let's just pass the path.

          const structure = await extractDirectoryStructure(dirPath || rootPath || '.', {
            maxDepth,
            includeHidden,
            includeSizes,
          })
          result = { success: true, structure, path: dirPath }
          break
        }
        case 'glob': {
          const { pattern, cwd, ignore, dot, absolute } = parsedArgs
          if (!pattern) throw new Error('pattern is required')

          const actualCwd = cwd || rootPath // Prefer explicit cwd, fallback to rootPath
          result = await globSearch(pattern, { cwd: actualCwd, ignore, dot, absolute })
          break
        }
        case 'ripgrep': {
          const {
            regex,
            pattern,
            path: dirPath,
            glob: globPattern,
            case_insensitive,
            lineNumbers,
            count,
            filesWithMatches,
            maxCount,
            hidden,
            noIgnore,
            contextLines,
          } = parsedArgs
          const query = regex || pattern
          if (!query) throw new Error('pattern or regex is required')

          const searchPath = dirPath || rootPath || '.'

          // Map parameters to new tool options (snake_case from some clients to camelCase)
          // Client seems to send 'case_insensitive' (snake), but new tool uses 'caseSensitive' (camel, boolean inverted)
          // Check old localServer impl: it used `caseSensitive: !case_insensitive`

          result = await ripgrepSearch(query, searchPath, {
            caseSensitive: !case_insensitive,
            glob: globPattern,
            lineNumbers,
            count,
            filesWithMatches,
            maxCount,
            hidden,
            noIgnore,
            contextLines,
          })
          break
        }
        case 'browse_web': {
          const { url, ...options } = parsedArgs
          if (!url) throw new Error('url is required')
          result = await browseWeb(url, options)
          break
        }
        default:
          console.warn(`[LocalServer] Unknown tool: ${toolName}`)
          result = { success: false, error: `Unknown tool: ${toolName}` }
      }

      res.json({ result })
    } catch (error) {
      console.error('[LocalServer] Tool execution error:', error)
      const msg = error instanceof Error ? error.message : String(error)
      res.json({ result: { success: false, error: msg } }) // Consistent error format?
    }
  })

  // Stats endpoint
  app.get('/api/sync/stats', (_req, res) => {
    try {
      const stats = {
        projects: db!.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number },
        conversations: db!.prepare('SELECT COUNT(*) as count FROM conversations').get() as { count: number },
        messages: db!.prepare('SELECT COUNT(*) as count FROM messages').get() as { count: number },
        attachments: db!.prepare('SELECT COUNT(*) as count FROM message_attachments').get() as { count: number },
      }
      res.json(stats)
    } catch (error) {
      console.error('[LocalServer] Error getting stats:', error)
      res.status(500).json({ error: 'Failed to get stats' })
    }
  })

  // Update conversation research note
  app.patch('/api/conversations/:id/research-note', (req, res) => {
    try {
      const { id } = req.params
      const { researchNote } = req.body

      const normalizedResearchNote =
        typeof researchNote === 'string' && researchNote.trim().length === 0 ? null : (researchNote as string | null)

      statements.updateConversationResearchNote.run(normalizedResearchNote, id)
      const updated = statements.getConversationById.get(id)

      if (updated) {
        res.json(updated)
      } else {
        res.status(404).json({ error: 'Conversation not found' })
      }
    } catch (error) {
      console.error('[LocalServer] Error updating research note:', error)
      res.status(500).json({ error: 'Failed to update research note' })
    }
  })

  // Update conversation cwd
  app.patch('/api/conversations/:id/cwd', (req, res) => {
    try {
      const { id } = req.params
      const { cwd } = req.body

      const normalizedCwd = typeof cwd === 'string' && cwd.trim().length === 0 ? null : (cwd as string | null)

      statements.updateConversationCwd.run(normalizedCwd, id)
      const updated = statements.getConversationById.get(id)

      if (updated) {
        res.json(updated)
      } else {
        res.status(404).json({ error: 'Conversation not found' })
      }
    } catch (error) {
      console.error('[LocalServer] Error updating cwd:', error)
      res.status(500).json({ error: 'Failed to update cwd' })
    }
  })

  // Local-only API endpoints
  app.get('/api/local/projects', (req, res) => {
    try {
      const userId = (req.query.userId as string) || ''
      if (!userId) {
        res.status(400).json({ error: 'userId query param required' })
        return
      }
      const projects = statements.getLocalProjects.all(userId)
      res.json(projects)
    } catch (error) {
      console.error('[LocalServer] Error fetching local projects:', error)
      res.status(500).json({ error: 'Failed to fetch local projects' })
    }
  })

  app.post('/api/local/projects', (req, res) => {
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
      console.error('[LocalServer] Error creating local project:', error)
      res.status(500).json({ error: 'Failed to create local project' })
    }
  })

  // GET /api/local/conversations?userId=xxx
  app.get('/api/local/conversations', (req, res) => {
    try {
      const userId = req.query.userId as string
      console.log('[LocalServer] 📋 GET /api/local/conversations - userId:', userId)
      if (!userId) {
        console.log('[LocalServer] ❌ Missing userId parameter')
        res.status(400).json({ error: 'userId required' })
        return
      }
      const conversations = statements.getLocalConversations.all(userId)
      console.log('[LocalServer] ✅ Found', conversations.length, 'local conversations for user:', userId)
      console.log('[LocalServer] 📊 Conversations:', JSON.stringify(conversations, null, 2))
      res.json(conversations)
    } catch (error) {
      console.error('[LocalServer] ❌ Error fetching local conversations:', error)
      res.status(500).json({ error: 'Failed to fetch conversations' })
    }
  })

  // POST /api/local/conversations
  app.post('/api/local/conversations', (req, res) => {
    try {
      const { id, user_id, project_id, title, system_prompt, conversation_context } = req.body
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
        'unknown', // model_name
        system_prompt || null,
        conversation_context || null,
        null, // research_note
        null, // cwd
        'local', // storage_mode
        now,
        now
      )

      const created = statements.getConversationById.get(conversationId)
      res.status(201).json(created)
    } catch (error) {
      console.error('[LocalServer] Error creating local conversation:', error)
      res.status(500).json({ error: 'Failed to create conversation' })
    }
  })

  // PATCH /api/local/conversations/:id
  app.patch('/api/local/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      const { title } = req.body

      if (!title) {
        res.status(400).json({ error: 'title required' })
        return
      }

      statements.updateConversationTitle.run(title, id)
      const updated = statements.getConversationById.get(id)

      if (!updated) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      res.json(updated)
    } catch (error) {
      console.error('[LocalServer] Error updating conversation:', error)
      res.status(500).json({ error: 'Failed to update conversation' })
    }
  })

  // GET /api/local/conversations/:id
  app.get('/api/local/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      console.log('[LocalServer] 🔍 GET /api/local/conversations/:id - conversationId:', id)
      const conversation = statements.getConversationById.get(id)

      if (!conversation) {
        console.log('[LocalServer] ❌ Conversation not found:', id)
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      console.log('[LocalServer] ✅ Found conversation:', JSON.stringify(conversation, null, 2))
      res.json(conversation)
    } catch (error) {
      console.error('[LocalServer] ❌ Error fetching conversation:', error)
      res.status(500).json({ error: 'Failed to fetch conversation' })
    }
  })

  // DELETE /api/local/conversations/:id
  app.delete('/api/local/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      console.log('[LocalServer] 🗑️ DELETE /api/local/conversations/:id - conversationId:', id)
      statements.deleteConversation.run(id)
      console.log('[LocalServer] ✅ Conversation deleted:', id)
      res.json({ success: true })
    } catch (error) {
      console.error('[LocalServer] ❌ Error deleting conversation:', error)
      res.status(500).json({ error: 'Failed to delete conversation' })
    }
  })

  // GET /api/local/conversations/:id/messages
  app.get('/api/local/conversations/:id/messages', (req, res) => {
    try {
      const { id } = req.params
      console.log('[LocalServer] 💬 GET /api/local/conversations/:id/messages - conversationId:', id)
      const messages = statements.getMessagesByConversationId.all(id)
      console.log('[LocalServer] ✅ Found', messages.length, 'messages for conversation:', id)
      if (messages.length > 0) {
        console.log('[LocalServer] 📊 First message:', JSON.stringify(messages[0], null, 2))
        console.log('[LocalServer] 📊 Last message:', JSON.stringify(messages[messages.length - 1], null, 2))
      }
      res.json(messages)
    } catch (error) {
      console.error('[LocalServer] ❌ Error fetching messages:', error)
      res.status(500).json({ error: 'Failed to fetch messages' })
    }
  })

  // GET /api/local/conversations/:id/messages/tree
  app.get('/api/local/conversations/:id/messages/tree', (req, res) => {
    try {
      const { id } = req.params
      console.log('[LocalServer] 🌲 GET /api/local/conversations/:id/messages/tree - conversationId:', id)
      const messages = statements.getMessagesByConversationId.all(id)
      console.log('[LocalServer] 📦 Raw messages fetched:', messages.length)

      // Parse JSON fields (children_ids, tool_calls, content_blocks)
      const normalizedMessages = messages.map((msg: any) => ({
        ...msg,
        children_ids: msg.children_ids ? JSON.parse(msg.children_ids) : [],
        tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
        content_blocks: msg.content_blocks ? JSON.parse(msg.content_blocks) : null,
      }))

      console.log('[LocalServer] ✨ Normalized messages:', normalizedMessages.length)
      if (normalizedMessages.length > 0) {
        console.log('[LocalServer] 📊 Sample normalized message:', JSON.stringify(normalizedMessages[0], null, 2))
      }

      const treeData = buildMessageTree(normalizedMessages)
      console.log('[LocalServer] 🌳 Tree built successfully:', treeData ? 'Has tree' : 'No tree')
      if (treeData) {
        console.log(
          '[LocalServer] 🌳 Tree root:',
          JSON.stringify({ id: treeData.id, childCount: treeData.children.length }, null, 2)
        )
      }

      res.json({ messages: normalizedMessages, tree: treeData })
    } catch (error) {
      console.error('[LocalServer] ❌ Error fetching message tree:', error)
      res.status(500).json({ error: 'Failed to fetch message tree' })
    }
  })

  // PUT /api/local/messages/:id
  app.put('/api/local/messages/:id', (req, res) => {
    try {
      const { id } = req.params
      const { content, note, content_blocks } = req.body

      // Same logic as server route
      let finalContent = content
      if (!content && content_blocks) {
        const textBlocks = Array.isArray(content_blocks) ? content_blocks.filter((b: any) => b.type === 'text') : []
        finalContent = textBlocks.map((b: any) => b.text || '').join('\n')
      }

      const contentBlocksJson = content_blocks ? JSON.stringify(content_blocks) : null

      // Check if message exists
      const existing = statements.getMessageById.get(id)
      if (!existing) {
        res.status(404).json({ error: 'Message not found' })
        return
      }

      // Update message
      statements.updateMessage.run(
        finalContent || existing.content,
        note || existing.note,
        contentBlocksJson || existing.content_blocks,
        id
      )

      const updated = statements.getMessageById.get(id)
      res.json(updated)
    } catch (error) {
      console.error('[LocalServer] Error updating message:', error)
      res.status(500).json({ error: 'Failed to update message' })
    }
  })

  // DELETE /api/local/messages/:id
  app.delete('/api/local/messages/:id', (req, res) => {
    try {
      const { id } = req.params
      statements.deleteMessage.run(id)
      res.json({ success: true })
    } catch (error) {
      console.error('[LocalServer] Error deleting message:', error)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })
}

// Start the server
export function startLocalServer(port: number = 3002, dbPath?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const actualDbPath = dbPath || path.join(process.cwd(), 'data', 'local-sync.db')
      initializeLocalDatabase(actualDbPath)
      setupServer()

      server = app.listen(port, '0.0.0.0', () => {
        console.log(`[LocalServer] Local sync server running on http://0.0.0.0:${port}`)
        console.log(`[LocalServer] Database path: ${actualDbPath}`)

        // Initialize WebSocket Server after HTTP server is running
        initializeWebSocketServer(server)

        resolve()
      })

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          console.error(`[LocalServer] Port ${port} is already in use`)
          reject(new Error(`Port ${port} is already in use`))
        } else {
          console.error('[LocalServer] Server error:', err)
          reject(err)
        }
      })
    } catch (error) {
      console.error('[LocalServer] Failed to start:', error)
      reject(error)
    }
  })
}

// Stop the server
export function stopLocalServer(): Promise<void> {
  return new Promise(resolve => {
    if (server) {
      // Close WebSocket server first
      if (wss) {
        wss.close(() => {
          console.log('[LocalServer] WebSocket server closed')
        })
        // Also close all client connections
        clients.forEach(client => {
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.close()
          }
        })
        clients.clear()
      }

      server.close(() => {
        console.log('[LocalServer] Server stopped')
        if (db) {
          db.close()
          db = null
        }
        server = null
        resolve()
      })
    } else {
      resolve()
    }
  })
}

// Export for direct usage
export { app, db }
