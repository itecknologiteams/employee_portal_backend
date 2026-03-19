#!/usr/bin/env python3
"""
Generate passwords for Technician portal users and update the users table.

Technicians = employees with designation_id = 95 (not by user_type).
For each such employee who has a portal user (users.emp_id), set:
- password = last 4 digits of employee phone
- hashed_password = bcrypt hash (for login verification)
- force_password_change = true (must change on first login)

Usage:
  cd Emp_Portal_BackEnd
  pip install psycopg2-binary bcrypt python-dotenv
  python scripts/generate_technician_passwords.py

Environment (or .env in project root):
  DB_HOST, DB_DATABASE, DB_USER, DB_PASSWORD, DB_PORT (optional, default 5432)
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


def get_last_four_digits(phone):
    """Extract last 4 digits from phone string. Returns None if fewer than 4 digits."""
    if phone is None:
        return None
    digits = re.sub(r"\D", "", str(phone).strip())
    if len(digits) < 4:
        return None
    return digits[-4:]


def main():
    host = os.environ.get("DB_HOST", "localhost")
    database = os.environ.get("DB_DATABASE", "employee_portal")
    user = os.environ.get("DB_USER", "postgres")
    password = os.environ.get("DB_PASSWORD", "")
    port = int(os.environ.get("DB_PORT", "5432"))

    conn = psycopg2.connect(
        host=host,
        database=database,
        user=user,
        password=password,
        port=port,
    )
    conn.autocommit = False

    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT 
                    u.user_id, 
                    u.username, 
                    u.emp_id, 
                    e.personal_cell_number, 
                    e.first_name, 
                    e.last_name,
                    d.desg_name
                FROM users u
                JOIN employees e 
                    ON u.emp_id = e.employee_id
                JOIN designation d 
                    ON e.designation_id = d.desg_id
                WHERE 
                    e.is_active = true
                    AND e.department_id = 2
                    AND d.desg_id NOT IN (14, 57, 60, 62, 87)
                ORDER BY u.username
            """)
            rows = cur.fetchall()

        if not rows:
            print("No portal users found for employees with designation_id = 95 (Technician).")
            conn.rollback()
            return

        updated = 0
        skipped = 0
        for row in rows:
            phone = row["personal_cell_number"]
            last4 = get_last_four_digits(phone)
            if not last4:
                print(f"  SKIP {row['username']} (emp_id={row['emp_id']}): phone missing or < 4 digits: {phone!r}")
                skipped += 1
                continue
            hashed = bcrypt.hashpw(last4.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE users
                    SET password = %s, hashed_password = %s, force_password_change = true
                    WHERE user_id = %s
                    """,
                    (last4, hashed, row["user_id"]),
                )
            print(f"  OK   {row['username']} -> password (last 4 of phone) = {last4}, force_password_change = true")
            updated += 1

        conn.commit()
        print(f"\nDone. Updated {updated} technician(s), skipped {skipped}.")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
