# ==============================================================================
# RPA Platform - Windows Agent Setup (GUI mode, all-in-one)
#
# All Windows workers run SAP GUI automation, so the worker always runs in an
# interactive desktop session of the RPA user (no NSSM service / Session 0).
#
# Installs: Python + venv + Prefect + job dependencies + Playwright Chromium,
# grants the RPA user permissions, registers two scheduled tasks:
#   1. <TaskName>            - starts the worker when the RPA user logs on
#   2. <TaskName>-Redirect   - 3min later redirects the RDP session to console
#                              (tscon: RDP window closes, session stays unlocked)
#
# After installation the ONLY recurring manual step (per reboot) is:
#   RDP into the machine as the RPA user. Everything else is automatic.
# Optionally pass -RpaPassword to enable auto-logon instead (no manual step,
# but password is stored in plaintext in the registry - check company policy).
#
# Run as Administrator:
#   .\setup-windows-agent.ps1 -RpaUser "LECHLER\rpacn01" -WorkerName "lcnnsc-rpa-w01"
# ==============================================================================

param(
    [Parameter(Mandatory = $true)]
    [string]$RpaUser,                      # e.g. LECHLER\rpacn01 or .\rpalocal

    [string]$RpaPassword,                  # optional: enables auto-logon (plaintext in registry)

    [string]$PrefectApiUrl = "http://10.86.180.120:4200/api",
    [string]$WorkPoolName  = "windows-gui-pool",
    [string]$WorkerName    = "$env:COMPUTERNAME"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " RPA Platform - Windows Agent Setup"       -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- Check admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    exit 1
}

$AgentDir     = "C:\RPA-Agent"
$TaskName     = "PrefectRPAWorker-GUI"
$RedirectTask = "PrefectRPAWorker-ConsoleRedirect"

# --- Parse domain and username (supports DOMAIN\user, user@domain.com, bare name) ---
if ($RpaUser -match '^(.+)\\(.+)$') {
    $Domain   = if ($Matches[1] -eq '.') { $env:COMPUTERNAME } else { $Matches[1] }
    $UserOnly = $Matches[2]
} elseif ($RpaUser -match '^(.+)@(.+)$') {
    $Domain   = $Matches[2]
    $UserOnly = $Matches[1]
} else {
    $UserOnly = $RpaUser
    $cs = Get-CimInstance Win32_ComputerSystem
    if ($cs.PartOfDomain) {
        $Domain = ($cs.Domain -split '\.')[0].ToUpper()
        Write-Host "NOTE: treating '$RpaUser' as domain account $Domain\$UserOnly (use .\$RpaUser for local)" -ForegroundColor Yellow
    } else {
        $Domain = $env:COMPUTERNAME
    }
}
Write-Host "RPA user: $Domain\$UserOnly"

# --- Python ---
Write-Host "`n[1/10] Checking Python..." -ForegroundColor Yellow

# Note: "Get-Command python" alone is unreliable because Windows ships a
# Microsoft Store alias stub. Actually run it and check the output.
# IMPORTANT: Python must be a MACHINE-WIDE install. A per-user install under
# the admin's AppData is invisible to the RPA user and the venv breaks with
# "No Python at ..." when the worker task runs.
function Test-RealPython {
    try {
        $v = & python --version 2>&1
        if ($LASTEXITCODE -ne 0 -or $v -notmatch "Python 3") { return $false }
        $src = (Get-Command python).Source
        if ($src -match '\\AppData\\') {
            Write-Host "Found per-user Python at $src - not usable (RPA user cannot access it)." -ForegroundColor Yellow
            return $false
        }
        return $true
    } catch {
        return $false
    }
}

if (-not (Test-RealPython)) {
    Write-Host "Installing machine-wide Python via winget..."
    winget install Python.Python.3.12 --source winget --scope machine --accept-package-agreements --accept-source-agreements
    # Refresh PATH so python.exe is found in this session
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (-not (Test-RealPython)) {
        Write-Host "ERROR: Python still not available. Open a NEW PowerShell window and re-run this script." -ForegroundColor Red
        exit 1
    }
}
python --version

# --- Virtual Environment ---
Write-Host "`n[2/10] Creating virtual environment..." -ForegroundColor Yellow
if (-not (Test-Path $AgentDir)) { New-Item -ItemType Directory -Path $AgentDir | Out-Null }
New-Item -ItemType Directory -Path "$AgentDir\logs" -Force | Out-Null

$VenvDir = "$AgentDir\.venv"
# Rebuild the venv if it points to a per-user Python (broken for the RPA user)
$venvCfg = "$VenvDir\pyvenv.cfg"
if ((Test-Path $venvCfg) -and ((Get-Content $venvCfg -Raw) -match '\\AppData\\')) {
    Write-Host "Existing venv points to a per-user Python - rebuilding..." -ForegroundColor Yellow
    Remove-Item $VenvDir -Recurse -Force
}
if (-not (Test-Path $VenvDir)) {
    python -m venv $VenvDir
}

$python_venv = "$VenvDir\Scripts\python.exe"

# --- Install packages ---
Write-Host "`n[3/10] Installing Python packages..." -ForegroundColor Yellow
# Must use "python -m pip" to upgrade pip itself (pip.exe cannot replace itself on Windows)
& $python_venv -m pip install --upgrade pip
# Base + SAP GUI job dependencies (wmi/psutil/pandas/exchangelib/selenium/pycryptodome)
& $python_venv -m pip install prefect==3.* httpx playwright pywin32 pyautogui `
    wmi psutil pytz pandas openpyxl exchangelib selenium pycryptodome

# Install Playwright browsers to a fixed shared path so the SYSTEM service
# account can find them (default is the installing user's %LOCALAPPDATA%)
$BrowsersDir = "$AgentDir\browsers"
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersDir
& $python_venv -m playwright install chromium

# --- Copy flows ---
Write-Host "`n[4/10] Copying flow files..." -ForegroundColor Yellow
$FlowsDir = "$AgentDir\flows"
if (-not (Test-Path $FlowsDir)) { New-Item -ItemType Directory -Path $FlowsDir | Out-Null }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item "$ScriptDir\flows\*" -Destination $FlowsDir -Force -Recurse

# --- Configure Prefect ---
Write-Host "`n[5/10] Configuring Prefect..." -ForegroundColor Yellow
$env:PREFECT_API_URL = $PrefectApiUrl
# Shared PREFECT_HOME so no per-user %USERPROFILE%\.prefect is needed
# (avoids PermissionError when profile dirs have broken ACLs)
$env:PREFECT_HOME = "$AgentDir\.prefect"
New-Item -ItemType Directory -Path $env:PREFECT_HOME -Force | Out-Null
& $python_venv -m prefect config set PREFECT_API_URL=$PrefectApiUrl

# Create work pool (ignore error if already exists)
try {
    & $python_venv -m prefect work-pool create $WorkPoolName --type process
    Write-Host "Work pool '$WorkPoolName' created."
} catch {
    Write-Host "Work pool '$WorkPoolName' already exists."
}

# Register system flows (deploy-job: enables web-based package deployment)
& $python_venv "$FlowsDir\must_deploy.py"

# --- Remove legacy NSSM service if present (from old installs) ---
$ServiceName = "PrefectRPAWorker"
$nssmPath = "$AgentDir\nssm.exe"
if ((Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) -and (Test-Path $nssmPath)) {
    Write-Host "Removing legacy NSSM service..." -ForegroundColor Yellow
    & $nssmPath stop $ServiceName 2>$null
    & $nssmPath remove $ServiceName confirm
}

# --- Grant RPA user required permissions ---
Write-Host "`n[6/10] Granting permissions to $Domain\$UserOnly..." -ForegroundColor Yellow
icacls $AgentDir /grant "${Domain}\${UserOnly}:(OI)(CI)M" /T /Q | Out-Null
Write-Host "Granted Modify on $AgentDir"
try {
    Add-LocalGroupMember -Group "Remote Desktop Users" -Member "$Domain\$UserOnly" -ErrorAction Stop
    Write-Host "Added to Remote Desktop Users."
} catch {
    if ($_.Exception.Message -match 'already a member') {
        Write-Host "Already in Remote Desktop Users."
    } else {
        Write-Host "WARNING: could not add to Remote Desktop Users: $_" -ForegroundColor Yellow
    }
}

# --- Worker scheduled task (starts at logon of the RPA user) ---
Write-Host "`n[7/10] Registering worker scheduled task..." -ForegroundColor Yellow
$startCmd = "$AgentDir\start-worker.cmd"
@"
@echo off
REM Auto-generated by setup-windows-agent.ps1
set PREFECT_API_URL=$PrefectApiUrl
set PREFECT_HOME=$AgentDir\.prefect
set PLAYWRIGHT_BROWSERS_PATH=$BrowsersDir
cd /d $AgentDir
"$python_venv" -m prefect worker start --pool $WorkPoolName --name $WorkerName >> "$AgentDir\logs\worker-gui.log" 2>&1
"@ | Set-Content -Path $startCmd -Encoding ASCII

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
# Wrap in cmd.exe /c - Task Scheduler fails (result 103) when executing .cmd directly
$action    = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c `"$startCmd`"" -WorkingDirectory $AgentDir
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User "$Domain\$UserOnly"
$principal = New-ScheduledTaskPrincipal -UserId "$Domain\$UserOnly" -LogonType Interactive -RunLevel Limited
$settings  = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description "Prefect RPA Worker (GUI mode, interactive desktop session)" | Out-Null
Write-Host "Task '$TaskName' registered (at logon of $Domain\$UserOnly)."

# --- Console-redirect scheduled task (auto tscon, keeps session unlocked) ---
Write-Host "`n[8/10] Registering console-redirect task..." -ForegroundColor Yellow
$redirectPs1 = "$AgentDir\redirect-to-console.ps1"
@"
# Auto-generated by setup-windows-agent.ps1
# Redirects the RPA user's RDP session to the physical console (tscon).
`$log = 'C:\RPA-Agent\logs\console-redirect.log'
`$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
`$line = (query session $UserOnly 2>`$null) | Select-String 'rdp' | Select-Object -First 1
if (-not `$line) {
    Add-Content `$log "`$stamp no RDP session for $UserOnly, nothing to do"
    exit 0
}
if (`$line.Line -match '\s(\d+)\s') {
    `$id = `$Matches[1]
    tscon `$id /dest:console
    Add-Content `$log "`$stamp redirected session `$id to console (exit `$LASTEXITCODE)"
}
"@ | Set-Content -Path $redirectPs1 -Encoding ASCII

if (Get-ScheduledTask -TaskName $RedirectTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $RedirectTask -Confirm:$false
}
$rAction    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$redirectPs1`""
$rTrigger   = New-ScheduledTaskTrigger -AtLogOn -User "$Domain\$UserOnly"
$rTrigger.Delay = 'PT3M'   # grace period to check status before auto-disconnect
$rPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$rSettings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $RedirectTask -Action $rAction -Trigger $rTrigger `
    -Principal $rPrincipal -Settings $rSettings `
    -Description "Auto tscon: keep RPA user session on console, unlocked (3min after RDP logon)" | Out-Null
Write-Host "Task '$RedirectTask' registered (SYSTEM, 3min after logon)."

# --- Watchdog task (every 5 min: restart worker if the process died) ---
# Task Scheduler's RestartCount only fires on task failure; network drops or
# unhandled worker exits often leave the pool red for hours. The watchdog
# re-launches the worker task inside the user's session whenever it is gone.
Write-Host "`n[9/10] Registering watchdog task..." -ForegroundColor Yellow
$WatchdogTask = "PrefectRPAWorker-Watchdog"
$watchdogPs1  = "$AgentDir\worker-watchdog.ps1"
@"
# Auto-generated by setup-windows-agent.ps1
`$log = 'C:\RPA-Agent\logs\watchdog.log'
`$stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
# Worker alive? (venv python running prefect worker)
`$alive = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { `$_.CommandLine -match 'prefect worker start' }
if (`$alive) { exit 0 }
# User session present? (worker needs an interactive desktop)
`$session = (query session $UserOnly 2>`$null) | Select-String 'Active'
if (-not `$session) {
    Add-Content `$log "`$stamp worker down but no active session for $UserOnly - RDP logon needed"
    exit 0
}
Add-Content `$log "`$stamp worker down - restarting task $TaskName"
Start-ScheduledTask -TaskName '$TaskName'
"@ | Set-Content -Path $watchdogPs1 -Encoding ASCII

if (Get-ScheduledTask -TaskName $WatchdogTask -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $WatchdogTask -Confirm:$false
}
$wAction    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$watchdogPs1`""
$wTrigger   = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
$wPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$wSettings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $WatchdogTask -Action $wAction -Trigger $wTrigger `
    -Principal $wPrincipal -Settings $wSettings `
    -Description "Restart Prefect RPA worker task if the process died (checks every 5 min)" | Out-Null
Write-Host "Task '$WatchdogTask' registered (SYSTEM, every 5 min)."

# --- Lock screen / power / optional auto-logon ---
Write-Host "`n[10/10] Disabling lock screen / configuring logon..." -ForegroundColor Yellow
$personalization = "HKLM:\SOFTWARE\Policies\Microsoft\Windows\Personalization"
if (-not (Test-Path $personalization)) { New-Item -Path $personalization -Force | Out-Null }
Set-ItemProperty -Path $personalization -Name NoLockScreen -Value 1 -Type DWord
$system = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System"
Set-ItemProperty -Path $system -Name InactivityTimeoutSecs -Value 0 -Type DWord
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0

if ($RpaPassword) {
    $winlogon = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"
    Set-ItemProperty -Path $winlogon -Name AutoAdminLogon    -Value "1"          -Type String
    Set-ItemProperty -Path $winlogon -Name DefaultUserName   -Value $UserOnly    -Type String
    Set-ItemProperty -Path $winlogon -Name DefaultDomainName -Value $Domain      -Type String
    Set-ItemProperty -Path $winlogon -Name DefaultPassword   -Value $RpaPassword -Type String
    Remove-ItemProperty -Path $winlogon -Name AutoLogonCount -ErrorAction SilentlyContinue
    Write-Host "Auto-logon configured (password stored in plaintext in registry)." -ForegroundColor Yellow
} else {
    Write-Host "Auto-logon NOT configured (tscon mode: RDP logon once per reboot)."
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Windows Agent Setup Complete (GUI mode)"  -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Agent Dir:     $AgentDir"
Write-Host " Work Pool:     $WorkPoolName"
Write-Host " Worker Name:   $WorkerName"
Write-Host " Prefect API:   $PrefectApiUrl"
Write-Host " RPA User:      $Domain\$UserOnly"
Write-Host " Worker Task:   $TaskName (at logon)"
Write-Host " Redirect Task: $RedirectTask (SYSTEM, logon + 3min)"
Write-Host " Watchdog Task: $WatchdogTask (SYSTEM, every 5 min)"
Write-Host ""
if ($RpaPassword) {
Write-Host " Next: reboot (shutdown /r /t 0). Machine auto-logs in and starts worker."
} else {
Write-Host " Next: RDP into this machine as $Domain\$UserOnly - that is all."
Write-Host "   Worker starts automatically; ~3min later the RDP window closes by"
Write-Host "   itself (session moved to console, stays unlocked)."
Write-Host "   Repeat after every reboot/logoff."
}
Write-Host " Verify: Prefect UI -> Work Pools -> $WorkPoolName (worker online)"
Write-Host "==========================================" -ForegroundColor Green
