/**
 * Strict numeric PKR amounts for requisition line costs (digits and optional decimal only).
 */

export function parseNumericCostPkr(raw) {
  const s = String(raw ?? '').trim().replace(/,/g, '')
  if (!s) return null
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

/** Unit price from a requisition_items row (HOD BOQ cost when present). */
export function getEffectiveUnitPricePkrFromItem(it) {
  const raw = it.hod_item_est_cost ?? it.item_est_cost ?? it.itemEstCost ?? ''
  return parseNumericCostPkr(String(raw))
}
