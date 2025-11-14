import Redis, { RedisOptions } from 'ioredis'

/**
 * Redis client configuration for rate limiting
 *
 * Environment Variables:
 * - REDIS_HOST: Redis server hostname (default: localhost)
 * - REDIS_PORT: Redis server port (default: 6379)
 * - REDIS_PASSWORD: Redis password (optional)
 * - REDIS_DB: Redis database number (default: 0)
 */

const baseOptions: RedisOptions = {
  // Connection retry strategy
  retryStrategy: (times: number) => {
    const delay = Math.min(times * 50, 2000)
    return delay
  },

  // Reconnect on error
  reconnectOnError: (err: Error) => {
    const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT']
    if (targetErrors.some((targetError) => err.message.includes(targetError))) {
      return true
    }
    return false
  },

  // Connection timeouts
  connectTimeout: 10000,
  maxRetriesPerRequest: 3,
}

const redisUrl = process.env.REDIS_URL

let redisClient: Redis

if (redisUrl) {
  console.log('🔌 Connecting to Redis via REDIS_URL')
  redisClient = new Redis(redisUrl, baseOptions)
} else {
  const redisConfig: RedisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    ...baseOptions,
  }

  console.log(
    `🔌 Connecting to Redis via host/port (${redisConfig.host}:${redisConfig.port}, db=${redisConfig.db})`
  )

  redisClient = new Redis(redisConfig)
}

const ATTACHMENT_CACHE_TTL_SECONDS = parseInt(process.env.ATTACHMENT_CACHE_TTL_SECONDS || '900', 10)
const ATTACHMENT_CACHE_MAX_BYTES = parseInt(process.env.ATTACHMENT_CACHE_MAX_BYTES || '0', 10)

export { redisClient, ATTACHMENT_CACHE_TTL_SECONDS, ATTACHMENT_CACHE_MAX_BYTES }

// Connection event handlers
redisClient.on('connect', () => {
  console.log('✅ Redis client connected successfully')
})

redisClient.on('ready', () => {
  console.log('✅ Redis client ready to accept commands')
})

redisClient.on('error', (err) => {
  console.error('❌ Redis client error:', err.message)
})

redisClient.on('close', () => {
  console.log('⚠️  Redis connection closed')
})

redisClient.on('reconnecting', () => {
  console.log('🔄 Redis client reconnecting...')
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Closing Redis connection...')
  await redisClient.quit()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('Closing Redis connection...')
  await redisClient.quit()
  process.exit(0)
})

export default redisClient
