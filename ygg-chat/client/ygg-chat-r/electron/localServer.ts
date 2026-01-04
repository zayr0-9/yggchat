// electron/localServer.ts
// Embedded local SQLite server for dual-sync in Electron mode
// This server runs on port 3002 and handles sync operations from Railway to local SQLite

import Database from 'better-sqlite3'
import cors from 'cors'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { WebSocket, WebSocketServer } from 'ws'

// Tool imports
import { runBashCommand } from './tools/bash.js'
import { browseWeb } from './tools/browseWeb.js'
import { CCResponse, executeClaudeCode, getAvailableSlashCommands, getSession, setSession } from './tools/claudeCode.js'
import { createTextFile } from './tools/createFile.js'
import { deleteFile, safeDeleteFile } from './tools/deleteFile.js'
import { extractDirectoryStructure } from './tools/directory.js'
import { editFile } from './tools/editFile.js'
import { globSearch } from './tools/glob.js'
import { readFileContinuation, readTextFile } from './tools/readFile.js'
import { readMultipleTextFiles } from './tools/readFiles.js'
import { ripgrepSearch } from './tools/ripgrep.js'
import { generateTodoId, getTodoStorageDirectory, listTodoIds, readTodoList, writeTodoList } from './tools/todoMd.js'
import htmlRenderer from './tools/htmlRenderer.js'

/**
 * Validates and resolves a path to ensure it's within the allowed rootPath scope.
 * Prevents directory traversal attacks.
 */
function validateAndResolvePath(
  inputPath: string | undefined,
  rootPath: string | undefined,
  fallbackToRoot = true
): string {
  // If no input path provided
  if (!inputPath) {
    if (fallbackToRoot && rootPath) return rootPath
    return '.'
  }

  // Detect if we should use POSIX logic (WSL paths on Windows)
  // If on Windows, but paths start with '/', treat as WSL/Linux path
  const usePosix =
    process.platform === 'win32' &&
    ((inputPath && inputPath.startsWith('/')) || (rootPath && rootPath.startsWith('/')))

  const pathModule = usePosix ? path.posix : path

  // If no rootPath constraint, just resolve the path
  if (!rootPath) {
    return pathModule.isAbsolute(inputPath) ? pathModule.normalize(inputPath) : pathModule.resolve(inputPath)
  }

  // Resolve to absolute path
  const resolvedPath = pathModule.isAbsolute(inputPath)
    ? pathModule.normalize(inputPath)
    : pathModule.resolve(rootPath, inputPath)

  const normalizedRoot = pathModule.normalize(rootPath)

  // Security: Ensure resolved path is within rootPath scope
  if (!resolvedPath.startsWith(normalizedRoot + pathModule.sep) && resolvedPath !== normalizedRoot) {
    throw new Error(`Path must be within workspace: ${rootPath}`)
  }

  return resolvedPath
}

const app = express()
let server: any = null
let wss: WebSocketServer | null = null
let db: Database.Database | null = null
let statements: any = {}
let currentDbPath: string | null = null

// Initialize database at specified path
function initializeLocalDatabase(dbPath: string) {
  console.log('[LocalServer] Initializing database at:', dbPath)
  currentDbPath = dbPath

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

  // Triggers to maintain children_ids integrity
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS messages_children_insert AFTER INSERT ON messages
    WHEN NEW.parent_id IS NOT NULL
    BEGIN
      UPDATE messages
      SET children_ids = (
        SELECT CASE
          WHEN children_ids = '[]' OR children_ids = '' THEN '["' || NEW.id || '"]'
          ELSE SUBSTR(children_ids, 1, LENGTH(children_ids)-1) || ',"' || NEW.id || '"]'
        END
        FROM messages WHERE id = NEW.parent_id
      )
      WHERE id = NEW.parent_id;
    END;
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
    updateConversationProjectId: db.prepare(
      'UPDATE conversations SET project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
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
    getAttachmentsByMessageId: db.prepare(`
        SELECT ma.*
        FROM message_attachment_links mal
        JOIN message_attachments ma ON ma.id = mal.attachment_id
        WHERE mal.message_id = ?
        ORDER BY ma.created_at ASC
      `),
    getAttachmentById: db.prepare('SELECT * FROM message_attachments WHERE id = ?'),
    getAttachmentBySha256: db.prepare('SELECT * FROM message_attachments WHERE sha256 = ?'),

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
    // console.log('[LocalServer] Auto-creating user stub:', userId)
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
    // console.log('[LocalServer] Auto-creating project stub:', projectId)
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
    // console.log('[LocalServer] Auto-creating conversation stub:', conversationId)
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO conversations (id, project_id, user_id, title, model_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(conversationId, projectId || null, userId, 'Synced Conversation', 'unknown', now, now)
  }
}

// Helper to save generated images from image-generating models to local storage
async function saveGeneratedImage(
  messageId: string,
  imageUrl: string,
  mimeType: string = 'image/png'
): Promise<{ filePath: string; attachmentId: string } | null> {
  if (!db || !statements || !currentDbPath) {
    console.error('[LocalServer] Database not initialized for saving generated image')
    return null
  }

  try {
    // Download the image
    const response = await fetch(imageUrl)
    if (!response.ok) {
      console.error('[LocalServer] Failed to download image:', imageUrl, response.statusText)
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Calculate SHA256 for deduplication
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

    // Determine file extension and path
    const ext = mimeType.split('/')[1] || 'png'
    const fileName = `${sha256}.${ext}`
    const imagesDir = path.join(path.dirname(currentDbPath), 'generated_images')
    const filePath = path.join(imagesDir, fileName)

    // Ensure directory exists
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true })
    }

    // Write file (skip if already exists - deduplication)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer)
    }

    const now = new Date().toISOString()

    // Check if attachment with this sha256 already exists (deduplication)
    const existingAttachment = statements.getAttachmentBySha256.get(sha256) as
      | { id: string; file_path: string }
      | undefined

    let attachmentId: string

    if (existingAttachment) {
      // Reuse existing attachment - just create a link to it
      attachmentId = existingAttachment.id
      console.log('[LocalServer] Reusing existing generated image attachment:', attachmentId)
    } else {
      // Create new attachment record
      attachmentId = uuidv4()
      statements.upsertAttachment.run(
        attachmentId,
        messageId,
        'image',
        mimeType,
        'file',
        null, // url
        filePath,
        null, // width
        null, // height
        buffer.length,
        sha256,
        now
      )
      console.log('[LocalServer] Created new generated image attachment:', attachmentId)
    }

    // Link attachment to message (INSERT OR IGNORE handles duplicate links gracefully)
    statements.linkAttachment.run(uuidv4(), messageId, attachmentId, now)

    console.log('[LocalServer] Linked generated image to message:', messageId)
    return { filePath, attachmentId }
  } catch (error) {
    console.error('[LocalServer] Error saving generated image:', error)
    return null
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
  // console.log('[LocalServer] Initializing WebSocket Server on /ide-context')

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
    // console.log(`[LocalServer] Client connected: ${client.type} (${client.id})`)

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
              // console.warn('[LocalServer] No extensions available to handle context request')
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
      // console.log(`[LocalServer] Client disconnected: ${client.type} (${client.id})`)
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
      // console.log('[LocalServer] Synced user:', id)
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
      // console.log('[LocalServer] Synced project:', id, '- storage_mode:', storage_mode || 'cloud')
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
      // console.log('[LocalServer] Deleted project:', id)
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

      // console.log(
      //   '[LocalServer] 🔄 POST /api/sync/conversation - conversationId:',
      //   id,
      //   'title:',
      //   title,
      //   'storage_mode:',
      //   storage_mode
      // )

      // Handle owner_id -> user_id mapping (Railway sends owner_id)
      const effectiveUserId = user_id || owner_id
      if (!effectiveUserId) {
        // console.log('[LocalServer] ❌ Missing user_id or owner_id')
        res.status(400).json({ error: 'Missing user_id or owner_id' })
        return
      }

      // console.log('[LocalServer] 👤 Effective userId:', effectiveUserId, 'projectId:', project_id)

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
      // console.log('[LocalServer] ✅ Synced conversation successfully:', id, '- title:', title)

      // Verify the conversation was saved
      // const saved = statements.getConversationById.get(id)
      // if (saved) {
      //   console.log(
      //     '[LocalServer] ✅ Verified conversation exists in DB:',
      //     id,
      //     '- storage_mode:',
      //     (saved as any).storage_mode
      //   )
      // } else {
      //   console.log('[LocalServer] ⚠️  Warning: Conversation not found after save:', id)
      // }

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
      // console.log('[LocalServer] Deleted conversation:', id)
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

      // console.log(
      //   '[LocalServer] 💾 POST /api/sync/message - messageId:',
      //   id,
      //   'conversationId:',
      //   conversation_id,
      //   'role:',
      //   role
      // )
      // console.log('[LocalServer] 📝 Message content preview:', content?.substring(0, 50))

      if (!conversation_id) {
        // console.log('[LocalServer] ❌ Missing conversation_id')
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

      // Process any image content_blocks and save them locally
      const parsedBlocks = typeof content_blocks === 'string' ? JSON.parse(content_blocks) : content_blocks
      if (Array.isArray(parsedBlocks)) {
        const imageBlocks = parsedBlocks.filter((block: any) => block.type === 'image' && block.url)
        for (const imageBlock of imageBlocks) {
          // Save image asynchronously (don't block response)
          saveGeneratedImage(id, imageBlock.url, imageBlock.mimeType || 'image/png').catch(err => {
            console.error('[LocalServer] Failed to save generated image:', err)
          })
        }
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
      // console.log('[LocalServer] Deleted message:', id)
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

      let attachmentId = id

      // Check if attachment with this sha256 already exists (deduplication)
      if (sha256) {
        const existingAttachment = statements.getAttachmentBySha256.get(sha256) as
          | { id: string }
          | undefined

        if (existingAttachment && existingAttachment.id !== id) {
          // Attachment with same content already exists - reuse it
          attachmentId = existingAttachment.id
          console.log('[LocalServer] Reusing existing attachment for sync:', attachmentId)
        } else if (!existingAttachment) {
          // Create new attachment
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
            sha256,
            created_at || new Date().toISOString()
          )
        }
        // If existingAttachment.id === id, do nothing (already exists with same ID)
      } else {
        // No sha256 provided, just upsert by ID
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
      }

      // Link attachment to message if message_id provided
      if (message_id) {
        const linkId = uuidv4()
        statements.linkAttachment.run(linkId, message_id, attachmentId, new Date().toISOString())
      }

      // console.log('[LocalServer] Synced attachment:', attachmentId)
      res.json({ success: true, id: attachmentId })
    } catch (error) {
      console.error('[LocalServer] Error syncing attachment:', error)
      res.status(500).json({ error: 'Failed to sync attachment' })
    }
  })

  // Save base64 image attachments for a message (used by local-only mode)
  app.post('/api/local/attachments/save-base64', (req, res) => {
    try {
      const { messageId, attachments } = req.body as {
        messageId: string
        attachments: Array<{
          dataUrl: string
          name?: string
          type?: string
          size?: number
        }>
      }

      if (!messageId || !attachments || !Array.isArray(attachments) || attachments.length === 0) {
        res.status(400).json({ error: 'messageId and attachments array required' })
        return
      }

      if (!db || !statements || !currentDbPath) {
        res.status(500).json({ error: 'Database not initialized' })
        return
      }

      const savedAttachments: Array<{ id: string; file_path: string }> = []
      const imagesDir = path.join(path.dirname(currentDbPath), 'user_images')

      // Ensure directory exists
      if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true })
      }

      for (const attachment of attachments) {
        try {
          const { dataUrl } = attachment

          // Parse data URL: data:image/png;base64,xxxxx
          const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
          if (!matches) {
            console.warn('[LocalServer] Invalid data URL format, skipping')
            continue
          }

          const mimeType = matches[1]
          const base64Data = matches[2]
          const buffer = Buffer.from(base64Data, 'base64')

          // Calculate SHA256 for deduplication
          const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')

          // Determine file extension
          const ext = mimeType.split('/')[1] || 'png'
          const fileName = `${sha256}.${ext}`
          const filePath = path.join(imagesDir, fileName)

          // Write file (skip if already exists - deduplication)
          if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, buffer)
          }

          const now = new Date().toISOString()

          // Check if attachment with this sha256 already exists (deduplication)
          const existingAttachment = statements.getAttachmentBySha256.get(sha256) as
            | { id: string; file_path: string }
            | undefined

          let attachmentId: string

          if (existingAttachment) {
            // Reuse existing attachment - just create a link to it
            attachmentId = existingAttachment.id
            console.log('[LocalServer] Reusing existing attachment:', attachmentId, 'for message:', messageId)
          } else {
            // Create new attachment record
            attachmentId = uuidv4()
            statements.upsertAttachment.run(
              attachmentId,
              messageId,
              'image',
              mimeType,
              'file',
              null, // url
              filePath,
              null, // width
              null, // height
              buffer.length,
              sha256,
              now
            )
            console.log('[LocalServer] Created new attachment:', attachmentId)
          }

          // Link attachment to message (INSERT OR IGNORE handles duplicate links gracefully)
          statements.linkAttachment.run(uuidv4(), messageId, attachmentId, now)

          savedAttachments.push({ id: attachmentId, file_path: filePath })
          console.log('[LocalServer] Linked attachment to message:', messageId)
        } catch (attachmentError) {
          console.error('[LocalServer] Error saving individual attachment:', attachmentError)
        }
      }

      res.json({ success: true, attachments: savedAttachments })
    } catch (error) {
      console.error('[LocalServer] Error saving base64 attachments:', error)
      res.status(500).json({ error: 'Failed to save attachments' })
    }
  })

  // Serve local attachment file by ID
  app.get('/api/local/attachments/:id/file', (req, res) => {
    try {
      const { id } = req.params

      if (!db || !statements) {
        res.status(500).json({ error: 'Database not initialized' })
        return
      }

      const attachment = statements.getAttachmentById.get(id) as
        | {
          id: string
          file_path: string | null
          url: string | null
          mime_type: string
        }
        | undefined

      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' })
        return
      }

      // If it's a URL-based attachment, redirect
      if (attachment.url) {
        res.redirect(attachment.url)
        return
      }

      // If it's a file-based attachment, serve the file
      if (attachment.file_path) {
        if (!fs.existsSync(attachment.file_path)) {
          res.status(404).json({ error: 'File not found on disk' })
          return
        }

        res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=31536000') // Cache for 1 year (content-addressed)
        const stream = fs.createReadStream(attachment.file_path)
        stream.pipe(res)
        return
      }

      res.status(404).json({ error: 'No file path or URL for attachment' })
    } catch (error) {
      console.error('[LocalServer] Error serving attachment file:', error)
      res.status(500).json({ error: 'Failed to serve attachment' })
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
      // console.log('[LocalServer] Synced provider cost:', id)
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
      // console.log(
      //   `[LocalServer] Batch sync completed: ${results.filter(r => r.success).length}/${operations.length} succeeded`
      // )
      res.json({ success: true, results })
    } catch (error) {
      console.error('[LocalServer] Batch sync failed:', error)
      res.status(500).json({ error: 'Batch sync failed', results })
    }
  })

  // Tool Execution Endpoint
  app.post('/api/tools/execute', async (req, res) => {
    try {
      const { toolName, args, rootPath, operationMode } = req.body
      // console.log(`[LocalServer] Executing tool: ${toolName} (operationMode: ${operationMode || 'execute'})`)

      let result: any = `Tool ${toolName} not implemented on local server`
      const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args

      switch (toolName) {
        case 'html_renderer': {
          const { html, allowUnsafe } = parsedArgs
          if (!html) throw new Error('html is required')
          const rendered = await htmlRenderer.run({ html, allowUnsafe })
          result = rendered
          break
        }
        case 'read_file': {
          const { path: filePath, maxBytes, startLine, endLine, ranges } = parsedArgs
          if (!filePath) throw new Error('path is required')

          const fileRes = await readTextFile(filePath, { maxBytes, startLine, endLine, ranges, cwd: rootPath })
          result = { success: true, ...fileRes }
          break
        }
        case 'read_file_continuation': {
          const { path: filePath, afterLine, numLines, maxBytes } = parsedArgs
          if (!filePath) throw new Error('path is required')
          if (afterLine === undefined) throw new Error('afterLine is required')
          if (!numLines) throw new Error('numLines is required')

          const fileRes = await readFileContinuation(filePath, afterLine, numLines, { maxBytes, cwd: rootPath })
          result = { success: true, ...fileRes }
          break
        }
        case 'read_files': {
          const { paths, baseDir, maxBytes, startLine, endLine } = parsedArgs
          if (!paths) throw new Error('paths are required')

          const filesRes = await readMultipleTextFiles(paths, { baseDir, maxBytes, startLine, endLine, cwd: rootPath })
          result = { success: true, files: filesRes }
          break
        }
        case 'create_file': {
          const { path: filePath, content, directory, createParentDirs, overwrite, executable } = parsedArgs
          if (!filePath) throw new Error('path is required')

          result = await createTextFile(filePath, content, {
            directory,
            createParentDirs,
            overwrite,
            executable,
            operationMode,
            cwd: rootPath,
          })
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
            operationMode,
            cwd: rootPath,
          })
          break
        }
        case 'delete_file': {
          const { path: filePath, allowedExtensions } = parsedArgs
          if (!filePath) throw new Error('path is required')

          if (allowedExtensions) {
            await safeDeleteFile(filePath, allowedExtensions, operationMode, rootPath)
          } else {
            await deleteFile(filePath, operationMode, rootPath)
          }
          result = { success: true, path: filePath }
          break
        }
        case 'directory': {
          const { path: dirPath, maxDepth, includeHidden, includeSizes } = parsedArgs

          // Validate and resolve path (security: must be within rootPath)
          const finalDirPath = validateAndResolvePath(dirPath, rootPath)

          const structure = await extractDirectoryStructure(finalDirPath, {
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

          // Validate cwd (security: must be within rootPath)
          const actualCwd = validateAndResolvePath(cwd, rootPath)
          result = await globSearch(pattern, { cwd: actualCwd, ignore, dot, absolute })
          break
        }
        case 'ripgrep': {
          const {
            regex,
            pattern,
            path: dirPath,
            searchPath: altSearchPath, // Accept searchPath as alias for path
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

          // Validate and resolve path (security: must be within rootPath)
          const finalSearchPath = validateAndResolvePath(dirPath || altSearchPath, rootPath)

          result = await ripgrepSearch(query, finalSearchPath, {
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
        case 'bash': {
          const { command, cwd, env, timeoutMs, maxOutputChars } = parsedArgs
          if (!command) throw new Error('command is required')

          // Validate cwd (security: must be within rootPath)
          const finalCwd = validateAndResolvePath(cwd, rootPath)

          result = await runBashCommand(command, {
            cwd: finalCwd,
            env,
            timeoutMs,
            maxOutputChars,
          })
          break
        }
        case 'todo_list': {
          const { action, id, content } = parsedArgs
          switch (action) {
            case 'list': {
              const ids = await listTodoIds()
              result = { success: true, ids }
              break
            }
            case 'read': {
              if (!id) throw new Error('id is required for todo_list read')
              const data = await readTodoList(id)
              result = { success: true, ...data }
              break
            }
            case 'write': {
              if (content === undefined) throw new Error('content is required for todo_list write')
              const written = await writeTodoList(content)
              result = { success: true, ...written }
              break
            }
            case 'generate_id': {
              const newId = await generateTodoId()
              result = { success: true, id: newId }
              break
            }
            case 'directory': {
              const dir = getTodoStorageDirectory()
              result = { success: true, directory: dir }
              break
            }
            default:
              throw new Error(`Unsupported todo_list action: ${action}`)
          }
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

  // Update conversation project
  app.patch('/api/conversations/:id/project', (req, res) => {
    try {
      const { id } = req.params
      const { projectId } = req.body

      // Require projectId to be explicitly provided (can be null to unassign, but must be present)
      if (!('projectId' in req.body)) {
        res.status(400).json({ error: 'projectId is required in request body' })
        return
      }

      // projectId can be null (unassign from project) or a valid project UUID string
      if (projectId !== null && typeof projectId !== 'string') {
        res.status(400).json({ error: 'projectId must be a string or null' })
        return
      }

      const existing = statements.getConversationById.get(id)
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      // If projectId is provided (not null), verify the project exists
      if (projectId !== null) {
        const project = statements.getProjectById.get(projectId)
        if (!project) {
          res.status(404).json({ error: 'Destination project not found' })
          return
        }
      }

      statements.updateConversationProjectId.run(projectId, id)
      const updated = statements.getConversationById.get(id)

      res.json(updated)
    } catch (error) {
      console.error('[LocalServer] Error updating project:', error)
      res.status(500).json({ error: 'Failed to update project' })
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

  // GET /api/local/projects/:id
  app.get('/api/local/projects/:id', (req, res) => {
    try {
      const { id } = req.params
      // console.log('[LocalServer] GET /api/local/projects/:id - projectId:', id)
      const project = statements.getProjectById.get(id)

      if (!project) {
        // console.log('[LocalServer] Project not found:', id)
        res.status(404).json({ error: 'Project not found' })
        return
      }

      // Verify it's actually a local project
      if (project.storage_mode !== 'local') {
        // console.log('[LocalServer] Project is not local storage:', id)
        res.status(404).json({ error: 'Project not found' })
        return
      }

      // console.log('[LocalServer] Found local project:', id)
      res.json(project)
    } catch (error) {
      console.error('[LocalServer] Error fetching local project:', error)
      res.status(500).json({ error: 'Failed to fetch project' })
    }
  })

  // PATCH /api/local/projects/:id
  app.patch('/api/local/projects/:id', (req, res) => {
    try {
      const { id } = req.params
      const { name, context, system_prompt } = req.body

      const existing = statements.getProjectById.get(id) as any
      if (!existing) {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      // Verify it's actually a local project
      if (existing.storage_mode !== 'local') {
        res.status(404).json({ error: 'Project not found' })
        return
      }

      // Update only provided fields
      db!
        .prepare(
          `
        UPDATE projects SET 
          name = COALESCE(?, name),
          context = ?,
          system_prompt = ?,
          updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `
        )
        .run(
          name || existing.name,
          context !== undefined ? context : existing.context,
          system_prompt !== undefined ? system_prompt : existing.system_prompt,
          id
        )

      const updated = statements.getProjectById.get(id)
      // console.log('[LocalServer] Updated local project:', id)
      res.json(updated)
    } catch (error) {
      console.error('[LocalServer] Error updating local project:', error)
      res.status(500).json({ error: 'Failed to update project' })
    }
  })

  // PATCH /api/projects/:id/touch - Update project updated_at timestamp (for any project)
  // Called when a message is added to a conversation belonging to this project
  app.patch('/api/projects/:id/touch', (req, res) => {
    try {
      const { id } = req.params

      const existing = statements.getProjectById.get(id) as any
      if (!existing) {
        // Project doesn't exist locally - this is fine for cloud-only projects
        res.json({ success: true, id, touched: false, reason: 'project_not_found_locally' })
        return
      }

      // Update only the updated_at timestamp
      db!
        .prepare(
          `
        UPDATE projects SET
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `
        )
        .run(id)

      // console.log('[LocalServer] Touched project timestamp:', id)
      res.json({ success: true, id, touched: true })
    } catch (error) {
      console.error('[LocalServer] Error touching project timestamp:', error)
      res.status(500).json({ error: 'Failed to touch project timestamp' })
    }
  })

  // GET /api/local/conversations?userId=xxx
  app.get('/api/local/conversations', (req, res) => {
    try {
      const userId = req.query.userId as string
      // console.log('[LocalServer] 📋 GET /api/local/conversations - userId:', userId)
      if (!userId) {
        // console.log('[LocalServer] ❌ Missing userId parameter')
        res.status(400).json({ error: 'userId required' })
        return
      }
      const conversations = statements.getLocalConversations.all(userId)
      // console.log('[LocalServer] ✅ Found', conversations.length, 'local conversations for user:', userId)
      // console.log('[LocalServer] 📊 Conversations:', JSON.stringify(conversations, null, 2))
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
  // Handles: title, system_prompt, conversation_context, research_note, cwd
  app.patch('/api/local/conversations/:id', (req, res) => {
    try {
      const { id } = req.params
      const { title, system_prompt, conversation_context, research_note, cwd } = req.body

      const existing = statements.getConversationById.get(id) as any
      if (!existing) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      // Build dynamic update - only update fields that are provided (not undefined)
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
        updates.push('cwd = ?')
        values.push(cwd)
      }

      if (updates.length === 0) {
        // Nothing to update, just return existing
        res.json(existing)
        return
      }

      // Always update updated_at
      updates.push('updated_at = CURRENT_TIMESTAMP')
      values.push(id) // for WHERE clause

      const sql = `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`
      db!.prepare(sql).run(...values)

      const updated = statements.getConversationById.get(id)
      // console.log('[LocalServer] Updated local conversation:', id, '- fields:', Object.keys(req.body).join(', '))
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
      // console.log('[LocalServer] 🔍 GET /api/local/conversations/:id - conversationId:', id)
      const conversation = statements.getConversationById.get(id)

      if (!conversation) {
        // console.log('[LocalServer] ❌ Conversation not found:', id)
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      // console.log('[LocalServer] ✅ Found conversation:', JSON.stringify(conversation, null, 2))
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
      // console.log('[LocalServer] 🗑️ DELETE /api/local/conversations/:id - conversationId:', id)
      statements.deleteConversation.run(id)
      // console.log('[LocalServer] ✅ Conversation deleted:', id)
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
      // console.log('[LocalServer] 💬 GET /api/local/conversations/:id/messages - conversationId:', id)
      const messages = statements.getMessagesByConversationId.all(id)
      // console.log('[LocalServer] ✅ Found', messages.length, 'messages for conversation:', id)
      // if (messages.length > 0) {
      //   console.log('[LocalServer] 📊 First message:', JSON.stringify(messages[0], null, 2))
      //   console.log('[LocalServer] 📊 Last message:', JSON.stringify(messages[messages.length - 1], null, 2))
      // }
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
      // console.log('[LocalServer] 🌲 GET /api/local/conversations/:id/messages/tree - conversationId:', id)
      const messages = statements.getMessagesByConversationId.all(id)
      // console.log('[LocalServer] 📦 Raw messages fetched:', messages.length)

      // Parse JSON fields (children_ids, tool_calls, content_blocks) and fetch attachments
      const normalizedMessages = messages.map((msg: any) => {
        // Fetch attachments for this message
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

      // console.log('[LocalServer] ✨ Normalized messages:', normalizedMessages.length)
      // if (normalizedMessages.length > 0) {
      //   console.log('[LocalServer] 📊 Sample normalized message:', JSON.stringify(normalizedMessages[0], null, 2))
      // }

      const treeData = buildMessageTree(normalizedMessages)
      // console.log('[LocalServer] 🌳 Tree built successfully:', treeData ? 'Has tree' : 'No tree')
      // if (treeData) {
      //   console.log(
      //     '[LocalServer] 🌳 Tree root:',
      //     JSON.stringify({ id: treeData.id, childCount: treeData.children.length }, null, 2)
      //   )
      // }

      // Get storage_mode from conversation
      const conversation = statements.getConversationById.get(id) as { storage_mode: string } | undefined
      const storage_mode = conversation?.storage_mode || 'local'

      res.json({ messages: normalizedMessages, tree: treeData, meta: { storage_mode } })
    } catch (error) {
      console.error('[LocalServer] ❌ Error fetching message tree:', error)
      res.status(500).json({ error: 'Failed to fetch message tree' })
    }
  })

  // POST /api/local/conversations/:id/messages/bulk
  // Bulk insert messages (for copying message chains to new conversation)
  app.post('/api/local/conversations/:id/messages/bulk', (req, res) => {
    try {
      const { id: conversationId } = req.params
      const { messages } = req.body as {
        messages: Array<{
          role: 'user' | 'assistant'
          content: string
          thinking_block?: string
          model_name?: string
          tool_calls?: string
          note?: string
          content_blocks?: any
        }>
      }

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'Messages array required' })
        return
      }

      // Verify conversation exists
      const conversation = statements.getConversationById.get(conversationId) as
        | { user_id: string; title?: string }
        | undefined
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' })
        return
      }

      const createdMessages: any[] = []
      let lastMessageId: string | null = null
      const now = new Date().toISOString()

      // Insert messages sequentially, maintaining parent-child relationships (linear chain)
      for (const msg of messages) {
        const messageId = uuidv4()

        statements.upsertMessage.run(
          messageId,
          conversationId,
          lastMessageId, // Parent is the previous message in the chain
          '[]', // children_ids starts empty (trigger will update parent's children_ids)
          msg.role,
          msg.content,
          msg.content, // plain_text_content
          msg.thinking_block || null,
          msg.tool_calls
            ? typeof msg.tool_calls === 'string'
              ? msg.tool_calls
              : JSON.stringify(msg.tool_calls)
            : null,
          null, // tool_call_id
          msg.model_name || 'unknown',
          msg.note || null,
          null, // ex_agent_session_id
          null, // ex_agent_type
          msg.content_blocks
            ? typeof msg.content_blocks === 'string'
              ? msg.content_blocks
              : JSON.stringify(msg.content_blocks)
            : null,
          now
        )

        const createdMessage = {
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
        }

        createdMessages.push(createdMessage)
        lastMessageId = messageId
      }

      // Auto-generate title if this is the first message chain and title is empty
      if (!conversation.title && messages.length > 0) {
        const firstContent = messages[0].content
        const title = firstContent.slice(0, 100) + (firstContent.length > 100 ? '...' : '')
        statements.updateConversationTitle.run(title, conversationId)
      }

      // Update conversation updated_at timestamp
      if (db) {
        db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, conversationId)
      }

      console.log(
        '[LocalServer] ✅ Bulk inserted',
        createdMessages.length,
        'messages into conversation:',
        conversationId
      )
      res.json({ messages: createdMessages })
    } catch (error) {
      console.error('[LocalServer] ❌ Error bulk inserting messages:', error)
      res.status(500).json({ error: 'Failed to bulk insert messages' })
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
      // console.log('[LocalServer] 🗑️ DELETE /api/local/messages/:id - messageId:', id)
      statements.deleteMessage.run(id)
      // console.log('[LocalServer] ✅ Message deleted:', id)
      res.json({ success: true })
    } catch (error) {
      console.error('[LocalServer] ❌ Error deleting message:', error)
      res.status(500).json({ error: 'Failed to delete message' })
    }
  })

  // POST /api/local/messages/deleteMany - Bulk delete messages
  app.post('/api/local/messages/deleteMany', (req, res) => {
    try {
      const { ids } = req.body
      // console.log('[LocalServer] 🗑️ POST /api/local/messages/deleteMany - ids:', ids)

      if (!Array.isArray(ids) || ids.length === 0) {
        res.status(400).json({ error: 'ids must be a non-empty array' })
        return
      }

      // Delete each message in a transaction
      if (!db) {
        res.status(500).json({ error: 'Database not initialized' })
        return
      }
      const deleteTransaction = db.transaction((messageIds: string[]) => {
        for (const id of messageIds) {
          statements.deleteMessage.run(id)
        }
      })

      deleteTransaction(ids)
      // console.log('[LocalServer] ✅ Bulk deleted', ids.length, 'messages')
      res.json({ deleted: ids.length })
    } catch (error) {
      console.error('[LocalServer] ❌ Error bulk deleting messages:', error)
      res.status(500).json({ error: 'Failed to bulk delete messages' })
    }
  })

  // ============================================================================
  // CLAUDE CODE AGENT ENDPOINTS
  // ============================================================================

  // Normalize CC SDK content blocks to ChatMessage format
  // CC SDK uses: { type: 'text', text: string }, { type: 'thinking', thinking: string }
  // ChatMessage expects: { type: 'text', content: string, index: number }, { type: 'thinking', content: string, index: number }
  function normalizeContentBlocksForStorage(blocks: any[]): any[] {
    return blocks.map((block, index) => {
      if (block.type === 'text') {
        return {
          type: 'text',
          index,
          content: block.text || block.content || '',
        }
      } else if (block.type === 'thinking') {
        return {
          type: 'thinking',
          index,
          content: block.thinking || block.content || '',
        }
      } else if (block.type === 'tool_use') {
        return {
          type: 'tool_use',
          index,
          id: block.id,
          name: block.name,
          input: block.input,
        }
      } else if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          index,
          tool_use_id: block.tool_use_id,
          content: block.content,
          is_error: block.isError || block.is_error || false,
        }
      }
      // Pass through unknown block types with index added
      return { ...block, index }
    })
  }

  // GET /api/agents/cc-session/:conversationId - Get CC session info
  app.get('/api/agents/cc-session/:conversationId', (req, res) => {
    try {
      const { conversationId } = req.params
      // console.log('[LocalServer] 🤖 GET /api/agents/cc-session/:conversationId -', conversationId)

      // Get conversation to retrieve cwd
      const conversation = statements.getConversationById.get(conversationId) as any
      if (!conversation) {
        res.json({ hasSession: false })
        return
      }

      const cwd = conversation.cwd || process.cwd()
      const sessionId = getSession(conversationId, cwd)

      if (!sessionId) {
        // Also check database for ex_agent messages with session ID
        const lastCCMessage = db!
          .prepare(
            `
          SELECT ex_agent_session_id, created_at 
          FROM messages 
          WHERE conversation_id = ? AND role = 'ex_agent' AND ex_agent_session_id IS NOT NULL
          ORDER BY created_at DESC LIMIT 1
        `
          )
          .get(conversationId) as { ex_agent_session_id: string; created_at: string } | undefined

        if (!lastCCMessage?.ex_agent_session_id) {
          res.json({ hasSession: false })
          return
        }

        // Count messages in this session
        const countResult = db!
          .prepare(
            `
          SELECT COUNT(*) as count FROM messages 
          WHERE conversation_id = ? AND ex_agent_session_id = ?
        `
          )
          .get(conversationId, lastCCMessage.ex_agent_session_id) as { count: number }

        res.json({
          hasSession: true,
          sessionId: lastCCMessage.ex_agent_session_id,
          lastMessageAt: lastCCMessage.created_at,
          messageCount: countResult.count,
          cwd: cwd,
        })
        return
      }

      res.json({
        hasSession: true,
        sessionId,
        cwd,
      })
    } catch (error) {
      console.error('[LocalServer] ❌ Error getting CC session:', error)
      res.status(500).json({ error: 'Failed to get CC session' })
    }
  })

  // GET /api/agents/cc-commands/:conversationId - Get available slash commands
  app.get('/api/agents/cc-commands/:conversationId', (req, res) => {
    try {
      const { conversationId } = req.params
      const { cwd: queryCwd } = req.query
      // console.log('[LocalServer] 🤖 GET /api/agents/cc-commands/:conversationId -', conversationId)

      // Get conversation to retrieve cwd if not provided in query
      const conversation = statements.getConversationById.get(conversationId) as any
      const cwd = (queryCwd as string) || conversation?.cwd || process.cwd()

      const commands = getAvailableSlashCommands(conversationId, cwd)
      // console.log(`[LocalServer] Found ${commands.length} slash commands for conversation ${conversationId}`)

      res.json({ commands })
    } catch (error) {
      console.error('[LocalServer] ❌ Error getting CC slash commands:', error)
      res.status(500).json({ error: 'Failed to get slash commands' })
    }
  })

  // POST /api/agents/cc-messages/:conversationId - Send message to Claude Code
  app.post('/api/agents/cc-messages/:conversationId', async (req, res) => {
    // console.log('\n🤖🤖🤖 [LocalServer] POST /api/agents/cc-messages - Claude Code message received')
    // console.log('🤖 Timestamp:', new Date().toISOString())
    // console.log('🤖 Conversation ID:', req.params.conversationId)

    const { conversationId } = req.params
    const {
      message,
      cwd: requestedCwd,
      permissionMode = 'bypassPermissions',
      resume,
      sessionId: providedSessionId,
      forkSession,
    } = req.body as {
      message: string
      cwd?: string
      permissionMode?: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits'
      resume?: boolean
      sessionId?: string
      forkSession?: boolean
    }

    if (!message) {
      res.status(400).json({ error: 'Message content required' })
      return
    }

    // Get conversation to retrieve cwd if not provided
    const conversation = statements.getConversationById.get(conversationId) as any
    const cwd = requestedCwd || conversation?.cwd || process.cwd()

    // console.log('🤖 CC Request:', {
    //   message: message.substring(0, 100),
    //   cwd,
    //   permissionMode,
    //   resume,
    // })

    // Set up SSE for streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    try {
      // Get last message for parent ID
      const lastMessage = statements.getLastMessageByConversationId.get(conversationId) as any
      const parentId = lastMessage?.id || null

      // Save user message to local SQLite
      const userMsgId = uuidv4()
      const now = new Date().toISOString()
      statements.upsertMessage.run(
        userMsgId,
        conversationId,
        parentId,
        '[]',
        'user',
        message,
        null,
        null,
        null,
        null,
        'user-input',
        null,
        null,
        null,
        null,
        now
      )
      // console.log('[LocalServer] 🤖 User message saved:', userMsgId)

      // Send user message event
      res.write(
        `data: ${JSON.stringify({ type: 'user_message', message: { id: userMsgId, role: 'user', content: message } })}\n\n`
      )

      // Determine session ID
      let sessionId = providedSessionId || getSession(conversationId, cwd)
      const shouldResume = resume !== undefined ? resume : !!sessionId

      // Accumulate content blocks for saving
      let contentBlocks: any[] = []
      let textParts: string[] = []
      let currentSessionId: string | null = sessionId || null

      // Stream callback
      const onStream = (data: any) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        } catch (error) {
          console.error('[LocalServer] Error writing stream data:', error)
        }
      }

      // Streaming chunk callback for real-time deltas
      const onStreamingChunk = async (chunk: any) => {
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              part: chunk.contentType === 'thinking' ? 'reasoning' : 'text',
              delta: chunk.delta || '',
              chunkType: chunk.type,
            })}\n\n`
          )
        } catch (error) {
          console.error('[LocalServer] Error writing streaming chunk:', error)
        }
      }

      // Response callback to accumulate content
      const onResponse = async (response: CCResponse) => {
        onStream(response)

        if (response.sessionId) {
          currentSessionId = response.sessionId
          setSession(conversationId, cwd, response.sessionId)
        }

        // ========================================================================
        // Universal Content Extractor - Capture content from ANY message type
        // ========================================================================

        // Extract text content from any response field
        let extractedContent: string | null = null

        // Priority 1: Check for result.result (slash commands)
        if (response.messageType === 'result' && response.result?.result) {
          extractedContent = response.result.result
          // console.log('[LocalServer] 🔍 Extracted content from result.result:', extractedContent.substring(0, 100))
        }

        // Priority 2: Check for system messages with content
        if (!extractedContent && response.messageType === 'system' && response.system) {
          // Some system messages may contain displayable content
          // Example: init messages with configuration info
          const systemContent = (response.system as any).content || (response.system as any).message
          if (systemContent && typeof systemContent === 'string') {
            extractedContent = systemContent
            // console.log('[LocalServer] 🔍 Extracted content from system message')
          }
        }

        // Priority 3: Check for any 'content' field in the response (catch-all)
        if (!extractedContent && (response as any).content) {
          const genericContent = (response as any).content
          if (typeof genericContent === 'string') {
            extractedContent = genericContent
            // console.log('[LocalServer] 🔍 Extracted content from generic content field')
          } else if (Array.isArray(genericContent)) {
            // If it's an array of blocks, try to extract text
            const textBlocks = genericContent.filter((b: any) => b.type === 'text')
            if (textBlocks.length > 0) {
              extractedContent = textBlocks.map((b: any) => b.text || b.content || '').join('\n')
              // console.log('[LocalServer] 🔍 Extracted content from content blocks array')
            }
          }
        }

        // If we extracted content from a non-message type, add it to contentBlocks
        if (extractedContent && response.messageType !== 'message') {
          const syntheticBlock = {
            type: 'text',
            text: extractedContent,
          }

          contentBlocks.push(syntheticBlock)
          textParts.push(extractedContent)

          // Stream extracted content to frontend immediately
          try {
            res.write(
              `data: ${JSON.stringify({
                type: 'chunk',
                part: 'text',
                delta: extractedContent,
                chunkType: `${response.messageType}_output`,
                sourceMessageType: response.messageType,
              })}\n\n`
            )
          } catch (error) {
            console.error('[LocalServer] Error streaming extracted content:', error)
          }
        }

        // ========================================================================
        // End Universal Content Extractor
        // ========================================================================

        if (response.messageType === 'message' && response.message) {
          for (const block of response.message.content) {
            contentBlocks.push(block)
            if (block.type === 'text') {
              textParts.push((block as any).text || '')
            }
          }
        }

        if (response.messageType === 'result') {
          // Save accumulated CC message to database
          if (contentBlocks.length > 0 && currentSessionId) {
            const ccMsgId = uuidv4()
            const textContent = textParts.join('\n\n').trim()

            statements.upsertMessage.run(
              ccMsgId,
              conversationId,
              userMsgId, // Parent is the user message
              '[]',
              'ex_agent',
              textContent,
              null,
              null, // thinking_block - stored in content_blocks
              null, // tool_calls - stored in content_blocks
              null,
              'claude-sonnet-4-5',
              response.result?.is_error ? 'Generation completed with error' : null,
              currentSessionId,
              'claude_code',
              JSON.stringify(normalizeContentBlocksForStorage(contentBlocks)),
              new Date().toISOString()
            )
            // console.log('[LocalServer] 🤖 CC message saved:', ccMsgId, '- blocks:', contentBlocks.length)

            // Send complete event
            res.write(
              `data: ${JSON.stringify({
                type: 'complete',
                sessionId: currentSessionId,
                messageId: ccMsgId,
                messageCount: contentBlocks.length,
              })}\n\n`
            )
          }
          // else if (!contentBlocks.length && currentSessionId) {
          //   console.log('[LocalServer] ⚠️ CC result received but no content to save')
          // }

          // Reset accumulators
          contentBlocks = []
          textParts = []
        }

        if (response.messageType === 'error') {
          // Save partial message on error
          if (contentBlocks.length > 0 && currentSessionId) {
            const ccMsgId = uuidv4()
            const textContent = textParts.join('\n\n').trim()

            statements.upsertMessage.run(
              ccMsgId,
              conversationId,
              userMsgId,
              '[]',
              'ex_agent',
              textContent || '[Error during generation]',
              null,
              null,
              null,
              null,
              'claude-sonnet-4-5',
              response.error?.message || 'Error during generation',
              currentSessionId,
              'claude_code',
              JSON.stringify(normalizeContentBlocksForStorage(contentBlocks)),
              new Date().toISOString()
            )
          }
        }
      }

      // Execute Claude Code
      await executeClaudeCode(
        conversationId,
        message,
        cwd,
        onResponse,
        permissionMode,
        onStreamingChunk,
        shouldResume ? sessionId : undefined,
        forkSession
      )

      // Update conversation cwd if changed
      if (cwd && conversation && conversation.cwd !== cwd) {
        statements.updateConversationCwd.run(cwd, conversationId)
      }

      // console.log('🤖 CC conversation completed successfully')
    } catch (error) {
      console.error('[LocalServer] CC Error:', error)
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
    }

    res.end()
  })

  // POST /api/agents/cc-messages-branch/:conversationId - Branch message to Claude Code
  app.post('/api/agents/cc-messages-branch/:conversationId', async (req, res) => {
    // console.log('\n🤖🤖🤖 [LocalServer] POST /api/agents/cc-messages-branch - Claude Code branch message received')
    // console.log('🤖 Timestamp:', new Date().toISOString())
    // console.log('🤖 Conversation ID:', req.params.conversationId)

    const { conversationId } = req.params
    const {
      message,
      parentId,
      cwd: requestedCwd,
      permissionMode = 'bypassPermissions',
      sessionId: providedSessionId,
      forkSession,
    } = req.body as {
      message: string
      parentId: string
      cwd?: string
      permissionMode?: 'default' | 'plan' | 'bypassPermissions' | 'acceptEdits'
      sessionId?: string
      forkSession?: boolean
    }

    if (!message) {
      res.status(400).json({ error: 'Message content required' })
      return
    }

    if (parentId === undefined) {
      res.status(400).json({ error: 'parentId is required for branching' })
      return
    }

    const conversation = statements.getConversationById.get(conversationId) as any
    const cwd = requestedCwd || conversation?.cwd || process.cwd()

    // console.log('🤖 CC Branch Request:', {
    //   message: message.substring(0, 100),
    //   parentId,
    //   cwd,
    //   permissionMode,
    // })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    try {
      // Find session ID by walking up the parent chain
      let sessionId = providedSessionId
      if (!sessionId && parentId) {
        let current = statements.getMessageById.get(parentId) as any
        while (current && !sessionId) {
          if (current.role === 'ex_agent' && current.ex_agent_session_id) {
            sessionId = current.ex_agent_session_id
            break
          }
          if (!current.parent_id) break
          current = statements.getMessageById.get(current.parent_id)
        }
      }

      // Save user message
      const userMsgId = uuidv4()
      const now = new Date().toISOString()
      statements.upsertMessage.run(
        userMsgId,
        conversationId,
        parentId,
        '[]',
        'user',
        message,
        null,
        null,
        null,
        null,
        'user-input',
        null,
        null,
        null,
        null,
        now
      )

      res.write(
        `data: ${JSON.stringify({ type: 'user_message', message: { id: userMsgId, role: 'user', content: message } })}\n\n`
      )

      let contentBlocks: any[] = []
      let textParts: string[] = []
      let currentSessionId: string | null = sessionId || null

      const onStream = (data: any) => {
        try {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        } catch (error) {
          console.error('[LocalServer] Error writing stream data:', error)
        }
      }

      // Streaming chunk callback for real-time deltas
      const onStreamingChunk = async (chunk: any) => {
        try {
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              part: chunk.contentType === 'thinking' ? 'reasoning' : 'text',
              delta: chunk.delta || '',
              chunkType: chunk.type,
            })}\n\n`
          )
        } catch (error) {
          console.error('[LocalServer] Error writing streaming chunk:', error)
        }
      }

      const onResponse = async (response: CCResponse) => {
        onStream(response)

        if (response.sessionId) {
          currentSessionId = response.sessionId
          setSession(conversationId, cwd, response.sessionId)
        }

        // ========================================================================
        // Universal Content Extractor - Capture content from ANY message type
        // ========================================================================

        // Extract text content from any response field
        let extractedContent: string | null = null

        // Priority 1: Check for result.result (slash commands)
        if (response.messageType === 'result' && response.result?.result) {
          extractedContent = response.result.result
          // console.log('[LocalServer] 🔍 Extracted content from result.result:', extractedContent.substring(0, 100))
        }

        // Priority 2: Check for system messages with content
        if (!extractedContent && response.messageType === 'system' && response.system) {
          // Some system messages may contain displayable content
          // Example: init messages with configuration info
          const systemContent = (response.system as any).content || (response.system as any).message
          if (systemContent && typeof systemContent === 'string') {
            extractedContent = systemContent
            // console.log('[LocalServer] 🔍 Extracted content from system message')
          }
        }

        // Priority 3: Check for any 'content' field in the response (catch-all)
        if (!extractedContent && (response as any).content) {
          const genericContent = (response as any).content
          if (typeof genericContent === 'string') {
            extractedContent = genericContent
            // console.log('[LocalServer] 🔍 Extracted content from generic content field')
          } else if (Array.isArray(genericContent)) {
            // If it's an array of blocks, try to extract text
            const textBlocks = genericContent.filter((b: any) => b.type === 'text')
            if (textBlocks.length > 0) {
              extractedContent = textBlocks.map((b: any) => b.text || b.content || '').join('\n')
              // console.log('[LocalServer] 🔍 Extracted content from content blocks array')
            }
          }
        }

        // If we extracted content from a non-message type, add it to contentBlocks
        if (extractedContent && response.messageType !== 'message') {
          const syntheticBlock = {
            type: 'text',
            text: extractedContent,
          }

          contentBlocks.push(syntheticBlock)
          textParts.push(extractedContent)

          // Stream extracted content to frontend immediately
          try {
            res.write(
              `data: ${JSON.stringify({
                type: 'chunk',
                part: 'text',
                delta: extractedContent,
                chunkType: `${response.messageType}_output`,
                sourceMessageType: response.messageType,
              })}\n\n`
            )
          } catch (error) {
            console.error('[LocalServer] Error streaming extracted content:', error)
          }
        }

        // ========================================================================
        // End Universal Content Extractor
        // ========================================================================

        if (response.messageType === 'message' && response.message) {
          for (const block of response.message.content) {
            contentBlocks.push(block)
            if (block.type === 'text') {
              textParts.push((block as any).text || '')
            }
          }
        }

        if (response.messageType === 'result') {
          if (contentBlocks.length > 0 && currentSessionId) {
            const ccMsgId = uuidv4()
            const textContent = textParts.join('\n\n').trim()

            statements.upsertMessage.run(
              ccMsgId,
              conversationId,
              userMsgId,
              '[]',
              'ex_agent',
              textContent,
              null,
              null,
              null,
              null,
              'claude-sonnet-4-5',
              response.result?.is_error ? 'Generation completed with error' : null,
              currentSessionId,
              'claude_code',
              JSON.stringify(normalizeContentBlocksForStorage(contentBlocks)),
              new Date().toISOString()
            )
            // console.log('[LocalServer] 🤖 CC message saved:', ccMsgId, '- blocks:', contentBlocks.length)

            res.write(
              `data: ${JSON.stringify({
                type: 'complete',
                sessionId: currentSessionId,
                messageId: ccMsgId,
                messageCount: contentBlocks.length,
              })}\n\n`
            )
          }
          // else if (!contentBlocks.length && currentSessionId) {
          //   console.log('[LocalServer] ⚠️ CC result received but no content to save')
          // }

          contentBlocks = []
          textParts = []
        }
      }

      await executeClaudeCode(
        conversationId,
        message,
        cwd,
        onResponse,
        permissionMode,
        onStreamingChunk,
        sessionId,
        forkSession ?? true // Default to fork for branch
      )

      if (cwd && conversation && conversation.cwd !== cwd) {
        statements.updateConversationCwd.run(cwd, conversationId)
      }

      // console.log('🤖 CC branch conversation completed successfully')
    } catch (error) {
      console.error('[LocalServer] CC Branch Error:', error)
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        })}\n\n`
      )
    }

    res.end()
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
        // console.log(`[LocalServer] Local sync server running on http://0.0.0.0:${port}`)
        // console.log(`[LocalServer] Database path: ${actualDbPath}`)

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
