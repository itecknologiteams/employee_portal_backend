#!/usr/bin/env python3
"""
Fetch salary slips (Pay Sheet) from SQL Server and output as JSON with column names.

Uses HR payroll tables when --with-pay-month is set:
  HR_PAYROLL_PERIOD (Payroll_ID -> MNTH_ID, FYID)
  HR_PAYROLL_MONTH  (MNTH_ID -> MNTH_NO 1-12)
  HR_FinYearMstr    (FYID -> FinYear e.g. 2024-2025)
  Pay_Month = first day of month from FinYear start + MNTH_NO.

Usage:
  python scripts/fetch_salary_slips_from_sqlserver.py --output slips.json
  python scripts/fetch_salary_slips_from_sqlserver.py --output slips.json --with-pay-month

Requires: pip install pyodbc python-dotenv

Environment (or .env):
  MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD
  MSSQL_TABLE     - (optional) Pay Sheet table, default: HR_Monthly_Pay_Sheet
  MSSQL_DRIVER    - (optional) ODBC driver, default: ODBC Driver 17 for SQL Server
"""

import argparse
import json
import os
import sys
from decimal import Decimal
from datetime import date, datetime

try:
    import pyodbc
except ImportError:
    print("Install pyodbc: pip install pyodbc", file=sys.stderr)
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def get_connection():
    server = os.environ.get("MSSQL_SERVER", "192.168.20.166")
    database = os.environ.get("MSSQL_DATABASE", "ATS_HRMS")
    user = os.environ.get("MSSQL_USER", "tech")
    password = os.environ.get("MSSQL_PASSWORD", "tech")
    driver = os.environ.get("MSSQL_DRIVER", "ODBC Driver 17 for SQL Server")
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"SERVER={server};"
        f"DATABASE={database};"
        f"UID={user};"
        f"PWD={password};"
    )
    return pyodbc.connect(conn_str)


def serialize_value(val):
    if val is None:
        return None
    if isinstance(val, (date, datetime)):
        return val.isoformat()[:10] if isinstance(val, date) else val.isoformat()
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (bytes, bytearray)):
        return val.hex()
    return val


def row_to_dict(cursor, row):
    return {
        cursor.description[i][0]: serialize_value(row[i])
        for i in range(len(row))
    }


def main():
    parser = argparse.ArgumentParser(description="Fetch salary slips from SQL Server to JSON")
    parser.add_argument(
        "--output", "-o",
        default=None,
        help="Output JSON file path (default: stdout)",
    )
    parser.add_argument(
        "--table",
        default=os.environ.get("MSSQL_TABLE", "HR_Monthly_Pay_Sheet"),
        help="Table name (default: HR_Monthly_Pay_Sheet or env MSSQL_TABLE)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max rows to fetch (default: all)",
    )
    parser.add_argument(
        "--with-pay-month",
        action="store_true",
        help="Join HR_PAYROLL_PERIOD, HR_PAYROLL_MONTH, HR_FinYearMstr to add Pay_Month (YYYY-MM-01)",
    )
    args = parser.parse_args()

    print("Connecting to SQL Server...", file=sys.stderr)
    conn = get_connection()
    cursor = conn.cursor()

    top = f"TOP {args.limit} " if args.limit else ""

    if args.with_pay_month:
        # Join HR payroll tables: Period -> Month -> FinYear; Pay_Month = first day of that month
        # FinYear is e.g. '2024-2025'; MNTH_NO is 1-12 (Jan-Dec)
        query = f"""
        SELECT {top}s.*,
               DATEFROMPARTS(CAST(LEFT(f.FinYear, 4) AS int), m.MNTH_NO, 1) AS Pay_Month
        FROM [{args.table}] s
        LEFT JOIN [HR_PAYROLL_PERIOD] p ON p.Payroll_ID = s.Payroll_ID
        LEFT JOIN [HR_PAYROLL_MONTH] m ON m.MNTH_ID = p.MNTH_ID
        LEFT JOIN [HR_FinYearMstr] f ON f.FYID = p.FYID
        ORDER BY s.Payroll_ID, s.HR_Emp_ID
        """
    else:
        query = f"SELECT {top}* FROM [{args.table}] ORDER BY Payroll_ID, HR_Emp_ID"

    print(f"Running query on [{args.table}]...", file=sys.stderr)
    cursor.execute(query)
    columns = [d[0] for d in cursor.description]
    rows = []
    count = 0
    for row in cursor:
        rows.append(row_to_dict(cursor, row))
        count += 1
    cursor.close()
    conn.close()

    print(f"Fetched {len(rows)} rows.", file=sys.stderr)

    out = json.dumps(rows, indent=2, default=str)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"Written to {args.output}", file=sys.stderr)
    else:
        print(out)


if __name__ == "__main__":
    main()
