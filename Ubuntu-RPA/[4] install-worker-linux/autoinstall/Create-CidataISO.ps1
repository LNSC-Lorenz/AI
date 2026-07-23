#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Create cloud-init cidata ISO for Ubuntu Autoinstall (Linux RPA Workers)
.DESCRIPTION
    Create ISO with label "cidata" containing user-data and meta-data
    from the per-host subdirectory (lcnnsc-rpa-l01 / l02 / l03).
    Requires Windows ADK (oscdimg).
.PARAMETER HostName
    Worker host name = subdirectory name (default: lcnnsc-rpa-l01)
.PARAMETER OutputPath
    Full path for output ISO file (default: cidata-<HostName>.iso in script directory)
.EXAMPLE
    .\Create-CidataISO.ps1 -HostName lcnnsc-rpa-l02
    Creates cidata-lcnnsc-rpa-l02.iso from .\lcnnsc-rpa-l02\
#>
[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet("lcnnsc-rpa-l01", "lcnnsc-rpa-l02", "lcnnsc-rpa-l03")]
    [string]$HostName = "lcnnsc-rpa-l01",

    [Parameter()]
    [string]$OutputPath = ""
)

$SourceDir = Join-Path $PSScriptRoot $HostName
if ([string]::IsNullOrEmpty($OutputPath)) { $OutputPath = Join-Path $PSScriptRoot "cidata-$HostName.iso" }

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
Write-Host "  For Ubuntu 24.04 LTS Autoinstall (Linux RPA Worker)" -ForegroundColor Blue
Write-Host "  Host: $HostName" -ForegroundColor Blue
Write-Host "=============================================================" -ForegroundColor Blue

if (-not (Test-Path -LiteralPath $SourceDir)) {
    Write-Error "Source directory does not exist: $SourceDir"
    exit 1
}
Write-Host "Source: $SourceDir" -ForegroundColor Gray
Write-Host "Output: $OutputPath" -ForegroundColor Gray

if (-not (Test-RequiredFiles -Directory $SourceDir)) { exit 1 }
Convert-ToUnixLineEnding -Directory $SourceDir

$toolPath = Find-Oscdimg
if (-not $toolPath) {
    Write-Host @"

Windows ADK (oscdimg.exe) not found.

Install options:
  1. Download from: https://aka.ms/adk
     Run adksetup.exe and select 'Deployment Tools'
  2. Or use WSL/Linux:
     genisoimage -output cidata-$HostName.iso -volid cidata -joliet -rock user-data meta-data

"@ -ForegroundColor Yellow
    exit 1
}
Write-Host "[OK] Found oscdimg: $toolPath" -ForegroundColor Green

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
    $isoInfo = Get-Item -LiteralPath $OutputPath
    Write-Host "=============================================================" -ForegroundColor Green
    Write-Host "  ISO Created: $($isoInfo.FullName)" -ForegroundColor Green
    Write-Host "  Size: $([math]::Round($isoInfo.Length / 1KB, 2)) KB | Label: $VolumeLabel" -ForegroundColor Green
    Write-Host "=============================================================" -ForegroundColor Green
    Write-Host "Usage:" -ForegroundColor Green
    Write-Host "1. Upload ISO to VMware ESXi datastore" -ForegroundColor Green
    Write-Host "2. Edit VM ($HostName) - CD/DVD drive - Select this ISO" -ForegroundColor Green
    Write-Host "3. Boot VM with Ubuntu 24.04 live-server ISO for unattended install" -ForegroundColor Green
} catch {
    Write-Error "Failed to create ISO: $_"
    exit 1
}
