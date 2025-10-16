#!/usr/bin/env ts-node
/**
 * Yggdrasil Database Migration CLI Tool
 *
 * This script migrates the database from INTEGER PKs to UUID TEXT PKs.
 * It should be run BEFORE starting the server for the first time after upgrade.
 *
 * Usage:
 *   npm run migrate --prefix server
 *   OR
 *   npx ts-node src/database/runMigration.ts
 *
 * The script is idempotent and safe to run multiple times.
 * It checks the MIGRATED_TO_UUID flag and database schema before running.
 */

import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'
import { migrateDatabase, needsMigration, updateEnvFlag } from './migrateToUUID'

// Load environment variables
const envPath = path.resolve(__dirname, '../../../.env')
dotenv.config({ path: envPath })

console.log('═══════════════════════════════════════════════════════')
console.log('🗄️  Yggdrasil Database Migration Tool')
console.log('═══════════════════════════════════════════════════════\n')

// Check if .env file exists
if (!fs.existsSync(envPath)) {
  console.log('⚠️  Warning: .env file not found at:', envPath)
  console.log('📝 A new .env file will be created after migration\n')
}

// Check flag
const migrationFlag = process.env.MIGRATED_TO_UUID

if (migrationFlag === 'true') {
  console.log('✅ Database already migrated (MIGRATED_TO_UUID=true)')
  console.log('ℹ️  Migration will be skipped')
  console.log('\nTo force re-migration:')
  console.log('  1. Set MIGRATED_TO_UUID=false in .env')
  console.log('  2. Run: npm run migrate --prefix server\n')
  console.log('✨ Ready to start server: npm run dev')
  process.exit(0)
}

console.log('⚠️  MIGRATED_TO_UUID flag is not set or false')
console.log('🔍 Checking if database needs migration...\n')

if (!needsMigration()) {
  console.log('✅ Database already uses UUID (TEXT) primary keys')
  console.log('📝 Updating MIGRATED_TO_UUID flag to true in .env')
  updateEnvFlag()
  console.log('\n✨ No migration needed! Database is ready.')
  console.log('📝 You can now start the server: npm run dev\n')
  process.exit(0)
}

console.log('🚨 INTEGER primary keys detected - migration required!')
console.log('🚀 Starting database migration...\n')
console.log('⏱️  This may take a few moments depending on database size...\n')

try {
  migrateDatabase()

  console.log('\n═══════════════════════════════════════════════════════')
  console.log('✅ Migration completed successfully!')
  console.log('═══════════════════════════════════════════════════════\n')
  console.log('📝 Next steps:')
  console.log('  1. Verify backup was created in server/src/data/')
  console.log('  2. Start server: npm run dev')
  console.log('  3. Test that everything works correctly\n')
  console.log('💡 If you encounter issues, restore from backup and report the error.\n')

  process.exit(0)
} catch (error) {
  console.error('\n═══════════════════════════════════════════════════════')
  console.error('❌ Migration Failed!')
  console.error('═══════════════════════════════════════════════════════\n')
  console.error('Error details:', error)
  console.error('\n🛟 Recovery steps:')
  console.error('  1. Check the error message above')
  console.error('  2. Restore from backup if needed (server/src/data/yggdrasil_backup_*.db)')
  console.error('  3. Fix the issue and run: npm run migrate --prefix server\n')
  console.error('💬 Need help? Open an issue at: https://github.com/zayr0-9/Yggdrasil/issues\n')

  process.exit(1)
}
