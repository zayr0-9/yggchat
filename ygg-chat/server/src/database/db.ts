// server/src/database/db.ts
import Database from 'better-sqlite3'
import path from 'path'

import fs from 'fs'

const DATA_DIR = path.join(__dirname, '../data')
// Ensure the data directory exists before opening the database file
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}
const DB_PATH = path.join(DATA_DIR, 'yggdrasil.db')

export const db = new Database(DB_PATH)

// Enable foreign keys
db.pragma('foreign_keys = ON')

// Initialize schema
export function initializeDatabase() {
  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Projects table
  db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    context TEXT,
    system_prompt TEXT
  )`)

  // Conversations table
  db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT, -- Add this line
    user_id TEXT NOT NULL,
    title TEXT,
    model_name TEXT DEFAULT 'gemma3:4b',
    system_prompt TEXT,
    conversation_context TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`)

  // Messages table with hybrid parent_id + children_ids design
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      children_ids TEXT DEFAULT '[]',
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      plain_text_content TEXT,
      thinking_block TEXT,
      tool_calls TEXT,
      model_name TEXT DEFAULT 'unknown',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)

  // Message attachments table (images stored locally with optional CDN URL)
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('image')),
      mime_type TEXT NOT NULL,
      storage TEXT NOT NULL CHECK (storage IN ('file','url')) DEFAULT 'file',
      url TEXT,             -- For CDN/object storage
      file_path TEXT,       -- For local filesystem storage
      width INTEGER,
      height INTEGER,
      size_bytes INTEGER,
      sha256 TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    )
  `)

  // Provider cost tracking table
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

  // Join table to support many-to-many links between messages and attachments
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

  // Message file content table (files with name and paths)
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_file_content (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_content TEXT,
      size_bytes INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // Join table to support many-to-many links between messages and file content
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_file_content_links (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_content_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (file_content_id) REFERENCES message_file_content(id) ON DELETE CASCADE,
      UNIQUE(message_id, file_content_id)
    )
  `)

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
  `)

  // Attachment indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON message_attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_sha256 ON message_attachments(sha256);
  `)

  // Indexes for join table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mal_message_id ON message_attachment_links(message_id);
    CREATE INDEX IF NOT EXISTS idx_mal_attachment_id ON message_attachment_links(attachment_id);
  `)

  // File content indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_file_content_absolute_path ON message_file_content(absolute_path);
    CREATE INDEX IF NOT EXISTS idx_file_content_relative_path ON message_file_content(relative_path);
  `)

  // Indexes for file content join table
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mfcl_message_id ON message_file_content_links(message_id);
    CREATE INDEX IF NOT EXISTS idx_mfcl_file_content_id ON message_file_content_links(file_content_id);
  `)

  // Provider cost indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_provider_cost_user_id ON provider_cost(user_id);
    CREATE INDEX IF NOT EXISTS idx_provider_cost_message_id ON provider_cost(message_id);
    CREATE INDEX IF NOT EXISTS idx_provider_cost_created_at ON provider_cost(created_at);
    CREATE INDEX IF NOT EXISTS idx_provider_cost_user_created ON provider_cost(user_id, created_at);
  `)

  // Migration for existing provider_cost table - add user_id column if it doesn't exist
  try {
    db.exec(`ALTER TABLE provider_cost ADD COLUMN user_id TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Populate user_id for existing records that don't have it
  try {
    db.exec(`
      UPDATE provider_cost
      SET user_id = (
        SELECT c.user_id
        FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE m.id = provider_cost.message_id
      )
      WHERE user_id IS NULL
    `)
  } catch (error) {
    console.log('Error populating user_id for existing records:', error)
  }

  // Migration - add foreign key constraint for user_id (if not already present)
  // Note: SQLite doesn't support adding foreign key constraints to existing tables
  // So we'll handle this constraint logically in the application

  // Migration - remove model_name and provider columns if they exist
  try {
    // SQLite doesn't support DROP COLUMN, so we need to recreate the table if these columns exist
    const tableInfo = db.prepare('PRAGMA table_info(provider_cost)').all() as any[]
    const hasModelName = tableInfo.some(col => col.name === 'model_name')
    const hasProvider = tableInfo.some(col => col.name === 'provider')

    if (hasModelName || hasProvider) {
      console.log('Migrating provider_cost table to remove model_name and provider columns...')

      // Create new table with correct schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS provider_cost_new (
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

      // Copy data from old table, populating user_id from conversations
      db.exec(`
        INSERT INTO provider_cost_new (id, user_id, message_id, prompt_tokens, completion_tokens, reasoning_tokens, approx_cost, api_credit_cost, created_at)
        SELECT
          pc.id,
          COALESCE(c.user_id, 1) as user_id,  -- Default to user 1 if not found
          pc.message_id,
          pc.prompt_tokens,
          pc.completion_tokens,
          pc.reasoning_tokens,
          pc.approx_cost,
          pc.api_credit_cost,
          pc.created_at
        FROM provider_cost pc
        LEFT JOIN messages m ON pc.message_id = m.id
        LEFT JOIN conversations c ON m.conversation_id = c.id
      `)

      // Drop old table and rename new one
      db.exec('DROP TABLE provider_cost')
      db.exec('ALTER TABLE provider_cost_new RENAME TO provider_cost')

      console.log('Provider_cost table migration completed.')
    }
  } catch (error) {
    console.error('Error during provider_cost table migration:', error)
  }

  // Provider cost view with message details (join table equivalent)
  db.exec(`
    CREATE VIEW IF NOT EXISTS provider_cost_with_message AS
    SELECT
      pc.id,
      pc.user_id,
      pc.message_id,
      pc.prompt_tokens,
      pc.completion_tokens,
      pc.reasoning_tokens,
      pc.approx_cost,
      pc.api_credit_cost,
      pc.created_at,
      m.conversation_id,
      m.role,
      m.content,
      m.model_name,
      m.created_at as message_created_at,
      c.title as conversation_title
    FROM provider_cost pc
    JOIN messages m ON pc.message_id = m.id
    JOIN conversations c ON m.conversation_id = c.id
  `)

  // Full Text Search virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      message_id UNINDEXED,
      tokenize = 'porter unicode61'
    )
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

  // Triggers to keep FTS table in sync with messages table
  // Drop old triggers (if any) to ensure updated logic is applied
  db.exec(`
    DROP TRIGGER IF EXISTS messages_ai;
    DROP TRIGGER IF EXISTS messages_au;
    DROP TRIGGER IF EXISTS messages_ad;

    -- Insert trigger
    CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(content, conversation_id, message_id) 
      VALUES (COALESCE(new.plain_text_content, new.content), new.conversation_id, new.id);
    END;

    -- Update trigger  
    CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
      UPDATE messages_fts 
      SET content = COALESCE(new.plain_text_content, new.content) 
      WHERE message_id = new.id;
    END;

    -- Delete trigger
    CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;
  `)

  // Add migration for project_id column if it doesn't exist
  try {
    db.exec(`ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add migration for plain_text_content on messages if it doesn't exist
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN plain_text_content TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add migration for tool_calls on messages if it doesn't exist
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add migration for note on messages if it doesn't exist
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN note TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add migration for user_id on projects if it doesn't exist
  try {
    db.exec(`ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Stripe subscription and credits schema extensions
  // Add Stripe customer ID column
  try {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add Stripe subscription ID column
  try {
    db.exec(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add subscription tier column
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN subscription_tier TEXT CHECK (subscription_tier IN ('high', 'mid', 'low', NULL))`
    )
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add subscription status column
  try {
    db.exec(
      `ALTER TABLE users ADD COLUMN subscription_status TEXT CHECK (subscription_status IN ('active', 'canceled', 'past_due', NULL))`
    )
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add credits balance column
  try {
    db.exec(`ALTER TABLE users ADD COLUMN credits_balance INTEGER DEFAULT 0`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Add current period end column
  try {
    db.exec(`ALTER TABLE users ADD COLUMN current_period_end DATETIME`)
  } catch (error) {
    // Column already exists, ignore the error
  }

  // Credit ledger table for audit trail
  db.exec(`
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)

  // Create index for credit ledger
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_id ON credit_ledger(user_id);
    CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON credit_ledger(created_at);
  `)

  // Initialize prepared statements after tables exist
  initializeStatements()

  // Backfill join table from legacy message_id values for existing attachments
  db.exec(`
    INSERT OR IGNORE INTO message_attachment_links (message_id, attachment_id)
    SELECT message_id, id FROM message_attachments WHERE message_id IS NOT NULL;
  `)
}

// Prepared statements - initialized after tables exist
export let statements: any = {}

export function initializeStatements() {
  statements = {
    // Users
    createUser: db.prepare('INSERT INTO users (id, username) VALUES (?, ?)'),
    getAllUsers: db.prepare('SELECT * FROM users ORDER BY created_at DESC'),
    getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
    getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    updateUser: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

    // User subscription and credits operations
    updateUserSubscription: db.prepare(`
      UPDATE users
      SET stripe_customer_id = ?,
          stripe_subscription_id = ?,
          subscription_tier = ?,
          subscription_status = ?,
          current_period_end = ?
      WHERE id = ?
    `),
    updateUserCredits: db.prepare('UPDATE users SET credits_balance = ? WHERE id = ?'),
    getUserCredits: db.prepare('SELECT credits_balance FROM users WHERE id = ?'),

    // Credit ledger operations
    createCreditLedgerEntry: db.prepare(`
      INSERT INTO credit_ledger (id, user_id, amount, reason, balance_after)
      VALUES (?, ?, ?, ?, ?)
    `),
    getCreditLedgerByUser: db.prepare(`
      SELECT * FROM credit_ledger
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `),
    getTotalCreditsUsedByUser: db.prepare(`
      SELECT SUM(ABS(amount)) as total_credits_used
      FROM credit_ledger
      WHERE user_id = ? AND amount < 0
    `),

    //Projects
    createProject: db.prepare(
      'INSERT INTO projects (id, name, created_at, updated_at, context, system_prompt, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),
    getAllProjects: db.prepare('SELECT * FROM projects ORDER BY created_at DESC'),
    getProjectsSortedByLatestConversation: db.prepare(`
      SELECT
        p.*,
        MAX(c.updated_at) as latest_conversation_updated_at
      FROM projects p
      LEFT JOIN conversations c ON c.project_id = p.id AND c.user_id = ?
      WHERE p.user_id = ?
      GROUP BY p.id
      ORDER BY
        COALESCE(MAX(c.updated_at), p.updated_at, p.created_at) DESC
    `),
    getProjectById: db.prepare('SELECT * FROM projects WHERE id = ?'),
    updateProject: db.prepare(
      'UPDATE projects SET name = ?, updated_at = ?, context = ?, system_prompt = ? WHERE id = ?'
    ),
    deleteProject: db.prepare('DELETE FROM projects WHERE id = ?'),
    getProjectContext: db.prepare('SELECT context FROM projects WHERE id = ?'),
    getConversationProjectId: db.prepare('SELECT project_id FROM conversations WHERE id = ?'),

    // Conversations
    createConversation: db.prepare(
      'INSERT INTO conversations (id, user_id, title, model_name, project_id) VALUES (?, ?, ?, ?, ?)'
    ),
    getConversationsByUser: db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC'),
    // Get recent conversations for a user limited by count
    getRecentConversationsByUser: db.prepare(
      'SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?'
    ),
    getConversationById: db.prepare('SELECT * FROM conversations WHERE id = ?'),
    getConversationSystemPrompt: db.prepare('SELECT system_prompt FROM conversations WHERE id = ?'),
    updateConversationTitle: db.prepare(
      'UPDATE conversations SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),
    updateConversationSystemPrompt: db.prepare(
      'UPDATE conversations SET system_prompt = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),
    updateConversationContext: db.prepare(
      'UPDATE conversations SET conversation_context = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ),
    getConversationByProjectId: db.prepare('SELECT * FROM conversations WHERE project_id = ?'),
    getConversationContext: db.prepare('SELECT conversation_context FROM conversations WHERE id = ?'),
    updateConversationTimestamp: db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
    deleteConversationsByUser: db.prepare('DELETE FROM conversations WHERE user_id = ?'),

    // Messages - Core operations
    createMessage: db.prepare(
      'INSERT INTO messages (id, conversation_id, parent_id, role, content, thinking_block, tool_calls, children_ids, model_name, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    getMessageById: db.prepare(`
      SELECT 
        m.*,
        m.plain_text_content AS content_plain_text,
        (
          SELECT COUNT(1) 
          FROM message_attachment_links mal 
          WHERE mal.message_id = m.id
        ) AS attachments_count,
        (
          SELECT COUNT(1) 
          FROM message_file_content_links mfcl 
          WHERE mfcl.message_id = m.id
        ) AS file_content_count
      FROM messages m 
      WHERE m.id = ?
    `),
    getChildrenIds: db.prepare('SELECT children_ids FROM messages WHERE id = ?'),
    getMessagesByConversation: db.prepare(`
      SELECT 
        m.*, 
        m.plain_text_content AS content_plain_text,
        EXISTS(
          SELECT 1 
          FROM message_attachment_links mal 
          WHERE mal.message_id = m.id
        ) AS has_attachments,
        (
          SELECT COUNT(1) 
          FROM message_attachment_links mal2 
          WHERE mal2.message_id = m.id
        ) AS attachments_count
      FROM messages m 
      WHERE m.conversation_id = ? 
      ORDER BY m.created_at ASC
    `),
    getLastMessage: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1'),
    deleteMessagesByConversation: db.prepare('DELETE FROM messages WHERE conversation_id = ?'),
    updateMessage: db.prepare(
      'UPDATE messages SET content = ?, thinking_block = ?, tool_calls = ?, note = ? WHERE id = ?'
    ),
    deleteMessage: db.prepare('DELETE FROM messages WHERE id = ?'),
    // Batch delete messages by an array of IDs (pass JSON array string as the parameter)
    deleteMessagesByIds: db.prepare('DELETE FROM messages WHERE id IN (SELECT value FROM json_each(?))'),

    // Messages - Optimized branch operations using children_ids

    // Messages - Tree operations (simplified with children_ids)
    getMessageTree: db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'),

    // Recently used models (distinct model_name ordered by most recent usage)
    getRecentModels: db.prepare(`
      SELECT model_name, MAX(created_at) AS last_used
      FROM messages
      WHERE COALESCE(model_name, '') != '' AND model_name != 'unknown'
      GROUP BY model_name
      ORDER BY last_used DESC
      LIMIT ?
    `),

    // Full Text Search operations
    searchMessages: db.prepare(`
      SELECT m.*, m.plain_text_content AS content_plain_text, highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
      FROM messages m
      JOIN messages_fts ON m.id = messages_fts.message_id
      WHERE messages_fts MATCH ? AND m.conversation_id = ?
      ORDER BY rank
    `),

    searchAllUserMessages: db.prepare(`
      SELECT m.*, m.plain_text_content AS content_plain_text, c.title as conversation_title, 
             highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
      FROM messages m
      JOIN messages_fts ON m.id = messages_fts.message_id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE messages_fts MATCH ? AND c.user_id = ?
      ORDER BY rank
      LIMIT 50
    `),

    //Search messages by project
    searchMessagesByProject: db.prepare(`
      SELECT m.*, m.plain_text_content AS content_plain_text, highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
      FROM messages m
      JOIN messages_fts ON m.id = messages_fts.message_id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE messages_fts MATCH ? AND c.project_id = ?
      ORDER BY rank
    `),

    // Advanced FTS with snippets (shows context around matches)
    searchMessagesWithSnippet: db.prepare(`
      SELECT m.*, m.plain_text_content AS content_plain_text, 
             snippet(messages_fts, 0, '<mark>', '</mark>', '...', 32) as snippet
      FROM messages m
      JOIN messages_fts ON m.id = messages_fts.message_id
      WHERE messages_fts MATCH ? AND m.conversation_id = ?
      ORDER BY rank
    `),

    // Search with pagination
    searchAllUserMessagesPaginated: db.prepare(`
      SELECT m.*, m.plain_text_content AS content_plain_text, c.title as conversation_title, 
             highlight(messages_fts, 0, '<mark>', '</mark>') as highlighted
      FROM messages m
      JOIN messages_fts ON m.id = messages_fts.message_id
      JOIN conversations c ON m.conversation_id = c.id
      WHERE messages_fts MATCH ? AND c.user_id = ?
      ORDER BY rank
      LIMIT ? OFFSET ?
    `),

    // Attachments
    createAttachment: db.prepare(
      `INSERT INTO message_attachments (
         id, message_id, kind, mime_type, storage, url, file_path, width, height, size_bytes, sha256
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    // Legacy setter retained but no longer used in new code paths
    updateAttachmentMessageId: db.prepare('UPDATE message_attachments SET message_id = ? WHERE id = ?'),
    // Many-to-many operations via join table
    linkAttachmentToMessage: db.prepare(
      'INSERT OR IGNORE INTO message_attachment_links (id, message_id, attachment_id) VALUES (?, ?, ?)'
    ),
    deleteLinksByMessage: db.prepare('DELETE FROM message_attachment_links WHERE message_id = ?'),
    unlinkAttachmentFromMessage: db.prepare(
      'DELETE FROM message_attachment_links WHERE message_id = ? AND attachment_id = ?'
    ),
    getAttachmentsByMessage: db.prepare(
      `SELECT
         ma.id,
         mal.message_id AS message_id,
         ma.kind,
         ma.mime_type,
         ma.storage,
         ma.url,
         ma.file_path,
         ma.width,
         ma.height,
         ma.size_bytes,
         ma.sha256,
         ma.created_at
       FROM message_attachment_links mal
       JOIN message_attachments ma ON ma.id = mal.attachment_id
       WHERE mal.message_id = ?
       ORDER BY ma.id ASC`
    ),
    getAttachmentById: db.prepare('SELECT * FROM message_attachments WHERE id = ?'),
    getAttachmentBySha256: db.prepare('SELECT * FROM message_attachments WHERE sha256 = ?'),
    // Legacy deleter replaced by link deletion to preserve shared attachments
    deleteAttachmentsByMessage: db.prepare('DELETE FROM message_attachment_links WHERE message_id = ?'),
    getAttachmentForMessage: db.prepare(
      `SELECT
         ma.id,
         mal.message_id AS message_id,
         ma.kind,
         ma.mime_type,
         ma.storage,
         ma.url,
         ma.file_path,
         ma.width,
         ma.height,
         ma.size_bytes,
         ma.sha256,
         ma.created_at
       FROM message_attachment_links mal
       JOIN message_attachments ma ON ma.id = mal.attachment_id
       WHERE mal.message_id = ? AND mal.attachment_id = ?`
    ),

    // File Content operations
    createFileContent: db.prepare(
      `INSERT INTO message_file_content (
         id, file_name, absolute_path, relative_path, file_content, size_bytes
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ),
    linkFileContentToMessage: db.prepare(
      'INSERT OR IGNORE INTO message_file_content_links (id, message_id, file_content_id) VALUES (?, ?, ?)'
    ),
    unlinkFileContentFromMessage: db.prepare(
      'DELETE FROM message_file_content_links WHERE message_id = ? AND file_content_id = ?'
    ),
    getFileContentsByMessage: db.prepare(
      `SELECT
         mfc.id,
         mfcl.message_id AS message_id,
         mfc.file_name,
         mfc.absolute_path,
         mfc.relative_path,
         mfc.file_content,
         mfc.size_bytes,
         mfc.created_at
       FROM message_file_content_links mfcl
       JOIN message_file_content mfc ON mfc.id = mfcl.file_content_id
       WHERE mfcl.message_id = ?
       ORDER BY mfc.id ASC`
    ),
    getFileContentById: db.prepare('SELECT * FROM message_file_content WHERE id = ?'),
    getFileContentByPath: db.prepare('SELECT * FROM message_file_content WHERE absolute_path = ?'),
    deleteFileContentLinksByMessage: db.prepare('DELETE FROM message_file_content_links WHERE message_id = ?'),

    // Provider Cost operations
    createProviderCost: db.prepare(
      'INSERT INTO provider_cost (id, user_id, message_id, prompt_tokens, completion_tokens, reasoning_tokens, approx_cost, api_credit_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),
    getProviderCostByMessage: db.prepare('SELECT * FROM provider_cost WHERE message_id = ?'),
    getProviderCostsByUser: db.prepare(`
      SELECT * FROM provider_cost
      WHERE user_id = ?
      ORDER BY created_at DESC
    `),
    getProviderCostWithMessageByUser: db.prepare(`
      SELECT * FROM provider_cost_with_message
      WHERE user_id = ?
      ORDER BY created_at DESC
    `),
    getTotalCostByUser: db.prepare(`
      SELECT
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(reasoning_tokens) as total_reasoning_tokens,
        SUM(approx_cost) as total_cost_usd,
        SUM(api_credit_cost) as total_api_credits
      FROM provider_cost
      WHERE user_id = ?
    `),
    deleteProviderCostByMessage: db.prepare('DELETE FROM provider_cost WHERE message_id = ?'),
  }
}

// Utility function to rebuild FTS index (useful after bulk imports)
export function rebuildFTSIndex() {
  db.exec(`
    DELETE FROM messages_fts;
    INSERT INTO messages_fts(content, conversation_id, message_id)
    SELECT COALESCE(plain_text_content, content), conversation_id, id FROM messages;
  `)
}

// Graceful shutdown
process.on('exit', () => db.close())
process.on('SIGHUP', () => process.exit(128 + 1))
process.on('SIGINT', () => process.exit(128 + 2))
process.on('SIGTERM', () => process.exit(128 + 15))
