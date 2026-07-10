import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeAnnualIncomeTax, monthlyIncomeTax, computeAnnualIncomeTaxFromSlabs } from '../src/utils/incomeTax.js'

test('income tax 2026-27: no tax up to 600,000', () => {
  assert.equal(computeAnnualIncomeTax(0), 0)
  assert.equal(computeAnnualIncomeTax(600000), 0)
})

test('income tax 2026-27: bracket boundaries match published base amounts', () => {
  assert.equal(computeAnnualIncomeTax(1200000), 6000)     // 1% of 600k
  assert.equal(computeAnnualIncomeTax(2200000), 116000)
  assert.equal(computeAnnualIncomeTax(3200000), 316000)
  assert.equal(computeAnnualIncomeTax(4100000), 541000)
  assert.equal(computeAnnualIncomeTax(5600000), 976000)
  assert.equal(computeAnnualIncomeTax(7000000), 1424000)
})

test('income tax 2026-27: within-bracket amounts', () => {
  assert.equal(computeAnnualIncomeTax(900000), 3000)        // 1% of 300k
  assert.equal(computeAnnualIncomeTax(1500000), 6000 + 33000)   // 6000 + 11% of 300k
  assert.equal(computeAnnualIncomeTax(8000000), 1424000 + 350000) // + 35% of 1,000,000
})

test('monthlyIncomeTax = annual / 12', () => {
  assert.equal(monthlyIncomeTax(1200000), 500)             // 6000 / 12
  assert.equal(monthlyIncomeTax(600000), 0)
})

test('computeAnnualIncomeTaxFromSlabs: DB slab rows', () => {
  const SLABS = [
    { min_amt: 0,       max_amt: 600000,  taxable_amt: 0,       tax_percent: 0 },
    { min_amt: 600000,  max_amt: 1200000, taxable_amt: 0,       tax_percent: 1 },
    { min_amt: 1200000, max_amt: 2200000, taxable_amt: 6000,    tax_percent: 11 },
    { min_amt: 7000000, max_amt: null,    taxable_amt: 1424000, tax_percent: 35 }
  ]
  assert.equal(computeAnnualIncomeTaxFromSlabs(600000, SLABS), 0)
  assert.equal(computeAnnualIncomeTaxFromSlabs(700000, SLABS), 1000)          // 1% of 100k
  assert.equal(computeAnnualIncomeTaxFromSlabs(1200000, SLABS), 6000)         // boundary → lower bracket
  assert.equal(computeAnnualIncomeTaxFromSlabs(1500000, SLABS), 6000 + 33000) // 6000 + 11% of 300k
  assert.equal(computeAnnualIncomeTaxFromSlabs(8000000, SLABS), 1424000 + 350000)
  assert.equal(computeAnnualIncomeTaxFromSlabs(1000000, []), null)            // no slabs → caller falls back
})
