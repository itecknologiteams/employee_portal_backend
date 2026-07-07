import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashToken, computeStatus, maskEmail, pageToPath, validateCreateInput,
  isDelegateActionRequest, buildSessionUser, SELECTABLE_PAGE_KEYS, MIN_EXPIRY_DAYS
} from '../src/utils/delegateAccess.js'

test('hashToken is deterministic 64-hex sha256', () => {
  const h = hashToken('abc')
  assert.match(h, /^[a-f0-9]{64}$/)
  assert.equal(h, hashToken('abc'))
  assert.notEqual(h, hashToken('abd'))
})

test('computeStatus: revoked > expired > active', () => {
  assert.equal(computeStatus({ revoked_at: 'x', expires_at: '2999-01-01' }), 'revoked')
  assert.equal(computeStatus({ revoked_at: null, expires_at: '2000-01-01' }), 'expired')
  assert.equal(computeStatus({ revoked_at: null, expires_at: '2999-01-01' }), 'active')
})

test('maskEmail keeps first 3 local chars', () => {
  assert.equal(maskEmail('abcdef@x.com'), 'abc***@x.com')
  assert.equal(maskEmail('ab@x.com'), 'ab@x.com')
})

test('SELECTABLE_PAGE_KEYS excludes superadmin surfaces', () => {
  for (const k of ['role_permissions', 'manage_delegate_access', 'administration']) {
    assert.equal(SELECTABLE_PAGE_KEYS.includes(k), false)
  }
  assert.equal(SELECTABLE_PAGE_KEYS.includes('requisition_pending'), true)
})

test('validateCreateInput rejects expiry < 10', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 5, landingPage: '/requisition/pending' })
  assert.equal(r.ok, false)
  assert.match(r.error, new RegExp(String(MIN_EXPIRY_DAYS)))
})

test('validateCreateInput rejects empty/invalid pages', () => {
  assert.equal(validateCreateInput({ employeeId: 3, pages: [], expiryDays: 10, landingPage: '/x' }).ok, false)
  assert.equal(validateCreateInput({ employeeId: 3, pages: ['role_permissions'], expiryDays: 10, landingPage: '/x' }).ok, false)
})

test('validateCreateInput rejects landing not among selected pages', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 10, landingPage: '/payroll' })
  assert.equal(r.ok, false)
})

test('validateCreateInput accepts valid input and defaults landing', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 10, landingPage: null })
  assert.equal(r.ok, true)
  assert.deepEqual(r.cleanPages, ['requisition_pending'])
  assert.equal(r.landing, '/requisition/pending')
})

test('isDelegateActionRequest true only for mutating requisition/leave paths', () => {
  assert.equal(isDelegateActionRequest('POST', '/api/requisition/approve/hod'), true)
  assert.equal(isDelegateActionRequest('PUT', '/api/leave/request/5/status'), true)
  assert.equal(isDelegateActionRequest('GET', '/api/requisition/pending/hod/E1'), false)
  assert.equal(isDelegateActionRequest('POST', '/api/salary/fpin/verify'), false)
})

test('buildSessionUser produces scoped DelegateAccess payload', () => {
  const u = buildSessionUser({
    employee_id: 3, employee_code: 'E3', first_name: 'A', last_name: 'B', email: 'a@b.c',
    pages: ['requisition_pending'], id: 9, expires_at: '2999-01-01', landing_page: '/requisition/pending'
  })
  assert.equal(u.userType, 'DelegateAccess')
  assert.equal(u.employeeId, 3)
  assert.deepEqual(u.permissions, ['requisition_pending'])
  assert.equal(u.delegate.linkId, 9)
  assert.equal(u.delegate.landingPage, '/requisition/pending')
})
