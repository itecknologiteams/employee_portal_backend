import multer from 'multer'

/** Max upload size for payroll Excel/CSV (MB). Env PAYROLL_UPLOAD_MAX_MB — default 50 (was 15; large sheets + images trigger 413). */
const payrollMaxMb = (() => {
  const n = parseInt(process.env.PAYROLL_UPLOAD_MAX_MB || '50', 10)
  if (Number.isFinite(n) && n >= 1 && n <= 500) return n
  return 50
})()
const payrollMaxBytes = payrollMaxMb * 1024 * 1024

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
  limits: { fileSize: payrollMaxBytes },
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

/** Profile image upload for cards – memory storage so we return base64 and save in DB (no URL). */
export const cardsProfileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)
    cb(null, !!allowed)
  }
})
