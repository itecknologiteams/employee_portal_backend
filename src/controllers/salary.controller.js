import * as salaryService from '../services/salary.service.js'

export async function getCurrentSalary(req, res) {
  try {
    const { employeeId } = req.params
    const salary = await salaryService.getCurrentSalary(employeeId)
    res.json(salary)
  } catch (error) {
    console.error('Current salary error:', error)
    res.status(500).json({ error: 'Failed to fetch current salary' })
  }
}

export async function getSalaryHistory(req, res) {
  try {
    const { employeeId } = req.params
    const limit = parseInt(req.query.limit) || 12
    const history = await salaryService.getSalaryHistory(employeeId, limit)
    res.json(history)
  } catch (error) {
    console.error('Salary history error:', error)
    res.status(500).json({ error: 'Failed to fetch salary history' })
  }
}

export async function downloadSalarySlip(req, res) {
  try {
    const { salarySlipId } = req.params
    const data = await salaryService.getSalarySlipForDownload(salarySlipId)
    if (!data) {
      return res.status(404).json({ error: 'Salary slip not found' })
    }
    res.json({ message: 'Salary slip download initiated', data })
  } catch (error) {
    console.error('Download salary slip error:', error)
    res.status(500).json({ error: 'Failed to download salary slip' })
  }
}
