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
 * 1. Reads each image file and converts to base64 data URL.
 * 2. Updates employee_cards.employees.profile_image with the data URL (no URL/path; works on any host).
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

const IMAGE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' }

function getCardsDir() {
  const envDir = process.env.CARDS_DIR || process.env.CARDS_IMAGES_DIR
  if (envDir && fs.existsSync(envDir)) return path.resolve(envDir)
  const cliDir = process.argv[2]
  if (cliDir && fs.existsSync(cliDir)) return path.resolve(cliDir)
  const defaultDir = path.join(BACKEND_ROOT, '..', 'Emp_Portal_FrontEnd', 'Cards')
  return path.resolve(defaultDir)
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

function fileToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath)
  const base64 = buf.toString('base64')
  const ext = path.extname(filePath).toLowerCase()
  const mime = MIME_BY_EXT[ext] || 'image/jpeg'
  return `data:${mime};base64,${base64}`
}

async function updateEmployeeProfileImage(employeeCode, profileImageDataUrl) {
  const rows = await executeQueryCards(
    'UPDATE employees SET profile_image = $1 WHERE employee_code = $2 RETURNING id, name',
    [profileImageDataUrl, String(employeeCode).trim()]
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

  let processed = 0
  let updated = 0
  let skipped = 0
  const errors = []

  for (const { city, filePath, fileName } of walkCityImages(cardsDir)) {
    const ext = path.extname(fileName)
    const employeeCode = path.basename(fileName, ext)
    if (!employeeCode) continue

    processed++
    try {
      const dataUrl = fileToDataUrl(filePath)
      const row = await updateEmployeeProfileImage(employeeCode, dataUrl)
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
