-- ============================================================================
-- One-time correction: zero annual leave for employees with < 1 year of service
-- ============================================================================
-- Business rule: annual leave is EARNED only after completing one full year of
-- service. A new hire has no annual entitlement until their 1-year anniversary,
-- at which point the yearly allocation job (runAnnualAllocation) grants the
-- prorated amount. See src/utils/annualLeave.js and
-- src/repositories/leave.repository.js (calculateProratedAnnualLeave).
--
-- Earlier logic seeded a positive prorated annual balance immediately on joining,
-- so employees hired within the last year may have a stale non-zero annual_leave
-- stored on their balance row. This script resets those to 0 so the stored value
-- matches what the portal now displays (and so leave deductions behave correctly).
--
-- Employees who joined exactly 1 year ago (or earlier) are NOT affected.
-- Casual/Sick/marriage/maternity/etc. are intentionally left untouched.
--
-- PostgreSQL. Safe to re-run (idempotent).
-- ============================================================================

-- Preview the rows that will change (run this first if you want to inspect):
-- SELECT e.employee_code, e.join_date, lb.annual_leave
-- FROM leave_balance lb
-- JOIN employees e ON e.employee_id = lb.employee_id
-- WHERE e.join_date IS NOT NULL
--   AND e.join_date > (CURRENT_DATE - INTERVAL '1 year')
--   AND lb.annual_leave <> 0
-- ORDER BY e.join_date DESC;

UPDATE leave_balance lb
SET annual_leave = 0,
    updated_at = CURRENT_TIMESTAMP
FROM employees e
WHERE lb.employee_id = e.employee_id
  AND e.join_date IS NOT NULL
  AND e.join_date > (CURRENT_DATE - INTERVAL '1 year')  -- joined within the last year => < 1 year of service
  AND lb.annual_leave <> 0;
