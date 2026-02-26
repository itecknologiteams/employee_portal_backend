/**
 * CRM SQL Server connection for login validation.
 * Validates credentials via ERP_Tracking.dbo.CheckLogin (U_ID, PASS)
 * and returns CRM employee identifier to match with portal employees.employee_code.
 *
 * .env:
 *   CRM_HOST=192.168.21.33
 *   CRM_USER=crm
 *   CRM_PASS=...
 *   CRM_DB=ERP_Tracking
 */
import dotenv from 'dotenv'
dotenv.config()

let crmPool = null
let Sql = null

async function getMssql() {
  if (Sql) return Sql
  const mssql = await import('mssql')
  Sql = mssql.default || mssql
  return Sql
}

function stripEnvQuotes(s) {
  if (typeof s !== 'string') return s || ''
  return s.replace(/^['"]|['"]$/g, '').trim()
}

export async function getCrmPool() {
  if (crmPool) return crmPool
  const host = stripEnvQuotes(process.env.CRM_HOST)
  if (!host) return null
  const Mssql = await getMssql()
  const password = stripEnvQuotes(process.env.CRM_PASS || '')
  const port = parseInt(process.env.CRM_PORT, 10)
  if (!password) {
    console.warn('CRM: CRM_PASS is empty. Set CRM_PASS in .env for CRM login.')
  }
  crmPool = new Mssql.ConnectionPool({
    server: host,
    port: Number.isNaN(port) ? undefined : port,
    database: stripEnvQuotes(process.env.CRM_DB) || 'ERP_Tracking',
    user: stripEnvQuotes(process.env.CRM_USER) || 'crm',
    password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: parseInt(process.env.CRM_CONNECT_TIMEOUT || '10000', 10),
    },
    pool: { max: 5, idleTimeoutMillis: 30000 },
  })
  await crmPool.connect()
  console.log(`✅ CRM SQL Server connected: ${host} / ${stripEnvQuotes(process.env.CRM_USER) || 'crm'} @ ${stripEnvQuotes(process.env.CRM_DB) || 'ERP_Tracking'}`)
  return crmPool
}

/**
 * Run ERP_Tracking.dbo.CheckLogin(U_ID, PASS).
 * @param {string} username - U_ID
 * @param {string} password - PASS
 * @returns {Promise<{ valid: boolean, crmEmployeeId?: string|number }>}
 *   If valid, crmEmployeeId is taken from first result row (Emp_ID, HR_Emp_ID, Employee_ID, or first column).
 */
export async function checkCrmLogin(username, password) {
  let pool
  try {
    pool = await getCrmPool()
  } catch (err) {
    console.error('CRM connection error:', err.message)
    if (err.message && err.message.includes('Login failed for user')) {
      console.error('CRM: Verify in SSMS: connect to', process.env.CRM_HOST, 'with user', process.env.CRM_USER, 'and the same password. Ensure SQL Server Authentication is enabled.')
    }
    return { valid: false }
  }
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    request.input('Uname', Mssql.VarChar(200), String(username))
    request.input('Pass', Mssql.VarChar(200), String(password))
    const result = await request.execute('dbo.CheckLogin')
    const rows = result.recordset || (result.recordsets && result.recordsets[0]) || []
    if (!rows || rows.length === 0) return { valid: false }
    const row = rows[0]
    const crmEmployeeId = row.EMPLOYEE_ID ?? row.Emp_ID ?? row.HR_Emp_ID ?? row.Employee_ID ?? row.EmpId ?? row.U_ID ?? row[Object.keys(row)[0]]
    const id = crmEmployeeId != null ? String(crmEmployeeId).trim() : null
    return { valid: true, crmEmployeeId: id || undefined }
  } catch (err) {
    if (err.message && !err.message.includes('Login failed')) {
      console.error('CRM CheckLogin error:', err.message)
    }
    return { valid: false }
  }
}

export async function closeCrmPool() {
  if (crmPool) {
    try {
      await crmPool.close()
    } catch (e) {}
    crmPool = null
  }
}
