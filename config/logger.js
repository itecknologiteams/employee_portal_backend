import winston from 'winston'
import DailyRotateFile from 'winston-daily-rotate-file'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logsDir = path.resolve(__dirname, '..', 'logs')
const safeLogsDir = typeof logsDir === 'string' && logsDir ? logsDir : path.join(process.cwd(), 'logs')

if (!fs.existsSync(safeLogsDir)) {
  fs.mkdirSync(safeLogsDir, { recursive: true })
}

const requestLogFormat = winston.format.printf(({ message }) => message)

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    requestLogFormat
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ message }) => message)
      )
    }),
    new DailyRotateFile({
      dirname: safeLogsDir,
      filename: 'request-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
      )
    })
  ]
})

const errorLogger = winston.createLogger({
  level: 'error',
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ message }) => message)
      )
    }),
    new DailyRotateFile({
      dirname: safeLogsDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
      )
    })
  ]
})

const SENSITIVE_KEYS = ['password', 'currentPassword', 'newPassword', 'passwordHash', 'token', 'accessToken', 'refreshToken', 'authorization']
const BODY_LOG_MAX_LEN = 2000
const BODY_LOG_ENABLED = process.env.LOG_REQUEST_RESPONSE_BODY === '1' || process.env.LOG_REQUEST_RESPONSE_BODY === 'true'

function isSensitiveKey(key) {
  if (typeof key !== 'string') return false
  const k = key.toLowerCase()
  return SENSITIVE_KEYS.some(s => k.includes(s.toLowerCase()))
}

function sanitize(obj) {
  if (obj == null) return obj
  if (typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = '[REDACTED]'
    } else {
      out[key] = typeof value === 'object' && value !== null ? sanitize(value) : value
    }
  }
  return out
}

function truncate(str, maxLen = BODY_LOG_MAX_LEN) {
  if (str == null) return ''
  const s = typeof str === 'string' ? str : JSON.stringify(str)
  return s.length <= maxLen ? s : s.slice(0, maxLen) + '...[truncated]'
}

const bodyLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, message }) => `${timestamp} ${message}`)
  ),
  transports: [
    new DailyRotateFile({
      dirname: safeLogsDir,
      filename: 'request-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d'
    })
  ]
})

/**
 * Log request/response body to file only (POST/PUT/PATCH). Sanitized and truncated.
 */
export function logRequestWithBody({ method, path: reqPath, status, duration, success, requestBody, responseBody }) {
  if (!BODY_LOG_ENABLED) return
  const reqStr = truncate(JSON.stringify(sanitize(requestBody)))
  const resStr = truncate(JSON.stringify(sanitize(responseBody)))
  const block = [
    `[REQUEST_BODY] ${method} ${reqPath} ${status} ${duration}ms ${success ? 'success' : 'failure'}`,
    '--- REQ ---',
    reqStr || '(empty)',
    '--- RES ---',
    resStr || '(empty)',
    '---'
  ].join('\n')
  bodyLogger.info(block)
}

/**
 * Log a completed request (success or failure).
 */
export function logRequest({ method, path: reqPath, status, duration, success }) {
  const outcome = success ? 'success' : 'failure'
  const message = `[REQUEST] ${method} ${reqPath} ${status} ${duration}ms ${outcome}`
  logger.info(message)
}

/**
 * Log an unhandled error (500) with endpoint context.
 */
export function logError({ method, path: reqPath, message: errMessage, stack }) {
  const line = `[ERROR] ${method} ${reqPath} | ${errMessage}${stack ? '\n' + stack : ''}`
  errorLogger.error(line)
}
