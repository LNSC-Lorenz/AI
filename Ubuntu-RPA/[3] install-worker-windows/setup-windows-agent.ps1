# ==============================================================================
# RPA Platform — Windows Agent Setup
# Installs Prefect Worker + dependencies on Windows RPA VM
# Run as Administrator
# ==============================================================================

param(
    [string]$PrefectApiUrl = "http://10.86.180.120:4200/api",
    [string]$WorkPoolName = "windows-rpa-pool",
    [string]$WorkerName = "rpa-agent-01"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " RPA Platform — Windows Agent Setup"       -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- Check admin ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Please run as Administrator" -ForegroundColor Red
    exit 1
}

# --- Python ---
Write-Host "`n[1/6] Checking Python..." -ForegroundColor Yellow
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "Installing Python via winget..."
    winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}
python --version

# --- Virtual Environment ---
Write-Host "`n[2/6] Creating virtual environment..." -ForegroundColor Yellow
$AgentDir = "C:\RPA-Agent"
if (-not (Test-Path $AgentDir)) { New-Item -ItemType Directory -Path $AgentDir | Out-Null }

$VenvDir = "$AgentDir\.venv"
if (-not (Test-Path $VenvDir)) {
    python -m venv $VenvDir
}

$pip = "$VenvDir\Scripts\pip.exe"
$python_venv = "$VenvDir\Scripts\python.exe"

# --- Install packages ---
Write-Host "`n[3/6] Installing Python packages..." -ForegroundColor Yellow
& $pip install --upgrade pip
& $pip install prefect==3.* httpx playwright pywin32 pyautogui

# Install Playwright browsers
& $python_venv -m playwright install chromium

# --- Copy flows ---
Write-Host "`n[4/6] Copying flow files..." -ForegroundColor Yellow
$FlowsDir = "$AgentDir\flows"
if (-not (Test-Path $FlowsDir)) { New-Item -ItemType Directory -Path $FlowsDir | Out-Null }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Copy-Item "$ScriptDir\flows\*" -Destination $FlowsDir -Force -Recurse

# --- Configure Prefect ---
Write-Host "`n[5/6] Configuring Prefect..." -ForegroundColor Yellow
$env:PREFECT_API_URL = $PrefectApiUrl
& $python_venv -m prefect config set PREFECT_API_URL=$PrefectApiUrl

# Create work pool (ignore error if already exists)
try {
    & $python_venv -m prefect work-pool create $WorkPoolName --type process
    Write-Host "Work pool '$WorkPoolName' created."
} catch {
    Write-Host "Work pool '$WorkPoolName' already exists."
}

# --- Register as Windows Service via NSSM ---
Write-Host "`n[6/6] Registering Windows Service..." -ForegroundColor Yellow
$nssmPath = "$AgentDir\nssm.exe"
if (-not (Test-Path $nssmPath)) {
    Write-Host "Downloading NSSM..."
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    $nssmZip = "$AgentDir\nssm.zip"
    Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip
    Expand-Archive -Path $nssmZip -DestinationPath "$AgentDir\nssm-extract" -Force
    Copy-Item "$AgentDir\nssm-extract\nssm-2.24\win64\nssm.exe" -Destination $nssmPath
    Remove-Item $nssmZip -Force
    Remove-Item "$AgentDir\nssm-extract" -Force -Recurse
}

$ServiceName = "PrefectRPAWorker"

# Remove existing service if present
& $nssmPath stop $ServiceName 2>$null
& $nssmPath remove $ServiceName confirm 2>$null

# Install service
& $nssmPath install $ServiceName $python_venv "-m" "prefect" "worker" "start" "--pool" $WorkPoolName "--name" $WorkerName
& $nssmPath set $ServiceName AppDirectory $AgentDir
& $nssmPath set $ServiceName AppEnvironmentExtra "PREFECT_API_URL=$PrefectApiUrl"
& $nssmPath set $ServiceName DisplayName "Prefect RPA Worker"
& $nssmPath set $ServiceName Description "Prefect 3 Worker for RPA automation tasks"
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppStdout "$AgentDir\logs\worker-stdout.log"
& $nssmPath set $ServiceName AppStderr "$AgentDir\logs\worker-stderr.log"

New-Item -ItemType Directory -Path "$AgentDir\logs" -Force | Out-Null

# Start service
& $nssmPath start $ServiceName

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Windows Agent Setup Complete"             -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host " Agent Dir:    $AgentDir"
Write-Host " Work Pool:    $WorkPoolName"
Write-Host " Worker Name:  $WorkerName"
Write-Host " Prefect API:  $PrefectApiUrl"
Write-Host " Service:      $ServiceName (running)"
Write-Host "==========================================" -ForegroundColor Green
