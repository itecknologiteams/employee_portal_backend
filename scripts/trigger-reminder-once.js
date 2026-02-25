/**
 * Run reminder check once (same logic as POST /api/requisition/trigger-reminder-check).
 * Use: from repo root: node scripts/trigger-reminder-once.js
 * Requires: .env with DB_*, REDIS_*, SMTP_*, BULLMQ_REMINDER_ENABLED=1
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

async function main() {
  const enabled = process.env.BULLMQ_REMINDER_ENABLED === '1' || process.env.REDIS_HOST
  if (!enabled) {
    console.log('BULLMQ_REMINDER_ENABLED is not 1 and REDIS_HOST not set. Exiting.')
    process.exit(0)
  }

  const { processRequisitionReminders } = await import('../workers/requisition-reminder-worker.js')
  console.log('Running reminder check once...')
  await processRequisitionReminders()
  console.log('Done. Check inbox for any reminder emails.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
