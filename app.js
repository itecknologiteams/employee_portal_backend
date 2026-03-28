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
  rolePermissionsRoutes,
  cardsRoutes,
  notificationRoutes
} from './src/routes/index.js'
import { requestLogger } from './src/middleware/requestLogger.js'
import { errorHandler } from './src/middleware/errorHandler.js'
import { ssoRevocationMiddleware } from './src/middleware/ssoRevocation.js'

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
const envCorsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://${NETWORK_IP}:${FRONTEND_PORT}`,
  `http://${NETWORK_IP}:4173`,
  'https://emp.itecknologi.com',
  'http://rfm.itecknologi.internal',
  ...envCorsOrigins
]

const app = express()

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes(NETWORK_IP)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin '${origin}' is not allowed`))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
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
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE_MS
  }
}))
app.use(ssoRevocationMiddleware)
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
app.use('/api/role-permissions', rolePermissionsRoutes)
app.use('/api/cards', cardsRoutes)
app.use('/api/notifications', notificationRoutes)

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
