/**
 * One-shot: (re)send the "Finance Approved → Payable / Receivable (Cc HR)" loan email
 * for every requisition currently pending at the HR Cheque Receiving (hr_check) stage.
 *
 * Each email goes to PAYABLE_EMAIL + RECEIVABLE_EMAIL, Cc HR_EMAIL, Bcc EMAIL_BCC
 * (see config/email.js), with the loan-form PDF attached. Use this to catch up rows
 * whose notification went to the wrong address before the recipient fix.
 *
 * Preview only (no emails sent):   node scripts/trigger-manager-finance-loan-emails.js --dry
 * Send for real:                   node scripts/trigger-manager-finance-loan-emails.js
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const DRY_RUN = process.argv.includes('--dry')

async function main() {
  const { executeQuery, closeConnection } = await import('../config/database.js')
  const { sendLoanFinanceApprovedEmail } = await import('../src/services/requisition.service.js')
  const { PAYABLE_EMAIL, RECEIVABLE_EMAIL, HR_EMAIL, EMAIL_BCC } = await import('../config/email.js')

  const rows = await executeQuery(
    `SELECT r.req_id, r.req_reference_no
       FROM requisition r
      WHERE r.req_current_stage_key = 'hr_check'
        AND COALESCE(r.req_is_rejected, 0) = 0
        AND COALESCE(r.is_hidden, FALSE) = FALSE
      ORDER BY r.req_finance_approval_date DESC NULLS LAST`
  )

  console.log(`Recipients → To: ${PAYABLE_EMAIL}, ${RECEIVABLE_EMAIL} | Cc: ${HR_EMAIL} | Bcc: ${EMAIL_BCC}`)
  console.log(`Found ${rows.length} requisition(s) pending at HR Cheque Receiving.${DRY_RUN ? ' (DRY RUN — no emails will be sent)' : ''}`)

  let sent = 0
  for (const r of rows) {
    const tag = r.req_reference_no || ('#' + r.req_id)
    if (DRY_RUN) {
      console.log(`  • ${tag} – would send`)
      continue
    }
    try {
      await sendLoanFinanceApprovedEmail(r.req_id)
      console.log(`  ✓ ${tag} – email sent`)
      sent++
    } catch (err) {
      console.error(`  ✗ ${tag} – failed:`, err?.message)
    }
  }

  console.log(DRY_RUN ? 'Done (dry run).' : `Done. Sent ${sent}/${rows.length}.`)
  try { await closeConnection() } catch (_) {}
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
