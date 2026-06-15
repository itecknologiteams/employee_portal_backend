import dotenv from 'dotenv'; dotenv.config()
const svc = await import('./src/services/requisition.service.js')
const { closeConnection } = await import('./config/database.js')

// IT member (emp 430), department scope
const dept = await svc.getHistory(430, { scope: 'department', page: 1, limit: 100 })
if (dept.error) { console.log('IT dept scope -> ERROR', dept) }
else {
  const creators = [...new Set(dept.data.map(r => `${r.employeeId}:${r.employeeName}`))]
  console.log('IT 430 department: total=', dept.pagination.total, 'canViewDepartment=', dept.canViewDepartment, 'scope=', dept.scope)
  console.log('  distinct creators:', creators)
  console.log('  sample row own-flags:', dept.data.slice(0,5).map(r => ({ id:r.id, by:r.employeeName, isOwn:r.isOwn, canRevise:r.canRevise })))
}

// IT member, my scope -> canViewDepartment should be true
const mine = await svc.getHistory(430, { scope: 'my', page: 1, limit: 5 })
console.log('IT 430 my: canViewDepartment=', mine.canViewDepartment, 'total=', mine.pagination.total)

// Non-IT member (emp 178 was Stationary creator), my scope -> canViewDepartment false
const nonIt = await svc.getHistory(178, { scope: 'my', page: 1, limit: 5 })
console.log('non-IT 178 my: canViewDepartment=', nonIt.canViewDepartment)

// Non-IT member, department scope -> 403
const nonItDept = await svc.getHistory(178, { scope: 'department', page: 1, limit: 5 })
console.log('non-IT 178 department:', nonItDept.error ? `${nonItDept.status} ${nonItDept.error}` : 'UNEXPECTED OK')

await closeConnection()
