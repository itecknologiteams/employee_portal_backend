-- Manager of Finance stage removed from the Loan & Advance Salary flow.
-- New flow: Employee > HOD > HR > CEO > Finance > HR Cheque Receiving (hr_check) > Employee Acknowledgment.
-- Move any requisitions currently sitting at manager_finance straight to hr_check,
-- which is now the stage immediately after Finance approval.
UPDATE requisition
   SET req_current_stage_key = 'hr_check'
 WHERE req_current_stage_key = 'manager_finance'
   AND COALESCE(req_is_rejected, 0) = 0;

SELECT 'manager_finance requisitions moved to hr_check.' AS message;
