#Requires -Version 5.1
<#
.SYNOPSIS
    Magentic-UI 分步安装脚本 - Windows 10 / 11 版

.DESCRIPTION
    将部署流程拆分为独立步骤，每步执行前会提示确认。
    适配 Windows 10 / 11（使用 Docker Desktop + WSL2）。
    可通过 -Step 参数直接跳转到指定步骤。

.PARAMETER Step
    指定从哪一步开始执行 (0 到 7)，默认从 Step 0 开始

.PARAMETER SkipConfirm
    跳过每步的确认提示，自动执行所有步骤

.EXAMPLE
    .\install-steps-win10.ps1               # 从头开始逐步执行
    .\install-steps-win10.ps1 -Step 3       # 从 Step 3 开始
    .\install-steps-win10.ps1 -SkipConfirm  # 全自动执行所有步骤
#>

param(
    [int]$Step = 0,
    [switch]$SkipConfirm
)

# ============================================================
# 用户配置区 - 请根据实际环境修改
# ============================================================

$OLLAMA_HOST         = "http://10.87.5.55:11434"
$ORCHESTRATOR_MODEL  = "qwen3.6:35b"
$BROWSER_MODEL       = "batiai/fara-7b:q5"
$MAGENTIC_PORT       = 8081

# ============================================================
# 辅助函数
# ============================================================

$ErrorActionPreference = "Continue"

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
# Step 1: 检查 / 启用 WSL2（Windows 10/11 方式）
# ----------------------------------------------------------
function Step-1 {
    Write-Step 1 "检查 / 启用 WSL2（Windows 10/11）"

    if ((Confirm-Continue "Step 1") -eq $false) { return }

    # 检查 WSL 是否已可用
    $wslOut = wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "WSL2 已可用"
        wsl --list --verbose 2>&1 | ForEach-Object { Write-INFO $_ }
        return
    }

    Write-WARN "WSL2 未就绪，尝试安装..."
    Write-INFO "Windows 10 2004+ / Windows 11 支持 wsl --install 一键安装"

    # 检查 OS 版本是否支持 wsl --install（Build 19041+）
    $build = [System.Environment]::OSVersion.Version.Build
    Write-INFO "当前系统 Build: $build"

    if ($build -ge 19041) {
        Write-INFO "执行: wsl --install -d Ubuntu-22.04"
        wsl --install -d Ubuntu-22.04
        if ($LASTEXITCODE -eq 0) {
            Write-OK "WSL2 + Ubuntu 22.04 安装成功"
            Write-WARN "需要重启计算机才能完成安装"
            Write-INFO "重启后重新运行: .\install-steps-win10.ps1 -Step 2"
            $doRestart = Read-Host "是否立即重启? (y/N)"
            if ($doRestart -eq "y") { Restart-Computer -Force }
        } else {
            Write-FAIL "wsl --install 失败"
            Write-INFO "排查建议："
            Write-INFO "  1. 确认以管理员身份运行 PowerShell"
            Write-INFO "  2. 检查 Windows Update 是否有待安装更新"
            Write-INFO "  3. 手动启用: dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart"
            Write-INFO "              dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart"
        }
    } else {
        Write-FAIL "系统版本过旧（Build $build < 19041），不支持 wsl --install"
        Write-INFO "请升级 Windows 10 至 2004 版本（20H1）或更高，或升级至 Windows 11"
        Write-INFO "临时方案（旧版本手动安装）:"
        Write-INFO "  1. dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart"
        Write-INFO "  2. dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart"
        Write-INFO "  3. 重启，然后下载 WSL2 内核更新: https://aka.ms/wsl2kernel"
        Write-INFO "  4. wsl --set-default-version 2"
        Write-INFO "  5. 从 Microsoft Store 安装 Ubuntu"
    }
}

# ----------------------------------------------------------
# Step 2: 检查 / 安装 Docker Desktop（Windows 10/11）
# ----------------------------------------------------------
function Step-2 {
    Write-Step 2 "检查 / 安装 Docker Desktop（Windows 10/11）"
    Write-INFO "Windows 10/11 使用 Docker Desktop（含 WSL2 后端集成）"

    if ((Confirm-Continue "Step 2") -eq $false) { return }

    # 检查 Docker 是否已安装并运行
    $dockerInfo = docker info 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Docker Desktop 运行中"
        # 检查是否使用 WSL2 后端
        $wslBackend = docker info 2>&1 | Select-String -Pattern "linux" -Quiet
        if ($wslBackend) {
            Write-OK "Docker 使用 Linux/WSL2 后端"
        } else {
            Write-WARN "Docker 可能未使用 WSL2 后端"
            Write-INFO "请在 Docker Desktop > Settings > General 中确认已勾选:"
            Write-INFO "  'Use the WSL 2 based engine'"
        }

        # 检查 WSL Integration
        Write-INFO "检查 WSL Integration 状态..."
        $wslIntegration = wsl bash -c "docker --version 2>&1"
        if ($LASTEXITCODE -eq 0) {
            Write-OK "WSL2 内已能访问 Docker: $wslIntegration"
        } else {
            Write-WARN "WSL2 内无法直接使用 Docker"
            Write-INFO "请在 Docker Desktop > Settings > Resources > WSL Integration 中:"
            Write-INFO "  启用 'Enable integration with my default WSL distro'"
            Write-INFO "  并勾选已安装的 Ubuntu 发行版"
        }
        return
    }

    # Docker Desktop 未运行，检查是否已安装
    $dockerExe = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerExe) {
        Write-WARN "Docker 已安装但未运行，请启动 Docker Desktop"
        Write-INFO "启动路径: $($dockerExe.Source)"
        $doStart = Read-Host "是否尝试启动 Docker Desktop? (y/N)"
        if ($doStart -eq "y") {
            Start-Process "Docker Desktop" -ErrorAction SilentlyContinue
            Write-INFO "已发送启动请求，等待 Docker Desktop 就绪（约 30 秒）..."
            Start-Sleep -Seconds 30
            $retry = docker info 2>&1
            if ($LASTEXITCODE -eq 0) { Write-OK "Docker Desktop 已启动" }
            else { Write-WARN "Docker Desktop 仍未就绪，请手动确认后重新运行 -Step 2" }
        }
        return
    }

    # Docker Desktop 未安装
    Write-WARN "Docker Desktop 未安装，开始下载安装..."
    Write-INFO "下载地址: https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe"

    $doInstall = Read-Host "是否立即下载并安装 Docker Desktop? (y/N)"
    if ($doInstall -eq "y") {
        $installer = "$env:TEMP\DockerDesktopInstaller.exe"
        Write-INFO "下载中（约 500MB）..."
        Invoke-WebRequest -Uri "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" `
            -OutFile $installer -UseBasicParsing
        Write-INFO "安装中（静默安装）..."
        Start-Process $installer -ArgumentList "install --quiet" -Wait
        Write-OK "Docker Desktop 安装完成"
        Write-WARN "需要重启计算机才能完成配置"
        Write-INFO "重启后启动 Docker Desktop，再运行: .\install-steps-win10.ps1 -Step 2"
        $doRestart = Read-Host "是否立即重启? (y/N)"
        if ($doRestart -eq "y") { Restart-Computer -Force }
    } else {
        Write-INFO "请手动安装 Docker Desktop: https://www.docker.com/products/docker-desktop/"
        Write-INFO "安装后启用 WSL2 后端，再运行: .\install-steps-win10.ps1 -Step 2"
    }
}

# ----------------------------------------------------------
# Step 3: 在 WSL2 中检查 / 安装 Python 3.12
# ----------------------------------------------------------
function Step-3 {
    Write-Step 3 "在 WSL2 中检查 / 安装 Python 3.12"

    if ((Confirm-Continue "Step 3") -eq $false) { return }

    $pyVer = Run-WSL "python3.12 --version 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python 3.12 已安装"
    } else {
        Write-WARN "Python 3.12 未找到，开始安装..."
        $s3 = "export DEBIAN_FRONTEND=noninteractive`napt-get install -y software-properties-common`nadd-apt-repository -y ppa:deadsnakes/ppa`napt-get update -qq`napt-get install -y python3.12 python3.12-venv curl"
        $t3 = "$env:TEMP\step3-python.sh"
        [System.IO.File]::WriteAllText($t3, ($s3 -replace "`r`n","`n"), (New-Object System.Text.UTF8Encoding $false))
        $p3 = "/mnt/c/" + ($t3 -replace 'C:\\','') -replace '\\','/'
        wsl -u root bash $p3
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Python 3.12 安装成功"
        } else {
            Write-FAIL "Python 3.12 安装失败，请手动在 WSL2 中执行:"
            Write-INFO "  wsl -u root -- apt-get install -y python3.12 python3.12-venv"
        }
    }
}

# ----------------------------------------------------------
# Step 4: 在 WSL2 中检查 / 安装 uv
# ----------------------------------------------------------
function Step-4 {
    Write-Step 4 "在 WSL2 中检查 / 安装 uv (Python 包管理器)"

    if ((Confirm-Continue "Step 4") -eq $false) { return }

    $uvVer = wsl bash -c "export PATH=`$HOME/.local/bin:`$PATH && uv --version 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-OK "uv 已安装: $uvVer"
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

    $tempFile = Join-Path $env:TEMP "step5-install.sh"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tempFile, ($installScript -replace "`r`n", "`n"), $utf8NoBom)
    $wslPath = wsl wslpath -u ($tempFile -replace '\\', '\\')
    wsl bash $wslPath

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
    Write-INFO "沙箱       : quicksand (含浏览器预览)"

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
      model_info:
        vision: false
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
      model_info:
        vision: true
        function_calling: false
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

sandbox:
  type: quicksand

agent_mode: all
"@

    $writeScript = "mkdir -p `$HOME/magentic-lite && cat > `$HOME/magentic-lite/config.yaml << 'ENDOFCONFIG'`n$configYaml`nENDOFCONFIG"

    $tempFile = Join-Path $env:TEMP "step6-config.sh"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tempFile, ($writeScript -replace "`r`n", "`n"), $utf8NoBom)
    $wslPath = wsl wslpath -u ($tempFile -replace '\\', '\\')
    wsl bash $wslPath

    if ($LASTEXITCODE -eq 0) {
        Write-OK "config.yaml 已写入 ~/magentic-lite/config.yaml"
        Write-INFO "验证配置内容:"
        wsl bash -c "cat ~/magentic-lite/config.yaml"
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

    $tempFile = Join-Path $env:TEMP "step7-launch.sh"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tempFile, ($launchScript -replace "`r`n", "`n"), $utf8NoBom)
    $wslPath = wsl wslpath -u ($tempFile -replace '\\', '\\')
    wsl bash $wslPath
}

# ============================================================
# 主流程 - 根据 -Step 参数决定起始步骤
# ============================================================

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   Magentic-UI 分步安装脚本 (Windows 10 / 11)        ║" -ForegroundColor Magenta
Write-Host "║  用法: -Step <0~7>   从指定步骤开始                  ║" -ForegroundColor Magenta
Write-Host "║        -SkipConfirm  跳过确认提示                    ║" -ForegroundColor Magenta
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Magenta
Write-Host "║  Step 0: 验证 DGX Spark Ollama 连接                  ║" -ForegroundColor White
Write-Host "║  Step 1: 检查 / 启用 WSL2（wsl --install 方式）      ║" -ForegroundColor White
Write-Host "║  Step 2: 检查 / 安装 Docker Desktop                  ║" -ForegroundColor White
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
    0 = { Step-0 }
    1 = { Step-1 }
    2 = { Step-2 }
    3 = { Step-3 }
    4 = { Step-4 }
    5 = { Step-5 }
    6 = { Step-6 }
    7 = { Step-7 }
}

for ($i = $Step; $i -le 7; $i++) {
    & $steps[$i]
}

Write-Host ""
Write-Host "所有步骤执行完毕。" -ForegroundColor Green
