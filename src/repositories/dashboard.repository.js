import { executeQuery } from '../../config/database.js'

const statsQueries = {
  totalEmployees: `SELECT COUNT(*) as count FROM employees WHERE is_active = true`,
  activeLeaves: `SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`,
  monthlySalary: `
    SELECT COALESCE(SUM(s.tot_net_salary), 0) AS total
    FROM salary_slip s
    JOIN payroll p ON p.id = s.payroll_id
    WHERE DATE_TRUNC('month', p.pay_month) = DATE_TRUNC('month', CURRENT_DATE)
  `,
  pendingLeaveRequests: `SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Pending'`
}

// Helper to get employee's department
async function getEmployeeDepartment(employeeId) {
  try {
    const rows = await executeQuery(
      'SELECT department_id FROM employees WHERE employee_id = $1',
      [employeeId]
    )
    return rows[0]?.department_id || null
  } catch (err) {
    return null
  }
}

// Pending requisitions count for HOD (from their department)
export async function getHodPendingCount(employeeId) {
  try {
    const departmentId = await getEmployeeDepartment(employeeId)
    if (!departmentId) return 0

    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      JOIN employees e ON r.req_emp_id = e.employee_id
      LEFT JOIN departments d ON e.department_id = d.department_id
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND (
          -- HOD approval pending for this department
          (COALESCE(r.req_hod_approval, 0) = 0 AND (e.department_id = $1 OR LOWER(TRIM(COALESCE(d.department_name, ''))) = ''))
          OR
          -- HOD acknowledgment pending (execution complete)
          (COALESCE(r.req_purchase_completed, 0) = 1 AND COALESCE(r.req_hod_acknowledged, 0) = 0 AND e.department_id = $1)
        )
    `, [departmentId])

    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting HOD pending count:', err)
    return 0
  }
}

// Pending HR requisitions count
export async function getHrPendingCount() {
  try {
    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_hod_approval, 0) = 1
        AND COALESCE(r.req_hr_approval, 0) = 0
    `)
    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting HR pending count:', err)
    return 0
  }
}

// Pending Finance requisitions count
export async function getFinancePendingCount() {
  try {
    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_finance_approval, 0) = 0
        AND (r.req_handed_to_finance = 1 OR r.req_current_stage_key = 'finance')
    `)
    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting Finance pending count:', err)
    return 0
  }
}

// Pending Committee requisitions count
export async function getCommitteePendingCount() {
  try {
    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_hod_approval, 0) = 1
        AND COALESCE(r.req_committee_approval, 0) = 0
    `)
    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting Committee pending count:', err)
    return 0
  }
}

// Pending CEO requisitions count
export async function getCeoPendingCount() {
  try {
    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_hod_approval, 0) = 1
        AND COALESCE(r.req_committee_approval, 0) = 1
        AND COALESCE(r.req_ceo_approval, 0) = 0
    `)
    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting CEO pending count:', err)
    return 0
  }
}

// Pending Procurement requisitions count
export async function getProcurementPendingCount() {
  try {
    const result = await executeQuery(`
      SELECT COUNT(*) as count FROM requisition r
      WHERE COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.req_hod_approval, 0) = 1
        AND COALESCE(r.req_committee_approval, 0) = 1
        AND COALESCE(r.req_ceo_approval, 0) = 1
        AND COALESCE(r.req_procurement_ack, 0) = 0
    `)
    return parseInt(result[0]?.count || 0, 10)
  } catch (err) {
    console.error('Error getting Procurement pending count:', err)
    return 0
  }
}

// Get basic stats without pending requisitions
export async function getBasicStats() {
  const [totalEmployees, activeLeaves, monthlySalary, pendingLeaveRequests] = await Promise.all([
    executeQuery(statsQueries.totalEmployees).catch(() => [{ count: 0 }]),
    executeQuery(statsQueries.activeLeaves).catch(() => [{ count: 0 }]),
    executeQuery(statsQueries.monthlySalary).catch(() => [{ total: 0 }]),
    executeQuery(statsQueries.pendingLeaveRequests).catch(() => [{ count: 0 }])
  ])
  return { totalEmployees, activeLeaves, monthlySalary, pendingLeaveRequests }
}

export async function getActivities(employeeId = null) {
  let query

  if (employeeId) {
    // Regular employee — show only their own activities
    query = `
      (SELECT 'Leave Request' AS type,
              CONCAT('Leave request submitted (', lr.leave_type, ')') AS description,
              lr.created_at AS time
       FROM leave_requests lr
       WHERE lr.employee_id = $1
       ORDER BY lr.created_at DESC LIMIT 5)

      UNION ALL

      (SELECT 'Salary Slip' AS type,
              CONCAT('Salary slip for ', TO_CHAR(oss.pay_month, 'Month YYYY')) AS description,
              oss.pay_month::timestamp AS time
       FROM old_salary_slip oss
       WHERE oss.employee_id = $1
       ORDER BY oss.pay_month DESC LIMIT 3)

      UNION ALL

      (SELECT 'Salary Slip' AS type,
              CONCAT('Salary slip for ', TO_CHAR(pp.end_date, 'Month YYYY')) AS description,
              pp.end_date::timestamp AS time
       FROM salary_slips ss
       JOIN payroll_period pp ON pp.id = ss.payroll_period_id
       WHERE ss.employee_id = $1
       ORDER BY pp.end_date DESC LIMIT 3)

      UNION ALL

      (SELECT 'Feedback' AS type,
              COALESCE(f.subject, 'Feedback submitted') AS description,
              f.created_at AS time
       FROM feedback f
       WHERE f.employee_id = $1
       ORDER BY f.created_at DESC LIMIT 5)

      UNION ALL

      (SELECT 'Requisition' AS type,
              CONCAT('Requisition ', r.req_reference_no, ' - ', COALESCE(r.req_material, r.req_category, 'submitted')) AS description,
              r.req_created_at AS time
       FROM requisition r
       WHERE r.req_emp_id = $1
       ORDER BY r.req_created_at DESC LIMIT 5)

      ORDER BY time DESC LIMIT 10
    `
    return executeQuery(query, [employeeId]).catch(() => [])
  }

  // Approver — show all recent activities across the org
  query = `
    (SELECT 'Leave Request' AS type,
            CONCAT(e.first_name, ' ', e.last_name, ' submitted a leave request') AS description,
            lr.created_at AS time
     FROM leave_requests lr
     INNER JOIN employees e ON lr.employee_id = e.employee_id
     ORDER BY lr.created_at DESC LIMIT 5)

    UNION ALL

    (SELECT 'Requisition' AS type,
            CONCAT(e.first_name, ' ', e.last_name, ' raised requisition ', r.req_reference_no) AS description,
            r.req_created_at AS time
     FROM requisition r
     INNER JOIN employees e ON r.req_emp_id = e.employee_id
     ORDER BY r.req_created_at DESC LIMIT 5)

    UNION ALL

    (SELECT 'Salary Slip' AS type,
            CONCAT('Salary slips generated for ', TO_CHAR(pp.end_date, 'Month YYYY')) AS description,
            pp.end_date::timestamp AS time
     FROM payroll_period pp
     WHERE EXISTS (SELECT 1 FROM salary_slips ss WHERE ss.payroll_period_id = pp.id)
     ORDER BY pp.end_date DESC LIMIT 3)

    UNION ALL

    (SELECT 'Feedback' AS type,
            COALESCE(f.subject, 'Feedback submitted') AS description,
            f.created_at AS time
     FROM feedback f ORDER BY f.created_at DESC LIMIT 5)

    ORDER BY time DESC LIMIT 10
  `
  return executeQuery(query).catch(() => [])
}
