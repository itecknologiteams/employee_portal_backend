/**
 * Payroll schema aligned with Payroll.xlsx (January 2026).
 * Use for API request/response shapes and validation.
 * Single reference for backend payroll endpoints.
 */

/** @typedef {'draft'|'processing'|'processed'|'closed'} PayrollPeriodStatus */

/**
 * Payroll period (e.g. "January 2026")
 * @typedef {Object} PayrollPeriod
 * @property {number} id
 * @property {string} name
 * @property {string} startDate - YYYY-MM-DD
 * @property {string} endDate - YYYY-MM-DD
 * @property {number} workingDays
 * @property {PayrollPeriodStatus} status
 * @property {number} [slipCount]
 */

/**
 * Salary structure (per employee) – maps to Excel columns: Basic Salary, Medical, Conveyance, etc.
 * @typedef {Object} SalaryStructure
 * @property {number} employeeId
 * @property {string} [employeeName]
 * @property {string} [employeeCode]
 * @property {number} basicSalary
 * @property {number} [medicalAllowance]
 * @property {number} [conveyanceAllowance] - Fixed Conveyance
 * @property {number} [conveyanceLitersAllowance] - Conveyance in Liters (amount)
 * @property {number} [communicationAllowance]
 * @property {number} [houseRentAllowance] - House Allow.
 * @property {number} [utilitiesAllowance] - Utilities Allowances
 * @property {number} [mealAllowance]
 * @property {number} [otherAllowance]
 * @property {number} [arrears]
 * @property {number} [incrementalArrears]
 * @property {number} [bikeMaintenanceAllowance]
 * @property {number} [incentives]
 * @property {number} [deviceReimbursement]
 * @property {number} [eobiFixed] - EOBI fixed deduction (e.g. 130)
 */

/**
 * Period override (per employee per period) – working days and one-off allowances/deductions.
 * Maps to Excel: WD override, Other Deduction, Loan, Salary Advance, Late, Absent/Late Joining, etc.
 * @typedef {Object} PeriodOverride
 * @property {number} employeeId
 * @property {string} [employeeName]
 * @property {string} [employeeCode]
 * @property {number} workingDays
 * @property {number} [otherAllowance]
 * @property {number} [otherDeduction]
 * @property {number} [incomeTax]
 * @property {number} [loan]
 * @property {number} [salaryAdvance]
 * @property {number} [lateDeduction]
 * @property {number} [absentLateJoiningDeduction]
 * @property {number} [deviceDeduction]
 * @property {number} [cellphoneInstallment]
 * @property {number} [foodpandaDeduction]
 * @property {number} [fuelOverusageDeduction]
 * @property {number} [overUtilizationMobileDeduction]
 */

/**
 * Salary slip (one per employee per period) – aligns with Excel row: S.#, Location, Department,
 * Employee ID, Name, Designation, WD, Basic, Allowances, Deductions, Net Salary Payable, Remarks.
 * @typedef {Object} SalarySlip
 * @property {number} id
 * @property {number} periodId
 * @property {number} employeeId
 * @property {string} [employeeName]
 * @property {string} [employeeCode]
 * @property {string} [location]
 * @property {string} [department]
 * @property {string} [designation]
 * @property {number} paidDays
 * @property {number} workingDays
 * @property {number} grossSalary
 * @property {number} totalAllowances
 * @property {number} totalDeductions
 * @property {number} netSalary
 * @property {string} [status]
 * @property {string} [remarks]
 * @property {number} [incomeTax]
 * @property {number} [loan]
 * @property {number} [salaryAdvance]
 * @property {number} [eobi]
 * @property {number} [otherDeduction]
 * @property {string} [accountNumber]
 */

/**
 * Summary totals (company-level, e.g. Summary sheet in Excel)
 * @typedef {Object} PayrollSummary
 * @property {string} companyName
 * @property {string} periodName
 * @property {number} totalPayable
 * @property {number} incomeTax
 * @property {number} loanAdvances
 * @property {number} eobi
 * @property {number} otherDeductions
 * @property {number} netPayable
 */

export default {}
