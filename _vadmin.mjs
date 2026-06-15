import dotenv from 'dotenv'; dotenv.config()
const { closeConnection } = await import('./config/database.js')
const repo = await import('./src/repositories/requisition.repository.js')
const svc = await import('./src/services/requisition.service.js')
const cases = [[494,'IT Network Admin → FALSE'],[430,'IT Administrator → FALSE'],[2,'Admin dept Manager → TRUE'],[3,'Admin dept Supervisor → TRUE'],[117,'Admin Rider → TRUE'],[168,'Admin Officer → TRUE']]
for (const [id,label] of cases) console.log(`isAdminMember(${id}) = ${await repo.isAdminMember(id)}  -- ${label}`)
console.log('getPendingCount(494) now =', JSON.stringify(await svc.getPendingCount(494)))
await closeConnection()
