import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateSuperAdmin } from '../src/middleware/requireSuperAdmin.js'

test('evaluateSuperAdmin: no session → 401', () => {
  assert.deepEqual(evaluateSuperAdmin(null, 'SuperAdmin'), { ok: false, status: 401 })
})

test('evaluateSuperAdmin: wrong role → 403', () => {
  assert.deepEqual(evaluateSuperAdmin(5, 'Admin'), { ok: false, status: 403 })
  assert.deepEqual(evaluateSuperAdmin(5, null), { ok: false, status: 403 })
})

test('evaluateSuperAdmin: SuperAdmin → ok', () => {
  assert.deepEqual(evaluateSuperAdmin(5, 'SuperAdmin'), { ok: true, status: 200 })
})
