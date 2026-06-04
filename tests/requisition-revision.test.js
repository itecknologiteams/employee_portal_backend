import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRevisionReference, canReviseRequisition } from '../src/utils/requisition.utils.js'

test('buildRevisionReference appends -REV-<date>-<padded number> to the original', () => {
  assert.equal(
    buildRevisionReference('REQ-20260518-00245', '20260604', 1),
    'REQ-20260518-00245-REV-20260604-001'
  )
  assert.equal(
    buildRevisionReference('REQ-20260518-00245', '20260604', 12),
    'REQ-20260518-00245-REV-20260604-012'
  )
})

test('canReviseRequisition: all conditions satisfied → true', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: false, requiredByDate: '2026-06-01', procurementInvolved: true, today: '2026-06-04'
  }), true)
})

test('canReviseRequisition: required-by date not passed → false', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: false, requiredByDate: '2026-06-10', procurementInvolved: true, today: '2026-06-04'
  }), false)
})

test('canReviseRequisition: rejected does NOT block (still revisable when other conditions met)', () => {
  assert.equal(canReviseRequisition({
    isRejected: true, isClosed: false, requiredByDate: '2026-06-01', procurementInvolved: true, today: '2026-06-04'
  }), true)
})

test('canReviseRequisition: closed → false', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: true, requiredByDate: '2026-06-01', procurementInvolved: true, today: '2026-06-04'
  }), false)
})

test('canReviseRequisition: procurement not involved → false', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: false, requiredByDate: '2026-06-01', procurementInvolved: false, today: '2026-06-04'
  }), false)
})

test('canReviseRequisition: no required-by date → false (cannot be past due)', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: false, requiredByDate: null, procurementInvolved: true, today: '2026-06-04'
  }), false)
})

test('canReviseRequisition: required-by equal to today is not yet passed → false', () => {
  assert.equal(canReviseRequisition({
    isRejected: false, isClosed: false, requiredByDate: '2026-06-04', procurementInvolved: true, today: '2026-06-04'
  }), false)
})
