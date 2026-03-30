/**
 * Parse unit price from PKR fields (digits and optional decimal; commas allowed).
 */

export function parseNumericUnitPricePkr(raw) {
  if (raw == null) return null
  const s = String(raw).trim().replace(/,/g, '')
  if (!s) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

export function getEffectiveUnitPricePkrFromItem(it) {
  const raw = it.item_est_cost ?? it.hod_item_est_cost ?? it.itemEstCost ?? ''
  return parseNumericUnitPricePkr(raw)
}

/** BOQ cost string → unit price (same numeric rules). */
export function parseCostFieldToUnitPkr(raw) {
  return parseNumericUnitPricePkr(raw)
}
