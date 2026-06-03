/**
 * One-time (re-runnable) migration: move existing `Pending HR` leave requests that, under the
 * current routing rule, belong to the CEO — i.e. an HOD's own Annual/long leave (not Casual/Sick,
 * not a senior executive) — from `Pending HR` to `Pending CEO`.
 *
 * Uses the app's own resolveInitialLeaveStatus() so the migration applies the EXACT same rule as
 * live creation routing. Safe to re-run: only rows that should be 'Pending CEO' are changed.
 *
 * Usage:
 *   node scripts/migrate-hod-pending-hr-to-ceo.js          # dry run (no writes)
 *   node scripts/migrate-hod-pending-hr-to-ceo.js --apply  # perform the update
 */
import { executeQuery } from '../config/database.js'
import { resolveInitialLeaveStatus } from '../src/services/leave.service.js'

const APPLY = process.argv.includes('--apply')

async function main() {
  const rows = await executeQuery(
    "SELECT leave_request_id, employee_id, leave_type_id FROM leave_requests WHERE status = 'Pending HR'"
  )
  console.log(`Found ${rows.length} 'Pending HR' leave(s).`)

  const toMigrate = []
  for (const r of rows) {
    const target = await resolveInitialLeaveStatus(r.employee_id, r.leave_type_id)
    if (target === 'Pending CEO') toMigrate.push(r)
  }

  if (toMigrate.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  console.log(`${toMigrate.length} leave(s) qualify to move to 'Pending CEO':`,
    toMigrate.map((r) => r.leave_request_id).join(', '))

  if (!APPLY) {
    console.log('\nDRY RUN — no changes written. Re-run with --apply to perform the update.')
    return
  }

  const ids = toMigrate.map((r) => r.leave_request_id)
  const result = await executeQuery(
    "UPDATE leave_requests SET status = 'Pending CEO' WHERE leave_request_id = ANY($1) AND status = 'Pending HR' RETURNING leave_request_id",
    [ids]
  )
  console.log(`Updated ${result.length} leave(s) to 'Pending CEO':`, result.map((r) => r.leave_request_id).join(', '))
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('Migration failed:', err.message); process.exit(1) })
