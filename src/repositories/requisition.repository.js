import { executeQuery, executeTransaction } from '../../config/database.js'

export async function getRequisitionsByEmployeeId(employeeId) {
  return executeQuery(
    'SELECT r.* FROM requisition r WHERE r.req_emp_id = $1 ORDER BY r.req_created_at DESC',
    [employeeId]
  )
}

export async function getRequisitionItemsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery(
    'SELECT item_id, req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks FROM requisition_items WHERE req_id = ANY($1)',
    [reqIds]
  )
}

export async function getTrackRecordsCount() {
  const r = await executeQuery(`
    SELECT COUNT(*) AS total FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
  `)
  return parseInt(r[0]?.total ?? 0, 10)
}

export async function getTrackRecordsAll(limit, offset) {
  return executeQuery(`
    SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
    FROM requisition r
    JOIN employees e ON r.req_emp_id = e.employee_id
    LEFT JOIN departments d ON e.department_id = d.department_id
    ORDER BY r.req_created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset])
}

export async function getTrackRecordsByEmployee(employeeId, limit, offset) {
  return executeQuery(`
    SELECT r.* FROM requisition r WHERE r.req_emp_id = $1
    ORDER BY r.req_created_at DESC
    LIMIT $2 OFFSET $3
  `, [employeeId, limit, offset])
}

export async function getTrackRecordsCountByEmployee(employeeId) {
  const r = await executeQuery('SELECT COUNT(*) AS total FROM requisition r WHERE r.req_emp_id = $1', [employeeId])
  return parseInt(r[0]?.total ?? 0, 10)
}

export async function getItemCountsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery(
    'SELECT req_id, COUNT(*) AS cnt FROM requisition_items WHERE req_id = ANY($1) GROUP BY req_id',
    [reqIds]
  )
}

export async function createRequisition(employeeId, location, material, requiredByDate, business) {
  await executeQuery(
    `INSERT INTO requisition (req_emp_id, req_location, req_material, req_required_by_date, req_business)
     VALUES ($1, $2, $3, $4, $5)`,
    [employeeId, location || null, material || null, requiredByDate || null, business || 'iTecknologi Tracking Pvt. Ltd']
  )
  const r = await executeQuery(
    'SELECT req_id, req_reference_no FROM requisition WHERE req_emp_id = $1 ORDER BY req_created_at DESC LIMIT 1',
    [employeeId]
  )
  return r[0]
}

export async function insertRequisitionItem(reqId, item) {
  return executeQuery(
    `INSERT INTO requisition_items (req_id, item_desc, item_size, item_brand, item_qty, item_est_cost, item_remarks)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      reqId,
      item.itemDesc || item.item_desc || null,
      item.itemSize || item.item_size || null,
      item.itemBrand || item.item_brand || null,
      item.itemQty ?? item.item_qty ?? 1,
      item.itemEstCost || item.item_est_cost || null,
      item.itemRemarks || item.item_remarks || null
    ]
  )
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
      req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1`,
    [reqId]
  )
}

export async function autoAdvanceHodRequisition(reqId) {
  return executeQuery(
    `UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1`,
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

// Role helpers
export async function getHodByDepartment(departmentId) {
  if (departmentId == null) return null
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
    const rows = await executeQuery(
      `SELECT 1 FROM employees e
       LEFT JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Finance'
       LEFT JOIN designation desg ON e.designation_id = desg.desg_id AND desg.desg_name = 'Finance'
       WHERE e.employee_id = $1 AND (et.emp_type_id IS NOT NULL OR desg.desg_id IS NOT NULL)`,
      [employeeId]
    )
    return rows.length > 0
  } catch (err) {
    if (err.code === '42P01') {
      try {
        const rows = await executeQuery(
          `SELECT 1 FROM employees e INNER JOIN employee_type et ON e.employee_type_id = et.emp_type_id AND et.emp_type_name = 'Finance' WHERE e.employee_id = $1`,
          [employeeId]
        )
        return rows.length > 0
      } catch (_) { return false }
    }
    throw err
  }
}

export async function getRequisitionAndDepartment(requisitionId) {
  return executeQuery(
    'SELECT r.req_id, e.department_id FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id WHERE r.req_id = $1',
    [requisitionId]
  )
}

export async function rejectRequisition(requisitionId) {
  return executeQuery('UPDATE requisition SET req_is_rejected = 1 WHERE req_id = $1', [requisitionId])
}

export async function updateItemHodBoq(itemId, reqId, size, brand, qty, estCost) {
  return executeQuery(
    `UPDATE requisition_items SET item_size = $1, item_brand = $2, item_qty = $3, item_est_cost = $4 WHERE item_id = $5 AND req_id = $6`,
    [size || null, brand || null, (qty != null && !Number.isNaN(qty)) ? qty : null, estCost || null, itemId, reqId]
  )
}

export async function approveHod(requisitionId) {
  return executeQuery(
    'UPDATE requisition SET req_hod_approval = 1, req_hod_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1',
    [requisitionId]
  )
}

export async function updateItemCommitteeApprovedQty(itemId, qty) {
  return executeQuery(
    'UPDATE requisition_items SET committee_approved_qty = $1 WHERE item_id = $2',
    [qty, itemId]
  )
}

export async function approveCommittee(requisitionId) {
  return executeQuery(
    'UPDATE requisition SET req_committee_approval = 1, req_committee_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1',
    [requisitionId]
  )
}

export async function approveCeo(requisitionId) {
  return executeQuery(
    'UPDATE requisition SET req_ceo_approval = 1, req_ceo_approval_date = CURRENT_TIMESTAMP WHERE req_id = $1',
    [requisitionId]
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
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE r.req_id = $1`,
    [reqId]
  )
}

export async function getRequisitionRowForTat(reqId) {
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

export async function getPendingHodRequisitions(deptId, deptName, excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE (COALESCE(r.req_is_rejected, 0)::int = 0) AND (COALESCE(r.req_hod_approval, 0)::int = 0)
     AND r.req_emp_id != $3
     AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY r.req_created_at ASC`,
    [deptId, deptName, excludeEmployeeId]
  )
}

export async function getApprovedByHodRequisitions(deptId, deptName) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE (COALESCE(r.req_hod_approval, 0)::int = 1) AND (COALESCE(r.req_is_rejected, 0)::int = 0)
     AND (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY r.req_hod_approval_date DESC NULLS LAST, r.req_created_at DESC`,
    [deptId, deptName]
  )
}

export async function getPendingCommitteeRequisitions(excludeEmployeeId) {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE (COALESCE(r.req_is_rejected, 0)::int = 0) AND (COALESCE(r.req_hod_approval, 0)::int = 1)
     AND (COALESCE(r.req_committee_approval, 0)::int = 0) AND r.req_emp_id != $1
     ORDER BY r.req_created_at ASC`,
    [excludeEmployeeId]
  )
}

export async function getPendingCeoRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE r.req_is_rejected = 0 AND r.req_hod_approval = 1 AND r.req_committee_approval = 1
     AND (r.req_ceo_approval = 0 OR r.req_ceo_approval IS NULL)
     ORDER BY r.req_created_at ASC`
  )
}

export async function getPendingProcurementRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE r.req_is_rejected = 0 AND r.req_hod_approval = 1 AND r.req_committee_approval = 1 AND r.req_ceo_approval = 1
     ORDER BY r.req_created_at ASC`
  )
}

export async function getPendingFinanceRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE COALESCE(r.req_is_rejected, 0) = 0 AND r.req_handed_to_finance = 1 AND COALESCE(r.req_finance_approval, 0) = 0
     ORDER BY r.req_handed_to_finance_date ASC`
  )
}

export async function getRequisitionForProcurementAck(reqId) {
  return executeQuery(
    'SELECT req_id FROM requisition WHERE req_id = $1 AND req_is_rejected = 0 AND req_hod_approval = 1 AND req_committee_approval = 1 AND req_ceo_approval = 1',
    [reqId]
  )
}

export async function getRequisitionForQuotations(reqId) {
  return executeQuery('SELECT req_id FROM requisition WHERE req_id = $1 AND req_procurement_ack = 1', [reqId])
}

export async function getRequisitionForHandover(reqId) {
  return executeQuery(
    'SELECT req_id, req_quotation_1_url, req_quotation_2_url, req_quotation_3_url FROM requisition WHERE req_id = $1 AND req_procurement_ack = 1',
    [reqId]
  )
}

export async function getRequisitionForExpectedHandover(reqId) {
  return executeQuery(
    'SELECT req_id FROM requisition WHERE req_id = $1 AND req_is_rejected = 0 AND req_hod_approval = 1 AND req_committee_approval = 1 AND req_ceo_approval = 1',
    [reqId]
  )
}

export async function getRequisitionForFinanceApproval(reqId) {
  return executeQuery(
    'SELECT req_id FROM requisition WHERE req_id = $1 AND req_handed_to_finance = 1 AND COALESCE(req_finance_approval, 0) = 0',
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
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     WHERE (e.department_id = $1 OR (LOWER(TRIM(COALESCE(d.department_name, ''))) = $2 AND $2 != ''))
     ORDER BY r.req_created_at DESC`,
    [deptId, deptNameLower]
  )
}

export async function getReportAllRequisitions() {
  return executeQuery(
    `SELECT r.*, e.first_name, e.last_name, e.email, d.department_name
     FROM requisition r JOIN employees e ON r.req_emp_id = e.employee_id
     LEFT JOIN departments d ON e.department_id = d.department_id
     ORDER BY r.req_created_at DESC`
  )
}

export async function getItemsByReqIds(reqIds) {
  if (!reqIds.length) return []
  return executeQuery('SELECT * FROM requisition_items WHERE req_id = ANY($1)', [reqIds])
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
     WHERE r.req_is_rejected = 0 AND (r.req_hod_approval = 0 OR r.req_hod_approval IS NULL)
     AND (e.department_id = $1 OR (LOWER(TRIM(d.department_name)) = $2 AND $2 != ''))`,
    [deptId, deptNameLower]
  )
  return parseInt(r[0]?.c || 0, 10)
}

export async function getPendingCommitteeCount() {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition WHERE req_is_rejected = 0 AND req_hod_approval = 1 AND (req_committee_approval = 0 OR req_committee_approval IS NULL)`
  )
  return parseInt(r[0]?.c || 0, 10)
}

export async function getPendingCeoCount() {
  const r = await executeQuery(
    `SELECT COUNT(*) AS c FROM requisition WHERE req_is_rejected = 0 AND req_hod_approval = 1 AND req_committee_approval = 1 AND (req_ceo_approval = 0 OR req_ceo_approval IS NULL)`
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
