-- Run this to see why UPDATE 0: inspect actual req_category and stage columns for Loan-like reqs
-- Usage: psql ... -f database/requisition-diagnose-loan-category.sql

-- 1) All distinct req_category values that contain 'loan'
SELECT DISTINCT req_category, LENGTH(req_category) AS len, LOWER(TRIM(COALESCE(req_category, ''))) AS normalized
FROM requisition
WHERE req_category IS NOT NULL AND LOWER(req_category) LIKE '%loan%'
ORDER BY 1;

-- 2) Loan-related reqs: key columns (see what would need to match for move)
SELECT req_id, req_reference_no,
  req_category,
  req_current_stage_key,
  req_hod_approval,
  req_committee_approval,
  req_hr_approval,
  req_is_rejected
FROM requisition
WHERE req_category IS NOT NULL AND LOWER(req_category) LIKE '%loan%'
  AND COALESCE(req_is_rejected, 0) = 0
ORDER BY req_id DESC
LIMIT 20;
