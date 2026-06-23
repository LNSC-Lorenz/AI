#Requires -Version 5.0
param(
    [string]$Folder   = "C:\Users\zhlo\Documents\GIT\AI\PostgreSQL\SAP\Testdata",
    [string]$File     = "",
    [string]$PgHost   = "10.86.180.71",
    [int]   $Port     = 5432,
    [string]$Database = "appdb",
    [string]$User         = "sapwriter",
    [string]$Password     = "SapWrite@2025",
    [string]$AdminUser    = "postgres",
    [string]$AdminPass    = "",
    [string]$Schema   = "sap_test",
    [switch]$DryRun
)

function ok   { param($m) Write-Host "[OK]   $m" -ForegroundColor Green }
function warn { param($m) Write-Host "[WARN] $m" -ForegroundColor Yellow }
function info { param($m) Write-Host "[INFO] $m" -ForegroundColor Cyan }
function fail { param($m) Write-Host "[FAIL] $m" -ForegroundColor Red; exit 1 }
function step { param($m) Write-Host "`n======================================`n  $m`n======================================" -ForegroundColor Cyan }

# File -> table name map
# Must  = substring that MUST appear in filename
# Not   = substring that must NOT appear (disambiguate)
$FileTableMap = @(
    # CO-PA
    @{ Must = "COPA";        Also = "ACDOCA"; Not = "";                      Table = "COPA_ACDOCA"             }
    @{ Must = "CO-PA";       Also = "ACDOCA"; Not = "";                      Table = "COPA_ACDOCA"             }
    # FAGLL03 variants (more specific first)
    @{ Must = "FAGLL03";     Also = "BSAD";   Not = "";                      Table = "FAGLL03_BSAD"            }
    @{ Must = "FAGLL03";     Also = "BSID";   Not = "";                      Table = "FAGLL03_BSID"            }
    @{ Must = "FAGLL03";     Also = "BSEG";   Not = "";                      Table = "FAGLL03_BSEG"            }
    @{ Must = "FAGLL03";     Also = "EBIT";   Not = "";                      Table = "FAGLL03_EBIT_ACDOCA"     }
    @{ Must = "FAGLL03";     Also = "EBITEBT"; Not = "";                     Table = "FAGLL03_EBIT_ACDOCA"     }
    @{ Must = "FAGLL03";     Also = "GROSS";  Not = "";                      Table = "FAGLL03_GM_ACDOCA"       }
    @{ Must = "FAGLL03";     Also = "ACDOCA"; Not = "BSAD|BSID|BSEG|EBIT|GROSS"; Table = "FAGLL03_ACDOCA"    }
    @{ Must = "FAGLL03";     Also = "";       Not = "ACDOCA|BSAD|BSID|BSEG|EBIT|GROSS"; Table = "FAGLL03_CASHFLOW" }
    # FBL3N variants
    @{ Must = "FBL3N";       Also = "EKKO";   Not = "";                      Table = "FBL3N_IMPORT_EKKO"       }
    @{ Must = "FBL3N";       Also = "EKPO";   Not = "";                      Table = "FBL3N_IMPORT_EKPO"       }
    @{ Must = "FBL3N";       Also = "ACDOCA"; Not = "EKKO|EKPO";            Table = "FBL3N_IMPORT_ACDOCA"     }
    @{ Must = "FBL3N";       Also = "";       Not = "ACDOCA|EKKO|EKPO";     Table = "FBL3N_SALES_ACDOCA"      }
    # MB5L inventory turnover
    @{ Must = "MB5L";        Also = "ACDOCA"; Not = "";                      Table = "MB5L_ACDOCA"             }
    # MB51
    @{ Must = "MSEG";        Also = "";       Not = "";                      Table = "MB51_MSEG"               }
    # Production order / Work center
    @{ Must = "AFKO";        Also = "";       Not = "";                      Table = "AFKO"                    }
    @{ Must = "AFVC";        Also = "";       Not = "";                      Table = "AFVC"                    }
    @{ Must = "CRHD";        Also = "";       Not = "";                      Table = "CRHD"                    }
    # QM tables (more specific first)
    @{ Must = "FPYQALS";     Also = "";       Not = "";                      Table = "QM_VENDOR_QALS"          }
    @{ Must = "AUFK";        Also = "";       Not = "";                      Table = "QM_INTERNAL_AUFK"        }
    @{ Must = "QMEL";        Also = "QM";     Not = "";                      Table = "QM_QMEL"                 }
    @{ Must = "FPYQMEL";     Also = "";       Not = "";                      Table = "QM_VENDOR_QMEL"          }
    # ZFIGPT
    @{ Must = "ZFIGPT";      Also = "DIVISION"; Not = "";                   Table = "ZFIGPT_DIV_ACDOCA"       }
    @{ Must = "ZFIGPT";      Also = "PROFITABILITY"; Not = "";              Table = "ZFIGPT_DIV_ACDOCA"       }
    @{ Must = "ZFIGPT";      Also = "ACDOCA"; Not = "DIVISION|PROFITABILITY"; Table = "ZFIGPT_AVG_PRICE_ACDOCA" }
    # Z_PRICE_INFORMATION
    @{ Must = "Z_PRICE";     Also = "";       Not = "";                      Table = "Z_PRICE_INFORMATION"     }
    # Stock tables
    @{ Must = "MBEW";        Also = "";       Not = "";                      Table = "MBEW_STOCK"              }
    @{ Must = "MARC";        Also = "";       Not = "";                      Table = "MARC_SAFETY_STOCK"       }
    # Vendor / Customer
    @{ Must = "LFM1";        Also = "";       Not = "";                      Table = "LFM1_VENDOR_PAYMENT"     }
    @{ Must = "UKMBP_CMS_SGM"; Also = "";    Not = "";                      Table = "UKMBP_CMS_SGM"           }
    @{ Must = "KNVV";        Also = "";       Not = "";                      Table = "KNVV_CUSTOMER_PAYMENT"   }
    @{ Must = "MARA";        Also = "";       Not = "";                      Table = "MARA_MATERIAL"           }
)

function Resolve-TableName {
    param([string]$Filename)
    $full = [System.IO.Path]::GetFileNameWithoutExtension($Filename).Trim()
    # Keep only ASCII (letters, digits, hyphen, underscore, dot) - strip Chinese/Unicode
    $ascii = [System.Text.RegularExpressions.Regex]::Replace($full, '[^\x21-\x7E]', '')
    $stem  = $ascii.ToUpper().Trim('_').Trim()
    foreach ($entry in $FileTableMap) {
        $must = $entry.Must.ToUpper()
        $also = $entry.Also.ToUpper()
        $not  = $entry.Not.ToUpper()
        if ($stem -notlike "*$must*") { continue }
        if ($also -ne "" -and $stem -notlike "*$also*") { continue }
        if ($not -ne "") {
            $blocked = $false
            foreach ($ex in ($not -split "\|")) {
                if ($ex -ne "" -and $stem -like "*$ex*") { $blocked = $true; break }
            }
            if ($blocked) { continue }
        }
        return $entry.Table
    }
    return ($stem -replace '[^A-Z0-9]', '_').Trim('_')
}

$PG_RESERVED = @('order','select','where','from','table','column','index','group',
    'by','having','limit','offset','join','on','as','in','is','not','and','or',
    'all','any','case','when','then','else','end','null','true','false','default',
    'check','unique','primary','foreign','key','references','constraint','create',
    'drop','alter','insert','update','delete','into','values','set','grant','user',
    'role','schema','database','view','sequence','trigger','function','procedure',
    'type','cast','do','begin','commit','rollback','transaction','session','time',
    'timestamp','date','interval','year','month','day','hour','minute','second',
    'zone','with','recursive','union','intersect','except','returning','window',
    'over','partition','row','rows','range','between','like','ilike','similar',
    'escape','overlaps','contains','contained','verbose','analyze','explain')

function Sanitize-Column {
    param([string]$Name)
    $s = $Name.Trim().ToLower()
    $s = $s -replace '[^\x00-\x7F]', ''   # strip non-ASCII
    $s = $s -replace '[\s/\-\.\:\+\*\=\!\?\#\@\$\%\^\&\|\\<>]', '_'
    $s = $s -replace '[()]', ''
    $s = $s -replace '__+', '_'
    $s = $s.Trim('_')
    if ([string]::IsNullOrEmpty($s)) { return "col" }
    # Prefix reserved words
    if ($PG_RESERVED -contains $s) { $s = "col_$s" }
    return $s
}

function Invoke-PGSQL {
    param([string]$Sql)
    $env:PGPASSWORD = $Password
    $env:PGCLIENTENCODING = "UTF8"
    $result = & $psql -h $PgHost -p $Port -U $User -d $Database -c $Sql 2>&1
    $env:PGPASSWORD = ""
    return $result
}

function Invoke-PGSQLFile {
    param([string]$SqlFile)
    $env:PGPASSWORD = $Password
    $env:PGCLIENTENCODING = "UTF8"
    $result = & $psql -h $PgHost -p $Port -U $User -d $Database -f $SqlFile 2>&1
    $env:PGPASSWORD = ""
    return $result
}

function Invoke-AdminSQL {
    param([string]$Sql)
    $env:PGPASSWORD = $AdminPass
    $env:PGCLIENTENCODING = "UTF8"
    $result = & $psql -h $PgHost -p $Port -U $AdminUser -d $Database -c $Sql 2>&1
    $env:PGPASSWORD = ""
    return $result
}

function Invoke-AdminSQLFile {
    param([string]$SqlFile)
    $env:PGPASSWORD = $AdminPass
    $env:PGCLIENTENCODING = "UTF8"
    $result = & $psql -h $PgHost -p $Port -U $AdminUser -d $Database -f $SqlFile 2>&1
    $env:PGPASSWORD = ""
    return $result
}

# Detect psql.exe
$psql = $null
foreach ($p in @(
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe"
)) { if (Test-Path $p) { $psql = $p; break } }
if (-not $psql) {
    $f = Get-Command "psql.exe" -ErrorAction SilentlyContinue
    if ($f) { $psql = $f.Source }
}
if (-not $psql) { fail "psql.exe not found. Install PostgreSQL client tools." }

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  SAP Excel -> PostgreSQL Import"            -ForegroundColor Cyan
Write-Host "  DB     : ${User}@${PgHost}:${Port}/${Database}" -ForegroundColor Gray
Write-Host "  Schema : $Schema"                          -ForegroundColor Gray
Write-Host "  Folder : $Folder"                         -ForegroundColor Gray
Write-Host "  DryRun : $DryRun"                         -ForegroundColor Gray
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Prompt for postgres admin password if not provided
if ([string]::IsNullOrEmpty($AdminPass)) {
    $sec = Read-Host "  Password for ${AdminUser}@${PgHost} (for DDL)" -AsSecureString
    $AdminPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}

# Test sapwriter connection
$testResult = Invoke-PGSQL "SELECT 1 AS ok;"
if ($testResult -match "ERROR|could not connect|FATAL") { fail "Cannot connect as sapwriter: $testResult" }
ok "DB connection OK (sapwriter)"

# Test admin connection
$testAdmin = Invoke-AdminSQL "SELECT 1 AS ok;"
if ($testAdmin -match "ERROR|could not connect|FATAL") { fail "Cannot connect as ${AdminUser}: $testAdmin" }
ok "DB connection OK (${AdminUser})"

# Ensure schema exists (admin)
if (-not $DryRun) {
    $schemaSql = @"
CREATE SCHEMA IF NOT EXISTS $Schema;
GRANT USAGE ON SCHEMA $Schema TO sapwriter;
GRANT USAGE ON SCHEMA $Schema TO airead;
"@
    $tmpSchema = [System.IO.Path]::GetTempFileName() + ".sql"
    [System.IO.File]::WriteAllText($tmpSchema, $schemaSql, [System.Text.Encoding]::UTF8)
    Invoke-AdminSQLFile -SqlFile $tmpSchema | Out-Null
    Remove-Item $tmpSchema -ErrorAction SilentlyContinue
}

# Collect Excel files
if ($File -ne "") {
    $excelFiles = @(Get-Item $File)
} else {
    if (-not (Test-Path $Folder)) { fail "Folder not found: $Folder" }
    $excelFiles = @(Get-ChildItem -Path $Folder -File | Where-Object { $_.Extension -match '\.(xlsx|xls)$' })
}

if ($excelFiles.Count -eq 0) { fail "No Excel files found in: $Folder" }
info "Found $($excelFiles.Count) Excel file(s)"

# Load Excel COM object
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$results = @()

foreach ($xlFile in $excelFiles) {
    step "Processing: $($xlFile.Name)"

    $tableName = Resolve-TableName -Filename $xlFile.Name
    info "Target table: ${Schema}.${tableName}"

    try {
        $wb = $excel.Workbooks.Open($xlFile.FullName, 0, $true)
        $ws = $wb.Sheets.Item(1)
        $used = $ws.UsedRange
        $rowCount = $used.Rows.Count
        $colCount = $used.Columns.Count

        if ($rowCount -lt 2) {
            warn "No data rows, skipping"
            $wb.Close($false)
            $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=0; Status="empty" }
            continue
        }

        # Read header row
        $headers = @()
        for ($c = 1; $c -le $colCount; $c++) {
            $val = $used.Cells.Item(1, $c).Text
            if ([string]::IsNullOrWhiteSpace($val)) { $val = "col_$c" }
            $headers += Sanitize-Column -Name $val
        }

        # Deduplicate headers - count occurrences first, then assign unique names
        $countMap = @{}
        foreach ($h in $headers) {
            if ($countMap.ContainsKey($h)) { $countMap[$h]++ } else { $countMap[$h] = 1 }
        }
        $indexMap = @{}
        $cleanHeaders = @()
        foreach ($h in $headers) {
            if ($countMap[$h] -eq 1) {
                $cleanHeaders += $h
            } else {
                if (-not $indexMap.ContainsKey($h)) { $indexMap[$h] = 1 } else { $indexMap[$h]++ }
                $candidate = "${h}_dup$($indexMap[$h])"
                # ensure even the dup name is unique
                while ($cleanHeaders -contains $candidate) { $indexMap[$h]++; $candidate = "${h}_dup$($indexMap[$h])" }
                $cleanHeaders += $candidate
            }
        }

        info "Columns ($($cleanHeaders.Count)): $($cleanHeaders -join ', ')"
        info "Data rows: $($rowCount - 1)"

        if ($DryRun) {
            warn "[DRY RUN] Skipping insert"
            $wb.Close($false)
            $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=($rowCount-1); Status="dry_run" }
            continue
        }

        # Create table SQL (drop first to reset column names on re-run)
        $colDefs = ($cleanHeaders | ForEach-Object { "    `"$_`" TEXT" }) -join ",`n"
        $createSql = @"
DROP TABLE IF EXISTS ${Schema}."${tableName}";
CREATE TABLE ${Schema}."${tableName}" (
    _id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    _synced_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    _source_file TEXT,
$colDefs
);
GRANT INSERT, UPDATE ON ${Schema}."${tableName}" TO sapwriter;
GRANT SELECT ON ${Schema}."${tableName}" TO airead;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${Schema} TO sapwriter;
"@
        $tmpCreate = [System.IO.Path]::GetTempFileName() + ".sql"
        [System.IO.File]::WriteAllText($tmpCreate, $createSql, [System.Text.Encoding]::UTF8)
        $createResult = Invoke-AdminSQLFile -SqlFile $tmpCreate
        Remove-Item $tmpCreate -ErrorAction SilentlyContinue
        if ("$createResult" -match "ERROR") {
            warn "CREATE TABLE failed for ${tableName}: $createResult"
            try { $wb.Close($false) } catch {}
            $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=0; Status="error" }
            continue
        }

        # Read entire range as 2D array in ONE COM call (fast)
        $dataRange = $ws.Range($ws.Cells.Item(2,1), $ws.Cells.Item($rowCount, $colCount))
        $allData = $dataRange.Value2   # single COM call, returns [object[,]]

        $wb.Close($false)

        # Build CSV from array
        $tmpCsv = [System.IO.Path]::GetTempFileName() + ".csv"
        $sb = New-Object System.Text.StringBuilder
        # Header row
        $hdr = (@("_source_file") + $cleanHeaders | ForEach-Object { '"' + ($_ -replace '"','""') + '"' }) -join ","
        [void]$sb.AppendLine($hdr)

        $srcVal = '"' + ($xlFile.Name -replace '"','""') + '"'
        $dataRows = $rowCount - 1
        $dataCols = $cleanHeaders.Count

        if ($dataRows -eq 1) {
            # Single row: Value2 returns 1D array, wrap it
            $parts = @($srcVal)
            for ($c = 1; $c -le $dataCols; $c++) {
                $cell = if ($null -ne $allData -and $c -le $allData.Length) { "$($allData[$c])" } else { "" }
                if ([string]::IsNullOrWhiteSpace($cell)) { $parts += "" }
                else { $parts += '"' + ($cell -replace '"','""') + '"' }
            }
            [void]$sb.AppendLine(($parts -join ","))
        } else {
            for ($r = 1; $r -le $dataRows; $r++) {
                $parts = @($srcVal)
                for ($c = 1; $c -le $dataCols; $c++) {
                    $cell = if ($null -ne $allData) { "$($allData[$r,$c])" } else { "" }
                    if ([string]::IsNullOrWhiteSpace($cell) -or $cell -eq "") { $parts += "" }
                    else { $parts += '"' + ($cell -replace '"','""') + '"' }
                }
                [void]$sb.AppendLine(($parts -join ","))
            }
        }
        [System.IO.File]::WriteAllText($tmpCsv, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))

        # Build \copy via temp script file to preserve quotes exactly
        $csvPath = $tmpCsv -replace '\\', '/'
        $quotedCols = (@("_source_file") + $cleanHeaders | ForEach-Object { """$_""" }) -join ", "
        $copyCmd = "\copy ${Schema}.`"${tableName}`" ($quotedCols) FROM '$csvPath' WITH (FORMAT csv, HEADER true, NULL '', ENCODING 'UTF8')"
        $tmpCopyScript = [System.IO.Path]::GetTempFileName() + ".sql"
        [System.IO.File]::WriteAllText($tmpCopyScript, $copyCmd, (New-Object System.Text.UTF8Encoding $false))

        $insResult = Invoke-PGSQLFile -SqlFile $tmpCopyScript
        Remove-Item $tmpCopyScript, $tmpCsv -ErrorAction SilentlyContinue

        if ("$insResult" -match "ERROR|error") {
            warn "Import error: $insResult"
            $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=0; Status="error" }
        } else {
            ok "Imported $($rowCount - 1) rows -> ${Schema}.${tableName}  [$insResult]"
            $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=($rowCount-1); Status="ok" }
        }

    } catch {
        warn "Error processing $($xlFile.Name): $_"
        try { $wb.Close($false) } catch {}
        $results += [PSCustomObject]@{ File=$xlFile.Name; Table=$tableName; Rows=0; Status="error" }
    }
}

$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

# Summary
Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  Import Summary" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
$totalRows = 0
foreach ($r in $results) {
    $color = switch ($r.Status) {
        "ok"      { "Green" }
        "dry_run" { "Cyan" }
        "empty"   { "Gray" }
        default   { "Red" }
    }
    Write-Host ("  [{0,-8}] {1,-35} {2,6} rows  <- {3}" -f $r.Status.ToUpper(), $r.Table, $r.Rows, $r.File) -ForegroundColor $color
    $totalRows += $r.Rows
}
Write-Host ""
Write-Host "  Total rows: $totalRows" -ForegroundColor Cyan
Write-Host ""
info "Verify in pgAdmin:"
foreach ($r in ($results | Where-Object { $r.Status -eq "ok" })) {
    Write-Host "  SELECT COUNT(*) FROM ${Schema}.`"$($r.Table)`";" -ForegroundColor Gray
}
Write-Host ""
