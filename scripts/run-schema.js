/**
 * Run PostgreSQL full schema (creates all tables).
 * Use when "relation employees does not exist" or tables are missing.
 *
 * Usage: node scripts/run-schema.js
 * Or:    npm run db:schema
 *
 * Requires: .env with DB_* for PostgreSQL (DB_DRIVER must not be 'sqlserver').
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runSchema() {
  if (process.env.DB_DRIVER === 'sqlserver') {
    console.error('This script is for PostgreSQL only. Current DB_DRIVER is sqlserver.')
    process.exit(1)
  }

  const schemaPath = path.join(__dirname, '..', 'database', 'postgresql-full-schema.sql')
  if (!fs.existsSync(schemaPath)) {
    console.error('Schema file not found:', schemaPath)
    process.exit(1)
  }

  const sql = fs.readFileSync(schemaPath, 'utf8')

  try {
    const { getConnection, closeConnection } = await import('../config/database.js')
    const client = await getConnection()
    await client.query(sql)
    if (client.release) client.release()
    await closeConnection()
    console.log('✅ PostgreSQL schema applied successfully. All tables created.')
  } catch (err) {
    console.error('❌ Schema run failed:', err.message)
    process.exit(1)
  }
}

runSchema()
