import dotenv from 'dotenv'
dotenv.config()

const CRM_ENABLED = process.env.CRM_LOGIN_ENABLED === '1' || process.env.CRM_LOGIN_ENABLED === 'true'

let crmPool = null

async function getCrmPool() {
  if (crmPool) return crmPool
  const sql = await import('mssql')
  const Sql = sql.default || sql
  crmPool = new Sql.ConnectionPool({
    server: process.env.CRM_HOST || '192.168.21.33',
    database: process.env.CRM_DB || 'ERP_Tracking',
    user: process.env.CRM_USER || 'crm',
    password: process.env.CRM_PASS || '',
    port: parseInt(process.env.CRM_PORT || '1433', 10),
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: parseInt(process.env.CRM_CONNECT_TIMEOUT || '10000', 10),
    },
    pool: { max: 5, idleTimeoutMillis: 30000 },
  })
  await crmPool.connect()
  console.log('✅ Connected to CRM SQL Server (ERP_Tracking) for login validation')
  return crmPool
}

/**
 * Validate credentials against CRM stored procedure ERP_Tracking.dbo.CheckLogin.
 * EXEC ERP_Tracking.dbo.CheckLogin @U_ID, @PASS
 * @param {string} loginId - U_ID (username)
 * @param {string} password - PASS
 * @returns {Promise<boolean>} true if CRM says login is valid
 */
export async function checkLoginWithCrm(loginId, password) {
  if (!CRM_ENABLED) return null
  if (!loginId || !password) return false
  let pool
  try {
    pool = await getCrmPool()
    const sql = await import('mssql')
    const request = pool.request()
    request.input('U_ID', sql.VarChar(100), loginId)
    request.input('PASS', sql.VarChar(200), password)
    // Execute stored proc: EXEC dbo.CheckLogin @U_ID, @PASS (database is already ERP_Tracking)
    const result = await request.execute('dbo.CheckLogin')
    const returnValue = result.returnValue
    const rows = result.recordset || []
    // Success: proc returns 1, or returns a non-empty result set
    if (typeof returnValue === 'number' && returnValue === 1) return true
    if (Array.isArray(rows) && rows.length > 0) return true
    return false
  } catch (err) {
    console.error('CRM CheckLogin error:', err.message)
    return false
  }
}

export function isCrmLoginEnabled() {
  return CRM_ENABLED
}

export default { checkLoginWithCrm, isCrmLoginEnabled }
