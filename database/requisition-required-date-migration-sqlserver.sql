-- SQL Server (iteck_erp): Replace req_priority with req_required_by_date
-- Run against iteck_erp in SSMS or sqlcmd

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.requisition') AND name = 'req_required_by_date')
BEGIN
    ALTER TABLE dbo.requisition ADD req_required_by_date DATE NULL;
END
GO
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.requisition') AND name = 'req_priority')
BEGIN
    ALTER TABLE dbo.requisition DROP COLUMN req_priority;
END
GO
