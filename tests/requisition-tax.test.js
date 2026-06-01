import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  REQUISITION_SALES_TAX_RATE,
  isItEquipmentCategory,
  computeItemTaxAmountPkr,
  computeItGrandTotalWithTaxPkr
} from '../src/utils/requisition.utils.js'

test('tax rate is 18%', () => {
  assert.equal(REQUISITION_SALES_TAX_RATE, 0.18)
})

test('isItEquipmentCategory matches case/space-insensitively', () => {
  assert.equal(isItEquipmentCategory('IT Equipments'), true)
  assert.equal(isItEquipmentCategory('  it equipments '), true)
  assert.equal(isItEquipmentCategory('Stationary'), false)
  assert.equal(isItEquipmentCategory(null), false)
  assert.equal(isItEquipmentCategory(''), false)
})

test('computeItemTaxAmountPkr: 18% of unit price x qty, rounded', () => {
  // 1000 * 2 * 0.18 = 360
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }), 360)
})

test('computeItemTaxAmountPkr: HOD revised cost overrides est_cost', () => {
  // hod cost 500 used instead of est 1000 -> 500 * 2 * 0.18 = 180
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', hod_item_est_cost: '500', item_qty: 2 }), 180)
})

test('computeItemTaxAmountPkr: committee_approved_qty overrides item_qty', () => {
  // qty 3 used instead of 2 -> 1000 * 3 * 0.18 = 540
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2, committee_approved_qty: 3 }), 540)
})

test('computeItemTaxAmountPkr: null when no priced cost', () => {
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '', item_qty: 2 }), null)
  assert.equal(computeItemTaxAmountPkr({ item_qty: 2 }), null)
})

test('computeItemTaxAmountPkr: rounds to nearest whole PKR', () => {
  // 999 * 1 * 0.18 = 179.82 -> 180
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '999', item_qty: 1 }), 180)
})

test('computeItemTaxAmountPkr: respects an explicit rate', () => {
  // 1000 * 2 * 0.10 = 200
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }, 0.10), 200)
})

test('computeItemTaxAmountPkr: defaults to 18% when rate omitted', () => {
  assert.equal(computeItemTaxAmountPkr({ item_est_cost: '1000', item_qty: 2 }), 360)
})

test('computeItGrandTotalWithTaxPkr: sums line totals + tax', () => {
  const items = [
    { item_est_cost: '1000', item_qty: 2 }, // line 2000 + tax 360 = 2360
    { item_est_cost: '500', item_qty: 1 }   // line 500 + tax 90 = 590
  ]
  assert.equal(computeItGrandTotalWithTaxPkr(items), 2950)
})
