import { getCrmEmailMapByEmployeeCodes } from '../../config/crmDatabase.js'

/**
 * For each employee_code: use ONLY CRM USERS official email (EMAIL).
 * Portal emails are NOT used - only CRM emails from ERP_Tracking.dbo.USERS table.
 * Dedupes by email (case-insensitive).
 */
export async function resolveEmailsPreferCrmForCodes(employeeCodes) {
  const unique = [...new Set((employeeCodes || []).map((c) => String(c).trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const crmMap = await getCrmEmailMapByEmployeeCodes(unique)
  const seen = new Set()
  const out = []
  let skippedCount = 0
  for (const code of unique) {
    const key = String(code).trim().toLowerCase()
    const crmEmail = crmMap.get(key)
    if (!crmEmail || !crmEmail.trim()) {
      skippedCount++
      console.log(`[Requisition email] Skipped ${code}: No CRM email found in ERP_Tracking.dbo.USERS`)
      continue
    }
    const lk = crmEmail.toLowerCase()
    if (seen.has(lk)) continue
    seen.add(lk)
    out.push(crmEmail.trim())
  }
  if (skippedCount > 0) {
    console.log(
      `[Requisition email] CRM-only: ${skippedCount} recipient(s) skipped (no CRM email in USERS table)`
    )
  }
  return out
}

/**
 * Per employee_code: CRM email only (portal email field kept for compatibility but always null).
 * Used by admin diagnostics UI to see why someone might not receive mail.
 */
export async function resolveEmailDetailsForCodes(employeeCodes) {
  const unique = [...new Set((employeeCodes || []).map((c) => String(c).trim()).filter(Boolean))]
  if (unique.length === 0) return []
  const crmMap = await getCrmEmailMapByEmployeeCodes(unique)
  return unique.map((code) => {
    const key = String(code).trim().toLowerCase()
    const crmRaw = crmMap.get(key)
    const crmEmail = crmRaw && String(crmRaw).trim() ? String(crmRaw).trim() : null
    const chosenEmail = crmEmail
    const source = crmEmail ? 'crm' : 'none'
    return { employeeCode: code, crmEmail, portalEmail: null, chosenEmail, source }
  })
}
