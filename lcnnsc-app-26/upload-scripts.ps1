#Requires -Version 3.0
param(
    [string]$ServerIP   = "10.86.180.76",
    [string]$Username   = "sysadmin",
    [string]$Password   = "",
    [string]$RemotePath = "/opt/scripts/"
)

$Scripts = @("hardening.sh", "setup-nginx.sh")
$LocalPath = $PSScriptRoot

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Upload Scripts to lcnnsc-app-26" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "Server : $ServerIP" -ForegroundColor Gray
Write-Host "User   : $Username" -ForegroundColor Gray
Write-Host "Target : $RemotePath" -ForegroundColor Gray
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

if ([string]::IsNullOrEmpty($Password)) {
    $SecurePass = Read-Host "  Password for ${Username}@${ServerIP}" -AsSecureString
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass)
    )
}
Write-Host ""

$WinSCP = $null
$WinSCPPaths = @(
    "C:\Program Files (x86)\WinSCP\WinSCP.com",
    "C:\Program Files\WinSCP\WinSCP.com",
    "$env:LOCALAPPDATA\Programs\WinSCP\WinSCP.com",
    "$env:ProgramFiles\WinSCP\WinSCP.com"
)
foreach ($p in $WinSCPPaths) {
    if (Test-Path $p) {
        $WinSCP = $p
        break
    }
}
if ($null -eq $WinSCP) {
    $found = Get-Command "WinSCP.com" -ErrorAction SilentlyContinue
    if ($null -ne $found) { $WinSCP = $found.Source }
}
if ($null -eq $WinSCP) {
    Write-Host "[ERROR] WinSCP.com not found. Please install WinSCP." -ForegroundColor Red
    Write-Host "        Download: https://winscp.net/eng/download.php" -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] WinSCP: $WinSCP" -ForegroundColor Green
Write-Host ""

$cmds = [System.Collections.Generic.List[string]]::new()
$cmds.Add("option batch abort")
$cmds.Add("option confirm off")
$cmds.Add("open sftp://${Username}:${Password}@${ServerIP}/ -hostkey=* -rawsettings PasswordAuthentication=1")

foreach ($s in $Scripts) {
    $f = Join-Path $LocalPath $s
    if (Test-Path $f) {
        $cmds.Add("put `"$f`" `"$RemotePath`"")
        Write-Host "[QUEUE] $s" -ForegroundColor Yellow
    } else {
        Write-Host "[SKIP]  $s (not found)" -ForegroundColor Gray
    }
}
$cmds.Add("exit")

$tmp = [System.IO.Path]::GetTempFileName() + ".txt"
[System.IO.File]::WriteAllLines($tmp, $cmds, [System.Text.Encoding]::ASCII)

Write-Host ""
Write-Host "[INFO] Uploading..." -ForegroundColor Cyan

$logFile = "$env:TEMP\winscp_upload.log"
$proc = Start-Process -FilePath $WinSCP `
    -ArgumentList "/script=`"$tmp`"", "/log=`"$logFile`"" `
    -Wait -PassThru -NoNewWindow

Remove-Item $tmp -ErrorAction SilentlyContinue

if ($proc.ExitCode -eq 0) {
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host "  Upload SUCCESS" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps - SSH into server:" -ForegroundColor Cyan
    Write-Host "  ssh ${Username}@${ServerIP}" -ForegroundColor White
    Write-Host "  cd $RemotePath" -ForegroundColor White
    Write-Host "  sudo chmod +x *.sh" -ForegroundColor White
    Write-Host "  sudo bash hardening.sh" -ForegroundColor White
    Write-Host "  sudo reboot" -ForegroundColor White
    Write-Host "  # After reboot:" -ForegroundColor Gray
    Write-Host "  sudo bash ${RemotePath}setup-nginx.sh" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "[FAIL] WinSCP exit code: $($proc.ExitCode)" -ForegroundColor Red
    Write-Host "       Log: $logFile" -ForegroundColor Yellow
}
