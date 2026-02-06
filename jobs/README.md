# Requisition Deadline Emailer (BullMQ)

Sends reminder emails when a requisition’s **required-by date** is within 3 days and procurement is not yet completed. Uses **BullMQ** and **Redis** for scheduling and **nodemailer** for SMTP.

## Behaviour

- **Schedule:** Every day at **09:00** (cron: `0 9 * * *`).
- **Scope:** Requisitions that are **not rejected** and **not** “Finance Approved”, with a `req_required_by_date` in the next 0–3 days.
- **Recipients:** Depend on the **current status** of the requisition (where it is in the flow):
  - **Pending HOD** → HOD(s) of the creator’s department  
  - **Pending Committee** → Committee  
  - **Pending CEO** → CEO  
  - **Forwarded to Procurement** / **Acknowledged by Procurement** / **Quotations Added** → Procurement  
  - **Pending Finance Approval** → Finance  

- **Escalation by “days left”:**
  - **3 days left (Level 1):** Email only the people at the current stage.
  - **2 days left (Level 2):** Current stage + Committee (if not already included).
  - **1 day left (Level 3):** Current stage + CEO.
  - **0 days / overdue (Level 4):** Escalate (e.g. CEO + Finance for Finance stage).

## Requirements

1. **Redis**  
   - BullMQ needs a Redis instance (local or remote).  
   - Example: `redis://localhost:6379`.

2. **SMTP**  
   - Configure SMTP in `.env` so the app can send mail (see below).

## Configuration (.env)

```env
# Enable the emailer (or set REDIS_URL; if set, emailer can start)
ENABLE_REQUISITION_EMAILER=true
REDIS_URL=redis://localhost:6379

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-user
SMTP_PASS=your-password
EMAIL_FROM=requisitions@yourcompany.com
APP_NAME=Employee Portal
```

- The emailer starts if **`ENABLE_REQUISITION_EMAILER=true`** or **`REDIS_URL`** is set.
- If Redis is unavailable at startup, the server still starts but the emailer will not run.

## Running Redis locally

- **Windows:** Use WSL, Docker, or a Windows Redis build.  
- **Docker:** `docker run -d -p 6379:6379 redis:7-alpine`  
- **macOS/Linux:** `redis-server` (or install via package manager).

## Flow

1. **Repeatable job** “check-deadlines” runs daily at 09:00.
2. It finds requisitions with `req_required_by_date` within 0–3 days and not yet completed.
3. For each, it enqueues a **“send-reminder”** job with `reqId`, `daysLeft`, and `level`.
4. The worker processes “send-reminder”: resolves recipients from **current status + level**, then sends one email per requisition (to all recipients for that level).

Duplicate reminders for the same requisition/level/day are avoided by using a stable job id: `reminder-{reqId}-{level}-{date}`.
