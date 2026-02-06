import { Queue, Worker } from 'bullmq'
import IORedis from 'ioredis'

const QUEUE_NAME = 'requisition-reminder'
const REDIS_KEY_PREFIX = 'requisition:reminder:'

let connection = null
let queue = null
let worker = null

function getRedisConfig() {
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null
  }
}

export function getConnection() {
  if (!connection) {
    connection = new IORedis(getRedisConfig())
  }
  return connection
}

export function getQueue() {
  if (!queue) {
    const conn = getConnection()
    queue = new Queue(QUEUE_NAME, {
      connection: conn,
      defaultJobOptions: { removeOnComplete: { count: 100 } }
    })
  }
  return queue
}

export function getReminderRedisKey(reqId) {
  return REDIS_KEY_PREFIX + reqId
}

export function isBullMQEnabled() {
  return process.env.BULLMQ_REMINDER_ENABLED === '1' || process.env.REDIS_HOST
}

/**
 * Add repeatable job and start worker. Run every 15 minutes (or REMINDER_CRON).
 */
export async function addRepeatableReminderJob(processor) {
  const q = getQueue()
  const conn = getConnection()
  const repeatCron = process.env.REMINDER_CRON || '*/15 * * * *' // every 15 min
  await q.add('check-reminders', {}, {
    repeat: { pattern: repeatCron }
  }).catch((err) => {
    if (err.message && !err.message.includes('already exists')) console.error('Repeatable job add:', err.message)
  })

  worker = new Worker(QUEUE_NAME, processor, {
    connection: conn,
    concurrency: 1
  })
  worker.on('failed', (_, err) => console.error('Requisition reminder job failed:', err.message))
  return worker
}

export async function closeBullMQ() {
  try {
    if (worker) await worker.close()
    if (queue) await queue.close()
    if (connection) await connection.quit()
  } catch (_) {}
  worker = null
  queue = null
  connection = null
}
