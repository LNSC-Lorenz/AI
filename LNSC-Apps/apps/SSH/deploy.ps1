# ============================================================
# LNSC-Apps one-command deploy
# Pushes updated files of apps/<app> to the server path and restarts the service.
# Usage:
#   powershell apps/ssh/deploy.ps1 fahuo              deploy one app + restart
#   powershell apps/ssh/deploy.ps1 all                deploy all apps in apps.conf
#   powershell apps/ssh/deploy.ps1 fahuo -NoRestart   deploy files only, no restart
# Prerequisite: run setup-sshkey.ps1 once (passwordless SSH).
# Safety: files listed in excludes.conf (db, secrets, uploads...) are NEVER uploaded.
# ============================================================
param(
  [Parameter(Mandatory = $true)][string]$App,
  [switch]$NoRestart
)
$ErrorActionPreference = "Stop"

$SSH_HOST = "sysadmin@10.86.180.76"
$SSH_DIR  = $PSScriptRoot                      # apps/ssh
$APPS_DIR = Split-Path $SSH_DIR -Parent        # apps/

# ---------- load app map from apps.conf ----------
$map = @{}
Get-Content "$SSH_DIR\apps.conf" | Where-Object { $_ -match '^\s*[^#\s]' } | ForEach-Object {
  $p = $_ -split '\|'
  if ($p.Count -ge 2) {
    $svc = ""
    if ($p.Count -ge 3) { $svc = $p[2].Trim() }
    $map[$p[0].Trim()] = @{ remote = $p[1].Trim(); svc = $svc }
  }
}
if ($map.Count -eq 0) { throw "apps.conf has no app mappings" }

# ---------- load exclude patterns (global excludes.conf + per-app excludes.<app>.conf) ----------
function Get-Excludes([string]$appName) {
  $list = @()
  foreach ($f in @("$SSH_DIR\excludes.conf", "$SSH_DIR\excludes.$appName.conf")) {
    if (Test-Path $f) {
      Get-Content $f | Where-Object { $_ -match '^\s*[^#\s]' } | ForEach-Object {
        $list += "--exclude=$($_.Trim())"
      }
    }
  }
  return ,$list
}

# ---------- targets ----------
$targets = @()
if ($App -eq "all") { $targets = @($map.Keys) } else { $targets = @($App) }

foreach ($name in $targets) {
  if (-not $map.Contains($name)) { Write-Warning "skip unknown app: $name (not in apps.conf)"; continue }
  $local = Join-Path $APPS_DIR $name
  if (-not (Test-Path $local)) { Write-Warning "skip: local dir not found $local"; continue }
  $remote = $map[$name].remote
  $svc    = $map[$name].svc
  $ts     = Get-Date -Format "yyyyMMddHHmmss"
  $tgz    = Join-Path $env:TEMP "$name-$ts.tgz"
  $excludes = Get-Excludes $name

  Write-Host "==> [$name] packing $local (data/secrets excluded)"
  tar -czf $tgz @excludes -C $local .
  if ($LASTEXITCODE -ne 0) { throw "tar pack failed" }

  Write-Host "==> [$name] uploading to $SSH_HOST"
  scp -o BatchMode=yes $tgz "${SSH_HOST}:/tmp/$name-$ts.tgz"
  if ($LASTEXITCODE -ne 0) { Remove-Item $tgz -ErrorAction SilentlyContinue; throw "scp failed (run setup-sshkey.ps1 first)" }

  $remoteCmd = "set -e; " +
    "rm -rf /tmp/$name-deploy; mkdir -p /tmp/$name-deploy; " +
    "tar -xzf /tmp/$name-$ts.tgz -C /tmp/$name-deploy; " +
    "sudo mkdir -p '$remote'; " +
    "sudo cp -r /tmp/$name-deploy/. '$remote'/; " +
    "rm -rf /tmp/$name-deploy /tmp/$name-$ts.tgz"
  if (($svc -ne "") -and (-not $NoRestart)) {
    $remoteCmd += "; echo '--- restarting service ---'; sudo systemctl restart '$svc'; sudo systemctl is-active '$svc'"
  }
  if (($svc -ne "") -and (-not $NoRestart)) {
    Write-Host "==> [$name] deploying to $remote and restarting $svc"
  } else {
    Write-Host "==> [$name] deploying to $remote"
  }
  ssh -o BatchMode=yes $SSH_HOST $remoteCmd
  if ($LASTEXITCODE -ne 0) { Remove-Item $tgz -ErrorAction SilentlyContinue; throw "remote command failed" }

  Remove-Item $tgz -ErrorAction SilentlyContinue
  if (($svc -ne "") -and (-not $NoRestart)) {
    Write-Host "[OK] [$name] deployed -> $remote ($svc restarted)" -ForegroundColor Green
  } else {
    Write-Host "[OK] [$name] deployed -> $remote" -ForegroundColor Green
  }
  Write-Host ""
}
