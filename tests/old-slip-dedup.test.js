import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oldSlipDedupeKey, partitionByExistingKeys } from '../src/repositories/salary.repository.js'

test('oldSlipDedupeKey normalizes date to YYYY-MM-DD', () => {
  assert.equal(oldSlipDedupeKey(7, '2024-01-01'), '7|2024-01-01')
  assert.equal(oldSlipDedupeKey(7, new Date('2024-01-01T00:00:00Z')), '7|2024-01-01')
  assert.equal(oldSlipDedupeKey(7, '2024-01-01T00:00:00.000Z'), '7|2024-01-01')
})

test('oldSlipDedupeKey is TZ-independent for a local-midnight Date (node-postgres `date` deserialization)', () => {
  // node-postgres deserializes a `date` column to a LOCAL-midnight JS Date. Constructing from
  // components (not a UTC ISO string) simulates that, regardless of the host TZ running the test.
  assert.equal(oldSlipDedupeKey(7, new Date(2024, 0, 1)), '7|2024-01-01')
})

test('partitionByExistingKeys drops existing and intra-batch dupes', () => {
  const rows = [
    { employee_id: 7, pay_month: '2024-01-01' }, // exists → duplicate
    { employee_id: 7, pay_month: '2024-02-01' }, // new
    { employee_id: 7, pay_month: '2024-02-01' }  // intra-batch repeat → duplicate
  ]
  const existing = new Set([oldSlipDedupeKey(7, '2024-01-01')])
  const { toInsert, duplicates } = partitionByExistingKeys(rows, existing)
  assert.equal(toInsert.length, 1)
  assert.equal(toInsert[0].pay_month, '2024-02-01')
  assert.equal(duplicates, 2)
})
