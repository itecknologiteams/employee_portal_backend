import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isItemExcluded,
  computeItGrandTotalWithTaxPkr,
  computeCommitteeApprovedLineTotalPKR
} from '../src/utils/requisition.utils.js'

test('isItemExcluded: active / missing status are not excluded', () => {
  assert.equal(isItemExcluded({ item_review_status: 'active' }), false)
  assert.equal(isItemExcluded({}), false)
  assert.equal(isItemExcluded({ item_review_status: null }), false)
})

test('isItemExcluded: pending_review and dropped are excluded', () => {
  assert.equal(isItemExcluded({ item_review_status: 'pending_review' }), true)
  assert.equal(isItemExcluded({ item_review_status: 'dropped' }), true)
})

test('isItemExcluded: accepts camelCase fallback', () => {
  assert.equal(isItemExcluded({ itemReviewStatus: 'dropped' }), true)
})

test('grand total with tax excludes flagged/dropped items', () => {
  const items = [
    { item_est_cost: '1000', item_qty: 2, item_review_status: 'active' },        // 2000 + 360 tax = 2360
    { item_est_cost: '5000', item_qty: 1, item_review_status: 'pending_review' },// excluded
    { item_est_cost: '3000', item_qty: 1, item_review_status: 'dropped' }        // excluded
  ]
  assert.equal(computeItGrandTotalWithTaxPkr(items), 2360)
})

test('committee approved line total excludes flagged/dropped items', () => {
  const items = [
    { committee_approved_qty: 2, item_est_cost: '1000', item_review_status: 'active' },         // 2000
    { committee_approved_qty: 5, item_est_cost: '1000', item_review_status: 'pending_review' }, // excluded
    { committee_approved_qty: 5, item_est_cost: '1000', item_review_status: 'dropped' }         // excluded
  ]
  assert.equal(computeCommitteeApprovedLineTotalPKR(items), 2000)
})

test('all-active behaves as before (no regression)', () => {
  const items = [
    { item_est_cost: '1000', item_qty: 2 },
    { item_est_cost: '2000', item_qty: 1 }
  ]
  // (1000*2 + 360) + (2000*1 + 360) = 2360 + 2360 = 4720
  assert.equal(computeItGrandTotalWithTaxPkr(items), 4720)
})
