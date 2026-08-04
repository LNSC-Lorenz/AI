#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Create cloud-init cidata ISO for Ubuntu Autoinstall (LAB-Magentic-UI-00)
.DESCRIPTION
    Create ISO with label "cidata" containing user-data and meta-data.
    Requires Windows ADK oscdimg.exe.
.PARAMETER SourceDir
    Source directory containing user-data and meta-data (default: script directory)
.PARAMETER OutputPath
    Full path for output ISO file (default: cidata00.iso in script directory)
.EXAMPLE
    .\Create-CidataISO.ps1
#>
[CmdletBinding()]
param(
    [Parameter()]
    [string]$SourceDir = '',

    [Parameter()]
    [string]$OutputPath = ''
)

if ($SourceDir -eq '') { $SourceDir = $PSScriptRoot }
if ($OutputPath -eq '') { $OutputPath = Join-Path $PSScriptRoot 'cidata00.iso' }

$VolumeLabel = 'cidata'
$RequiredFiles = @('user-data', 'meta-data')

function Test-RequiredFiles {
    param([string]$Directory)
    Write-Host "[Check] Verifying required files..." -ForegroundColor Cyan
    $missing = @()
    foreach ($file in $RequiredFiles) {
        $fullPath = Join-Path $Directory $file
        if (Test-Path $fullPath) {
            Write-Host "  [OK] $file" -ForegroundColor Green
        } else {
            $missing += $file
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
    $oscdimg = Get-Command 'oscdimg.exe' -ErrorAction SilentlyContinue
    if ($oscdimg) { return $oscdimg.Source }
    return $null
}

function New-IsoWithOscdimg {
    param([string]$OscdimgPath, [string]$Source, [string]$Destination, [string]$Label)
    Write-Host "[Build] Creating ISO with oscdimg..." -ForegroundColor Cyan
    $arguments = @('-n', '-d', "-L$Label", $Source, $Destination)
    $process = Start-Process -FilePath $OscdimgPath -ArgumentList $arguments -Wait -NoNewWindow -PassThru
    if ($process.ExitCode -ne 0) { throw 'oscdimg failed with exit code: ' + $process.ExitCode }
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
        $drivePath = $driveLetter + ':'
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
Write-Host "  For Ubuntu 24.04 LTS Autoinstall (LAB-Magentic-UI-00)" -ForegroundColor Blue
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
    Write-Error 'oscdimg.exe not found. Install Windows ADK (Deployment Tools).'
    exit 1
}

New-IsoWithOscdimg -OscdimgPath $toolPath -Source $SourceDir -Destination $OutputPath -Label $VolumeLabel
Test-IsoContent -IsoPath $OutputPath
