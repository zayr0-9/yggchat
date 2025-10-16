#!/usr/bin/env ts-node
/**
 * Yggdrasil Database Update Script
 *
 * This script updates all existing projects with NULL user_id to the local user ID.
 * It's designed for local mode where all projects should belong to the local user.
 *
 * Usage:
 *   npm run update-projects --prefix server
 *   OR
 *   npx ts-node src/database/updateProjectsUserId.ts
 *
 * The script is idempotent and safe to run multiple times.
 * It only updates projects where user_id IS NULL.
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DATA_DIR = path.join(__dirname, '../data')
const DB_PATH = path.join(DATA_DIR, 'yggdrasil.db')

// Fixed local user ID (matches AuthContext.tsx and index.ts)
const LOCAL_USER_ID = 'a7c485cb-99e7-4cf2-82a9-6e23b55cdfc3'

console.log('═══════════════════════════════════════════════════════')
console.log('🔧 Yggdrasil Projects User ID Update Tool')
console.log('═══════════════════════════════════════════════════════\n')

// Check if database exists
if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database file not found at:', DB_PATH)
  console.error('📝 Please create the database first by starting the server\n')
  process.exit(1)
}

try {
  const db = new Database(DB_PATH)

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Check if projects table exists
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get()
  if (!tableExists) {
    console.error('❌ Projects table does not exist in the database')
    console.error('📝 Please initialize the database first by starting the server\n')
    db.close()
    process.exit(1)
  }

  // Check if user_id column exists
  const tableInfo = db.prepare('PRAGMA table_info(projects)').all() as Array<{
    cid: number
    name: string
    type: string
  }>

  const hasUserIdColumn = tableInfo.some(col => col.name === 'user_id')
  if (!hasUserIdColumn) {
    console.error('❌ user_id column does not exist in projects table')
    console.error('📝 Please start the server once to run the migration that adds the user_id column\n')
    db.close()
    process.exit(1)
  }

  // Check if the local user exists
  const userExists = db.prepare('SELECT id, username FROM users WHERE id = ?').get(LOCAL_USER_ID) as { id: string, username: string } | undefined

  if (!userExists) {
    console.error(`❌ Local user (${LOCAL_USER_ID}) does not exist in the database`)
    console.error('📝 Please start the server once to create the default local user\n')
    db.close()
    process.exit(1)
  }

  console.log(`✅ Found local user: ${userExists.username} (${userExists.id})\n`)

  // Count projects with NULL user_id
  const countBefore = db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id IS NULL').get() as { count: number }

  console.log(`📊 Projects with NULL user_id: ${countBefore.count}`)

  if (countBefore.count === 0) {
    console.log('✅ All projects already have a user_id assigned')
    console.log('📝 No updates needed!\n')
    db.close()
    process.exit(0)
  }

  // Get list of projects that will be updated (for logging)
  const projectsToUpdate = db.prepare('SELECT id, name FROM projects WHERE user_id IS NULL').all() as Array<{ id: string, name: string }>

  console.log('\n📝 Projects that will be updated:')
  projectsToUpdate.forEach((project, index) => {
    console.log(`   ${index + 1}. ${project.name} (${project.id})`)
  })

  console.log('\n🔄 Updating projects...')

  // Update all projects with NULL user_id to the local user
  const updateStmt = db.prepare('UPDATE projects SET user_id = ? WHERE user_id IS NULL')
  const result = updateStmt.run(LOCAL_USER_ID)

  // Count projects after update (should be 0)
  const countAfter = db.prepare('SELECT COUNT(*) as count FROM projects WHERE user_id IS NULL').get() as { count: number }

  console.log(`\n✅ Updated ${result.changes} projects`)
  console.log(`📊 Projects with NULL user_id after update: ${countAfter.count}`)

  if (countAfter.count === 0 && result.changes === countBefore.count) {
    console.log('\n═══════════════════════════════════════════════════════')
    console.log('✅ Update completed successfully!')
    console.log('═══════════════════════════════════════════════════════\n')
    console.log(`📝 All ${result.changes} projects now belong to: ${userExists.username}`)
    console.log('🚀 You can now start/restart your server\n')
  } else {
    console.warn('\n⚠️  Warning: Unexpected count after update')
    console.warn(`   Expected to update ${countBefore.count}, actually updated ${result.changes}`)
    console.warn(`   Projects still with NULL user_id: ${countAfter.count}\n`)
  }

  db.close()
  process.exit(0)
} catch (error) {
  console.error('\n═══════════════════════════════════════════════════════')
  console.error('❌ Update Failed!')
  console.error('═══════════════════════════════════════════════════════\n')
  console.error('Error details:', error)
  console.error('\n🛟 Recovery steps:')
  console.error('  1. Check the error message above')
  console.error('  2. Ensure the database file exists and is not corrupted')
  console.error('  3. Try running the script again\n')

  process.exit(1)
}
