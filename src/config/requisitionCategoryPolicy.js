/**
 * Single source of truth for per-category flow EXCEPTIONS.
 *
 * The requisition flow itself (which stages run, in what order) is data-driven via the
 * `requisition_category_stage` / `requisition_flow_stage` tables. This module captures the few
 * code-level behavioural exceptions a category can have, in ONE declarative place — so changing
 * one category's behaviour can't accidentally affect another, and the rules aren't duplicated
 * across services. Add or adjust a category's behaviour HERE.
 *
 * Flags:
 *  - noBoq        : HOD approves without a BOQ (no size/brand/price-per-piece required).
 *  - hrAfterHod   : after HOD the requisition goes to the HR bucket (before Committee).
 *  - noDate       : "required by" date is not required at creation.
 *  - isItEquipment: items + pricing are filled by the IT stage (after HOD), not the creator.
 */

const norm = (c) => (c == null ? '' : String(c).trim().toLowerCase())
const inSet = (set, c) => { const x = norm(c); return x !== '' && set.some((s) => norm(s) === x) }

// ── Declarative per-category exception sets (edit these to change behaviour) ──
const NO_BOQ = [
  'Vehicle Maintenance',
  'Vehicle Repair',
  'Other Repair & Maintenance',
  'Loan & Advance Salary',
  'Event',
  'Specialized Projects',
  'General Procurements Electric Appliances'
]
const HR_AFTER_HOD = ['Loan & Advance Salary']
const NO_DATE = ['Loan & Advance Salary', 'Stationary']
const IT_EQUIPMENT = ['IT Equipments']

/** HOD can approve without BOQ (no size/brand/price-per-piece). */
export const isCategoryNoBoq = (category) => inSet(NO_BOQ, category)

/** Category goes to the HR bucket after HOD approval (before Committee). */
export const isCategoryHrAfterHod = (category) => inSet(HR_AFTER_HOD, category)

/** "Required by" date is optional at creation for this category. */
export const isCategoryNoDate = (category) => inSet(NO_DATE, category)

/** IT Equipments — items + pricing are added by the IT stage, not the creator. */
export const isItEquipmentCategory = (category) => inSet(IT_EQUIPMENT, category)

/** All exception flags for a category in one object (for engine/UI use). */
export function getCategoryPolicy(category) {
  return {
    category: category ?? null,
    noBoq: isCategoryNoBoq(category),
    hrAfterHod: isCategoryHrAfterHod(category),
    noDate: isCategoryNoDate(category),
    isItEquipment: isItEquipmentCategory(category)
  }
}
