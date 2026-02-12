import * as authService from '../services/auth.service.js'

export async function login(req, res) {
  try {
    const { username, email, password } = req.body
    const loginId = username || email
    if (!loginId || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' })
    }
    const result = await authService.login(loginId, password)
    if (result.error) {
      return res.status(result.status || 401).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Failed to login. Please try again.' })
  }
}

export async function changePassword(req, res) {
  try {
    debugger
    const { employeeId, currentPassword, newPassword } = req.body
    if (!employeeId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'All fields are required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' })
    }
    const result = await authService.changePassword(employeeId, currentPassword, newPassword)
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.json(result)
  } catch (error) {
    console.error('Change password error:', error)
    res.status(500).json({ error: 'Failed to change password' })
  }
}

export async function register(req, res) {
  try {
    const { employeeCode, firstName, lastName, email, password, phone, departmentId, position } = req.body
    if (!employeeCode || !firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'Required fields are missing' })
    }
    const result = await authService.register({
      employeeCode, firstName, lastName, email, password, phone, departmentId, position
    })
    if (result.error) {
      return res.status(result.status || 400).json({ error: result.error })
    }
    res.status(201).json(result)
  } catch (error) {
    console.error('Registration error:', error)
    res.status(500).json({ error: 'Failed to register employee' })
  }
}
