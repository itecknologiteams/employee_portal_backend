import bcrypt from 'bcryptjs'
import { executeQuery } from '../config/database.js'
import dotenv from 'dotenv'

dotenv.config()

const ADMIN_USERNAME = 'Admin'
const ADMIN_EMAIL = 'admin@itecknologi.com'
const ADMIN_PASSWORD = 'Admin@123'
const ADMIN_FIRST_NAME = 'Admin'
const ADMIN_LAST_NAME = 'User'
const ADMIN_EMPLOYEE_CODE = 'EMP-ADMIN-001'

async function insertAdmin() {
  try {
    // Check if user 'Admin' already exists
    const existingUser = await executeQuery(
      'SELECT user_id, emp_id FROM users WHERE username = $1',
      [ADMIN_USERNAME]
    )
    if (existingUser.length > 0) {
      console.log('❌ User "Admin" already exists (user_id:', existingUser[0].user_id + ', emp_id:', existingUser[0].emp_id + ')')
      process.exit(0)
      return
    }

    // Find or create employee for Admin
    let empRows = await executeQuery(
      'SELECT employee_id FROM employees WHERE email = $1',
      [ADMIN_EMAIL]
    )

    let employeeId
    if (empRows.length > 0) {
      employeeId = empRows[0].employee_id
      console.log('✅ Using existing employee (ID:', employeeId + ') for Admin')
    } else {
      const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10)
      await executeQuery(
        `INSERT INTO employees (
          employee_code, first_name, last_name, email, password_hash, is_active, join_date
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ADMIN_EMPLOYEE_CODE, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, ADMIN_EMAIL, hashedPassword, true, new Date()]
      )
      const after = await executeQuery('SELECT employee_id FROM employees WHERE email = $1', [ADMIN_EMAIL])
      employeeId = after[0].employee_id
      console.log('✅ Created employee for Admin (ID:', employeeId + ')')

      try {
        await executeQuery(
          'INSERT INTO leave_balance (employee_id, annual_leave, sick_leave, personal_leave) VALUES ($1, 15, 10, 5)',
          [employeeId]
        )
        console.log('✅ Leave balance initialized')
      } catch (e) {
        // ignore if exists or table missing
      }
    }

    // Insert into users table
    const userPasswordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
    await executeQuery(
      `INSERT INTO users (username, password, user_type, emp_id) VALUES ($1, $2, $3, $4)`,
      [ADMIN_USERNAME, userPasswordHash, 'SuperAdmin', employeeId]
    )

    console.log('')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('✅ Admin user created successfully!')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('  Username: ', ADMIN_USERNAME)
    console.log('  Password: ', ADMIN_PASSWORD)
    console.log('  User type: SuperAdmin')
    console.log('  Login with username "Admin" or email:', ADMIN_EMAIL)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  } catch (error) {
    console.error('❌ Error:', error.message)
    if (error.message.includes('UNIQUE') || error.message.includes('duplicate') || error.message.includes('unique')) {
      console.error('   Admin user or email may already exist.')
    }
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

insertAdmin()
