# Requisition flows (user specification)

All category flows are defined below. Run the SQL scripts in order so that `requisition_flow_stage` and `requisition_category_stage` match these flows.

## Run order (PostgreSQL)

1. **requisition-categories-table-pg.sql** – Categories and flags.
2. **requisition-flow-db-driven-pg.sql** – Base flow stages, category_stage seed, `req_current_stage_key`.
3. **requisition-hr-and-admin-pg.sql** – HR stage and columns.
4. **requisition-flows-user-spec-pg.sql** – Admin stage, reorder, and category behaviors (first pass).
5. **requisition-flows-final-pg.sql** – Final category behaviors and execution flags per user spec (Vehicle Repair HOD=Approval, Specialized first=Committee, Devices=Procurement execution, etc.).
6. **requisition-creator-acknowledge-pg.sql** – Creator acknowledgment columns.
7. **requisition-move-loan-to-hr-bucket-pg.sql** (one-time) – Move existing Loan reqs to HR bucket if needed.

## Flows (by category)

| Category | Flow |
|----------|------|
| **Stationary** | Employee → HOD (For Info) → Admin (Execution) → Acknowledgment |
| **Vehicle Maintenance** | Same as Stationary |
| **Vehicle Repair** / **Other Repair & Maintenance** | Employee → HOD (Approval) → Committee → Procurement (Quotations) → Finance → CEO → Admin (Execution) → Acknowledgment |
| **Loan & Advance Salary** | &lt;50K: HOD → HR → Finance (Execution) → Acknowledgment. ≥50K: HOD → HR → Finance → CEO → Finance (Execution) → Acknowledgment |
| **Specialized Projects** | Employee → Committee → Procurement (Quotations) → Finance → CEO → Procurement (Execution) → Acknowledgment |
| **IT Equipments** / **General Proc Grocery** / **General Proc Electric** | Same as Specialized Projects |
| **Devices / Accessories** | Employee → Committee → Finance → CEO → Procurement (Execution) → Acknowledgment (no Procurement quotations in path) |

## Stage order (global)

`hod` = 1, `hr` = 2, `committee` = 3, `procurement` = 4, `finance` = 5, `ceo` = 6, `admin` = 7.

- **Loan** amount routing is in the app: after HR approval, if total &lt; 50K → Finance; if ≥ 50K → CEO → Finance.
- **Devices / Accessories**: Committee → Finance → CEO → Procurement (Execution). Procurement stage is skipped in the approval path; after CEO the app sends to Procurement for execution only.
- **Stationary / Vehicle Maintenance**: after HOD (For Info), next stage is Admin; Admin approves and requisition is completed.

## Creator acknowledgment (close ticket)

After the execution department completes (Admin approved, or Purchase completed by Procurement, or Finance approved for Loan), the **employee who created the requisition** sees "Pending your acknowledgment". Acknowledging sets `req_creator_acknowledged = 1` and the requisition is **Closed**.

## Testing

See **REQUISITION-FLOW-TEST.md** for a step-by-step test checklist to verify each flow end-to-end.
