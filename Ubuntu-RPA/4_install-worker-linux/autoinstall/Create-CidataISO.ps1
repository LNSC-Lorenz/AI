#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Create cloud-init cidata ISO for Ubuntu Autoinstall (Linux RPA Workers)
.DESCRIPTION
    Create ISOs with label "cidata" containing user-data and meta-data
    from the per-host subdirectories (lcnnsc-rpa-l01 / l02 / l03).
    By default builds all three ISOs in one run.
    Requires Windows ADK (oscdimg).
.PARAMETER HostName
    Build only this worker host (= subdirectory name). Default: all hosts.
.EXAMPLE
    .\Create-CidataISO.ps1
    Creates cidata-lcnnsc-rpa-l01/l02/l03.iso in one run
.EXAMPLE
    .\Create-CidataISO.ps1 -HostName lcnnsc-rpa-l02
    Creates only cidata-lcnnsc-rpa-l02.iso
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet("lcnnsc-rpa-l01", "lcnnsc-rpa-l02", "lcnnsc-rpa-l03")]
    [string]$HostName = ""
)

$AllHosts = @("lcnnsc-rpa-l01", "lcnnsc-rpa-l02", "lcnnsc-rpa-l03")
$Hosts = if ([string]::IsNullOrEmpty($HostName)) { $AllHosts } else { @($HostName) }

$VolumeLabel = "cidata"
$RequiredFiles = @("user-data", "meta-data")

function Test-RequiredFiles {
    param([string]$Directory)
    Write-Host "[Check] Verifying required files..." -ForegroundColor Cyan
    $missing = @()
    foreach ($file in $RequiredFiles) {
        $fullPath = Join-Path $Directory $file
        if (-not (Test-Path -LiteralPath $fullPath)) {
            $missing += $file
        } else {
            Write-Host "  [OK] $file" -ForegroundColor Green
        }
    }
    if ($missing.Count -gt 0) {
        Write-Host "[Error] Missing required files:" -ForegroundColor Red
        $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
        return $false
    }
    return $true
}

function Convert-ToUnixLineEnding {
    param([string]$Directory)
    Write-Host "[Process] Converting line endings to Unix (LF)..." -ForegroundColor Cyan
    foreach ($file in $RequiredFiles) {
        $fullPath = Join-Path $Directory $file
        if (Test-Path -LiteralPath $fullPath) {
            $content = Get-Content -LiteralPath $fullPath -Raw
            $hasCRLF = $content.Contains("`r`n")
            $hasCR = $content.Contains("`r") -and -not $content.Contains("`r`n")
            if ($hasCRLF -or $hasCR) {
                $unixContent = $content -replace "`r`n", "`n"
                $unixContent = $unixContent -replace "`r", "`n"
                [System.IO.File]::WriteAllText($fullPath, $unixContent, [System.Text.Encoding]::UTF8)
                Write-Host "  [OK] $file converted to LF" -ForegroundColor Green
            } else {
                Write-Host "  [OK] $file already LF format" -ForegroundColor Green
            }
        }
    }
}

function Find-Oscdimg {
    $possiblePaths = @(
        "${env:ProgramFiles(x86)}\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe",
        "${env:ProgramFiles(x86)}\Windows Kits\11\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe",
        "${env:ProgramFiles}\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe",
        "${env:ProgramFiles}\Windows Kits\11\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg\oscdimg.exe"
    )
    foreach ($path in $possiblePaths) {
        if (Test-Path $path) { return $path }
    }
    $oscdimg = Get-Command "oscdimg.exe" -ErrorAction SilentlyContinue
    if ($oscdimg) { return $oscdimg.Source }
    return $null
}

function New-IsoWithOscdimg {
    param([string]$OscdimgPath, [string]$Source, [string]$Destination, [string]$Label)
    Write-Host "[Build] Creating ISO with oscdimg..." -ForegroundColor Cyan
    Write-Host "  Source: $Source" -ForegroundColor Gray
    Write-Host "  Output: $Destination" -ForegroundColor Gray
    $argString = "-n -d -l$Label `"$Source`" `"$Destination`""
    Write-Host "  Args: $argString" -ForegroundColor Gray
    $process = Start-Process -FilePath $OscdimgPath -ArgumentList $argString -Wait -NoNewWindow -PassThru
    if ($process.ExitCode -ne 0) { throw "oscdimg failed with exit code: $($process.ExitCode)" }
    Write-Host "[OK] ISO created successfully" -ForegroundColor Green
}

function Test-IsoContent {
    param([string]$IsoPath)
    Write-Host "[Verify] Checking ISO content..." -ForegroundColor Cyan
    try {
        $mount = Mount-DiskImage -ImagePath $IsoPath -StorageType ISO -PassThru -ErrorAction Stop
        $volume = $mount | Get-Volume
        $driveLetter = $volume.DriveLetter
        if ($volume.FileSystemLabel -ne $VolumeLabel) {
            Write-Warning "Label mismatch: expected '$VolumeLabel', got '$($volume.FileSystemLabel)'"
        } else {
            Write-Host "  [OK] Label: $($volume.FileSystemLabel)" -ForegroundColor Green
        }
        $drivePath = "${driveLetter}:"
        foreach ($file in $RequiredFiles) {
            $filePath = Join-Path $drivePath $file
            if (Test-Path -LiteralPath $filePath) {
                $size = (Get-Item -LiteralPath $filePath).Length
                Write-Host "  [OK] $file ($size bytes)" -ForegroundColor Green
            } else {
                Write-Host "  [Error] Missing $file" -ForegroundColor Red
            }
        }
        Dismount-DiskImage -ImagePath $IsoPath | Out-Null
        Write-Host "[OK] ISO verification completed" -ForegroundColor Green
    } catch {
        Write-Warning "Could not mount ISO for verification: $_"
    }
}

Write-Host "=============================================================" -ForegroundColor Blue
Write-Host "  Cloud-init cidata ISO Creator" -ForegroundColor Blue
Write-Host "  For Ubuntu 24.04 LTS Autoinstall (Linux RPA Workers)" -ForegroundColor Blue
Write-Host "  Hosts: $($Hosts -join ', ')" -ForegroundColor Blue
Write-Host "=============================================================" -ForegroundColor Blue

$toolPath = Find-Oscdimg
if (-not $toolPath) {
    Write-Host @"

Windows ADK (oscdimg.exe) not found.

Install options:
  1. Download from: https://aka.ms/adk
     Run adksetup.exe and select 'Deployment Tools'
  2. Or use WSL/Linux:
     genisoimage -output cidata-<host>.iso -volid cidata -joliet -rock user-data meta-data

"@ -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Found oscdimg: $toolPath" -ForegroundColor Green

$created = @()
$failed  = @()
foreach ($h in $Hosts) {
    Write-Host ""
    Write-Host "------------- $h -------------" -ForegroundColor Blue
    $SourceDir  = Join-Path $PSScriptRoot $h
    $OutputPath = Join-Path $PSScriptRoot "cidata-$h.iso"

    if (-not (Test-Path -LiteralPath $SourceDir)) {
        Write-Host "[Error] Source directory does not exist: $SourceDir" -ForegroundColor Red
        $failed += $h
        continue
    }
    Write-Host "Source: $SourceDir" -ForegroundColor Gray
    Write-Host "Output: $OutputPath" -ForegroundColor Gray

    if (-not (Test-RequiredFiles -Directory $SourceDir)) { $failed += $h; continue }
    Convert-ToUnixLineEnding -Directory $SourceDir

    if (Test-Path -LiteralPath $OutputPath) {
        Write-Host "[Warning] Removing existing ISO file..." -ForegroundColor Yellow
        Remove-Item -LiteralPath $OutputPath -Force
    }

    try {
        # Stage only required files to a temp directory
        $stageDir = Join-Path $env:TEMP "cidata-stage-$(Get-Random)"
        New-Item -ItemType Directory -Path $stageDir -Force | Out-Null
        foreach ($file in $RequiredFiles) {
            Copy-Item -LiteralPath (Join-Path $SourceDir $file) -Destination $stageDir -Force
        }
        Write-Host "[Stage] Staged files to: $stageDir" -ForegroundColor Cyan

        New-IsoWithOscdimg -OscdimgPath $toolPath -Source $stageDir -Destination $OutputPath -Label $VolumeLabel

        Remove-Item -LiteralPath $stageDir -Recurse -Force -ErrorAction SilentlyContinue
        Test-IsoContent -IsoPath $OutputPath
        $created += (Get-Item -LiteralPath $OutputPath)
    } catch {
        Write-Host "[Error] Failed to create ISO for ${h}: $_" -ForegroundColor Red
        $failed += $h
    }
}

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host "  Summary" -ForegroundColor Green
Write-Host "=============================================================" -ForegroundColor Green
foreach ($iso in $created) {
    Write-Host "  [OK] $($iso.Name)  ($([math]::Round($iso.Length / 1KB, 2)) KB)" -ForegroundColor Green
}
foreach ($h in $failed) {
    Write-Host "  [FAILED] $h" -ForegroundColor Red
}
Write-Host ""
Write-Host "Usage:" -ForegroundColor Green
Write-Host "1. Upload ISOs to VMware ESXi datastore" -ForegroundColor Green
Write-Host "2. Edit each VM - CD/DVD drive - Select its matching ISO" -ForegroundColor Green
Write-Host "3. Boot VM with Ubuntu 24.04 live-server ISO for unattended install" -ForegroundColor Green

if ($failed.Count -gt 0) { exit 1 }
