import express from 'express'
import path from 'path'
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
  rolePermissionsRoutes
} from './src/routes/index.js'
import { requestLogger } from './src/middleware/requestLogger.js'
import { errorHandler } from './src/middleware/errorHandler.js'

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
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  `http://${NETWORK_IP}:${FRONTEND_PORT}`,
  `http://${NETWORK_IP}:4173`
]

const app = express()

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true)
    if (allowedOrigins.indexOf(origin) !== -1 || origin.includes(NETWORK_IP)) {
      callback(null, true)
    } else {
      callback(null, true)
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
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

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  })
})

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await executeQuery('SELECT version(), current_database() as database_name, NOW() as server_time')
    res.json({
      status: 'Connected',
      database: {
        name: result[0].database_name,
        serverTime: result[0].server_time,
        version: result[0].version.split(',')[0]
      },
      connection: {
        host: process.env.DB_HOST || '192.168.20.21',
        database: process.env.DB_DATABASE || 'employee_portal',
        user: process.env.DB_USER || 'postgres',
        port: process.env.DB_PORT || '5432'
      }
    })
  } catch (error) {
    res.status(500).json({
      status: 'Connection Failed',
      error: error.message,
      details: {
        host: process.env.DB_HOST || '192.168.20.21',
        database: process.env.DB_DATABASE || 'employee_portal',
        user: process.env.DB_USER || 'postgres',
        port: process.env.DB_PORT || '5432'
      }
    })
  }
})

app.use(errorHandler)

export default app
