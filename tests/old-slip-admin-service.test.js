// tests/old-slip-admin-service.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aliasEmployeeCode, OLD_SLIP_TEMPLATE_COLUMNS } from '../src/services/administration.service.js'

test('template columns include identifier, pay month, and the 6 taxable elements', () => {
  for (const c of ['Employee_Code', 'Pay_Month', 'Basic_Salary_1', 'Medical_Allowance_2',
    'House_Rent_Allowance_5', 'Utilities_Allowance_6', 'Incentives_Tech_10', 'Incremental_Arrears_31']) {
    assert.ok(OLD_SLIP_TEMPLATE_COLUMNS.includes(c), `missing ${c}`)
  }
})

test('aliasEmployeeCode maps Employee_Code to HR_Emp_ID + Source_Employee_Code', () => {
  const out = aliasEmployeeCode({ Employee_Code: '1234', Pay_Month: '2024-01-01' })
  assert.equal(out.HR_Emp_ID, '1234')
  assert.equal(out.Source_Employee_Code, '1234')
  assert.equal(out.Pay_Month, '2024-01-01')
})

test('aliasEmployeeCode does not override an explicit HR_Emp_ID', () => {
  const out = aliasEmployeeCode({ Employee_Code: '1234', HR_Emp_ID: '9999' })
  assert.equal(out.HR_Emp_ID, '9999')
})
