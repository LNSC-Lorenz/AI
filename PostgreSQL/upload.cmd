@echo off
chcp 65001 >nul
echo ==========================================
echo   一键上传脚本到 Ubuntu 服务器
echo ==========================================
echo.

set SERVER_IP=10.86.180.71
set USERNAME=sysadmin
set REMOTE_PATH=~/

echo 服务器: %SERVER_IP%
echo 用户:   %USERNAME%
echo.
echo ==========================================
echo.

for %%f in (hardening.sh ubuntu-init.sh postgresql-install.sh verify.sh) do (
    if exist "%%f" (
        echo [上传] %%f ...
        scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null "%%f" %USERNAME%@%SERVER_IP%:%REMOTE_PATH%
        if errorlevel 1 (
            echo [失败] %%f
        ) else (
            echo [OK] %%f
        )
    ) else (
        echo [跳过] %%f ^(不存在^)
    )
)

echo.
echo ==========================================
echo   上传完成！
echo ==========================================
echo.
echo 登录服务器:
echo   ssh %USERNAME%@%SERVER_IP%
echo   密码: ChangeMe2026
echo.
echo 执行加固和安装:
echo   # 方案A - 标准优化:
echo   sudo bash ubuntu-init.sh ^&^& sudo bash postgresql-install.sh
echo.
echo   # 方案B - CIS安全加固:
echo   sudo bash hardening.sh ^&^& sudo reboot
echo   # 重启后:
echo   sudo bash postgresql-install.sh
echo.
pause
