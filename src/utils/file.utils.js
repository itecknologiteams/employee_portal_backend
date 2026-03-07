import multer from 'multer'

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

/** Profile image upload for cards – memory storage so we return base64 and save in DB (no URL). */
export const cardsProfileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)
    cb(null, !!allowed)
  }
})
