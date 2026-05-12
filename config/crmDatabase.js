/**
 * CRM SQL Server connection for login validation.
 * Validates credentials via ERP_Tracking.dbo.CheckLogin (U_ID, PASS)
 * and returns CRM employee identifier to match with portal employees.employee_code.
 *
 * .env:
 *   CRM_HOST=192.168.21.33
 *   CRM_FALLBACK_IP=192.168.21.33    # Fallback if hostname doesn't resolve
 *   CRM_USER=crm
 *   CRM_PASS=...
 *   CRM_DB=ERP_Tracking
 */
import dotenv from 'dotenv'
import dns from 'dns'
import { promisify } from 'util'

dotenv.config()

const dnsLookup = promisify(dns.lookup)

let crmPool = null
let Sql = null
let lastHostTried = null

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

/**
 * Resolve hostname to IP address. Returns null if fails.
 */
async function resolveHostnameToIp(hostname) {
  try {
    const { address } = await dnsLookup(hostname)
    return address
  } catch (err) {
    console.log(`CRM: DNS lookup failed for ${hostname}: ${err.message}`)
    return null
  }
}

/**
 * Get the effective server address to use.
 * Tries: 1) Hostname as-is, 2) DNS resolved IP, 3) Fallback IP from .env
 */
async function getEffectiveServerAddress(host, fallbackIp) {
  // Check if host is already an IP
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4Regex.test(host)) {
    return host
  }

  // Try to resolve hostname
  console.log(`CRM: Attempting to resolve hostname ${host}...`)
  const resolvedIp = await resolveHostnameToIp(host)
  
  if (resolvedIp) {
    console.log(`CRM: ${host} resolved to ${resolvedIp}`)
    return resolvedIp
  }

  // Fallback to IP from .env
  if (fallbackIp) {
    console.log(`CRM: Falling back to CRM_FALLBACK_IP: ${fallbackIp}`)
    return fallbackIp
  }

  // Last resort: return original host and hope for the best
  console.warn(`CRM: Could not resolve ${host} and no fallback IP configured. Trying anyway...`)
  return host
}

export async function getCrmPool() {
  if (crmPool) return crmPool

  const host = stripEnvQuotes(process.env.CRM_HOST)
  if (!host) return null

  const fallbackIp = stripEnvQuotes(process.env.CRM_FALLBACK_IP || '')
  const Mssql = await getMssql()
  const password = stripEnvQuotes(process.env.CRM_PASS || '')
  const port = parseInt(process.env.CRM_PORT, 10)

  if (!password) {
    console.warn('CRM: CRM_PASS is empty. Set CRM_PASS in .env for CRM login.')
  }

  // Resolve hostname to IP if needed
  const serverAddress = await getEffectiveServerAddress(host, fallbackIp)
  lastHostTried = serverAddress

  crmPool = new Mssql.ConnectionPool({
    server: serverAddress,
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
  console.log(`✅ CRM SQL Server connected: ${serverAddress} (original: ${host}) / ${stripEnvQuotes(process.env.CRM_USER) || 'crm'} @ ${stripEnvQuotes(process.env.CRM_DB) || 'ERP_Tracking'}`)
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
      console.error('CRM: Verify in SSMS: connect to', lastHostTried || process.env.CRM_HOST, 'with user', process.env.CRM_USER, 'and the same password. Ensure SQL Server Authentication is enabled.')
    }
    return { valid: false }
  }
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    request.input('U_ID', Mssql.VarChar(200), String(username))
    request.input('PASS', Mssql.VarChar(200), String(password))
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

/**
 * Resolve CRM username (U_ID) to employee ID for portal matching.
 * When CheckLogin returns only username, use this to get EMPLOYEE_ID from USERS.
 * .env: CRM_USERS_TABLE, CRM_USERS_MATCH_COLUMN (e.g. EMPLOYEE_ID), CRM_USERS_USERNAME_COLUMN (e.g. U_ID).
 * @param {string} username - Login username (e.g. ALI.ASIF)
 * @returns {Promise<string|null>} EMPLOYEE_ID from CRM or null
 */
export async function getCrmEmployeeIdByUsername(username) {
  if (!username || String(username).trim() === '') return null
  let pool
  try {
    pool = await getCrmPool()
  } catch (err) {
    return null
  }
  const table = stripEnvQuotes(process.env.CRM_USERS_TABLE) || 'USERS'
  const matchCol = stripEnvQuotes(process.env.CRM_USERS_MATCH_COLUMN) || 'EMPLOYEE_ID'
  const usernameCol = stripEnvQuotes(process.env.CRM_USERS_USERNAME_COLUMN) || 'U_ID'
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    request.input('username', Mssql.VarChar(200), String(username).trim())
    const query = `SELECT ${matchCol} FROM ${table} WHERE ${usernameCol} = @username`
    const result = await request.query(query)
    const rows = result.recordset || []
    const val = rows[0]?.[matchCol] ?? rows[0]?.['EMPLOYEE_ID'] ?? rows[0]?.[Object.keys(rows[0] || {})[0]]
    return val != null ? String(val).trim() : null
  } catch (err) {
    return null
  }
}

/**
 * Get official email for a single employee from CRM SQL Server USERS table.
 * Uses .env: CRM_HOST, CRM_USER, CRM_PASS, CRM_DB; CRM_USERS_TABLE, CRM_USERS_EMAIL, CRM_USERS_MATCH_COLUMN.
 * @param {string} employeeCode - Employee code (matches EMPLOYEE_ID in USERS)
 * @returns {Promise<string|null>} Email or null if not found / CRM unavailable
 */
export async function getOfficialEmailFromCrm(employeeCode) {
  if (!employeeCode || String(employeeCode).trim() === '') return null
  const code = String(employeeCode).trim()
  let pool
  try {
    pool = await getCrmPool()
  } catch (err) {
    return null
  }
  const table = stripEnvQuotes(process.env.CRM_USERS_TABLE) || 'USERS'
  const emailCol = stripEnvQuotes(process.env.CRM_USERS_EMAIL) || 'EMAIL'
  const matchCol = stripEnvQuotes(process.env.CRM_USERS_MATCH_COLUMN) || 'EMPLOYEE_ID'
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    request.input('matchCode', Mssql.VarChar(100), code)
    const query = `SELECT ${emailCol} FROM ${table} WHERE ${matchCol} = @matchCode AND ${emailCol} IS NOT NULL AND LTRIM(RTRIM(${emailCol})) != ''`
    const result = await request.query(query)
    const rows = result.recordset || []
    const email = rows[0]?.[emailCol] ?? rows[0]?.EMAIL
    return email ? String(email).trim() : null
  } catch (err) {
    return null
  }
}

/**
 * Get email addresses from CRM SQL Server USERS table for given employee codes/IDs.
 * Used for requisition notifications (HOD, Committee, CEO, Procurement, Finance).
 * .env: CRM_USERS_TABLE=USERS, CRM_USERS_EMAIL=EMAIL, CRM_USERS_MATCH_COLUMN=EMPLOYEE_ID (column in USERS that matches employee_code)
 */
export async function getEmailsFromCrmUsers(employeeCodes) {
  if (!employeeCodes || !Array.isArray(employeeCodes) || employeeCodes.length === 0) return []
  const codes = [...new Set(employeeCodes.map((c) => String(c).trim()).filter(Boolean))]
  if (codes.length === 0) return []
  let pool
  try {
    pool = await getCrmPool()
  } catch (err) {
    console.error('CRM (getEmailsFromCrmUsers): connection failed', err.message)
    return []
  }
  const table = stripEnvQuotes(process.env.CRM_USERS_TABLE) || 'USERS'
  const emailCol = stripEnvQuotes(process.env.CRM_USERS_EMAIL) || 'EMAIL'
  const matchCol = stripEnvQuotes(process.env.CRM_USERS_MATCH_COLUMN) || 'EMPLOYEE_ID'
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    codes.forEach((c, i) => { request.input(`c${i}`, Mssql.VarChar(100), c) })
    const inClause = codes.map((_, i) => `@c${i}`).join(', ')
    const query = `SELECT ${emailCol} FROM ${table} WHERE ${matchCol} IN (${inClause}) AND ${emailCol} IS NOT NULL AND LTRIM(RTRIM(${emailCol})) != ''`
    const result = await request.query(query)
    const rows = result.recordset || []
    return rows.map((r) => r[emailCol] || r.EMAIL).filter(Boolean)
  } catch (err) {
    console.error('CRM getEmailsFromCrmUsers error:', err.message)
    return []
  }
}

/**
 * Map employee_code (lowercase) → official email from CRM USERS.
 * Used for CRM-first recipient resolution (portal personal email only as fallback).
 */
export async function getCrmEmailMapByEmployeeCodes(employeeCodes) {
  const map = new Map()
  if (!employeeCodes || !Array.isArray(employeeCodes) || employeeCodes.length === 0) return map
  const codes = [...new Set(employeeCodes.map((c) => String(c).trim()).filter(Boolean))]
  if (codes.length === 0) return map
  let pool
  try {
    pool = await getCrmPool()
  } catch (err) {
    console.error('CRM (getCrmEmailMapByEmployeeCodes): connection failed', err.message)
    return map
  }
  const table = stripEnvQuotes(process.env.CRM_USERS_TABLE) || 'USERS'
  const emailCol = stripEnvQuotes(process.env.CRM_USERS_EMAIL) || 'EMAIL'
  const matchCol = stripEnvQuotes(process.env.CRM_USERS_MATCH_COLUMN) || 'EMPLOYEE_ID'
  try {
    const Mssql = await getMssql()
    const request = pool.request()
    codes.forEach((c, i) => { request.input(`c${i}`, Mssql.VarChar(100), c) })
    const inClause = codes.map((_, i) => `@c${i}`).join(', ')
    const query = `SELECT ${matchCol} AS code_key, ${emailCol} AS email_val FROM ${table} WHERE ${matchCol} IN (${inClause}) AND ${emailCol} IS NOT NULL AND LTRIM(RTRIM(${emailCol})) != ''`
    const result = await request.query(query)
    const rows = result.recordset || []
    for (const r of rows) {
      const code = r.code_key != null ? String(r.code_key).trim() : ''
      const emailRaw = r.email_val ?? r[emailCol]
      const email = emailRaw != null ? String(emailRaw).trim() : ''
      if (code && email) map.set(code.toLowerCase(), email)
    }
    return map
  } catch (err) {
    console.error('CRM getCrmEmailMapByEmployeeCodes error:', err.message)
    return map
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
