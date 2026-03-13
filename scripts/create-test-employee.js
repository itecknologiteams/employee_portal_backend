import bcrypt from 'bcryptjs'
import { executeQuery } from '../config/database.js'
import dotenv from 'dotenv'

dotenv.config()

async function createTestEmployee() {
  try {
    const email = 'john.doe@company.com'
    const password = 'password123'
    
    // Check if employee already exists
    const checkQuery = 'SELECT employee_id FROM employees WHERE email = $1'
    const existing = await executeQuery(checkQuery, [email])
    
    if (existing.length > 0) {
      console.log('Employee already exists with email:', email)
      return
    }

    // Hash password
    const saltRounds = 10
    const hashedPassword = await bcrypt.hash(password, saltRounds)

    // Insert employee
    const insertQuery = `
      INSERT INTO employees (
        employee_code,
        first_name,
        last_name,
        email,
        phone,
        department_id,
        position,
        password_hash,
        join_date,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_DATE, true)
      RETURNING employee_id, first_name, last_name, email
    `

    const result = await executeQuery(insertQuery, [
      'EMP-001',
      'John',
      'Doe',
      email,
      '+1234567890',
      1,
      'Senior Software Engineer',
      hashedPassword
    ])

    if (result.length > 0) {
      const employee = result[0]
      console.log('✅ Employee created successfully!')
      console.log('Employee ID:', employee.employee_id)
      console.log('Name:', `${employee.first_name} ${employee.last_name}`)
      console.log('Email:', employee.email)
      console.log('Password: password123')

      // Initialize leave balance
      await executeQuery(
        'INSERT INTO leave_balance (employee_id, annual_leave, sick_leave, personal_leave) VALUES ($1, 15, 10, 5)',
        [employee.employee_id]
      )
      console.log('✅ Leave balance initialized')

      // Create sample salary slip
      await executeQuery(
        `INSERT INTO salary_slips (
          employee_id, 
          month_year, 
          basic_salary, 
          allowances, 
          bonuses, 
          deductions, 
          net_salary
        ) VALUES ($1, DATE_TRUNC('month', CURRENT_DATE), 3001, 1000, 500, 0, 5500)`,
        [employee.employee_id]
      )
      console.log('✅ Sample salary slip created')
    }
  } catch (error) {
    console.error('❌ Error creating employee:', error.message)
    process.exit(1)
  } finally {
    process.exit(0)
  }
}

createTestEmployee()