import * as dashboardRepo from '../repositories/dashboard.repository.js'
import * as requisitionRepo from '../repositories/requisition.repository.js'

/**
 * Get dashboard stats with role-based pending requests
 * @param {number|null} employeeId - The employee ID to check roles for
 * @returns {object} Dashboard stats including pending requests only for approvers
 */
export async function getStats(employeeId = null) {
  // Get basic stats first (these are always shown)
  const { totalEmployees, activeLeaves, monthlySalary, pendingLeaveRequests } = await dashboardRepo.getBasicStats()

  // Default: show leave requests as pending (for backward compatibility when no employeeId)
  let totalPendingRequests = parseInt(pendingLeaveRequests[0]?.count || 0)

  // If we have an employee ID, check their roles and get appropriate pending counts
  if (employeeId) {
    // Get employee's department info for HOD check
    const empDept = await requisitionRepo.getEmployeeDept(employeeId).catch(() => null)

    // Check all approval roles
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

    // Calculate pending requisitions based on roles
    let pendingRequisitionCount = 0

    if (isHod) {
      pendingRequisitionCount += await dashboardRepo.getHodPendingCount(employeeId)
    }
    if (isHr) {
      pendingRequisitionCount += await dashboardRepo.getHrPendingCount()
    }
    if (isFinance) {
      pendingRequisitionCount += await dashboardRepo.getFinancePendingCount()
    }
    if (isCommittee) {
      pendingRequisitionCount += await dashboardRepo.getCommitteePendingCount()
    }
    if (isCeo) {
      pendingRequisitionCount += await dashboardRepo.getCeoPendingCount()
    }
    if (isProcurement) {
      pendingRequisitionCount += await dashboardRepo.getProcurementPendingCount()
    }

    // User can see pending requests only if they have an approval role
    const canViewPendingRequests = isHod || isHr || isFinance || isCommittee || isCeo || isProcurement

    if (canViewPendingRequests) {
      totalPendingRequests = pendingRequisitionCount
    } else {
      // Regular employees see 0 (no bucket access)
      totalPendingRequests = 0
    }
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
