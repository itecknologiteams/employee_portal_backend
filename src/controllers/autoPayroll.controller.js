import * as service from '../services/autoPayroll.service.js'

function send(res, result) {
  if (result && result.error) {
    return res.status(result.status || 500).json({ error: result.error })
  }
  return res.json(result)
}

// Periods
export async function createPeriod(req, res) {
  try {
    const result = await service.createPeriod({ ...req.body, createdBy: req.user?.employee_id || null })
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] createPeriod:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function listPeriods(req, res) {
  try {
    const result = await service.listPeriods(req.query)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] listPeriods:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function getPeriod(req, res) {
  try {
    const result = await service.getPeriod(req.params.id)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] getPeriod:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function deletePeriod(req, res) {
  try {
    const result = await service.deletePeriod(req.params.id)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] deletePeriod:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Entries
export async function upsertEntry(req, res) {
  try {
    const result = await service.upsertEntry(req.params.id, {
      ...req.body,
      createdBy: req.user?.employee_id || null
    })
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] upsertEntry:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function listEntries(req, res) {
  try {
    const result = await service.listEntries(req.params.id)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] listEntries:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function deleteEntry(req, res) {
  try {
    const result = await service.deleteEntry(req.params.entryId)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] deleteEntry:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function uploadEntries(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const result = await service.uploadEntries(
      req.params.id,
      req.file,
      req.user?.employee_id || null
    )
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] uploadEntries:', err)
    return res.status(500).json({ error: err.message })
  }
}

// Run + Slips
export async function runPayroll(req, res) {
  try {
    const result = await service.runPayroll(req.params.id, req.user?.employee_id || null)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] runPayroll:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function listSlips(req, res) {
  try {
    const result = await service.listSlips(req.params.id)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] listSlips:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function updateSlip(req, res) {
  try {
    const result = await service.updateSlip(
      req.params.slipId,
      req.body,
      req.user?.employee_id || null
    )
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] updateSlip:', err)
    return res.status(500).json({ error: err.message })
  }
}

export async function publish(req, res) {
  try {
    const result = await service.publish(req.params.id)
    return send(res, result)
  } catch (err) {
    console.error('[auto-payroll] publish:', err)
    return res.status(500).json({ error: err.message })
  }
}
