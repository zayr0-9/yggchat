export function validateEnv(): void {
  const required = ['OLLAMA_BASE_URL', 'DATABASE_URL']

  const missing = required.filter(key => !process.env[key])

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }

  // Validate URL formats
  try {
    new URL(process.env.OLLAMA_BASE_URL!)
  } catch {
    throw new Error('Invalid OLLAMA_BASE_URL format')
  }
}
