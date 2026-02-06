# Employee Portal Backend

Backend API for the Employee Management System. Node.js/Express server providing authentication, profile, leave, salary, feedback, requisitions (with approval flow), extensions, and administration.

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **Framework:** Express
- **Database:** PostgreSQL (default) or SQL Server (`DB_DRIVER`)
- **Auth:** bcryptjs, JWT-style session handling
- **Optional:** Redis (BullMQ), RabbitMQ, Nodemailer (SMTP), Multer (uploads)

Key dependencies: `express`, `pg`, `mssql`, `bcryptjs`, `cors`, `dotenv`, `body-parser`, `multer`, `nodemailer`, `bullmq`, `ioredis`, `amqplib`.

## Features

- **Auth** – Login, register, change password (username or email)
- **Dashboard** – Dashboard data and metrics
- **Profile** – Employee profile and updates
- **Salary** – Salary slips and related data
- **Leave** – Leave balance and leave requests
- **Feedback** – Feedback submissions
- **Requisitions** – Create and approve requisitions (HOD → Committee → CEO → Procurement)
- **Extensions** – Extension endpoints
- **Administration** – Admin and user management

## API Overview

Base URL: `/api`

| Route               | Description                |
|---------------------|----------------------------|
| `/api/auth`         | Login, register, change password |
| `/api/dashboard`    | Dashboard                  |
| `/api/profile`      | Profile                    |
| `/api/salary`       | Salary                     |
| `/api/leave`        | Leave                      |
| `/api/feedback`     | Feedback                   |
| `/api/requisition`  | Requisitions               |
| `/api/extensions`   | Extensions                 |
| `/api/administration` | Administration          |

Utility endpoints:

- `GET /api/health` – Server health check
- `GET /api/test-db` – Database connection test

For requisition track-records and pagination, see [docs/TRACK_RECORDS_API.md](docs/TRACK_RECORDS_API.md).

## Prerequisites

- **Node.js** 18+ (or any version that supports ES modules)
- **Database:** PostgreSQL or SQL Server
- **Optional:** Redis (for requisition deadline emailer), RabbitMQ (for requisition consumer)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd "Employee portal backend latest"
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   Create a `.env` file in the project root with your settings. Required variables:

   | Variable       | Description                    | Example / default     |
   |----------------|--------------------------------|------------------------|
   | `PORT`         | Server port                    | `3001`                 |
   | `DB_DRIVER`    | `postgres` or `sqlserver`      | `postgres` (default)   |
   | `DB_HOST`      | Database host                  | `localhost` / `192.168.20.21` |
   | `DB_DATABASE`  | Database name                  | `employee_portal`      |
   | `DB_USER`      | Database user                  | `postgres`             |
   | `DB_PASSWORD`  | Database password              | (your password)        |
   | `DB_PORT`      | Database port                  | `5432` (PostgreSQL) / `1433` (SQL Server) |
   | `FRONTEND_PORT`| Frontend port (for CORS)       | `5173`                 |

   Optional (requisition emailer / Redis):

   - `REDIS_URL` – e.g. `redis://localhost:6379`
   - `ENABLE_REQUISITION_EMAILER` – `true` to enable
   - SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `APP_NAME`

   For connection details and troubleshooting, see [CONNECTION_GUIDE.md](CONNECTION_GUIDE.md).

4. **Database setup**
   - **PostgreSQL:** Create database `employee_portal`, then run the full schema once:
     ```bash
     npm run db:schema
     ```
     Or manually: `psql -U postgres -d employee_portal -f database/postgresql-full-schema.sql`
   - **SQL Server:** Use `DB_DRIVER=sqlserver` and run the appropriate schema (e.g. `database/iteck_erp-schema.sql`).

   **If you see "relation employees does not exist"** or tables keep disappearing: the backend does not run migrations on startup. Tables only exist after you run the schema. Run `npm run db:schema` again to recreate all tables. See [database/README.md](database/README.md) for details.

   Full steps and table descriptions: [database/README.md](database/README.md).

5. **Start the server**
   ```bash
   npm start
   ```
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

   Server runs at `http://localhost:3001` (or your `PORT`). Use `GET /api/health` and `GET /api/test-db` to verify.

## Optional: Redis and Requisition Emailer

The app can run a daily job (BullMQ) that sends reminder emails for requisitions nearing their required-by date. This requires Redis and SMTP configuration.

- **Redis setup:** [docs/REDIS_SETUP.md](docs/REDIS_SETUP.md)
- **Emailer behaviour and config:** [jobs/README.md](jobs/README.md)

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start the server |
| `npm run dev` | Start with watch mode (auto-reload) |
| `npm run db:schema` | Create/recreate all PostgreSQL tables (run when tables are missing) |
| `npm run create-employee` | Create a test employee |
| `npm run insert-user` | Insert user (script) |
| `npm run insert-admin` | Insert admin user |
| `npm run check-user` | Check user (script) |
| `npm run update-password` | Update user password |
| `npm run consumer:requisition` | Run requisition consumer (RabbitMQ) |

## Documentation

- [CONNECTION_GUIDE.md](CONNECTION_GUIDE.md) – Database connection and troubleshooting
- [database/README.md](database/README.md) – Database setup, schema, requisition flow
- [docs/REDIS_SETUP.md](docs/REDIS_SETUP.md) – Redis setup for BullMQ
- [docs/TRACK_RECORDS_API.md](docs/TRACK_RECORDS_API.md) – Requisition track-records API
- [jobs/README.md](jobs/README.md) – Requisition deadline emailer (BullMQ)

## License

All rights reserved.
