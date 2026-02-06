import { executeQuery } from '../config/database.js'
import dotenv from 'dotenv'

dotenv.config()

async function checkUser() {
  try {
    const email = 'ali.asif@itecknologi.com'
    
    const query = `
      SELECT 
        employee_id,
        first_name,
        last_name,
        email,
        password_hash,
        password,
        is_active
      FROM employees
      WHERE email = $1
    `

    const result = await executeQuery(query, [email])
    
    if (result.length === 0) {
      console.log('❌ User not found with email:', email)
      console.log('\nTo create the user, run: npm run insert-user')
    } else {
      const user = result[0]
      console.log('✅ User found!')
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
      console.log('Employee ID:', user.employee_id)
      console.log('Name:', `${user.first_name} ${user.last_name}`)
      console.log('Email:', user.email)
      console.log('Is Active:', user.is_active ? 'Yes' : 'No')
      console.log('Has PasswordHash:', user.password_hash ? 'Yes' : 'No')
      console.log('Has Password:', user.password ? 'Yes' : 'No')
      if (user.password_hash) {
        console.log('PasswordHash type:', user.password_hash.startsWith('$2a$') ? 'Bcrypt (Hashed)' : 'Plain Text')
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    }
  } catch (error) {
    console.error('❌ Error checking user:', error.message)
  } finally {
    process.exit(0)
  }
}

checkUser()