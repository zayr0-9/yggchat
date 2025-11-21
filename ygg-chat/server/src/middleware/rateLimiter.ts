import type { Request, Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import RedisStore, { type RedisReply } from 'rate-limit-redis'
import { redisClient } from '../config/redis'

/**
 * Rate Limiting Middleware with Redis Backend
 *
 * Features:
 * - Global IP-based limiting (DDoS protection)
 * - Per-user limiting based on JWT user ID
 * - Different limits for different endpoint types
 * - IP whitelist support
 * - Standard 429 responses with retry headers
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * IP whitelist - IPs that bypass rate limiting
 * Configure via RATE_LIMIT_WHITELIST_IPS environment variable (comma-separated)
 * Example: RATE_LIMIT_WHITELIST_IPS=127.0.0.1,192.168.1.100
 */
const whitelistIPs: string[] = process.env.RATE_LIMIT_WHITELIST_IPS
  ? process.env.RATE_LIMIT_WHITELIST_IPS.split(',').map(ip => ip.trim())
  : []

/**
 * Check if IP is whitelisted
 */
function isWhitelisted(req: Request): boolean {
  const ip = req.ip || req.socket.remoteAddress || ''
  return whitelistIPs.includes(ip)
}

/**
 * Extract user ID from JWT token
 * JWT format: header.payload.signature
 * User ID is in the 'sub' (subject) claim
 */
function extractUserIdFromJWT(req: Request): string | null {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix
    const parts = token.split('.')

    if (parts.length !== 3) {
      return null
    }

    // Decode the payload (second part)
    const payload = parts[1]
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf-8')
    const claims = JSON.parse(jsonPayload)

    // Return user ID from 'sub' claim
    return claims.sub || null
  } catch (error) {
    // Silent fail - will fall back to IP-based limiting
    return null
  }
}

/**
 * Custom key generator for rate limiting
 * - Uses user ID from JWT if available (per-user limiting)
 * - Falls back to IP address if no JWT (per-IP limiting)
 * - Uses ipKeyGenerator helper for proper IPv6 support
 */
function generateRateLimitKey(prefix: string) {
  return (req: Request): string => {
    const userId = extractUserIdFromJWT(req)

    if (userId) {
      return `${prefix}:user:${userId}`
    }

    // Fallback to IP using ipKeyGenerator helper for IPv6 safety
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1'
    return `${prefix}:${ipKeyGenerator(ip)}`
  }
}

/**
 * Standard rate limit handler
 * Returns 429 with clear error message
 */
function rateLimitHandler(req: Request, res: Response) {
  const userId = extractUserIdFromJWT(req)
  const limitType = userId ? 'per-user' : 'per-IP'

  res.status(429).json({
    error: true,
    message: `Too many requests. Rate limit exceeded (${limitType}). Please try again later.`,
    code: 'RATE_LIMIT_EXCEEDED',
  })
}

/**
 * Skip rate limiting for whitelisted IPs
 */
function skipForWhitelist(req: Request): boolean {
  const whitelisted = isWhitelisted(req)

  if (whitelisted) {
    console.log(`Rate limit skipped for whitelisted IP: ${req.ip}`)
  }

  return whitelisted
}

// ============================================================================
// RATE LIMITERS
// ============================================================================

/**
 * Global rate limiter - Applied to all routes
 *
 * Limits: 1000 requests per 15 minutes per IP
 * Purpose: DDoS protection, prevent abuse
 * Tracks: IP address (not user-aware)
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per window per IP
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  store: new RedisStore({
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      return (await redisClient.call(args[0], ...args.slice(1))) as RedisReply
    },
    prefix: 'rl:global:',
  }),
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1'
    return `ip:${ipKeyGenerator(ip)}`
  },
  handler: rateLimitHandler,
  skip: skipForWhitelist,
})

/**
 * Authenticated user rate limiter - Applied to general API routes
 *
 * Limits: 500 requests per 15 minutes per user
 * Purpose: Fair usage across authenticated users
 * Tracks: User ID from JWT, falls back to IP
 */
export const authenticatedRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per window per user
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      return (await redisClient.call(args[0], ...args.slice(1))) as RedisReply
    },
    prefix: 'rl:auth:',
  }),
  keyGenerator: generateRateLimitKey('auth'),
  handler: rateLimitHandler,
  skip: skipForWhitelist,
})

/**
 * Expensive operations rate limiter
 *
 * Limits: 200 requests per 15 minutes per user
 * Purpose: Protect resource-intensive endpoints (AI streaming, search, etc.)
 * Tracks: User ID from JWT, falls back to IP
 * Applied to:
 * - POST /conversations/:id/messages (AI streaming)
 * - GET /search (database intensive)
 */
export const expensiveOperationsRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // 200 requests per window per user
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      return (await redisClient.call(args[0], ...args.slice(1))) as RedisReply
    },
    prefix: 'rl:expensive:',
  }),
  keyGenerator: generateRateLimitKey('expensive'),
  handler: rateLimitHandler,
  skip: skipForWhitelist,
})

/**
 * Auth endpoints rate limiter
 *
 * Limits: 10 requests per 15 minutes per IP
 * Purpose: Prevent brute force attacks on auth endpoints
 * Tracks: IP address only (users not yet authenticated)
 * Applied to:
 * - POST /users (user creation)
 * - PUT /users/:id (user updates)
 * - DELETE /users/:id (user deletion)
 */
export const authEndpointsRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: async (...args: string[]): Promise<RedisReply> => {
      return (await redisClient.call(args[0], ...args.slice(1))) as RedisReply
    },
    prefix: 'rl:authep:',
  }),
  keyGenerator: (req: Request) => {
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1'
    return `ip:${ipKeyGenerator(ip)}`
  },
  handler: rateLimitHandler,
  skip: skipForWhitelist,
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Log rate limiter configuration on startup
 */
export function logRateLimiterConfig() {
  console.log('\n🛡️  Rate Limiter Configuration:')
  console.log('  Global IP limit: 1000 req/15min')
  console.log('  Authenticated users: 500 req/15min')
  console.log('  Expensive operations: 200 req/15min')
  console.log('  Auth endpoints: 10 req/15min (IP-based)')

  if (whitelistIPs.length > 0) {
    console.log(`  Whitelisted IPs: ${whitelistIPs.join(', ')}`)
  } else {
    console.log('  Whitelisted IPs: None')
  }

  console.log('  Redis backend: Enabled')
  console.log('')
}

export default {
  globalRateLimiter,
  authenticatedRateLimiter,
  expensiveOperationsRateLimiter,
  authEndpointsRateLimiter,
  logRateLimiterConfig,
}
