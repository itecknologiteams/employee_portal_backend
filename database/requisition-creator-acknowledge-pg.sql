-- Creator acknowledgment: after execution department, the employee who created the requisition can acknowledge to close the ticket.
-- Run after other requisition flow scripts.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_creator_acknowledged') THEN
    ALTER TABLE requisition ADD COLUMN req_creator_acknowledged SMALLINT DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'requisition' AND column_name = 'req_creator_acknowledged_date') THEN
    ALTER TABLE requisition ADD COLUMN req_creator_acknowledged_date TIMESTAMP NULL;
  END IF;
END $$;

SELECT 'Creator acknowledgment columns (req_creator_acknowledged, req_creator_acknowledged_date) added.' AS message;
