# CRM Login Integration

When **CRM_HOST** is set in `.env`, login **uses only the CRM SQL Server** (no fallback to PostgreSQL). You must restart the server after adding or changing CRM env vars.

If **CRM_HOST** is set, the login flow:

1. Call **ERP_Tracking.dbo.CheckLogin (U_ID, PASS)** on the CRM SQL Server with the username and password.
2. If the procedure returns at least one row, the **CRM employee ID** is read from that row (columns tried: `Emp_ID`, `HR_Emp_ID`, `Employee_ID`, `EmpId`, `U_ID`, or the first column).
3. The portal looks up **employees** where **employee_code** = that CRM employee ID (PostgreSQL).
4. If a matching employee is found and is active, the user is logged in with that employee’s portal profile and permissions (and **user_type** from the **users** table if they have one).

## .env

Add these for CRM login (optional; if `CRM_HOST` is not set, only portal username/email + password is used):

```env
CRM_HOST=192.168.21.33
CRM_USER=crm
CRM_PASS=your_crm_password
CRM_DB=ERP_Tracking
```

**Important:** These are the credentials for the **backend to connect to the CRM SQL Server**, not the end-user’s login. The error **"Login failed for user 'crm'"** means SQL Server is rejecting this connection (wrong `CRM_PASS`, or user `crm` doesn’t exist / doesn’t have access to `ERP_Tracking`).

- Verify in **SQL Server Management Studio**: connect to `192.168.21.33` with user `crm` and the same password; ensure the login can access database `ERP_Tracking`.
- If the password contains **special characters** (e.g. `@$#%`), use **double quotes** in `.env`:  
  `CRM_PASS="sadoIOJDDAS03209203@$#%"`  
  Single quotes may be parsed as part of the value. The code also strips leading/trailing quotes from env values.

## Requirements

- **SQL Server:** Stored procedure `ERP_Tracking.dbo.CheckLogin` with parameters `U_ID` and `PASS`. It should return a result set when login is valid; the first row is used to get the employee ID. **Passwords in CRM can be plain text** – the backend sends the user’s password as-is to `CheckLogin` (no hashing); the procedure should compare as your CRM does (e.g. plain comparison).
- **Portal:** For each CRM user who should log in, ensure there is an **employees** row with **employee_code** equal to the CRM employee ID (e.g. `10001`). Optionally add a **users** row for that employee if they should have a role other than `User` (Admin, Staff, etc.).

## Flow

1. User submits **username** and **password** to `POST /api/auth/login`.
2. **If CRM is configured (CRM_HOST set):** Call CRM `CheckLogin(username, password)`. If invalid → 401. If valid, find portal employee by `employee_code` = CRM employee ID; if none or inactive → 401/403. Otherwise return login payload. **No PostgreSQL credential check is done.**
3. **If CRM is not configured:** Use existing portal login (users by username, then employees by email).

**If you still see PostgreSQL login:** Ensure `CRM_HOST=192.168.21.33` (and CRM_USER, CRM_PASS, CRM_DB) are in `.env`, then **restart the backend server**.
