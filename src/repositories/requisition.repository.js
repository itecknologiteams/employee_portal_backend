import { executeQuery, executeTransaction } from '../../config/database.js'
import { resolveEmailsPreferCrmForCodes } from '../utils/requisitionEmailRecipients.js'

export async function getRequisitionsByEmployeeId(employeeId) {
  return executeQuery(
    'SELECT r.* FROM requisition r WHERE r.req_emp_id = $1 ORDER BY r.req_created_at DESC',
    [employeeId]
  )
}

export async function getRequisitionItemsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery(
    'SELECT item_id, req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks, item_tax_amount FROM requisition_items WHERE req_id = ANY($1)',
    [reqIds]
  )
}

export async function getTrackRecordsCount(includeHidden = false) {
  const whereClause = includeHidden ? '' : 'WHERE COALESCE(r.is_hidden, FALSE) = FALSE'
  const r = await executeQuery(`
    SELECT COUNT(*) AS total FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
    ${whereClause}
  `)
  return parseInt(r[0]?.total ?? 0, 10)
}

export async function getTrackRecordsAll(limit, offset, includeHidden = false) {
  const whereClause = includeHidden ? '' : 'WHERE COALESCE(r.is_hidden, FALSE) = FALSE'
  return executeQuery(`
    SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
    FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
    ${whereClause}
    ORDER BY r.req_created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset])
}

export async function getTrackRecordsByEmployee(employeeId, limit, offset, search, includeHidden = false) {
  const hasSearch = search != null && String(search).trim() !== ''
  const pattern = hasSearch ? '%' + String(search).trim() + '%' : null
  const hiddenClause = includeHidden ? '' : 'AND COALESCE(r.is_hidden, FALSE) = FALSE'
  if (hasSearch) {
    return executeQuery(
      `SELECT r.* FROM requisition r WHERE r.req_emp_id = $1
       AND (r.req_reference_no ILIKE $2 OR COALESCE(r.req_material, '') ILIKE $2)
       ${hiddenClause}
       ORDER BY r.req_created_at DESC
       LIMIT $3 OFFSET $4`,
      [employeeId, pattern, limit, offset]
    )
  }
  return executeQuery(
    `SELECT r.* FROM requisition r WHERE r.req_emp_id = $1
     ${hiddenClause}
     ORDER BY r.req_created_at DESC
     LIMIT $2 OFFSET $3`,
    [employeeId, limit, offset]
  )
}

export async function getTrackRecordsCountByEmployee(employeeId, search, includeHidden = false) {
  const hasSearch = search != null && String(search).trim() !== ''
  const pattern = hasSearch ? '%' + String(search).trim() + '%' : null
  const hiddenClause = includeHidden ? '' : 'AND COALESCE(r.is_hidden, FALSE) = FALSE'
  if (hasSearch) {
    const r = await executeQuery(
      `SELECT COUNT(*) AS total FROM requisition r WHERE r.req_emp_id = $1 AND (r.req_reference_no ILIKE $2 OR COALESCE(r.req_material, \'\') ILIKE $2) ${hiddenClause}`,
      [employeeId, pattern]
    )
    return parseInt(r[0]?.total ?? 0, 10)
  }
  const r = await executeQuery(`SELECT COUNT(*) AS total FROM requisition r WHERE r.req_emp_id = $1 ${hiddenClause}`, [employeeId])
  return parseInt(r[0]?.total ?? 0, 10)
}

export async function getItemCountsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery(
    'SELECT req_id, COUNT(*) AS cnt FROM requisition_items WHERE req_id = ANY($1) GROUP BY req_id',
    [reqIds]
  )
}

/** Employee ids that belong to a department (by employees.department_id) ∪ its HOD(s). */
export async function getDepartmentMemberIds(departmentId) {
  if (departmentId == null) return []
  const rows = await executeQuery(
    `SELECT employee_id FROM employees WHERE department_id = $1
     UNION
     SELECT employee_id FROM employee_hod_departments WHERE department_id = $1`,
    [departmentId]
  )
  return rows.map(r => parseInt(r.employee_id, 10)).filter(n => !Number.isNaN(n))
}

/** Track records for a set of employee ids (department-wide view). Same row shape as
 *  getTrackRecordsByEmployee but joins the creator name. Excludes hidden rows. */
export async function getTrackRecordsByMembers(memberIds, limit, offset, search) {
  if (!memberIds || memberIds.length === 0) return []
  const hasSearch = search != null && String(search).trim() !== ''
  const pattern = hasSearch ? '%' + String(search).trim() + '%' : null
  const nameExpr = `TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))`
  if (hasSearch) {
    return executeQuery(
      `SELECT r.*, ${nameExpr} AS creator_name, e.employee_code AS creator_code
       FROM requisition r JOIN employees e ON e.employee_id = r.req_emp_id
       WHERE r.req_emp_id = ANY($1) AND COALESCE(r.is_hidden, FALSE) = FALSE
         AND (r.req_reference_no ILIKE $2 OR COALESCE(r.req_material, '') ILIKE $2 OR ${nameExpr} ILIKE $2)
       ORDER BY r.req_created_at DESC
       LIMIT $3 OFFSET $4`,
      [memberIds, pattern, limit, offset]
    )
  }
  return executeQuery(
    `SELECT r.*, ${nameExpr} AS creator_name, e.employee_code AS creator_code
     FROM requisition r JOIN employees e ON e.employee_id = r.req_emp_id
     WHERE r.req_emp_id = ANY($1) AND COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY r.req_created_at DESC
     LIMIT $2 OFFSET $3`,
    [memberIds, limit, offset]
  )
}

export async function getTrackRecordsCountByMembers(memberIds, search) {
  if (!memberIds || memberIds.length === 0) return 0
  const hasSearch = search != null && String(search).trim() !== ''
  const pattern = hasSearch ? '%' + String(search).trim() + '%' : null
  const nameExpr = `TRIM(CONCAT(COALESCE(e.first_name, ''), ' ', COALESCE(e.last_name, '')))`
  if (hasSearch) {
    const r = await executeQuery(
      `SELECT COUNT(*) AS total FROM requisition r JOIN employees e ON e.employee_id = r.req_emp_id
       WHERE r.req_emp_id = ANY($1) AND COALESCE(r.is_hidden, FALSE) = FALSE
         AND (r.req_reference_no ILIKE $2 OR COALESCE(r.req_material, '') ILIKE $2 OR ${nameExpr} ILIKE $2)`,
      [memberIds, pattern]
    )
    return parseInt(r[0]?.total ?? 0, 10)
  }
  const r = await executeQuery(
    `SELECT COUNT(*) AS total FROM requisition r
     WHERE r.req_emp_id = ANY($1) AND COALESCE(r.is_hidden, FALSE) = FALSE`,
    [memberIds]
  )
  return parseInt(r[0]?.total ?? 0, 10)
}

export async function createRequisition(employeeId, location, material, requiredByDate, business, creatorRole, category, loanAdvanceType = null, loanAdvanceAmount = null, loanAdvanceReason = null, loanInstallmentMonths = null, isUrgent = false, urgentDate = null) {
  // Use RETURNING clause to get the inserted row directly - eliminates race condition
  const hasLoanFields = loanAdvanceType || loanAdvanceAmount || loanAdvanceReason || loanInstallmentMonths

  if (hasLoanFields) {
    const r = await executeQuery(
      `INSERT INTO requisition (req_emp_id, req_location, req_material, req_required_by_date, req_business, req_creator_role, req_category,
        loan_advance_type, loan_advance_amount, loan_advance_reason, loan_installment_months, req_is_urgent, req_urgent_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING req_id, req_reference_no`,
      [employeeId, location || null, material || null, requiredByDate || null, business || 'iTecknologi Tracking Pvt. Ltd', creatorRole || null, category || null,
        loanAdvanceType || null, loanAdvanceAmount || null, loanAdvanceReason || null, loanInstallmentMonths || null,
        isUrgent ? 1 : 0, isUrgent ? (urgentDate || null) : null]
    )
    return r[0]
  }

  const r = await executeQuery(
    `INSERT INTO requisition (req_emp_id, req_location, req_material, req_required_by_date, req_business, req_creator_role, req_category, req_is_urgent, req_urgent_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING req_id, req_reference_no`,
    [employeeId, location || null, material || null, requiredByDate || null, business || 'iTecknologi Tracking Pvt. Ltd', creatorRole || null, category || null,
      isUrgent ? 1 : 0, isUrgent ? (urgentDate || null) : null]
  )
  return r[0]
}

function rowParamsFromItem(item) {
  const desc = item.itemProductDescription || item.itemDesc || item.item_desc || null
  const size = item.itemSize || item.item_size || null
  const brand = item.itemBrand || item.item_brand || null
  const qty = item.itemQty ?? item.item_qty ?? 1
  const cost = item.itemEstCost || item.item_est_cost || null
  const remarks = item.itemRemarks || item.item_remarks || null
  return { desc, size, brand, qty, cost, remarks }
}

export async function insertRequisitionItem(reqId, item) {
  const r = rowParamsFromItem(item)
  return executeQuery(
    `INSERT INTO requisition_items (req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [reqId, r.desc, r.size, r.brand, r.qty, r.cost, r.remarks]
  )
}

/** Batch insert requisition items (one round-trip). */
export async function insertRequisitionItemsBatch(reqId, items) {
  if (!items || items.length === 0) return
  const values = []
  const params = []
  let i = 0
  for (const item of items) {
    const r = rowParamsFromItem(item)
    const base = i * 7
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`)
    params.push(reqId, r.desc, r.size, r.brand, r.qty, r.cost, r.remarks)
    i++
  }
  await executeQuery(
    `INSERT INTO requisition_items (req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks)
     VALUES ${values.join(', ')}`,
    params
  )
}

/**
 * Atomically insert the requisition row AND its items in a single transaction.
 * If the items insert fails (e.g. a value exceeds a column length), the requisition row is
 * rolled back too — no orphan row is left behind. Returns { req_id, req_reference_no }.
 */
export async function createRequisitionWithItems(args, items = []) {
  const {
    employeeId, location, material, requiredByDate, business, creatorRole, category,
    loanAdvanceType = null, loanAdvanceAmount = null, loanAdvanceReason = null,
    loanInstallmentMonths = null, isUrgent = false, urgentDate = null
  } = args
  const hasLoanFields = loanAdvanceType || loanAdvanceAmount || loanAdvanceReason || loanInstallmentMonths

  return executeTransaction(async (client) => {
    let created
    if (hasLoanFields) {
      const r = await client.query(
        `INSERT INTO requisition (req_emp_id, req_location, req_material, req_required_by_date, req_business, req_creator_role, req_category,
          loan_advance_type, loan_advance_amount, loan_advance_reason, loan_installment_months, req_is_urgent, req_urgent_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING req_id, req_reference_no`,
        [employeeId, location || null, material || null, requiredByDate || null, business || 'iTecknologi Tracking Pvt. Ltd', creatorRole || null, category || null,
          loanAdvanceType || null, loanAdvanceAmount || null, loanAdvanceReason || null, loanInstallmentMonths || null,
          isUrgent ? 1 : 0, isUrgent ? (urgentDate || null) : null]
      )
      created = r.rows[0]
    } else {
      const r = await client.query(
        `INSERT INTO requisition (req_emp_id, req_location, req_material, req_required_by_date, req_business, req_creator_role, req_category, req_is_urgent, req_urgent_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING req_id, req_reference_no`,
        [employeeId, location || null, material || null, requiredByDate || null, business || 'iTecknologi Tracking Pvt. Ltd', creatorRole || null, category || null,
          isUrgent ? 1 : 0, isUrgent ? (urgentDate || null) : null]
      )
      created = r.rows[0]
    }

    if (items && items.length > 0) {
      const reqId = created.req_id
      const valueGroups = []
      const params = []
      let i = 0
      for (const item of items) {
        const rp = rowParamsFromItem(item)
        const base = i * 7
        valueGroups.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`)
        params.push(reqId, rp.desc, rp.size, rp.brand, rp.qty, rp.cost, rp.remarks)
        i++
      }
      await client.query(
        `INSERT INTO requisition_items (req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks)
         VALUES ${valueGroups.join(', ')}`,
        params
      )
    }

    return created
  })
}

export async function getCreatorDepartment(employeeId) {
  const r = await executeQuery(
    'SELECT department_id FROM employees WHERE employee_id = $1',
    [employeeId]
  )
  return r[0]?.department_id ?? null
}

export async function autoAdvanceCommitteeRequisition(reqId) {
  return executeQuery(
    `UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP,
      req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP, req_creator_role = 'Committee' WHERE req_id = $1`,
    [reqId]
  )
}

export async function autoAdvanceHodRequisition(reqId, approverEmployeeId) {
  return executeQuery(
    `UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP, req_hod_approved_by = $2, req_creator_role = 'HOD' WHERE req_id = $1`,
    [reqId, approverEmployeeId]
  )
}

/** Set HOD approval only (for category flow: hod_for_info ? no creator role change). */
export async function setHodApprovalForInfoOnly(reqId, approverEmployeeId) {
  return executeQuery(
    'UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP, req_hod_approved_by = $2 WHERE req_id = $1',
    [reqId, approverEmployeeId]
  )
}

export async function autoAdvanceCeoRequisition(reqId) {
  return executeQuery(
    `UPDATE requisition SET 
      req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP,
      req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP,
      req_ceo_approval = 1, req_ceo_approval_date = CURRENT_TIMESTAMP,
      req_creator_role = 'CEO' 
     WHERE req_id = $1`,
    [reqId]
  )
}

export async function getCreatorForQueue(employeeId) {
  const r = await executeQuery(
    `SELECT e.employee_id, e.first_name, e.last_name, e.email, e.department_id, d.department_name
     FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
  return r[0] || null
}

// Role helpers: check employee_hod_departments first, then fall back to employee_type/designation
export async function getHodByDepartment(departmentId) {
  if (departmentId == null) return null
  try {
    const hodRows = await executeQuery(
      'SELECT h.employee_id FROM employee_hod_departments h INNER JOIN employees e ON e.employee_id = h.employee_id AND e.is_active = true WHERE h.department_id = $1 LIMIT 1',
      [departmentId]
    )
    if (hodRows[0]?.employee_id != null) return parseInt(hodRows[0].employee_id, 10)
  } catch (err) {
    if (err.code !== '42P01') { /* table may not exist */ }
  }
  try {
    const q = `
      SELECT e.employee_id FROM employees e
      LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
      LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
      WHERE e.department_id = $1 AND e.is_active = true
        AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
      LIMIT 1
    `
    const rows = await executeQuery(q, [departmentId])
    if (rows[0]?.employee_id != null) return parseInt(rows[0].employee_id, 10)
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  try {
    const q2 = `
      SELECT e.employee_id FROM employees e
      INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
      WHERE e.department_id = $1 AND e.is_active = true LIMIT 1
    `
    const rows = await executeQuery(q2, [departmentId])
    return rows[0]?.employee_id != null ? parseInt(rows[0].employee_id, 10) : null
  } catch (err) {
    if (err.code === '42P01') return null
    throw err
  }
}

/** Returns HOD email(s) for a department from CRM SQL Server USERS.EMAIL (by employee_code). */
export async function getHodEmailsForDepartment(departmentId) {
  if (departmentId == null) return []
  let codes = []
  try {
    const rows = await executeQuery(
      `SELECT e.employee_code FROM employees e
       LEFT JOIN employee_hod_departments h ON h.employee_id = e.employee_id AND h.department_id = $1
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
       WHERE e.department_id = $1 AND e.is_active = true AND e.employee_code IS NOT NULL AND e.employee_code != ''
         AND (h.employee_id IS NOT NULL OR et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)
       LIMIT 5`,
      [departmentId]
    )
    codes = (rows || []).map(r => r.employee_code).filter(Boolean)
  } catch (err) {
    if (err.code === '42P01') return []
  }
  if (codes.length === 0) {
    try {
      const rows = await executeQuery(
        `SELECT e.employee_code FROM employees e
         INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
         WHERE e.department_id = $1 AND e.is_active = true AND e.employee_code IS NOT NULL LIMIT 5`,
        [departmentId]
      )
      codes = (rows || []).map(r => r.employee_code).filter(Boolean)
    } catch (err) {
      if (err.code === '42P01') return []
    }
  }
  if (codes.length === 0) return []
  return resolveEmailsPreferCrmForCodes(codes)
}

/**
 * Get ALL departments where this employee is the HOD.
 * Checks employee_hod_departments first (explicit multi-dept assignments),
 * then falls back to checking their primary department via employee_type/designation.
 * @returns {Array<{department_id: number, department_name: string}>}
 */
export async function getHodDepartmentsForEmployee(employeeId) {
  if (employeeId == null) return []
  const results = []
  const seenIds = new Set()

  // 1. Explicit HOD assignments from employee_hod_departments
  try {
    const rows = await executeQuery(
      `SELECT h.department_id, d.department_name
       FROM employee_hod_departments h
       JOIN departments d ON d.department_id = h.department_id
       WHERE h.employee_id = $1`,
      [employeeId]
    )
    for (const row of rows) {
      if (row.department_id != null && !seenIds.has(row.department_id)) {
        seenIds.add(row.department_id)
        results.push({ department_id: row.department_id, department_name: row.department_name || '' })
      }
    }
  } catch (err) {
    if (err.code !== '42P01') throw err
  }

  // 2. Fallback: HOD by employee_type or designation in their own department
  if (results.length === 0) {
    try {
      const rows = await executeQuery(
        `SELECT e.department_id, d.department_name
         FROM employees e
         LEFT JOIN departments d ON d.department_id = e.department_id
         LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
         LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
         WHERE e.employee_id = $1 AND e.is_active = true
           AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
        [employeeId]
      )
      for (const row of rows) {
        if (row.department_id != null && !seenIds.has(row.department_id)) {
          seenIds.add(row.department_id)
          results.push({ department_id: row.department_id, department_name: row.department_name || '' })
        }
      }
    } catch (_) {}
  }

  return results
}

/** True if this employee is HOD of this department (employee_hod_departments first, then by type or designation). */
export async function isHodOfDepartment(employeeId, departmentId) {
  if (employeeId == null || departmentId == null) return false
  try {
    const hodRows = await executeQuery(
      'SELECT 1 FROM employee_hod_departments WHERE employee_id = $1 AND department_id = $2 LIMIT 1',
      [employeeId, departmentId]
    )
    if (hodRows.length > 0) return true
  } catch (err) {
    if (err.code !== '42P01') { /* table may not exist */ }
  }
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'HOD'
       WHERE e.employee_id = $1 AND e.department_id = $2 AND e.is_active = true
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId, departmentId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HOD'
           WHERE e.employee_id = $1 AND e.department_id = $2 AND e.is_active = true`,
          [employeeId, departmentId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

export async function isCommitteeMember(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Committee'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'Committee'
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Committee' WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

export async function isCeoMember(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'CEO'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'CEO'
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'CEO' WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

/** True if employee is CEO, COO, or Director (by employee_type or designation). Used so their leave goes direct to HR. */
export async function isSeniorExecutiveForLeave(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
         AND (et.emp_type_name IN ('CEO', 'COO', 'Director'))
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
         AND (desg.desg_name ILIKE '%CEO%' OR desg.desg_name ILIKE '%COO%' OR desg.desg_name ILIKE '%Director%')
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e
           INNER JOIN designation desg ON e.designation_id = desg.desg_id
             AND (desg.desg_name ILIKE '%CEO%' OR desg.desg_name ILIKE '%COO%' OR desg.desg_name ILIKE '%Director%')
           WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

export async function isProcurementMember(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Procurement'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'Procurement'
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Procurement' WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

export async function isFinanceHod(employeeId) {
  try {
    // Use ILIKE for flexible matching (Finance, Finance HOD, Finance Manager, etc.)
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name ILIKE '%finance%'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name ILIKE '%finance%'
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name ILIKE '%finance%' WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

/** True if employee is HR (employee_type or designation contains HR) or has portal role Admin/Staff (can view all leaves). */
export async function isHrMember(employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HR'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND (desg.desg_name ILIKE '%HR%' OR desg.desg_name = 'Human Resource')
       WHERE e.employee_id = $1
         AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const byType = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'HR' WHERE e.employee_id = $1`,
          [employeeId]
        )
        if (byType.length > 0) return true
        const byDesg = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN designation desg ON e.designation_id = desg.desg_id AND (desg.desg_name ILIKE '%HR%' OR desg.desg_name = 'Human Resource') WHERE e.employee_id = $1`,
          [employeeId]
        )
        return byDesg.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

/** True if employee is Admin (employee_type or designation). For execution_admin categories. */
export async function isAdminMember(employeeId) {
  try {
    // "Admin" here means the Administration department's approver — NOT anyone whose job title
    // contains "admin". A loose desg_name ILIKE '%Admin%' wrongly matched IT staff such as
    // "IT Administrator" / "Senior System Network Administrator". So: match the 'Admin' employee
    // type, OR an admin-titled person who is actually in the Administration department.
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       WHERE e.employee_id = $1
         AND (
           et.emp_type_name ILIKE 'Admin'
           OR (desg.desg_name ILIKE '%Admin%' AND d.department_name ILIKE 'Administration')
         )`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') return false
    throw err
  }
}

/** True if this employee is the HOD of any department (explicit employee_hod_departments). */
export async function isHodEmployee(employeeId) {
  if (employeeId == null) return false
  try {
    const rows = await executeQuery(
      'SELECT 1 FROM employee_hod_departments WHERE employee_id = $1 LIMIT 1',
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') return false
    throw err
  }
}

/** All distinct employee ids that are an HOD of some department. */
export async function getAllHodEmployeeIds() {
  try {
    const rows = await executeQuery('SELECT DISTINCT employee_id FROM employee_hod_departments')
    return rows.map(r => parseInt(r.employee_id, 10)).filter(n => !Number.isNaN(n))
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

export async function getRequisitionAndDepartment(requisitionId) {
  return executeQuery(
    'SELECT r.req_id, r.req_category, r.req_current_stage_key, r.loan_advance_amount, r.req_hr_approved_amount, e.department_id FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id WHERE r.req_id = $1',
    [requisitionId]
  )
}

export async function rejectRequisition(requisitionId, reason, stageKey) {
  const params = [requisitionId]
  const sets = ['req_is_rejected = 1', 'req_current_stage_key = NULL']
  if (reason) {
    params.push(String(reason).trim())
    sets.push(`req_rejection_reason = $${params.length}`)
  }
  if (stageKey) {
    params.push(String(stageKey).trim().toLowerCase())
    sets.push(`req_rejection_stage = $${params.length}`)
  }
  try {
    return await executeQuery(
      `UPDATE requisition SET ${sets.join(', ')} WHERE req_id = $1`,
      params
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery('UPDATE requisition SET req_is_rejected = 1 WHERE req_id = $1', [requisitionId])
    }
    throw err
  }
}

export async function updateItemHodBoq(itemId, reqId, size, brand, qty, estCost) {
  return executeQuery(
    `UPDATE requisition_items SET
       item_size = $1, item_brand = $2, item_qty = $3, item_est_cost = $4,
       hod_item_size = $1, hod_item_brand = $2, hod_item_qty = $3, hod_item_est_cost = $4
     WHERE item_id = $5 AND req_id = $6`,
    [size || null, brand || null, (qty != null && !Number.isNaN(qty)) ? qty : null, estCost || null, itemId, reqId]
  )
}

/** Delete a single requisition item. Only for items belonging to reqId. */
export async function deleteRequisitionItem(itemId, reqId) {
  return executeQuery(
    `DELETE FROM requisition_items WHERE item_id = $1 AND req_id = $2`,
    [itemId, reqId]
  )
}

/** Update a single requisition item (description, size, brand, qty, est_cost, remarks). Only for items belonging to reqId. */
export async function updateRequisitionItem(itemId, reqId, payload) {
  const { item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks } = payload
  return executeQuery(
    `UPDATE requisition_items SET
       item_desc = $1, item_size = $2, item_brand = $3, item_qty = $4, item_est_cost = $5, item_remarks = $6
     WHERE item_id = $7 AND req_id = $8`,
    [item_desc ?? null, item_size ?? null, item_brand ?? null, item_qty ?? null, item_est_cost ?? null, item_remarks ?? null, itemId, reqId]
  )
}

export async function approveHod(requisitionId, approverEmployeeId) {
  return executeQuery(
    'UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP, req_hod_approved_by = $2 WHERE req_id = $1',
    [requisitionId, approverEmployeeId]
  )
}

/** IT stage: record the forward action with timestamp + approver id. */
export async function approveIt(requisitionId, employeeId) {
  return executeQuery(
    'UPDATE requisition SET req_it_approval = 1, req_it_approval_date = CURRENT_TIMESTAMP, req_it_approved_by = $2 WHERE req_id = $1',
    [requisitionId, employeeId ?? null]
  )
}

/** IT stage: replace all items for a requisition with the provided rows.
 *  Used when IT translates the employee's description into structured items.
 *  Each item: { itemDesc, itemSize, itemBrand, itemQty, itemEstCost, itemRemarks }. */
export async function replaceRequisitionItems(requisitionId, items) {
  const safeItems = Array.isArray(items) ? items : []
  
  // Pehle delete karo
  await executeQuery('DELETE FROM requisition_items WHERE req_id = $1', [requisitionId])
  
  // Phir insert karo one by one
  for (const it of safeItems) {
    const desc = String(it.item_desc ?? it.itemDesc ?? '').slice(0, 255)
    const size = it.item_size ?? it.itemSize ?? null
    const brand = it.item_brand ?? it.itemBrand ?? null
    const qty = parseInt(it.item_qty ?? it.itemQty ?? 0, 10) || 0
    const cost = it.item_est_cost ?? it.itemEstCost ?? null
    const remarks = it.item_remarks ?? it.itemRemarks ?? null
    await executeQuery(
      `INSERT INTO requisition_items
         (req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [requisitionId, desc, size, brand, qty, cost == null ? null : String(cost), remarks]
    )
  }
  
  return { replaced: safeItems.length }
}

export async function approveHr(requisitionId) {
  try {
    return await executeQuery(
      'UPDATE requisition SET req_hr_approval = 1, req_hr_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1',
      [requisitionId]
    )
  } catch (err) {
    if (err.code === '42703') return [] // column not yet added
    throw err
  }
}

export async function saveHrApprovedAmount(reqId, amount) {
  await executeQuery(
    `UPDATE requisition SET req_hr_approved_amount = $1 WHERE req_id = $2`,
    [amount, reqId]
  )
}

export async function saveHrEmploymentStatus(reqId, status) {
  try {
    await executeQuery(
      `UPDATE requisition SET req_employment_status = $1 WHERE req_id = $2`,
      [status, reqId]
    )
  } catch (err) {
    if (err.code === '42703') return
    throw err
  }
}

export async function saveHrApprovedInstallments(reqId, installments) {
  try {
    await executeQuery(
      `UPDATE requisition SET req_hr_approved_installments = $1 WHERE req_id = $2`,
      [installments, reqId]
    )
  } catch (err) {
    if (err.code === '42703') return
    throw err
  }
}

/**
 * Persist all editable HR "Section 3" fields in one UPDATE (Loan & Advance Salary).
 * `fields` keys are optional; only provided (non-undefined) keys are written so a partial
 * save never clobbers other columns. Returns silently if the columns aren't migrated yet (42703).
 */
export async function saveHrSection3(reqId, fields) {
  const colByKey = {
    approvedAmount: 'req_hr_approved_amount',
    employmentStatus: 'req_employment_status',
    approvedInstallments: 'req_hr_approved_installments',
    outstandingLoan: 'req_hr_outstanding_loan',
    loanStatus: 'req_hr_loan_status',
    installmentStartDate: 'req_hr_installment_start_date'
  }
  const sets = []
  const values = []
  let i = 1
  for (const [key, col] of Object.entries(colByKey)) {
    if (fields[key] !== undefined) {
      sets.push(`${col} = $${i}`)
      values.push(fields[key])
      i++
    }
  }
  if (sets.length === 0) return
  values.push(reqId)
  try {
    await executeQuery(
      `UPDATE requisition SET ${sets.join(', ')} WHERE req_id = $${i}`,
      values
    )
  } catch (err) {
    if (err.code === '42703') return // columns not yet migrated
    throw err
  }
}

export async function approveHrCheck(reqId, eid) {
  await executeQuery(
    `UPDATE requisition
     SET req_hr_check_approved_by = $1,
         req_hr_check_approved_at = NOW()
     WHERE req_id = $2`,
    [eid, reqId]
  )
}

/** Save the captured loan-form PDF (base64 data URL) for later attachment / audit. */
export async function saveLoanFormPdf(reqId, dataUrl) {
  try {
    await executeQuery(
      `UPDATE requisition SET req_loan_form_pdf_url = $1 WHERE req_id = $2`,
      [dataUrl, reqId]
    )
  } catch (err) {
    if (err.code === '42703') return
    throw err
  }
}

/** Admin approves (e.g. Stationary/Vehicle Maintenance after HOD For Info). Sets stage to null (done). */
export async function approveAdmin(requisitionId) {
  try {
    return await executeQuery(
      'UPDATE requisition SET req_admin_approval = 1, req_admin_approval_date = CURRENT_TIMESTAMP, req_current_stage_key = NULL WHERE req_id = $1',
      [requisitionId]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/** Legacy: HOD ? Procurement without Committee. No longer called from service (Committee is always in path after HOD for BOQ categories). */
export async function approveHodDirectToProcurement(requisitionId) {
  try {
    return executeQuery(
      `UPDATE requisition SET
         req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP,
         req_hr_approval = 1, req_hr_approval_date = CURRENT_TIMESTAMP,
         req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP,
         req_ceo_approval = 1, req_ceo_approval_date = CURRENT_TIMESTAMP
       WHERE req_id = $1`,
      [requisitionId]
    )
  } catch (err) {
    if (err.code === '42703') {
      return executeQuery(
        `UPDATE requisition SET
           req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP,
           req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP,
           req_ceo_approval = 1, req_ceo_approval_date = CURRENT_TIMESTAMP
         WHERE req_id = $1`,
        [requisitionId]
      )
    }
    throw err
  }
}

export async function updateItemCommitteeApprovedQty(itemId, qty) {
  return executeQuery(
    'UPDATE requisition_items SET committee_approved_qty = $1 WHERE item_id = $2',
    [qty, itemId]
  )
}

/** Set the per-item sales tax amount (PKR). Pass null to clear it. */
export async function updateItemTaxAmount(itemId, taxAmount) {
  return executeQuery(
    'UPDATE requisition_items SET item_tax_amount = $1 WHERE item_id = $2',
    [taxAmount, itemId]
  )
}

/** Latest sales tax rate as a fraction (e.g. 0.18). Falls back to 0.18. */
export async function getCurrentSalesTaxRate() {
  try {
    const r = await executeQuery('SELECT rate_percent FROM sales_tax_rate ORDER BY id DESC LIMIT 1')
    const pct = r && r[0] ? Number(r[0].rate_percent) : null
    return (pct != null && !Number.isNaN(pct)) ? pct / 100 : 0.18
  } catch (_) {
    return 0.18
  }
}

/** Full rate history, newest first, with changer name. */
export async function getSalesTaxRateHistory() {
  return executeQuery(
    `SELECT s.id, s.rate_percent, s.created_at, s.created_by,
            e.first_name, e.last_name
       FROM sales_tax_rate s
       LEFT JOIN employees e ON e.employee_id = s.created_by
      ORDER BY s.id DESC`
  )
}

/** Insert a new rate row (append-only). */
export async function addSalesTaxRate(ratePercent, employeeId) {
  return executeQuery(
    'INSERT INTO sales_tax_rate (rate_percent, created_by) VALUES ($1, $2)',
    [ratePercent, employeeId ?? null]
  )
}

/** Latest sales tax rate row { id, rate_percent } (or null if none). */
export async function getCurrentSalesTaxRateRow() {
  try {
    const r = await executeQuery('SELECT id, rate_percent FROM sales_tax_rate ORDER BY id DESC LIMIT 1')
    return (r && r[0]) ? { id: r[0].id, rate_percent: Number(r[0].rate_percent) } : null
  } catch (_) {
    return null
  }
}

/** Record which sales tax rate (id + percent snapshot) was applied to a requisition. Pass nulls to clear. */
export async function updateRequisitionTaxRate(reqId, rateId, ratePercent) {
  return executeQuery(
    'UPDATE requisition SET req_tax_rate_id = $1, req_tax_rate_percent = $2 WHERE req_id = $3',
    [rateId ?? null, ratePercent ?? null, reqId]
  )
}

export async function approveCommittee(requisitionId, employeeId) {
  return executeQuery(
    'UPDATE requisition SET req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP, req_committee_approved_by = $2 WHERE req_id = $1',
    [requisitionId, employeeId ?? null]
  )
}

export async function approveCeo(requisitionId, employeeId) {
  return executeQuery(
    'UPDATE requisition SET req_ceo_approval = 1, req_ceo_approval_date = CURRENT_TIMESTAMP, req_ceo_approved_by = $2 WHERE req_id = $1',
    [requisitionId, employeeId ?? null]
  )
}

export async function acknowledgeProcurement(requisitionId, employeeId) {
  return executeQuery(
    'UPDATE requisition SET req_procurement_ack = 1, req_procurement_ack_date = CURRENT_TIMESTAMP, req_procurement_ack_by = $2 WHERE req_id = $1',
    [requisitionId, employeeId]
  )
}

export async function updateQuotations(reqId, quotation1Url, quotation2Url, quotation3Url) {
  return executeQuery(
    `UPDATE requisition SET req_quotation_1_url = COALESCE($2, req_quotation_1_url), req_quotation_2_url = COALESCE($3, req_quotation_2_url), req_quotation_3_url = COALESCE($4, req_quotation_3_url) WHERE req_id = $1`,
    [reqId, quotation1Url || null, quotation2Url || null, quotation3Url || null]
  )
}

export async function updateQuotationsUpload(reqId, url1, url2, url3) {
  return executeQuery(
    `UPDATE requisition SET req_quotation_1_url = $2, req_quotation_2_url = $3, req_quotation_3_url = $4 WHERE req_id = $1`,
    [reqId, url1, url2, url3]
  )
}

export async function setExpectedHandover(reqId, dateVal) {
  return executeQuery('UPDATE requisition SET req_expected_handover_date = $2 WHERE req_id = $1', [reqId, dateVal])
}

export async function updateRequiredByDate(reqId, dateVal) {
  return executeQuery('UPDATE requisition SET req_required_by_date = $2 WHERE req_id = $1', [reqId, dateVal])
}

/** Requisitions finance-approved, not yet completed, category has execution_admin=1 (for Admin to mark complete). */
export async function getPendingAdminExecutionRequisitions() {
  try {
    return executeQuery(
      `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
        desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       JOIN requisition_category c ON TRIM(COALESCE(c.name, '')) = TRIM(COALESCE(r.req_category, '')) AND c.execution_admin = 1
       WHERE COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE AND COALESCE(r.req_finance_approval, 0) = 1 AND COALESCE(r.req_purchase_completed, 0) = 0
       ORDER BY r.req_created_at ASC`
    )
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

/** Requisition eligible for Procurement to mark complete (finance approved, not rejected). */
export async function getRequisitionForCompletePurchase(reqId) {
  return executeQuery(
    'SELECT req_id, req_forwarded_to_payable_at FROM requisition WHERE req_id = $1 AND COALESCE(req_is_rejected, 0) = 0 AND COALESCE(req_finance_approval, 0) = 1',
    [reqId]
  )
}

export async function updatePurchaseCompleted(reqId, completedByEmployeeId) {
  return executeQuery(
    'UPDATE requisition SET req_purchase_completed = 1, req_purchase_completed_date = CURRENT_TIMESTAMP, req_purchase_completed_by = $2 WHERE req_id = $1',
    [reqId, completedByEmployeeId]
  )
}

/** Requisitions completed by Procurement, pending HOD acknowledgment — only where the HOD is the creator. */
export async function getPendingHodAcknowledgeList(deptId, deptName, hodEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND COALESCE(r.req_purchase_completed, 0) = 1
       AND COALESCE(r.req_hod_acknowledged, 0) = 0
       AND COALESCE(r.req_creator_acknowledged, 0) = 0
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
       AND r.req_emp_id = $3
     ORDER BY r.req_purchase_completed_date DESC`,
    [deptId, deptName, hodEmployeeId]
  )
}

/** Single requisition pending HOD acknowledgment (purchase completed, not yet acknowledged). */
export async function getRequisitionForHodAcknowledge(reqId) {
  return executeQuery(
    `SELECT r.req_id, r.req_emp_id, r.req_creator_role, e.department_id, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE r.req_id = $1 AND COALESCE(r.is_hidden, FALSE) = FALSE AND COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.req_purchase_completed, 0) = 1 AND COALESCE(r.req_hod_acknowledged, 0) = 0 AND COALESCE(r.req_creator_acknowledged, 0) = 0`,
    [reqId]
  )
}

export async function updateHodAcknowledged(reqId, acknowledgedByEmployeeId) {
  return executeQuery(
    'UPDATE requisition SET req_hod_acknowledged = 1, req_hod_acknowledged_date = CURRENT_TIMESTAMP, req_hod_acknowledged_by = $2 WHERE req_id = $1',
    [reqId, acknowledgedByEmployeeId]
  )
}

/** Requisitions created by employeeId where execution is done but creator has not acknowledged (close ticket). */
export async function getPendingCreatorAcknowledgeList(employeeId) {
  try {
    return executeQuery(
      `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
        desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       WHERE r.req_emp_id = $1 AND COALESCE(r.is_hidden, FALSE) = FALSE
         AND COALESCE(r.req_is_rejected, 0) = 0
         AND COALESCE(r.req_creator_acknowledged, 0) = 0
         AND (
           COALESCE(r.req_admin_approval, 0) = 1
           OR COALESCE(r.req_purchase_completed, 0) = 1
           OR (COALESCE(r.req_finance_approval, 0) = 1 AND TRIM(COALESCE(r.req_category, '')) ILIKE '%Loan%')
           OR r.req_hr_check_approved_by IS NOT NULL
         )
       ORDER BY r.req_created_at DESC`,
      [employeeId]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/** Single req eligible for creator acknowledge: created by employeeId, execution done, not yet acknowledged. */
export async function getRequisitionForCreatorAcknowledge(reqId, employeeId) {
  try {
    const rows = await executeQuery(
      `SELECT r.req_id, r.req_emp_id FROM requisition r
       WHERE r.req_id = $1 AND r.req_emp_id = $2
         AND COALESCE(r.req_is_rejected, 0) = 0
         AND COALESCE(r.req_creator_acknowledged, 0) = 0
         AND (
           COALESCE(r.req_admin_approval, 0) = 1
           OR COALESCE(r.req_purchase_completed, 0) = 1
           OR (COALESCE(r.req_finance_approval, 0) = 1 AND TRIM(COALESCE(r.req_category, '')) ILIKE '%Loan%')
           OR r.req_hr_check_approved_by IS NOT NULL
         )`,
      [reqId, employeeId]
    )
    return rows
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

export async function updateCreatorAcknowledged(reqId) {
  try {
    return executeQuery(
      'UPDATE requisition SET req_creator_acknowledged = 1, req_creator_acknowledged_date = CURRENT_TIMESTAMP WHERE req_id = $1',
      [reqId]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

export async function handoverToFinance(requisitionId) {
  return executeQuery(
    'UPDATE requisition SET req_handed_to_finance = 1, req_handed_to_finance_date = CURRENT_TIMESTAMP WHERE req_id = $1',
    [requisitionId]
  )
}

export async function approveFinance(requisitionId, employeeId, quotationIndex) {
  return executeQuery(
    'UPDATE requisition SET req_finance_approval = 1, req_finance_approval_date = CURRENT_TIMESTAMP, req_finance_approved_by = $2, req_approved_quotation_index = $3 WHERE req_id = $1',
    [requisitionId, employeeId, quotationIndex]
  )
}

export async function getRequisitionById(reqId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE r.req_id = $1`,
    [reqId]
  )
}

/** Toggle the is_hidden status for a requisition (soft delete/restore). */
export async function toggleRequisitionHidden(reqId, isHidden) {
  return executeQuery(
    `UPDATE requisition SET is_hidden = $1, req_updated_at = CURRENT_TIMESTAMP WHERE req_id = $2 RETURNING req_id, is_hidden`,
    [isHidden, reqId]
  )
}

/** Insert an optional approval comment for a requisition (stage: hod, hr, committee, ceo, finance, admin). */
export async function insertRequisitionComment(reqId, stageKey, commentText, addedByEmployeeId) {
  if (!commentText || typeof commentText !== 'string' || !commentText.trim()) return null
  try {
    await executeQuery(
      `INSERT INTO requisition_comments (req_id, stage_key, comment_text, added_by_employee_id)
       VALUES ($1, $2, $3, $4)`,
      [reqId, stageKey, commentText.trim(), addedByEmployeeId || null]
    )
    return true
  } catch (err) {
    if (err.code === '42P01') return null
    throw err
  }
}

/** Get all comments for a requisition, ordered by added_at. Includes approver name when available. */
export async function getRequisitionComments(reqId) {
  try {
    return await executeQuery(
      `SELECT c.id, c.req_id, c.stage_key, c.comment_text, c.added_by_employee_id, c.added_at,
              e.first_name AS approver_first_name, e.last_name AS approver_last_name
       FROM requisition_comments c
       LEFT JOIN employees e ON c.added_by_employee_id = e.employee_id
       WHERE c.req_id = $1
       ORDER BY c.added_at ASC`,
      [reqId]
    )
  } catch (err) {
    if (err.code === '42P01') return []
    throw err
  }
}

/** Get comments for multiple requisition IDs. Returns Map<reqId, comments[]>. */
export async function getRequisitionCommentsByReqIds(reqIds) {
  if (!Array.isArray(reqIds) || reqIds.length === 0) return new Map()
  try {
    const rows = await executeQuery(
      `SELECT c.id, c.req_id, c.stage_key, c.comment_text, c.added_by_employee_id, c.added_at,
              e.first_name AS approver_first_name, e.last_name AS approver_last_name
       FROM requisition_comments c
       LEFT JOIN employees e ON c.added_by_employee_id = e.employee_id
       WHERE c.req_id = ANY($1)
       ORDER BY c.req_id, c.added_at ASC`,
      [reqIds]
    )
    const map = new Map()
    for (const row of rows || []) {
      const id = row.req_id
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(row)
    }
    return map
  } catch (err) {
    if (err.code === '42P01') return new Map()
    throw err
  }
}

/** Get creator (requester) email and name for a requisition ? for acknowledgment notifications. */
export async function getCreatorEmailByReqId(reqId) {
  try {
    const rows = await executeQuery(
      `SELECT e.email, e.first_name, e.last_name, r.req_reference_no
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       WHERE r.req_id = $1 AND e.email IS NOT NULL AND TRIM(e.email) != ''`,
      [reqId]
    )
    return rows[0] || null
  } catch (err) {
    if (err.code === '42703') return null
    throw err
  }
}

/** Requisition categories table (flow flags + optional form_layout for drag-drop form). */
export async function getAllRequisitionCategories() {
  return executeQuery(
    `SELECT id, name, hod_for_info, hod_approval, hr_finance, committee_review,
      department_admin, department_finance, department_procurement,
      quotations, final_committee, ceo_approve,
      execution_admin, execution_finance, execution_procurement,
      form_layout
     FROM requisition_category ORDER BY name`
  )
}

export async function getRequisitionCategoryByName(name) {
  if (!name || typeof name !== 'string') return null
  const rows = await executeQuery(
    `SELECT id, name, hod_for_info, hod_approval, hr_finance, committee_review,
      department_admin, department_finance, department_procurement,
      quotations, final_committee, ceo_approve,
      execution_admin, execution_finance, execution_procurement
     FROM requisition_category WHERE TRIM(name) = $1`,
    [String(name).trim()]
  )
  return rows[0] || null
}

/** Admin: create requisition category; insert stage behaviors based on flags. */
export async function createRequisitionCategory(name, flags = {}) {
  const n = String(name).trim()
  if (!n) throw new Error('Category name is required')
  const rows = await executeQuery(
    `INSERT INTO requisition_category (name, hod_for_info, hod_approval, hr_finance, committee_review,
      department_admin, department_finance, department_procurement, quotations, final_committee, ceo_approve,
      execution_admin, execution_finance, execution_procurement)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id, name, hod_for_info, hod_approval, hr_finance, committee_review,
       department_admin, department_finance, department_procurement,
       quotations, final_committee, ceo_approve,
       execution_admin, execution_finance, execution_procurement`,
    [
      n,
      flags.hod_for_info ? 1 : 0,
      flags.hod_approval ? 1 : 0,
      flags.hr_finance ? 1 : 0,
      flags.committee_review ? 1 : 0,
      flags.department_admin ? 1 : 0,
      flags.department_finance ? 1 : 0,
      flags.department_procurement ? 1 : 0,
      flags.quotations ? 1 : 0,
      flags.final_committee ? 1 : 0,
      flags.ceo_approve ? 1 : 0,
      flags.execution_admin ? 1 : 0,
      flags.execution_finance ? 1 : 0,
      flags.execution_procurement ? 1 : 0
    ]
  )
  const cat = rows[0]
  if (cat) {
    // Sync stage behaviors based on flags (instead of default 'skip' for all)
    try {
      await syncCategoryStageBehaviors(cat.id)
    } catch (e) {
      if (e.code !== '42P01') throw e
    }
  }
  return cat
}

/** Admin: update requisition category by id. flags may include form_layout (JSON array).
 *  Also syncs stage behaviors to requisition_category_stage table.
 */
export async function updateRequisitionCategory(id, name, flags = {}) {
  const { form_layout: formLayout, ...restFlags } = flags
  const rows = await executeQuery(
    `UPDATE requisition_category SET
       name = COALESCE($2, name),
       hod_for_info = COALESCE($3, hod_for_info),
       hod_approval = COALESCE($4, hod_approval),
       hr_finance = COALESCE($5, hr_finance),
       committee_review = COALESCE($6, committee_review),
       department_admin = COALESCE($7, department_admin),
       department_finance = COALESCE($8, department_finance),
       department_procurement = COALESCE($9, department_procurement),
       quotations = COALESCE($10, quotations),
       final_committee = COALESCE($11, final_committee),
       ceo_approve = COALESCE($12, ceo_approve),
       execution_admin = COALESCE($13, execution_admin),
       execution_finance = COALESCE($14, execution_finance),
       execution_procurement = COALESCE($15, execution_procurement),
       form_layout = COALESCE($16, form_layout)
     WHERE id = $1 RETURNING id, name, form_layout`,
    [
      id,
      name != null ? String(name).trim() : null,
      restFlags.hod_for_info !== undefined ? (restFlags.hod_for_info ? 1 : 0) : null,
      restFlags.hod_approval !== undefined ? (restFlags.hod_approval ? 1 : 0) : null,
      restFlags.hr_finance !== undefined ? (restFlags.hr_finance ? 1 : 0) : null,
      restFlags.committee_review !== undefined ? (restFlags.committee_review ? 1 : 0) : null,
      restFlags.department_admin !== undefined ? (restFlags.department_admin ? 1 : 0) : null,
      restFlags.department_finance !== undefined ? (restFlags.department_finance ? 1 : 0) : null,
      restFlags.department_procurement !== undefined ? (restFlags.department_procurement ? 1 : 0) : null,
      restFlags.quotations !== undefined ? (restFlags.quotations ? 1 : 0) : null,
      restFlags.final_committee !== undefined ? (restFlags.final_committee ? 1 : 0) : null,
      restFlags.ceo_approve !== undefined ? (restFlags.ceo_approve ? 1 : 0) : null,
      restFlags.execution_admin !== undefined ? (restFlags.execution_admin ? 1 : 0) : null,
      restFlags.execution_finance !== undefined ? (restFlags.execution_finance ? 1 : 0) : null,
      restFlags.execution_procurement !== undefined ? (restFlags.execution_procurement ? 1 : 0) : null,
      formLayout !== undefined ? (Array.isArray(formLayout) ? JSON.stringify(formLayout) : (typeof formLayout === 'string' ? formLayout : JSON.stringify(formLayout))) : null
    ]
  )
  const updated = rows[0] || null

  // Sync stage behaviors when flags are updated
  if (updated) {
    try {
      await syncCategoryStageBehaviors(id)
    } catch (syncErr) {
      console.error('Failed to sync category stage behaviors:', syncErr.message)
      // Don't fail the update if sync fails
    }
  }

  return updated
}

/** Admin: delete requisition category (and its stage rows). Requisitions with this category keep req_category text. */
export async function deleteRequisitionCategory(id) {
  await executeQuery('DELETE FROM requisition_category_stage WHERE category_id = $1', [id])
  const rows = await executeQuery('DELETE FROM requisition_category WHERE id = $1 RETURNING id', [id])
  return rows.length > 0
}

/** Sync category flags (hod_approval, committee_review, ceo_approve, etc.) to stage behaviors.
 *  Call after updating category flags to ensure requisition_category_stage matches.
 */
export async function syncCategoryStageBehaviors(categoryId) {
  // Get the category flags
  const catRows = await executeQuery('SELECT * FROM requisition_category WHERE id = $1', [categoryId])
  if (!catRows.length) return
  const cat = catRows[0]

  // Get all flow stages
  const stages = await getFlowStages()
  if (!stages.length) return

  // Map stage keys to their required flag
  const stageFlagMap = {
    'hod': cat.hod_approval === 1 || cat.hod_for_info === 1,
    'hr': cat.hr_finance === 1,
    'committee': cat.committee_review === 1,
    'ceo': cat.ceo_approve === 1,
    'admin': cat.department_admin === 1,
    'procurement': cat.department_procurement === 1
    // finance is determined by req_handed_to_finance or category flow
  }

  // For each stage, set behavior to 'approval' if flag is enabled, 'skip' if disabled
  for (const stage of stages) {
    const stageKey = stage.stage_key
    const flagEnabled = stageFlagMap[stageKey]

    // Default behavior is 'skip' unless flag is enabled
    let behavior = 'skip'
    if (flagEnabled) {
      // Special case: hod_for_info uses 'for_info' behavior
      if (stageKey === 'hod' && cat.hod_for_info === 1 && cat.hod_approval !== 1) {
        behavior = 'for_info'
      } else {
        behavior = 'approval'
      }
    }

    // Update or insert the stage behavior
    await executeQuery(
      `INSERT INTO requisition_category_stage (category_id, flow_stage_id, behavior)
       VALUES ($1, $2, $3)
       ON CONFLICT (category_id, flow_stage_id)
       DO UPDATE SET behavior = EXCLUDED.behavior`,
      [categoryId, stage.id, behavior]
    )
  }

  // Clear the behavior cache for this category
  const cacheKey = (cat.name || '').trim().toLowerCase()
  if (cacheKey) {
    _categoryBehaviorCache.delete(cacheKey)
  }
}

// ---------- DB-driven flow (with short TTL cache to avoid repeated identical queries) ----------
const FLOW_STAGES_CACHE_TTL_MS = 60 * 1000 // 1 minute
let _flowStagesCache = null
let _flowStagesCacheTime = 0

/** All flow stages ordered by sequence_order. Cached for FLOW_STAGES_CACHE_TTL_MS. */
export async function getFlowStages() {
  const now = Date.now()
  if (_flowStagesCache != null && now - _flowStagesCacheTime < FLOW_STAGES_CACHE_TTL_MS) {
    return _flowStagesCache
  }
  try {
    const rows = await executeQuery(
      `SELECT id, stage_key, stage_label, sequence_order, employee_type_name, designation_name, filter_by_department, requisition_done_column
       FROM requisition_flow_stage ORDER BY sequence_order ASC`
    )
    _flowStagesCache = rows || []
    _flowStagesCacheTime = now
    return _flowStagesCache
  } catch (err) {
    if (err.code === '42P01') return [] // table missing
    throw err
  }
}

const CATEGORY_BEHAVIOR_CACHE_TTL_MS = 60 * 1000
const _categoryBehaviorCache = new Map() // key = lower category name, value = { map, time }

/** Per-stage behavior for a category: { stage_key: 'approval'|'for_info'|'skip' }. Uses case-insensitive category match. Cached briefly. */
export async function getCategoryStageBehaviorMap(categoryName) {
  if (!categoryName || typeof categoryName !== 'string') return null
  const trimmed = String(categoryName).trim()
  if (!trimmed) return null
  const key = trimmed.toLowerCase()
  const now = Date.now()
  const hit = _categoryBehaviorCache.get(key)
  if (hit && now - hit.time < CATEGORY_BEHAVIOR_CACHE_TTL_MS) return hit.map
  try {
    const rows = await executeQuery(
      `SELECT fs.stage_key, cs.behavior
       FROM requisition_category_stage cs
       JOIN requisition_flow_stage fs ON fs.id = cs.flow_stage_id
       JOIN requisition_category c ON c.id = cs.category_id
       WHERE LOWER(TRIM(c.name)) = LOWER($1)`,
      [trimmed]
    )
    if (!rows.length) return null
    const map = rows.reduce((acc, r) => { acc[r.stage_key] = r.behavior; return acc }, {})
    _categoryBehaviorCache.set(key, { map, time: now })
    return map
  } catch (err) {
    if (err.code === '42P01') return null
    throw err
  }
}

/** Next stage_key after current (first later stage with behavior != 'skip'). Null if no next. */
export async function getNextStageKey(categoryName, currentStageKey) {
  const stages = await getFlowStages()
  const behaviorMap = await getCategoryStageBehaviorMap(categoryName || '')
  if (!stages.length || !behaviorMap) return null
  const currentIdx = stages.findIndex(s => s.stage_key === currentStageKey)
  if (currentIdx < 0) return null
  for (let i = currentIdx + 1; i < stages.length; i++) {
    const b = behaviorMap[stages[i].stage_key]
    if (b && b !== 'skip') return stages[i].stage_key
  }
  return null
}

/** First stage_key for a category (first with behavior != 'skip'). */
export async function getFirstStageKey(categoryName) {
  const stages = await getFlowStages()
  const behaviorMap = await getCategoryStageBehaviorMap(categoryName || '')
  if (!stages.length || !behaviorMap) return (stages[0] && stages[0].stage_key) || 'hod'
  for (const s of stages) {
    if (behaviorMap[s.stage_key] && behaviorMap[s.stage_key] !== 'skip') return s.stage_key
  }
  return stages[0]?.stage_key || 'hod'
}

/** Requisitions at a given current stage. For hod: optional departmentId, departmentName, excludeEmployeeId.
 *  Also includes requisitions where req_current_stage_key is NULL but the approval state matches the expected bucket.
 */
export async function getPendingRequisitionsByCurrentStage(stageKey, opts = {}) {
  const { departmentId, departmentName, excludeEmployeeId } = opts
  try {
    let q = `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
        desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       WHERE COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE `
    const params = [stageKey]

    // Build the bucket matching logic
    // When req_current_stage_key is set, use it directly
    // When NULL, infer from approval state
    let bucketCondition = ''
    if (stageKey === 'finance') {
      // Finance: explicit stage key OR handed to finance flag
      bucketCondition = ` AND (r.req_current_stage_key = $1 OR (r.req_handed_to_finance = 1 AND COALESCE(r.req_finance_approval, 0) = 0))`
    } else if (stageKey === 'hod') {
      // HOD: explicit stage key (not yet approved by HOD, not completed) OR legacy NULL stage with no approvals
      bucketCondition = ` AND ((r.req_current_stage_key = $1 AND COALESCE(r.req_hod_approval, 0) = 0 AND COALESCE(r.req_purchase_completed, 0) = 0) OR (r.req_current_stage_key IS NULL AND COALESCE(r.req_hod_approval, 0) = 0 AND COALESCE(r.req_committee_approval, 0) = 0 AND COALESCE(r.req_ceo_approval, 0) = 0 AND COALESCE(r.req_finance_approval, 0) = 0))`
    } else if (stageKey === 'it') {
      // IT: explicit stage key only (IT stage is opt-in per category — no legacy fallback).
      bucketCondition = ` AND r.req_current_stage_key = $1 AND COALESCE(r.req_it_approval, 0) = 0`
    } else if (stageKey === 'committee') {
      // Committee: explicit stage key OR (HOD approved AND Committee not approved AND stage is NULL)
      bucketCondition = ` AND (r.req_current_stage_key = $1 OR (r.req_current_stage_key IS NULL AND r.req_hod_approval = 1 AND COALESCE(r.req_committee_approval, 0) = 0))`
    } else if (stageKey === 'ceo') {
      // CEO: explicit stage key OR (HOD+Committee approved AND CEO not approved AND stage is NULL AND not forwarded)
      bucketCondition = ` AND (r.req_current_stage_key = $1 OR (r.req_current_stage_key IS NULL AND r.req_hod_approval = 1 AND r.req_committee_approval = 1 AND (r.req_ceo_approval = 0 OR r.req_ceo_approval IS NULL) AND COALESCE(r.req_procurement_ack, 0) = 0 AND COALESCE(r.req_finance_approval, 0) = 0))`
    } else if (stageKey === 'procurement') {
      // Procurement: show all requisitions explicitly at the procurement stage, excluding completed ones
      bucketCondition = ` AND r.req_current_stage_key = $1 AND COALESCE(r.req_purchase_completed, 0) = 0`

    } else if (stageKey === 'hr') {
      // HR: explicit stage key OR (HOD approved AND HR not approved AND stage is NULL)
      // bucketCondition = ` AND (r.req_current_stage_key = $1 OR (r.req_current_stage_key IS NULL AND r.req_hod_approval = 1 AND COALESCE(r.req_hr_approval, 0) = 0))`
      bucketCondition = `
      AND (
        r.req_category = 'Loan & Advance Salary'
        AND (
          r.req_current_stage_key = $1
          OR (
            r.req_current_stage_key IS NULL
            AND r.req_hod_approval = 1
            AND COALESCE(r.req_hr_approval, 0) = 0
          )
        )
      )
    `   
    } else if (stageKey === 'admin') {
      // Admin: explicit stage key only (no legacy fallback for admin)
      bucketCondition = ` AND r.req_current_stage_key = $1`
    } else {
      // Default: explicit stage key only
      bucketCondition = ` AND r.req_current_stage_key = $1`
    }
    q += bucketCondition

    if (stageKey === 'hod' && (departmentId != null || (departmentName != null && String(departmentName).trim() !== ''))) {
      q += ` AND (e.department_id = $2 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $3 AND $3 != ''))`
      params.push(departmentId ?? null, (departmentName || '').trim().toLowerCase())
      // Do not exclude creator for hod stage so HOD's own requisitions appear in Pending HOD
    }
    q += ` ORDER BY r.req_created_at ASC`
    return executeQuery(q, params)
  } catch (err) {
    if (err.code === '42703') return [] // req_current_stage_key column missing
    if (err.code === '42P01') return []
    throw err
  }
}

/** Set current stage on requisition. */
export async function setRequisitionCurrentStage(reqId, stageKey) {
  return executeQuery(
    'UPDATE requisition SET req_current_stage_key = $2 WHERE req_id = $1',
    [reqId, stageKey]
  )
}

/** True if employee has the employee_type or designation for this flow stage. */
export async function isEmployeeTypeForStage(employeeId, stageKey) {
  try {
    const stages = await executeQuery(
      'SELECT employee_type_name, designation_name FROM requisition_flow_stage WHERE stage_key = $1',
      [stageKey]
    )
    if (!stages.length) return false
    const { employee_type_name, designation_name } = stages[0]
    const typeName = (employee_type_name || '').trim()
    const desgName = (designation_name || '').trim()
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $2
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $3
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId, typeName || null, desgName || null]
    )
    if (rows.length > 0) return true
    if (typeName) {
      const byType = await executeQuery(
        `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = $2 WHERE e.employee_id = $1`,
        [employeeId, typeName]
      )
      if (byType.length > 0) return true
    }
    if (desgName) {
      const byDesg = await executeQuery(
        `SELECT 1 FROM employees e INNER JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = $2 WHERE e.employee_id = $1`,
        [employeeId, desgName]
      )
      if (byDesg.length > 0) return true
    }
    // HR stage: also treat as HR if designation/type contains HR or Human Resource (same as isHrMember)
    if (stageKey === 'hr') {
      const hrRows = await executeQuery(
        `SELECT 1 FROM employees e
         LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND (et.emp_type_name ILIKE '%HR%' OR et.emp_type_name ILIKE '%human%resource%')
         LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND (desg.desg_name ILIKE '%HR%' OR desg.desg_name ILIKE '%human%resource%')
         WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
        [employeeId]
      )
      if (hrRows.length > 0) return true
    }
    // Finance stage: also treat as Finance if designation/type contains Finance (flexible matching for Finance HOD, Finance Manager, etc.)
    if (stageKey === 'finance') {
      const financeRows = await executeQuery(
        `SELECT 1 FROM employees e
         LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name ILIKE '%finance%'
         LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name ILIKE '%finance%'
         WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
        [employeeId]
      )
      if (financeRows.length > 0) return true
    }
    return false
  } catch (err) {
    if (err.code === '42P01') return false
    throw err
  }
}

export async function getRequisitionRowForTat(reqId) {
  return executeQuery(
    `SELECT req_id, req_reference_no, req_category, req_created_at, req_hod_approval, req_hod_approval_date,
      req_hr_approval, req_hr_approval_date, req_admin_approval, req_admin_approval_date,
      req_committee_approval, req_committee_approval_date, req_ceo_approval, req_ceo_approval_date,
      req_procurement_ack, req_handed_to_finance, req_handed_to_finance_date,
      req_finance_approval, req_finance_approval_date, req_quotation_1_url, req_quotation_2_url, req_quotation_3_url,
      req_is_rejected, req_current_stage_key,
      req_purchase_completed, req_purchase_completed_date, req_hod_acknowledged, req_hod_acknowledged_date,
      req_creator_acknowledged, req_creator_acknowledged_date
     FROM requisition WHERE req_id = $1`,
    [reqId]
  )
}

/** Fallback when req_purchase_completed / req_hod_acknowledged columns do not exist. */
export async function getRequisitionRowForTatFallback(reqId) {
  return executeQuery(
    `SELECT req_id, req_reference_no, req_created_at, req_hod_approval, req_hod_approval_date,
      req_committee_approval, req_committee_approval_date, req_ceo_approval, req_ceo_approval_date,
      req_procurement_ack, req_handed_to_finance, req_handed_to_finance_date,
      req_finance_approval, req_finance_approval_date, req_quotation_1_url, req_quotation_2_url, req_quotation_3_url,
      req_is_rejected
     FROM requisition WHERE req_id = $1`,
    [reqId]
  )
}

export async function getRequisitionItems(reqId) {
  return executeQuery('SELECT * FROM requisition_items WHERE req_id = $1', [reqId])
}

// Pending lists and report
export async function getEmployeeDept(employeeId) {
  const r = await executeQuery(
    `SELECT e.department_id, e.employee_type_id, d.department_name
     FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
  return r[0]
}

/** HOD pending: (1) awaiting HOD approval (including when HOD is creator), (2) from Procurement ? complete, awaiting HOD acknowledgment. */
export async function getPendingHodRequisitions(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_is_rejected, 0)::int = 0) AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
       AND (
         -- Awaiting HOD approval (not yet forwarded - no downstream approvals)
         (COALESCE(r.req_hod_approval, 0)::int = 0
          AND COALESCE(r.req_committee_approval, 0)::int = 0
          AND COALESCE(r.req_ceo_approval, 0)::int = 0
          AND COALESCE(r.req_finance_approval, 0)::int = 0)
         OR
         -- From Procurement ? complete, awaiting HOD acknowledgment
         ( (COALESCE(r.req_purchase_completed, 0) = 1) AND (COALESCE(r.req_hod_acknowledged, 0) = 0) AND (COALESCE(r.req_creator_acknowledged, 0) = 0) )
       )
     ORDER BY r.req_created_at ASC`,
    [deptId, deptName]
  )
}

/** Fallback when req_purchase_completed / req_hod_acknowledged columns do not exist. */
export async function getPendingHodRequisitionsFallback(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_is_rejected, 0)::int = 0) AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
       -- Awaiting HOD approval (not yet forwarded - no downstream approvals)
       AND COALESCE(r.req_hod_approval, 0)::int = 0
       AND COALESCE(r.req_committee_approval, 0)::int = 0
       AND COALESCE(r.req_ceo_approval, 0)::int = 0
       AND COALESCE(r.req_finance_approval, 0)::int = 0
     ORDER BY r.req_created_at ASC`,
    [deptId, deptName]
  )
}

export async function getApprovedByHodRequisitions(hodEmployeeId) {
  return executeQuery(
    `SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.email,
        e.employee_code,
        d.department_name,
        desg.desg_name AS designation_name,
        hod_approver.employee_code AS hod_approver_employee_code,
        hod_approver.employee_id AS hod_approver_id
    FROM requisition r
    JOIN employees e
        ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d
        ON e.department_id = d.department_id
    LEFT JOIN designation desg
        ON e.designation_id = desg.desg_id
    LEFT JOIN employees hod_approver
        ON r.req_hod_approved_by = hod_approver.employee_id
    WHERE
        COALESCE(r.req_hod_approval, 0)::int = 1
        AND COALESCE(r.req_is_rejected, 0)::int = 0
        AND COALESCE(r.is_hidden, FALSE) = FALSE
        AND r.req_emp_id != $1  -- HOD ki khud ki requisition exclude
        AND EXISTS (
            SELECT 1
            FROM employee_hod_departments ehd
            WHERE
                ehd.employee_id = $1
                AND ehd.department_id = e.department_id
        )
    ORDER BY
        r.req_hod_approval_date DESC NULLS LAST,
        r.req_created_at DESC`,
    [hodEmployeeId]
  )
}

export async function getApprovedByHodRequisitionsForDepts(hodEmployeeId, deptIds) {
  if (!deptIds || deptIds.length === 0) return []
  return executeQuery(
    `SELECT
        r.*,
        e.first_name,
        e.last_name,
        e.email,
        e.employee_code,
        d.department_name,
        desg.desg_name AS designation_name,
        hod_approver.employee_code AS hod_approver_employee_code,
        hod_approver.employee_id AS hod_approver_id
    FROM requisition r
    JOIN employees e
        ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d
        ON e.department_id = d.department_id
    LEFT JOIN designation desg
        ON e.designation_id = desg.desg_id
    LEFT JOIN employees hod_approver
        ON r.req_hod_approved_by = hod_approver.employee_id
    WHERE
        COALESCE(r.req_hod_approval, 0)::int = 1
        AND COALESCE(r.req_is_rejected, 0)::int = 0
        AND COALESCE(r.is_hidden, FALSE) = FALSE
        AND r.req_emp_id != $1
        AND e.department_id = ANY($2::int[])
    ORDER BY
        r.req_hod_approval_date DESC NULLS LAST,
        r.req_created_at DESC`,
    [hodEmployeeId, deptIds]
  )
}

/** Get all HOD-approved requisitions for a department.
 *  Shows ALL requisitions where HOD has approved (req_hod_approval = 1)
 *  regardless of which specific HOD or employee type performed the approval.
 *  Excludes requisitions created by the current user (excludeEmployeeId).
 */
export async function getAllHodApprovedRequisitions(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_hod_approval, 0)::int = 1)
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
       AND r.req_emp_id != $3
     ORDER BY r.req_hod_approval_date DESC NULLS LAST, r.req_created_at DESC`,
    [deptId, deptName, excludeEmployeeId]
  )
}

/** Creator-dept requisitions whose required-by date is today or past, not completed ? HOD may extend deadline.
 *  Only includes requisitions still in HOD bucket (not yet forwarded) OR completed pending HOD acknowledgment.
 */
export async function getRequisitionsNeedingDeadlineExtensionByDept(deptId, deptName) {
  try {
    return await executeQuery(
      `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
        desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       WHERE COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
         AND COALESCE(r.req_purchase_completed, 0) = 0
         AND r.req_required_by_date IS NOT NULL
         AND (r.req_required_by_date::date <= CURRENT_DATE)
         AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
         AND (
           (r.req_current_stage_key = 'hod' AND COALESCE(r.req_hod_approval, 0) = 0 AND COALESCE(r.req_purchase_completed, 0) = 0)
           OR
           (r.req_current_stage_key IS NULL AND COALESCE(r.req_hod_approval, 0) = 0 AND COALESCE(r.req_committee_approval, 0) = 0 AND COALESCE(r.req_ceo_approval, 0) = 0 AND COALESCE(r.req_finance_approval, 0) = 0)
         )
       ORDER BY r.req_required_by_date ASC NULLS LAST, r.req_created_at ASC`,
      [deptId, deptName]
    )
  } catch (err) {
    if (err.code === '42703' || err.code === '42P01') return []
    throw err
  }
}



/**
 * Get reverted requisitions for HOD that need review/resolution.
 * These are requisitions that were reverted back to HOD from a later stage
 * and have not yet been resolved by the HOD.
 */
// export async function getPendingHodRevertedRequisitions(deptId, deptName) {
//   return executeQuery(
//     `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
//       desg.desg_name AS designation_name
//      FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
//      LEFT JOIN departments d ON e.department_id = d.department_id
//      LEFT JOIN designation desg ON e.designation_id = desg.desg_id
//      WHERE (COALESCE(r.req_is_rejected, 0)::int = 0) AND COALESCE(r.is_hidden, FALSE) = FALSE
//        AND(e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
//        AND r.has_been_reverted = 1
//        AND r.req_current_stage_key = 'hod'
//        AND r.revert_resolved_at IS NULL
//      ORDER BY r.reverted_at DESC`,
//     [deptId,deptName]
//   )
// }

export async function getPendingCommitteeRequisitions(excludeEmployeeId) {
  const whereClause = `(COALESCE(r.req_is_rejected, 0)::int = 0) AND COALESCE(r.is_hidden, FALSE) = FALSE
     AND (
       ((COALESCE(r.req_hod_approval, 0)::int = 1) AND (COALESCE(r.req_committee_approval, 0)::int = 0) AND r.req_emp_id != $1)
       OR
       (COALESCE(r.req_purchase_completed, 0) = 1 AND COALESCE(r.req_hod_acknowledged, 0) = 0 AND COALESCE(r.req_creator_acknowledged, 0) = 0 AND r.req_creator_role = 'Committee')
     )`
  const sqlWithStage = `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE ${whereClause}
     AND (r.req_current_stage_key IS NULL OR r.req_current_stage_key = 'committee')
     ORDER BY r.req_created_at ASC`
  const sqlWithoutStage = `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE ${whereClause}
     ORDER BY r.req_created_at ASC`
  try {
    return await executeQuery(sqlWithStage, [excludeEmployeeId])
  } catch (err) {
    if (err.code === '42703') return executeQuery(sqlWithoutStage, [excludeEmployeeId])
    throw err
  }
}

export async function getPendingCeoRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE r.req_is_rejected = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
     AND (
       -- Normal pending CEO approval (HOD+Committee approved, CEO not approved, not forwarded)
       (r.req_hod_approval = 1 AND r.req_committee_approval = 1 AND (r.req_ceo_approval = 0 OR r.req_ceo_approval IS NULL)
        AND COALESCE(r.req_procurement_ack, 0) = 0
        AND COALESCE(r.req_finance_approval, 0) = 0)
       OR
       -- Completed requisitions created by CEO awaiting acknowledgment
       (COALESCE(r.req_purchase_completed, 0) = 1 AND COALESCE(r.req_hod_acknowledged, 0) = 0 AND COALESCE(r.req_creator_acknowledged, 0) = 0 AND r.req_creator_role = 'CEO')
     )
     ORDER BY r.req_created_at ASC`
  )
}

/** Requisitions forwarded to Procurement (HOD+Committee+CEO approved), not yet marked complete by Procurement. */
export async function getPendingProcurementRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE r.req_is_rejected = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND r.req_hod_approval = 1 AND r.req_committee_approval = 1 AND r.req_ceo_approval = 1
       AND (COALESCE(r.req_purchase_completed, 0) = 0)
       -- Not yet handed over to finance (still in Procurement bucket)
       AND COALESCE(r.req_handed_to_finance, 0) = 0
       AND COALESCE(r.req_finance_approval, 0) = 0
     ORDER BY r.req_created_at ASC`
  )
}

/** Fallback when req_purchase_completed column does not exist (pre-migration). */
export async function getPendingProcurementRequisitionsFallback() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE r.req_is_rejected = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND r.req_hod_approval = 1 AND r.req_committee_approval = 1 AND r.req_ceo_approval = 1
       -- Not yet handed over to finance (still in Procurement bucket)
       AND COALESCE(r.req_handed_to_finance, 0) = 0
       AND COALESCE(r.req_finance_approval, 0) = 0
     ORDER BY r.req_created_at ASC`
  )
}

export async function getPendingFinanceRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND COALESCE(r.req_finance_approval, 0) = 0
       AND (r.req_handed_to_finance = 1 OR r.req_current_stage_key = 'finance')
     ORDER BY r.req_handed_to_finance_date ASC`
  )
}

/** Get all Committee-approved requisitions (for Committee "My Approved" view).
 *  Excludes requisitions created by the current user (excludeEmployeeId).
 */
export async function getApprovedByCommitteeRequisitions(excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_committee_approval, 0)::int = 1)
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND r.req_emp_id != $1
     ORDER BY r.req_committee_approval_date DESC NULLS LAST, r.req_created_at DESC`,
    [excludeEmployeeId]
  )
}

/** Get all CEO-approved requisitions (for CEO "My Approved" view).
 *  Excludes requisitions created by the current user (excludeEmployeeId).
 */
export async function getApprovedByCeoRequisitions(excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_ceo_approval, 0)::int = 1)
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND r.req_emp_id != $1
     ORDER BY r.req_ceo_approval_date DESC NULLS LAST, r.req_created_at DESC`,
    [excludeEmployeeId]
  )
}

export async function getApprovedByAdminRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.req_admin_approval, 0)::int = 1
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY r.req_admin_approval_date DESC NULLS LAST, r.req_created_at DESC`
  )
}

export async function getApprovedByProcurementRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.req_purchase_completed, 0)::int = 1
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY r.req_purchase_completed_date DESC NULLS LAST, r.req_created_at DESC`
  )
}

export async function getApprovedByFinanceRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.req_finance_approval, 0)::int = 1
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY r.req_finance_approval_date DESC NULLS LAST, r.req_created_at DESC`
  )
}

/** Get all HR-approved requisitions (for HR "My Approved" view).
 *  Excludes requisitions created by the current user (excludeEmployeeId).
 */
export async function getApprovedByHrRequisitions(excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE (COALESCE(r.req_hr_approval, 0)::int = 1)
       AND COALESCE(r.req_is_rejected, 0) = 0
       AND COALESCE(r.is_hidden, FALSE) = FALSE
       AND r.req_emp_id != $1
     ORDER BY r.req_hr_approval_date DESC NULLS LAST, r.req_created_at DESC`,
    [excludeEmployeeId]
  )
}

/** Req is in Procurement bucket (by flow) and can be acknowledged by Procurement. Use current_stage_key so all flow paths (e.g. Committee?Procurement or HOD???CEO?Procurement) work. */
export async function getRequisitionForProcurementAck(reqId) {
  try {
    return await executeQuery(
      `SELECT req_id FROM requisition WHERE req_id = $1 AND COALESCE(req_is_rejected, 0) = 0 AND req_current_stage_key = 'procurement'`,
      [reqId]
    )
  } catch (err) {
    if (err.code === '42703') return [] // column missing
    throw err
  }
}

export async function getRequisitionForQuotations(reqId) {
  return executeQuery('SELECT req_id FROM requisition WHERE req_id = $1 AND req_procurement_ack = 1', [reqId])
}

export async function getRequisitionForSupportDocs(reqId) {
  return executeQuery('SELECT req_id FROM requisition WHERE req_id = $1 AND req_procurement_ack = 1', [reqId])
}

export async function updateSupportDocsUpload(reqId, url1, url2, url3) {
  return executeQuery(
    `UPDATE requisition SET req_support_doc_1_url = $2, req_support_doc_2_url = $3, req_support_doc_3_url = $4 WHERE req_id = $1`,
    [reqId, url1, url2, url3]
  )
}

export async function getRequisitionForHandover(reqId) {
  return executeQuery(
    'SELECT req_id, req_quotation_1_url, req_quotation_2_url, req_quotation_3_url FROM requisition WHERE req_id = $1 AND req_procurement_ack = 1',
    [reqId]
  )
}

/** Req in Procurement bucket (by flow or after ack) so Procurement can set expected handover date. */
export async function getRequisitionForExpectedHandover(reqId) {
  try {
    return await executeQuery(
      `SELECT req_id FROM requisition WHERE req_id = $1 AND COALESCE(req_is_rejected, 0) = 0
       AND (req_current_stage_key = 'procurement' OR COALESCE(req_procurement_ack, 0) = 1)`,
      [reqId]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/** Req eligible for Finance approval: either handed by Procurement (with quotations) or at finance stage (e.g. Loan direct from HR/CEO). */
export async function getRequisitionForFinanceApproval(reqId) {
  return executeQuery(
    `SELECT req_id, req_category FROM requisition WHERE req_id = $1 AND COALESCE(req_finance_approval, 0) = 0
     AND (req_handed_to_finance = 1 OR req_current_stage_key = 'finance')`,
    [reqId]
  )
}

// Report all (HOD filter optional)
export async function getEmployeeDeptForReport(employeeId) {
  const r = await executeQuery(
    `SELECT e.department_id, LOWER(TRIM(COALESCE(d.department_name, ''))) AS department_name_lower
     FROM employees e LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
  return r[0]
}

export async function getReportAllRequisitionsHod(deptId, deptNameLower) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.is_hidden, FALSE) = FALSE
       AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY r.req_created_at DESC`,
    [deptId, deptNameLower]
  )
}

export async function getReportAllRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
      desg.desg_name AS designation_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY r.req_created_at DESC`
  )
}

export async function getItemsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery('SELECT * FROM requisition_items WHERE req_id = ANY($1)', [reqIds])
}

/** ===== Procurement "item unavailable" + Committee review ===== */

/** Single item with its requisition's stage/status, for guards. */
export async function getRequisitionItemWithReq(itemId) {
  const rows = await executeQuery(
    `SELECT i.*, r.req_current_stage_key, r.req_emp_id, r.req_reference_no,
            COALESCE(r.req_purchase_completed, 0) AS req_purchase_completed,
            COALESCE(r.req_is_rejected, 0) AS req_is_rejected
     FROM requisition_items i JOIN requisition r ON r.req_id = i.req_id
     WHERE i.item_id = $1`,
    [itemId]
  )
  return rows[0] || null
}

/** Procurement flags an item unavailable (active → pending_review). Returns affected rows. */
export async function flagItemUnavailable(itemId, reqId, reason, employeeId) {
  return executeQuery(
    `UPDATE requisition_items
     SET item_review_status = 'pending_review', item_unavailable_reason = $3,
         item_flagged_by = $4, item_flagged_at = CURRENT_TIMESTAMP,
         item_reviewed_by = NULL, item_reviewed_at = NULL
     WHERE item_id = $1 AND req_id = $2 AND item_review_status = 'active'
     RETURNING item_id`,
    [itemId, reqId, String(reason).slice(0, 255), employeeId ?? null]
  )
}

/** Procurement restores a flagged item (pending_review → active). */
export async function restoreFlaggedItem(itemId, reqId) {
  return executeQuery(
    `UPDATE requisition_items
     SET item_review_status = 'active', item_unavailable_reason = NULL,
         item_flagged_by = NULL, item_flagged_at = NULL,
         item_reviewed_by = NULL, item_reviewed_at = NULL
     WHERE item_id = $1 AND req_id = $2 AND item_review_status = 'pending_review'
     RETURNING item_id`,
    [itemId, reqId]
  )
}

/** Committee decision on a flagged item: required → active, not_required → dropped. */
export async function reviewFlaggedItem(itemId, reqId, decision, employeeId) {
  const nextStatus = decision === 'required' ? 'active' : 'dropped'
  return executeQuery(
    `UPDATE requisition_items
     SET item_review_status = $3, item_reviewed_by = $4, item_reviewed_at = CURRENT_TIMESTAMP
     WHERE item_id = $1 AND req_id = $2 AND item_review_status = 'pending_review'
     RETURNING item_id`,
    [itemId, reqId, nextStatus, employeeId ?? null]
  )
}

/** All items currently awaiting committee review, with requisition + requester context. */
export async function getItemsPendingReview() {
  return executeQuery(
    `SELECT i.*, r.req_reference_no, r.req_category, r.req_id,
            e.first_name, e.last_name, e.employee_code, d.department_name,
            flagger.first_name AS flagged_by_first_name, flagger.last_name AS flagged_by_last_name
     FROM requisition_items i
     JOIN requisition r ON r.req_id = i.req_id
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN employees flagger ON i.item_flagged_by = flagger.employee_id
     WHERE i.item_review_status = 'pending_review'
       AND COALESCE(r.req_is_rejected, 0) = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE
     ORDER BY i.item_flagged_at ASC NULLS LAST`
  )
}

/** Append an audit row for an item-review action. Defensive if the table is absent. */
export async function insertRequisitionItemEvent(ev) {
  try {
    await executeQuery(
      `INSERT INTO requisition_item_events
         (req_id, item_id, event_type, reason, amount_before, amount_after, ceo_required, actor_employee_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ev.reqId, ev.itemId, ev.eventType, ev.reason ?? null,
        ev.amountBefore ?? null, ev.amountAfter ?? null, !!ev.ceoRequired, ev.actorEmployeeId ?? null]
    )
    return true
  } catch (err) {
    if (err.code === '42P01') return null
    throw err
  }
}

/** Audit events for requisitions, newest first. Returns Map<reqId, events[]>. */
export async function getItemEventsByReqIds(reqIds) {
  if (!Array.isArray(reqIds) || reqIds.length === 0) return new Map()
  try {
    const rows = await executeQuery(
      `SELECT ev.*, i.item_desc,
              a.first_name AS actor_first_name, a.last_name AS actor_last_name
       FROM requisition_item_events ev
       LEFT JOIN requisition_items i ON i.item_id = ev.item_id
       LEFT JOIN employees a ON ev.actor_employee_id = a.employee_id
       WHERE ev.req_id = ANY($1)
       ORDER BY ev.created_at DESC`,
      [reqIds]
    )
    const map = new Map()
    for (const r of rows || []) {
      if (!map.has(r.req_id)) map.set(r.req_id, [])
      map.get(r.req_id).push(r)
    }
    return map
  } catch (err) {
    if (err.code === '42P01') return new Map()
    throw err
  }
}

/** ===== Revise Requisition ===== */

/** Original requisition fields needed to validate + seed a revision. */
export async function getRequisitionForReviseById(reqId) {
  const rows = await executeQuery(
    `SELECT req_id, req_reference_no, req_emp_id, req_location, req_material, req_business,
            req_category, req_required_by_date, req_is_urgent,
            COALESCE(req_is_rejected, 0) AS req_is_rejected,
            COALESCE(req_creator_acknowledged, 0) AS req_creator_acknowledged
     FROM requisition WHERE req_id = $1`,
    [reqId]
  )
  return rows[0] || null
}

/** Number of existing revisions of an original requisition. */
export async function countRevisionsOf(originalReqId) {
  try {
    const r = await executeQuery('SELECT COUNT(*)::int AS c FROM requisition WHERE req_revision_of = $1', [originalReqId])
    return r[0]?.c ?? 0
  } catch (err) {
    if (err.code === '42703') return 0
    throw err
  }
}

/** Stamp the custom revised reference and link a newly-created revision to its original. */
export async function setRevisionReferenceAndLink(newReqId, reference, originalReqId) {
  return executeQuery(
    'UPDATE requisition SET req_reference_no = $2, req_revision_of = $3 WHERE req_id = $1 RETURNING req_id, req_reference_no',
    [newReqId, reference, originalReqId]
  )
}

/** Set of category names (lowercased) whose flow includes a non-skipped Procurement stage. */
export async function getProcurementInvolvedCategoryNames() {
  try {
    const rows = await executeQuery(
      `SELECT DISTINCT TRIM(c.name) AS name
       FROM requisition_category_stage cs
       JOIN requisition_flow_stage fs ON fs.id = cs.flow_stage_id AND fs.stage_key = 'procurement'
       JOIN requisition_category c ON c.id = cs.category_id
       WHERE cs.behavior IS NOT NULL AND cs.behavior <> 'skip'`
    )
    return new Set((rows || []).map(r => String(r.name).trim().toLowerCase()))
  } catch (err) {
    if (err.code === '42P01') return new Set()
    throw err
  }
}

// Debug
export async function getEmployeeForDebug(employeeId) {
  return executeQuery(
    `SELECT e.employee_id, e.first_name, e.last_name, e.department_id, d.department_name,
       et.emp_type_name, desg.desg_name AS designation_name
     FROM employees e
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id
     LEFT JOIN designation desg ON e.designation_id = desg.desg_id
     WHERE e.employee_id = $1`,
    [employeeId]
  )
}

export async function getLastRequisitions() {
  return executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_emp_id, r.req_hod_approval, r.req_committee_approval, r.req_ceo_approval, r.req_is_rejected, r.req_created_at,
       creator.first_name || ' ' || creator.last_name AS creator_name,
       dept.department_name AS creator_dept_name
     FROM requisition r
     JOIN employees creator ON r.req_emp_id = creator.employee_id
     LEFT JOIN departments dept ON creator.department_id = dept.department_id
     ORDER BY r.req_id DESC LIMIT 15`
  )
}

export async function getPendingHodCount(deptId, deptNameLower) {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE r.req_is_rejected = 0 AND COALESCE(r.is_hidden, FALSE) = FALSE AND (r.req_hod_approval = 0 OR r.req_hod_approval IS NULL)
     AND (e.department_id = $1 OR (LOWER(TRIM(d.department_name)) = $2 AND $2 != ''))`,
    [deptId, deptNameLower]
  )
  return parseInt(r[0]?.c || 0, 10)
}

export async function getPendingCommitteeCount() {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition WHERE req_is_rejected = 0 AND COALESCE(is_hidden, FALSE) = FALSE AND req_hod_approval = 1 AND (req_committee_approval = 0 OR req_committee_approval IS NULL)`
  )
  return parseInt(r[0]?.c || 0, 10)
}

export async function getPendingCeoCount() {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition WHERE req_is_rejected = 0 AND COALESCE(is_hidden, FALSE) = FALSE AND req_hod_approval = 1 AND req_committee_approval = 1 AND (req_ceo_approval = 0 OR req_ceo_approval IS NULL)`
  )
  return parseInt(r[0]?.c || 0, 10)
}

// TAT report
export async function getTatReportCount(whereClause, params) {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id ${whereClause}`,
    params
  )
  return parseInt(r[0]?.c ?? 0, 10)
}

export async function getTatReportData(whereClause, params, limit, offset) {
  return executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_category, r.req_created_at,
       r.req_hod_approval, r.req_hod_approval_date, r.req_hr_approval, r.req_hr_approval_date, r.req_current_stage_key,
       r.req_committee_approval, r.req_committee_approval_date,
       r.req_ceo_approval, r.req_ceo_approval_date, r.req_procurement_ack, r.req_handed_to_finance,
       r.req_handed_to_finance_date, r.req_finance_approval, r.req_finance_approval_date,
       r.req_quotation_1_url, r.req_quotation_2_url, r.req_quotation_3_url, r.req_is_rejected, r.req_rejection_stage,
       r.req_purchase_completed, r.req_purchase_completed_date, r.req_hod_acknowledged, r.req_hod_acknowledged_date,
       r.req_creator_acknowledged, r.req_creator_acknowledged_date,
       e.first_name, e.last_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     ${whereClause}
     ORDER BY r.req_created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
}

/** TAT report data when req_purchase_completed / req_hod_acknowledged columns do not exist. */
export async function getTatReportDataFallback(whereClause, params, limit, offset) {
  return executeQuery(
    `SELECT r.req_id, r.req_reference_no, r.req_created_at,
       r.req_hod_approval, r.req_hod_approval_date, r.req_committee_approval, r.req_committee_approval_date,
       r.req_ceo_approval, r.req_ceo_approval_date, r.req_procurement_ack, r.req_handed_to_finance,
       r.req_handed_to_finance_date, r.req_finance_approval, r.req_finance_approval_date,
       r.req_quotation_1_url, r.req_quotation_2_url, r.req_quotation_3_url, r.req_is_rejected,
       e.first_name, e.last_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     ${whereClause}
     ORDER BY r.req_created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )
}

/** Check if an employee has a specific permission. */
export async function employeeHasPermission(employeeId, permission) {
  try {
    const r = await executeQuery(
      `SELECT COUNT(*) AS cnt FROM employee_permissions
       WHERE employee_id = $1 AND permission = $2`,
      [employeeId, permission]
    )
    return r && r[0] && parseInt(r[0].cnt, 10) > 0
  } catch (err) {
    return false
  }
}

/** Check if an employee is SuperAdmin. */
export async function isSuperAdmin(employeeId) {
  // Primary signal in this deployment: users.user_type (matches the frontend + auth layer).
  try {
    const u = await executeQuery('SELECT user_type FROM users WHERE emp_id = $1', [employeeId])
    if (u && u[0] && String(u[0].user_type || '').trim().toLowerCase() === 'superadmin') return true
  } catch (_) {
    /* users table shape may differ in some envs — fall through */
  }
  // Legacy fallback: user_roles/roles tables when present.
  try {
    const r = await executeQuery(
      `SELECT COUNT(*) AS cnt FROM user_roles
       JOIN roles ON user_roles.role_id = roles.role_id
       WHERE user_roles.employee_id = $1 AND LOWER(roles.role_name) = 'superadmin'`,
      [employeeId]
    )
    if (r && r[0] && parseInt(r[0].cnt, 10) > 0) return true
  } catch (err) {
    if (err.code !== '42P01') throw err
  }
  return false
}

/** ================= REVERT & REVIEW FEATURE ================= */

/**
 * Check if a specific stage has already reverted a requisition.
 * Each stage can only revert once.
 * @param {number} reqId - Requisition ID
 * @param {string} stage - Stage to check (e.g., 'procurement', 'finance')
 * @returns {Promise<boolean>} - True if this stage has already reverted
 */
export async function hasStageReverted(reqId, stage) {
  const result = await executeQuery(
    `SELECT has_been_reverted, reverted_from_stage
     FROM requisition
     WHERE req_id = $1 AND has_been_reverted = 1 AND reverted_from_stage = $2`,
    [reqId, stage]
  )
  return result && result.length > 0
}

/**
 * Revert a requisition back to HOD for review/corrections.
 * This clears all approvals and moves the requisition back to HOD bucket.
 * @param {number} reqId - Requisition ID
 * @param {string} fromStage - Stage triggering the revert (e.g., 'procurement', 'finance')
 * @param {number} revertedByEmployeeId - Employee ID of the person reverting
 * @param {string} comment - Explanation for why it's being reverted
 * @returns {Promise<Object|null>} - Updated requisition or null if failed
 */
export async function revertRequisitionToHod(reqId, fromStage, revertedByEmployeeId, comment) {
  // First, clear all approvals after the stage using the database function
  await executeQuery(`SELECT clear_approvals_after_stage($1, $2)`, [reqId, fromStage])

  // Then update the requisition with revert information
  const result = await executeQuery(
    `UPDATE requisition SET
       has_been_reverted = 1,
       reverted_from_stage = $2,
       reverted_to_stage = 'hod',
       reverted_by_employee_id = $3,
       reverted_at = NOW(),
       revert_comment = $4,
       req_current_stage_key = 'hod',
       resubmit_skip_stages = TRUE
     WHERE req_id = $1
     RETURNING req_id, req_reference_no, req_current_stage_key, has_been_reverted, reverted_from_stage`,
    [reqId, fromStage, revertedByEmployeeId, comment]
  )

  return result && result[0] ? result[0] : null
}

/** Alias for getHodDepartmentsForEmployee ? used by revert feature service. */
export async function getHodDepartments(employeeId) {
  return getHodDepartmentsForEmployee(employeeId)
}

/**
 * Mark a requisition as resubmitted after HOD corrections.
 * Clears revert tracking flags and sets stage to the original fromStage.
 */
export async function resubmitRequisitionAfterRevert(reqId, targetStage) {
  return executeQuery(
    `UPDATE requisition SET
       revert_resolved_at = NOW(),
       resubmit_skip_stages = FALSE,
       req_hod_approval = 1,
       req_hod_approval_date = CURRENT_TIMESTAMP,
       req_current_stage_key = $2
     WHERE req_id = $1
     RETURNING req_id, req_reference_no, req_current_stage_key`,
    [reqId, targetStage]
  )
}

/**
 * Get requisitions that were reverted and are pending creator acknowledgment
 * (has_been_reverted=1, not yet resolved, created by employeeId).
 */
export async function getMyRevertedRequisitionsList(employeeId) {
  try {
    return executeQuery(
      `SELECT r.*, e.first_name, e.last_name, e.email, e.employee_code, d.department_name,
         desg.desg_name AS designation_name
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       WHERE r.req_emp_id = $1
         AND r.has_been_reverted = 1
         AND r.revert_resolved_at IS NULL
         AND COALESCE(r.req_is_rejected, 0) = 0
       ORDER BY r.reverted_at DESC`,
      [employeeId]
    )
  } catch (err) {
    if (err.code === '42703') return []
    throw err
  }
}

/**
 * Get pending requisitions that have been reverted to HOD for correction.
 * @param {number} departmentId - Department ID
 * @param {string} departmentName - Department name (for display)
 * @returns {Promise<Array>}
 */
export async function getPendingHodRevertedRequisitions(departmentId, departmentName) {
  try {
    const result = await executeQuery(
      `SELECT
        r.*,
        e.first_name || ' ' || e.last_name AS employee_name,
        d.department_name,
        desg.desg_name AS designation
       FROM requisition r
       JOIN employees e ON r.req_emp_id = e.employee_id
       LEFT JOIN departments d ON e.department_id = d.department_id
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id
       WHERE r.has_been_reverted = 1
         AND r.req_current_stage_key = 'hod'
         AND r.revert_resolved_at IS NULL
         AND e.department_id = $1
         AND r.req_is_rejected = 0
         AND r.req_purchase_completed = 0
       ORDER BY r.reverted_at DESC`,
      [departmentId]
    )
    return result || []
  } catch (err) {
    if (err.code === '42703') {
      // Column doesn't exist yet (migration not applied) - return empty
      return []
    }
    throw err
  }
}

export async function saveInvoiceUrl(reqId, invoiceUrl, uploadedByEid) {
  await executeQuery(
    `UPDATE requisition
     SET req_invoice_url = $2,
         req_invoice_uploaded_at = CURRENT_TIMESTAMP,
         req_invoice_uploaded_by = $3
     WHERE req_id = $1`,
    [reqId, invoiceUrl, uploadedByEid]
  )
}

export async function getRequisitionForInvoiceUpload(reqId) {
  return executeQuery(
    `SELECT req_id, req_approved_quotation_index,
            req_quotation_1_url, req_quotation_2_url, req_quotation_3_url,
            req_invoice_url
     FROM requisition
     WHERE req_id = $1
       AND req_current_stage_key = 'procurement'
       AND req_finance_approval = 1
       AND req_approved_quotation_index IS NOT NULL`,
    [reqId]
  )
}

export async function getRequisitionForPayableForward(reqId) {
  return executeQuery(
    `SELECT r.*,
            e.first_name, e.last_name, e.email AS creator_email,
            e.employee_code,
            d.department_name,
            hod_emp.first_name AS hod_first_name, hod_emp.last_name AS hod_last_name, hod_emp.employee_code AS hod_employee_code,
            com_emp.first_name AS com_first_name, com_emp.last_name AS com_last_name, com_emp.employee_code AS com_employee_code,
            ceo_emp.first_name AS ceo_first_name, ceo_emp.last_name AS ceo_last_name, ceo_emp.employee_code AS ceo_employee_code,
            proc_emp.first_name AS proc_first_name, proc_emp.last_name AS proc_last_name, proc_emp.employee_code AS proc_employee_code,
            fin_emp.first_name AS fin_first_name, fin_emp.last_name AS fin_last_name, fin_emp.employee_code AS fin_employee_code
     FROM requisition r
     JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     LEFT JOIN employees hod_emp ON r.req_hod_approved_by = hod_emp.employee_id
     LEFT JOIN employees com_emp ON r.req_committee_approved_by = com_emp.employee_id
     LEFT JOIN employees ceo_emp ON r.req_ceo_approved_by = ceo_emp.employee_id
     LEFT JOIN employees proc_emp ON r.req_procurement_ack_by = proc_emp.employee_id
     LEFT JOIN employees fin_emp ON r.req_finance_approved_by = fin_emp.employee_id
     WHERE r.req_id = $1
       AND r.req_current_stage_key = 'procurement'
       AND r.req_finance_approval = 1
       AND r.req_invoice_url IS NOT NULL
       AND r.req_forwarded_to_payable_at IS NULL`,
    [reqId]
  )
}

export async function getItemsByReqId(reqId) {
  return executeQuery(
    `SELECT item_desc, item_size, item_brand, item_qty, committee_approved_qty, item_est_cost, item_remarks
     FROM requisition_items
     WHERE req_id = $1`,
    [reqId]
  )
}

export async function markForwardedToPayable(reqId, eid) {
  await executeQuery(
    `UPDATE requisition
     SET req_forwarded_to_payable_at = CURRENT_TIMESTAMP,
         req_forwarded_to_payable_by = $2
     WHERE req_id = $1`,
    [reqId, eid]
  )
}