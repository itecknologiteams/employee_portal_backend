import * as dashboardService from '../services/dashboard.service.js'

export async function getStats(req, res) {
  try {
    const stats = await dashboardService.getStats()
    res.json(stats)
  } catch (error) {
    console.error('Dashboard stats error:', error)
    res.status(500).json({ error: 'Failed to fetch dashboard statistics' })
  }
}

export async function getActivities(req, res) {
  try {
    const activities = await dashboardService.getActivities()
    res.json(activities)
  } catch (error) {
    console.error('Activities error:', error)
    res.status(500).json({ error: 'Failed to fetch activities' })
  }
}
