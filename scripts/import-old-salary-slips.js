/**
 * Bulk import old salary slips from a JSON file into old_salary_slip.
 * Usage: node scripts/import-old-salary-slips.js <path-to.json>
 *
 * JSON format: array of rows, or { "slips": [ ... ] }
 * Each row must have: payMonth (e.g. "2024-01-01") or Pay_Month.
 * employeeId: optional if HR_Emp_ID is present and matches employees.employee_code in the portal.
 * Other fields can use SQL Server names (Payroll_ID, HR_Emp_ID, GrossSalary, etc.) or camelCase.
 *
 * Example: node scripts/import-old-salary-slips.js ./data/old-slips.json
 */

import dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { createOldSalarySlips } from '../src/repositories/salary.repository.js'

dotenv.config()

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/import-old-salary-slips.js <path-to.json>')
  process.exit(1)
}

let data
try {
  const raw = readFileSync(filePath, 'utf8')
  data = JSON.parse(raw)
} catch (err) {
  console.error('Failed to read or parse file:', err.message)
  process.exit(1)
}

const slips = Array.isArray(data) ? data : data.slips || []
if (slips.length === 0) {
  console.error('No slips found in file (expect array or { "slips": [...] })')
  process.exit(1)
}

console.log(`Importing ${slips.length} rows...`)

try {
  const created = await createOldSalarySlips(slips)
  console.log(`Done. Inserted ${created.length} rows.`)
  if (created.length < slips.length) {
    console.log(`Skipped ${slips.length - created.length} rows (missing employeeId/payMonth or HR_Emp_ID not found in employees.employee_code).`)
  }
} catch (err) {
  console.error('Import failed:', err.message)
  process.exit(1)
}

process.exit(0)
