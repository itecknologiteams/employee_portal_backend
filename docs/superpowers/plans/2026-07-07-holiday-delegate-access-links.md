# Holiday Delegate Access Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SuperAdmin issue a time-limited, OTP-gated link that gives a holiday-bound approver a scoped stand-in session (acting as that employee, limited to selected pages) so their pending requisition approvals can still be actioned.

**Architecture:** A new `/api/delegate-access` module (route→controller→service→repository) persists links in Postgres, sends an OTP email on link open (reusing the FPIN-reset email pattern), and on OTP verify establishes a scoped `req.session.user` with `userType: 'DelegateAccess'`, `permissions` = selected pages, and a `delegate` marker. A `delegateSession` middleware re-validates the link on every `/api` request (immediate revoke/expiry) and logs approval actions. Pure logic lives in `src/utils/delegateAccess.js` and is unit-tested; DB/email/session paths are covered by live smoke + end-to-end checks (matching this repo's testing style). The React SPA adds a public `/delegate/:token` entry page, a `DelegateAccess` branch in `EmployeeContext.hasPermission`, and a SuperAdmin management page.

**Tech Stack:** Node/Express (ESM), PostgreSQL via `executeQuery`/`executeTransaction`, `express-session` (cookie `emp.portal.sid`), nodemailer (`config/email.js`), bcryptjs (OTP hashing), React 18 + Vite + react-router v6, cookie/session auth (`credentials: 'include'`).

## Global Constraints

- Backend is ESM (`"type": "module"`); use `import`/`export`, no `require`.
- **Testing convention:** Node's built-in runner (`node --test`), `import assert from 'node:assert/strict'`, files in `tests/`, following `tests/annual-leave.test.js`. The repo unit-tests **pure functions only** (in `src/utils/`) and does **no** DB/module mocking — do not introduce vitest/jest. DB, email, and session behaviour is verified by a live smoke check and the end-to-end task.
- All SQL goes through `executeQuery(sql, params)` / `executeTransaction(...)` from `config/database.js`; positional params `$1,$2`.
- Migrations are hand-run: `node scripts/run-migration.js database/migrations/<file>.sql`; convention: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, trailing `SELECT '<msg>' AS message;`.
- SuperAdmin gate = `req.session.user?.userType === 'SuperAdmin'`.
- Link expiry minimum **10 days**, default **10**.
- OTP: 6 digits, hashed (bcryptjs), 10-minute expiry, 5-attempt lockout — mirror `src/services/salary.service.js`.
- Link URL base = `PORTAL_PUBLIC_URL` env (strip trailing slash), fallback `${req.protocol}://${req.get('host')}`. URL form: `<base>/delegate/<rawToken>`.
- Email: reuse `config/email.js` (`getEmailTransport`, `EMAIL_FROM`, `EMAIL_LOGO_PATH`, `APP_NAME`, `isEmailConfigured`); send to official CRM email via `getOfficialEmailFromCrm(employeeCode)` (`config/crmDatabase.js`, confirmed exported) with portal email fallback; never throw on email failure.
- Raw token = `crypto.randomBytes(32).toString('hex')`; store only `crypto.createHash('sha256').update(token).digest('hex')`.
- Frontend API base is `/api`; use the `apiCall` wrapper in `src/services/api.js`; new endpoints grouped as `delegateAccessAPI`.
- Selectable pages exclude SuperAdmin-only surfaces: `role_permissions`, `manage_delegate_access`, `administration`.
- Commit after each task. Branch `feature/holiday-delegate-access` already exists; work on it.

---

## File Structure

**Backend (`d:\Github\Emp_Portal_BackEnd`)**
- Create `database/migrations/create_delegate_access_pg.sql` — two tables + indexes.
- Create `src/utils/delegateAccess.js` — **pure** helpers (hash, status, mask, path map, validation, action-detection, session-payload builder). Unit-tested.
- Create `tests/delegate-access.test.js` — `node:test` unit tests for the utils.
- Create `src/repositories/delegateAccess.repository.js` — all SQL.
- Create `src/services/delegateAccess.service.js` — orchestration (uses utils + repo + email + OTP store).
- Create `src/controllers/delegateAccess.controller.js` — HTTP handlers + SuperAdmin gate.
- Create `src/routes/delegateAccess.routes.js` — router.
- Create `src/middleware/delegateSession.js` — per-request validity + action logging (uses a util).
- Modify `src/routes/index.js` — export the new router.
- Modify `app.js` — import + mount `/api/delegate-access`, mount `delegateSession` middleware.
- Modify `config/permissions.js` — add `manage_delegate_access` key.

**Frontend (`d:\Github\Emp_Portal_FrontEnd`)**
- Modify `src/services/api.js` — add `delegateAccessAPI`.
- Create `src/constants/delegatePages.js` — labelled selectable-page list.
- Modify `src/context/EmployeeContext.jsx` — `DelegateAccess` branch in `hasPermission`.
- Create `src/pages/DelegateEntry.jsx` — public `/delegate/:token` OTP entry.
- Create `src/pages/DelegateAccessLinks.jsx` + `.css` — SuperAdmin management page.
- Modify `src/App.jsx` — public route `/delegate/:token`; protected route `delegate-access`.
- Modify `src/components/DashboardLayout.jsx` — nav item + `canAccessPath` SuperAdmin case.

---

## Task 1: Database migration

**Files:**
- Create: `database/migrations/create_delegate_access_pg.sql`

**Interfaces:**
- Produces: tables `delegate_access_link`, `delegate_access_event` used by Task 3 (repository).

- [ ] **Step 1: Write the migration SQL**

```sql
-- Holiday Delegate Access Links: SuperAdmin-issued, OTP-gated, time-limited scoped access.
CREATE TABLE IF NOT EXISTS delegate_access_link (
  id            SERIAL PRIMARY KEY,
  token_hash    VARCHAR(64) NOT NULL UNIQUE,
  employee_id   INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
  pages         JSONB NOT NULL,
  landing_page  VARCHAR(120) NOT NULL,
  expires_at    TIMESTAMP WITH TIME ZONE NOT NULL,
  created_by    INTEGER NOT NULL,
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  revoked_at    TIMESTAMP WITH TIME ZONE,
  revoked_by    INTEGER,
  last_used_at  TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_delegate_link_employee ON delegate_access_link(employee_id);
CREATE INDEX IF NOT EXISTS idx_delegate_link_expires ON delegate_access_link(expires_at);

CREATE TABLE IF NOT EXISTS delegate_access_event (
  id          SERIAL PRIMARY KEY,
  link_id     INTEGER NOT NULL REFERENCES delegate_access_link(id) ON DELETE CASCADE,
  event_type  VARCHAR(24) NOT NULL,
  ip          VARCHAR(64),
  user_agent  TEXT,
  detail      TEXT,
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delegate_event_link ON delegate_access_event(link_id);

SELECT 'delegate_access tables ready' AS message;
```

- [ ] **Step 2: Run the migration**

Run: `cd d:/Github/Emp_Portal_BackEnd && node scripts/run-migration.js database/migrations/create_delegate_access_pg.sql`
Expected: success line, no error.

- [ ] **Step 3: Verify tables exist**

Run: `node -e "import('./config/database.js').then(async({executeQuery})=>{const r=await executeQuery(\"SELECT table_name FROM information_schema.tables WHERE table_name IN ('delegate_access_link','delegate_access_event') ORDER BY table_name\");console.log(JSON.stringify(r));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: JSON listing both tables.

- [ ] **Step 4: Commit**

```bash
git add database/migrations/create_delegate_access_pg.sql
git commit -m "feat(delegate-access): add delegate_access tables migration"
```

---

## Task 2: Pure helpers (`src/utils/delegateAccess.js`) + unit tests

**Files:**
- Create: `src/utils/delegateAccess.js`
- Test: `tests/delegate-access.test.js`

**Interfaces:**
- Produces (used by service in Task 4 and middleware in Task 6):
  - `SELECTABLE_PAGE_KEYS: string[]`
  - `MIN_EXPIRY_DAYS = 10`
  - `hashToken(rawToken) → string` (sha-256 hex)
  - `computeStatus({ revoked_at, expires_at }) → 'active'|'expired'|'revoked'`
  - `maskEmail(email) → string`
  - `pageToPath(key) → string`
  - `validateCreateInput({ employeeId, pages, expiryDays, landingPage }) → { ok:true, cleanPages, landing } | { ok:false, error }`
  - `isDelegateActionRequest(method, path) → boolean`
  - `buildSessionUser(linkRow) → { employeeId, employeeCode, name, email, userType:'DelegateAccess', permissions, delegate:{ linkId, expiresAt, landingPage } }`

- [ ] **Step 1: Write the failing tests**

`tests/delegate-access.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hashToken, computeStatus, maskEmail, pageToPath, validateCreateInput,
  isDelegateActionRequest, buildSessionUser, SELECTABLE_PAGE_KEYS, MIN_EXPIRY_DAYS
} from '../src/utils/delegateAccess.js'

test('hashToken is deterministic 64-hex sha256', () => {
  const h = hashToken('abc')
  assert.match(h, /^[a-f0-9]{64}$/)
  assert.equal(h, hashToken('abc'))
  assert.notEqual(h, hashToken('abd'))
})

test('computeStatus: revoked > expired > active', () => {
  assert.equal(computeStatus({ revoked_at: 'x', expires_at: '2999-01-01' }), 'revoked')
  assert.equal(computeStatus({ revoked_at: null, expires_at: '2000-01-01' }), 'expired')
  assert.equal(computeStatus({ revoked_at: null, expires_at: '2999-01-01' }), 'active')
})

test('maskEmail keeps first 3 local chars', () => {
  assert.equal(maskEmail('abcdef@x.com'), 'abc***@x.com')
  assert.equal(maskEmail('ab@x.com'), 'ab@x.com')
})

test('SELECTABLE_PAGE_KEYS excludes superadmin surfaces', () => {
  for (const k of ['role_permissions', 'manage_delegate_access', 'administration']) {
    assert.equal(SELECTABLE_PAGE_KEYS.includes(k), false)
  }
  assert.equal(SELECTABLE_PAGE_KEYS.includes('requisition_pending'), true)
})

test('validateCreateInput rejects expiry < 10', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 5, landingPage: '/requisition/pending' })
  assert.equal(r.ok, false)
  assert.match(r.error, new RegExp(String(MIN_EXPIRY_DAYS)))
})

test('validateCreateInput rejects empty/invalid pages', () => {
  assert.equal(validateCreateInput({ employeeId: 3, pages: [], expiryDays: 10, landingPage: '/x' }).ok, false)
  assert.equal(validateCreateInput({ employeeId: 3, pages: ['role_permissions'], expiryDays: 10, landingPage: '/x' }).ok, false)
})

test('validateCreateInput rejects landing not among selected pages', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 10, landingPage: '/payroll' })
  assert.equal(r.ok, false)
})

test('validateCreateInput accepts valid input and defaults landing', () => {
  const r = validateCreateInput({ employeeId: 3, pages: ['requisition_pending'], expiryDays: 10, landingPage: null })
  assert.equal(r.ok, true)
  assert.deepEqual(r.cleanPages, ['requisition_pending'])
  assert.equal(r.landing, '/requisition/pending')
})

test('isDelegateActionRequest true only for mutating requisition/leave paths', () => {
  assert.equal(isDelegateActionRequest('POST', '/api/requisition/approve/hod'), true)
  assert.equal(isDelegateActionRequest('PUT', '/api/leave/request/5/status'), true)
  assert.equal(isDelegateActionRequest('GET', '/api/requisition/pending/hod/E1'), false)
  assert.equal(isDelegateActionRequest('POST', '/api/salary/fpin/verify'), false)
})

test('buildSessionUser produces scoped DelegateAccess payload', () => {
  const u = buildSessionUser({
    employee_id: 3, employee_code: 'E3', first_name: 'A', last_name: 'B', email: 'a@b.c',
    pages: ['requisition_pending'], id: 9, expires_at: '2999-01-01', landing_page: '/requisition/pending'
  })
  assert.equal(u.userType, 'DelegateAccess')
  assert.equal(u.employeeId, 3)
  assert.deepEqual(u.permissions, ['requisition_pending'])
  assert.equal(u.delegate.linkId, 9)
  assert.equal(u.delegate.landingPage, '/requisition/pending')
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd d:/Github/Emp_Portal_BackEnd && node --test tests/delegate-access.test.js`
Expected: FAIL — cannot find module `../src/utils/delegateAccess.js`.

- [ ] **Step 3: Write the utils**

`src/utils/delegateAccess.js`:

```js
import crypto from 'crypto'
import { PERMISSION_KEYS } from '../../config/permissions.js'

const EXCLUDED_PAGES = new Set(['role_permissions', 'manage_delegate_access', 'administration'])
export const SELECTABLE_PAGE_KEYS = PERMISSION_KEYS.filter((k) => !EXCLUDED_PAGES.has(k))
export const MIN_EXPIRY_DAYS = 10

const PAGE_PATHS = {
  dashboard: '/dashboard', profile: '/profile', profile_update_requests: '/profile/update-requests',
  salary_slip: '/salary-slip', view_salary_slips: '/view-salary-slips', leave: '/leave-request',
  leave_pending: '/leave-request/pending', feedback: '/feedback', feedback_history: '/feedback/history',
  feedback_records_hr: '/feedback/records', requisition_create: '/requisition', requisition_history: '/requisition/history',
  requisition_acknowledgment: '/requisition/acknowledgment', requisition_pending: '/requisition/pending',
  requisition_approved: '/requisition/approved', requisition_reports: '/requisition/reports',
  requisition_email_diagnostics: '/requisition/email-diagnostics', tat_report: '/tat-report',
  extensions: '/extensions', payroll: '/payroll', payroll_gross_salaries: '/payroll/gross-salaries',
  payroll_other_allowances: '/payroll/other-allowances', payroll_deductions: '/payroll/deductions',
  payroll_incentives: '/payroll/incentives', my_trainings: '/my-trainings', manage_trainings: '/manage-trainings'
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex')
}

export function computeStatus(row) {
  if (row.revoked_at) return 'revoked'
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired'
  return 'active'
}

export function maskEmail(email) {
  const [local, domain] = String(email || '').split('@')
  if (!domain) return email || ''
  const visible = local.slice(0, Math.min(3, local.length))
  return `${visible}${'*'.repeat(Math.max(0, local.length - visible.length))}@${domain}`
}

export function pageToPath(key) { return PAGE_PATHS[key] || '/profile' }

export function validateCreateInput({ employeeId, pages, expiryDays, landingPage }) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return { ok: false, error: 'Valid employeeId required' }
  const cleanPages = Array.isArray(pages) ? pages.filter((p) => SELECTABLE_PAGE_KEYS.includes(p)) : []
  if (cleanPages.length === 0) return { ok: false, error: 'Select at least one valid page' }
  const days = parseInt(expiryDays, 10)
  if (Number.isNaN(days) || days < MIN_EXPIRY_DAYS) return { ok: false, error: `Expiry must be at least ${MIN_EXPIRY_DAYS} days` }
  const landing = landingPage || pageToPath(cleanPages[0])
  if (!cleanPages.some((p) => pageToPath(p) === landing)) return { ok: false, error: 'Landing page must be one of the selected pages' }
  return { ok: true, cleanPages, landing, days, employeeId: eid }
}

const ACTION_PREFIXES = ['/api/requisition', '/api/leave']
export function isDelegateActionRequest(method, path) {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return false
  return ACTION_PREFIXES.some((p) => String(path).startsWith(p))
}

export function buildSessionUser(link) {
  const pages = Array.isArray(link.pages) ? link.pages : JSON.parse(link.pages || '[]')
  return {
    employeeId: link.employee_id,
    employeeCode: link.employee_code || '',
    name: [link.first_name, link.last_name].filter(Boolean).join(' ').trim() || 'Employee',
    email: link.email || '',
    userType: 'DelegateAccess',
    permissions: pages,
    delegate: { linkId: link.id, expiresAt: link.expires_at, landingPage: link.landing_page }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/delegate-access.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/delegateAccess.js tests/delegate-access.test.js
git commit -m "feat(delegate-access): pure helpers + node:test unit tests"
```

---

## Task 3: Repository layer

**Files:**
- Create: `src/repositories/delegateAccess.repository.js`

**Interfaces:**
- Consumes: `executeQuery`; tables from Task 1.
- Produces (used by service in Task 4):
  - `createLink({ tokenHash, employeeId, pages, landingPage, expiresAt, createdBy }) → row`
  - `findByTokenHash(tokenHash) → row|null` (+ joined `first_name,last_name,employee_code,email`)
  - `getLinkById(id) → row|null` (same join)
  - `listLinks() → row[]`
  - `revokeLink(id, revokedBy) → row|null`
  - `updateTokenHash(id, tokenHash) → void`
  - `touchLastUsed(id) → void`
  - `logEvent({ linkId, eventType, ip?, userAgent?, detail? }) → void`
  - `listEvents(linkId) → row[]`

- [ ] **Step 1: Write the repository**

`src/repositories/delegateAccess.repository.js`:

```js
import { executeQuery } from '../../config/database.js'

export async function createLink({ tokenHash, employeeId, pages, landingPage, expiresAt, createdBy }) {
  const rows = await executeQuery(
    `INSERT INTO delegate_access_link (token_hash, employee_id, pages, landing_page, expires_at, created_by)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
    [tokenHash, employeeId, JSON.stringify(pages), landingPage, expiresAt, createdBy]
  )
  return rows[0] || null
}

export async function findByTokenHash(tokenHash) {
  const rows = await executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code, e.email
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     WHERE l.token_hash = $1`, [tokenHash])
  return rows[0] || null
}

export async function getLinkById(id) {
  const rows = await executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code, e.email
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     WHERE l.id = $1`, [id])
  return rows[0] || null
}

export async function listLinks() {
  return executeQuery(
    `SELECT l.*, e.first_name, e.last_name, e.employee_code
     FROM delegate_access_link l JOIN employees e ON e.employee_id = l.employee_id
     ORDER BY l.created_at DESC`)
}

export async function revokeLink(id, revokedBy) {
  const rows = await executeQuery(
    `UPDATE delegate_access_link SET revoked_at = NOW(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL RETURNING *`, [id, revokedBy])
  return rows[0] || null
}

export async function updateTokenHash(id, tokenHash) {
  await executeQuery(`UPDATE delegate_access_link SET token_hash = $2 WHERE id = $1`, [id, tokenHash])
}

export async function touchLastUsed(id) {
  await executeQuery(`UPDATE delegate_access_link SET last_used_at = NOW() WHERE id = $1`, [id])
}

export async function logEvent({ linkId, eventType, ip = null, userAgent = null, detail = null }) {
  await executeQuery(
    `INSERT INTO delegate_access_event (link_id, event_type, ip, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5)`, [linkId, eventType, ip, userAgent, detail])
}

export async function listEvents(linkId) {
  return executeQuery(`SELECT * FROM delegate_access_event WHERE link_id = $1 ORDER BY created_at DESC`, [linkId])
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check src/repositories/delegateAccess.repository.js && echo OK`
Expected: `OK`.

- [ ] **Step 3: Live smoke test against the DB**

Run (uses a real employee_id; picks the smallest existing one, creates → reads → revokes → cleans up):
```bash
node -e "import('./src/repositories/delegateAccess.repository.js').then(async(r)=>{const {executeQuery}=await import('./config/database.js');const emp=await executeQuery('SELECT employee_id FROM employees ORDER BY employee_id LIMIT 1');const eid=emp[0].employee_id;const link=await r.createLink({tokenHash:'smoke_'+Date.now(),employeeId:eid,pages:['requisition_pending'],landingPage:'/requisition/pending',expiresAt:new Date(Date.now()+864e6).toISOString(),createdBy:eid});console.log('created',link.id);const found=await r.getLinkById(link.id);console.log('found status pages',found.pages);await r.logEvent({linkId:link.id,eventType:'opened',ip:'1.1.1.1'});const ev=await r.listEvents(link.id);console.log('events',ev.length);const rev=await r.revokeLink(link.id,eid);console.log('revoked',!!rev.revoked_at);await executeQuery('DELETE FROM delegate_access_link WHERE id=\$1',[link.id]);console.log('cleaned up');process.exit(0)}).catch(e=>{console.error('SMOKE FAIL:',e.message);process.exit(1)})"
```
Expected: prints `created <id>`, `found status pages [ 'requisition_pending' ]`, `events 1`, `revoked true`, `cleaned up`.

- [ ] **Step 4: Commit**

```bash
git add src/repositories/delegateAccess.repository.js
git commit -m "feat(delegate-access): repository layer (verified against live DB)"
```

---

## Task 4: Service layer

**Files:**
- Create: `src/services/delegateAccess.service.js`

**Interfaces:**
- Consumes: utils (Task 2), repository (Task 3), `bcryptjs`, `crypto`, `config/email.js`, `config/crmDatabase.js`.
- Produces (used by controller in Task 5):
  - `createLink({ employeeId, pages, expiryDays, landingPage, createdBy, baseUrl }) → { link, url, emailSent } | { error, status }`
  - `listLinks() → row[]` (each with computed `status`)
  - `revokeLink(id, revokedBy) → { ok } | { error, status }`
  - `resendEmail(id, baseUrl) → { emailSent, url } | { error, status }`
  - `listEvents(id) → row[]`
  - `openLink({ rawToken, ip, userAgent }) → { maskedEmail } | { error, status }`
  - `verifyOtp({ rawToken, otp, ip, userAgent }) → { sessionUser, cookieMaxAgeMs } | { error, status }`

- [ ] **Step 1: Write the service**

`src/services/delegateAccess.service.js`:

```js
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import * as repo from '../repositories/delegateAccess.repository.js'
import {
  hashToken, computeStatus, maskEmail, pageToPath, validateCreateInput, buildSessionUser
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
  const to = await targetEmailFor(link)
  if (isEmailConfigured() && to) {
    const transport = getEmailTransport()
    if (transport) await transport.sendMail({ from: EMAIL_FROM, to, subject: `${code} is your access code — ${APP_NAME || 'Employee Portal'}`, text: `Your one-time access code is ${code}. It expires in 10 minutes.` })
      .catch((e) => console.error('[DelegateAccess] OTP email failed:', e.message))
  }
  await repo.logEvent({ linkId: link.id, eventType: 'otp_sent', detail: maskEmail(to) })
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
  const ok = await bcrypt.compare(String(otp).trim(), entry.codeHash)
  if (!ok) {
    entry.attempts += 1
    await repo.logEvent({ linkId: link.id, eventType: 'otp_failed', ip, userAgent })
    return { error: `Invalid code. ${Math.max(0, OTP_MAX_ATTEMPTS - entry.attempts)} attempt(s) left.`, status: 401 }
  }
  otpStore.delete(tokenHash)
  await repo.touchLastUsed(link.id)
  await repo.logEvent({ linkId: link.id, eventType: 'otp_verified', ip, userAgent })
  return { sessionUser: buildSessionUser(link), cookieMaxAgeMs: Math.max(60 * 1000, new Date(link.expires_at).getTime() - Date.now()) }
}
```

- [ ] **Step 2: Syntax check + import check**

Run: `node --check src/services/delegateAccess.service.js && node -e "import('./src/services/delegateAccess.service.js').then(m=>{console.log('exports:',Object.keys(m).sort().join(','));process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"`
Expected: `OK`-equivalent; exports include `createLink,listEvents,listLinks,openLink,resendEmail,revokeLink,verifyOtp`.

- [ ] **Step 3: Commit**

```bash
git add src/services/delegateAccess.service.js
git commit -m "feat(delegate-access): service layer (tokens, OTP, email, session payload)"
```

---

## Task 5: Controller + routes + permission key + mount

**Files:**
- Create: `src/controllers/delegateAccess.controller.js`
- Create: `src/routes/delegateAccess.routes.js`
- Modify: `src/routes/index.js`, `app.js`, `config/permissions.js`

- [ ] **Step 1: Add the permission key**

Modify `config/permissions.js` — change the last array line to:
```js
  'my_trainings', 'manage_trainings', 'manage_delegate_access'
```

- [ ] **Step 2: Write the controller**

`src/controllers/delegateAccess.controller.js`:

```js
import * as svc from '../services/delegateAccess.service.js'

function isSuperAdmin(req) { return req.session?.user?.userType === 'SuperAdmin' }
function portalBase(req) { return (process.env.PORTAL_PUBLIC_URL || '').replace(/\/$/, '') || `${req.protocol}://${req.get('host')}` }
function clientIp(req) { return (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim() }

export async function create(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const { employeeId, pages, expiryDays, landingPage } = req.body
    const r = await svc.createLink({ employeeId, pages, expiryDays, landingPage, createdBy: req.session.user.employeeId, baseUrl: portalBase(req) })
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate create error:', e); res.status(500).json({ error: 'Failed to create link' }) }
}

export async function list(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try { res.json(await svc.listLinks()) } catch (e) { console.error('Delegate list error:', e); res.status(500).json({ error: 'Failed to list links' }) }
}

export async function revoke(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const r = await svc.revokeLink(req.params.id, req.session.user.employeeId)
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json({ message: 'Link revoked' })
  } catch (e) { console.error('Delegate revoke error:', e); res.status(500).json({ error: 'Failed to revoke' }) }
}

export async function resend(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try {
    const r = await svc.resendEmail(req.params.id, portalBase(req))
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate resend error:', e); res.status(500).json({ error: 'Failed to resend' }) }
}

export async function events(req, res) {
  if (!isSuperAdmin(req)) return res.status(403).json({ error: 'Forbidden' })
  try { res.json(await svc.listEvents(req.params.id)) } catch (e) { console.error('Delegate events error:', e); res.status(500).json({ error: 'Failed to load events' }) }
}

export async function open(req, res) {
  try {
    const { token } = req.body
    if (!token) return res.status(400).json({ error: 'token required' })
    const r = await svc.openLink({ rawToken: String(token).trim(), ip: clientIp(req), userAgent: req.headers['user-agent'] || '' })
    if (r.error) return res.status(r.status).json({ error: r.error })
    res.json(r)
  } catch (e) { console.error('Delegate open error:', e); res.status(500).json({ error: 'Failed to open link' }) }
}

export async function verify(req, res) {
  try {
    const { token, otp } = req.body
    if (!token || !otp) return res.status(400).json({ error: 'token and otp required' })
    const r = await svc.verifyOtp({ rawToken: String(token).trim(), otp, ip: clientIp(req), userAgent: req.headers['user-agent'] || '' })
    if (r.error) return res.status(r.status).json({ error: r.error })
    req.session.user = r.sessionUser
    req.session.cookie.maxAge = r.cookieMaxAgeMs
    await new Promise((resolve, reject) => req.session.save((err) => (err ? reject(err) : resolve())))
    res.json(r.sessionUser)
  } catch (e) { console.error('Delegate verify error:', e); res.status(500).json({ error: 'Failed to verify code' }) }
}
```

- [ ] **Step 3: Write the routes**

`src/routes/delegateAccess.routes.js`:

```js
import express from 'express'
import * as ctrl from '../controllers/delegateAccess.controller.js'

const router = express.Router()

// Public (token-authenticated) entry
router.post('/open', ctrl.open)
router.post('/verify', ctrl.verify)

// SuperAdmin management
router.get('/', ctrl.list)
router.post('/', ctrl.create)
router.delete('/:id', ctrl.revoke)
router.post('/:id/resend', ctrl.resend)
router.get('/:id/events', ctrl.events)

export default router
```

- [ ] **Step 4: Wire exports + mount**

Modify `src/routes/index.js` — append:
```js
export { default as delegateAccessRoutes } from './delegateAccess.routes.js'
```

Modify `app.js` — add `delegateAccessRoutes` to the `import { ... } from './src/routes/index.js'` group, and mount after the `ted` mount (line ~155):
```js
app.use('/api/delegate-access', delegateAccessRoutes)
```

- [ ] **Step 5: Syntax check**

Run: `node --check src/controllers/delegateAccess.controller.js && node --check src/routes/delegateAccess.routes.js && node --check app.js && echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/controllers/delegateAccess.controller.js src/routes/delegateAccess.routes.js src/routes/index.js app.js config/permissions.js
git commit -m "feat(delegate-access): controller, routes, mount, permission key"
```

---

## Task 6: `delegateSession` middleware

**Files:**
- Create: `src/middleware/delegateSession.js`
- Modify: `app.js` (mount after `ssoRevocationMiddleware`)

**Interfaces:**
- Consumes: `repo.getLinkById`, `repo.logEvent`, `repo.touchLastUsed`; utils `computeStatus`, `isDelegateActionRequest`.
- Produces: default export `delegateSessionMiddleware(req, res, next)`.

- [ ] **Step 1: Write the middleware**

`src/middleware/delegateSession.js`:

```js
import * as repo from '../repositories/delegateAccess.repository.js'
import { computeStatus, isDelegateActionRequest } from '../utils/delegateAccess.js'

export default async function delegateSessionMiddleware(req, res, next) {
  const del = req.session?.user?.delegate
  if (!req.session?.user || req.session.user.userType !== 'DelegateAccess' || !del) return next()
  try {
    const link = await repo.getLinkById(del.linkId)
    if (!link || computeStatus(link) !== 'active') {
      return req.session.destroy(() => {
        if (req.path.startsWith('/api')) return res.status(401).json({ error: 'Delegate access ended' })
        res.redirect('/login')
      })
    }
    if (isDelegateActionRequest(req.method, req.path)) {
      await repo.touchLastUsed(link.id)
      await repo.logEvent({ linkId: link.id, eventType: 'action', detail: `${req.method} ${req.path}` })
    }
    next()
  } catch (e) {
    console.error('delegateSession middleware error:', e.message)
    next()
  }
}
```

- [ ] **Step 2: Mount the middleware**

Modify `app.js` — add import near other middleware imports:
```js
import delegateSessionMiddleware from './src/middleware/delegateSession.js'
```
and mount immediately after `app.use(ssoRevocationMiddleware)`:
```js
app.use(delegateSessionMiddleware)
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/middleware/delegateSession.js && node --check app.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Commit**

```bash
git add src/middleware/delegateSession.js app.js
git commit -m "feat(delegate-access): session-validity + action-audit middleware"
```

---

## Task 7: Frontend API group + selectable-page constants

**Files:**
- Modify: `d:\Github\Emp_Portal_FrontEnd\src\services\api.js`
- Create: `d:\Github\Emp_Portal_FrontEnd\src\constants\delegatePages.js`

- [ ] **Step 1: Add the API group**

Modify `src/services/api.js` — add near the other exported API groups:

```js
export const delegateAccessAPI = {
  list: () => apiCall('/delegate-access'),
  create: (data) => apiCall('/delegate-access', { method: 'POST', body: JSON.stringify(data) }),
  revoke: (id) => apiCall(`/delegate-access/${id}`, { method: 'DELETE' }),
  resend: (id) => apiCall(`/delegate-access/${id}/resend`, { method: 'POST' }),
  events: (id) => apiCall(`/delegate-access/${id}/events`),
  open: (token) => apiCall('/delegate-access/open', { method: 'POST', body: JSON.stringify({ token }) }),
  verify: (token, otp) => apiCall('/delegate-access/verify', { method: 'POST', body: JSON.stringify({ token, otp }) })
}
```

- [ ] **Step 2: Add the selectable-page constants**

`src/constants/delegatePages.js` — the same `{ key, label, path }` list as the backend `PAGE_PATHS`/`SELECTABLE_PAGE_KEYS` (verify each `path` against `src/App.jsx` route definitions during implementation; App.jsx is the source of truth):

```js
export const DELEGATE_PAGES = [
  { key: 'dashboard', label: 'Dashboard', path: '/dashboard' },
  { key: 'profile', label: 'Profile', path: '/profile' },
  { key: 'profile_update_requests', label: 'Profile Update Requests', path: '/profile/update-requests' },
  { key: 'salary_slip', label: 'Salary Slip', path: '/salary-slip' },
  { key: 'view_salary_slips', label: 'View Salary Slips (HR)', path: '/view-salary-slips' },
  { key: 'leave', label: 'Leave Request', path: '/leave-request' },
  { key: 'leave_pending', label: 'Pending Leave', path: '/leave-request/pending' },
  { key: 'feedback', label: 'Feedback', path: '/feedback' },
  { key: 'feedback_history', label: 'Feedback History', path: '/feedback/history' },
  { key: 'feedback_records_hr', label: 'Feedback Records (HR)', path: '/feedback/records' },
  { key: 'requisition_create', label: 'Create Requisition', path: '/requisition' },
  { key: 'requisition_history', label: 'Requisition History', path: '/requisition/history' },
  { key: 'requisition_acknowledgment', label: 'Requisition Acknowledgment', path: '/requisition/acknowledgment' },
  { key: 'requisition_pending', label: 'Pending Requisition', path: '/requisition/pending' },
  { key: 'requisition_approved', label: 'Approved Requisition', path: '/requisition/approved' },
  { key: 'requisition_reports', label: 'Requisition Reports', path: '/requisition/reports' },
  { key: 'requisition_email_diagnostics', label: 'Requisition Email Diagnostics', path: '/requisition/email-diagnostics' },
  { key: 'tat_report', label: 'TAT Report', path: '/tat-report' },
  { key: 'extensions', label: 'Extensions', path: '/extensions' },
  { key: 'payroll', label: 'Payroll', path: '/payroll' },
  { key: 'payroll_gross_salaries', label: 'Payroll — Gross Salaries', path: '/payroll/gross-salaries' },
  { key: 'payroll_other_allowances', label: 'Payroll — Other Allowances', path: '/payroll/other-allowances' },
  { key: 'payroll_deductions', label: 'Payroll — Deductions', path: '/payroll/deductions' },
  { key: 'payroll_incentives', label: 'Payroll — Incentives', path: '/payroll/incentives' },
  { key: 'my_trainings', label: 'My Trainings', path: '/my-trainings' },
  { key: 'manage_trainings', label: 'Manage Trainings', path: '/manage-trainings' }
]
```

- [ ] **Step 3: Verify build**

Run: `cd d:/Github/Emp_Portal_FrontEnd && npx vite build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/services/api.js src/constants/delegatePages.js
git commit -m "feat(delegate-access): frontend API group + selectable page constants"
```

---

## Task 8: `EmployeeContext` DelegateAccess permission branch

**Files:**
- Modify: `d:\Github\Emp_Portal_FrontEnd\src\context\EmployeeContext.jsx`

- [ ] **Step 1: Read the current `hasPermission`**

Run: `sed -n '200,225p' src/context/EmployeeContext.jsx` — confirm the SuperAdmin-first branch.

- [ ] **Step 2: Add the DelegateAccess branch as the first check in `hasPermission`**

```js
  const hasPermission = (permissionKey) => {
    // Delegate/holiday sessions are strictly scoped to their granted pages — no bypass.
    if (userType === 'DelegateAccess') {
      return Array.isArray(permissions) && permissions.includes(permissionKey)
    }
    if (userType === 'SuperAdmin') return true
    // …existing logic unchanged…
```

- [ ] **Step 3: Verify build**

Run: `cd d:/Github/Emp_Portal_FrontEnd && npx vite build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/context/EmployeeContext.jsx
git commit -m "feat(delegate-access): scope DelegateAccess sessions in hasPermission"
```

---

## Task 9: Public `/delegate/:token` entry page

**Files:**
- Create: `d:\Github\Emp_Portal_FrontEnd\src\pages\DelegateEntry.jsx`
- Modify: `d:\Github\Emp_Portal_FrontEnd\src\App.jsx`

- [ ] **Step 1: Write the entry component**

`src/pages/DelegateEntry.jsx`:

```jsx
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { delegateAccessAPI } from '../services/api'
import { useEmployee } from '../context/EmployeeContext'

export default function DelegateEntry() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { setEmployeeId, setEmployeeCode, setUserType, setPermissions, setIsAuthenticated } = useEmployee()
  const [phase, setPhase] = useState('opening')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    delegateAccessAPI.open(token)
      .then((r) => { if (!cancelled) { setMaskedEmail(r.maskedEmail || ''); setPhase('otp') } })
      .catch((e) => { if (!cancelled) { setErrorMsg(e?.message || 'This link is invalid or has expired.'); setPhase('error') } })
    return () => { cancelled = true }
  }, [token])

  const submit = async (e) => {
    e.preventDefault()
    const code = otp.replace(/\D/g, '').slice(0, 6)
    if (code.length !== 6) { toast.error('Enter the 6-digit code'); return }
    setSubmitting(true)
    try {
      const user = await delegateAccessAPI.verify(token, code)
      setEmployeeId(user.employeeId); setEmployeeCode(user.employeeCode)
      setUserType(user.userType); setPermissions(user.permissions || []); setIsAuthenticated(true)
      localStorage.setItem('sessionLoginAt', String(Date.now()))
      navigate(user?.delegate?.landingPage || '/requisition/pending', { replace: true })
    } catch (err) { toast.error(err?.message || 'Invalid code') }
    finally { setSubmitting(false) }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 420, background: '#fff', borderRadius: 16, boxShadow: '0 10px 30px rgba(0,0,0,.1)', padding: 32 }}>
        <img src="/logo.png" alt="iTecknologi" style={{ height: 44, display: 'block', margin: '0 auto 18px' }} onError={(e) => { e.target.style.display = 'none' }} />
        {phase === 'opening' && <p style={{ textAlign: 'center', color: '#475569' }}>Opening your access link…</p>}
        {phase === 'error' && <p style={{ textAlign: 'center', color: '#b91c1c' }}>{errorMsg}</p>}
        {phase === 'otp' && (
          <form onSubmit={submit}>
            <h2 style={{ textAlign: 'center', margin: '0 0 6px', color: '#1e40af' }}>Temporary Access</h2>
            <p style={{ textAlign: 'center', color: '#64748b', fontSize: 14, marginTop: 0 }}>Enter the 6-digit code sent to <strong>{maskedEmail}</strong>.</p>
            <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={6} placeholder="••••••" autoFocus
              style={{ width: '100%', textAlign: 'center', letterSpacing: 8, fontSize: 24, padding: '12px 0', border: '1px solid #cbd5e1', borderRadius: 10, margin: '10px 0 16px' }} />
            <button type="submit" disabled={submitting} style={{ width: '100%', background: '#1e40af', color: '#fff', border: 0, borderRadius: 10, padding: '12px 0', fontWeight: 700, cursor: 'pointer' }}>
              {submitting ? 'Verifying…' : 'Continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Register the public route**

Modify `src/App.jsx` — import `import DelegateEntry from './pages/DelegateEntry'` and add, OUTSIDE `ProtectedRoute` (near `/cards`):
```jsx
<Route path="/delegate/:token" element={<DelegateEntry />} />
```

- [ ] **Step 3: Verify build**

Run: `cd d:/Github/Emp_Portal_FrontEnd && npx vite build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/DelegateEntry.jsx src/App.jsx
git commit -m "feat(delegate-access): public /delegate/:token OTP entry page"
```

---

## Task 10: SuperAdmin management page + nav/guard wiring

**Files:**
- Create: `d:\Github\Emp_Portal_FrontEnd\src\pages\DelegateAccessLinks.jsx` + `.css`
- Modify: `src\App.jsx`, `src\components\DashboardLayout.jsx`

- [ ] **Step 1: Write the management page**

`src/pages/DelegateAccessLinks.jsx` — (full component; employee search reuses existing `payrollAPI.searchEmployees`):

```jsx
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { delegateAccessAPI, payrollAPI } from '../services/api'
import { DELEGATE_PAGES } from '../constants/delegatePages'
import { useEmployee } from '../context/EmployeeContext'
import './DelegateAccessLinks.css'

export default function DelegateAccessLinks() {
  const { userType } = useEmployee()
  const navigate = useNavigate()
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [term, setTerm] = useState('')
  const [empOptions, setEmpOptions] = useState([])
  const [employeeId, setEmployeeId] = useState('')
  const [selectedPages, setSelectedPages] = useState([])
  const [landingPage, setLandingPage] = useState('/requisition/pending')
  const [expiryDays, setExpiryDays] = useState(10)
  const [creating, setCreating] = useState(false)
  const [eventsFor, setEventsFor] = useState(null)
  const [events, setEvents] = useState([])

  useEffect(() => { if (userType !== 'SuperAdmin') navigate('/dashboard', { replace: true }) }, [userType, navigate])

  const load = useCallback(async () => {
    setLoading(true)
    try { setLinks(await delegateAccessAPI.list()) }
    catch (e) { toast.error(e?.message || 'Failed to load links') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!term.trim()) { setEmpOptions([]); return }
      try { setEmpOptions(await payrollAPI.searchEmployees(term.trim(), 50)) } catch { setEmpOptions([]) }
    }, 350)
    return () => clearTimeout(t)
  }, [term])

  const togglePage = (key) => setSelectedPages((p) => p.includes(key) ? p.filter((k) => k !== key) : [...p, key])
  const selectedPaths = DELEGATE_PAGES.filter((p) => selectedPages.includes(p.key))

  const create = async (e) => {
    e.preventDefault()
    if (!employeeId) return toast.error('Select an employee')
    if (selectedPages.length === 0) return toast.error('Select at least one page')
    if (Number(expiryDays) < 10) return toast.error('Expiry must be at least 10 days')
    if (!selectedPaths.some((p) => p.path === landingPage)) return toast.error('Landing page must be one of the selected pages')
    setCreating(true)
    try {
      const r = await delegateAccessAPI.create({ employeeId: Number(employeeId), pages: selectedPages, expiryDays: Number(expiryDays), landingPage })
      if (r.emailSent) toast.success('Link created and emailed')
      else { toast('Link created — email not sent, copy the URL', { icon: '⚠️' }); window.prompt('Copy the access link:', r.url) }
      setEmployeeId(''); setTerm(''); setSelectedPages([]); setExpiryDays(10); setLandingPage('/requisition/pending')
      load()
    } catch (err) { toast.error(err?.message || 'Failed to create link') }
    finally { setCreating(false) }
  }

  const revoke = async (id) => {
    if (!window.confirm('Revoke this access link? It stops working immediately.')) return
    try { await delegateAccessAPI.revoke(id); toast.success('Revoked'); load() } catch (e) { toast.error(e?.message || 'Failed to revoke') }
  }
  const resend = async (id) => {
    try { const r = await delegateAccessAPI.resend(id); r.emailSent ? toast.success('Re-emailed') : window.prompt('Copy the new link:', r.url); load() }
    catch (e) { toast.error(e?.message || 'Failed to resend') }
  }
  const showEvents = async (id) => { setEventsFor(id); try { setEvents(await delegateAccessAPI.events(id)) } catch { setEvents([]) } }

  if (userType !== 'SuperAdmin') return null

  return (
    <div className="delegate-page">
      <div className="page-header"><h1>Holiday Access Links</h1>
        <p className="page-subtitle">Issue a time-limited, OTP-protected link so an approver on leave can still action their pages.</p></div>

      <div className="delegate-card">
        <h2>Create link</h2>
        <form className="delegate-form" onSubmit={create}>
          <label>Employee
            <input className="input" placeholder="Search name or code…" value={term} onChange={(e) => setTerm(e.target.value)} />
            {empOptions.length > 0 && (
              <select className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">— Select —</option>
                {empOptions.map((o) => <option key={o.id} value={o.id}>{o.first_name} {o.last_name} ({o.code})</option>)}
              </select>
            )}
          </label>
          <label>Expiry (days, min 10)
            <input className="input" type="number" min={10} value={expiryDays} onChange={(e) => setExpiryDays(e.target.value)} />
          </label>
          <fieldset className="delegate-pages">
            <legend>Pages this link can access</legend>
            {DELEGATE_PAGES.map((p) => (
              <label key={p.key} className="delegate-page-check">
                <input type="checkbox" checked={selectedPages.includes(p.key)} onChange={() => togglePage(p.key)} /> {p.label}
              </label>
            ))}
          </fieldset>
          <label>Landing page
            <select className="input" value={landingPage} onChange={(e) => setLandingPage(e.target.value)}>
              {selectedPaths.length === 0 ? <option value="">— select pages first —</option>
                : selectedPaths.map((p) => <option key={p.key} value={p.path}>{p.label}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create & Email'}</button>
        </form>
      </div>

      <div className="delegate-card">
        <h2>Existing links</h2>
        {loading ? <p>Loading…</p> : links.length === 0 ? <p>No links yet.</p> : (
          <table className="delegate-table">
            <thead><tr><th>Employee</th><th>Pages</th><th>Expires</th><th>Status</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>{l.first_name} {l.last_name} ({l.employee_code})</td>
                  <td>{(Array.isArray(l.pages) ? l.pages : JSON.parse(l.pages || '[]')).length} page(s)</td>
                  <td>{new Date(l.expires_at).toLocaleDateString()}</td>
                  <td><span className={`delegate-status delegate-status--${l.status}`}>{l.status}</span></td>
                  <td>{l.last_used_at ? new Date(l.last_used_at).toLocaleString() : '—'}</td>
                  <td className="delegate-actions">
                    {l.status === 'active' && <><button onClick={() => resend(l.id)}>Resend</button><button onClick={() => revoke(l.id)}>Revoke</button></>}
                    <button onClick={() => showEvents(l.id)}>Log</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {eventsFor != null && (
        <div className="delegate-overlay" onClick={() => setEventsFor(null)}>
          <div className="delegate-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Usage log</h3>
            {events.length === 0 ? <p>No events.</p> : (
              <ul className="delegate-events">
                {events.map((ev) => <li key={ev.id}><strong>{ev.event_type}</strong> · {new Date(ev.created_at).toLocaleString()} {ev.detail ? `· ${ev.detail}` : ''}</li>)}
              </ul>
            )}
            <button className="btn btn-secondary" onClick={() => setEventsFor(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write minimal CSS**

`src/pages/DelegateAccessLinks.css`:

```css
.delegate-card { background: var(--surface); border: 1px solid var(--border-light); border-radius: var(--radius-lg); padding: 20px; margin-bottom: 20px; }
.delegate-form { display: grid; gap: 14px; max-width: 640px; }
.delegate-form label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
.delegate-pages { border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.delegate-pages legend { font-size: 13px; font-weight: 600; color: var(--text-muted); padding: 0 6px; }
.delegate-page-check { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.delegate-table { width: 100%; border-collapse: collapse; }
.delegate-table th, .delegate-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border-light); font-size: 14px; }
.delegate-actions { display: flex; gap: 8px; }
.delegate-actions button { padding: 4px 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--surface); cursor: pointer; font-size: 13px; }
.delegate-status { padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; text-transform: capitalize; }
.delegate-status--active { background: #dcfce7; color: #166534; }
.delegate-status--expired { background: #fef9c3; color: #854d0e; }
.delegate-status--revoked { background: #fee2e2; color: #991b1b; }
.delegate-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
.delegate-modal { background: var(--surface); border-radius: var(--radius-lg); padding: 24px; max-width: 520px; width: 90%; max-height: 80vh; overflow: auto; }
.delegate-events { list-style: none; padding: 0; margin: 0 0 16px; display: grid; gap: 6px; font-size: 13px; }
```

- [ ] **Step 3: Register the protected route**

Modify `src/App.jsx` — import `import DelegateAccessLinks from './pages/DelegateAccessLinks'` and add a child route under the `DashboardLayout` tree:
```jsx
<Route path="delegate-access" element={<DelegateAccessLinks />} />
```

- [ ] **Step 4: Add nav item + guard**

Modify `src/components/DashboardLayout.jsx`:
- In `menuItems`, near the "Role Permissions" superadmin item, add:
  ```js
  { path: '/delegate-access', label: 'Holiday Access', icon: <KeyRound size={18} />, permission: 'superadmin_only' },
  ```
  (import `KeyRound` from `lucide-react`; if unavailable, reuse an existing icon already imported in the file.)
- In `canAccessPath`, add a special case (mirror `/role-permissions`):
  ```js
  if (path === '/delegate-access') return userType === 'SuperAdmin'
  ```

- [ ] **Step 5: Verify build**

Run: `cd d:/Github/Emp_Portal_FrontEnd && npx vite build 2>&1 | tail -2`
Expected: `✓ built`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DelegateAccessLinks.jsx src/pages/DelegateAccessLinks.css src/App.jsx src/components/DashboardLayout.jsx
git commit -m "feat(delegate-access): SuperAdmin management page + nav/route/guard"
```

---

## Task 11: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Backend unit tests pass**

Run: `cd d:/Github/Emp_Portal_BackEnd && node --test tests/delegate-access.test.js`
Expected: all PASS.

- [ ] **Step 2: Manual API flow (logged-in SuperAdmin cookie)**

1. `POST /api/delegate-access` `{ employeeId:<approver id>, pages:['requisition_pending'], expiryDays:10, landingPage:'/requisition/pending' }` → `{ link, url, emailSent }`.
2. Take the raw token from `url`. `POST /api/delegate-access/open` `{ token }` → `{ maskedEmail }`; OTP arrives (or read from dev server logs).
3. `POST /api/delegate-access/verify` `{ token, otp }` → scoped user; `emp.portal.sid` cookie set.
4. With that cookie, `GET /api/auth/me` → `userType:'DelegateAccess'`, `permissions:['requisition_pending']`.
5. `DELETE /api/delegate-access/:id` (SuperAdmin) → next `/api` call on the delegate cookie returns 401.

Expected: each step as described.

- [ ] **Step 3: Manual SPA flow**

1. As SuperAdmin, open `/delegate-access`, create a link with Pending Requisition selected.
2. Open `/delegate/<token>` in a fresh browser profile → enter OTP → lands on `/requisition/pending`.
3. Navigate to a non-selected page (`/payroll`) → redirected to `/profile` (guard works).
4. Back as SuperAdmin, revoke the link → delegate's next action bounces to `/login`.

Expected: all pass; note any deviation.

- [ ] **Step 4: Final commit (if fixups)**

```bash
git add -A
git commit -m "test(delegate-access): end-to-end verification fixups"
```

---

## Self-Review

- **Spec coverage:** migration (T1), pure logic + tests (T2), repository (T3), service incl. token/OTP/email/status/validation/session (T4), controller+routes+permissions+mount (T5), revoke+audit middleware (T6), frontend API+constants (T7), scoped hasPermission (T8), public entry (T9), SuperAdmin page+nav+guard (T10), E2E incl. "only selected pages" + immediate revoke (T11). All spec sections mapped.
- **Testing matches repo convention:** `node --test` on pure utils only; no vitest/jest; DB/email/session covered by live smoke (T3) + E2E (T11), consistent with existing `tests/`.
- **Type consistency:** `buildSessionUser` output shape (T2) === assigned in controller (T5) === consumed by DelegateEntry setters (T9) === read by `hasPermission` (T8). `computeStatus`/`isDelegateActionRequest` shared by service (T4) and middleware (T6). `delegateAccessAPI` method names identical across T7/T9/T10. Repo signatures (T3) match service calls (T4) and middleware calls (T6), incl. `updateTokenHash` used by `resendEmail`.
- **Placeholder scan:** no TBD/TODO; every code step has full code. `DELEGATE_PAGES` paths carry a verify-against-App.jsx note.
