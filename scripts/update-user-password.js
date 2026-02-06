import bcrypt from 'bcryptjs'
import { executeQuery } from '../config/database.js'
import dotenv from 'dotenv'

dotenv.config()

async function updateUserPassword() {
  try {
    const email = 'ali.asif@itecknologi.com'
    const newPassword = 'Sheikh@1364'
    
    // Check if user exists
    const checkQuery = 'SELECT employee_id, first_name, last_name FROM employees WHERE email = $1'
    const existing = await executeQuery(checkQuery, [email])
    
    if (existing.length === 0) {
      console.log('❌ User not found with email:', email)
      console.log('Run: npm run insert-user to create the user first')
      return
    }

    const user = existing[0]
    console.log(`Found user: ${user.first_name} ${user.last_name} (ID: ${user.employee_id})`)

    // Hash password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds)
    console.log('✅ Password hashed successfully')

    // Update password in both fields (for compatibility)
    const updateQuery = `
      UPDATE employees
      SET 
        password_hash = $1,
        password = $2,
        password_updated_at = CURRENT_TIMESTAMP
      WHERE email = $3
    `

    await executeQuery(updateQuery, [hashedPassword, newPassword, email])

    console.log('✅ Password updated successfully!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('Email:', email)
    console.log('New Password:', newPassword)
    console.log('Password is now hashed with bcrypt')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  } catch (error) {
    console.error('❌ Error updating password:', error.message)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

updateUserPassword()