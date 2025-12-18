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
import { globalRateLimiter, logRateLimiterConfig } from './middleware/rateLimiter'
import chatRoutes from './routes/chat'
import settingsRoutes from './routes/settings'
import { stripMarkdownToText } from './utils/markdownStripper'
import { preloadModelPricing } from './utils/openrouter'
import tools from './utils/tools/index'

// =============================================================================
// PROCESS ERROR HANDLERS - Prevent crashes from unhandled errors
// =============================================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 Unhandled Rejection at:', promise)
  console.error('🚨 Reason:', reason)
  // Don't exit - keep the server running
})

process.on('uncaughtException', error => {
  console.error('🚨 Uncaught Exception:', error)
  console.error('🚨 Stack:', error.stack)
  // Don't exit immediately - give time to log and potentially recover
})

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...')
  server.close(() => {
    console.log('✅ Server closed')
    process.exit(0)
  })
})

const app = express()
const server = createServer(app)

// Fix for 502 Bad Gateway errors behind Load Balancers (e.g. Railway, AWS ALB)
// Ensure Node's keep-alive timeout is longer than the LB's timeout (usually 60s)
server.keepAliveTimeout = 120 * 1000
server.headersTimeout = 120 * 1000

// Low-level connection logging to verify if traffic reaches the node process
server.on('connection', socket => {
  console.log(`🔌 [TCP] New connection from ${socket.remoteAddress}:${socket.remotePort}`)
})

interface ConnectedClient {
  ws: WebSocket
  type: 'extension' | 'frontend'
  id: string
}

const clients = new Set<ConnectedClient>()

// WebSocket Server for IDE Context (only in non-web environments)
if (env.VITE_ENVIRONMENT !== 'web') {
  const wss = new WebSocketServer({ server, path: '/ide-context' })

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
}

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173', // Local development
  'http://localhost:3000', // Alternative local port
  env.FRONTEND_URL, // Production frontend URL (set in environment variables)
].filter(Boolean) // Remove undefined values

// ============================================================================
// REQUEST FLOW LOGGING - Complete trace of every request through the pipeline
// ============================================================================
// Flow: Entry → CORS Check → After CORS → Body Parsing → Rate Limiter →
//       API Routes → Web Routes → Handler → Response/Error
// ============================================================================

// Log CORS configuration on startup
console.log('🔧 CORS Configuration:')
console.log('  NODE_ENV:', env.NODE_ENV)
console.log('  FRONTEND_URL:', env.FRONTEND_URL)
console.log('  Allowed origins:', allowedOrigins)

app.use(
  cors({
    origin: (origin, callback) => {
      console.log('📡 CORS Request - Origin:', origin)

      // Allow requests with no origin (like mobile apps, Postman, or server-to-server)
      if (!origin) {
        console.log('✅ CORS: No origin (allowed)')
        return callback(null, true)
      }

      // In development, allow all origins for flexibility
      if (env.NODE_ENV !== 'production') {
        console.log('✅ CORS: Development mode (allowed)')
        return callback(null, true)
      }

      // In production, check against whitelist
      if (allowedOrigins.includes(origin)) {
        console.log('✅ CORS: Origin in whitelist (allowed)')
        callback(null, true)
      } else {
        console.log('❌ CORS: Origin NOT in whitelist (blocked)')
        console.log('   Checked against:', allowedOrigins)
        console.warn(`⚠️ CORS blocked origin: ${origin}`)
        callback(new Error('Not allowed by CORS'))
      }
    },
    credentials: true, // Allow credentials (cookies, authorization headers)
    exposedHeaders: ['Authorization'], // Expose JWT headers to client
    allowedHeaders: ['Content-Type', 'Authorization'], // Accept JWT Authorization header from client
  })
)

// =============================================================================
// HEALTH CHECK ENDPOINTS - Railway needs these to verify service is alive
// =============================================================================
// Root health check for Railway's default health check path
app.get('/', (req, res) => {
  console.log('💚 [HEALTH CHECK] Root health check accessed')
  res.send('OK')
})

// Explicit health check endpoint
app.get('/health', (req, res) => {
  console.log('💚 [HEALTH CHECK] /health endpoint accessed')
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  })
})

// IMPORTANT: Stripe webhook requires raw body for signature verification
// Apply raw body parsing ONLY for webhook endpoint, before express.json()
if (env.VITE_ENVIRONMENT === 'web') {
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }))
}

app.use(express.json({ limit: '25mb' }))
app.use(express.urlencoded({ extended: true, limit: '25mb' }))

// Apply global rate limiter to all routes (only in web mode)
if (env.VITE_ENVIRONMENT === 'web') {
  console.log('🔒 [RATE LIMITER] Applying global rate limiter')
  app.use((req, res, next) => {
    // console.log('🔒 [RATE LIMITER] Checking rate limit for:', req.ip)
    globalRateLimiter(req, res, err => {
      if (err) {
        console.log('❌ [RATE LIMITER] Rate limit exceeded for:', req.ip)
      }
      // else {
      //   console.log('✅ [RATE LIMITER] Rate limit check passed for:', req.ip)
      // }
      next(err)
    })
  })
}

// Simple health check route to verify API is reachable
app.get('/api/ping', (req, res) => {
  console.error('[Ping] Ping received on port ' + (process.env.PORT || 3001))
  res.send('pong')
})

// Route handling based on environment
console.error('[Startup] Checking environment for route loading:', env.VITE_ENVIRONMENT)
if (env.VITE_ENVIRONMENT === 'web') {
  console.error('[Startup] Web mode detected. Loading supaChat routes...')
  // Web mode: Use Supabase routes with Redis-backed rate limiting
  try {
    const supaChat = require('./routes/supaChat').default
    console.error('[Startup] supaChat router loaded. Stack length:', supaChat?.stack?.length)

    app.use('/api', supaChat)

    // Agent routes: Claude Code and other external agents
    const supaAgents = require('./routes/supaAgents').default
    app.use('/api/agents', supaAgents)

    // OOB Auth routes: OAuth callback page + code exchange for Electron/CLI
    const oobAuth = require('./routes/oobAuth').default
    app.use('/auth', oobAuth) // For /auth/callback (callback page)
    app.use('/api/auth', oobAuth) // For /api/auth/oob/* endpoints
    console.log('[Startup] OOB Auth routes loaded')
  } catch (err) {
    console.error('[Startup] ❌ Failed to load supaChat router:', err)
  }
} else {
  console.log('[Startup] Local/Electron mode detected. Loading standard chat routes...')
  // Local and Electron modes: Use direct chat routes (no Supabase)
  app.use('/api', chatRoutes)
}

app.use('/api/settings', settingsRoutes)

// Stripe routes: Only in web mode
if (env.VITE_ENVIRONMENT === 'web') {
  const stripeRoutes = require('./routes/stripe').default
  app.use('/api/stripe', stripeRoutes)

  // User account management routes (includes account deletion)
  const userRoutes = require('./routes/user').default
  app.use('/api/user', userRoutes)
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

// Initialize database (only for local/electron modes, not web mode which uses Supabase)
if (env.VITE_ENVIRONMENT !== 'web') {
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
} else {
  console.log('🌐 Web mode detected - skipping SQLite initialization (using Supabase)')
}

// No default user creation - users are created after OAuth authentication
// Only web and electron modes exist
function ensureDefaultLocalUser() {
  console.log('⏭️  Skipping default user creation - users created after OAuth authentication')
  console.log(`📍 Current environment: ${env.VITE_ENVIRONMENT}`)
}

ensureDefaultLocalUser()

// Preload model pricing on startup
preloadModelPricing().catch(error => {
  console.log('Warning: Could not preload model pricing:', error.message)
})

// Start OpenRouter reconciliation worker (only in web mode where Supabase is available)
if (env.VITE_ENVIRONMENT === 'web') {
  try {
    const { startReconciliationWorker } = require('./workers/openrouter-reconciliation')
    startReconciliationWorker()
    console.log('✅ OpenRouter reconciliation worker started')
  } catch (error) {
    console.error('⚠️  Failed to start reconciliation worker:', error)
    // Don't crash - continue without it
  }
} else {
  console.log('⏭️  Skipping reconciliation worker (not in web mode)')
}

;(async () => {
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3001

  server.on('error', (error: any) => {
    console.error('❌ Server error:', error)
    if (error.code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} is already in use`)
      process.exit(1)
    }
  })

  server.listen(port, () => {
    const addr = server.address()
    const bindHost = typeof addr === 'string' ? addr : addr?.address
    const bindFamily = typeof addr === 'string' ? 'pipe' : addr?.family

    console.log(`🚀 Server listening on port ${port}`)
    console.log(`   Bound to: ${bindHost} (${bindFamily})`)
    console.log(`🔌 WebSocket IDE Context on ws://localhost:${port}/ide-context`)
    console.log(`✅ Server is ready to accept connections`)
    console.log(`💚 Health checks available at: / and /health`)

    // Log rate limiter configuration (only in web mode)
    if (env.VITE_ENVIRONMENT === 'web') {
      logRateLimiterConfig()
    }
  })
})()

// Startup migration: ensure plain_text_content is populated and FTS index built from it
async function migratePlainTextAndFTS() {
  console.log('🔄 [Migration] Starting plain_text_content migration check...')
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

// Run migration in background after DB init (only for local/electron modes)
if (env.VITE_ENVIRONMENT !== 'web') {
  migratePlainTextAndFTS().catch(err => {
    console.error('❌ Fatal error in migratePlainTextAndFTS:', err)
    // Don't crash - log and continue
  })
} else {
  console.log('⏭️  Skipping SQLite migration (web mode uses Supabase)')
}

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

// 4. GLOBAL ERROR HANDLER - Catch all unhandled errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('❌❌❌ [ERROR HANDLER] Unhandled Error ❌❌❌')
  console.error('   Method:', req.method)
  console.error('   URL:', req.url)
  console.error('   Origin:', req.headers.origin)
  console.error('   Error Message:', err.message)
  console.error('   Error Stack:', err.stack)
  console.error('   Error Object:', JSON.stringify(err, null, 2))
  console.error('=' + '='.repeat(80))

  // Send error response if headers not sent
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal Server Error',
      details: process.env.NODE_ENV === 'production' ? undefined : err.stack,
    })
  }
})
