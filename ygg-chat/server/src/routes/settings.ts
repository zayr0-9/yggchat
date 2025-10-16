// server/src/routes/settings.ts
import express from 'express'
import fs from 'fs'
import path from 'path'
import { asyncHandler } from '../utils/asyncHandler'

const router = express.Router()

// Path to .env file (relative to server root)
const ENV_PATH = path.join(__dirname, '../../../.env')

// Parse .env file content into key-value pairs
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
      const equalIndex = trimmed.indexOf('=')
      if (equalIndex > 0) {
        const key = trimmed.substring(0, equalIndex).trim()
        const value = trimmed.substring(equalIndex + 1).trim()
        // Remove quotes if present
        result[key] = value.replace(/^["']|["']$/g, '')
      }
    }
  }

  return result
}

// Convert key-value pairs back to .env format
function formatEnvFile(envVars: Record<string, string>): string {
  return (
    Object.entries(envVars)
      .map(([key, value]) => {
        // Add quotes if value contains spaces or special characters
        const needsQuotes = /[\s#"'\\]/.test(value)
        const formattedValue = needsQuotes ? `"${value.replace(/"/g, '\\"')}"` : value
        return `${key}=${formattedValue}`
      })
      .join('\n') + '\n'
  )
}

// Default API keys that should always be present
const DEFAULT_API_KEYS = {
  GOOGLE_GENERATIVE_AI_API_KEY: '',
  ANTHROPIC_API_KEY: '',
  OPENAI_API_KEY: '',
  OPENROUTER_API_KEY: '',
  BRAVE_API_KEY: '',
}

// GET /api/settings/env - Read current .env file
router.get(
  '/env',
  asyncHandler(async (req, res) => {
    try {
      if (!fs.existsSync(ENV_PATH)) {
        // Create empty .env file if it doesn't exist
        fs.writeFileSync(ENV_PATH, '')
        return res.json(DEFAULT_API_KEYS)
      }

      const content = fs.readFileSync(ENV_PATH, 'utf-8')
      const envVars = parseEnvFile(content)

      // Ensure default API keys are always present
      const result = { ...DEFAULT_API_KEYS, ...envVars }
      res.json(result)
    } catch (error) {
      console.error('Error reading .env file:', error)
      res.status(500).json({ error: 'Failed to read .env file' })
    }
  })
)

// PUT /api/settings/env - Update .env file
router.put(
  '/env',
  asyncHandler(async (req, res) => {
    try {
      const envVars = req.body

      if (!envVars || typeof envVars !== 'object') {
        return res.status(400).json({ error: 'Invalid request body' })
      }

      // Validate keys (no spaces, special characters)
      for (const key of Object.keys(envVars)) {
        if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) {
          return res.status(400).json({
            error: `Invalid environment variable name: ${key}. Use only letters, numbers, and underscores.`,
          })
        }
      }

      // Ensure default API keys are always included
      const finalEnvVars = { ...DEFAULT_API_KEYS, ...envVars }

      const content = formatEnvFile(finalEnvVars)
      fs.writeFileSync(ENV_PATH, content)

      res.json({ success: true, message: 'Environment variables updated successfully' })
    } catch (error) {
      console.error('Error writing .env file:', error)
      res.status(500).json({ error: 'Failed to write .env file' })
    }
  })
)

export default router
