import amqp from 'amqplib'

const QUEUE_REQUISITION_CREATED = 'requisition.created'

let connection = null
let channel = null

function getRabbitUrl() {
  if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL
  const host = process.env.RABBITMQ_HOST || 'localhost'
  const port = process.env.RABBITMQ_PORT || '5672'
  const user = process.env.RABBITMQ_USER || 'guest'
  const pass = process.env.RABBITMQ_PASSWORD || 'guest'
  const vhost = process.env.RABBITMQ_VHOST ? encodeURIComponent(process.env.RABBITMQ_VHOST) : '%2F'
  return `amqp://${user}:${pass}@${host}:${port}/${vhost}`
}

function isEnabled() {
  return process.env.RABBITMQ_ENABLED !== '0' && (process.env.RABBITMQ_URL || process.env.RABBITMQ_HOST)
}

async function getChannel() {
  if (!isEnabled()) return null
  if (channel && connection) return channel
  try {
    const url = getRabbitUrl()
    connection = await amqp.connect(url)
    channel = await connection.createChannel()
    await channel.assertQueue(QUEUE_REQUISITION_CREATED, { durable: true })
    connection.on('error', (err) => console.error('RabbitMQ connection error:', err.message))
    connection.on('close', () => { connection = null; channel = null })
    return channel
  } catch (err) {
    console.error('RabbitMQ connect error:', err.message)
    connection = null
    channel = null
    return null
  }
}

/**
 * Publish requisition.created event (fire-and-forget).
 * Does not throw; if RabbitMQ is unavailable, logs and returns.
 */
export async function publishRequisitionCreated(payload) {
  const ch = await getChannel()
  if (!ch) return
  try {
    const msg = Buffer.from(JSON.stringify(payload))
    ch.sendToQueue(QUEUE_REQUISITION_CREATED, msg, { persistent: true })
  } catch (err) {
    console.error('RabbitMQ publish requisition.created error:', err.message)
  }
}

export async function closeConnection() {
  try {
    if (channel) await channel.close()
    if (connection) await connection.close()
  } catch (_) {}
  channel = null
  connection = null
}

export { QUEUE_REQUISITION_CREATED, isEnabled }
