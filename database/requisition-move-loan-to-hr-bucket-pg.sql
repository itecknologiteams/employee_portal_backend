-- One-time: Move existing "Loan & Advance Salary" requisitions to HR bucket
-- Run after requisition-hr-and-admin-pg.sql (so req_current_stage_key and req_hr_approval exist)
-- psql will show "UPDATE n" = number of requisitions moved to HR.

-- Category: match "Loan & Advance Salary" or "Loan and Advance Salary" (flexible)
-- Move: not rejected, not yet HR-approved, and either at committee or stage NULL with HOD done / Committee not done
UPDATE requisition
SET req_current_stage_key = 'hr'
WHERE LOWER(TRIM(COALESCE(req_category, ''))) LIKE '%loan%advance%salary%'
  AND COALESCE(req_is_rejected, 0) = 0
  AND (req_hr_approval IS NULL OR req_hr_approval = 0)
  AND (
    req_current_stage_key = 'committee'
    OR (req_current_stage_key IS NULL AND COALESCE(req_hod_approval, 0) = 1 AND (COALESCE(req_committee_approval, 0) = 0))
  );

SELECT 'Loan & Advance Salary requisitions moved to HR bucket. Check UPDATE count above.' AS message;
