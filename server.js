import dotenv from 'dotenv'
import { executeQuery, closeConnection } from './config/database.js'
import { closeConnection as closeRabbitConnection } from './config/rabbitmq.js'
import { isBullMQEnabled, addRepeatableReminderJob, closeBullMQ } from './config/bullmq.js'
import app from './app.js'
import os from 'os'

dotenv.config()

const PORT = process.env.PORT || 4000

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

// Test database connection on startup
executeQuery('SELECT 1')
  .then(() => {
    console.log('✅ Database connection established')
  })
  .catch((error) => {
    console.error('❌ Failed to connect to database:', error.message)
    console.error('   Please check your database credentials in .env file')
    console.error('   Host:', process.env.DB_HOST)
    console.error('   Database:', process.env.DB_DATABASE)
    console.error('   User:', process.env.DB_USER)
  })

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on:`)
  console.log(`   Local:   http://localhost:${PORT}`)
  console.log(`   Network: http://${NETWORK_IP}:${PORT}`)
  console.log(`📊 Database: ${process.env.DB_DATABASE || 'employee_portal'}`)
  console.log(`🗄️  Database Type: PostgreSQL`)
  console.log(`🔗 Host: ${process.env.DB_HOST || '192.168.20.21'}:${process.env.DB_PORT || '5432'}`)
  console.log(`\n💡 Access from other devices on your network:`)
  console.log(`   Frontend: http://${NETWORK_IP}:${FRONTEND_PORT}`)
  console.log(`   Backend:  http://${NETWORK_IP}:${PORT}`)

  if (isBullMQEnabled()) {
    try {
      const { processJob } = await import('./workers/requisition-reminder-worker.js')
      await addRepeatableReminderJob(processJob)
      console.log('✅ Requisition reminder job scheduled (BullMQ)')
    } catch (err) {
      console.error('BullMQ reminder start failed:', err.message)
    }
  }
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down server...')
  await closeBullMQ()
  await closeRabbitConnection()
  await closeConnection()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\nShutting down server...')
  await closeBullMQ()
  await closeRabbitConnection()
  await closeConnection()
  process.exit(0)
})
