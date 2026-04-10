/**
 * Migration script: Sync employee dates from ATS_HRMS (SQL Server) to PostgreSQL.
 * Fetches: Date of Birth, CNIC Issue Date, CNIC Expiry Date, Joining Date
 *
 * Run: node database/migrations/sync_employee_dates_from_hrms.js
 *
 * SQL Server: 192.168.20.166, ATS_HRMS, HR_Employees
 * PostgreSQL: Uses existing DB config from config/database.js
 */
import { getHrmsPool, closeHrmsPool } from '../../config/hrmsDatabase.js'
import { executeQuery } from '../../config/database.js'

async function formatDate(dateVal) {
  if (!dateVal) return null
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return null
  return d.toISOString().split('T')[0] // yyyy-MM-dd
}

async function syncEmployeeDates() {
  console.log('Starting employee dates sync from ATS_HRMS...\n')

  let hrmsPool
  try {
    // 1. Connect to SQL Server (ATS_HRMS)
    hrmsPool = await getHrmsPool()
    console.log('✅ Connected to HRMS SQL Server (192.168.20.166)\n')

    // 2. Fetch all employee dates from HR_Employees
    const result = await hrmsPool.query(`
      SELECT 
        HR_Emp_ID,
        Emp_Name,
        DateOfBirth,
        CNIC_Issue_Date,
        CNIC_Exp_Date,
        Joining_Date
      FROM HR_Employees
      WHERE HR_Emp_ID IS NOT NULL
        AND LTRIM(RTRIM(CAST(HR_Emp_ID AS VARCHAR(50)))) != ''
    `)

    const hrEmployees = result.recordset || []
    console.log(`📊 Found ${hrEmployees.length} employees in HR_Employees table\n`)

    if (hrEmployees.length === 0) {
      console.log('⚠️ No employees found in HR_Employees table')
      return
    }

    // 3. Get all portal employees with their codes
    const portalEmployees = await executeQuery(`
      SELECT employee_id, employee_code, first_name, last_name
      FROM employees
      WHERE employee_code IS NOT NULL
    `)

    console.log(`📊 Found ${portalEmployees.length} employees in portal\n`)

    // Create map: employee_code -> employee_id
    const portalEmpMap = new Map()
    for (const emp of portalEmployees) {
      if (emp.employee_code) {
        portalEmpMap.set(String(emp.employee_code).trim(), emp.employee_id)
      }
    }

    // 4. Sync dates
    let updated = 0
    let skipped = 0
    let errors = 0
    const updates = []

    for (const hrEmp of hrEmployees) {
      const empCode = String(hrEmp.HR_Emp_ID || '').trim()
      if (!empCode) continue

      const portalEmpId = portalEmpMap.get(empCode)
      if (!portalEmpId) {
        console.log(`⚠️ Skipped (not in portal): ${empCode} - ${hrEmp.Emp_Name}`)
        skipped++
        continue
      }

      const dob = await formatDate(hrEmp.DOB)
      const cnicIssue = await formatDate(hrEmp.CNIC_Issue_Date)
      const cnicExpiry = await formatDate(hrEmp.CNIC_Expiry_Date)
      const joiningDate = await formatDate(hrEmp.Joining_Date)

      // Check if any date needs updating
      const currentData = await executeQuery(`
        SELECT date_of_birth, cnic_issue_date, cnic_expiry_date, join_date
        FROM employees WHERE employee_id = $1
      `, [portalEmpId])

      const current = currentData[0] || {}
      const currentDob = current.date_of_birth?.toISOString?.()?.split('T')[0] || current.date_of_birth
      const currentCnicIssue = current.cnic_issue_date?.toISOString?.()?.split('T')[0] || current.cnic_issue_date
      const currentCnicExpiry = current.cnic_expiry_date?.toISOString?.()?.split('T')[0] || current.cnic_expiry_date
      const currentJoining = current.join_date?.toISOString?.()?.split('T')[0] || current.join_date

      const needsUpdate =
        (dob && dob !== currentDob) ||
        (cnicIssue && cnicIssue !== currentCnicIssue) ||
        (cnicExpiry && cnicExpiry !== currentCnicExpiry) ||
        (joiningDate && joiningDate !== currentJoining)

      if (needsUpdate) {
        try {
          await executeQuery(`
            UPDATE employees
            SET 
              date_of_birth = COALESCE($1, date_of_birth),
              cnic_issue_date = COALESCE($2, cnic_issue_date),
              cnic_expiry_date = COALESCE($3, cnic_expiry_date),
              join_date = COALESCE($4, join_date)
            WHERE employee_id = $5
          `, [dob, cnicIssue, cnicExpiry, joiningDate, portalEmpId])

          updates.push({
            code: empCode,
            name: hrEmp.Emp_Name,
            dob: { old: currentDob, new: dob },
            cnicIssue: { old: currentCnicIssue, new: cnicIssue },
            cnicExpiry: { old: currentCnicExpiry, new: cnicExpiry },
            joining: { old: currentJoining, new: joiningDate }
          })

          console.log(`✅ Updated: ${empCode} - ${hrEmp.Emp_Name}`)
          updated++
        } catch (err) {
          console.error(`❌ Error updating ${empCode}: ${err.message}`)
          errors++
        }
      } else {
        skipped++
      }
    }

    console.log(`\n📈 Summary:`)
    console.log(`   Updated: ${updated}`)
    console.log(`   Skipped (no changes or not found): ${skipped}`)
    console.log(`   Errors: ${errors}`)

    // Save detailed log
    if (updates.length > 0) {
      console.log(`\n📝 Detailed changes logged (${updates.length} employees updated)`)
    }

  } catch (err) {
    console.error('\n❌ Sync failed:', err.message)
    console.error(err.stack)
    process.exit(1)
  } finally {
    await closeHrmsPool()
    console.log('\n🔌 Connections closed')
  }
}

// Run the sync
syncEmployeeDates()
