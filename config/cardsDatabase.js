import dotenv from 'dotenv'
dotenv.config()

const { Pool } = await import('pg')

let cardsPool = null

/**
 * Pool for employee_cards database (same host/user/password as main .env; database = employee_cards).
 * Used only for /api/cards (technician profile cards).
 */
function getCardsPool() {
  if (!cardsPool) {
    const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1'
    cardsPool = new Pool({
      host: process.env.DB_HOST || '192.168.21.31',
      database: process.env.DB_CARDS_DATABASE || 'employee_cards',
      user: process.env.DB_USER || 'employee_dev',
      password: process.env.DB_PASSWORD || 'EmP$D3v#2026!qR4',
      port: parseInt(process.env.DB_PORT || '6632', 10),
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...(useSsl && { ssl: { rejectUnauthorized: process.env.DB_SSL_VERIFY !== 'false' } }),
    })
    cardsPool.on('error', (err) => console.error('❌ Cards DB pool error:', err.message))
  }
  return cardsPool
}

export async function executeQueryCards(query, params = []) {
  const pool = getCardsPool()
  const client = await pool.connect()
  try {
    const result = await client.query(query, params)
    return result.rows
  } finally {
    client.release()
  }
}

export async function closeCardsPool() {
  if (cardsPool) {
    await cardsPool.end()
    cardsPool = null
  }
}
