# ============================================================
# One-time setup: passwordless SSH from this machine to sysadmin@10.86.180.76
# Run once, enter the server password when prompted. After that,
# deploy.ps1 runs fully non-interactively.
# ============================================================
$ErrorActionPreference = "Stop"
$SSH_HOST = "sysadmin@10.86.180.76"
$KEY = "$env:USERPROFILE\.ssh\id_ed25519"

Write-Host "== LNSC deploy: one-time SSH key setup =="

if (-not (Test-Path $KEY)) {
  Write-Host "[1/3] Generating ed25519 key pair (no passphrase)..."
  ssh-keygen -t ed25519 -N '""' -f $KEY
} else {
  Write-Host "[1/3] Key pair already exists, skipping generation."
}

Write-Host "[2/3] Installing public key on server (ENTER SERVER PASSWORD NOW):"
Get-Content "$KEY.pub" | ssh $SSH_HOST "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo [OK] public-key-installed"

Write-Host "[3/3] Verifying passwordless login..."
ssh -o BatchMode=yes $SSH_HOST "echo [OK] passwordless-login-works"
if ($LASTEXITCODE -ne 0) {
  Write-Host "[WARN] Verification failed. Wrong password? Re-run this script to retry." -ForegroundColor Yellow
} else {
  Write-Host "[DONE] Setup complete. Deploy anytime with:  powershell apps/ssh/deploy.ps1 fahuo" -ForegroundColor Green
}

Write-Host ""
Read-Host "Press ENTER to close this window"
