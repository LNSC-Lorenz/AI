@echo off
REM ============================================================
REM  Install Prefect Worker on lcnnsc-rpa-w01
REM  Right-click -> Run as administrator
REM ============================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Please right-click and "Run as administrator"
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-windows-agent.ps1" ^
    -PrefectApiUrl "http://10.86.180.120:4200/api" ^
    -WorkPoolName "windows-rpa-pool" ^
    -WorkerName "lcnnsc-rpa-w01"

pause
