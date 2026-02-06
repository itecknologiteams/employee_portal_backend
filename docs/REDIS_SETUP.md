# Redis Setup Guide

Redis is required for the **Requisition Deadline Emailer** (BullMQ). The server uses Redis to queue and run daily checks for requisitions nearing their required-by date and to send reminder emails.

---

## 1. Install Redis

### Option A: Docker (recommended, works on Windows / macOS / Linux)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) if you don’t have it.
2. Run Redis in a container:

   ```bash
   docker run -d --name redis-employee-portal -p 6379:6379 redis:7-alpine
   ```

3. Check it’s running:

   ```bash
   docker ps
   ```

   You should see `redis-employee-portal` on port 6379.

- **Stop:** `docker stop redis-employee-portal`
- **Start again:** `docker start redis-employee-portal`

---

### Option B: Windows (without Docker)

**Using WSL2 (recommended on Windows):**

1. Install [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install) and a Linux distro (e.g. Ubuntu).
2. Open the distro terminal and run:

   ```bash
   sudo apt update
   sudo apt install redis-server -y
   redis-server
   ```

   Redis will listen on `localhost:6379` from Windows.

**Using native Windows build:**

1. Download Redis for Windows from: [tporadowski/redis](https://github.com/tporadowski/redis/releases) (or use Chocolatey: `choco install redis-64`).
2. Extract and run `redis-server.exe`.
3. Default port is 6379.

---

### Option C: macOS

**Homebrew:**

```bash
brew install redis
brew services start redis
```

Or run once in foreground:

```bash
redis-server
```

---

### Option D: Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install redis-server -y
sudo systemctl start redis-server
sudo systemctl enable redis-server   # start on boot
```

---

## 2. Verify Redis is running

From a terminal:

```bash
# If you have redis-cli installed (comes with Redis):
redis-cli ping
```

Expected response: `PONG`.

Without `redis-cli`, your Node server will show that the emailer started (see step 4).

---

## 3. Configure the Employee Portal server

In the **server** folder, create or edit `.env`:

```env
# Enable requisition emailer (or set REDIS_URL; if set, emailer may start)
ENABLE_REQUISITION_EMAILER=true

# Redis (default if not set: redis://localhost:6379)
REDIS_URL=redis://localhost:6379
```

If Redis is on another machine or port:

```env
REDIS_URL=redis://192.168.20.50:6379
```

If Redis has a password:

```env
REDIS_URL=redis://:yourpassword@localhost:6379
```

---

## 4. Start the server

From the **server** directory:

```bash
npm start
```

If Redis is reachable and the emailer is enabled, you should see:

```text
Requisition deadline emailer (BullMQ) started – runs daily at 9:00
```

If Redis is not available, the server still starts but you’ll see a warning and the emailer won’t run.

---

## 5. Optional: Run Redis in the background (Docker)

To keep Redis running in the background and survive restarts:

```bash
docker run -d --name redis-employee-portal -p 6379:6379 --restart unless-stopped redis:7-alpine
```

---

## Quick reference

| Task              | Command / Action                                      |
|-------------------|--------------------------------------------------------|
| Default URL       | `redis://localhost:6379`                               |
| Test connection   | `redis-cli ping` → `PONG`                             |
| Enable emailer    | `ENABLE_REQUISITION_EMAILER=true` or set `REDIS_URL`   |
| Docker one-liner  | `docker run -d -p 6379:6379 redis:7-alpine`           |

For full emailer behavior (schedule, escalation, SMTP), see `server/jobs/README.md` and configure SMTP in `.env`.
