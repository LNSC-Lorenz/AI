#!/bin/bash
# pg-audit-alert.sh
# Setup: msmtp + PostgreSQL audit logging + system alert email
# Server: lcnnsc-db-pg01

set -e

SMTP_HOST="10.86.180.134"
SMTP_USER="message"
SMTP_PASS='G+6Dc[EU57JS*^'
MAIL_FROM="message@lechler.com.cn"
MAIL_TO="lorenz.zhang@lechler.com.cn"
HOSTNAME_LABEL="LCNNSC-DB-PG01"
PG_DB="appdb"
PG_SCHEMA="sap_test"

echo_step() { echo -e "\n=== $1 ==="; }

# ─────────────────────────────────────────────
# 1. Install msmtp
# ─────────────────────────────────────────────
echo_step "Installing msmtp"
apt-get install -y msmtp msmtp-mta mailutils

# ─────────────────────────────────────────────
# 2. Configure msmtp (system-wide)
# ─────────────────────────────────────────────
echo_step "Configuring msmtp"
touch /var/log/msmtp.log
chmod 666 /var/log/msmtp.log

cat > /etc/msmtprc <<EOF
defaults
auth           off
tls            off
tls_starttls   off
logfile        /var/log/msmtp.log

account        default
host           ${SMTP_HOST}
port           25
from           ${MAIL_FROM}
EOF
chmod 600 /etc/msmtprc
touch /var/log/msmtp.log && chmod 666 /var/log/msmtp.log

# ─────────────────────────────────────────────
# 3. Helper: send_alert function (written to /usr/local/bin)
# ─────────────────────────────────────────────
echo_step "Installing send_alert helper"
cat > /usr/local/bin/send_alert <<'SCRIPT'
#!/bin/bash
# Usage: send_alert <subject_suffix> <body>
SUFFIX="$1"
BODY="$2"
SUBJECT="Message_LCNNSC-DB-PG01_${SUFFIX}"
{
  echo "To: lorenz.zhang@lechler.com.cn"
  echo "From: message@lechler.com.cn"
  echo "Subject: ${SUBJECT}"
  echo "Content-Type: text/plain; charset=UTF-8"
  echo ""
  echo "${BODY}"
} | /usr/bin/msmtp lorenz.zhang@lechler.com.cn
SCRIPT
chmod +x /usr/local/bin/send_alert

# ─────────────────────────────────────────────
# 4. Test email
# ─────────────────────────────────────────────
echo_step "Sending test email"
send_alert "TEST" "This is a test alert from lcnnsc-db-pg01 setup at $(date)."
echo "Test email sent."

# ─────────────────────────────────────────────
# 5. PostgreSQL: enable pgaudit or fallback to log_statement
# ─────────────────────────────────────────────
echo_step "Configuring PostgreSQL audit logging"

PG_CONF=$(sudo -u postgres psql -t -c "SHOW config_file;" 2>/dev/null | tr -d ' ')
PG_LOG_DIR=$(sudo -u postgres psql -t -c "SHOW log_directory;" 2>/dev/null | tr -d ' ')
PG_DATA=$(sudo -u postgres psql -t -c "SHOW data_directory;" 2>/dev/null | tr -d ' ')

# Enable CSV logging + log all DML
cat >> "$PG_CONF" <<EOF

# Audit logging for DML alerts
log_destination = 'csvlog'
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d.log'
log_statement = 'mod'
log_min_duration_statement = 0
log_line_prefix = '%t [%p] %u@%d '
EOF

sudo -u postgres psql -c "SELECT pg_reload_conf();"
echo "PostgreSQL audit logging enabled (log_statement=mod)."

# ─────────────────────────────────────────────
# 6. PostgreSQL audit trigger on sap_test tables
# ─────────────────────────────────────────────
echo_step "Creating PostgreSQL audit trigger"
sudo -u postgres psql -d "$PG_DB" <<'PGSQL'
CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.dml_log (
    id          BIGSERIAL PRIMARY KEY,
    logged_at   TIMESTAMPTZ DEFAULT NOW(),
    schema_name TEXT,
    table_name  TEXT,
    operation   TEXT,
    db_user     TEXT,
    app_user    TEXT,
    row_data    JSONB,
    emailed     BOOLEAN DEFAULT FALSE
);

CREATE OR REPLACE FUNCTION audit.log_dml()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_row JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_row := to_jsonb(OLD);
    ELSE
        v_row := to_jsonb(NEW);
    END IF;
    INSERT INTO audit.dml_log(schema_name, table_name, operation, db_user, app_user, row_data)
    VALUES (TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, current_user, session_user, v_row);
    RETURN NEW;
END;
$$;

GRANT INSERT ON audit.dml_log TO sapwriter;
GRANT USAGE, SELECT ON SEQUENCE audit.dml_log_id_seq TO sapwriter;
PGSQL

# Attach trigger to all existing sap_test tables
sudo -u postgres psql -d "$PG_DB" <<'PGSQL'
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'sap_test' AND table_type = 'BASE TABLE'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit ON sap_test.%I;
             CREATE TRIGGER trg_audit
             AFTER INSERT OR UPDATE OR DELETE ON sap_test.%I
             FOR EACH ROW EXECUTE FUNCTION audit.log_dml();',
            t, t
        );
    END LOOP;
END $$;
PGSQL

echo "Audit triggers installed on all sap_test tables."

# ─────────────────────────────────────────────
# 7. Email alert script: poll audit.dml_log every 5 min
# ─────────────────────────────────────────────
echo_step "Installing pg-audit-mailer service"
cat > /usr/local/bin/pg-audit-mailer <<'SCRIPT'
#!/bin/bash
# Poll audit.dml_log and email unprocessed entries
DB="appdb"
MAIL_TO="lorenz.zhang@lechler.com.cn"
MAIL_FROM="message@lechler.com.cn"
HOSTNAME_LABEL="LCNNSC-DB-PG01"

ROWS=$(sudo -u postgres psql -d "$DB" -t -A -F'|' <<'SQL'
SELECT id, logged_at, schema_name, table_name, operation, db_user
FROM audit.dml_log
WHERE emailed = FALSE
ORDER BY logged_at
LIMIT 50;
SQL
)

if [ -z "$ROWS" ]; then
    exit 0
fi

COUNT=$(echo "$ROWS" | wc -l)
SUBJECT="Message_${HOSTNAME_LABEL}_DB_DML_${COUNT}ops_$(date +%Y%m%d%H%M)"
BODY="PostgreSQL DML Alert - $(date)\nServer: ${HOSTNAME_LABEL}\n\n"
BODY+="id|logged_at|schema|table|operation|user\n"
BODY+="$(echo "$ROWS")\n"

{
  echo "To: ${MAIL_TO}"
  echo "From: ${MAIL_FROM}"
  echo "Subject: ${SUBJECT}"
  echo "Content-Type: text/plain; charset=UTF-8"
  echo ""
  printf "%b" "$BODY"
} | /usr/bin/msmtp "$MAIL_TO"

# Mark as emailed
IDS=$(echo "$ROWS" | cut -d'|' -f1 | tr '\n' ',' | sed 's/,$//')
sudo -u postgres psql -d "$DB" -c "UPDATE audit.dml_log SET emailed=TRUE WHERE id IN (${IDS});"
SCRIPT
chmod +x /usr/local/bin/pg-audit-mailer

# ─────────────────────────────────────────────
# 8. Cron: run mailer every 5 min + daily system warning check
# ─────────────────────────────────────────────
echo_step "Setting up cron jobs"
cat > /etc/cron.d/pg-audit-alert <<EOF
# PostgreSQL DML audit email - every 5 minutes
*/5 * * * * root /usr/local/bin/pg-audit-mailer >> /var/log/pg-audit-mailer.log 2>&1

# System warning email - daily at 07:00
0 7 * * * root /usr/local/bin/system-alert-daily >> /var/log/system-alert.log 2>&1
EOF

# ─────────────────────────────────────────────
# 9. Daily system warning summary script
# ─────────────────────────────────────────────
cat > /usr/local/bin/system-alert-daily <<'SCRIPT'
#!/bin/bash
HOSTNAME_LABEL="LCNNSC-DB-PG01"
MAIL_TO="lorenz.zhang@lechler.com.cn"
MAIL_FROM="message@lechler.com.cn"
SUBJECT="Message_${HOSTNAME_LABEL}_SystemReport_$(date +%Y%m%d)"

DISK=$(df -h / /var/lib/postgresql 2>/dev/null)
MEM=$(free -h)
UPTIME=$(uptime)
KERN_WARN=$(journalctl -p warning --since "yesterday" --until "now" --no-pager -q 2>/dev/null | tail -50)
PG_ERRORS=$(sudo -u postgres psql -d appdb -t -c \
  "SELECT count(*), max(logged_at) FROM audit.dml_log WHERE logged_at > NOW()-INTERVAL '24h';" 2>/dev/null)
FAIL2BAN=$(fail2ban-client status 2>/dev/null | head -20 || echo "fail2ban not running")

BODY="Daily System Report - $(date)\nServer: ${HOSTNAME_LABEL}\n"
BODY+="\n--- Uptime ---\n${UPTIME}\n"
BODY+="\n--- Disk Usage ---\n${DISK}\n"
BODY+="\n--- Memory ---\n${MEM}\n"
BODY+="\n--- PostgreSQL DML last 24h ---\n${PG_ERRORS}\n"
BODY+="\n--- Fail2ban Status ---\n${FAIL2BAN}\n"
BODY+="\n--- Kernel Warnings (last 24h, last 50 lines) ---\n${KERN_WARN}\n"

{
  echo "To: ${MAIL_TO}"
  echo "From: ${MAIL_FROM}"
  echo "Subject: ${SUBJECT}"
  echo "Content-Type: text/plain; charset=UTF-8"
  echo ""
  printf "%b" "$BODY"
} | /usr/bin/msmtp "$MAIL_TO"
SCRIPT
chmod +x /usr/local/bin/system-alert-daily

# ─────────────────────────────────────────────
# 10. logwatch / kernel panic alert via journald
# ─────────────────────────────────────────────
echo_step "Installing journald error watcher"
cat > /usr/local/bin/journal-error-watch <<'SCRIPT'
#!/bin/bash
# Called by systemd path unit when journal has new errors
journalctl -p err --since "5 minutes ago" --no-pager -q 2>/dev/null | \
grep -v "^$" | head -20 | while IFS= read -r line; do
    send_alert "SysError_$(date +%H%M%S)" "$line"
done
SCRIPT
chmod +x /usr/local/bin/journal-error-watch

echo_step "Done"
echo "Summary:"
echo "  - msmtp configured -> ${SMTP_HOST}"
echo "  - Test email sent  -> ${MAIL_TO}"
echo "  - PostgreSQL audit triggers on sap_test.*"
echo "  - DML email: every 5 min via cron"
echo "  - Daily system report: 07:00 via cron"
echo ""
echo "Manual test:"
echo "  send_alert TEST 'hello from lcnnsc-db-pg01'"
echo "  /usr/local/bin/pg-audit-mailer"
echo "  /usr/local/bin/system-alert-daily"
