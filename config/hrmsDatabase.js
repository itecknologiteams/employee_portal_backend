/**
 * ATS_HRMS SQL Server connection for HR data sync.
 * Fetches employee dates (DOB, CNIC Issue/Expiry, Joining Date) from HR_Employees table.
 *
 * .env:
 *   HRMS_HOST=192.168.20.166
 *   HRMS_USER=tech
 *   HRMS_PASS=tech
 *   HRMS_DB=ATS_HRMS
 */
import dotenv from 'dotenv'
dotenv.config()

let hrmsPool = null
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

export async function getHrmsPool() {
  if (hrmsPool) return hrmsPool
  const host = stripEnvQuotes(process.env.HRMS_HOST) || '192.168.20.166'
  const user = stripEnvQuotes(process.env.HRMS_USER) || 'tech'
  const password = stripEnvQuotes(process.env.HRMS_PASS) || 'tech'
  const database = stripEnvQuotes(process.env.HRMS_DB) || 'ATS_HRMS'
  const port = parseInt(process.env.HRMS_PORT, 10) || 1433

  if (!password) {
    console.warn('HRMS: HRMS_PASS is empty. Set HRMS_PASS in .env.')
  }

  const Mssql = await getMssql()
  hrmsPool = new Mssql.ConnectionPool({
    server: host,
    port: Number.isNaN(port) ? 1433 : port,
    database,
    user,
    password,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      enableArithAbort: true,
      connectTimeout: 30000,
    },
    pool: { max: 5, idleTimeoutMillis: 30000 },
  })
  await hrmsPool.connect()
  console.log(`✅ HRMS SQL Server connected: ${host} / ${user} @ ${database}`)
  return hrmsPool
}

/**
 * Fetch all employee dates from HR_Employees table.
 * @returns {Promise<Array<{HR_Emp_ID: string, Emp_Name: string, DOB?: Date, CNIC_Issue_Date?: Date, CNIC_Expiry_Date?: Date, Joining_Date?: Date}>>}
 */
export async function fetchAllEmployeeDatesFromHrms() {
  let pool
  try {
    pool = await getHrmsPool()
  } catch (err) {
    console.error('HRMS connection error:', err.message)
    throw err
  }

  try {
    const result = await pool.query(`
      SELECT 
        HR_Emp_ID,
        Emp_Name,
        DOB,
        CNIC_Issue_Date,
        CNIC_Expiry_Date,
        Joining_Date
      FROM HR_Employees
      WHERE HR_Emp_ID IS NOT NULL
    `)
    return result.recordset || []
  } catch (err) {
    console.error('HRMS query error:', err.message)
    throw err
  }
}

/**
 * Fetch single employee dates by HR_Emp_ID.
 * @param {string} hrEmpId - Employee ID (e.g., '10020')
 * @returns {Promise<Object|null>}
 */
export async function fetchEmployeeDatesById(hrEmpId) {
  if (!hrEmpId) return null
  let pool
  try {
    pool = await getHrmsPool()
  } catch (err) {
    console.error('HRMS connection error:', err.message)
    return null
  }

  try {
    const Mssql = await getMssql()
    const request = pool.request()
    request.input('hrEmpId', Mssql.VarChar(50), String(hrEmpId))
    const result = await request.query(`
      SELECT 
        HR_Emp_ID,
        Emp_Name,
        DOB,
        CNIC_Issue_Date,
        CNIC_Expiry_Date,
        Joining_Date
      FROM HR_Employees
      WHERE HR_Emp_ID = @hrEmpId
    `)
    return result.recordset?.[0] || null
  } catch (err) {
    console.error('HRMS query error:', err.message)
    return null
  }
}

export async function closeHrmsPool() {
  if (hrmsPool) {
    try {
      await hrmsPool.close()
    } catch (e) {}
    hrmsPool = null
  }
}
