import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideInitialLeaveStatus, CASUAL_SICK_TYPE_IDS } from '../src/services/leave.service.js'

// Leave type ids: 1=Casual, 2=Sick, 3=Annual, 4=Marriage, 5=Maternity, 6=Paternal, 7=Pilgrimage

test('HOD applying for Annual leave routes to CEO', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: 3 }), 'Pending CEO')
})

test('HOD applying for Marriage/Maternity/Paternal/Pilgrimage routes to CEO', () => {
  for (const id of [4, 5, 6, 7]) {
    assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: id }), 'Pending CEO')
  }
})

test('HOD applying for Casual or Sick stays with HR', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: 1 }), 'Pending HR')
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: 2 }), 'Pending HR')
})

test('normal employee leave goes to HOD (Pending)', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: false, leaveTypeId: 3 }), 'Pending')
})

test('senior executive (CEO/COO/Director) leave goes to HR regardless of type', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: true, isHod: false, leaveTypeId: 3 }), 'Pending HR')
})

test('senior executive who is also an HOD still goes to HR (cannot self-approve)', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: true, isHod: true, leaveTypeId: 3 }), 'Pending HR')
})

test('leave type id is normalized (string ids work)', () => {
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: '1' }), 'Pending HR')
  assert.equal(decideInitialLeaveStatus({ isSenior: false, isHod: true, leaveTypeId: '3' }), 'Pending CEO')
})

test('Casual/Sick type id set is exactly {1,2}', () => {
  assert.deepEqual([...CASUAL_SICK_TYPE_IDS].sort(), [1, 2])
})
