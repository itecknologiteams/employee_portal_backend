import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function fileToDataUrl(file) {
  if (!file || !file.buffer) return null
  const base64 = file.buffer.toString('base64')
  const mime = file.mimetype || 'image/jpeg'
  return `data:${mime};base64,${base64}`
}

export const quotationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)
    cb(null, !!allowed)
  }
})

/** Excel/CSV upload for payroll (gross salaries, payroll sheet, overrides) - .xlsx, .xls, .csv */
export const payrollExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimetypeOk = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'text/csv' ||
      file.mimetype === 'application/csv' ||
      file.mimetype === 'application/octet-stream'
    const nameOk = /\.(xlsx|xls|csv)$/i.test(file.originalname || '')
    cb(null, !!(mimetypeOk && nameOk))
  }
})

/** Profile image upload for cards – saved to uploads/cards/ */
const cardsProfileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/cards')
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch (e) {}
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.jpg').toLowerCase().replace(/jpeg/, 'jpg')
    cb(null, `profile-${Date.now()}${ext}`)
  }
})
export const cardsProfileUpload = multer({
  storage: cardsProfileStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)
    cb(null, !!allowed)
  }
})
