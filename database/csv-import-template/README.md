# Leave Quota CSV Import

This folder contains the template for importing leave quotas via CSV.

## CSV Format

The CSV file should have the following columns:

| Column | Required | Description | Default |
|--------|----------|-------------|---------|
| employeeCode | Yes | Employee code (e.g., EMP001) | - |
| annual | Yes | Annual leave days | Auto-calculated* |
| casual | Yes | Casual leave days | 10 |
| sick | Yes | Sick leave days | 6 |
| carried | No | Carried forward days | 0 |
| marriage | No | Marriage leave days | 10 |
| maternity | No | Maternity leave days | Gender-based** |
| paternal | No | Paternal leave days | Gender-based** |
| pilgrimage | No | Pilgrimage leave days | 20 |

\* **Annual Leave Auto-Calculation:**
- **Formula:** `14 / 12 * Remaining Months in completion of year`
- **After completing 1 year:** Employee gets full 14 days
- **Example:** If employee joins in March, they get prorated leave for remaining months until next March
- If you explicitly provide an `annual` value, it will override the auto-calculation

\*\* **Gender-Based Leave Assignment:**
- **Female employees:** `maternity_leave = 90` days, `paternal_leave = 0` days
- **Male employees:** `paternal_leave = 7` days, `maternity_leave = 0` days
- Gender is automatically detected from employee records
- If you explicitly provide values in CSV, they will override the gender-based defaults

## Example CSV Import (Minimal Fields)

For most cases, you only need to specify employee code and basic leaves:

```csv
employeeCode,annual,casual,sick,carried,marriage,pilgrimage
EMP001,14,10,6,0,10,20
EMP002,,10,6,0,10,20
EMP003,20,15,10,5,10,20
```

In this example:
- `EMP001`: Full values provided, maternity/paternal will be assigned based on gender
- `EMP002`: Annual will be auto-calculated based on join date
- `EMP003`: Custom values with 20 annual days and 5 carried forward days

## Gender-Based Assignment Examples

### Female Employee (EMP001 is Female):
After import, the system will automatically set:
- `maternity_leave = 90` days
- `paternal_leave = 0` days

### Male Employee (EMP002 is Male):
After import, the system will automatically set:
- `paternal_leave = 7` days
- `maternity_leave = 0` days

## How to Import via API

Use the bulk import API endpoint:

```javascript
const data = [
  { employeeCode: 'EMP001', annual: 14, casual: 10, sick: 6, carried: 0, marriage: 10, pilgrimage: 20 },
  { employeeCode: 'EMP002', casual: 10, sick: 6, carried: 0, marriage: 10 } // annual will be auto-calculated, maternity/paternal based on gender
];

await leaveAPI.hrBulkImportBalances({ hrEmployeeId: '123', data });
```

The API response will include the gender-based assignment information:

```json
{
  "imported": 2,
  "failed": 0,
  "results": [
    {
      "employeeCode": "EMP001",
      "gender": "female",
      "annual": 14,
      "casual": 10,
      "sick": 6,
      "maternity": 90,
      "paternal": 0,
      "genderBasedAssignment": "Female: Maternity leave assigned"
    },
    {
      "employeeCode": "EMP002",
      "gender": "male",
      "annual": 12,
      "casual": 10,
      "sick": 6,
      "maternity": 0,
      "paternal": 7,
      "genderBasedAssignment": "Male: Paternal leave assigned"
    }
  ]
}
```

## Calculate Prorated Annual Leave

You can preview the calculated annual leave for an employee before importing:

```javascript
const result = await leaveAPI.calculateAnnualLeave('EMP001');
// Returns: { employeeCode, joinDate, calculatedAnnualLeave, fullAnnualLeave, isProrated, note }
```

## Annual Leave Rollover (2+ Years Employees)

When an employee completes **2 years or more**, their remaining annual leaves can be rolled over to `carried_forward` and they receive a fresh annual quota.

### How It Works

1. **Eligibility:** Employee must have completed 2 years of service
2. **Rollover Process:**
   - Remaining annual leave days are added to `carried_forward`
   - Annual leave is reset to 14 days (new quota)
3. **Example:**
   - Employee has 5 days remaining in annual leave
   - Has 3 days in carried_forward
   - After rollover: carried_forward = 8 days (5+3), annual_leave = 14 days

### Check Eligibility

```javascript
const result = await leaveAPI.checkRolloverEligibility('EMP001');
// Returns: { employeeCode, eligible, yearsOfService, currentAnnual, currentCarried, projectedCarried, newAnnualQuota, message }
```

### Rollover One Employee

```javascript
const result = await leaveAPI.rolloverAnnualLeave({
  hrEmployeeId: '123',
  employeeCode: 'EMP001'
});
// Returns: { success, employeeCode, yearsOfService, rolledOverAmount, newAnnualLeave, newCarriedForward, message }
```

### Bulk Rollover (All Eligible Employees)

```javascript
const result = await leaveAPI.bulkRolloverAnnualLeaves({
  hrEmployeeId: '123'
});
// Returns: { success, processed, skipped, total, details, message }
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/leave/hr/rollover-eligibility/:employeeCode` | GET | Check if employee is eligible |
| `/leave/hr/rollover-annual-leave/:employeeCode` | POST | Rollover for one employee |
| `/leave/hr/bulk-rollover` | POST | Bulk rollover all eligible |

## Carried Forward Import (One-Time Setup)

For initial setup, you can import carried forward leave days separately using a simple CSV format. This is typically a **one-time import** - after this, carried forward will be calculated automatically through the annual leave rollover process.

### CSV Format for Carried Forward

| Column | Required | Description |
|--------|----------|-------------|
| employeeCode | Yes | Employee code (e.g., EMP001) |
| carried_days | Yes | Carried forward leave days (0 or more) |

### Example

```csv
employee_code,carried_days
EMP001,5
EMP002,10
EMP003,0
EMP004,3
```

### How to Import via UI

1. Go to **Employee Leave Quota** page in the HR portal
2. Find the **"Import Carried Forward Leaves (One-Time)"** section
3. Click **"Select CSV File"** and choose your file
4. Review the preview showing first 5 rows
5. Click **"Import Carried Forward"** to complete

### How to Import via API

```javascript
const data = [
  { employeeCode: 'EMP001', carried: 5 },
  { employeeCode: 'EMP002', carried: 10 },
  { employeeCode: 'EMP003', carried: 0 }
];

await leaveAPI.hrBulkImportBalances({ hrEmployeeId: '123', data });
```

### Important Notes

- This is typically a **ONE-TIME import** for initial data migration
- After this import, use the **Annual Leave Rollover** feature for automatic calculation
- When employees complete 2+ years, their remaining annual leave will automatically be added to carried_forward
- Only the `carried_forward` field is updated; other leave types are not affected
- Use the full leave quota import (`leave_quota_import_template.csv`) for comprehensive imports

## General Notes

- Only HR users can import leave quotas and perform rollovers
- If an employee doesn't exist, the row will be skipped with an error
- Existing leave balances will be updated (upsert operation)
- All leave days must be non-negative numbers
- Annual leave is auto-calculated based on join date if not provided
- **Maternity leave (90 days) is only assigned to Female employees**
- **Paternal leave (7 days) is only assigned to Male employees**
- **Rollover is only applicable for employees with 2+ years of service**
