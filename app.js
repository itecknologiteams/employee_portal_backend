import express from 'express'
import path from 'path'
import session from 'express-session'
import { fileURLToPath } from 'url'
import cors from 'cors'
import bodyParser from 'body-parser'
import os from 'os'
import { executeQuery } from './config/database.js'
import {
  dashboardRoutes,
  profileRoutes,
  salaryRoutes,
  leaveRoutes,
  feedbackRoutes,
  requisitionRoutes,
  extensionsRoutes,
  authRoutes,
  administrationRoutes,
  payrollRoutes,
  payrollDbRoutes,
  autoPayrollRoutes,
  rolePermissionsRoutes,
  cardsRoutes,
  notificationRoutes,
  employeeHistoryRoutes,
  tedRoutes,
  delegateAccessRoutes
} from './src/routes/index.js'
import { requestLogger } from './src/middleware/requestLogger.js'
import { errorHandler } from './src/middleware/errorHandler.js'
import { ssoRevocationMiddleware } from './src/middleware/ssoRevocation.js'
import delegateSessionMiddleware from './src/middleware/delegateSession.js'
import { createSessionStore } from './config/sessionStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const getNetworkIP = () => {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return 'localhost'
}

const NETWORK_IP = getNetworkIP()
const FRONTEND_PORT = process.env.FRONTEND_PORT || 5173
const IS_HTTPS = (process.env.PORTAL_PUBLIC_URL || '').startsWith('https://')
/**
 * Session cookie `Secure` flag.
 * Defaults to true when PORTAL_PUBLIC_URL is https:// (production).
 * Set SESSION_COOKIE_SECURE=0 in .env ONLY for pure HTTP internal deployments
 * (e.g. https://emp.itecknologi.com) where PORTAL_PUBLIC_URL is not https.
 */
const SESSION_COOKIE_SECURE =
  process.env.SESSION_COOKIE_SECURE === '0'
    ? false
    : (process.env.SESSION_COOKIE_SECURE === '1' || IS_HTTPS)
// Cross-site cookie mode: Secure + SameSite=None. Needed when the portal is served over HTTPS
// and embedded in an iframe by another site (e.g. the CRM).
const SESSION_COOKIE_CROSS_SITE = SESSION_COOKIE_SECURE && IS_HTTPS
/**
 * CHIPS / Partitioned cookie. A cross-site iframe parent (e.g. rfm.itecknologi.internal, a
 * different registrable domain than emp.itecknologi.com) makes the session cookie THIRD-PARTY,
 * which modern browsers block by default even when Secure+SameSite=None — so the SSO-consumed
 * session is never stored and every /api/auth/me returns 401 inside the CRM. Marking the cookie
 * `Partitioned` opts into CHIPS so the browser keeps it (scoped to the top-level site).
 * Only meaningful in cross-site mode; set SESSION_COOKIE_PARTITIONED=0 to force it off.
 */
const SESSION_COOKIE_PARTITIONED =
  process.env.SESSION_COOKIE_PARTITIONED === '0'
    ? false
    : (process.env.SESSION_COOKIE_PARTITIONED === '1' || SESSION_COOKIE_CROSS_SITE)
const envCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://${NETWORK_IP}:${FRONTEND_PORT}`,
  `http://${NETWORK_IP}:4173`,
  'http://192.168.20.244',
  'http://192.168.20.244/',
  'http://emp.itecknologi.com',
  'https://emp.itecknologi.com',
  'http://192.168.20.180',
  'http://192.168.20.180/',
  'https://webtrack.itecknologi.com',
  'https://webtrack.itecknologi.com/',
  ...envCorsOrigins
]

const app = express()

// Trust the first proxy (nginx). Without this, Express sees the internal HTTP
// connection and refuses to set the `secure` cookie → browser never gets the
// session cookie → every /api/auth/me returns 401 after page refresh.
app.set('trust proxy', 1)

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (
      allowedOrigins.indexOf(origin) !== -1 ||
      origin.includes(NETWORK_IP) ||
      origin.includes('192.168.20.180') ||
      origin.includes('rfm.itecknologi.internal')
    ) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin '${origin}' is not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
// Raised to 25mb so loan-form PDFs (base64 data URLs) sent at Finance approval fit in the request body.
app.use(bodyParser.json({ limit: '25mb' }))
app.use(bodyParser.urlencoded({ extended: true, limit: '25mb' }))
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const SESSION_MAX_AGE_MS =
  parseInt(process.env.SESSION_MAX_AGE_MS || String(TWENTY_FOUR_HOURS_MS), 10) || TWENTY_FOUR_HOURS_MS

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET environment variable is not set. Refusing to start in production without a secure secret.')
    process.exit(1)
  } else {
    console.warn('WARNING: SESSION_SECRET is not set. Using an insecure default — set SESSION_SECRET in .env before deploying.')
  }
}
app.use(session({
  name: 'emp.portal.sid',
  secret: process.env.SESSION_SECRET || 'emp-portal-dev-secret-do-not-use-in-production',
  store: createSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    path: '/',
    secure: SESSION_COOKIE_SECURE,
    sameSite: SESSION_COOKIE_CROSS_SITE ? 'none' : 'lax',
    partitioned: SESSION_COOKIE_PARTITIONED,
    maxAge: SESSION_MAX_AGE_MS
  }
}))
if (process.env.NODE_ENV !== 'test') {
  console.log(`[session] emp.portal.sid secure=${SESSION_COOKIE_SECURE} sameSite=${SESSION_COOKIE_CROSS_SITE ? 'none' : 'lax'} partitioned=${SESSION_COOKIE_PARTITIONED} IS_HTTPS=${IS_HTTPS} (override: SESSION_COOKIE_SECURE=0 for HTTP-only; SESSION_COOKIE_PARTITIONED=0 to disable CHIPS)`)
}
app.use(ssoRevocationMiddleware)
app.use(delegateSessionMiddleware)
app.use(requestLogger)

app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')))

app.use('/api/dashboard', dashboardRoutes)
app.use('/api/profile', profileRoutes)
app.use('/api/salary', salaryRoutes)
app.use('/api/leave', leaveRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/requisition', requisitionRoutes)
app.use('/api/extensions', extensionsRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/administration', administrationRoutes)
app.use('/api/payroll', payrollRoutes)
app.use('/api/payroll-db', payrollDbRoutes)
app.use('/api/auto-payroll', autoPayrollRoutes)
app.use('/api/role-permissions', rolePermissionsRoutes)
app.use('/api/cards', cardsRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api', employeeHistoryRoutes)
app.use('/api/ted', tedRoutes)
app.use('/api/delegate-access', delegateAccessRoutes)

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  })
})

app.get('/api/test-db', async (req, res) => {
  if (!req.session || !req.session.user || req.session.user.userType !== 'SuperAdmin') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  try {
    const result = await executeQuery('SELECT version(), current_database() as database_name, NOW() as server_time')
    res.json({
      status: 'Connected',
      database: {
        name: result[0].database_name,
        serverTime: result[0].server_time,
        version: result[0].version.split(',')[0]
      }
    })
  } catch (error) {
    res.status(500).json({ status: 'Connection Failed', error: 'Database query failed' })
  }
})

app.use(errorHandler)

export default app
