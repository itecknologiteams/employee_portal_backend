import { executeQuery } from '../../config/database.js'

const statsQueries = {
  totalEmployees: `SELECT COUNT(*) as count FROM employees WHERE is_active = true`,
  activeLeaves: `SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Approved' AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE`,
  monthlySalary: `SELECT COALESCE(SUM(net_salary), 0) as total FROM salary_slips WHERE DATE_TRUNC('month', month_year) = DATE_TRUNC('month', CURRENT_DATE)`,
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
  SELECT 
    'Leave Request' as type,
    CONCAT(e.first_name, ' ', e.last_name, ' submitted a leave request') as description,
    lr.created_at as time
  FROM leave_requests lr
  INNER JOIN employees e ON lr.employee_id = e.employee_id
  ORDER BY lr.created_at DESC
  LIMIT 10
  
  UNION ALL
  
  SELECT
    'Salary Slip' as type,
    CONCAT('Salary slip generated for ', TO_CHAR(ss.month_year, 'Month YYYY')) as description,
    ss.created_at as time
  FROM salary_slips ss
  ORDER BY ss.created_at DESC
  LIMIT 10
  
  UNION ALL
  
  SELECT
    'Feedback' as type,
    f.subject as description,
    f.created_at as time
  FROM feedback f
  ORDER BY f.created_at DESC
  LIMIT 10
  
  ORDER BY time DESC
  LIMIT 10
`

export async function getActivities() {
  return executeQuery(activitiesQuery).catch(() => [])
}
