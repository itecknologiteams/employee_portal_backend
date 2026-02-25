# PostgreSQL: "no pg_hba.conf entry for host" fix

When you see:

```text
no pg_hba.conf entry for host "192.168.20.61", user "employee_dev", database "employee_portal", no encryption
```

the **PostgreSQL server** (e.g. on `192.168.21.31`) is rejecting the connection because its `pg_hba.conf` does not allow your client host/user/database (or requires SSL and the client is connecting without it).

## Fix on the PostgreSQL server

You must edit `pg_hba.conf` **on the machine where PostgreSQL is running** (e.g. `192.168.21.31`), then reload PostgreSQL.

1. **Find `pg_hba.conf`**  
   Common paths:
   - Linux: `/etc/postgresql/<version>/main/pg_hba.conf`
   - Or inside the data directory shown by `show data_directory;` in `psql`.

2. **Add a line** that allows your **backend server IP** (`192.168.20.61`), user `employee_dev`, and database `employee_portal`.

   For **password auth without SSL** (md5/scram-sha-256):

   ```text
   host    employee_portal    employee_dev    192.168.20.61/32    scram-sha-256
   ```

   To allow the whole subnet:

   ```text
   host    employee_portal    employee_dev    192.168.0.0/16    scram-sha-256
   ```

   (Use `md5` if your server does not support `scram-sha-256`.)

3. **Reload PostgreSQL** so the change is applied:

   ```bash
   sudo systemctl reload postgresql
   # or
   pg_ctl reload -D /path/to/data
   ```

## If the server only allows SSL connections

If `pg_hba.conf` has only `hostssl` (SSL) lines and no `host` line for your client:

- Either add a `host` line as above, **or**
- Use SSL from the backend by setting in your backend `.env`:

  ```env
  DB_SSL=true
  ```

  Optional (e.g. self-signed cert):

  ```env
  DB_SSL_VERIFY=false
  ```

Then restart the Node backend so it connects with SSL.

## Summary

| Problem                         | Where to fix              | Action |
|--------------------------------|---------------------------|--------|
| Host not allowed               | PostgreSQL server `pg_hba.conf` | Add `host ... 192.168.20.61/32 ...` (or subnet) and reload. |
| Server requires SSL           | Backend `.env`            | Set `DB_SSL=true` and restart backend. |
