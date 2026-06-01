/**
 * Run a single SQL migration file against the configured database.
 *
 * Usage: node scripts/run-migration.js database/migrations/<file>.sql
 *
 * Requires: .env with DB_* settings (same config as the app).
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

dotenv.config()

async function runMigration() {
  const fileArg = process.argv[2]
  if (!fileArg) {
    console.error('Usage: node scripts/run-migration.js <path-to-sql-file>')
    process.exit(1)
  }

  const filePath = path.resolve(process.cwd(), fileArg)
  if (!fs.existsSync(filePath)) {
    console.error('Migration file not found:', filePath)
    process.exit(1)
  }

  const sql = fs.readFileSync(filePath, 'utf8')

  try {
    const { executeQuery, closeConnection } = await import('../config/database.js')
    await executeQuery(sql)
    await closeConnection()
    console.log(`✅ Migration applied: ${fileArg}`)
  } catch (err) {
    console.error('❌ Migration failed:', err.message)
    process.exit(1)
  }
}

runMigration()
