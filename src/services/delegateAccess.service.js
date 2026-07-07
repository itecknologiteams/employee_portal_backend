import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import * as repo from '../repositories/delegateAccess.repository.js'
import {
  hashToken, computeStatus, maskEmail, validateCreateInput, buildSessionUser
} from '../utils/delegateAccess.js'
import { APP_NAME, EMAIL_FROM, EMAIL_LOGO_PATH, getEmailTransport, isEmailConfigured } from '../../config/email.js'
import { getOfficialEmailFromCrm } from '../../config/crmDatabase.js'

const OTP_EXPIRY_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5
const OTP_SALT_ROUNDS = 6
const otpStore = new Map() // token_hash -> { codeHash, expiresAt, attempts }

function buildUrl(baseUrl, rawToken) { return `${String(baseUrl).replace(/\/$/, '')}/delegate/${rawToken}` }

async function targetEmailFor(link) {
  const crmEmail = await getOfficialEmailFromCrm(link.employee_code).catch(() => null)
  return crmEmail || link.email || null
}

async function sendLinkEmail(link, url) {
  if (!isEmailConfigured()) return false
  const transport = getEmailTransport(); if (!transport) return false
  const to = await targetEmailFor(link); if (!to) return false
  const name = link.first_name || 'Colleague'
  const appName = APP_NAME || 'Employee Portal'
  const attachments = []
  const logoAbs = EMAIL_LOGO_PATH ? resolve(EMAIL_LOGO_PATH) : ''
  if (logoAbs && existsSync(logoAbs)) attachments.push({ filename: 'logo.png', content: readFileSync(logoAbs), cid: 'emp-portal-logo', contentDisposition: 'inline' })
  const logoImg = attachments.length ? `<img src="cid:emp-portal-logo" width="75" style="display:block;margin:0 auto 22px;max-width:75px;height:auto;" />` : ''
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px;"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:16px;border-top:5px solid #1e40af;padding:36px 40px;">
<tr><td style="text-align:center;">${logoImg}
<h1 style="margin:0 0 8px;font-size:22px;color:#1e40af;">Temporary Approval Access</h1>
<p style="margin:0 0 20px;color:#475569;font-size:15px;line-height:1.6;">Hi ${name}, you have temporary access to action your pending items while away. Click below and enter the one-time code sent to your email.</p>
<a href="${url}" style="display:inline-block;background:#1e40af;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:700;">Open Access Link</a>
<p style="margin:22px 0 0;color:#94a3b8;font-size:12px;word-break:break-all;">${url}</p></td></tr></table></td></tr></table></body></html>`
  const text = `Hi ${name},\n\nYou have temporary approval access. Open this link and enter the one-time code:\n${url}\n\n— ${appName}`
  await transport.sendMail({ from: EMAIL_FROM, to, subject: `Temporary Approval Access — ${appName}`, text, html, attachments })
    .catch((e) => { console.error('[DelegateAccess] link email failed:', e.message); throw e })
  return true
}

export async function createLink({ employeeId, pages, expiryDays, landingPage, createdBy, baseUrl }) {
  const v = validateCreateInput({ employeeId, pages, expiryDays, landingPage })
  if (!v.ok) return { error: v.error, status: 400 }
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + v.days * 24 * 60 * 60 * 1000).toISOString()
  const created = await repo.createLink({ tokenHash, employeeId: v.employeeId, pages: v.cleanPages, landingPage: v.landing, expiresAt, createdBy })
  await repo.logEvent({ linkId: created.id, eventType: 'created', detail: `pages=${v.cleanPages.join(',')}` })
  const full = await repo.findByTokenHash(tokenHash)
  const url = buildUrl(baseUrl, rawToken)
  let emailSent = false
  try { emailSent = await sendLinkEmail(full, url) } catch { emailSent = false }
  if (emailSent) await repo.logEvent({ linkId: created.id, eventType: 'email_sent', detail: maskEmail(full.email) })
  return { link: { ...created, status: computeStatus(created) }, url, emailSent }
}

export async function listLinks() {
  const rows = await repo.listLinks()
  return rows.map((r) => ({ ...r, status: computeStatus(r) }))
}

export async function revokeLink(id, revokedBy) {
  const row = await repo.revokeLink(parseInt(id, 10), revokedBy)
  if (!row) return { error: 'Link not found or already revoked', status: 404 }
  await repo.logEvent({ linkId: row.id, eventType: 'revoked' })
  return { ok: true }
}

export async function resendEmail(id, baseUrl) {
  const link = await repo.getLinkById(parseInt(id, 10))
  if (!link) return { error: 'Link not found', status: 404 }
  if (computeStatus(link) !== 'active') return { error: 'Link is not active', status: 400 }
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  await repo.updateTokenHash(link.id, tokenHash)
  const full = await repo.findByTokenHash(tokenHash)
  const url = buildUrl(baseUrl, rawToken)
  let emailSent = false
  try { emailSent = await sendLinkEmail(full, url) } catch { emailSent = false }
  if (emailSent) await repo.logEvent({ linkId: link.id, eventType: 'email_sent', detail: 'resend' })
  return { emailSent, url }
}

export async function listEvents(id) { return repo.listEvents(parseInt(id, 10)) }

export async function openLink({ rawToken, ip, userAgent }) {
  const link = await repo.findByTokenHash(hashToken(rawToken))
  if (!link) return { error: 'Invalid or unknown link', status: 404 }
  const status = computeStatus(link)
  if (status !== 'active') return { error: `This link is ${status}.`, status: 410 }
  await repo.logEvent({ linkId: link.id, eventType: 'opened', ip, userAgent })
  const code = String(Math.floor(100000 + Math.random() * 900000))
  otpStore.set(link.token_hash, { codeHash: await bcrypt.hash(code, OTP_SALT_ROUNDS), expiresAt: Date.now() + OTP_EXPIRY_MS, attempts: 0 })
  let sent = false
  const to = await targetEmailFor(link)
  if (isEmailConfigured() && to) {
    const transport = getEmailTransport()
    if (transport) {
      try {
        await transport.sendMail({ from: EMAIL_FROM, to, subject: `${code} is your access code — ${APP_NAME || 'Employee Portal'}`, text: `Your one-time access code is ${code}. It expires in 10 minutes.` })
        sent = true
      } catch (e) { console.error('[DelegateAccess] OTP email failed:', e.message) }
    }
  }
  if (sent) await repo.logEvent({ linkId: link.id, eventType: 'otp_sent', detail: maskEmail(to) })
  return { maskedEmail: maskEmail(to) }
}

export async function verifyOtp({ rawToken, otp, ip, userAgent }) {
  const tokenHash = hashToken(rawToken)
  const link = await repo.findByTokenHash(tokenHash)
  if (!link) return { error: 'Invalid or unknown link', status: 404 }
  if (computeStatus(link) !== 'active') return { error: 'This link is no longer active.', status: 410 }
  const entry = otpStore.get(tokenHash)
  if (!entry) return { error: 'No code requested or it expired. Reopen the link.', status: 400 }
  if (Date.now() > entry.expiresAt) { otpStore.delete(tokenHash); return { error: 'Code expired. Reopen the link.', status: 400 } }
  if (entry.attempts >= OTP_MAX_ATTEMPTS) return { error: 'Too many attempts. Reopen the link later.', status: 429 }
  entry.attempts += 1
  const ok = await bcrypt.compare(String(otp).trim(), entry.codeHash)
  if (!ok) {
    await repo.logEvent({ linkId: link.id, eventType: 'otp_failed', ip, userAgent })
    return { error: `Invalid code. ${Math.max(0, OTP_MAX_ATTEMPTS - entry.attempts)} attempt(s) left.`, status: 401 }
  }
  otpStore.delete(tokenHash)
  await repo.touchLastUsed(link.id)
  await repo.logEvent({ linkId: link.id, eventType: 'otp_verified', ip, userAgent })
  return { sessionUser: buildSessionUser(link), cookieMaxAgeMs: Math.max(60 * 1000, new Date(link.expires_at).getTime() - Date.now()) }
}
