/**
 * Redis-backed session store using connect-redis + ioredis.
 * Sessions survive server restarts and are shared across processes.
 */
import { RedisStore } from 'connect-redis'
import IORedis from 'ioredis'

let redisClient = null

function getSessionRedisClient() {
  if (redisClient) return redisClient
  redisClient = new IORedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    // Reconnect on failure — important for session continuity
    retryStrategy: (times) => Math.min(times * 200, 5000),
    enableOfflineQueue: false
  })

  redisClient.on('error', (err) => {
    console.error('Session Redis error:', err.message)
  })
  redisClient.on('connect', () => {
    console.log('Session Redis connected')
  })

  return redisClient
}

/**
 * Returns a connect-redis RedisStore instance for express-session.
 */
export function createSessionStore() {
  const client = getSessionRedisClient()
  return new RedisStore({
    client,
    prefix: 'sess:',
    ttl: parseInt(process.env.SESSION_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10) / 1000
  })
}
