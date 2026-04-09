import * as dashboardRepo from '../repositories/dashboard.repository.js'
import * as requisitionRepo from '../repositories/requisition.repository.js'
import { getPendingCount } from './requisition.service.js'

/**
 * Get dashboard stats with role-based pending requests.
 * Uses the same getPendingCount logic as the bell/toast notification to ensure consistency.
 * @param {number|null} employeeId - The employee ID to check roles for
 * @returns {object} Dashboard stats including pending requests only for approvers
 */
export async function getStats(employeeId = null) {
  // Get basic stats first (these are always shown)
  const { totalEmployees, activeLeaves, monthlySalary } = await dashboardRepo.getBasicStats()

  // Use the same pending count logic as the header bell notification
  let totalPendingRequests = 0
  if (employeeId) {
    const result = await getPendingCount(employeeId).catch(() => ({ count: 0 }))
    totalPendingRequests = result?.count ?? 0
  }

  return {
    totalEmployees: parseInt(totalEmployees[0]?.count || 0),
    activeLeaves: parseInt(activeLeaves[0]?.count || 0),
    monthlySalary: parseFloat(monthlySalary[0]?.total || 0),
    pendingRequests: totalPendingRequests
  }
}

export async function getActivities(employeeId = null) {
  if (employeeId) {
    const empDept = await requisitionRepo.getEmployeeDept(employeeId).catch(() => null)

    const [isHod, isHr, isFinance, isCommittee, isCeo, isProcurement] = await Promise.all([
      empDept?.department_id
        ? requisitionRepo.isHodOfDepartment(employeeId, empDept.department_id).catch(() => false)
        : Promise.resolve(false),
      requisitionRepo.isHrMember(employeeId).catch(() => false),
      requisitionRepo.isFinanceHod(employeeId).catch(() => false),
      requisitionRepo.isCommitteeMember(employeeId).catch(() => false),
      requisitionRepo.isCeoMember(employeeId).catch(() => false),
      requisitionRepo.isProcurementMember(employeeId).catch(() => false)
    ])

    const isApprover = isHod || isHr || isFinance || isCommittee || isCeo || isProcurement

    // Approvers see all activities, regular employees see only their own
    return dashboardRepo.getActivities(isApprover ? null : employeeId)
  }

  return dashboardRepo.getActivities(null)
}
