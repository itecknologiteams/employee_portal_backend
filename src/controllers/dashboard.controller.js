import * as dashboardService from '../services/dashboard.service.js'
import { getEmployeeIdByCode } from '../repositories/auth.repository.js'

export async function getStats(req, res) {
  try {
    // Get employee code from URL parameter or fallback for backward compatibility
    const employeeCode = req.params.employeeCode
    let employeeId = null

    if (employeeCode) {
      employeeId = await getEmployeeIdByCode(employeeCode)
    }

    const stats = await dashboardService.getStats(employeeId)
    res.json(stats)
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' })
  }
}

export async function getActivities(req, res) {
  try {
    const employeeCode = req.params.employeeCode
    let employeeId = null

    if (employeeCode) {
      employeeId = await getEmployeeIdByCode(employeeCode)
    }

    const activities = await dashboardService.getActivities(employeeId)
    res.json(activities)
  } catch (error) {
    console.error('Activities error:', error)
    res.status(500).json({ error: 'Failed to fetch activities' })
  }
}
