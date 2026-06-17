#!/usr/bin/env python3
"""
SAP CSV -> PostgreSQL Scheduled Sync
- Reads SAP exported CSV files from a watch folder
- Inserts/upserts data into PostgreSQL using sapwriter
- Runs on a schedule (default: every 10 minutes)
- Moves processed files to archive folder

Usage:
    python sap-sync.py                        # run once
    python sap-sync.py --schedule 10          # run every 10 minutes
    python sap-sync.py --file export.csv      # process single file
    python sap-sync.py --schedule 60 --table "SAP_MARA"

Requirements:
    pip install psycopg2-binary pandas schedule
"""

import argparse
import logging
import os
import shutil
import time
from datetime import datetime
from pathlib import Path

try:
    import pandas as pd
except ImportError:
    print("[FAIL] pandas not installed. Run: pip install pandas")
    raise SystemExit(1)

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("[FAIL] psycopg2 not installed. Run: pip install psycopg2-binary")
    raise SystemExit(1)

try:
    import schedule
except ImportError:
    print("[FAIL] schedule not installed. Run: pip install schedule")
    raise SystemExit(1)

# ── Logging setup ─────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("sap-sync.log", encoding="utf-8"),
    ],
)
log = logging.getLogger(__name__)

# ── Default config ────────────────────────────────────────────
DB_CONFIG = {
    "host":     "10.86.180.71",
    "port":     5432,
    "dbname":   "appdb",
    "user":     "sapwriter",
    "password": "SapWrite@2025",
    "connect_timeout": 10,
}

WATCH_FOLDER   = "./sap-export"       # folder to watch for new CSV files
ARCHIVE_FOLDER = "./sap-archive"      # processed files moved here
ERROR_FOLDER   = "./sap-error"        # failed files moved here
DEFAULT_TABLE  = "sap_data"           # target table name


def get_conn():
    return psycopg2.connect(**DB_CONFIG)


def detect_separator(filepath: str) -> str:
    """Auto-detect SAP export separator (tab, semicolon, or comma)."""
    with open(filepath, "r", encoding="utf-8-sig", errors="replace") as f:
        first_line = f.readline()
    if "\t" in first_line:
        return "\t"
    if ";" in first_line:
        return ";"
    return ","


def sanitize_column(name: str) -> str:
    """Convert SAP column names to valid PostgreSQL identifiers."""
    return (
        name.strip()
        .lower()
        .replace(" ", "_")
        .replace("/", "_")
        .replace("-", "_")
        .replace(".", "_")
        .replace("(", "")
        .replace(")", "")
    )


def ensure_table(conn, table: str, columns: list):
    """Create table if it does not exist based on CSV columns."""
    col_defs = ",\n    ".join(
        f'"{c}" TEXT' for c in columns
    )
    sql = f"""
        CREATE TABLE IF NOT EXISTS "{table}" (
            _sync_id    SERIAL PRIMARY KEY,
            _synced_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            _source_file TEXT,
            {col_defs}
        )
    """
    with conn.cursor() as cur:
        cur.execute(sql)
    conn.commit()
    log.info(f"Table '{table}' ready ({len(columns)} columns)")


def insert_dataframe(conn, table: str, df: pd.DataFrame, source_file: str) -> int:
    """Bulk insert DataFrame rows using execute_values (fast)."""
    if df.empty:
        log.warning("DataFrame is empty, nothing to insert")
        return 0

    cols = list(df.columns)
    quoted_cols = ", ".join(f'"{c}"' for c in cols)
    placeholders = "%s"

    insert_sql = f"""
        INSERT INTO "{table}" (_synced_at, _source_file, {quoted_cols})
        VALUES (NOW(), %s, {", ".join(["%s"] * len(cols))})
    """

    rows = []
    for _, row in df.iterrows():
        rows.append(tuple([source_file] + [str(v) if pd.notna(v) else None for v in row]))

    with conn.cursor() as cur:
        psycopg2.extras.execute_batch(cur, insert_sql, rows, page_size=500)

    conn.commit()
    return len(rows)


def process_file(filepath: str, table: str):
    """Read a SAP CSV export and insert into PostgreSQL."""
    filename = Path(filepath).name
    log.info(f"Processing: {filename}")

    try:
        sep = detect_separator(filepath)
        log.info(f"  Detected separator: {repr(sep)}")

        df = pd.read_csv(
            filepath,
            sep=sep,
            encoding="utf-8-sig",
            dtype=str,
            skip_blank_lines=True,
        )

        # Remove SAP summary rows (last row often has totals)
        df = df.dropna(how="all")

        # Sanitize column names
        df.columns = [sanitize_column(c) for c in df.columns]

        # Remove unnamed columns (SAP sometimes exports index columns)
        df = df.loc[:, ~df.columns.str.startswith("unnamed")]

        log.info(f"  Rows: {len(df)}, Columns: {list(df.columns)}")

        conn = get_conn()
        try:
            ensure_table(conn, table, list(df.columns))
            count = insert_dataframe(conn, table, df, filename)
            log.info(f"  Inserted {count} rows into '{table}'")
        finally:
            conn.close()

        # Archive processed file
        os.makedirs(ARCHIVE_FOLDER, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(ARCHIVE_FOLDER, f"{ts}_{filename}")
        shutil.move(filepath, dest)
        log.info(f"  Archived to: {dest}")
        return count

    except Exception as e:
        log.error(f"  FAILED: {filename} - {e}")
        os.makedirs(ERROR_FOLDER, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(ERROR_FOLDER, f"{ts}_{filename}")
        shutil.move(filepath, dest)
        return 0


def scan_and_sync(table: str):
    """Scan watch folder and process all new CSV files."""
    os.makedirs(WATCH_FOLDER, exist_ok=True)
    csv_files = list(Path(WATCH_FOLDER).glob("*.csv")) + \
                list(Path(WATCH_FOLDER).glob("*.txt"))

    if not csv_files:
        log.info(f"No new files in '{WATCH_FOLDER}'")
        return

    log.info(f"Found {len(csv_files)} file(s) to process")
    total = 0
    for f in csv_files:
        total += process_file(str(f), table)
    log.info(f"Sync complete. Total rows inserted: {total}")


def test_connection():
    """Verify database connection before starting."""
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute("SELECT version()")
        ver = cur.fetchone()[0]
        conn.close()
        log.info(f"DB connection OK: {ver[:60]}")
        return True
    except Exception as e:
        log.error(f"DB connection FAILED: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="SAP CSV -> PostgreSQL Sync")
    parser.add_argument("--host",      default=DB_CONFIG["host"],     help="PostgreSQL host")
    parser.add_argument("--port",      default=DB_CONFIG["port"],     type=int)
    parser.add_argument("--dbname",    default=DB_CONFIG["dbname"])
    parser.add_argument("--user",      default=DB_CONFIG["user"])
    parser.add_argument("--password",  default=DB_CONFIG["password"])
    parser.add_argument("--table",     default=DEFAULT_TABLE,         help="Target table name")
    parser.add_argument("--watch",     default=WATCH_FOLDER,          help="Folder to watch for CSV files")
    parser.add_argument("--schedule",  default=0, type=int,           help="Run every N minutes (0=run once)")
    parser.add_argument("--file",      default="",                    help="Process a single specific file")
    args = parser.parse_args()

    # Apply args to config
    DB_CONFIG.update({
        "host": args.host, "port": args.port,
        "dbname": args.dbname, "user": args.user, "password": args.password,
    })
    global WATCH_FOLDER
    WATCH_FOLDER = args.watch

    log.info("=" * 50)
    log.info("SAP -> PostgreSQL Sync")
    log.info(f"  DB     : {args.user}@{args.host}:{args.port}/{args.dbname}")
    log.info(f"  Table  : {args.table}")
    log.info(f"  Watch  : {WATCH_FOLDER}")
    log.info(f"  Schedule: {'every ' + str(args.schedule) + ' min' if args.schedule else 'run once'}")
    log.info("=" * 50)

    if not test_connection():
        raise SystemExit(1)

    # Single file mode
    if args.file:
        process_file(args.file, args.table)
        return

    # Run once
    if args.schedule == 0:
        scan_and_sync(args.table)
        return

    # Scheduled mode
    log.info(f"Scheduler started. Running every {args.schedule} minute(s). Press Ctrl+C to stop.")
    scan_and_sync(args.table)  # run immediately on start
    schedule.every(args.schedule).minutes.do(scan_and_sync, table=args.table)
    while True:
        schedule.run_pending()
        time.sleep(30)


if __name__ == "__main__":
    main()
