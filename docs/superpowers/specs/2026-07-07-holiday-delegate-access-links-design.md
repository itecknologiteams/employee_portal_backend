# Holiday Delegate Access Links — Design

**Date:** 2026-07-07
**Status:** Approved (design), pending implementation plan
**Repos:** `Emp_Portal_BackEnd` (Express/PG), `Emp_Portal_FrontEnd` (React/Vite)

## Problem

When an approver (HOD, HR, IT, Committee, CEO, Admin, Finance, Procurement) goes on
holiday, requisitions that require their approval stall — the flow cannot advance
without their action. SuperAdmin needs a way to give that approver (or whoever they
authorize) temporary, scoped access to act on their pending items while away.

## Solution overview

SuperAdmin issues a **time-limited access link** for a selected employee. When the
link is opened, the holder proves control of the employee's email via a **one-time
OTP**, then receives a **scoped browser session that acts as that employee**, limited
to the pages SuperAdmin selected. Approvals are recorded under the employee's own name
so the blocked flow proceeds. All link lifecycle and usage is audited.

### Decisions (locked)
1. **Identity:** the link acts **as the selected employee** — a scoped stand-in login.
   Their approvals record under their own name. Not a separate "on-behalf" delegate.
2. **Authentication:** **link + one-time OTP** on first open (link alone is not enough).
3. **Selectable pages:** **any portal page**, SuperAdmin picks — with one safety
   exclusion: SuperAdmin-only management surfaces (`role_permissions`,
   `manage_delegate_access`, `administration`) are NOT offered in the checklist, so a
   scoped holiday link can never hand out admin control. Every other `PERMISSION_KEYS`
   entry is selectable.
4. **Audit:** yes — link lifecycle + activation + per-action events, visible to SuperAdmin.
5. **Session lifetime:** after OTP verify, the scoped session stays valid until the
   link's `expires_at` (OTP entered once, not daily). Revoke/expiry cut it off
   immediately via a per-request middleware check.

### Reused precedents
- **CRM SSO consume flow** (`config/crmSso.js`, `auth.controller.js#ssoConsume`) — token
  issue/consume + session establishment + safe redirect.
- **FPIN reset OTP** (`salary.service.js#requestFpinReset`) — hashed OTP in an in-memory
  Map, 10-min expiry, 5-attempt lockout, CID-logo HTML email to the official CRM email,
  masked address in the response.
- **`canAccessPath` guard** (`DashboardLayout.jsx`) — enforces "only selected pages" for
  free by keying route access off the session `permissions` array.

## Data model

New migration: `database/migrations/create_delegate_access_pg.sql` (Postgres,
`CREATE TABLE IF NOT EXISTS`, indexes, trailing `SELECT '...' AS message;`).

### `delegate_access_link`
| column | type | notes |
|---|---|---|
| `id` | SERIAL PK | |
| `token_hash` | VARCHAR(64) UNIQUE NOT NULL | sha-256 hex of the random URL token; raw token never stored |
| `employee_id` | INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE | the approver the link acts as |
| `pages` | JSONB NOT NULL | array of permission keys selected by SuperAdmin |
| `landing_page` | VARCHAR(120) NOT NULL | route to land on (default `/requisition/pending`; must be within `pages`) |
| `expires_at` | TIMESTAMPTZ NOT NULL | now + expiryDays (min 10) |
| `created_by` | INTEGER NOT NULL | SuperAdmin employee_id |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |
| `revoked_at` | TIMESTAMPTZ NULL | |
| `revoked_by` | INTEGER NULL | |
| `last_used_at` | TIMESTAMPTZ NULL | updated on OTP verify + on each delegate action |

Indexes: `token_hash` (unique), `employee_id`, `expires_at`.

### `delegate_access_event` (audit)
| column | type | notes |
|---|---|---|
| `id` | SERIAL PK | |
| `link_id` | INTEGER NOT NULL REFERENCES delegate_access_link(id) ON DELETE CASCADE | |
| `event_type` | VARCHAR(24) NOT NULL | `created` / `email_sent` / `opened` / `otp_sent` / `otp_verified` / `otp_failed` / `action` / `revoked` |
| `ip` | VARCHAR(64) NULL | |
| `user_agent` | TEXT NULL | |
| `detail` | TEXT NULL | e.g. the request method+path for `action` events |
| `created_at` | TIMESTAMPTZ DEFAULT NOW() | |

Index: `link_id`.

**OTP** is not stored in the DB — it lives in an in-memory `Map` keyed by `token_hash`,
holding `{ codeHash, expiresAt, attempts }`, 10-minute expiry, 5-attempt lockout
(mirrors `salary.service.js` FPIN reset). One backend instance is assumed (same as the
existing FPIN reset store).

## Backend

New files, following the existing `route → controller → service → repository` layering:
- `src/routes/delegateAccess.routes.js` (mounted at `/api/delegate-access` in `app.js`, exported via `src/routes/index.js`)
- `src/controllers/delegateAccess.controller.js`
- `src/services/delegateAccess.service.js`
- `src/repositories/delegateAccess.repository.js`
- `src/middleware/delegateSession.js` (per-request validity check + action logging)
- `database/migrations/create_delegate_access_pg.sql`
- `config/permissions.js`: add `manage_delegate_access` key (SuperAdmin bypasses anyway; added for completeness/consistency).

### Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/delegate-access` | SuperAdmin | Create link: `{ employeeId, pages[], expiryDays, landingPage? }`. Generates token, stores hash, emails link. Returns link row (+ raw URL for the manual-copy fallback). |
| GET | `/api/delegate-access` | SuperAdmin | List links with computed status (active/expired/revoked), employee, pages, expiry, last used. |
| DELETE | `/api/delegate-access/:id` | SuperAdmin | Revoke (sets `revoked_at`/`revoked_by`, logs event). |
| POST | `/api/delegate-access/:id/resend` | SuperAdmin | Re-email the link (does not change the token). |
| GET | `/api/delegate-access/:id/events` | SuperAdmin | Usage/audit log for one link. |
| POST | `/api/delegate-access/open` | Public | `{ token }` → validate active+unexpired → send OTP to employee's official email → return `{ maskedEmail }`, log `opened`+`otp_sent`. |
| POST | `/api/delegate-access/verify` | Public | `{ token, otp }` → validate OTP → build scoped session → return user payload, log `otp_verified`; on wrong OTP log `otp_failed`. |

SuperAdmin gate: `req.session.user.userType === 'SuperAdmin'` (same check used by `ted.controller.js`), plus reject when there is no session user (401).

### Scoped session shape (`/verify`)
```js
req.session.user = {
  employeeId,            // the selected employee — approvals act as them
  employeeCode, name, email, department, position,
  userType: 'DelegateAccess',   // NEW non-privileged type: never bypasses permission checks
  permissions: pages,           // selected page keys only
  delegate: { linkId, expiresAt, landingPage }
}
```
Using a dedicated `DelegateAccess` userType guarantees the "only selected pages"
restriction even if the underlying employee is normally a SuperAdmin (no bypass).
Because approvals act on the employee's `employeeId`/`employeeCode`, the employee's
real approval authority (e.g. `isHrMember`) still governs what the action can do — the
page list only scopes navigation/visibility.

**Session lifetime:** on `/verify`, set `req.session.cookie.maxAge = expiresAt - now`
(express-session supports per-session cookie maxAge) so the cookie lives until the link
expires and the OTP is entered only once. The `delegateSession` middleware still
re-checks link validity on every request, so revoke/expiry cut access off immediately
regardless of the cookie.

### `delegateSession` middleware
Mounted on `/api` (after session, near `ssoRevocationMiddleware`). When
`req.session.user?.delegate` is present:
1. Load the link (cached briefly). If missing / revoked / past `expires_at` → destroy the
   session and return 401 for `/api` paths (mirrors `ssoRevocationMiddleware`).
2. For mutating requests to approval endpoints (`POST`/`PUT` under `/api/requisition`,
   `/api/leave`, etc.), insert a `delegate_access_event` row with `event_type='action'`
   and `detail = method + ' ' + path`, and bump `last_used_at`. This gives per-action
   traceability from a single choke point without editing every approval controller.

### Email
Model on `salary.service.js#requestFpinReset`: CID-logo HTML + plaintext, `EMAIL_FROM`,
sent to the employee's official CRM email (fallback portal email). Link base =
`PORTAL_PUBLIC_URL` (the same env the SSO flow uses). URL form:
`${PORTAL_PUBLIC_URL}/delegate/<rawToken>`. If email is not configured, the create call
still succeeds and returns the raw URL so SuperAdmin can copy it manually (response flags
`emailSent: false`).

## Frontend

- **API group** `delegateAccessAPI` in `src/services/api.js`: `list`, `create`, `revoke`,
  `resend`, `events`, and public `open(token)` / `verify(token, otp)`.
- **Public entry route** in `App.jsx`, outside `ProtectedRoute` (alongside `/cards`):
  `path="/delegate/:token"` → `DelegateEntry.jsx`. Flow: on mount call `open(token)` →
  render OTP form showing `maskedEmail` → on submit call `verify` → populate
  `EmployeeContext` setters (`setEmployeeId/Code/UserType/Permissions/IsAuthenticated`) +
  `localStorage.sessionLoginAt` → `navigate(landingPage, { replace: true })`. Handles
  invalid/expired/revoked token and OTP errors with clear messages.
- **`EmployeeContext.hasPermission`**: add a branch so `userType === 'DelegateAccess'`
  keys strictly off the `permissions` array (no SuperAdmin/default bypass). This is what
  enforces "only selected pages" in the SPA.
- **SuperAdmin page** `src/pages/DelegateAccessLinks.jsx`:
  - Route `/delegate-access` (child of `DashboardLayout`), nav item gated
    `superadmin_only`, added to `PATH_PERMISSION` + special-cased in `canAccessPath`
    (SuperAdmin only) like `/role-permissions`.
  - Create form: employee search dropdown (reuse the debounced
    `payrollAPI.searchEmployees` pattern from `GrossSalaries.jsx`); a checklist of all
    portal pages from a labelled list mirroring backend `PERMISSION_KEYS` (excluding the
    SuperAdmin-only surfaces noted in Decision 3); expiry-days
    input (min 10, default 10); landing-page select (defaults to Pending Requisition if
    selected, else first selected page); "Create & Email" button.
  - List table: employee, pages, expiry, status, last used; row actions revoke, resend,
    and "View usage log" (drawer showing `events`). On create with `emailSent:false`,
    show the raw URL to copy with a warning.

## Security & edge cases
- Token: 32 random bytes hex; only sha-256 hash persisted.
- OTP: 6 digits, hashed, 10-min expiry, 5 wrong attempts → lockout, to official email, masked in response.
- Link: min 10 days (validated server-side), default 10; revocable; expired/revoked → clear entry-page error.
- Empty page selection → 400. `landingPage` must be within `pages`.
- If email not configured → link still created, raw URL returned for manual sharing (`emailSent:false`).
- `DelegateAccess` userType can never bypass permission checks (even for an underlying SuperAdmin employee).
- The SMTP config auto-BCCs `ali.asif@itecknologi.com`; since links are OTP-gated, a BCC'd link alone is unusable — acceptable.

## Testing
- **Backend unit:** token hash/verify; OTP verify + lockout; link create validation
  (expiryDays min 10, non-empty pages, landing within pages); expiry/revoke status
  computation; scoped-session payload builder.
- **Backend integration:** create → open → OTP → verify establishes a scoped session;
  access allowed only for selected pages; revoke → next `/api` request returns 401;
  expired link → 401 on open.
- **End-to-end:** run the full flow in the app (SuperAdmin creates link → open `/delegate/:token`
  → OTP → land on Pending Requisition → confirm non-selected pages redirect away) before
  claiming completion.

## Out of scope (YAGNI)
- Separate "on-behalf" delegate identity (explicitly rejected).
- Multi-instance OTP store (Redis) — matches the existing single-instance FPIN store.
- Per-approval row tagging in requisition tables — audit lives in `delegate_access_event`.
