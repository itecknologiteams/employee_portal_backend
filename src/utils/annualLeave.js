/**
 * Annual-leave yearly allocation logic (pure, unit-tested).
 *
 * Rules:
 *  - Proration months N = max(0, 12 - joiningMonth)  (joining month excluded; month is 1-based).
 *  - Prorated days = round((14 / 12) * N).
 *  - New employee earns nothing until their 1-year service anniversary.
 *  - At the 1-year anniversary: grant the prorated days (one time).
 *  - Each January thereafter: carry remaining annual into carried_forward, reset annual to 14.
 */

export const ANNUAL_FULL_DAYS = 14

/** Number of prorated months for the joining (partial) calendar year. */
export function annualProrationMonths(joinDate) {
  if (!joinDate) return 0
  const d = new Date(joinDate)
  if (Number.isNaN(d.getTime())) return 0
  const month = d.getMonth() + 1 // 1-based
  return Math.max(0, 12 - month)
}

/** Prorated annual days for an employee's joining month: round((14/12) * N). */
export function proratedAnnualDays(joinDate) {
  return Math.round((ANNUAL_FULL_DAYS / 12) * annualProrationMonths(joinDate))
}

/** First-anniversary date (joinDate + 1 year). */
function oneYearAnniversary(joinDate) {
  const a = new Date(joinDate)
  a.setFullYear(a.getFullYear() + 1)
  return a
}

/**
 * Decide the next annual-leave allocation action for one employee. Idempotent.
 * @param {{joinDate:string, prorationGrantedAt:?string, lastAllocatedYear:?number, today:string}} o
 * @returns {{action:'proration'|'january_reset'|'none', proratedDays?:number, year?:number}}
 */
export function decideAnnualAllocation({ joinDate, prorationGrantedAt, lastAllocatedYear, today }) {
  if (!joinDate || !today) return { action: 'none' }
  const D = new Date(today)
  if (Number.isNaN(D.getTime())) return { action: 'none' }
  const Y = D.getFullYear()

  if (!prorationGrantedAt) {
    // Grant the one-time proration ONLY when the 1-year anniversary falls in the current year.
    // This protects long-tenured staff (anniversary years ago, tracking not yet initialized) from
    // being wrongly prorated — they are initialized via the annual import instead.
    const anniv = oneYearAnniversary(joinDate)
    if (D >= anniv && anniv.getFullYear() === Y) {
      return { action: 'proration', proratedDays: proratedAnnualDays(joinDate), year: Y }
    }
    return { action: 'none' }
  }

  // Proration already granted → yearly January reset, once per calendar year.
  if (lastAllocatedYear == null || Y > Number(lastAllocatedYear)) {
    return { action: 'january_reset', year: Y }
  }
  return { action: 'none' }
}
