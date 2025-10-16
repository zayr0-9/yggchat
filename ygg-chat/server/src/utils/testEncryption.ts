import dotenv from 'dotenv'
import path from 'path'
import { clearCache, getApiKey, testAllApiKeys } from './apiKeyManager'
import { testEncryption } from './hkdfEncryption'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') })

async function runEncryptionTests() {
  // Test 1: Basic encryption/decryption
  const testString = 'test-api-key-12345'
  const basicTest = await testEncryption(testString)

  // Test 2: Test all API keys from environment
  const apiKeyResults = await testAllApiKeys()

  for (const [keyName, result] of Object.entries(apiKeyResults)) {
    const status = result ? '✅ PASSED' : '❌ FAILED'
  }

  // Test 3: Cache functionality
  clearCache() // Ensure clean start

  const start1 = process.hrtime.bigint()
  const key1 = await getApiKey('OPENROUTER_API_KEY')
  const time1 = Number(process.hrtime.bigint() - start1) / 1000000 // Convert to ms

  const start2 = process.hrtime.bigint()
  const key2 = await getApiKey('OPENROUTER_API_KEY')
  const time2 = Number(process.hrtime.bigint() - start2) / 1000000

  // Test 4: Cache clearing
  clearCache()
  const start3 = process.hrtime.bigint()
  const key3 = await getApiKey('OPENROUTER_API_KEY')
  const time3 = Number(process.hrtime.bigint() - start3) / 1000000

  // Test 5: Performance test
  const startPerf = Date.now()
  const promises = []
  for (let i = 0; i < 10; i++) {
    promises.push(testEncryption(`test-key-${i}`))
  }
  const perfResults = await Promise.all(promises)
  const totalTime = Date.now() - startPerf
  const avgTime = totalTime / 10

  // Summary (ignoring GEMINI_API_KEY since it doesn't exist in env)
  const filteredApiResults = Object.fromEntries(
    Object.entries(apiKeyResults).filter(([key]) => key !== 'GEMINI_API_KEY')
  )

  const allTestsPassed =
    basicTest &&
    Object.values(filteredApiResults).every(r => r) &&
    key1 === key2 &&
    time2 < time1 / 2 &&
    time3 > time2 * 2 &&
    perfResults.every(r => r)
}

// Only run if called directly
if (require.main === module) {
  runEncryptionTests().catch(console.error)
}

export { runEncryptionTests }
