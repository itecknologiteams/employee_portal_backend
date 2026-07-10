import dotenv from 'dotenv'
dotenv.config()

const { Pool } = await import('pg')

let payrollPool = null

/**
 * Pool for the iteck_payroll database (same host/user/password as main .env; database = iteck_payroll).
 * Payroll is kept in its own database to avoid mixups with the portal DB. Employee data is NOT
 * duplicated here — the app joins it from the portal pool (config/database.js) at the service layer.
 */
function getPayrollPool() {
  if (!payrollPool) {
    const useSsl = process.env.DB_SSL === 'true' || process.env.DB_SSL === '1'
    payrollPool = new Pool({
      host: process.env.DB_HOST || '192.168.21.31',
      database: process.env.DB_PAYROLL_DATABASE || 'iteck_Payroll',
      user: process.env.DB_USER || 'employee_dev',
      password: process.env.DB_PASSWORD || 'EmP$D3v#2026!qR4',
      port: parseInt(process.env.DB_PORT || '6632', 10),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ...(useSsl && { ssl: { rejectUnauthorized: process.env.DB_SSL_VERIFY !== 'false' } }),
    })
    payrollPool.on('error', (err) => console.error('❌ Payroll DB pool error:', err.message))
  }
  return payrollPool
}

export async function executeQueryPayroll(query, params = []) {
  const pool = getPayrollPool()
  const client = await pool.connect()
  try {
    const result = await client.query(query, params)
    return result.rows
  } finally {
    client.release()
  }
}

/**
 * Run a callback inside a single BEGIN/COMMIT (ROLLBACK on throw). Use for multi-statement
 * writes that must be atomic — e.g. inserting a payroll_loan header plus its installment rows.
 */
export async function executeTransactionPayroll(callback) {
  const pool = getPayrollPool()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function closePayrollPool() {
  if (payrollPool) {
    await payrollPool.end()
    payrollPool = null
  }
}
