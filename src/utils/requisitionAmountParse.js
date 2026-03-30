/**
 * Parse informal PKR amounts from requisition lines (e.g. 5k, 1.1k, 10K, 1.7-2K).
 * Used for item_est_cost (price per piece / unit in BOQ) and optional min/max range.
 */

/** Parse a single token like "5k", "1.1K", "50000", "50,000" → PKR number */
export function parseTokenToPkr(token) {
  if (token == null) return null
  let s = String(token).trim().replace(/,/g, '').replace(/\s+/g, ' ')
  if (!s) return null
  s = s.replace(/^pkr?\s*/i, '').replace(/\s*pkr?$/i, '').trim()
  const kSuffix = /k$/i.test(s)
  if (kSuffix) s = s.slice(0, -1).trim()
  const n = parseFloat(s)
  if (Number.isNaN(n)) return null
  return kSuffix ? n * 1000 : n
}

/**
 * Parse free-text that may be a single amount or a range "a - b" (e.g. 1.7-2K, 1700-2000).
 * @returns {{ kind: 'single', value: number } | { kind: 'range', min: number, max: number } | null}
 */
export function parseFlexibleAmountInput(raw) {
  if (raw == null) return null
  const s0 = String(raw).trim()
  if (!s0) return null

  const dashIdx = s0.indexOf('-')
  if (dashIdx > 0 && dashIdx < s0.length - 1) {
    const left = s0.slice(0, dashIdx).trim()
    const right = s0.slice(dashIdx + 1).trim()
    if (left && right) {
      let a = parseTokenToPkr(left)
      let b = parseTokenToPkr(right)
      if (a != null && b != null) {
        const rightHasK = /k$/i.test(right)
        const leftHasK = /k$/i.test(left)
        // "1.7-2K": left is often meant as 1.7k when right is in thousands
        if (rightHasK && !leftHasK && a > 0 && a < 500 && b > a) {
          a = a * 1000
        }
        if (leftHasK && !rightHasK && b > 0 && b < 500 && a > b) {
          b = b * 1000
        }
        return { kind: 'range', min: Math.min(a, b), max: Math.max(a, b) }
      }
    }
  }

  const v = parseTokenToPkr(s0)
  if (v != null) return { kind: 'single', value: v }
  return null
}

/** Single number for BOQ fields (midpoint if range). */
export function parseCostFieldToUnitPkr(raw) {
  const p = parseFlexibleAmountInput(String(raw ?? ''))
  if (!p) return null
  if (p.kind === 'range') return (p.min + p.max) / 2
  return p.value
}

export function getEffectiveUnitPricePkrFromItem(it) {
  const minCol = it.item_est_min != null ? Number(it.item_est_min) : null
  const maxCol = it.item_est_max != null ? Number(it.item_est_max) : null
  if (minCol != null && maxCol != null && !Number.isNaN(minCol) && !Number.isNaN(maxCol)) {
    return (minCol + maxCol) / 2
  }
  const raw = it.item_est_cost ?? it.hod_item_est_cost ?? it.itemEstCost ?? ''
  const parsed = parseFlexibleAmountInput(String(raw ?? ''))
  if (parsed?.kind === 'range') return (parsed.min + parsed.max) / 2
  if (parsed?.kind === 'single') return parsed.value
  const fallback = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isNaN(fallback) ? null : fallback
}
