#Requires -Version 3.0
param(
    [string]$ServerIP      = "10.86.180.71",
    [string]$SshUser       = "sysadmin",
    [string]$SshPassword   = "",
    [string]$PgHost        = "10.86.180.71",
    [int]   $PgPort        = 5432,
    [string]$Database      = "appdb",
    [string]$SapwriterPass = "SapWrite@2025",
    [string]$AireadPass    = "AiRead@2025",
    [string]$PostgresPass  = ""
)

function ok   { param($msg) Write-Host "[OK]   $msg" -ForegroundColor Green }
function warn { param($msg) Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function info { param($msg) Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function fail { param($msg) Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }
function step { param($msg)
    Write-Host ""
    Write-Host "======================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "======================================" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  PostgreSQL Test Data - Table: 001-Test"    -ForegroundColor Cyan
Write-Host "  Server  : ${PgHost}:${PgPort}"             -ForegroundColor Gray
Write-Host "  Database: $Database"                       -ForegroundColor Gray
Write-Host "  Write   : sapwriter"                       -ForegroundColor Gray
Write-Host "  Read    : airead"                          -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Detect psql.exe
$psql = $null
$psqlPaths = @(
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe"
)
foreach ($p in $psqlPaths) {
    if (Test-Path $p) { $psql = $p; break }
}
if (-not $psql) {
    $found = Get-Command "psql.exe" -ErrorAction SilentlyContinue
    if ($found) { $psql = $found.Source }
}

# Detect WinSCP for SSH fallback
$useSSH = $false
$WinSCP = $null
if (-not $psql) {
    $useSSH = $true
    $wscpPaths = @(
        "C:\Program Files (x86)\WinSCP\WinSCP.com",
        "C:\Program Files\WinSCP\WinSCP.com",
        "$env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com",
        "$env:ProgramFiles\WinSCP\WinSCP.com"
    )
    foreach ($p in $wscpPaths) {
        if (Test-Path $p) { $WinSCP = $p; break }
    }
    if (-not $WinSCP) {
        $found2 = Get-Command "WinSCP.com" -ErrorAction SilentlyContinue
        if ($found2) { $WinSCP = $found2.Source }
    }
    if (-not $WinSCP) {
        fail "Neither psql.exe nor WinSCP.com found. Install WinSCP: https://winscp.net"
    }
    if ([string]::IsNullOrEmpty($SshPassword)) {
        $sec = Read-Host "  SSH password for ${SshUser}@${ServerIP}" -AsSecureString
        $SshPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
        )
    }
    ok "SSH mode via WinSCP: $WinSCP"
} else {
    ok "Local psql.exe: $psql"
}

# Prompt postgres password
if ([string]::IsNullOrEmpty($PostgresPass)) {
    $sec2 = Read-Host "  Password for postgres@${PgHost}" -AsSecureString
    $PostgresPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec2)
    )
}

# Helper: execute a remote command via WinSCP
function Invoke-WinSCPCmd {
    param([string]$RemoteCmd)
    $script = @(
        "option batch abort",
        "option confirm off",
        "open ssh://${SshUser}:${SshPassword}@${ServerIP}/ -hostkey=*",
        "call $RemoteCmd",
        "exit"
    )
    $tmpScript = [System.IO.Path]::GetTempFileName() + ".txt"
    [System.IO.File]::WriteAllLines($tmpScript, $script, [System.Text.Encoding]::ASCII)
    $output = & $WinSCP /script=$tmpScript /log=$env:TEMP\winscp_sql.log 2>&1
    Remove-Item $tmpScript -ErrorAction SilentlyContinue
    return $output
}

# Helper: run a single SQL statement
function Invoke-SQL {
    param([string]$PgUser, [string]$PgPass, [string]$Sql)
    if ($useSSH) {
        $remoteCmd = "PGPASSWORD='" + $PgPass + "' psql -h 127.0.0.1 -p " + $PgPort + " -U " + $PgUser + " -d " + $Database + " -c " + [char]34 + $Sql + [char]34
        $result = Invoke-WinSCPCmd -RemoteCmd $remoteCmd
    } else {
        $env:PGPASSWORD = $PgPass
        $result = & $psql -h $PgHost -p $PgPort -U $PgUser -d $Database -c $Sql 2>&1
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    return $result
}

# Helper: run a multi-line SQL block (write to remote tmp file then execute)
function Invoke-SQLBlock {
    param([string]$PgUser, [string]$PgPass, [string]$SqlBlock)
    if ($useSSH) {
        $localTmp = [System.IO.Path]::GetTempFileName() + ".sql"
        [System.IO.File]::WriteAllText($localTmp, $SqlBlock, [System.Text.Encoding]::UTF8)
        $remoteTmp = "/tmp/pg_block_$PgUser.sql"
        $uploadScript = @(
            "option batch abort",
            "option confirm off",
            "open sftp://${SshUser}:${SshPassword}@${ServerIP}/ -hostkey=* -rawsettings PasswordAuthentication=1",
            "put `"$localTmp`" `"$remoteTmp`"",
            "exit"
        )
        $tmpUpload = [System.IO.Path]::GetTempFileName() + ".txt"
        [System.IO.File]::WriteAllLines($tmpUpload, $uploadScript, [System.Text.Encoding]::ASCII)
        & $WinSCP /script=$tmpUpload /log=$env:TEMP\winscp_upload_sql.log 2>&1 | Out-Null
        Remove-Item $tmpUpload, $localTmp -ErrorAction SilentlyContinue
        $remoteCmd = "PGPASSWORD='" + $PgPass + "' psql -h 127.0.0.1 -p " + $PgPort + " -U " + $PgUser + " -d " + $Database + " -f " + $remoteTmp + " ; rm -f " + $remoteTmp
        $result = Invoke-WinSCPCmd -RemoteCmd $remoteCmd
    } else {
        $env:PGPASSWORD = $PgPass
        $result = $SqlBlock | & $psql -h $PgHost -p $PgPort -U $PgUser -d $Database 2>&1
        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
    return $result
}

# Step 1: Create table
step "Step 1: Create table 001-Test and grant permissions"
$sql1 = @'
CREATE TABLE IF NOT EXISTS "001-Test" (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100)  NOT NULL,
    category    VARCHAR(50)   NOT NULL,
    value       NUMERIC(12,2) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
GRANT INSERT, UPDATE ON "001-Test" TO sapwriter;
GRANT USAGE, SELECT ON SEQUENCE "001-Test_id_seq" TO sapwriter;
GRANT SELECT ON "001-Test" TO airead;
'@
$r = Invoke-SQLBlock -PgUser "postgres" -PgPass $PostgresPass -SqlBlock $sql1
Write-Host ($r -join "`n")
if ("$r" -match "ERROR") { warn "Check output above for errors." }
else { ok 'Table "001-Test" ready, permissions granted' }

# Step 2: Insert test data via sapwriter (truncate first to avoid duplicates on re-run)
step "Step 2: Insert test data via sapwriter"
$truncSql = @'
TRUNCATE TABLE "001-Test" RESTART IDENTITY;
'@
Invoke-SQLBlock -PgUser "postgres" -PgPass $PostgresPass -SqlBlock $truncSql | Out-Null
$sql2 = @'
INSERT INTO "001-Test" (name, category, value, description) VALUES
    ('Alpha Record',   'TypeA', 1001.50, 'First test entry by sapwriter'),
    ('Beta Record',    'TypeB', 2002.75, 'Second test entry'),
    ('Gamma Record',   'TypeA', 3003.00, 'Third test entry'),
    ('Delta Record',   'TypeC', 4004.25, 'Fourth test entry'),
    ('Epsilon Record', 'TypeB', 5005.99, 'Fifth test entry by sapwriter');
'@
$r = Invoke-SQLBlock -PgUser "sapwriter" -PgPass $SapwriterPass -SqlBlock $sql2
Write-Host ($r -join "`n")
if ("$r" -match "ERROR") { warn "Insert may have failed." }
else { ok "5 rows inserted by sapwriter" }

# Step 3: Verify via airead
step "Step 3: Verify data via airead (SELECT only)"
$sql3 = @'
SELECT id, name, category, value, created_at FROM "001-Test" ORDER BY id;
'@
$r = Invoke-SQLBlock -PgUser "airead" -PgPass $AireadPass -SqlBlock $sql3
Write-Host ($r -join "`n")
if ("$r" -match "ERROR") { warn "SELECT failed." }
else { ok "airead SELECT succeeded" }

# Step 4: Confirm sapwriter blocked from DELETE
step "Step 4: Confirm sapwriter cannot DELETE"
$sql4 = @'
DELETE FROM "001-Test" WHERE id=1;
'@
$r = Invoke-SQLBlock -PgUser "sapwriter" -PgPass $SapwriterPass -SqlBlock $sql4
Write-Host ($r -join "`n") -ForegroundColor Gray
if ("$r" -match "permission denied") {
    ok "sapwriter correctly BLOCKED from DELETE"
} else {
    warn "Unexpected: sapwriter may have DELETE - review permissions"
}

# Summary
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Test Complete - Query Reference"            -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Connect as airead (read-only):"       -ForegroundColor Yellow
Write-Host "  psql -h $PgHost -U airead -d $Database"
Write-Host "  Password: $AireadPass"
Write-Host ""
Write-Host '  SELECT * FROM "001-Test" ORDER BY id;'
Write-Host '  SELECT * FROM "001-Test" WHERE category = ''TypeA'';'
Write-Host '  SELECT category, COUNT(*), SUM(value) FROM "001-Test" GROUP BY category;'
Write-Host ""
Write-Host "  Connect as sapwriter (write only):"    -ForegroundColor Yellow
Write-Host "  psql -h $PgHost -U sapwriter -d $Database"
Write-Host "  Password: $SapwriterPass"
Write-Host ""
Write-Host '  INSERT INTO "001-Test" (name, category, value, description)'
Write-Host "  VALUES ('New Record', 'TypeA', 999.99, 'Added by sapwriter');"
Write-Host '  UPDATE "001-Test" SET value = 1234.56 WHERE id = 1;'
Write-Host ""
