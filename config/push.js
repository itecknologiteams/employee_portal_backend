import webpush from 'web-push'

let configured = false

export function configureWebPush() {
  if (configured) return
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@itecknologi.com'
  if (!publicKey || !privateKey) {
    console.warn('Web Push: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set. Browser push disabled. Run: npx web-push generate-vapid-keys')
    return
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  configured = true
}

export function getVapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || ''
}

export function isWebPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

export { webpush }
