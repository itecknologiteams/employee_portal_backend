import { executeQuery } from '../../config/database.js'
import { getCrmEmailMapByEmployeeCodes } from '../../config/crmDatabase.js'

async function getPortalEmailMapByEmployeeCodes(codes) {
  const map = new Map()
  if (!codes || codes.length === 0) return map
  const unique = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))]
  if (unique.length === 0) return map
  const placeholders = unique.map((_, i) => `$${i + 1}`).join(', ')
  try {
    const rows = await executeQuery(
      `SELECT e.employee_code, TRIM(e.email) AS email FROM employees e
       WHERE e.employee_code IN (${placeholders}) AND COALESCE(e.is_active, true) = true
         AND e.email IS NOT NULL AND TRIM(e.email) != ''`,
      unique
    )
    for (const r of rows || []) {
      if (r.employee_code && r.email) {
        map.set(String(r.employee_code).trim().toLowerCase(), String(r.email).trim())
      }
    }
  } catch (e) {
    console.warn('getPortalEmailMapByEmployeeCodes:', e.message)
  }
  return map
}

/**
 * For each employee_code: use CRM USERS official email (EMAIL) if present; else portal employees.email.
 * Dedupes by email (case-insensitive). Does not send to both personal + official for the same person.
 */
export async function resolveEmailsPreferCrmForCodes(employeeCodes) {
  const unique = [...new Set((employeeCodes || []).map((c) => String(c).trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const crmMap = await getCrmEmailMapByEmployeeCodes(unique)
  const portalMap = await getPortalEmailMapByEmployeeCodes(unique)
  const seen = new Set()
  const out = []
  let portalFallbackCount = 0
  for (const code of unique) {
    const key = String(code).trim().toLowerCase()
    const crmEmail = crmMap.get(key)
    const portalEmail = portalMap.get(key)
    const chosen = (crmEmail && crmEmail.trim()) || (portalEmail && portalEmail.trim())
    if (!chosen) continue
    if (!crmEmail && portalEmail) portalFallbackCount++
    const lk = chosen.toLowerCase()
    if (seen.has(lk)) continue
    seen.add(lk)
    out.push(chosen)
  }
  if (portalFallbackCount > 0) {
    console.log(
      `[Requisition email] CRM-first: ${portalFallbackCount} recipient(s) using portal employees.email (no CRM email for this code)`
    )
  }
  return out
}
