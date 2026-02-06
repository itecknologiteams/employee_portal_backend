import dotenv from 'dotenv'
dotenv.config()

const useSqlServer = process.env.DB_DRIVER === 'sqlserver'

let pool = null

function getPool() {
  return pool
}

async function initPool() {
  if (pool) return pool
  if (useSqlServer) {
    const sql = await import('mssql')
    const Sql = sql.default || sql
    pool = new Sql.ConnectionPool({
      server: process.env.DB_HOST || '192.168.20.166',
      database: process.env.DB_DATABASE || 'iteck_erp',
      user: process.env.DB_USER || 'tech',
      password: process.env.DB_PASSWORD || 'tech',
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT || '15000', 10),
      },
      pool: { max: 20, idleTimeoutMillis: 30000 },
    })
    await pool.connect()
    console.log('✅ Connected to SQL Server database (iteck_erp)')
    return pool
  }
  const { Pool } = await import('pg')
  pool = new Pool({
    host: process.env.DB_HOST || '192.168.20.21',
    database: process.env.DB_DATABASE || 'employee_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '12345678',
    port: parseInt(process.env.DB_PORT || '5432'),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT || '10000', 10),
  })
  pool.on('connect', () => console.log('✅ Connected to PostgreSQL database'))
  pool.on('error', (err) => console.error('❌ Database pool error:', err.message))
  return pool
}

function bindParams(request, query, params = []) {
  let sql = query
  for (let i = 0; i < params.length; i++) {
    const paramName = `p${i + 1}`
    sql = sql.replace(new RegExp(`\\$${i + 1}\\b`, 'g'), `@${paramName}`)
    request.input(paramName, params[i])
  }
  return sql
}

export const getConnection = async () => {
  const p = await initPool()
  if (useSqlServer) return p
  return p.connect()
}

export const closeConnection = async () => {
  try {
    if (pool) {
      if (useSqlServer && pool.close) await pool.close()
      else if (pool.end) await pool.end()
      pool = null
    }
    console.log('Database connection pool closed')
  } catch (error) {
    console.error('Error closing database connection:', error)
  }
}

export const executeQuery = async (query, params = []) => {
  const p = await initPool()
  if (useSqlServer) {
    const request = p.request()
    const boundSql = bindParams(request, query, params)
    const result = await request.query(boundSql)
    return result.recordset || []
  }
  const client = await p.connect()
  try {
    const result = await client.query(query, params)
    return result.rows
  } finally {
    client.release()
  }
}

export const executeTransaction = async (queries) => {
  const p = await initPool()
  if (useSqlServer) {
    const transaction = p.transaction()
    await transaction.begin()
    const results = []
    try {
      for (const { query, params = [] } of queries) {
        const request = transaction.request()
        const boundSql = bindParams(request, query, params)
        const result = await request.query(boundSql)
        results.push(result.recordset || [])
      }
      await transaction.commit()
      return results
    } catch (err) {
      await transaction.rollback()
      console.error('Transaction error:', err.message)
      throw err
    }
  }
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    const results = []
    for (const { query, params } of queries) {
      const result = await client.query(query, params)
      results.push(result.rows)
    }
    await client.query('COMMIT')
    return results
  } catch (error) {
    await client.query('ROLLBACK')
    console.error('Transaction error:', error.message)
    throw error
  } finally {
    client.release()
  }
}

export default { getConnection, closeConnection, executeQuery, executeTransaction }
