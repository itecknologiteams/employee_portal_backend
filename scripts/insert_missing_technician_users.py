#!/usr/bin/env python3
"""
Insert portal users for technicians who have no entry in the users table.

For each technician:
  - username  = lowercase(first_name), spaces removed
                If that name already exists in the DB or collides within this
                batch, the employee_code is appended (e.g. muhammad10711).
  - password  = full personal_cell_number (digits only, dashes stripped)
  - hashed_password = bcrypt hash of the password above
  - force_password_change = true  (must change on first login)
  - user_type = 'Technician'
  - is_active = true

Employees with no phone number are inserted with NULL hashed_password and a
NOTICE is printed so the admin can set the password manually later.

Usage:
  cd Emp_Portal_BackEnd
  pip install psycopg2-binary bcrypt python-dotenv
  python scripts/insert_missing_technician_users.py

Environment (or .env in project root):
  DB_HOST, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT (default 5432)
"""

import os
import re
import sys

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("Install: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

try:
    import bcrypt
except ImportError:
    print("Install: pip install bcrypt", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


# ── Technicians to insert ─────────────────────────────────────────────────────
# (employee_id, employee_code, first_name, last_name, phone_or_None)
TECHNICIANS = [
    (455, "10695", "Mirza Umair",   "Baig",    "0312-8521071"),
    (449, "10689", "Tanveer",       "Ali",     "0324-8688692"),
    (471, "10711", "Muhammad",      "Shehraz", None),
    (466, "10706", "Muhammad",      "Suleman", "0309-2221364"),
    (478, "10718", "Muhammad Noman","Shahzad", None),
    (458, "10698", "Fahim",         "Ayoob",   "0312-2838808"),
    (492, "10723", "Rehan",         "Gul",     None),
    (456, "10705", "Shakir",        "Ullah",   None),
    ( 51, "10113", "Abdul Noman",   "Rasheed", "0313-3857522"),
    (463, "10702", "Danish",        "Nadeem",  "0335-2221394"),
    (311, "10549", "Abdul",         "Haseeb",  "0309-2221382"),
]
# ─────────────────────────────────────────────────────────────────────────────


def make_username(first_name: str, emp_code: str) -> str:
    """Lowercase first_name (spaces removed) + underscore + employee_code. e.g. muhammad_10711"""
    base = re.sub(r"\s+", "", first_name).lower()
    return f"{base}_{emp_code}"


def phone_digits(phone: str | None) -> str | None:
    """Return last 4 digits of phone number, or None if blank/fewer than 4 digits."""
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone.strip())
    return digits[-4:] if len(digits) >= 4 else None


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")


def main():
    host     = os.environ.get("DB_HOST",     "localhost")
    database = os.environ.get("DB_DATABASE", "employee_portal")
    user     = os.environ.get("DB_USER",     "postgres")
    password = os.environ.get("DB_PASSWORD", "")
    port     = int(os.environ.get("DB_PORT", "5432"))

    conn = psycopg2.connect(
        host=host, database=database, user=user, password=password, port=port
    )
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:

            # ── 1. Fetch all existing usernames from users table ──────────────
            cur.execute("SELECT username FROM users")
            existing_usernames = {r["username"] for r in cur.fetchall()}

            # ── 2. Fetch emp_ids that already have a user row ─────────────────
            cur.execute("SELECT emp_id FROM users")
            existing_emp_ids = {r["emp_id"] for r in cur.fetchall()}

        print(f"Existing usernames in DB : {len(existing_usernames)}")
        print(f"emp_ids already in users : {len(existing_emp_ids)}\n")

        inserted = 0
        skipped  = 0
        no_phone = 0

        # Track usernames chosen in this batch to catch within-batch collisions
        batch_usernames: set[str] = set()

        for (emp_id, emp_code, first_name, last_name, phone) in TECHNICIANS:

            # ── Already has a user row? ───────────────────────────────────────
            if emp_id in existing_emp_ids:
                print(f"  SKIP  emp_id={emp_id} ({first_name} {last_name}): "
                      f"already has a users row — not touching it.")
                skipped += 1
                continue

            # ── Build username ────────────────────────────────────────────────
            username = make_username(first_name, emp_code)

            if username in existing_usernames or username in batch_usernames:
                print(f"  SKIP  emp_id={emp_id} ({first_name} {last_name}): "
                      f"username '{username}' already exists — skipping.")
                skipped += 1
                continue

            # ── Build password ────────────────────────────────────────────────
            digits = phone_digits(phone)
            if digits:
                hashed = hash_password(digits)
                pwd_display = digits          # shown in summary only
            else:
                hashed = None
                pwd_display = "(none — set manually)"
                no_phone += 1

            # ── INSERT ────────────────────────────────────────────────────────
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO users (
                        username,
                        password,
                        hashed_password,
                        user_type,
                        emp_id,
                        force_password_change
                    ) VALUES (
                        %s, %s, %s, 'Technician', %s, true
                    )
                    """,
                    (username, digits or '', hashed, emp_id),
                )

            batch_usernames.add(username)
            existing_usernames.add(username)   # prevent later entries colliding too

            status = "OK   " if digits else "OK*  "
            print(f"  {status} emp_id={emp_id:>4}  username={username:<20}  "
                  f"emp_code={emp_code}  password={pwd_display}")
            inserted += 1

        conn.commit()
        print(f"\n── Done ─────────────────────────────────────────────────────")
        print(f"  Inserted : {inserted}")
        print(f"  Skipped  : {skipped}  (already had a user row)")
        if no_phone:
            print(f"  No phone : {no_phone}  (marked with * — set hashed_password manually)")

    except Exception as e:
        conn.rollback()
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
