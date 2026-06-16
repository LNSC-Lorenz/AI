#Requires -Version 5.1
<#
.SYNOPSIS
    Magentic-UI 分步安装脚本 - Windows Server 2022 版

.DESCRIPTION
    将部署流程拆分为独立步骤，每步执行前会提示确认。
    适配 Windows Server 2022（无 Docker Desktop，使用 Docker Engine + WSL2）。
    可通过 -Step 参数直接跳转到指定步骤。

.PARAMETER Step
    指定从哪一步开始执行 (-1 到 7)，默认从 Step -1 开始

.PARAMETER SkipConfirm
    跳过每步的确认提示，自动执行所有步骤

.EXAMPLE
    .\install-steps-server2022.ps1               # 从头开始逐步执行
    .\install-steps-server2022.ps1 -Step 3       # 从 Step 3 开始
    .\install-steps-server2022.ps1 -SkipConfirm  # 全自动执行所有步骤
#>

param(
    [int]$Step = -1,
    [switch]$SkipConfirm
)

# ============================================================
# 用户配置区 - 请根据实际环境修改
# ============================================================

$OLLAMA_HOST         = "http://10.87.5.55:11434"
$ORCHESTRATOR_MODEL  = "batiai/fara-7b:q5"
$BROWSER_MODEL       = "batiai/fara-7b:q5"
$MAGENTIC_PORT       = 8081
$WSL_USER            = "mguser"
$WSL_PASS            = "Magentic@2025"

# ============================================================
# 辅助函数
# ============================================================

$ErrorActionPreference = "Continue"

# 确保控制台 UTF-8，中文正常显示
chcp 65001 | Out-Null
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step {
    param([int]$Num, [string]$Title)
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  Step $Num : $Title" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
}

function Write-OK   { param([string]$Msg) Write-Host "  [OK]   $Msg" -ForegroundColor Green }
function Write-WARN { param([string]$Msg) Write-Host "  [WARN] $Msg" -ForegroundColor Yellow }
function Write-FAIL { param([string]$Msg) Write-Host "  [FAIL] $Msg" -ForegroundColor Red }
function Write-INFO { param([string]$Msg) Write-Host "  [INFO] $Msg" -ForegroundColor Gray }

function Confirm-Continue {
    param([string]$StepName)
    if ($SkipConfirm) { return }
    Write-Host ""
    $ans = Read-Host ">>> 继续执行 [$StepName]? (Enter=是 / n=跳过 / q=退出)"
    if ($ans -eq "q") { Write-Host "已退出。" -ForegroundColor Yellow; exit 0 }
    if ($ans -eq "n") { Write-Host "已跳过该步骤。" -ForegroundColor Yellow; return $false }
    return $true
}

function Run-WSL {
    param([string]$BashCmd)
    wsl bash -c $BashCmd
    return $LASTEXITCODE
}

# ============================================================
# 步骤定义
# ============================================================

# ----------------------------------------------------------
# Step -2: 准备环境（卸载旧 Ubuntu / 更新 PowerShell / 安装 Ubuntu 24.04）
# ----------------------------------------------------------
function Step-Neg2 {
    Write-Step -2 "准备环境（卸载旧 Ubuntu / 更新 PowerShell / 安装 Ubuntu 24.04）"
    Write-INFO "本步骤将完成："
    Write-INFO "  [-2a] 卸载旧 Ubuntu 22.04 WSL 发行版"
    Write-INFO "  [-2b] 更新 PowerShell 到最新版本（7.x）"
    Write-INFO "  [-2c] 安装 Ubuntu 24.04（支持 GLIBC 2.38，quicksand 沙箱必需）"
    Write-Host ""

    if ((Confirm-Continue "Step -2") -eq $false) { return }

    # ── [-2a] 卸载旧 Ubuntu 22.04 ──────────────────────────────────
    Write-Host ""
    Write-Host "  [-2a] 检查并卸载旧 Ubuntu 22.04..." -ForegroundColor Cyan
    $oldDistros = wsl --list --quiet 2>&1 | Where-Object { $_ -match "Ubuntu" -and $_ -notmatch "24" }
    if ($oldDistros) {
        foreach ($d in $oldDistros) {
            $dname = ($d -replace "\s","").Trim()
            if ($dname) {
                Write-INFO "卸载: $dname"
                wsl --unregister $dname 2>&1 | Out-Null
                Write-OK "已卸载: $dname"
            }
        }
    } else {
        Write-OK "未发现旧版 Ubuntu 22.04，跳过"
    }
    $oldPkg = Get-AppxPackage -Name "CanonicalGroupLimited.Ubuntu" -ErrorAction SilentlyContinue
    if ($oldPkg -and $oldPkg.Name -notmatch "2404") {
        Write-INFO "卸载旧 Ubuntu AppxPackage: $($oldPkg.Name)"
        Remove-AppxPackage $oldPkg.PackageFullName -ErrorAction SilentlyContinue
        Write-OK "旧 Ubuntu AppxPackage 已卸载"
    }

    # ── [-2b] 更新 PowerShell 到 7.x ──────────────────────────────
    Write-Host ""
    Write-Host "  [-2b] 检查 PowerShell 版本..." -ForegroundColor Cyan
    $psVer = $PSVersionTable.PSVersion
    Write-INFO "当前版本: $($psVer.Major).$($psVer.Minor)"
    if ($psVer.Major -ge 7) {
        Write-OK "PowerShell $($psVer.Major).$($psVer.Minor) 已是最新"
    } else {
        Write-INFO "正在下载安装 PowerShell 7.x..."
        $dlDir = "$env:USERPROFILE\Downloads\magentic-ui-deps"
        New-Item -ItemType Directory -Force -Path $dlDir | Out-Null
        $ps7Path = "$dlDir\PowerShell-7-win-x64.msi"
        if (-not (Test-Path $ps7Path)) {
            Invoke-WebRequest -Uri "https://github.com/PowerShell/PowerShell/releases/download/v7.4.6/PowerShell-7.4.6-win-x64.msi" -OutFile $ps7Path -UseBasicParsing
        } else { Write-OK "PowerShell 安装包已存在，跳过下载" }
        Start-Process msiexec.exe -ArgumentList "/i `"$ps7Path`" /quiet /norestart ADD_EXPLORER_CONTEXT_MENU_OPENPOWERSHELL=1 ENABLE_PSREMOTING=1" -Wait
        Write-OK "PowerShell 7.x 安装完成"
        Write-WARN "请关闭此窗口，用 pwsh.exe 重新运行: pwsh.exe -File .\install-steps-server2022.ps1 -Step -1"
        return
    }

    # ── [-2c] 安装 Ubuntu 24.04 ────────────────────────────────────
    Write-Host ""
    Write-Host "  [-2c] 安装 Ubuntu 24.04..." -ForegroundColor Cyan
    $already = (wsl --list --quiet 2>&1 | Out-String) -match "Ubuntu-24|Ubuntu24"
    if ($already) {
        Write-OK "Ubuntu 24.04 已安装并注册"
    } else {
        Write-INFO "使用 wsl --install 安装 Ubuntu-24.04（需要联网）..."
        wsl --set-default-version 2
        wsl --install -d Ubuntu-24.04 --no-launch
        if ($LASTEXITCODE -ne 0) {
            Write-FAIL "wsl --install 失败，请手动执行: wsl --install -d Ubuntu-24.04"
            return
        }
        Write-OK "Ubuntu 24.04 安装完成"
    }

    $registered = (wsl --list --quiet 2>&1 | Out-String) -match "Ubuntu-24|Ubuntu24"
    if ($registered) {
        Write-OK "Ubuntu 24.04 已注册为 WSL 发行版"
        wsl --set-default Ubuntu-24.04 2>&1 | Out-Null
        Write-OK "已设为默认 WSL 发行版"
    } else {
        Write-WARN "Ubuntu 24.04 尚未初始化，请在新窗口完成首次初始化："
        Write-Host ""
        Write-Host "    wsl -d Ubuntu-24.04" -ForegroundColor Cyan
        Write-Host "    输入用户名(wsluser)和密码(wsluser)后输入 exit" -ForegroundColor Yellow
        Write-Host "    然后重新运行: .\install-steps-server2022.ps1 -Step 1 -SkipConfirm" -ForegroundColor Yellow
    }
}

# ----------------------------------------------------------
# Step -1: 检查系统环境（管理员权限 / Windows Server 2022 / Hyper-V）
# ----------------------------------------------------------
function Step-Neg1 {
    Write-Step -1 "检查系统环境（管理员权限 / OS 版本 / Hyper-V）"

    if ((Confirm-Continue "Step -1") -eq $false) { return }

    # 检查管理员权限
    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($isAdmin) {
        Write-OK "当前以管理员身份运行"
    } else {
        Write-FAIL "需要管理员权限！"
        Write-INFO "请右键 PowerShell > 以管理员身份运行，再重新执行本脚本"
        exit 1
    }

    # 检查 OS 版本
    $os = Get-CimInstance Win32_OperatingSystem
    Write-INFO "操作系统 : $($os.Caption)"
    Write-INFO "版本号   : $($os.Version)"
    Write-INFO "架构     : $($os.OSArchitecture)"
    if ($os.Caption -match "Server 2022") {
        Write-OK "检测到 Windows Server 2022"
    } elseif ($os.Caption -match "Server") {
        Write-WARN "检测到 Windows Server（非 2022），脚本已针对 2022 测试，其他版本请谨慎"
    } else {
        Write-WARN "非 Windows Server 系统，部分步骤可能不适用"
    }

    # Windows Server 2022 上 Hyper-V / Containers 是服务器角色，用 Install-WindowsFeature 检查
    Write-INFO "检查 Hyper-V 角色状态（服务器角色，非可选功能）..."
    $hv = Get-WindowsFeature -Name Hyper-V -ErrorAction SilentlyContinue
    if ($hv -and $hv.InstallState -eq "Installed") {
        Write-OK "Hyper-V 已安装"
    } else {
        Write-WARN "Hyper-V 未安装（WSL2 和 Docker 均依赖 Hyper-V）"
        Write-INFO "修复: Install-WindowsFeature -Name Hyper-V -IncludeAllSubFeature -IncludeManagementTools"
    }

    # 检查 Containers 角色
    $containers = Get-WindowsFeature -Name Containers -ErrorAction SilentlyContinue
    if ($containers -and $containers.InstallState -eq "Installed") {
        Write-OK "Containers 角色已安装"
    } else {
        Write-WARN "Containers 角色未安装（Docker Engine 必需）"
        Write-INFO "修复: Install-WindowsFeature -Name Containers"
    }

    # 检查 WSL 可选功能（用对象属性检测，不受系统语言影响）
    Write-INFO "检查 WSL Linux 子系统功能..."
    $wslFeatureObj = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
    if ($wslFeatureObj -and $wslFeatureObj.State -eq "Enabled") {
        Write-OK "WSL Linux 子系统功能已启用"
    } else {
        Write-WARN "WSL Linux 子系统功能未启用"
        Write-INFO "修复: dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart"
    }

    # 检查 WSL2 内核是否就绪
    Write-INFO "检查 WSL2 内核状态..."
    $wslStatus = wsl --status 2>&1 | Out-String
    if ($wslStatus -match "找不到WSL 2内核|cannot find the WSL 2 kernel|kernel file") {
        Write-WARN "WSL2 内核文件缺失！"
        Write-Host "  方案一（联网）: wsl --update" -ForegroundColor Yellow
        Write-Host "  方案二（离线）: 下载 https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi" -ForegroundColor Yellow
        Write-WARN "修复完成后请重新运行 Step -1 验证"
    } else {
        Write-OK "WSL2 内核正常"
    }

    # 检查 WSL 版本，确保支持 wsl --install -d
    Write-INFO "检查 WSL 版本（需要 1.0+ 才支持 wsl --install -d Ubuntu-24.04）..."
    $wslVer = wsl --version 2>&1 | Out-String
    $needUpdate = $wslVer -match "找不到|not found|无法" -or $wslVer -notmatch "\d+\.\d+"
    if (-not $needUpdate) {
        # 提取主版本号
        $verLine = ($wslVer -split "`n" | Where-Object { $_ -match "WSL \d|版本" } | Select-Object -First 1)
        Write-OK "WSL 版本: $($verLine.Trim())"
    } else {
        Write-WARN "WSL 版本过旧，不支持 wsl --install -d，开始自动更新..."
        $dlDir = "$env:USERPROFILE\Downloads\magentic-ui-deps"
        New-Item -ItemType Directory -Force -Path $dlDir | Out-Null
        $wslMsi = "$dlDir\wsl-update.msi"
        if (-not (Test-Path $wslMsi)) {
            Write-INFO "下载 WSL 更新包..."
            Invoke-WebRequest -Uri "https://github.com/microsoft/WSL/releases/download/2.4.13/wsl.2.4.13.0.x64.msi" -OutFile $wslMsi -UseBasicParsing
        } else { Write-OK "WSL 更新包已存在，跳过下载" }
        Start-Process msiexec.exe -ArgumentList "/i `"$wslMsi`" /quiet /norestart" -Wait
        Write-OK "WSL 更新完成，请关闭并重新打开 PowerShell 后重新运行: .\install-steps-server2022.ps1 -Step -1"
        return
    }

    Write-Host ""
    Write-INFO "若以上功能有未安装/未启用项，请一次性执行以下命令后重启:"
    Write-Host "    Install-WindowsFeature -Name Hyper-V,Containers -IncludeAllSubFeature -IncludeManagementTools" -ForegroundColor Cyan
    Write-Host "    dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart" -ForegroundColor Cyan
    Write-Host "    Restart-Computer -Force" -ForegroundColor Cyan
}

# ----------------------------------------------------------
# Step 0: 验证 DGX Spark Ollama 连接
# ----------------------------------------------------------
function Step-0 {
    Write-Step 0 "验证 DGX Spark Ollama 连接"
    Write-INFO "目标: $OLLAMA_HOST/api/tags"

    if ((Confirm-Continue "Step 0") -eq $false) { return }

    try {
        $response = Invoke-RestMethod -Uri "$OLLAMA_HOST/api/tags" -Method Get -TimeoutSec 10
        Write-OK "Ollama 连接成功，已加载模型："
        foreach ($model in $response.models) {
            Write-Host "       - $($model.name)" -ForegroundColor Yellow
        }
        # 检查所需模型是否存在
        $names = $response.models | ForEach-Object { $_.name }
        if ($names -contains $ORCHESTRATOR_MODEL) {
            Write-OK "编排器模型 [$ORCHESTRATOR_MODEL] 存在"
        } else {
            Write-WARN "编排器模型 [$ORCHESTRATOR_MODEL] 未找到，请在 DGX Spark 执行: ollama pull $ORCHESTRATOR_MODEL"
        }
        if ($names -contains $BROWSER_MODEL) {
            Write-OK "浏览器模型 [$BROWSER_MODEL] 存在"
        } else {
            Write-WARN "浏览器模型 [$BROWSER_MODEL] 未找到，请在 DGX Spark 执行: ollama pull $BROWSER_MODEL"
        }
    } catch {
        Write-FAIL "无法连接 $OLLAMA_HOST"
        Write-INFO "排查建议："
        Write-INFO "  1. 确认 DGX Spark IP 正确"
        Write-INFO "  2. DGX Spark 上执行: export OLLAMA_HOST=0.0.0.0 && ollama serve"
        Write-INFO "  3. 防火墙放行 11434 端口"
        Write-INFO "  4. Windows 执行: Test-NetConnection 10.87.5.55 -Port 11434"
    }
}

# ----------------------------------------------------------
# Step 1: 检查 / 启用 WSL2（Windows Server 2022 方式）
# ----------------------------------------------------------
function Step-1 {
    Write-Step 1 "检查 / 启用 WSL2（Windows Server 2022）"

    Write-Host "  本步骤将依次完成以下工作：" -ForegroundColor Cyan
    Write-Host "    [1a] 检查 WSL Linux 子系统功能是否已启用" -ForegroundColor Gray
    Write-Host "    [1b] 检查 Ubuntu 24.04 是否已安装（AppxPackage）" -ForegroundColor Gray
    Write-Host "    [1c] 检查 Ubuntu 是否已完成首次初始化（注册为 WSL 发行版）" -ForegroundColor Gray
    Write-Host "    [1d] 创建专用账户 $WSL_USER 并验证 WSL2 可用" -ForegroundColor Gray
    Write-Host ""

    if ((Confirm-Continue "Step 1") -eq $false) { return }

    # ── [1a] WSL 功能是否启用 ──────────────────────────────────────
    Write-Host ""
    Write-Host "  [1a] 检查 WSL Linux 子系统功能..." -ForegroundColor Cyan
    $wslFeatureObj = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
    if ($wslFeatureObj -and $wslFeatureObj.State -eq "Enabled") {
        Write-OK "WSL Linux 子系统功能已启用"
    } else {
        Write-WARN "WSL 功能未启用，正在启用（需要管理员权限）..."
        dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
        if ($LASTEXITCODE -eq 0) {
            Write-WARN "WSL 功能已启用 → 必须重启才能继续后续步骤"
            Write-Host ""
            Write-Host "  ★ 请选择操作：" -ForegroundColor Yellow
            Write-Host "    y = 立即重启服务器（重启后重新执行本脚本 -Step 1）" -ForegroundColor Yellow
            Write-Host "    N = 稍后手动重启（重启后执行: .\install-steps-server2022.ps1 -Step 1）" -ForegroundColor Yellow
            $doRestart = Read-Host "是否立即重启? (y/N)"
            if ($doRestart -eq "y") { Restart-Computer -Force }
        } else {
            Write-FAIL "WSL 功能启用失败！"
            Write-Host "  排查步骤：" -ForegroundColor Yellow
            Write-Host "    1. 确认以管理员身份运行 PowerShell" -ForegroundColor Gray
            Write-Host "    2. 手动执行: dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart" -ForegroundColor Gray
            Write-Host "    3. 检查 DISM 日志: C:\Windows\Logs\DISM\dism.log" -ForegroundColor Gray
        }
        exit 0
    }

    # ── [1b] 安装 Ubuntu 24.04 ───────────────────────────────────────
    Write-Host ""
    Write-Host "  [1b] 安装 Ubuntu 24.04..." -ForegroundColor Cyan
    $alreadyInstalled = (wsl --list --quiet 2>&1 | Out-String) -match "Ubuntu-24|Ubuntu24"
    if ($alreadyInstalled) {
        Write-OK "Ubuntu 24.04 已安装"
    } else {
        Write-INFO "正在安装 Ubuntu-24.04（需要联网）..."
        wsl --set-default-version 2
        wsl --install -d Ubuntu-24.04 --no-launch
        if ($LASTEXITCODE -ne 0) {
            Write-FAIL "Ubuntu-24.04 安装失败！"
            Write-Host "  手动执行: wsl --install -d Ubuntu-24.04" -ForegroundColor Yellow
            return
        }
        Write-OK "Ubuntu 24.04 安装完成"
    }

    # ── [1c] Ubuntu 24.04 首次初始化 ──────────────────────────────────
    Write-Host ""
    Write-Host "  [1c] 检查 Ubuntu 24.04 是否已注册为 WSL 发行版..." -ForegroundColor Cyan
    $wslDistros = wsl --list 2>&1
    $isRegistered = ($wslDistros | Out-String) -match "Ubuntu-24|Ubuntu24"

    if (-not $isRegistered) {
        Write-WARN "Ubuntu 24.04 尚未初始化，需要首次设置用户名和密码"
        Write-Host ""
        Write-Host "  ★ 首次初始化说明：" -ForegroundColor Yellow
        Write-Host "    - 出现 'Enter new UNIX username:' 时，输入 wsluser 回车" -ForegroundColor Gray
        Write-Host "    - 出现 'New password:' 时，输入 wsluser 回车" -ForegroundColor Gray
        Write-Host "    - 看到 '\$' 提示符后，输入 exit 回车" -ForegroundColor Gray
        Write-Host ""
        $ubuntuExe = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WindowsApps" -Filter "ubuntu2404*" -ErrorAction SilentlyContinue |
                     Sort-Object Name | Select-Object -First 1
        $ubuntuExePath = if ($ubuntuExe) { $ubuntuExe.FullName } else { "ubuntu2404.exe" }
        Write-INFO "Ubuntu 路径: $ubuntuExePath"

        Write-Host ""
        Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host "  ★ 即将在本窗口内启动 Ubuntu 初始化（交互式）" -ForegroundColor Yellow
        Write-Host "  ★ 操作步骤：" -ForegroundColor Yellow
        Write-Host "     1. 出现 'Enter new UNIX username:' → 输入 wsluser 回车" -ForegroundColor Cyan
        Write-Host "     2. 出现 'New password:'           → 输入 wsluser 回车（不显示字符正常）" -ForegroundColor Cyan
        Write-Host "     3. 出现 'Retype new password:'   → 再输入 wsluser 回车" -ForegroundColor Cyan
        Write-Host "     4. 看到 wsluser@... \$ 提示符    → 输入 exit   回车" -ForegroundColor Cyan
        Write-Host "  ════════════════════════════════════════════════════" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  请手动打开一个新的 PowerShell 或 CMD 窗口，执行以下命令：" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "      wsl --install -d Ubuntu --no-launch" -ForegroundColor Cyan
        Write-Host "      wsl -d Ubuntu" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  或者直接双击运行：" -ForegroundColor Yellow
        Write-Host "      $ubuntuExePath" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "  完成用户名/密码设置后输入 exit 退出，然后回到此窗口按 Enter 继续" -ForegroundColor Yellow
        Write-Host ""

        # 尝试用 cmd start 开新窗口（不阻塞当前会话）
        try {
            cmd /c start "" "$ubuntuExePath" 2>$null
            Write-INFO "已尝试打开 Ubuntu 窗口，请在新窗口完成初始化后回来..."
        } catch {
            Write-WARN "无法自动打开窗口，请手动执行上方命令"
        }

        Read-Host "  完成初始化后按 Enter 继续..."

        Write-Host ""
        Write-INFO "验证注册状态..."

        # 验证注册是否成功
        Start-Sleep -Seconds 2
        $wslDistros2 = wsl --list 2>&1
        if (($wslDistros2 | Out-String) -notmatch "Ubuntu") {
            Write-FAIL "Ubuntu 初始化后仍未注册！"
            Write-Host ""
            Write-Host "  可能原因及处理：" -ForegroundColor Yellow
            Write-Host "    A. 初始化未完成 → 手动运行: & '$ubuntuExePath'" -ForegroundColor Gray
            Write-Host "       完成用户名/密码设置后输入 exit，再重跑 -Step 1" -ForegroundColor Gray
            Write-Host "    B. WSL2 内核未安装 → 下载安装: https://aka.ms/wsl2kernel" -ForegroundColor Gray
            Write-Host "       安装后重启，再重跑 -Step 1" -ForegroundColor Gray
            Write-Host "    C. 手动确认当前状态: wsl --list --verbose" -ForegroundColor Gray
            return
        }
        Write-OK "Ubuntu 已成功注册为 WSL 发行版"
    } else {
        Write-OK "Ubuntu 已注册为 WSL 发行版"
        $wslDistros | ForEach-Object { if ($_ -match "\S") { Write-INFO "  $_" } }
    }

    # ── [1d] 创建专用账户并验证 WSL2 可用 ─────────────────────────
    Write-Host ""
    Write-Host "  [1d] 配置专用账户 $WSL_USER 并验证 WSL2..." -ForegroundColor Cyan

    $wslUser = $WSL_USER
    $wslPass = $WSL_PASS

    Write-INFO "在 Ubuntu 中创建账户 $wslUser（已存在则跳过）..."
    # 直接用 /tmp 临时文件，不做 Windows↔Linux 路径转换
    $initCmd = "id $wslUser >/dev/null 2>&1 && echo USER_EXISTS || (useradd -m -s /bin/bash $wslUser && usermod -aG sudo $wslUser && echo USER_CREATED); echo '${wslUser}:${wslPass}' | chpasswd; printf '[user]\ndefault=$wslUser\n' > /etc/wsl.conf && echo CONFIG_DONE"
    wsl -d Ubuntu -u root -- bash -c "$initCmd > /tmp/wsl_init_result.txt 2>&1"
    $initResult = wsl -d Ubuntu -u root -- bash -c "cat /tmp/wsl_init_result.txt"

    if ($initResult -match "USER_EXISTS") { Write-OK "账户 $wslUser 已存在" }
    elseif ($initResult -match "USER_CREATED") { Write-OK "账户 $wslUser 创建成功" }
    else {
        wsl -d Ubuntu -u root -- bash -c "id $wslUser" >$null 2>&1
        if ($LASTEXITCODE -eq 0) { Write-OK "账户 $wslUser 已存在（id验证通过）" }
        else { Write-WARN "账户状态未知" }
    }

    if ($initResult -match "CONFIG_DONE") {
        Write-OK "wsl.conf 配置完成"
    } else {
        wsl -d Ubuntu -u root -- bash -c "printf '[user]\ndefault=$wslUser\n' > /etc/wsl.conf"
        if ($LASTEXITCODE -eq 0) { Write-OK "wsl.conf 补充写入完成" }
        else { Write-WARN "wsl.conf 写入失败，请手动执行: wsl -d Ubuntu -u root -- bash -c `"printf '[user]\ndefault=$wslUser\n' > /etc/wsl.conf`"" }
    }
    wsl --terminate Ubuntu 2>&1 | Out-Null
    Start-Sleep -Seconds 5

    # 预测试：验证 WSL2 实际可用（用退出码，不依赖字符串匹配）
    Write-INFO "预测试：验证 WSL2 可执行命令..."
    wsl -d Ubuntu -- bash -c "exit 0" 2>$null
    if ($LASTEXITCODE -eq 0) {
        wsl -d Ubuntu -- bash -c "whoami" 2>$null
        Write-OK "WSL2 预测试通过（退出码 0）"
    } else {
        Write-WARN "WSL2 预测试失败（退出码: $LASTEXITCODE）"
        Write-INFO "手动验证: wsl -d Ubuntu -- bash -c 'echo ok && whoami'"
    }

    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host "  ║  Ubuntu WSL2 账户信息（请妥善保存）          ║" -ForegroundColor Green
    Write-Host "  ║  用户名: $wslUser                            ║" -ForegroundColor Green
    Write-Host "  ║  密  码: $wslPass                        ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
}

# ----------------------------------------------------------
# Step 1fix: 修复 wsl.conf 默认用户 + 预测试（-Step 15）
# ----------------------------------------------------------
function Step-1fix {
    Write-Step 15 "修复 WSL2 wsl.conf 默认用户 + 预测试"

    if ((Confirm-Continue "Step 1fix") -eq $false) { return }

    $wslUser = $WSL_USER

    Write-INFO "写入 /etc/wsl.conf 默认用户: $wslUser"
    wsl -d Ubuntu -u root -- bash -c "printf '[user]\ndefault=$wslUser\n' > /etc/wsl.conf"
    if ($LASTEXITCODE -eq 0) { Write-OK "wsl.conf 写入成功" }
    else { Write-FAIL "wsl.conf 写入失败" ; return }

    Write-INFO "验证 wsl.conf 内容:"
    wsl -d Ubuntu -u root -- bash -c "cat /etc/wsl.conf" | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

    Write-INFO "重启 WSL..."
    wsl --terminate Ubuntu
    Start-Sleep -Seconds 2

    Write-INFO "预测试: echo ok && whoami"
    $r1 = wsl -d Ubuntu -- bash -c "echo ok"
    $r2 = wsl -d Ubuntu -- bash -c "whoami"
    if ($r1 -match "ok") { Write-OK "WSL2 响应正常" } else { Write-FAIL "WSL2 无响应" }
    if ($r2 -match $wslUser) { Write-OK "默认用户正确: $r2" }
    else { Write-WARN "当前用户: $r2（期望: $wslUser）" }
}

# ----------------------------------------------------------
# Step 2: 检查 / 安装 Docker Engine（Windows Server 2022 无 Docker Desktop）
# ----------------------------------------------------------
function Step-2 {
    Write-Step 2 "检查 / 安装 Docker Engine（Windows Server 2022）"
    Write-INFO "Windows Server 2022 使用 Docker Engine，不使用 Docker Desktop"
    Write-INFO "Docker Engine 将在 WSL2 (Ubuntu) 内部安装和运行"

    if ((Confirm-Continue "Step 2") -eq $false) { return }

    # 先检查 WSL2 是否可用（用退出码，不依赖字符串匹配）
    wsl -d Ubuntu -- bash -c "exit 0" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-FAIL "WSL2 Ubuntu 未就绪（退出码: $LASTEXITCODE），请先完成 Step 1"
        Write-INFO "调试: wsl -d Ubuntu -- bash -c 'echo ok'"
        return
    }
    Write-OK "WSL2 Ubuntu 可用"

    # 检查 WSL 内是否已有 Docker
    $dockerInWSL = wsl bash -c "docker --version 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-OK "WSL2 内 Docker 已安装: $dockerInWSL"
        $dockerRunning = wsl bash -c "docker info 2>&1 | head -1"
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Docker daemon 运行中"
        } else {
            Write-WARN "Docker 已安装但 daemon 未运行"
            Write-INFO "在 WSL2 中启动 Docker: sudo service docker start"
            $doStart = Read-Host "是否立即启动 Docker daemon? (y/N)"
            if ($doStart -eq "y") {
                wsl bash -c "sudo service docker start"
                Write-OK "Docker daemon 已启动"
            }
        }
        return
    }

    Write-WARN "WSL2 内未检测到 Docker，开始安装 Docker Engine..."

    $dockerInstallScript = @'
set -e
echo ">>> 更新 apt 源..."
sudo apt-get update -qq
sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release

echo ">>> 添加 Docker GPG 密钥..."
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo ">>> 添加 Docker apt 源..."
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

echo ">>> 安装 Docker Engine..."
sudo apt-get update -qq
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

echo ">>> 启动 Docker daemon..."
sudo service docker start

echo ">>> 将当前用户加入 docker 组..."
sudo usermod -aG docker $USER

echo ">>> 验证安装..."
docker --version

echo ">>> [DONE]"
'@

    # 写到 Windows C:\Temp（路径简单无空格），WSL 通过 /mnt/c/Temp 访问
    $winTmp = "C:\Temp"
    New-Item -ItemType Directory -Force -Path $winTmp | Out-Null
    $winScript = "$winTmp\step2-docker.sh"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($winScript, ($dockerInstallScript -replace "`r`n", "`n" -replace "`r", "`n"), $utf8NoBom)
    Write-INFO "脚本已写入 $winScript，通过 /mnt/c/Temp/step2-docker.sh 执行..."
    wsl -d Ubuntu -- bash /mnt/c/Temp/step2-docker.sh

    if ($LASTEXITCODE -eq 0) {
        Write-OK "Docker Engine 安装完成"
        Write-WARN "注意：需要重新登录 WSL2 使 docker 组权限生效"
        Write-INFO "或者临时用 sudo: wsl bash -c 'sudo docker info'"
    } else {
        Write-FAIL "Docker Engine 安装失败，退出码: $LASTEXITCODE"
        Write-INFO "排查建议："
        Write-INFO "  1. 进入 WSL2: wsl"
        Write-INFO "  2. 手动执行 Docker 官方安装命令"
        Write-INFO "  3. 参考: https://docs.docker.com/engine/install/ubuntu/"
    }
}

# ----------------------------------------------------------
# Step 3: 在 WSL2 中检查 Python 3.12
# ----------------------------------------------------------
function Step-3 {
    Write-Step 3 "在 WSL2 中检查 / 安装 Python 3.12"

    if ((Confirm-Continue "Step 3") -eq $false) { return }

    $pyVer = Run-WSL "python3.12 --version 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python 3.12 已安装"
    } else {
        Write-WARN "Python 3.12 未找到，开始安装（加入 deadsnakes PPA）..."
        $s3 = "export DEBIAN_FRONTEND=noninteractive`napt-get install -y software-properties-common`nadd-apt-repository -y ppa:deadsnakes/ppa`napt-get update -qq`napt-get install -y python3.12 python3.12-venv curl"
        $t3 = "$env:TEMP\step3-python.sh"
        [System.IO.File]::WriteAllText($t3, ($s3 -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding $false))
        $p3 = "/mnt/c/" + ($t3 -replace 'C:\\','') -replace '\\','/'
        wsl -u root bash $p3
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Python 3.12 安装成功"
        } else {
            Write-FAIL "Python 3.12 安装失败，请手动在 WSL2 中执行:"
            Write-INFO "  sudo add-apt-repository -y ppa:deadsnakes/ppa"
            Write-INFO "  sudo apt-get update && sudo apt-get install -y python3.12 python3.12-venv"
        }
    }
}

# ----------------------------------------------------------
# Step 4: 在 WSL2 中检查 / 安装 uv
# ----------------------------------------------------------
function Step-4 {
    Write-Step 4 "在 WSL2 中检查 / 安装 uv (Python 包管理器)"

    if ((Confirm-Continue "Step 4") -eq $false) { return }

    $s4check = 'export PATH="$HOME/.local/bin:$PATH" && uv --version'
    $t4check = "$env:TEMP\step4-check.sh"
    [System.IO.File]::WriteAllText($t4check, ($s4check -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding $false))
    $p4check = "/mnt/c/" + ($t4check -replace 'C:\\','') -replace '\\','/'
    wsl bash $p4check 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-OK "uv 已安装"
    } else {
        Write-WARN "uv 未找到，开始安装..."
        $s4 = "curl -LsSf https://astral.sh/uv/install.sh | sh"
        $t4 = "$env:TEMP\step4-uv.sh"
        [System.IO.File]::WriteAllText($t4, ($s4 -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding $false))
        $p4 = "/mnt/c/" + ($t4 -replace 'C:\\','') -replace '\\','/'
        wsl bash $p4
        if ($LASTEXITCODE -eq 0) {
            Write-OK "uv 安装成功"
            Write-INFO "已添加到 ~/.local/bin，新终端中自动生效"
        } else {
            Write-FAIL "uv 安装失败，请手动在 WSL2 中执行:"
            Write-INFO "  curl -LsSf https://astral.sh/uv/install.sh | sh"
        }
    }
}

# ----------------------------------------------------------
# Step 5: 在 WSL2 中创建虚拟环境并安装 magentic-ui
# ----------------------------------------------------------
function Step-5 {
    Write-Step 5 "在 WSL2 中安装 magentic-ui"
    Write-INFO "安装目录: ~/magentic-lite"

    if ((Confirm-Continue "Step 5") -eq $false) { return }

    $installScript = @'
set -e
export PATH="$HOME/.local/bin:$PATH"
PROJECT_DIR="$HOME/magentic-lite"
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

echo ">>> 创建 Python 3.12 虚拟环境..."
if [ ! -f ".venv/bin/activate" ]; then
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate

echo ">>> 安装 magentic_ui[ollama]..."
uv pip install "magentic_ui[ollama]>=0.2.0"

echo ">>> 验证安装..."
magentic-ui --version 2>&1 || python -m magentic_ui --version 2>&1

echo ">>> [DONE]"
'@

    New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText("C:\Temp\step5-install.sh", ($installScript -replace "`r`n", "`n" -replace "`r", "`n"), $utf8NoBom)
    wsl -d Ubuntu -- bash /mnt/c/Temp/step5-install.sh

    if ($LASTEXITCODE -eq 0) {
        Write-OK "magentic-ui 安装完成"
    } else {
        Write-FAIL "安装失败，退出码: $LASTEXITCODE"
        Write-INFO "排查建议："
        Write-INFO "  1. 进入 WSL2: wsl"
        Write-INFO "  2. 手动执行: cd ~/magentic-lite && source .venv/bin/activate"
        Write-INFO "  3. 再执行: uv pip install 'magentic_ui[ollama]>=0.2.0'"
    }
}

# ----------------------------------------------------------
# Step 6: 生成 config.yaml
# ----------------------------------------------------------
function Step-6 {
    Write-Step 6 "生成 Magentic-UI 配置文件 (config.yaml)"
    Write-INFO "编排器模型 : $ORCHESTRATOR_MODEL"
    Write-INFO "浏览器模型 : $BROWSER_MODEL"
    Write-INFO "Ollama     : $OLLAMA_HOST/v1"
    Write-INFO "沙箱       : null (直接在 WSL2 内执行，不启动 QEMU VM)"

    if ((Confirm-Continue "Step 6") -eq $false) { return }

    $OLLAMA_V1 = "$OLLAMA_HOST/v1"

    $configYaml = @"
model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: $ORCHESTRATOR_MODEL
      base_url: $OLLAMA_V1
      api_key: "ollama"
      max_retries: 5
      timeout: 300
      model_info:
        vision: true
        function_calling: false
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

  web_surfer:
    provider: OpenAIChatCompletionClient
    config:
      model: $BROWSER_MODEL
      base_url: $OLLAMA_V1
      api_key: "ollama"
      max_retries: 5
      timeout: 300
      model_info:
        vision: true
        function_calling: false
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

sandbox:
  type: "null"

agent_mode: all
"@

    $writeScript = "mkdir -p `$HOME/magentic-lite && cat > `$HOME/magentic-lite/config.yaml << 'ENDOFCONFIG'`n$configYaml`nENDOFCONFIG"

    New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText("C:\Temp\step6-config.sh", ($writeScript -replace "`r`n", "`n" -replace "`r", "`n"), $utf8NoBom)
    wsl -d Ubuntu -- bash /mnt/c/Temp/step6-config.sh

    if ($LASTEXITCODE -eq 0) {
        Write-OK "config.yaml 已写入 ~/magentic-lite/config.yaml"
        Write-INFO "验证配置内容:"
        $scat = 'cat ~/magentic-lite/config.yaml'
        $tcat = "$env:TEMP\step6-cat.sh"
        [System.IO.File]::WriteAllText($tcat, ($scat -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding $false))
        $pcat = "/mnt/c/" + ($tcat -replace 'C:\\','') -replace '\\','/'
        wsl bash $pcat
    } else {
        Write-FAIL "config.yaml 写入失败"
    }
}

# ----------------------------------------------------------
# Step 7: 启动 Magentic-UI
# ----------------------------------------------------------
function Step-7 {
    Write-Step 7 "启动 Magentic-UI"
    Write-INFO "端口: $MAGENTIC_PORT"
    Write-INFO "访问: http://localhost:$MAGENTIC_PORT"
    Write-INFO "按 Ctrl+C 停止服务"

    if ((Confirm-Continue "Step 7") -eq $false) { return }

    $launchScript = @"
export PATH="`$HOME/.local/bin:`$PATH"
cd `$HOME/magentic-lite
source .venv/bin/activate
echo ""
echo "============================================"
echo "  Magentic-UI 启动中，端口 $MAGENTIC_PORT"
echo "  浏览器打开: http://localhost:$MAGENTIC_PORT"
echo "  Ctrl+C 停止"
echo "============================================"
echo ""
magentic-ui --port $MAGENTIC_PORT --config `$HOME/magentic-lite/config.yaml --reset-config
"@

    New-Item -ItemType Directory -Force -Path "C:\Temp" | Out-Null
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText("C:\Temp\step7-launch.sh", ($launchScript -replace "`r`n", "`n" -replace "`r", "`n"), $utf8NoBom)
    wsl -d Ubuntu -- bash /mnt/c/Temp/step7-launch.sh
}

# ============================================================
# 主流程 - 根据 -Step 参数决定起始步骤
# ============================================================

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   Magentic-UI 分步安装脚本 (Windows Server 2022)     ║" -ForegroundColor Magenta
Write-Host "║  用法: -Step <-1~7>  从指定步骤开始                  ║" -ForegroundColor Magenta
Write-Host "║        -SkipConfirm  跳过确认提示                    ║" -ForegroundColor Magenta
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Magenta
Write-Host "║  Step-2: 卸载旧Ubuntu/更新PowerShell/装Ubuntu 24.04  ║" -ForegroundColor White
Write-Host "║  Step-1: 检查管理员权限 / OS / Hyper-V 功能          ║" -ForegroundColor White
Write-Host "║  Step 0: 验证 DGX Spark Ollama 连接                  ║" -ForegroundColor White
Write-Host "║  Step 1: 检查 / 启用 WSL2（服务器版方式）            ║" -ForegroundColor White
Write-Host "║  Step15: 修复 wsl.conf 默认用户 + WSL2 预测试        ║" -ForegroundColor White
Write-Host "║  Step 2: 在 WSL2 中安装 Docker Engine                ║" -ForegroundColor White
Write-Host "║  Step 3: WSL2 中安装 Python 3.12                     ║" -ForegroundColor White
Write-Host "║  Step 4: WSL2 中安装 uv                              ║" -ForegroundColor White
Write-Host "║  Step 5: WSL2 中安装 magentic-ui                     ║" -ForegroundColor White
Write-Host "║  Step 6: 生成 config.yaml                            ║" -ForegroundColor White
Write-Host "║  Step 7: 启动 Magentic-UI                            ║" -ForegroundColor White
Write-Host "╚══════════════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""
Write-Host "  当前配置:" -ForegroundColor Cyan
Write-Host "    Ollama Host : $OLLAMA_HOST" -ForegroundColor Yellow
Write-Host "    编排器模型  : $ORCHESTRATOR_MODEL" -ForegroundColor Yellow
Write-Host "    浏览器模型  : $BROWSER_MODEL" -ForegroundColor Yellow
Write-Host "    Web UI 端口 : $MAGENTIC_PORT" -ForegroundColor Yellow
Write-Host ""

$steps = @{
    -2 = { Step-Neg2 }
    -1 = { Step-Neg1 }
     0 = { Step-0 }
     1 = { Step-1 }
    15 = { Step-1fix }
     2 = { Step-2 }
     3 = { Step-3 }
     4 = { Step-4 }
     5 = { Step-5 }
     6 = { Step-6 }
     7 = { Step-7 }
}

for ($i = $Step; $i -le 7; $i++) {
    if ($steps.ContainsKey($i)) {
        & $steps[$i]
    }
}

Write-Host ""
Write-Host "所有步骤执行完毕。" -ForegroundColor Green
