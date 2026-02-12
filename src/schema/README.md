# Payroll schema and API contract

This folder holds the **single reference** for payroll shapes and Excel mapping. The backend payroll API is aligned with these types.

## Excel layout (Payroll.xlsx)

- **Summary sheet**: company-level totals (Total Payable, Income Tax, Loan/Advances, EOBI, Other Ded., Net Payable).
- **Per-company / per-period sheets**: rows per employee with columns such as S.#, Location, Department, Employee ID, Name, Designation, WD, Basic, allowances, deductions, Net Salary Payable, Remarks.

## Column index → field mapping (conceptual)

| Excel / UI        | API / schema field           | Notes                          |
|-------------------|-----------------------------|--------------------------------|
| S.#               | (row index)                 | Serial number                  |
| Location          | `location`                  | Optional on slip              |
| Department        | `department`                | Optional on slip              |
| Employee ID       | `employeeId` / `employeeCode` | Code or ID                   |
| Name              | `employeeName`              |                                |
| Designation       | `designation`               | Optional on slip              |
| WD                | `workingDays` / `paidDays`  | Working days, paid days        |
| Basic             | `basicSalary`               | From structure                 |
| Allowances        | `totalAllowances`           | Sum of all allowances          |
| Deductions        | `totalDeductions`           | Sum of all deductions          |
| Net Salary Payable| `netSalary`                 |                                |
| Remarks           | `remarks`                   | Free text on slip              |

## API contract (backend)

- **Slips**  
  `GET /api/payroll/periods/:id/slips` returns `{ data: SalarySlip[], total, page, limit, totalPages }`.  
  Each slip includes `remarks` when available.

- **Structures**  
  `GET /api/payroll/salary-structures` returns list with all allowance fields (basicSalary, medicalAllowance, conveyanceAllowance, conveyanceLitersAllowance, communicationAllowance, houseRentAllowance, utilitiesAllowance, mealAllowance, otherAllowance, arrears, incrementalArrears, bikeMaintenanceAllowance, incentives, deviceReimbursement, eobiFixed).  
  `POST /api/payroll/salary-structures` accepts the same fields in the body (backend persists them; missing columns are ignored until migration is run).

- **Overrides**  
  `GET /api/payroll/periods/:id/overrides` returns list of `PeriodOverride` with `workingDays`, `otherAllowance`, `otherDeduction`, `loan`, `salaryAdvance`.  
  `PUT /api/payroll/periods/:id/overrides` accepts body `{ overrides: PeriodOverride[] }` or a raw array; each item can include `loan` and `salaryAdvance`. Backend stores and uses them in payroll run (deductions).

Types are defined in `payroll.js` (JSDoc) in this folder.
