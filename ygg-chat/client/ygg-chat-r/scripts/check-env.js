#!/usr/bin/env node

/**
 * Pre-flight script to ensure .env file exists before starting dev server
 * Runs automatically via npm's "predev" hook
 */

import { existsSync, copyFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const rootDir = join(__dirname, '..')

const envPath = join(rootDir, '.env')
const envExamplePath = join(rootDir, '.env.example')

// Check if .env exists
if (!existsSync(envPath)) {
  console.log('\n⚠️  No .env file found!')

  // Check if .env.example exists
  if (existsSync(envExamplePath)) {
    console.log('📋 Copying .env.example to .env...')
    copyFileSync(envExamplePath, envPath)
    console.log('✅ .env file created successfully!\n')
    console.log('ℹ️  Default configuration:')
    console.log('   - VITE_ENVIRONMENT=local (local-only mode)')
    console.log('   - You can edit .env to customize settings\n')
  } else {
    console.error('❌ Error: .env.example not found!')
    console.error('   Please create .env.example or .env manually\n')
    process.exit(1)
  }
} else {
  console.log('✅ .env file exists\n')
}
