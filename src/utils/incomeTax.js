/**
 * Pakistan salaried-person income tax (FBR) — annual slab calculation.
 *
 * FY 2026-2027 slabs (taxable salary income, annual):
 *   ≤ 600,000                    → 0%
 *   600,001 – 1,200,000          → 1% of amount over 600,000
 *   1,200,001 – 2,200,000        → 6,000 + 11% over 1,200,000
 *   2,200,001 – 3,200,000        → 116,000 + 20% over 2,200,000
 *   3,200,001 – 4,100,000        → 316,000 + 25% over 3,200,000
 *   4,100,001 – 5,600,000        → 541,000 + 29% over 4,100,000
 *   5,600,001 – 7,000,000        → 976,000 + 32% over 5,600,000
 *   > 7,000,000                  → 1,424,000 + 35% over 7,000,000
 *
 * Each bracket = { min, base, rate }: tax = base + rate * (income − min) for income > min.
 * Boundary values fall in the lower bracket (matches the base amounts above).
 */
export const INCOME_TAX_SLABS = {
  '2026-2027': [
    { min: 0,        base: 0,       rate: 0 },
    { min: 600000,   base: 0,       rate: 0.01 },
    { min: 1200000,  base: 6000,    rate: 0.11 },
    { min: 2200000,  base: 116000,  rate: 0.20 },
    { min: 3200000,  base: 316000,  rate: 0.25 },
    { min: 3200000 + 900000, base: 541000, rate: 0.29 },   // 4,100,000
    { min: 5600000,  base: 976000,  rate: 0.32 },
    { min: 7000000,  base: 1424000, rate: 0.35 }
  ]
}

const DEFAULT_FY = '2026-2027'

/** Annual income tax for a given annual taxable salary income (rounded to whole rupees). */
export function computeAnnualIncomeTax(annualTaxableIncome, fiscalYear = DEFAULT_FY) {
  const slabs = INCOME_TAX_SLABS[fiscalYear] || INCOME_TAX_SLABS[DEFAULT_FY]
  const x = Number(annualTaxableIncome) || 0
  if (x <= slabs[1].min) return 0 // ≤ first taxable threshold (600,000)
  let bracket = slabs[0]
  for (const s of slabs) {
    if (x > s.min) bracket = s
    else break
  }
  return Math.round(bracket.base + bracket.rate * (x - bracket.min))
}

/** Monthly income tax deduction = annual tax / 12 (rounded to 2 dp). */
export function monthlyIncomeTax(annualTaxableIncome, fiscalYear = DEFAULT_FY) {
  return Math.round((computeAnnualIncomeTax(annualTaxableIncome, fiscalYear) / 12) * 100) / 100
}

/**
 * Annual income tax from DB-managed slabs (income_tax_slab rows of the active version).
 * Each slab: { min_amt, max_amt, taxable_amt, tax_percent } — tax = taxable_amt + tax_percent% * (income − min_amt).
 * Returns null when no slabs are supplied (so the caller can fall back to the built-in table).
 */
export function computeAnnualIncomeTaxFromSlabs(annualTaxableIncome, slabs) {
  if (!Array.isArray(slabs) || slabs.length === 0) return null
  const x = Number(annualTaxableIncome) || 0
  const norm = slabs
    .map((s) => ({
      min: Number(s.min_amt ?? s.minAmt) || 0,
      max: (s.max_amt ?? s.maxAmt) == null || (s.max_amt ?? s.maxAmt) === '' ? Infinity : Number(s.max_amt ?? s.maxAmt),
      base: Number(s.taxable_amt ?? s.taxableAmt) || 0,
      rate: Number(s.tax_percent ?? s.taxPercent) || 0
    }))
    .sort((a, b) => a.min - b.min)
  // Bracket = the one where min < x <= max; fall back to the highest bracket whose min < x.
  let bracket = norm.find((s) => x > s.min && x <= s.max)
  if (!bracket) {
    for (const s of norm) if (x > s.min) bracket = s
  }
  if (!bracket) return 0
  return Math.round(bracket.base + (bracket.rate / 100) * (x - bracket.min))
}
