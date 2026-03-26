/**
 * Server-Sent Events + Redis pub/sub per employee channel: notifications:{employeeId}
 */
import { getConnection } from './bullmq.js'

/** @type {Map<string, Set<{ res: import('http').ServerResponse, sub: import('ioredis').Redis, heartbeat: NodeJS.Timeout }>>} */
const clientsByEmployee = new Map()

function channelName(employeeId) {
  return `notifications:${employeeId}`
}

export function getSseClientCount() {
  let n = 0
  for (const set of clientsByEmployee.values()) n += set.size
  return n
}

/**
 * @param {number} employeeId
 * @param {import('express').Response} res
 */
export function registerSseClient(employeeId, res) {
  const eid = parseInt(employeeId, 10)
  if (Number.isNaN(eid)) return

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  if (typeof res.flushHeaders === 'function') res.flushHeaders()

  let sub
  try {
    sub = getConnection().duplicate()
  } catch (e) {
    console.error('SSE: Redis duplicate failed', e.message)
    res.status(503).end('Redis unavailable')
    return
  }

  const ch = channelName(eid)
  const entry = { res, sub, heartbeat: null }
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    try {
      if (entry.heartbeat) clearInterval(entry.heartbeat)
      entry.heartbeat = null
    } catch (_) {}
    try {
      sub.unsubscribe(ch)
      sub.quit()
    } catch (_) {}
    const set = clientsByEmployee.get(String(eid))
    if (set) {
      set.delete(entry)
      if (set.size === 0) clientsByEmployee.delete(String(eid))
    }
    try {
      if (!res.writableEnded) res.end()
    } catch (_) {}
  }

  sub.on('message', (receivedChannel, message) => {
    if (receivedChannel !== ch) return
    try {
      if (!res.writableEnded) res.write(`data: ${message}\n\n`)
    } catch (_) {
      cleanup()
    }
  })

  sub.on('error', (err) => {
    console.error('SSE subscriber error:', err.message)
    cleanup()
  })

  sub.subscribe(ch).then(() => {
    try {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type: 'connected', employeeId: eid })}\n\n`)
    } catch (_) {}
    entry.heartbeat = setInterval(() => {
      try {
        if (!res.writableEnded) res.write(': ping\n\n')
      } catch (_) {
        cleanup()
      }
    }, 30000)
  }).catch((err) => {
    console.error('SSE subscribe failed:', err.message)
    cleanup()
  })

  const set = clientsByEmployee.get(String(eid)) || new Set()
  set.add(entry)
  clientsByEmployee.set(String(eid), set)

  res.on('close', cleanup)
  res.on('error', cleanup)
}

export async function closeAllSseConnections() {
  for (const [eid, set] of clientsByEmployee.entries()) {
    for (const entry of [...set]) {
      try {
        if (entry.heartbeat) clearInterval(entry.heartbeat)
        entry.sub?.unsubscribe(channelName(parseInt(eid, 10)))
        entry.sub?.quit()
      } catch (_) {}
      try {
        if (!entry.res.writableEnded) entry.res.end()
      } catch (_) {}
    }
    clientsByEmployee.delete(eid)
  }
}
