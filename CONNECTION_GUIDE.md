# Database Connection Guide

## Connection Details

The application is configured to connect to your existing SQL Server database:

- **Server**: 192.168.20.166
- **Database**: ATS_HRMS
- **Username**: tech
- **Password**: tech
- **Port**: 1433

## Configuration Files

### Environment Variables (`server/.env`)

The connection details are stored in `server/.env`:

```env
DB_SERVER=192.168.20.166
DB_DATABASE=ATS_HRMS
DB_USER=tech
DB_PASSWORD=tech
DB_PORT=1433
PORT=4000
```

## Testing the Connection

### 1. Start the Server

```bash
cd server
npm install
npm start
```

### 2. Test Database Connection

Once the server is running, you can test the connection by:

**Option A: Check Server Logs**
When you start the server, you should see:
```
✅ Connected to SQL Server database: ATS_HRMS
   Server: 192.168.20.166:1433
   User: tech
```

**Option B: Use the Test Endpoint**
Open your browser or use curl:
```
http://localhost:4000/api/test-db
```

This will return connection status and database information.

**Option C: Check Health Endpoint**
```
http://localhost:4000/api/health
```

## Troubleshooting

### Connection Refused
- Verify SQL Server is running and accessible
- Check firewall settings on port 1433
- Verify the server IP address is correct

### Authentication Failed
- Verify username and password are correct
- Check if SQL Server authentication is enabled (not just Windows Auth)
- Verify the user has access to the ATS_HRMS database

### Database Not Found
- Verify the database name is exactly `ATS_HRMS`
- Check if the database exists on the server
- Verify the user has permissions to access the database

### Network Issues
- Ping the server: `ping 192.168.20.166`
- Test port connectivity: `telnet 192.168.20.166 1433`
- Check if you're on the same network

## Expected Table Structure

The application expects these tables to exist (they may have different column names):

- **Employees** - Employee information
- **Departments** - Department information  
- **SalarySlips** - Salary records
- **LeaveRequests** - Leave requests
- **LeaveBalance** - Leave balances
- **Feedback** - Feedback submissions
- **Requisitions** - Requisition requests

The API routes will work with your existing table structure. If column names differ, you may need to adjust the SQL queries in the route files.

## Connection Pool Settings

The connection uses a pool with these settings:
- Max connections: 10
- Min connections: 0
- Idle timeout: 30 seconds
- Connection timeout: 30 seconds
- Request timeout: 30 seconds

These can be adjusted in `server/config/database.js` if needed.