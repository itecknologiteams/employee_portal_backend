"""
Migration script: Sync employee dates from ATS_HRMS (SQL Server) to PostgreSQL.
Fetches: Date of Birth, CNIC Issue Date, CNIC Expiry Date, Joining Date

Run from project root:
    python database/migrations/sync_employee_dates_from_hrms.py

Or from migrations folder:
    python sync_employee_dates_from_hrms.py

SQL Server: 192.168.20.166 | ATS_HRMS | HR_Employees
PostgreSQL: uses .env config
"""

import os
import sys
import traceback
from datetime import datetime, date

# ── .env loading (always find project root .env) ────────────────────────────
THIS_DIR   = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR   = os.path.abspath(os.path.join(THIS_DIR, '..', '..'))
ENV_PATH   = os.path.join(ROOT_DIR, '.env')

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_PATH)
    print(f"📄 Loaded .env from: {ENV_PATH}")
except ImportError:
    os.system(f"{sys.executable} -m pip install -q python-dotenv")
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=ENV_PATH)

# ── Library imports ──────────────────────────────────────────────────────────
try:
    import pyodbc
except ImportError:
    print("📦 Installing pyodbc...")
    os.system(f"{sys.executable} -m pip install -q pyodbc")
    import pyodbc

try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("📦 Installing psycopg2-binary...")
    os.system(f"{sys.executable} -m pip install -q psycopg2-binary")
    import psycopg2
    from psycopg2.extras import RealDictCursor


# ── Helper ───────────────────────────────────────────────────────────────────
def to_date_str(val):
    """
    Convert any date/datetime/string value to 'yyyy-MM-dd' string.
    Returns None if invalid or empty.
    """
    if val is None:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime('%Y-%m-%d')
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return None
        for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y'):
            try:
                return datetime.strptime(val[:10], fmt[:10]).strftime('%Y-%m-%d')
            except ValueError:
                continue
        print(f"   ⚠️  Could not parse date string: '{val}'")
        return None
    return None


def strip_env(key, default=''):
    """Read env var, strip surrounding quotes."""
    v = os.getenv(key, default) or default
    return v.strip().strip('"').strip("'")


# ── Connections ──────────────────────────────────────────────────────────────
def get_sql_server_connection():
    """Connect to ATS_HRMS SQL Server."""
    host     = strip_env('HRMS_HOST', '192.168.20.166')
    user     = strip_env('HRMS_USER', 'tech')
    password = strip_env('HRMS_PASS', 'tech')
    database = strip_env('HRMS_DB',   'ATS_HRMS')
    port     = strip_env('HRMS_PORT', '1433')

    drivers_to_try = [
        'ODBC Driver 17 for SQL Server',
        'ODBC Driver 18 for SQL Server',
        'SQL Server Native Client 11.0',
        'SQL Server',
    ]

    last_error = None
    for driver in drivers_to_try:
        conn_str = (
            f"DRIVER={{{driver}}};"
            f"SERVER={host},{port};"
            f"DATABASE={database};"
            f"UID={user};PWD={password};"
            f"TrustServerCertificate=yes;"
            f"Connection Timeout=30;"
        )
        try:
            conn = pyodbc.connect(conn_str, timeout=30)
            print(f"✅ SQL Server connected ({driver}): {host}/{database}")
            return conn
        except pyodbc.Error as e:
            last_error = e
            continue

    print(f"❌ All ODBC drivers failed. Last error: {last_error}")
    print("   Tip: Install 'ODBC Driver 17 for SQL Server' from Microsoft.")
    raise last_error


def get_postgres_connection():
    """Connect to PostgreSQL using .env config."""
    host     = strip_env('DB_HOST',     'localhost')
    database = strip_env('DB_DATABASE', 'employee_portal')
    user     = strip_env('DB_USER',     'postgres')
    password = strip_env('DB_PASSWORD', '')
    port     = int(strip_env('DB_PORT', '5432'))

    conn = psycopg2.connect(
        host=host, database=database,
        user=user, password=password, port=port,
        connect_timeout=30
    )
    print(f"✅ PostgreSQL connected: {host}:{port}/{database}")
    return conn


# ── Data fetching ─────────────────────────────────────────────────────────────
def fetch_hr_employees(sql_conn):
    """
    Fetch employee dates from HR_Employees.
    Returns list of dicts with keys:
        HR_Emp_ID, Emp_Name, DOB, CNIC_Issue, CNIC_Expiry, Joining
    """
    cursor = sql_conn.cursor()

    # First, discover actual column names to avoid guessing
    print("\n🔍 Discovering HR_Employees columns...")
    cursor.execute("SELECT TOP 1 * FROM HR_Employees")
    all_cols = [col[0] for col in cursor.description]
    print(f"   Columns: {all_cols}\n")
    cursor.fetchall()  # consume

    # Build column map for the fields we need
    def find_col(candidates, all_cols):
        """Find the first matching column name (case-insensitive)."""
        lower_cols = {c.lower(): c for c in all_cols}
        for c in candidates:
            if c.lower() in lower_cols:
                return lower_cols[c.lower()]
        return None

    col_emp_id  = find_col(['HR_Emp_ID', 'Emp_ID', 'EmpID', 'Employee_ID'], all_cols)
    col_name    = find_col(['Emp_Name', 'EmpName', 'Employee_Name', 'Name', 'Full_Name'], all_cols)
    col_dob     = find_col(['DateOfBirth', 'DOB', 'Date_Of_Birth', 'BirthDate', 'Birth_Date', 'Emp_DOB'], all_cols)
    col_cnic_i  = find_col(['CNIC_Issue_Date', 'CNICIssueDate', 'CNIC_Issue', 'CnicIssueDate'], all_cols)
    col_cnic_e  = find_col(['CNIC_Exp_Date', 'CNIC_Expiry_Date', 'CNICExpDate', 'CNIC_Expiry', 'CnicExpDate', 'CNIC_Exp'], all_cols)
    col_joining = find_col(['Joining_Date', 'JoiningDate', 'Join_Date', 'DateOfJoining', 'DOJ'], all_cols)

    print(f"   Mapped columns:")
    print(f"     Emp ID   : {col_emp_id}")
    print(f"     Name     : {col_name}")
    print(f"     DOB      : {col_dob}")
    print(f"     CNIC Iss : {col_cnic_i}")
    print(f"     CNIC Exp : {col_cnic_e}")
    print(f"     Joining  : {col_joining}")
    print()

    if not col_emp_id:
        raise ValueError("Could not find HR_Emp_ID column in HR_Employees table!")

    # Build SELECT with only found columns
    select_parts = [f"[{col_emp_id}]"]
    if col_name:    select_parts.append(f"[{col_name}]")
    if col_dob:     select_parts.append(f"[{col_dob}]")
    if col_cnic_i:  select_parts.append(f"[{col_cnic_i}]")
    if col_cnic_e:  select_parts.append(f"[{col_cnic_e}]")
    if col_joining: select_parts.append(f"[{col_joining}]")

    query = f"""
        SELECT {', '.join(select_parts)}
        FROM HR_Employees
        WHERE [{col_emp_id}] IS NOT NULL
          AND LTRIM(RTRIM(CAST([{col_emp_id}] AS VARCHAR(50)))) != ''
    """

    cursor.execute(query)
    raw_cols = [c[0] for c in cursor.description]
    rows = cursor.fetchall()
    cursor.close()

    employees = []
    for row in rows:
        raw = dict(zip(raw_cols, row))
        emp = {
            'HR_Emp_ID': str(raw.get(col_emp_id, '') or '').strip(),
            'Emp_Name':  str(raw.get(col_name, '') or '').strip() if col_name else '',
            'DOB':       to_date_str(raw.get(col_dob))      if col_dob     else None,
            'CNIC_Issue':  to_date_str(raw.get(col_cnic_i)) if col_cnic_i  else None,
            'CNIC_Expiry': to_date_str(raw.get(col_cnic_e)) if col_cnic_e  else None,
            'Joining':   to_date_str(raw.get(col_joining))  if col_joining else None,
        }
        employees.append(emp)

    return employees


def fetch_portal_employees(pg_conn):
    """
    Fetch portal employees from PostgreSQL.
    Returns dict: employee_code → {employee_id, date_of_birth, cnic_issue_date, cnic_expiry_date, join_date}
    """
    cursor = pg_conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute("""
        SELECT employee_id, employee_code,
               first_name, last_name,
               date_of_birth, cnic_issue_date,
               cnic_expiry_date, join_date
        FROM employees
        WHERE employee_code IS NOT NULL
          AND TRIM(employee_code) != ''
    """)
    rows = cursor.fetchall()
    cursor.close()

    result = {}
    for row in rows:
        code = str(row['employee_code']).strip()
        result[code] = {
            'employee_id':     row['employee_id'],
            'first_name':      row['first_name'],
            'last_name':       row['last_name'],
            'date_of_birth':   to_date_str(row['date_of_birth']),
            'cnic_issue_date': to_date_str(row['cnic_issue_date']),
            'cnic_expiry_date':to_date_str(row['cnic_expiry_date']),
            'join_date':       to_date_str(row['join_date']),
        }
    return result


# ── Update ────────────────────────────────────────────────────────────────────
def update_employee_dates(pg_conn, employee_id, new_dates):
    """
    Update employee dates in PostgreSQL.
    new_dates keys: dob, cnic_issue, cnic_expiry, joining
    Only updates fields where HR has a non-None value (overrides portal value).
    """
    set_clauses = []
    params = []

    if new_dates['dob'] is not None:
        set_clauses.append("date_of_birth = %s")
        params.append(new_dates['dob'])

    if new_dates['cnic_issue'] is not None:
        set_clauses.append("cnic_issue_date = %s")
        params.append(new_dates['cnic_issue'])

    if new_dates['cnic_expiry'] is not None:
        set_clauses.append("cnic_expiry_date = %s")
        params.append(new_dates['cnic_expiry'])

    if new_dates['joining'] is not None:
        set_clauses.append("join_date = %s")
        params.append(new_dates['joining'])

    if not set_clauses:
        return  # nothing to update

    params.append(employee_id)
    cursor = pg_conn.cursor()
    cursor.execute(
        f"UPDATE employees SET {', '.join(set_clauses)} WHERE employee_id = %s",
        params
    )
    cursor.close()


# ── Main sync ─────────────────────────────────────────────────────────────────
def sync_employee_dates():
    print("=" * 60)
    print("🔄 Employee Dates Sync: ATS_HRMS → PostgreSQL")
    print("=" * 60)
    print()

    sql_conn = None
    pg_conn  = None

    try:
        sql_conn = get_sql_server_connection()
        pg_conn  = get_postgres_connection()

        # Fetch HR employees
        print("\n📥 Fetching from HR_Employees (SQL Server)...")
        hr_employees = fetch_hr_employees(sql_conn)
        print(f"   Found {len(hr_employees)} records in HR_Employees")

        if not hr_employees:
            print("⚠️  No employees found.")
            return

        # Fetch portal employees
        print("\n📥 Fetching from employees (PostgreSQL)...")
        portal_employees = fetch_portal_employees(pg_conn)
        print(f"   Found {len(portal_employees)} records in portal")

        # ── Sync loop ──────────────────────────────────────────────
        updated = skipped = not_found = errors = 0
        updates_log = []

        print("\n🔄 Syncing...\n")

        for hr in hr_employees:
            emp_code = hr['HR_Emp_ID']
            emp_name = hr['Emp_Name']

            if not emp_code:
                continue

            portal = portal_employees.get(emp_code)
            if not portal:
                not_found += 1
                continue

            # Build new dates (from HR)
            new_dates = {
                'dob':        hr['DOB'],
                'cnic_issue': hr['CNIC_Issue'],
                'cnic_expiry':hr['CNIC_Expiry'],
                'joining':    hr['Joining'],
            }

            # Compare with portal dates
            field_map = [
                ('DOB',         new_dates['dob'],        portal['date_of_birth']),
                ('CNIC Issue',  new_dates['cnic_issue'],  portal['cnic_issue_date']),
                ('CNIC Expiry', new_dates['cnic_expiry'], portal['cnic_expiry_date']),
                ('Joining',     new_dates['joining'],     portal['join_date']),
            ]

            changes = []
            needs_update = False

            for label, hr_val, portal_val in field_map:
                if hr_val is None:
                    continue  # no HR data for this field, skip
                if hr_val != portal_val:
                    needs_update = True
                    changes.append(f"{label}: '{portal_val}' → '{hr_val}'")

            if not needs_update:
                skipped += 1
                continue

            try:
                update_employee_dates(pg_conn, portal['employee_id'], new_dates)
                pg_conn.commit()

                print(f"   ✅ {emp_code} - {emp_name}")
                for change in changes:
                    print(f"      📅 {change}")

                updates_log.append({'code': emp_code, 'name': emp_name, 'changes': changes})
                updated += 1

            except Exception as e:
                pg_conn.rollback()
                print(f"   ❌ Error updating {emp_code}: {e}")
                errors += 1

        # ── Summary ────────────────────────────────────────────────
        print()
        print("=" * 60)
        print("📊 SYNC SUMMARY")
        print("=" * 60)
        print(f"   ✅ Updated  : {updated}")
        print(f"   ⏭️  Skipped  : {skipped}  (already correct)")
        print(f"   🔍 Not found: {not_found} (not in portal)")
        print(f"   ❌ Errors   : {errors}")
        print("=" * 60)

        # ── Save log ───────────────────────────────────────────────
        if updates_log:
            log_file = os.path.join(THIS_DIR, f"sync_log_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt")
            with open(log_file, 'w', encoding='utf-8') as f:
                f.write("Employee Dates Sync Log\n")
                f.write(f"Timestamp: {datetime.now()}\n")
                f.write("=" * 60 + "\n\n")
                for entry in updates_log:
                    f.write(f"{entry['code']} - {entry['name']}\n")
                    for c in entry['changes']:
                        f.write(f"  {c}\n")
                    f.write("\n")
            print(f"\n📝 Log saved: {log_file}")

    except Exception:
        traceback.print_exc()
        sys.exit(1)

    finally:
        if sql_conn:
            sql_conn.close()
            print("\n🔌 SQL Server connection closed")
        if pg_conn:
            pg_conn.close()
            print("🔌 PostgreSQL connection closed")


if __name__ == '__main__':
    sync_employee_dates()
