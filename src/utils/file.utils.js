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
