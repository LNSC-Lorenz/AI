#!/usr/bin/env bash
# =============================================================
# PostgreSQL Test Data Script
# - Creates table "001-Test" in appdb
# - Inserts sample rows via sapwriter (INSERT/UPDATE only)
# - Verifies data via airead (SELECT only)
# Usage: sudo bash pg-test-data.sh
# =============================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[OK]   $*${RESET}"; }
warn() { echo -e "${YELLOW}[WARN] $*${RESET}"; }
info() { echo -e "${CYAN}[INFO] $*${RESET}"; }
fail() { echo -e "${RED}[FAIL] $*${RESET}"; exit 1; }

[[ $EUID -ne 0 ]] && fail "Run as root: sudo bash $0"

PG_VERSION=18
DB="appdb"
SAPWRITER_PASS="SapWrite@2025"
AIREAD_PASS="AiRead@2025"

echo ""
echo "============================================="
echo "  PostgreSQL Test Data - Table: 001-Test"
echo "  Write user : sapwriter"
echo "  Read  user : airead"
echo "============================================="
echo ""

# ── Step 1: Create table as postgres (owner) ─────────────────
info "Step 1: Creating table \"001-Test\" in $DB ..."
sudo -u postgres psql -d "$DB" <<'PGSQL'
-- Create test table (quoted identifier required for special chars)
CREATE TABLE IF NOT EXISTS "001-Test" (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    category    VARCHAR(50)   NOT NULL,
    value       NUMERIC(12,2) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Grant sapwriter INSERT/UPDATE on this table
GRANT INSERT, UPDATE ON "001-Test" TO sapwriter;
GRANT USAGE, SELECT ON SEQUENCE "001-Test_id_seq" TO sapwriter;

-- Grant airead SELECT on this table
GRANT SELECT ON "001-Test" TO airead;
PGSQL
ok "Table \"001-Test\" created and permissions granted"

# ── Step 2: Insert test data as sapwriter ────────────────────
info "Step 2: Inserting test data via sapwriter ..."
PGPASSWORD="$SAPWRITER_PASS" psql \
    -h 127.0.0.1 -p 5432 \
    -U sapwriter -d "$DB" <<'PGSQL'
INSERT INTO "001-Test" (name, category, value, description) VALUES
    ('Alpha Record',   'TypeA', 1001.50, 'First test entry inserted by sapwriter'),
    ('Beta Record',    'TypeB', 2002.75, 'Second test entry'),
    ('Gamma Record',   'TypeA', 3003.00, 'Third test entry'),
    ('Delta Record',   'TypeC', 4004.25, 'Fourth test entry'),
    ('Epsilon Record', 'TypeB', 5005.99, 'Fifth test entry inserted by sapwriter');
PGSQL
ok "5 rows inserted by sapwriter"

# ── Step 3: Verify data as airead ────────────────────────────
info "Step 3: Verifying data via airead (SELECT only) ..."
echo ""
PGPASSWORD="$AIREAD_PASS" psql \
    -h 127.0.0.1 -p 5432 \
    -U airead -d "$DB" \
    -c 'SELECT id, name, category, value, created_at FROM "001-Test" ORDER BY id;'

echo ""
ok "Verification complete - airead can SELECT data"

# ── Step 4: Verify sapwriter cannot DELETE ───────────────────
info "Step 4: Confirming sapwriter cannot DELETE (expected to fail) ..."
PGPASSWORD="$SAPWRITER_PASS" psql \
    -h 127.0.0.1 -p 5432 \
    -U sapwriter -d "$DB" \
    -c 'DELETE FROM "001-Test" WHERE id=1;' 2>&1 | grep -q "permission denied" \
    && ok "sapwriter correctly BLOCKED from DELETE" \
    || warn "Unexpected: sapwriter was able to DELETE"

echo ""
echo "============================================="
echo "  Test Complete"
echo "============================================="
echo ""
info "Query examples:"
echo ""
echo "  -- Connect as airead (read-only):"
echo "  psql -h 10.86.180.71 -U airead -d appdb"
echo "  Password: $AIREAD_PASS"
echo ""
echo "  -- Select all rows:"
echo "  SELECT * FROM \"001-Test\" ORDER BY id;"
echo ""
echo "  -- Filter by category:"
echo "  SELECT * FROM \"001-Test\" WHERE category = 'TypeA';"
echo ""
echo "  -- Count by category:"
echo "  SELECT category, COUNT(*), SUM(value) FROM \"001-Test\" GROUP BY category;"
echo ""
echo "  -- Connect as sapwriter (write only):"
echo "  psql -h 10.86.180.71 -U sapwriter -d appdb"
echo "  Password: $SAPWRITER_PASS"
echo ""
echo "  -- Insert a new row:"
echo "  INSERT INTO \"001-Test\" (name, category, value, description)"
echo "  VALUES ('New Record', 'TypeA', 999.99, 'Added by sapwriter');"
echo ""
echo "  -- Update a row:"
echo "  UPDATE \"001-Test\" SET value = 1234.56 WHERE id = 1;"
echo ""
