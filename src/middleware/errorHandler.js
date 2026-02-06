/**
 * Global error handling middleware
 */
export function errorHandler(err, req, res, next) {
  console.error('Error:', err)
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  })
}
