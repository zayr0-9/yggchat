import { encryptApiKey, decryptApiKey, EncryptedData } from './hkdfEncryption'

interface CachedKey {
  decryptedKey: string
  timestamp: number
}

const CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const keyCache = new Map<string, CachedKey>()

const API_KEY_NAMES = [
  'OPENROUTER_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GEMINI_API_KEY',
  'BRAVE_API_KEY'
] as const

type ApiKeyName = typeof API_KEY_NAMES[number]

function isValidApiKeyName(name: string): name is ApiKeyName {
  return API_KEY_NAMES.includes(name as ApiKeyName)
}

function getCachedKey(keyName: string): string | null {
  const cached = keyCache.get(keyName)
  if (!cached) return null

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    keyCache.delete(keyName)
    return null
  }

  return cached.decryptedKey
}

function setCachedKey(keyName: string, decryptedKey: string): void {
  keyCache.set(keyName, {
    decryptedKey,
    timestamp: Date.now()
  })
}

export function clearCache(): void {
  keyCache.clear()
}

export function clearKeyFromCache(keyName: string): void {
  keyCache.delete(keyName)
}

export async function getApiKey(keyName: string): Promise<string | undefined> {
  if (!isValidApiKeyName(keyName)) {
    throw new Error(`Invalid API key name: ${keyName}`)
  }

  // Check cache first
  const cached = getCachedKey(keyName)
  if (cached) {
    return cached
  }

  // Get from environment (in prototype, later this will be from Supabase)
  const envKey = process.env[keyName]
  if (!envKey) {
    return undefined
  }

  // If ENCRYPTION_MASTER_KEY is not set, skip encryption (local dev mode)
  if (!process.env.ENCRYPTION_MASTER_KEY) {
    setCachedKey(keyName, envKey)
    return envKey
  }

  try {
    // For prototype: encrypt then decrypt to test the flow
    // This simulates what will happen with Supabase stored encrypted keys
    const encrypted = await encryptApiKey(envKey)
    const decrypted = await decryptApiKey(encrypted)

    // Cache the decrypted key
    setCachedKey(keyName, decrypted)

    return decrypted
  } catch (error) {
    console.error(`Failed to decrypt API key ${keyName}:`, error)
    throw error
  }
}

export async function testAllApiKeys(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {}

  for (const keyName of API_KEY_NAMES) {
    try {
      const key = await getApiKey(keyName)
      const envKey = process.env[keyName]

      // Test that decrypted key matches original
      results[keyName] = key === envKey && !!key
    } catch (error) {
      console.error(`Error testing ${keyName}:`, error)
      results[keyName] = false
    }
  }

  return results
}

// For future Supabase integration
export async function setUserApiKey(_userId: string, _keyName: string, _plainKey: string): Promise<void> {
  // TODO: Implement when Supabase is integrated
  // 1. Encrypt the plainKey using user-specific salt derived from userId
  // 2. Store encrypted key in Supabase user_api_keys table
  // 3. Clear cache for this user's key
  throw new Error('setUserApiKey not implemented - requires Supabase integration')
}

export async function getUserApiKey(_userId: string, _keyName: string): Promise<string | undefined> {
  // TODO: Implement when Supabase is integrated
  // 1. Fetch encrypted key from Supabase for this userId + keyName
  // 2. Decrypt using user-specific salt derived from userId
  // 3. Cache the decrypted key with user context
  throw new Error('getUserApiKey not implemented - requires Supabase integration')
}