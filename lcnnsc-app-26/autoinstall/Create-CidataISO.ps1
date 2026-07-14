#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Create cloud-init cidata ISO for Ubuntu Autoinstall
.DESCRIPTION
    Create ISO with label "cidata" containing user-data and meta-data
    Requires Windows ADK (oscdimg)
.PARAMETER SourceDir
    Source directory containing user-data and meta-data (default: script directory)
.PARAMETER OutputPath
    Full path for output ISO file
.EXAMPLE
    .\Create-CidataISO.ps1
    Create cidata.iso in script directory with default settings
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceDir = "",
    
    [Parameter()]
    [string]$OutputPath = ""
)

if ([string]::IsNullOrEmpty($SourceDir)) { $SourceDir = $PSScriptRoot }
if ([string]::IsNullOrEmpty($OutputPath)) { $OutputPath = Join-Path $PSScriptRoot "cidata-lcnnsc-app-26.iso" }

$VolumeLabel = "cidata"
$RequiredFiles = @("user-data", "meta-data")

function Test-RequiredFiles {
    param([string]$Directory)
    Write-Host "[Check] Verifying required files..." -ForegroundColor Cyan
    $missing = @()
    foreach ($file in $RequiredFiles) {
        $fullPath = Join-Path $Directory $file
        if (-not (Test-Path $fullPath)) {
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
        if (Test-Path $fullPath) {
            $content = Get-Content $fullPath -Raw
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
    $arguments = @("-n", "-d", "-L`"$Label`"", "`"$Source`"", "`"$Destination`"")
    $process = Start-Process -FilePath $OscdimgPath -ArgumentList $arguments -Wait -NoNewWindow -PassThru
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
            if (Test-Path $filePath) {
                $size = (Get-Item $filePath).Length
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
Write-Host "  For: lcnnsc-app-26 (10.86.180.76)" -ForegroundColor Blue
Write-Host "=============================================================" -ForegroundColor Blue

$SourceDir = Resolve-Path $SourceDir
if (-not (Test-Path $SourceDir)) {
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

================================================================================
  Windows ADK (Assessment and Deployment Kit) Required
================================================================================

This script requires oscdimg.exe from Windows ADK to create ISO files.

Options:
--------
1. Auto-download and install ADK (Deployment Tools only, ~2GB)
2. Manual installation
3. Use alternative methods

"@ -ForegroundColor Yellow
    
    $choice = Read-Host "Select option (1/2/3, default: 1)"
    if ([string]::IsNullOrEmpty($choice)) { $choice = "1" }
    
    switch ($choice) {
        "1" {
            Write-Host "`n[Download] Downloading Windows ADK installer..." -ForegroundColor Cyan
            $adkUrl = "https://go.microsoft.com/fwlink/?linkid=2196127"
            $tempDir = Join-Path $env:TEMP "ADK-Install-$(Get-Random)"
            $setupPath = Join-Path $tempDir "adksetup.exe"
            
            try {
                New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
                Write-Host "  Downloading from: $adkUrl" -ForegroundColor Gray
                Invoke-WebRequest -Uri $adkUrl -OutFile $setupPath -UseBasicParsing
                
                if (-not (Test-Path $setupPath)) { throw "Download failed" }
                
                Write-Host "[Install] Installing Windows ADK (Deployment Tools only)..." -ForegroundColor Cyan
                $installArgs = @("/quiet", "/norestart", "/features", "OptionId.DeploymentTools")
                $process = Start-Process -FilePath $setupPath -ArgumentList $installArgs -Wait -PassThru
                
                if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
                
                if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
                    throw "Installation failed with exit code: $($process.ExitCode)"
                }
                
                $toolPath = Find-Oscdimg
                if (-not $toolPath) { throw "oscdimg.exe not found after installation" }
                Write-Host "[OK] Windows ADK installed successfully" -ForegroundColor Green
            }
            catch {
                Write-Host "[Error] Failed: $_" -ForegroundColor Red
                Write-Host "  Manual download: https://aka.ms/adk" -ForegroundColor Yellow
                exit 1
            }
        }
        "2" {
            Write-Host "`nManual: Download from https://aka.ms/adk -> select 'Deployment Tools'" -ForegroundColor Yellow
            exit 1
        }
        default {
            Write-Host "`nAlternative: genisoimage -output cidata.iso -volid cidata -joliet -rock user-data meta-data" -ForegroundColor Yellow
            exit 1
        }
    }
}
Write-Host "[OK] Found oscdimg: $toolPath" -ForegroundColor Green

$outputDir = Split-Path $OutputPath -Parent
if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
if (Test-Path $OutputPath) {
    Write-Host "[Warning] Removing existing ISO file..." -ForegroundColor Yellow
    Remove-Item $OutputPath -Force
}

try {
    New-IsoWithOscdimg -OscdimgPath $toolPath -Source $SourceDir -Destination $OutputPath -Label $VolumeLabel
    Test-IsoContent -IsoPath $OutputPath
    $isoInfo = Get-Item $OutputPath
    Write-Host "=============================================================" -ForegroundColor Green
    Write-Host "  ISO Created Successfully!" -ForegroundColor Green
    Write-Host "=============================================================" -ForegroundColor Green
    Write-Host "File: $($isoInfo.FullName)" -ForegroundColor Green
    Write-Host "Size: $([math]::Round($isoInfo.Length / 1KB, 2)) KB" -ForegroundColor Green
    Write-Host "Label: $VolumeLabel" -ForegroundColor Green
    Write-Host "" -ForegroundColor Green
    Write-Host "Usage:" -ForegroundColor Green
    Write-Host "1. Upload ISO to VMware ESXi datastore" -ForegroundColor Green
    Write-Host "2. Edit VM - CD/DVD drive - Select this ISO" -ForegroundColor Green
    Write-Host "3. Start VM for unattended install" -ForegroundColor Green
    Write-Host "" -ForegroundColor Green
    Write-Host "Notes:" -ForegroundColor Green
    Write-Host "  * ISO volume label must be 'cidata' (case sensitive)" -ForegroundColor Green
    Write-Host "  * VM NIC type should be VMXNET3 (maps to ens192)" -ForegroundColor Green
    Write-Host "=============================================================" -ForegroundColor Green
} catch {
    Write-Error "Failed to create ISO: $_"
    exit 1
}
