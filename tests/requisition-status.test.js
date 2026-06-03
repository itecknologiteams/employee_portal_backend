import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getRequisitionStatus } from '../src/utils/requisition.utils.js'

// When a category skips HOD (e.g. General Procurements), the requisition is routed
// directly to the Committee stage with req_hod_approval = 0. The status must reflect
// the actual current stage ('Pending Committee'), not fall through to 'Pending HOD'.
// A wrong status here disables the Committee approve button on the frontend.
test('committee stage with HOD skipped reports Pending Committee, not Pending HOD', () => {
  const row = {
    req_current_stage_key: 'committee',
    req_hod_approval: 0,
    req_committee_approval: 0,
    req_ceo_approval: 0,
    req_finance_approval: 0,
    req_is_rejected: 0
  }
  assert.equal(getRequisitionStatus(row), 'Pending Committee')
})

test('committee stage after HOD approval still reports Pending Committee', () => {
  const row = {
    req_current_stage_key: 'committee',
    req_hod_approval: 1,
    req_committee_approval: 0,
    req_is_rejected: 0
  }
  assert.equal(getRequisitionStatus(row), 'Pending Committee')
})

test('no stage key, no approvals still reports Pending HOD', () => {
  const row = { req_current_stage_key: null, req_hod_approval: 0, req_is_rejected: 0 }
  assert.equal(getRequisitionStatus(row), 'Pending HOD')
})
