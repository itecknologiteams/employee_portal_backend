import bcrypt from 'bcryptjs'
import { executeQuery } from '../config/database.js'
import dotenv from 'dotenv'

dotenv.config()

async function insertUser() {
  try {
    const firstName = 'Ali'
    const lastName = 'Asif'
    const email = 'ali.asif@itecknologi.com'
    const password = 'Sheikh@1364'
    const employeeCode = 'EMP-ALI-001'
    
    // Check if user already exists
    const checkQuery = 'SELECT employee_id FROM employees WHERE email = $1'
    const existing = await executeQuery(checkQuery, [email])
    
    if (existing.length > 0) {
      console.log('❌ User already exists with email:', email)
      console.log('Employee ID:', existing[0].employee_id)
      return
    }

    // Hash password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)
    console.log('✅ Password hashed successfully')

    // Insert employee
    const insertQuery = `
      INSERT INTO employees (
        employee_code,
        first_name,
        last_name,
        email,
        password_hash,
        is_active,
        join_date,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, true, CURRENT_DATE, CURRENT_TIMESTAMP)
      RETURNING employee_id, first_name, last_name, email
    `

    const result = await executeQuery(insertQuery, [
      employeeCode,
      firstName,
      lastName,
      email,
      hashedPassword
    ])

    if (result.length > 0) {
      const employee = result[0]
      console.log('✅ User created successfully!')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('Employee ID:', employee.employee_id)
      console.log('Name:', `${firstName} ${lastName}`)
      console.log('Email:', email)
      console.log('Password:', password)
      console.log('Employee Code:', employeeCode)
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

      // Initialize leave balance
      try {
        await executeQuery(
          'INSERT INTO leave_balance (employee_id, annual_leave, sick_leave, personal_leave) VALUES ($1, 15, 10, 5)',
          [employee.employee_id]
        )
        console.log('✅ Leave balance initialized')
      } catch (error) {
        console.log('⚠️  Leave balance might already exist or table not found')
      }
    }
  } catch (error) {
    console.error('❌ Error creating user:', error.message)
    if (error.message.includes('UNIQUE constraint') || error.message.includes('duplicate key')) {
      console.error('   Email already exists in database')
    }
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

insertUser()