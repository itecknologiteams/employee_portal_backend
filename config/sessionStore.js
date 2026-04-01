/**
 * PostgreSQL-backed session store using connect-pg-simple.
 *
 * Why PostgreSQL instead of Redis:
 *   - The app already depends on PostgreSQL — no new service required.
 *   - Sessions are guaranteed to persist across server restarts.
 *   - Eliminates the "401 on page refresh" issue caused by Redis being
 *     unavailable or MemoryStore being wiped on PM2 reload.
 */
import connectPgSimple from 'connect-pg-simple'
import { Pool } from 'pg'
import session from 'express-session'

const PgStore = connectPgSimple(session)

let pgPool = null

function getSessionPool() {
  if (pgPool) return pgPool
  pgPool = new Pool({
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  })
  pgPool.on('error', (err) => {
    console.error('Session DB pool error:', err.message)
  })
  return pgPool
}

/**
 * Returns a connect-pg-simple PgStore for express-session.
 * The sessions table is created automatically on first use (createTableIfMissing: true).
 */
export function createSessionStore() {
  const pool = getSessionPool()
  return new PgStore({
    pool,
    tableName: 'user_sessions',
    createTableIfMissing: true,
    ttl: parseInt(process.env.SESSION_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10) / 1000
  })
}
