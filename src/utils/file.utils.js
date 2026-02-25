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

/** Excel upload for payroll (gross salaries, etc.) - .xlsx, .xls */
export const payrollExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mimetypeOk = file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel' ||
      file.mimetype === 'application/octet-stream'
    const nameOk = /\.(xlsx|xls)$/i.test(file.originalname || '')
    cb(null, !!(mimetypeOk && nameOk))
  }
})
