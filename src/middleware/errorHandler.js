import { logError } from '../../config/logger.js'

/**
 * Global error handling middleware
 */
export function errorHandler(err, req, res, next) {
  logError({
    method: req.method,
    path: req.originalUrl,
    message: err.message,
    stack: err.stack
  })
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  })
}
