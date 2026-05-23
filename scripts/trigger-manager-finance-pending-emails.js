/**
 * One-shot: trigger "bucket changed → Manager of Finance" emails for every
 * requisition currently pending at the manager_finance stage. Use this once
 * after deploying the validBuckets fix to catch up on rows that were stuck
 * silently (Finance had approved but MoF never got notified).
 *
 * Run from repo root: node scripts/trigger-manager-finance-pending-emails.js
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

async function main() {
  const { executeQuery } = await import('../config/database.js')
  const { handleRequisitionBucketChanged } = await import('../workers/requisition-reminder-worker.js')

  const rows = await executeQuery(
    `SELECT r.req_id, r.req_reference_no
       FROM requisition r
      WHERE r.req_current_stage_key = 'manager_finance'
        AND COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.is_hidden, FALSE) = FALSE
      ORDER BY r.req_finance_approval_date DESC NULLS LAST`
  )

  console.log(`Found ${rows.length} requisition(s) pending at Manager of Finance.`)
  for (const r of rows) {
    const tag = r.req_reference_no || ('#' + r.req_id)
    try {
      await handleRequisitionBucketChanged({ requisitionId: r.req_id, newBucket: 'manager_finance' })
      console.log(`  ✓ ${tag} – email triggered`)
    } catch (err) {
      console.error(`  ✗ ${tag} – failed:`, err?.message)
    }
  }

  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
