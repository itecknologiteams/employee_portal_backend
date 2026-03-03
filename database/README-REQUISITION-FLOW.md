# Requisition flows (user specification)

All category flows are defined below. Run the SQL scripts in order so that `requisition_flow_stage` and `requisition_category_stage` match these flows.

## Run order (PostgreSQL)

1. **requisition-categories-table-pg.sql** – Categories and flags.
2. **requisition-flow-db-driven-pg.sql** – Base flow stages (HOD, Committee, CEO, Procurement, Finance), category_stage seed, `req_current_stage_key`.
3. **requisition-hr-and-admin-pg.sql** – HR stage and columns.
4. **requisition-flows-user-spec-pg.sql** – Admin stage, reorder (Committee → Procurement → Finance → CEO → Admin), and **all 9 category behaviors** as below.
5. **requisition-creator-acknowledge-pg.sql** – Creator acknowledgment columns: after execution, the employee who created the requisition can acknowledge to close the ticket (`req_creator_acknowledged`, `req_creator_acknowledged_date`).
6. **requisition-move-loan-to-hr-bucket-pg.sql** (one-time) – Move existing Loan reqs to HR bucket if needed.

## Flows (9 categories)

| # | Category | Flow |
|---|----------|------|
| 1 | **Stationary** | Employee Requisition → HOD (For Info) → Admin |
| 2 | **Vehicle Maintenance** | Employee Requisition → HOD (For Info) → Admin |
| 3 | **Vehicle Repair** & **Other Repair & Maintenance** | Employee Requisition → HOD (For Info) → Committee → Procurement (Quotations) → Finance → CEO → Admin |
| 4 | **Loan & Advance Salary** | Employee Requisition → HOD (Approval) → HR → Amount &lt;50K (Finance only) or Amount ≥50K (CEO then Finance) → Finance |
| 5 | **Specialized Projects** | Employee Requisition → Procurement (Quotations) → Finance → CEO → Procurement |
| 6 | **IT Equipments** | Employee Requisition → Committee → Procurement (Quotations) → Finance → CEO → Procurement |
| 7 | **General Procurements Grocerry & Others** | Same as IT Equipments |
| 8 | **General Procurements Electric Appliances** | Same as IT Equipments |
| 9 | **Devices / Accessories** | Employee Requisition → Committee → Finance → CEO → Admin (no Procurement quotations in between) |

## Stage order (global)

`hod` = 1, `hr` = 2, `committee` = 3, `procurement` = 4, `finance` = 5, `ceo` = 6, `admin` = 7.

- **Loan** amount routing is in the app: after HR approval, if total &lt; 50K → Finance; if ≥ 50K → CEO → Finance.
- **Devices / Accessories**: Committee → Finance → CEO → Admin (Procurement stage is skipped in the path).
- **Stationary / Vehicle Maintenance**: after HOD (For Info), next stage is Admin; Admin approves and requisition is completed.

## Creator acknowledgment (close ticket)

After the execution department completes (Admin approved, or Purchase completed, or Finance approved for Loan), the **employee who created the requisition** sees "Pending your acknowledgment" on the Pending page. Clicking **Acknowledge & close ticket** sets `req_creator_acknowledged = 1` and the requisition is considered **Closed**.
