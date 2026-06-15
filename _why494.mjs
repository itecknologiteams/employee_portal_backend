import dotenv from 'dotenv'; dotenv.config()
const { executeQuery, closeConnection } = await import('./config/database.js')
const svc = await import('./src/services/requisition.service.js')
const repo = await import('./src/repositories/requisition.repository.js')

const rows = await executeQuery(`
  SELECT e.employee_id, e.employee_code, e.first_name, e.department_id, d.department_name,
         et.emp_type_name AS employee_type, desg.desg_name AS designation
  FROM employees e
  LEFT JOIN departments d ON d.department_id = e.department_id
  LEFT JOIN employee_type et ON et.emp_type_id = e.employee_type_id
  LEFT JOIN designation desg ON desg.desg_id = e.designation_id
  WHERE e.employee_id = 494`)
console.log('494 profile:', rows[0])

console.log('isAdminMember(494):', await repo.isAdminMember(494))
const padmin = await svc.getPendingAdmin(494)
console.log('getPendingAdmin(494):', Array.isArray(padmin) ? `array len ${padmin.length}` : padmin)
const cnt = await svc.getPendingCount(494)
console.log('getPendingCount(494):', JSON.stringify(cnt))
await closeConnection()
