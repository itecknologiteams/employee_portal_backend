/**
 * Consumer for requisition.created events.
 * Run separately: node scripts/requisition-consumer.js
 *
 * Use this to add side effects: notify HOD, audit log, email, etc.
 */
import amqp from 'amqplib'
import dotenv from 'dotenv'

dotenv.config()

const QUEUE = 'requisition.created'

function getRabbitUrl() {
  if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL
  const host = process.env.RABBITMQ_HOST || 'localhost'
  const port = process.env.RABBITMQ_PORT || '5672'
  const user = process.env.RABBITMQ_USER || 'guest'
  const pass = process.env.RABBITMQ_PASSWORD || 'guest'
  const vhost = process.env.RABBITMQ_VHOST ? encodeURIComponent(process.env.RABBITMQ_VHOST) : '%2F'
  return `amqp://${user}:${pass}@${host}:${port}/${vhost}`
}

async function main() {
  const url = getRabbitUrl()
  console.log('Connecting to RabbitMQ...')
  const conn = await amqp.connect(url)
  const ch = await conn.createChannel()
  await ch.assertQueue(QUEUE, { durable: true })
  ch.prefetch(1)

  console.log(`Consuming queue: ${QUEUE}`)

  ch.consume(QUEUE, (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString())
      console.log('[requisition.created]', payload)
      // Add your side effects here, e.g.:
      // - Notify HOD of payload.departmentId
      // - Write to audit log
      // - Send email to payload.creatorEmail
      ch.ack(msg)
    } catch (err) {
      console.error('Consumer error:', err.message)
      ch.nack(msg, false, true)
    }
  }, { noAck: false })
}

main().catch((err) => {
  console.error('Failed to start consumer:', err)
  process.exit(1)
})
