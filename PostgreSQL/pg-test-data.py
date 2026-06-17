#!/usr/bin/env python3
"""
PostgreSQL Test Data Script
- Creates table "001-Test" in appdb
- Inserts sample rows via sapwriter (INSERT/UPDATE only)
- Verifies data via airead (SELECT only)
- Confirms sapwriter is blocked from DELETE

Usage:
    python pg-test-data.py
    python pg-test-data.py --host 10.86.180.71 --postgres-pass MyPass123

Requirements:
    pip install psycopg2-binary
"""

import argparse
import getpass
import sys

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[FAIL] psycopg2 not installed.")
    print("       Run: pip install psycopg2-binary")
    sys.exit(1)

# ── ANSI colors ───────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RED    = "\033[91m"
RESET  = "\033[0m"

def ok(msg):   print(f"{GREEN}[OK]   {msg}{RESET}")
def warn(msg): print(f"{YELLOW}[WARN] {msg}{RESET}")
def info(msg): print(f"{CYAN}[INFO] {msg}{RESET}")
def fail(msg): print(f"{RED}[FAIL] {msg}{RESET}"); sys.exit(1)
def step(msg):
    print(f"\n{CYAN}======================================{RESET}")
    print(f"{CYAN}  {msg}{RESET}")
    print(f"{CYAN}======================================{RESET}")


def get_conn(host, port, dbname, user, password):
    return psycopg2.connect(
        host=host, port=port, dbname=dbname,
        user=user, password=password,
        connect_timeout=10
    )


def main():
    parser = argparse.ArgumentParser(description="PostgreSQL Test Data Script")
    parser.add_argument("--host",           default="10.86.180.71")
    parser.add_argument("--port",           default=5432, type=int)
    parser.add_argument("--database",       default="appdb")
    parser.add_argument("--postgres-pass",  default="")
    parser.add_argument("--sapwriter-pass", default="SapWrite@2025")
    parser.add_argument("--airead-pass",    default="AiRead@2025")
    args = parser.parse_args()

    print()
    print(f"{CYAN}============================================={RESET}")
    print(f"{CYAN}  PostgreSQL Test Data - Table: 001-Test{RESET}")
    print(f"  Server  : {args.host}:{args.port}")
    print(f"  Database: {args.database}")
    print(f"  Write   : sapwriter")
    print(f"  Read    : airead")
    print(f"{CYAN}============================================={RESET}")
    print()

    # Prompt postgres password if not provided
    postgres_pass = args.postgres_pass
    if not postgres_pass:
        postgres_pass = getpass.getpass(f"  Password for postgres@{args.host}: ")

    # ── Step 1: Create table as postgres ─────────────────────
    step("Step 1: Create table 001-Test and grant permissions")
    try:
        conn = get_conn(args.host, args.port, args.database, "postgres", postgres_pass)
        conn.autocommit = True
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS "001-Test" (
                id          SERIAL PRIMARY KEY,
                name        VARCHAR(100)  NOT NULL,
                category    VARCHAR(50)   NOT NULL,
                value       NUMERIC(12,2) NOT NULL,
                description TEXT,
                created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
            )
        """)
        cur.execute('GRANT INSERT, UPDATE ON "001-Test" TO sapwriter')
        cur.execute('GRANT USAGE, SELECT ON SEQUENCE "001-Test_id_seq" TO sapwriter')
        cur.execute('GRANT SELECT ON "001-Test" TO airead')
        cur.close()
        conn.close()
        ok('Table "001-Test" created, permissions granted to sapwriter and airead')
    except Exception as e:
        fail(f"Step 1 failed: {e}")

    # ── Step 2: Insert test data via sapwriter ────────────────
    step("Step 2: Insert test data via sapwriter")
    rows = [
        ("Alpha Record",   "TypeA", 1001.50, "First test entry inserted by sapwriter"),
        ("Beta Record",    "TypeB", 2002.75, "Second test entry"),
        ("Gamma Record",   "TypeA", 3003.00, "Third test entry"),
        ("Delta Record",   "TypeC", 4004.25, "Fourth test entry"),
        ("Epsilon Record", "TypeB", 5005.99, "Fifth test entry inserted by sapwriter"),
    ]
    try:
        conn = get_conn(args.host, args.port, args.database, "sapwriter", args.sapwriter_pass)
        conn.autocommit = True
        cur = conn.cursor()
        cur.executemany(
            'INSERT INTO "001-Test" (name, category, value, description) VALUES (%s, %s, %s, %s)',
            rows
        )
        cur.close()
        conn.close()
        ok(f"{len(rows)} rows inserted by sapwriter")
    except Exception as e:
        fail(f"Step 2 failed: {e}")

    # ── Step 3: Verify data via airead ────────────────────────
    step("Step 3: Verify data via airead (SELECT only)")
    try:
        conn = get_conn(args.host, args.port, args.database, "airead", args.airead_pass)
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute('SELECT id, name, category, value, created_at FROM "001-Test" ORDER BY id')
        results = cur.fetchall()
        cur.close()
        conn.close()

        print()
        header = f"  {'ID':<4}  {'Name':<18}  {'Category':<8}  {'Value':>10}  {'Created At'}"
        print(header)
        print("  " + "-" * (len(header) - 2))
        for r in results:
            print(f"  {r['id']:<4}  {r['name']:<18}  {r['category']:<8}  {float(r['value']):>10.2f}  {r['created_at']}")
        print()
        ok(f"airead SELECT returned {len(results)} rows")
    except Exception as e:
        fail(f"Step 3 failed: {e}")

    # ── Step 4: Confirm sapwriter blocked from DELETE ─────────
    step("Step 4: Confirm sapwriter is blocked from DELETE")
    try:
        conn = get_conn(args.host, args.port, args.database, "sapwriter", args.sapwriter_pass)
        conn.autocommit = True
        cur = conn.cursor()
        cur.execute('DELETE FROM "001-Test" WHERE id = 1')
        cur.close()
        conn.close()
        warn("Unexpected: sapwriter was able to DELETE - review permissions")
    except psycopg2.errors.InsufficientPrivilege:
        ok("sapwriter correctly BLOCKED from DELETE (permission denied)")
    except Exception as e:
        warn(f"Unexpected error: {e}")

    # ── Summary ───────────────────────────────────────────────
    print()
    print(f"{CYAN}============================================={RESET}")
    print(f"{CYAN}  Test Complete - Query Reference{RESET}")
    print(f"{CYAN}============================================={RESET}")
    print()
    print(f"{YELLOW}  Connect as airead (read-only):{RESET}")
    print(f"  psql -h {args.host} -U airead -d {args.database}")
    print(f"  Password: {args.airead_pass}")
    print()
    print(f"{YELLOW}  SELECT all rows:{RESET}")
    print('  SELECT * FROM "001-Test" ORDER BY id;')
    print()
    print(f"{YELLOW}  Filter by category:{RESET}")
    print('  SELECT * FROM "001-Test" WHERE category = \'TypeA\';')
    print()
    print(f"{YELLOW}  Count by category:{RESET}")
    print('  SELECT category, COUNT(*), SUM(value) FROM "001-Test" GROUP BY category;')
    print()
    print(f"{YELLOW}  Connect as sapwriter (write only):{RESET}")
    print(f"  psql -h {args.host} -U sapwriter -d {args.database}")
    print(f"  Password: {args.sapwriter_pass}")
    print()
    print(f"{YELLOW}  Insert a row:{RESET}")
    print('  INSERT INTO "001-Test" (name, category, value, description)')
    print("  VALUES ('New Record', 'TypeA', 999.99, 'Added by sapwriter');")
    print()
    print(f"{YELLOW}  Update a row:{RESET}")
    print('  UPDATE "001-Test" SET value = 1234.56 WHERE id = 1;')
    print()


if __name__ == "__main__":
    main()
