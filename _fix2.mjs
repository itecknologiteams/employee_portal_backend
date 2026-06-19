import dotenv from 'dotenv'; dotenv.config()
import fs from 'fs'
const { executeQuery, closeConnection } = await import('./config/database.js')
const out = []
// Revert 290/298 (IT HOD-created → should skip IT, belong at committee)
const r = await executeQuery(`
  UPDATE requisition SET req_current_stage_key='committee'
  WHERE req_id IN (290,298) AND req_current_stage_key='it'
    AND COALESCE(req_committee_approval,0)=0 AND COALESCE(req_is_rejected,0)=0
  RETURNING req_id, req_current_stage_key`)
out.push('Reverted to committee: ' + JSON.stringify(r))
// Verify routing helper via the service
const svc = await import('./src/services/requisition.service.js')
// nextStageAfterHod is not exported; emulate by checking isItDepartmentMember + getNextStageKey
const repo = await import('./src/repositories/requisition.repository.js')
const itNext = await repo.getNextStageKey('IT Equipments','it')   // after IT = committee
const hodNext = await repo.getNextStageKey('IT Equipments','hod') // after HOD = it
out.push(`getNextStageKey(IT Equipments, hod)=${hodNext}  (non-IT creator → this)`)
out.push(`getNextStageKey(IT Equipments, it)=${itNext}   (IT creator → this, skip IT)`)
fs.writeFileSync('_fix2.out', out.join('\n')+'\n')
await closeConnection()
