// tests/tax-cert-candidates.test.js — Tax Certificate Sheet (stored register) pure-function tests
import { test } from 'node:test'
import assert from 'node:assert/strict'
import XLSX from 'xlsx'
import {
  TAX_CERT_SHEET_HEADER,
  parseTaxCertSheetRows,
  storedRowToSheetRow,
  storedRowToJson,
  buildTaxCertificateTemplate,
  buildTaxCertificateSheet,
  normalizeFiscalYear
} from '../src/services/administration.service.js'

const HEADER = TAX_CERT_SHEET_HEADER
// Full sample row in exact header order.
const SAMPLE_ROW = [
  '2025-26', '10001', 'Syed Salman Hussain', 'CEO', 'Management', '4200053631127',
  'SYED SALMAN HUSSAIN', '1102, BON VISTA BLOCK A, BATH ISLAND CLIFTON KARACHI', '1614152-7',
  'Active', 'iTecknologi Tracking Services (Pvt) Ltd.',
  '9th & 10th Floor, QM Building, Roomi Street, Block-7, Clifton, Karachi-Pakistan',
  '8939436-6', 39302940, 14101362
]

function sheetBuffer(aoa) {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

test('header has Fiscal Year first and 15 columns', () => {
  assert.equal(HEADER[0], 'Fiscal Year')
  assert.equal(HEADER.length, 15)
})

test('parseTaxCertSheetRows maps columns by position', () => {
  const { rows, skipped } = parseTaxCertSheetRows(sheetBuffer([HEADER, SAMPLE_ROW]))
  assert.equal(skipped, 0)
  assert.equal(rows.length, 1)
  const r = rows[0]
  assert.equal(r.fiscal_year, '2025-26')
  assert.equal(r.employee_code, '10001')
  assert.equal(r.employee_name, 'Syed Salman Hussain')
  assert.equal(r.designation, 'CEO')
  assert.equal(r.department, 'Management')
  assert.equal(r.cnic, '4200053631127')
  assert.equal(r.ntn, '1614152-7')
  assert.equal(r.status, 'Active')
  assert.equal(r.address, '1102, BON VISTA BLOCK A, BATH ISLAND CLIFTON KARACHI')
  assert.equal(r.total_income, 39302940)
  assert.equal(r.total_tax, 14101362)
})

test('parseTaxCertSheetRows skips rows missing employee code or fiscal year, and strips commas from totals', () => {
  const noCode = ['2025-26', '', 'X', '', '', '', '', '', '', '', '', '', '', 1, 2]
  const noFy = ['', '10002', 'Y', '', '', '', '', '', '', '', '', '', '', 1, 2]
  const commaTotals = ['2025-26', '10003', 'Z', '', '', '', '', '', '', '', '', '', '', '1,234,567', '89,000']
  const { rows, skipped } = parseTaxCertSheetRows(sheetBuffer([HEADER, noCode, noFy, commaTotals]))
  assert.equal(skipped, 2)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].employee_code, '10003')
  assert.equal(rows[0].total_income, 1234567)
  assert.equal(rows[0].total_tax, 89000)
})

test('parseTaxCertSheetRows normalizes FY variants and skips unparseable FY', () => {
  const variant = ['2025/2026', '10005', 'V', '', '', '', '', '', '', '', '', '', '', 10, 2]
  const badFy = ['2025-27', '10006', 'B', '', '', '', '', '', '', '', '', '', '', 10, 2] // end != start+1
  const { rows, skipped } = parseTaxCertSheetRows(sheetBuffer([HEADER, variant, badFy]))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].fiscal_year, '2025-26')
  assert.equal(skipped, 1)
})

test('normalizeFiscalYear canonicalizes common variants to YYYY-YY', () => {
  assert.equal(normalizeFiscalYear('2025-26'), '2025-26')
  assert.equal(normalizeFiscalYear('2025-2026'), '2025-26')
  assert.equal(normalizeFiscalYear('2025/26'), '2025-26')
  assert.equal(normalizeFiscalYear('2025 2026'), '2025-26')
  assert.equal(normalizeFiscalYear('FY2025-26'), '2025-26')
  assert.equal(normalizeFiscalYear('  fy 2025 - 2026 '), '2025-26')
  assert.equal(normalizeFiscalYear('2025'), '2025-26')
})

test('normalizeFiscalYear rejects invalid values', () => {
  assert.equal(normalizeFiscalYear('2025-27'), null)  // end != start+1
  assert.equal(normalizeFiscalYear('25-26'), null)    // start not 4-digit
  assert.equal(normalizeFiscalYear('abc'), null)
  assert.equal(normalizeFiscalYear(''), null)
  assert.equal(normalizeFiscalYear(null), null)
})

test('storedRowToSheetRow injects company constants and uppercases the registered name', () => {
  const dbRow = {
    fiscal_year: '2025-26', employee_code: '10001', employee_name: 'Syed Salman Hussain',
    designation: 'CEO', department: 'Management', cnic: '4200053631127', ntn: '1614152-7',
    status: 'Active', address: '1102, BON VISTA', total_income: '39302940.00', total_tax: '14101362.00'
  }
  const row = storedRowToSheetRow(dbRow)
  assert.equal(row.length, HEADER.length)
  assert.equal(row[0], '2025-26')
  assert.equal(row[6], 'SYED SALMAN HUSSAIN')          // as-registered name (uppercased)
  assert.equal(row[10], 'iTecknologi Tracking Services (Pvt) Ltd.') // Company Name
  assert.equal(row[12], '8939436-6')                    // Company NTN
  assert.equal(row[13], 39302940)                       // Total Income (numeric from NUMERIC string)
  assert.equal(row[14], 14101362)                       // Total Tax
})

test('storedRowToJson exposes camelCase numeric preview fields', () => {
  const j = storedRowToJson({ employee_code: '10001', fiscal_year: '2025-26', total_income: '100', total_tax: '20' })
  assert.equal(j.employeeCode, '10001')
  assert.equal(j.totalIncome, 100)
  assert.equal(j.totalTax, 20)
})

test('buildTaxCertificateTemplate is header-only with a Fiscal Year format hint', () => {
  const { buffer, filename } = buildTaxCertificateTemplate()
  assert.match(filename, /\.xlsx$/)
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false })
  assert.equal(aoa.length, 1)
  assert.match(aoa[0][0], /Fiscal Year.*2025-26/)     // FY column carries the format hint
  assert.deepEqual(aoa[0].slice(1), HEADER.slice(1))   // other columns unchanged
})

test('buildTaxCertificateSheet round-trips stored rows back through parse', () => {
  const dbRow = {
    fiscal_year: '2025-26', employee_code: '10001', employee_name: 'Syed Salman Hussain',
    designation: 'CEO', department: 'Management', cnic: '4200053631127', ntn: '1614152-7',
    status: 'Active', address: '1102, BON VISTA', total_income: 39302940, total_tax: 14101362
  }
  const { buffer } = buildTaxCertificateSheet([dbRow])
  const { rows } = parseTaxCertSheetRows(buffer)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].employee_code, '10001')
  assert.equal(rows[0].total_tax, 14101362)
})
