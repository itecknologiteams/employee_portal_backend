import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateProratedAnnualLeave,
  hasCompletedOneYear,
  DEFAULT_ANNUAL
} from '../src/repositories/leave.repository.js'

/** A join date `n` months before today (YYYY-MM-DD). */
function monthsAgo(n) {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

test('hasCompletedOneYear: false before the 1-year anniversary', () => {
  assert.equal(hasCompletedOneYear(monthsAgo(3)), false)
  assert.equal(hasCompletedOneYear(monthsAgo(11)), false)
})

test('hasCompletedOneYear: true on/after the 1-year anniversary', () => {
  assert.equal(hasCompletedOneYear(monthsAgo(15)), true)
  assert.equal(hasCompletedOneYear(monthsAgo(30)), true)
})

test('hasCompletedOneYear: no join date -> false', () => {
  assert.equal(hasCompletedOneYear(null), false)
})

test('calculateProratedAnnualLeave: employee with < 1 year of service gets 0', () => {
  assert.equal(calculateProratedAnnualLeave(monthsAgo(1)), 0)
  assert.equal(calculateProratedAnnualLeave(monthsAgo(3)), 0)
  assert.equal(calculateProratedAnnualLeave(monthsAgo(11)), 0)
})

test('calculateProratedAnnualLeave: employee who completed 1 year gets full annual', () => {
  assert.equal(calculateProratedAnnualLeave(monthsAgo(13)), DEFAULT_ANNUAL)
  assert.equal(calculateProratedAnnualLeave(monthsAgo(30)), DEFAULT_ANNUAL)
})

test('calculateProratedAnnualLeave: no join date -> default annual (cannot determine tenure)', () => {
  assert.equal(calculateProratedAnnualLeave(null), DEFAULT_ANNUAL)
})
