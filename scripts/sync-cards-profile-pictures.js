/**
 * Sync profile pictures from Emp_Portal_FrontEnd/Cards (city-wise folders) to employee_cards DB.
 *
 * Expected folder structure:
 *   Cards/
 *     Lahore/
 *       10591.jpg      <- filename without ext = employee_code
 *       10592.png
 *     Karachi/
 *       20101.jpg
 *
 * Each image file name (without extension) is treated as employee_code. The script:
 * 1. Copies each image to BackEnd uploads/cards/<employee_code>.<ext>
 * 2. Updates employee_cards.employees.profile_image = 'cards/<employee_code>.<ext>'
 *
 * Usage:
 *   node scripts/sync-cards-profile-pictures.js [path-to-Cards-folder]
 *   CARDS_DIR="D:/path/to/Cards" node scripts/sync-cards-profile-pictures.js
 *
 * Default path: ../Emp_Portal_FrontEnd/Cards (relative to BackEnd root)
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { executeQueryCards, closeCardsPool } from '../config/cardsDatabase.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = path.resolve(__dirname, '..')
const UPLOADS_CARDS = path.join(BACKEND_ROOT, 'uploads', 'cards')

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp']

function getCardsDir() {
  const envDir = process.env.CARDS_DIR || process.env.CARDS_IMAGES_DIR
  if (envDir && fs.existsSync(envDir)) return path.resolve(envDir)
  const cliDir = process.argv[2]
  if (cliDir && fs.existsSync(cliDir)) return path.resolve(cliDir)
  const defaultDir = path.join(BACKEND_ROOT, '..', 'Emp_Portal_FrontEnd', 'Cards')
  return path.resolve(defaultDir)
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log('Created directory:', dir)
  }
}

function isImageFile(name) {
  const ext = path.extname(name).toLowerCase()
  return IMAGE_EXT.includes(ext)
}

function* walkCityImages(cardsDir) {
  if (!fs.existsSync(cardsDir)) return
  const entries = fs.readdirSync(cardsDir, { withFileTypes: true })
  for (const ent of entries) {
    const full = path.join(cardsDir, ent.name)
    if (ent.isDirectory()) {
      const cityName = ent.name
      const subEntries = fs.readdirSync(full, { withFileTypes: true })
      for (const sub of subEntries) {
        if (sub.isFile() && isImageFile(sub.name)) {
          yield { city: cityName, filePath: path.join(full, sub.name), fileName: sub.name }
        }
      }
    } else if (ent.isFile() && isImageFile(ent.name)) {
      yield { city: null, filePath: full, fileName: ent.name }
    }
  }
}

async function updateEmployeeProfileImage(employeeCode, profileImagePath) {
  const rows = await executeQueryCards(
    'UPDATE employees SET profile_image = $1 WHERE employee_code = $2 RETURNING id, name',
    [profileImagePath, String(employeeCode).trim()]
  )
  return rows.length > 0 ? rows[0] : null
}

async function main() {
  const cardsDir = getCardsDir()
  console.log('Cards directory:', cardsDir)

  if (!fs.existsSync(cardsDir)) {
    console.error('ERROR: Cards folder not found. Create it and add city-wise subfolders with images named by employee_code (e.g. 10591.jpg).')
    console.error('Example: Emp_Portal_FrontEnd/Cards/Lahore/10591.jpg')
    process.exit(1)
  }

  ensureDir(UPLOADS_CARDS)

  let processed = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (const { city, filePath, fileName } of walkCityImages(cardsDir)) {
    const ext = path.extname(fileName)
    const employeeCode = path.basename(fileName, ext)
    if (!employeeCode) continue

    processed++
    const destFileName = `${employeeCode}${ext}`
    const destPath = path.join(UPLOADS_CARDS, destFileName)
    const dbPath = `cards/${destFileName}`

    try {
      fs.copyFileSync(filePath, destPath)
      const row = await updateEmployeeProfileImage(employeeCode, dbPath)
      if (row) {
        updated++
        console.log(`  [${city || 'root'}] ${fileName} -> ${employeeCode} (${row.name || row.id})`)
      } else {
        skipped++
        console.warn(`  [${city || 'root'}] ${fileName} -> employee_code "${employeeCode}" not found in employee_cards, skipped`)
      }
    } catch (err) {
      errors.push({ file: fileName, code: employeeCode, message: err.message })
      console.error(`  ERROR ${fileName}:`, err.message)
    }
  }

  console.log('')
  console.log('Done. Processed:', processed, '| Updated:', updated, '| Skipped (no match):', skipped, '| Errors:', errors.length)
  await closeCardsPool()
  if (errors.length > 0) {
    console.error('Errors:', errors)
    process.exit(1)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
