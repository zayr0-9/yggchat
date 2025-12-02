/**
 * OOB (Out-of-Band) Token Store
 * 
 * Redis-backed storage for OAuth tokens during the OOB authentication flow.
 * Used when users authenticate via browser and need to enter a code back in Electron.
 */

import crypto from 'crypto'
import { redisClient } from '../config/redis'

const OOB_PREFIX = 'oob-code:'
const OOB_TTL = 300 // 5 minutes
const RATE_LIMIT_PREFIX = 'oob-issue:'
const RATE_LIMIT_TTL = 900 // 15 minutes
const MAX_ISSUES_PER_IP = 10

/**
 * Generate user-friendly code: "ABCD-1234"
 * Uses characters that are unambiguous (no I/O/0/1)
 */
function generateUserCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // No I, O (confusing)
  const nums = '23456789' // No 0, 1 (confusing)
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[crypto.randomInt(chars.length)]
  code += '-'
  for (let i = 0; i < 4; i++) code += nums[crypto.randomInt(nums.length)]
  return code
}

/**
 * Check rate limit for code issuance
 * Prevents abuse by limiting code generation per IP
 */
export async function checkIssueRateLimit(ip: string): Promise<boolean> {
  const key = `${RATE_LIMIT_PREFIX}${ip}`
  const count = await redisClient.incr(key)
  if (count === 1) {
    await redisClient.expire(key, RATE_LIMIT_TTL)
  }
  return count <= MAX_ISSUES_PER_IP
}

/**
 * Store tokens with generated code
 * Returns the user-friendly code to display
 */
export async function storeOOBTokens(
  accessToken: string,
  refreshToken: string
): Promise<string> {
  const code = generateUserCode()
  const key = `${OOB_PREFIX}${code}`

  await redisClient.set(
    key,
    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
    'EX',
    OOB_TTL
  )

  return code
}

/**
 * Retrieve and delete tokens (single-use)
 * Uses GET then DEL pattern for atomic single-use
 */
export async function exchangeOOBCode(
  code: string
): Promise<{ access_token: string; refresh_token: string } | null> {
  const normalizedCode = code.toUpperCase().trim()
  const key = `${OOB_PREFIX}${normalizedCode}`

  // GET then DEL if exists (single-use pattern)
  const data = await redisClient.get(key)
  if (!data) return null

  await redisClient.del(key)
  return JSON.parse(data)
}
