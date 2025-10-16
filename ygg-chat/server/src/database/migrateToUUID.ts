#!/usr/bin/env ts-node
/**
 * Migration script to convert INTEGER PKs to UUID TEXT PKs
 *
 * WARNING: This is a DESTRUCTIVE migration that will:
 * 1. Backup the existing database
 * 2. Create new tables with UUID PKs
 * 3. Migrate all existing data with new UUIDs
 * 4. Update all foreign key references
 *
 * IMPORTANT: For single-user databases, the first user will be assigned
 * the fixed UUID 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3' to match the
 * hardcoded local user ID used in index.ts and AuthContext.tsx.
 *
 * For multi-user databases, only the first user gets the fixed UUID,
 * all others get random UUIDs generated via generateId().
 *
 * Run this script ONLY when ready to migrate.
 *
 * Usage: npx ts-node src/database/migrateToUUID.ts
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { generateId } from './idGenerator'

const DATA_DIR = path.join(__dirname, '../data')
const DB_PATH = path.join(DATA_DIR, 'yggdrasil.db')
const BACKUP_PATH = path.join(DATA_DIR, `yggdrasil_backup_${Date.now()}.db`)
const ENV_PATH = path.join(__dirname, '../../../.env')

interface IdMapping {
  [oldId: number]: string
}

/**
 * Check if the database needs migration from INTEGER to UUID TEXT PKs
 * Returns true if users table has INTEGER id, false if TEXT id (or table doesn't exist)
 */
function needsMigration(): boolean {
  if (!fs.existsSync(DB_PATH)) {
    console.log('📝 No database found - will create new UUID-based database')
    return false
  }

  try {
    const db = new Database(DB_PATH, { readonly: true })

    // Check if users table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()
    if (!tableExists) {
      db.close()
      console.log('📝 Users table does not exist - will create new UUID-based database')
      return false
    }

    // Get the type of the id column in users table
    const tableInfo = db.prepare('PRAGMA table_info(users)').all() as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: any
      pk: number
    }>

    db.close()

    const idColumn = tableInfo.find(col => col.name === 'id')
    if (!idColumn) {
      console.log('⚠️  Could not find id column in users table')
      return false
    }

    // Check if id column is INTEGER (needs migration) or TEXT (already migrated)
    const isIntegerId = idColumn.type.toUpperCase() === 'INTEGER'

    if (isIntegerId) {
      console.log('🔍 Detected INTEGER id column - migration needed')
      return true
    } else {
      console.log('✅ Database already uses TEXT (UUID) primary keys - no migration needed')
      return false
    }
  } catch (error) {
    console.error('❌ Error checking database schema:', error)
    return false
  }
}

/**
 * Update the MIGRATED_TO_UUID flag in .env file
 */
function updateEnvFlag(): void {
  try {
    if (!fs.existsSync(ENV_PATH)) {
      console.log('⚠️  .env file not found, creating new one')
      fs.writeFileSync(ENV_PATH, 'MIGRATED_TO_UUID=true\n')
      console.log('✅ Created .env with MIGRATED_TO_UUID=true')
      return
    }

    let envContent = fs.readFileSync(ENV_PATH, 'utf8')

    // Check if flag already exists
    if (envContent.includes('MIGRATED_TO_UUID=')) {
      // Update existing flag
      envContent = envContent.replace(/MIGRATED_TO_UUID=.*/g, 'MIGRATED_TO_UUID=true')
      console.log('✅ Updated existing MIGRATED_TO_UUID flag to true')
    } else {
      // Add flag
      envContent += '\nMIGRATED_TO_UUID=true\n'
      console.log('✅ Added MIGRATED_TO_UUID=true to .env')
    }

    fs.writeFileSync(ENV_PATH, envContent)
  } catch (error) {
    console.error('❌ Error updating .env file:', error)
    // Don't fail the migration if we can't update the flag
  }
}

function backupDatabase() {
  console.log('📦 Creating backup...')
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, BACKUP_PATH)
    console.log(`✅ Backup created at: ${BACKUP_PATH}`)
  } else {
    console.log('⚠️  No existing database found - will create new one')
  }
}

function migrateDatabase() {
  backupDatabase()

  const oldDb = fs.existsSync(DB_PATH) ? new Database(DB_PATH) : null
  const newDbPath = path.join(DATA_DIR, 'yggdrasil_uuid.db')

  // Remove new DB if it exists
  if (fs.existsSync(newDbPath)) {
    fs.unlinkSync(newDbPath)
  }

  const newDb = new Database(newDbPath)
  newDb.pragma('foreign_keys = OFF') // Temporarily disable during migration

  // ID mappings
  const userIdMap: IdMapping = {}
  const projectIdMap: IdMapping = {}
  const conversationIdMap: IdMapping = {}
  const messageIdMap: IdMapping = {}
  const attachmentIdMap: IdMapping = {}
  const fileContentIdMap: IdMapping = {}
  const providerCostIdMap: IdMapping = {}
  const creditLedgerIdMap: IdMapping = {}

  console.log('\n📊 Creating new schema with UUID PKs...')

  // Create new tables with TEXT PRIMARY KEYs
  newDb.exec(`
    -- Users table
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      subscription_tier TEXT CHECK (subscription_tier IN ('high', 'mid', 'low', NULL)),
      subscription_status TEXT CHECK (subscription_status IN ('active', 'canceled', 'past_due', NULL)),
      credits_balance INTEGER DEFAULT 0,
      current_period_end DATETIME
    );

    -- Projects table
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      context TEXT,
      system_prompt TEXT
    );

    -- Conversations table
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      user_id TEXT NOT NULL,
      title TEXT,
      model_name TEXT DEFAULT 'gemma3:4b',
      system_prompt TEXT,
      conversation_context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Messages table
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      parent_id TEXT,
      children_ids TEXT DEFAULT '[]',
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      plain_text_content TEXT,
      thinking_block TEXT,
      tool_calls TEXT,
      note TEXT,
      model_name TEXT DEFAULT 'unknown',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    -- Message attachments table
    CREATE TABLE message_attachments (
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
    );

    -- Provider cost table
    CREATE TABLE provider_cost (
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
    );

    -- Message attachment links
    CREATE TABLE message_attachment_links (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES message_attachments(id) ON DELETE CASCADE,
      UNIQUE(message_id, attachment_id)
    );

    -- Message file content
    CREATE TABLE message_file_content (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      absolute_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_content TEXT,
      size_bytes INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Message file content links
    CREATE TABLE message_file_content_links (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      file_content_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (file_content_id) REFERENCES message_file_content(id) ON DELETE CASCADE,
      UNIQUE(message_id, file_content_id)
    );

    -- Credit ledger
    CREATE TABLE credit_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      balance_after INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `)

  console.log('✅ New schema created')

  if (!oldDb) {
    console.log('⚠️  No data to migrate - new empty database created')
    newDb.pragma('foreign_keys = ON')
    newDb.close()

    // Replace old DB with new one
    fs.renameSync(newDbPath, DB_PATH)
    console.log('\n✅ Migration complete! New empty database with UUID schema created.')
    return
  }

  console.log('\n🔄 Migrating data...')

  // Migrate Users
  console.log('  👤 Migrating users...')
  const users = oldDb.prepare('SELECT * FROM users').all() as any[]
  const insertUser = newDb.prepare(`
    INSERT INTO users (id, username, created_at, stripe_customer_id, stripe_subscription_id,
                       subscription_tier, subscription_status, credits_balance, current_period_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  // Fixed UUID for the default local user (matches the hardcoded UUID in index.ts and AuthContext)
  const DEFAULT_LOCAL_USER_ID = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'

  for (const user of users) {
    // Use fixed UUID for first user (the default local user), generate random UUIDs for others
    const newId = users.length === 1 ? DEFAULT_LOCAL_USER_ID : generateId()
    userIdMap[user.id] = newId
    insertUser.run(
      newId,
      user.username,
      user.created_at,
      user.stripe_customer_id || null,
      user.stripe_subscription_id || null,
      user.subscription_tier || null,
      user.subscription_status || null,
      user.credits_balance || 0,
      user.current_period_end || null
    )
  }
  console.log(`  ✅ Migrated ${users.length} users`)
  if (users.length === 1) {
    console.log(`  📌 Used fixed UUID for local user: ${DEFAULT_LOCAL_USER_ID}`)
  }

  // Migrate Projects
  console.log('  📁 Migrating projects...')
  const projects = oldDb.prepare('SELECT * FROM projects').all() as any[]
  const insertProject = newDb.prepare(`
    INSERT INTO projects (id, name, created_at, updated_at, context, system_prompt)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  for (const project of projects) {
    const newId = generateId()
    projectIdMap[project.id] = newId
    insertProject.run(
      newId,
      project.name,
      project.created_at,
      project.updated_at,
      project.context || null,
      project.system_prompt || null
    )
  }
  console.log(`  ✅ Migrated ${projects.length} projects`)

  // Migrate Conversations
  console.log('  💬 Migrating conversations...')
  const conversations = oldDb.prepare('SELECT * FROM conversations').all() as any[]
  const insertConversation = newDb.prepare(`
    INSERT INTO conversations (id, project_id, user_id, title, model_name, system_prompt,
                                conversation_context, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const conv of conversations) {
    const newId = generateId()
    conversationIdMap[conv.id] = newId
    insertConversation.run(
      newId,
      conv.project_id ? projectIdMap[conv.project_id] : null,
      userIdMap[conv.user_id],
      conv.title || null,
      conv.model_name,
      conv.system_prompt || null,
      conv.conversation_context || null,
      conv.created_at,
      conv.updated_at
    )
  }
  console.log(`  ✅ Migrated ${conversations.length} conversations`)

  // Migrate Messages (in two passes to handle parent_id and children_ids)
  console.log('  📝 Migrating messages (pass 1 - create messages)...')
  const messages = oldDb.prepare('SELECT * FROM messages ORDER BY created_at ASC').all() as any[]
  const insertMessage = newDb.prepare(`
    INSERT INTO messages (id, conversation_id, parent_id, children_ids, role, content,
                          plain_text_content, thinking_block, tool_calls, note, model_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const msg of messages) {
    const newId = generateId()
    messageIdMap[msg.id] = newId
    // Insert with empty children_ids first, will update in pass 2
    insertMessage.run(
      newId,
      conversationIdMap[msg.conversation_id],
      null, // Will update parent_id in pass 2
      '[]', // Will update children_ids in pass 2
      msg.role,
      msg.content,
      msg.plain_text_content || null,
      msg.thinking_block || null,
      msg.tool_calls || null,
      msg.note || null,
      msg.model_name || 'unknown',
      msg.created_at
    )
  }
  console.log(`  ✅ Created ${messages.length} messages`)

  // Pass 2: Update parent_id and children_ids with new UUIDs
  console.log('  📝 Migrating messages (pass 2 - update relationships)...')
  const updateMessage = newDb.prepare(`
    UPDATE messages SET parent_id = ?, children_ids = ? WHERE id = ?
  `)

  for (const msg of messages) {
    const newId = messageIdMap[msg.id]
    const newParentId = msg.parent_id ? messageIdMap[msg.parent_id] : null

    // Parse old children_ids and convert to new UUIDs
    let newChildrenIds = '[]'
    try {
      const oldChildren = JSON.parse(msg.children_ids || '[]')
      if (Array.isArray(oldChildren) && oldChildren.length > 0) {
        const newChildren = oldChildren.map((oldChildId: number) => messageIdMap[oldChildId]).filter(Boolean)
        newChildrenIds = JSON.stringify(newChildren)
      }
    } catch (e) {
      // Keep empty array if parsing fails
    }

    updateMessage.run(newParentId, newChildrenIds, newId)
  }
  console.log(`  ✅ Updated message relationships`)

  // Migrate File Content (only if table exists in old database)
  console.log('  📄 Migrating file content...')
  const fileContentTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_file_content'")
    .get()

  let fileContents: any[] = []
  if (fileContentTableExists) {
    fileContents = oldDb.prepare('SELECT * FROM message_file_content').all() as any[]
    const insertFileContent = newDb.prepare(`
      INSERT INTO message_file_content (id, file_name, absolute_path, relative_path, file_content, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    for (const fc of fileContents) {
      const newId = generateId()
      fileContentIdMap[fc.id] = newId
      insertFileContent.run(
        newId,
        fc.file_name,
        fc.absolute_path,
        fc.relative_path,
        fc.file_content || null,
        fc.size_bytes || null,
        fc.created_at
      )
    }
    console.log(`  ✅ Migrated ${fileContents.length} file contents`)
  } else {
    console.log(`  ⚠️  message_file_content table does not exist in old database - skipping`)
  }

  // Migrate Attachments (only if table exists in old database)
  console.log('  🖼️  Migrating attachments...')
  const attachmentsTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_attachments'")
    .get()

  let attachments: any[] = []
  if (attachmentsTableExists) {
    attachments = oldDb.prepare('SELECT * FROM message_attachments').all() as any[]
    const insertAttachment = newDb.prepare(`
      INSERT INTO message_attachments (id, message_id, kind, mime_type, storage, url, file_path,
                                       width, height, size_bytes, sha256, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const att of attachments) {
      const newId = generateId()
      attachmentIdMap[att.id] = newId
      insertAttachment.run(
        newId,
        att.message_id ? messageIdMap[att.message_id] : null,
        att.kind,
        att.mime_type,
        att.storage,
        att.url || null,
        att.file_path || null,
        att.width || null,
        att.height || null,
        att.size_bytes || null,
        att.sha256 || null,
        att.created_at
      )
    }
    console.log(`  ✅ Migrated ${attachments.length} attachments`)
  } else {
    console.log(`  ⚠️  message_attachments table does not exist in old database - skipping`)
  }

  // Migrate Attachment Links (only if table exists in old database)
  console.log('  🔗 Migrating attachment links...')
  const attachmentLinksTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_attachment_links'")
    .get()

  let attachmentLinks: any[] = []
  if (attachmentLinksTableExists && attachmentsTableExists) {
    attachmentLinks = oldDb.prepare('SELECT * FROM message_attachment_links').all() as any[]
    const insertAttachmentLink = newDb.prepare(`
      INSERT INTO message_attachment_links (id, message_id, attachment_id, created_at)
      VALUES (?, ?, ?, ?)
    `)

    for (const link of attachmentLinks) {
      const newId = generateId()
      insertAttachmentLink.run(
        newId,
        messageIdMap[link.message_id],
        attachmentIdMap[link.attachment_id],
        link.created_at
      )
    }
    console.log(`  ✅ Migrated ${attachmentLinks.length} attachment links`)
  } else {
    console.log(`  ⚠️  message_attachment_links table does not exist in old database - skipping`)
  }

  // Migrate File Content Links (only if table exists in old database)
  console.log('  🔗 Migrating file content links...')
  const fileContentLinksTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_file_content_links'")
    .get()

  let fileContentLinks: any[] = []
  if (fileContentLinksTableExists && fileContentTableExists) {
    fileContentLinks = oldDb.prepare('SELECT * FROM message_file_content_links').all() as any[]
    const insertFileContentLink = newDb.prepare(`
      INSERT INTO message_file_content_links (id, message_id, file_content_id, created_at)
      VALUES (?, ?, ?, ?)
    `)

    for (const link of fileContentLinks) {
      const newId = generateId()
      insertFileContentLink.run(
        newId,
        messageIdMap[link.message_id],
        fileContentIdMap[link.file_content_id],
        link.created_at
      )
    }
    console.log(`  ✅ Migrated ${fileContentLinks.length} file content links`)
  } else {
    console.log(`  ⚠️  message_file_content_links table does not exist in old database - skipping`)
  }

  // Migrate Provider Costs (only if table exists in old database)
  console.log('  💰 Migrating provider costs...')
  const providerCostTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_cost'")
    .get()

  let providerCosts: any[] = []
  if (providerCostTableExists) {
    providerCosts = oldDb.prepare('SELECT * FROM provider_cost').all() as any[]
    const insertProviderCost = newDb.prepare(`
      INSERT INTO provider_cost (id, user_id, message_id, prompt_tokens, completion_tokens,
                                  reasoning_tokens, approx_cost, api_credit_cost, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const pc of providerCosts) {
      const newId = generateId()
      providerCostIdMap[pc.id] = newId
      insertProviderCost.run(
        newId,
        userIdMap[pc.user_id],
        messageIdMap[pc.message_id],
        pc.prompt_tokens || 0,
        pc.completion_tokens || 0,
        pc.reasoning_tokens || 0,
        pc.approx_cost || 0.0,
        pc.api_credit_cost || 0.0,
        pc.created_at
      )
    }
    console.log(`  ✅ Migrated ${providerCosts.length} provider costs`)
  } else {
    console.log(`  ⚠️  provider_cost table does not exist in old database - skipping`)
  }

  // Migrate Credit Ledger (only if table exists in old database)
  console.log('  💳 Migrating credit ledger...')
  const creditLedgerTableExists = oldDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='credit_ledger'")
    .get()

  let creditLedger: any[] = []
  if (creditLedgerTableExists) {
    creditLedger = oldDb.prepare('SELECT * FROM credit_ledger').all() as any[]
    const insertCreditLedger = newDb.prepare(`
      INSERT INTO credit_ledger (id, user_id, amount, reason, balance_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const entry of creditLedger) {
      const newId = generateId()
      creditLedgerIdMap[entry.id] = newId
      insertCreditLedger.run(
        newId,
        userIdMap[entry.user_id],
        entry.amount,
        entry.reason,
        entry.balance_after,
        entry.created_at
      )
    }
    console.log(`  ✅ Migrated ${creditLedger.length} credit ledger entries`)
  } else {
    console.log(`  ⚠️  credit_ledger table does not exist in old database - skipping`)
  }

  // Create indexes
  console.log('\n📊 Creating indexes...')
  newDb.exec(`
    CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX idx_conversations_user_id ON conversations(user_id);
    CREATE INDEX idx_messages_parent_id ON messages(parent_id);
    CREATE INDEX idx_attachments_message_id ON message_attachments(message_id);
    CREATE INDEX idx_attachments_sha256 ON message_attachments(sha256);
    CREATE INDEX idx_mal_message_id ON message_attachment_links(message_id);
    CREATE INDEX idx_mal_attachment_id ON message_attachment_links(attachment_id);
    CREATE INDEX idx_file_content_absolute_path ON message_file_content(absolute_path);
    CREATE INDEX idx_file_content_relative_path ON message_file_content(relative_path);
    CREATE INDEX idx_mfcl_message_id ON message_file_content_links(message_id);
    CREATE INDEX idx_mfcl_file_content_id ON message_file_content_links(file_content_id);
    CREATE INDEX idx_provider_cost_user_id ON provider_cost(user_id);
    CREATE INDEX idx_provider_cost_message_id ON provider_cost(message_id);
    CREATE INDEX idx_provider_cost_created_at ON provider_cost(created_at);
    CREATE INDEX idx_provider_cost_user_created ON provider_cost(user_id, created_at);
    CREATE INDEX idx_credit_ledger_user_id ON credit_ledger(user_id);
    CREATE INDEX idx_credit_ledger_created_at ON credit_ledger(created_at);
  `)
  console.log('✅ Indexes created')

  // Create FTS table and triggers
  console.log('\n🔍 Creating FTS table and triggers...')
  newDb.exec(`
    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content,
      conversation_id UNINDEXED,
      message_id UNINDEXED,
      tokenize = 'porter unicode61'
    );

    -- Populate FTS table
    INSERT INTO messages_fts(content, conversation_id, message_id)
    SELECT COALESCE(plain_text_content, content), conversation_id, id FROM messages;

    -- FTS triggers (updated for UUID)
    CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(content, conversation_id, message_id)
      VALUES (COALESCE(new.plain_text_content, new.content), new.conversation_id, new.id);
    END;

    CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
      UPDATE messages_fts
      SET content = COALESCE(new.plain_text_content, new.content)
      WHERE message_id = new.id;
    END;

    CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;

    -- Children trigger (updated for UUID with proper JSON string format)
    CREATE TRIGGER messages_children_insert AFTER INSERT ON messages
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
  console.log('✅ FTS and triggers created')

  // Create view
  console.log('\n👁️  Creating views...')
  newDb.exec(`
    CREATE VIEW provider_cost_with_message AS
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
    JOIN conversations c ON m.conversation_id = c.id;
  `)
  console.log('✅ Views created')

  // Re-enable foreign keys
  newDb.pragma('foreign_keys = ON')

  // Close databases
  oldDb.close()
  newDb.close()

  // Replace old DB with new one
  fs.renameSync(DB_PATH, path.join(DATA_DIR, `yggdrasil_old_${Date.now()}.db`))
  fs.renameSync(newDbPath, DB_PATH)

  console.log('\n✅ Migration complete!')
  console.log(`📦 Old database backed up to: ${BACKUP_PATH}`)
  console.log(`📊 Migration summary:`)
  console.log(`   - Users: ${users.length}`)
  console.log(`   - Projects: ${projects.length}`)
  console.log(`   - Conversations: ${conversations.length}`)
  console.log(`   - Messages: ${messages.length}`)
  console.log(`   - Attachments: ${attachments.length}`)
  console.log(`   - File Contents: ${fileContents.length}`)
  console.log(`   - Provider Costs: ${providerCosts.length}`)
  console.log(`   - Credit Ledger: ${creditLedger.length}`)
  console.log(`\n⚠️  IMPORTANT: You must now update your application code to use string UUIDs!`)

  // Update the migration flag in .env
  updateEnvFlag()
}

// Run migration
if (require.main === module) {
  try {
    migrateDatabase()
  } catch (error) {
    console.error('\n❌ Migration failed:', error)
    process.exit(1)
  }
}

export { migrateDatabase, needsMigration, updateEnvFlag }
