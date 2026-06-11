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
    Write-INFO "Windows Server 2022 需手动启用 WSL 功能，无法直接用 wsl --install"

    if ((Confirm-Continue "Step 1") -eq $false) { return }

    # 检查 WSL Linux 子系统功能（用对象属性检测，不受系统语言影响）
    $wslFeatureObj = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux -ErrorAction SilentlyContinue
    if ($wslFeatureObj -and $wslFeatureObj.State -eq "Enabled") {
        Write-OK "WSL Linux 子系统功能已启用"
    } else {
        Write-WARN "WSL 功能未启用，正在启用..."
        dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
        if ($LASTEXITCODE -eq 0) {
            Write-WARN "WSL 功能已启用，必须重启服务器才能继续"
            $doRestart = Read-Host "是否立即重启服务器? (y/N)"
            if ($doRestart -eq "y") {
                Restart-Computer -Force
            } else {
                Write-Host ""
                Write-Host "  请手动重启服务器，重启后执行:" -ForegroundColor Yellow
                Write-Host "    .\install-steps-server2022.ps1 -Step 1" -ForegroundColor Cyan
                Write-Host ""
            }
        } else {
            Write-FAIL "WSL 功能启用失败，请以管理员身份手动执行:"
            Write-INFO "  dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart"
        }
        exit 0
    }

    # 检查 WSL 是否可用
    $wslOut = wsl --status 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "WSL2 已可用"
        wsl --list --verbose 2>&1 | ForEach-Object { Write-INFO $_ }
    } else {
        Write-WARN "WSL 功能已启用但尚未配置 Linux 发行版"
        Write-INFO "Windows Server 2022 上手动安装 Ubuntu 步骤:"
        Write-INFO "  1. 下载 Ubuntu: Invoke-WebRequest -Uri https://aka.ms/wslubuntu2204 -OutFile ubuntu.appx"
        Write-INFO "  2. 安装: Add-AppxPackage .\ubuntu.appx"
        Write-INFO "  3. 设置默认版本: wsl --set-default-version 2"
        Write-INFO "  4. 首次启动: ubuntu2204"
        Write-Host ""
        $doInstall = Read-Host "是否立即下载并安装 Ubuntu 22.04? (y/N)"
        if ($doInstall -eq "y") {
            Write-INFO "下载 Ubuntu 22.04..."
            Invoke-WebRequest -Uri "https://aka.ms/wslubuntu2204" -OutFile "$env:TEMP\ubuntu2204.appx" -UseBasicParsing
            Write-INFO "安装中..."
            Add-AppxPackage "$env:TEMP\ubuntu2204.appx"
            wsl --set-default-version 2
            Write-OK "Ubuntu 22.04 已安装，请运行 ubuntu2204 完成初始化（设置用户名和密码）"
            Write-INFO "初始化完成后重新运行: .\install-steps-server2022.ps1 -Step 2"
        }
    }
}

# ----------------------------------------------------------
# Step 2: 检查 / 安装 Docker Engine（Windows Server 2022 无 Docker Desktop）
# ----------------------------------------------------------
function Step-2 {
    Write-Step 2 "检查 / 安装 Docker Engine（Windows Server 2022）"
    Write-INFO "Windows Server 2022 使用 Docker Engine，不使用 Docker Desktop"
    Write-INFO "Docker Engine 将在 WSL2 (Ubuntu) 内部安装和运行"

    if ((Confirm-Continue "Step 2") -eq $false) { return }

    # 先检查 WSL2 是否可用
    $wslCheck = wsl --list 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-FAIL "WSL2 未就绪，请先完成 Step 1"
        return
    }

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

    $tempFile = Join-Path $env:TEMP "step2-docker.sh"
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($tempFile, ($dockerInstallScript -replace "`r`n", "`n"), $utf8NoBom)
    $wslPath = wsl wslpath -u ($tempFile -replace '\\', '\\')
    wsl bash $wslPath

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
        Write-WARN "Python 3.12 未找到，开始安装..."
        wsl bash -c "sudo apt-get update -qq && sudo apt-get install -y python3.12 python3.12-venv curl"
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Python 3.12 安装成功"
        } else {
            Write-FAIL "Python 3.12 安装失败，请手动在 WSL2 中执行:"
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

    $uvVer = wsl bash -c "export PATH=`$HOME/.local/bin:`$PATH && uv --version 2>&1"
    if ($LASTEXITCODE -eq 0) {
        Write-OK "uv 已安装: $uvVer"
    } else {
        Write-WARN "uv 未找到，开始安装..."
        wsl bash -c "curl -LsSf https://astral.sh/uv/install.sh | sh"
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
Write-Host "║   Magentic-UI 分步安装脚本 (Windows Server 2022)     ║" -ForegroundColor Magenta
Write-Host "║  用法: -Step <-1~7>  从指定步骤开始                  ║" -ForegroundColor Magenta
Write-Host "║        -SkipConfirm  跳过确认提示                    ║" -ForegroundColor Magenta
Write-Host "╠══════════════════════════════════════════════════════╣" -ForegroundColor Magenta
Write-Host "║  Step-1: 检查管理员权限 / OS / Hyper-V 功能          ║" -ForegroundColor White
Write-Host "║  Step 0: 验证 DGX Spark Ollama 连接                  ║" -ForegroundColor White
Write-Host "║  Step 1: 检查 / 启用 WSL2（服务器版方式）            ║" -ForegroundColor White
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
    -1 = { Step-Neg1 }
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
