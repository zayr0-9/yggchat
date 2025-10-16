import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables FIRST, before any other imports
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') })

import express from 'express'
import fs from 'fs'
import { createServer } from 'http'
import { env } from 'process'
import { WebSocket, WebSocketServer } from 'ws'
import { db, initializeDatabase, initializeStatements } from './database/db'
import chatRoutes from './routes/chat'
import settingsRoutes from './routes/settings'
import { stripMarkdownToText } from './utils/markdownStripper'
import { preloadModelPricing } from './utils/openrouter'
import tools from './utils/tools/index'

const app = express()
const server = createServer(app)

// WebSocket Server for IDE Context
const wss = new WebSocketServer({ server, path: '/ide-context' })

interface ConnectedClient {
  ws: WebSocket
  type: 'extension' | 'frontend'
  id: string
}

const clients = new Set<ConnectedClient>()

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

  ws.on('message', data => {
    try {
      const message = JSON.parse(data.toString())

      // Relay messages from extension to all frontend clients
      if (client.type === 'extension') {
        const outgoing = {
          ...message,
          // Normalize requestId to be present at the top-level if available in data
          requestId: message.requestId ?? message.data?.requestId,
        }

        clients.forEach(c => {
          if (c.type === 'frontend' && c.ws.readyState === c.ws.OPEN) {
            c.ws.send(JSON.stringify(outgoing))
          }
        })
      }

      // Handle frontend requests to extension
      if (client.type === 'frontend') {
        if (message.type === 'request_context') {
          const extensionClients = Array.from(clients).filter(
            c => c.type === 'extension' && c.ws.readyState === c.ws.OPEN
          )

          clients.forEach(c => {
            if (c.type === 'extension' && c.ws.readyState === c.ws.OPEN) {
              c.ws.send(
                JSON.stringify({
                  type: 'request_context',
                  requestId: message.requestId,
                })
              )
            }
          })

          if (extensionClients.length === 0) {
            console.warn('⚠️ No extensions available to handle context request')
            // Send back an empty response so frontend stops waiting
            client.ws.send(
              JSON.stringify({
                type: 'context_response',
                requestId: message.requestId,
                data: {
                  workspace: null,
                  openFiles: [],
                  allFiles: [],
                  activeFile: null,
                  currentSelection: null,
                },
              })
            )
          }
        } else if (message.type === 'request_file_content') {
          const extensionClients = Array.from(clients).filter(
            c => c.type === 'extension' && c.ws.readyState === c.ws.OPEN
          )

          clients.forEach(c => {
            if (c.type === 'extension' && c.ws.readyState === c.ws.OPEN) {
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
      console.error('Failed to parse WebSocket message:', error)
    }
  })

  ws.on('close', () => {
    clients.delete(client)
  })

  ws.on('error', error => {
    console.error(`WebSocket error for ${client.type}:`, error)
    clients.delete(client)
  })
})

app.use(
  cors({
    origin: true, // Allow all origins (or specify your frontend URL)
    // credentials: true, // Allow credentials
    exposedHeaders: ['Authorization'], // Expose JWT headers to client
    allowedHeaders: ['Content-Type', 'Authorization'], // Accept JWT Authorization header from client
  })
)

// IMPORTANT: Register Stripe webhook BEFORE express.json() middleware
// Webhook signature verification requires raw body, but express.json() parses it
if (env.VITE_ENVIRONMENT !== 'local') {
  const stripeRoutes = require('./routes/stripe').default
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeRoutes)
}

app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

// Debug middleware to log all requests
app.use('/api', (req, res, next) => {
  // console.log('[Debug Middleware] Method:', req.method)
  // console.log('[Debug Middleware] URL:', req.url)
  // console.log('[Debug Middleware] Headers:', req.headers)
  next()
})
if (env.VITE_ENVIRONMENT === 'web') {
  const supaChat = require('./routes/supaChat').default
  const rateLimit = require('express-rate-limit')
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }), supaChat)
} else {
  app.use('/api', chatRoutes)
}
app.use('/api/settings', settingsRoutes)
if (env.VITE_ENVIRONMENT !== 'local') {
  const stripeRoutes = require('./routes/stripe').default
  app.use('/api/stripe', stripeRoutes)
}
app.use('/uploads', express.static(path.join(__dirname, 'data', 'uploads')))

// Tools endpoint
app.get('/api/tools', (req, res) => {
  try {
    res.json({ tools })
  } catch (error) {
    console.error('Error fetching tools:', error)
    res.status(500).json({ error: 'Failed to fetch tools' })
  }
})

// Debug endpoint to see connected clients
app.get('/api/debug/ide-clients', (req, res) => {
  const clientList = Array.from(clients).map(c => ({
    type: c.type,
    id: c.id,
    connected: c.ws.readyState === c.ws.OPEN,
  }))
  res.json(clientList)
})

// Initialize database
// NOTE: If migrating from INTEGER PKs to UUID PKs, run `npm run migrate` first!
// The migration script (src/database/runMigration.ts) will handle the migration automatically.
const dbPath = path.join(__dirname, 'data', 'yggdrasil.db')
if (!fs.existsSync(dbPath)) {
  console.log('📝 Database file not found, creating new UUID-based database...')
}

console.log('🔧 Initializing database...')
initializeDatabase()
console.log('📊 Rebuilding FTS index on startup...')
// rebuildFTSIndex()
console.log('✅ FTS index rebuilt.')
initializeStatements()

// Create default local user for local mode
function ensureDefaultLocalUser() {
  if (env.VITE_ENVIRONMENT !== 'local') {
    console.log('Skipping default user creation (not in local mode)')
    return
  }

  try {
    // Use a fixed UUID for the local user (matches Supabase-generated UUID and migration script)
    const defaultUserId = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'
    const defaultUsername = 'local-user'

    // Import statements from db module
    const { statements } = require('./database/db')

    // Check if user already exists with this ID
    const existingUser = statements.getUserById.get(defaultUserId)

    if (existingUser) {
      // User exists - ensure username is correct (fix migration artifacts)
      if (existingUser.username !== defaultUsername) {
        console.log(`⚠️  User exists with different username: ${existingUser.username}`)
        console.log(`📝 Updating username to: ${defaultUsername}`)
        statements.updateUser.run(defaultUsername, defaultUserId)
        console.log(`✅ Updated user to: ${defaultUsername} (${defaultUserId})`)
      } else {
        console.log(`✅ Default local user already exists: ${existingUser.username} (${defaultUserId})`)
      }
    } else {
      // No user with this ID - create new user
      statements.createUser.run(defaultUserId, defaultUsername)
      console.log(`✅ Created default local user: ${defaultUsername} (${defaultUserId})`)
    }
  } catch (error) {
    console.error('❌ Error creating default local user:', error)
  }
}

ensureDefaultLocalUser()

// Preload model pricing on startup
preloadModelPricing().catch(error => {
  console.log('Warning: Could not preload model pricing:', error.message)
})
;(async () => {
  server.listen(3001, () => {
    console.log('🚀 Server on :3001')
    console.log('🔌 WebSocket IDE Context on ws://localhost:3001/ide-context')
  })
})()

// Startup migration: ensure plain_text_content is populated and FTS index built from it
async function migratePlainTextAndFTS() {
  try {
    // Verify plain_text_content column exists (initializeDatabase attempted to add it)
    const hasPlainTextColumn = db
      .prepare('PRAGMA table_info(messages)')
      .all()
      .some((c: any) => String(c.name) === 'plain_text_content')

    if (!hasPlainTextColumn) {
      // If for some reason column is missing (shouldn't happen), add it
      try {
        db.exec(`ALTER TABLE messages ADD COLUMN plain_text_content TEXT`)
      } catch {}
    }

    // Select messages missing plain_text_content
    const selectMissing = db.prepare('SELECT id, content FROM messages WHERE plain_text_content IS NULL')
    const updateStmt = db.prepare('UPDATE messages SET plain_text_content = ? WHERE id = ?')
    const rows = selectMissing.all() as { id: number; content: string }[]

    if (rows.length > 0) {
      console.log(`🔧 Migrating plain_text_content for ${rows.length} messages...`)
      for (const row of rows) {
        try {
          const text = await stripMarkdownToText(row.content)
          updateStmt.run(text, row.id)
        } catch {
          // Fallback: copy raw content
          updateStmt.run(row.content ?? '', row.id)
        }
      }
    }

    // Always rebuild FTS to ensure it uses the latest plain_text_content
    // console.log('🔧 Rebuilding FTS index to use plain_text_content...')
    // rebuildFTSIndex()
    // console.log('✅ FTS rebuild complete.')
  } catch (err) {
    console.warn('⚠️ Startup migration failed:', err)
  }
}

// Run migration in background after DB init
void migratePlainTextAndFTS()

app.get('/api/debug/routes', (req, res) => {
  const routes: any[] = []
  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods),
      })
    } else if (middleware.name === 'router') {
      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods),
          })
        }
      })
    }
  })
  res.json(routes)
})
