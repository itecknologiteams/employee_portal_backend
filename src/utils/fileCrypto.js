import crypto from 'crypto'

// AES-256-GCM at-rest encryption for uploaded files (TED presentations). The stored value is
// base64( iv[12] | authTag[16] | ciphertext ). Key is derived (SHA-256) from FILE_ENCRYPTION_KEY
// (falls back to SESSION_SECRET) so any-length secret works and rotating the env rotates the key.

function getKey() {
  const raw = process.env.FILE_ENCRYPTION_KEY || process.env.SESSION_SECRET || 'ted-dev-file-key-change-me'
  return crypto.createHash('sha256').update(String(raw)).digest() // 32 bytes
}

/** Encrypt a Buffer → base64 string (iv|tag|ciphertext). */
export function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(buf), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

/** Decrypt a base64 (iv|tag|ciphertext) string → Buffer. Throws if tampered / wrong key. */
export function decryptToBuffer(b64) {
  const data = Buffer.from(b64, 'base64')
  const iv = data.subarray(0, 12)
  const tag = data.subarray(12, 28)
  const ct = data.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}
