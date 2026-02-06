import * as dashboardRepo from '../repositories/dashboard.repository.js'

export async function getStats() {
  const { totalEmployees, activeLeaves, monthlySalary, pendingRequests } = await dashboardRepo.getStats()
  return {
    totalEmployees: parseInt(totalEmployees[0]?.count || 0),
    activeLeaves: parseInt(activeLeaves[0]?.count || 0),
    monthlySalary: parseFloat(monthlySalary[0]?.total || 0),
    pendingRequests: parseInt(pendingRequests[0]?.count || 0)
  }
}

export async function getActivities() {
  return dashboardRepo.getActivities()
}
