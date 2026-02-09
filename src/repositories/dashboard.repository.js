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
  pendingRequests: `SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Pending'`
}

export async function getStats() {
  const [totalEmployees, activeLeaves, monthlySalary, pendingRequests] = await Promise.all([
    executeQuery(statsQueries.totalEmployees).catch(() => [{ count: 0 }]),
    executeQuery(statsQueries.activeLeaves).catch(() => [{ count: 0 }]),
    executeQuery(statsQueries.monthlySalary).catch(() => [{ total: 0 }]),
    executeQuery(statsQueries.pendingRequests).catch(() => [{ count: 0 }])
  ])
  return { totalEmployees, activeLeaves, monthlySalary, pendingRequests }
}

const activitiesQuery = `
  (SELECT 'Leave Request' AS type,
          CONCAT(e.first_name, ' ', e.last_name, ' submitted a leave request') AS description,
          lr.created_at AS time
   FROM leave_requests lr
   INNER JOIN employees e ON lr.employee_id = e.employee_id
   ORDER BY lr.created_at DESC LIMIT 10)

  UNION ALL

  (SELECT 'Salary Slip' AS type,
          CONCAT('Salary slip generated for ', TO_CHAR(p.pay_month, 'Month YYYY')) AS description,
          p.pay_month::timestamp AS time
   FROM (SELECT id, pay_month FROM payroll
         WHERE EXISTS (SELECT 1 FROM salary_slip s WHERE s.payroll_id = payroll.id)
         ORDER BY pay_month DESC LIMIT 10) p)

  UNION ALL

  (SELECT 'Feedback' AS type, f.subject AS description, f.created_at AS time
   FROM feedback f ORDER BY f.created_at DESC LIMIT 10)

  ORDER BY time DESC LIMIT 10
`

export async function getActivities() {
  return executeQuery(activitiesQuery).catch(() => [])
}
