import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annualProrationMonths, proratedAnnualDays, decideAnnualAllocation } from '../src/utils/annualLeave.js'

test('annualProrationMonths: joining month excluded (N = 12 - month)', () => {
  assert.equal(annualProrationMonths('2025-08-15'), 4)  // August
  assert.equal(annualProrationMonths('2026-09-01'), 3)  // September
  assert.equal(annualProrationMonths('2025-11-20'), 1)  // November
  assert.equal(annualProrationMonths('2025-12-10'), 0)  // December
  assert.equal(annualProrationMonths('2025-01-05'), 11) // January
})

test('proratedAnnualDays: round(14/12 * N)', () => {
  assert.equal(proratedAnnualDays('2025-08-15'), 5) // 14/12*4 = 4.67 -> 5
  assert.equal(proratedAnnualDays('2026-09-01'), 4) // 14/12*3 = 3.5 -> 4
  assert.equal(proratedAnnualDays('2025-12-10'), 0) // 0
})

test('decideAnnualAllocation: first year (before anniversary) -> none', () => {
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: null, lastAllocatedYear: null, today: '2026-03-01' })
  assert.equal(r.action, 'none')
})

test('decideAnnualAllocation: at/after 1-year anniversary -> proration', () => {
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: null, lastAllocatedYear: null, today: '2026-08-20' })
  assert.equal(r.action, 'proration')
  assert.equal(r.proratedDays, 5)
  assert.equal(r.year, 2026)
})

test('decideAnnualAllocation: proration already granted, new year -> january_reset', () => {
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: '2026-08-20', lastAllocatedYear: 2026, today: '2027-01-02' })
  assert.equal(r.action, 'january_reset')
  assert.equal(r.year, 2027)
})

test('decideAnnualAllocation: idempotent — same year after reset -> none', () => {
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: '2026-08-20', lastAllocatedYear: 2027, today: '2027-03-01' })
  assert.equal(r.action, 'none')
})

test('decideAnnualAllocation: idempotent — proration granted same day re-run -> none (same year already allocated)', () => {
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: '2026-08-20', lastAllocatedYear: 2026, today: '2026-08-20' })
  assert.equal(r.action, 'none')
})

test('decideAnnualAllocation: long-tenured uninitialized employee is NOT prorated (anniversary years ago)', () => {
  // Joined 2020, tracking still null, run in 2026 → must NOT slash their annual.
  const r = decideAnnualAllocation({ joinDate: '2020-03-10', prorationGrantedAt: null, lastAllocatedYear: null, today: '2026-06-05' })
  assert.equal(r.action, 'none')
})

test('decideAnnualAllocation: missed first-year run (anniversary in a prior year) -> none, not prorated', () => {
  // Aug 2025 joiner, HR runs allocation only in 2027 (missed 2026). Anniversary year 2026 ≠ 2027.
  const r = decideAnnualAllocation({ joinDate: '2025-08-15', prorationGrantedAt: null, lastAllocatedYear: null, today: '2027-05-01' })
  assert.equal(r.action, 'none')
})
