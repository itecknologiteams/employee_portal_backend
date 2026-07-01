import { logRequest, logRequestWithBody } from '../../config/logger.js'

const BODY_LOG_METHODS = ['POST', 'PUT', 'PATCH']

export function requestLogger(req, res, next) {
  const start = Date.now()
  const skipPath = req.originalUrl === '/api/health'

  let requestBody = null
  if (BODY_LOG_METHODS.includes(req.method) && req.body != null) {
    try {
      requestBody = JSON.parse(JSON.stringify(req.body))
    } catch (_) {
      requestBody = req.body
    }
  }

  const _json = res.json.bind(res)
  res.json = function (body) {
    res.locals.responseBody = body
    return _json(body)
  }
  const _send = res.send.bind(res)
  res.send = function (body) {
    if (res.locals.responseBody === undefined) {
      res.locals.responseBody = typeof body === 'object' ? body : body
    }
    return _send(body)
  }

  res.on('finish', () => {
    if (skipPath) return
    const duration = Date.now() - start
    // 2xx and 3xx (incl. 304 Not Modified, redirects) are NOT failures — only 4xx/5xx are.
    const success = res.statusCode < 400
    logRequest({
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration,
      success
    })
    if (BODY_LOG_METHODS.includes(req.method)) {
      logRequestWithBody({
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration,
        success,
        requestBody,
        responseBody: res.locals.responseBody
      })
    }
  })

  next()
}
