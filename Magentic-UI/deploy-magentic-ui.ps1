#Requires -Version 5.1
<#
.SYNOPSIS
    在 Windows 上部署 Magentic-UI (MagenticLite 0.2.x)
    前提: Dell DGX Spark 上已部署 Ollama + Qwen3 + Fara7B

.DESCRIPTION
    本脚本自动完成以下任务:
    1. 检查/安装前置依赖 (Python 3.12, uv, Docker Desktop, WSL2)
    2. 创建项目目录和虚拟环境
    3. 安装 magentic-ui[ollama] 包
    4. 生成 config.yaml 配置文件 (指向 DGX Spark 上的 Ollama)
    5. 启动 Magentic-UI 服务

.NOTES
    Author: AI Assistant
    Date:   2025-06-08
    请根据实际环境修改下方配置变量
#>

# ============================================================
# 用户配置区 - 请根据实际环境修改
# ============================================================

# Dell DGX Spark 上 Ollama 服务地址 (确保 Windows 端能访问)
$OLLAMA_HOST = "http://10.87.5.55:11434"  # <-- 修改为你的 DGX Spark IP

# 模型名称 (需与 Ollama 中已部署的模型名匹配)
$ORCHESTRATOR_MODEL = "qwen3.6:35b"   # Qwen3.6 用作编排器
$BROWSER_MODEL = "batiai/fara-7b:q5"  # Fara7B 用作浏览器代理
$CODER_MODEL = "qwen3.6:35b"         # Qwen3.6 用作代码生成

# Magentic-UI 监听端口
$MAGENTIC_PORT = 8082

# 项目安装目录
$PROJECT_DIR = "$env:USERPROFILE\magentic-lite"

# 是否使用 Docker/Quicksand 沙箱
# 注意: Quicksand VM 在 Windows 上不支持 Unix socket，需设为 $false
$USE_DOCKER = $false

# ============================================================
# 脚本开始
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
    Write-Host ""
}

function Test-Command {
    param([string]$Command)
    return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

# ----------------------------------------------------------
# Step 0: 检查网络连通性 - 验证能否访问 DGX Spark Ollama
# ----------------------------------------------------------
Write-Step "Step 0: 验证 DGX Spark Ollama 连接"

try {
    $ollamaUri = "$OLLAMA_HOST/api/tags"
    Write-Host "正在测试连接: $ollamaUri"
    $response = Invoke-RestMethod -Uri $ollamaUri -Method Get -TimeoutSec 10
    Write-Host "✓ 成功连接 Ollama，已部署模型:" -ForegroundColor Green
    foreach ($model in $response.models) {
        Write-Host "  - $($model.name)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "✗ 无法连接到 DGX Spark Ollama: $OLLAMA_HOST" -ForegroundColor Red
    Write-Host "  请确认:" -ForegroundColor Red
    Write-Host "  1. DGX Spark 已启动且 Ollama 正在运行" -ForegroundColor Red
    Write-Host "  2. Ollama 绑定到 0.0.0.0 (OLLAMA_HOST=0.0.0.0)" -ForegroundColor Red
    Write-Host "  3. 防火墙允许端口 11434 的访问" -ForegroundColor Red
    Write-Host "  4. 脚本中 OLLAMA_HOST 变量已正确配置" -ForegroundColor Red
    Write-Host ""
    $continue = Read-Host "是否继续安装? (y/N)"
    if ($continue -ne "y") { exit 1 }
}

# ----------------------------------------------------------
# Step 1: 检查 WSL2
# ----------------------------------------------------------
Write-Step "Step 1: 检查 WSL2"

$wslStatus = wsl --status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "✗ WSL2 未安装或未启用" -ForegroundColor Red
    Write-Host "  请执行以下命令安装 WSL2 (需管理员权限):" -ForegroundColor Yellow
    Write-Host "  wsl --install" -ForegroundColor White
    Write-Host "  安装后需重启计算机" -ForegroundColor Yellow
    $continue = Read-Host "WSL2 未就绪，是否继续? (y/N)"
    if ($continue -ne "y") { exit 1 }
} else {
    Write-Host "✓ WSL2 已启用" -ForegroundColor Green
}

# ----------------------------------------------------------
# Step 2: 检查 Docker Desktop
# ----------------------------------------------------------
Write-Step "Step 2: 检查 Docker Desktop"

if ($USE_DOCKER) {
    if (Test-Command "docker") {
        $dockerInfo = docker info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✓ Docker Desktop 运行中" -ForegroundColor Green
        } else {
            Write-Host "✗ Docker 已安装但未运行，请启动 Docker Desktop" -ForegroundColor Red
            Write-Host "  确保已启用 WSL2 后端: Settings > General > Use the WSL 2 based engine" -ForegroundColor Yellow
            $continue = Read-Host "是否继续? (y/N)"
            if ($continue -ne "y") { exit 1 }
        }
    } else {
        Write-Host "✗ Docker 未安装" -ForegroundColor Red
        Write-Host "  请从 https://www.docker.com/products/docker-desktop/ 下载安装" -ForegroundColor Yellow
        Write-Host "  安装时选择 WSL2 后端" -ForegroundColor Yellow
        $continue = Read-Host "Docker 未安装，是否继续? (y/N)"
        if ($continue -ne "y") { exit 1 }
    }
} else {
    Write-Host "跳过 Docker 检查 (无 Docker 模式)" -ForegroundColor Yellow
}

# ----------------------------------------------------------
# Step 3: 检查/安装 Python 3.10+
# ----------------------------------------------------------
Write-Step "Step 3: 检查 Python"

$pythonCmd = $null
foreach ($cmd in @("python3.12", "python3.11", "python3", "python")) {
    if (Test-Command $cmd) {
        $ver = & $cmd --version 2>&1
        if ($ver -match "3\.1[0-9]|3\.[2-9][0-9]") {
            $pythonCmd = $cmd
            break
        }
    }
}

if ($pythonCmd) {
    $pyVer = & $pythonCmd --version 2>&1
    Write-Host "✓ 找到 Python: $pyVer" -ForegroundColor Green
} else {
    Write-Host "✗ 未找到 Python 3.10+" -ForegroundColor Red
    Write-Host "  正在尝试通过 winget 安装 Python 3.12..." -ForegroundColor Yellow
    try {
        winget install Python.Python.3.12 --accept-package-agreements --accept-source-agreements
        # 刷新 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        $pythonCmd = "python"
    } catch {
        Write-Host "  自动安装失败，请手动从 https://www.python.org/downloads/ 安装 Python 3.12" -ForegroundColor Red
        exit 1
    }
}

# ----------------------------------------------------------
# Step 4: 安装 uv (Python 包管理器)
# ----------------------------------------------------------
Write-Step "Step 4: 检查/安装 uv"

if (Test-Command "uv") {
    Write-Host "✓ uv 已安装: $(uv --version)" -ForegroundColor Green
} else {
    Write-Host "正在安装 uv..." -ForegroundColor Yellow
    try {
        Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
        # 刷新 PATH
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        if (-not (Test-Command "uv")) {
            # uv 默认安装路径
            $env:Path += ";$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin"
        }
        Write-Host "✓ uv 安装完成" -ForegroundColor Green
    } catch {
        Write-Host "✗ uv 安装失败，请手动安装: https://docs.astral.sh/uv/getting-started/installation/" -ForegroundColor Red
        exit 1
    }
}

# ----------------------------------------------------------
# Step 5: 创建项目目录和虚拟环境
# ----------------------------------------------------------
Write-Step "Step 5: 创建项目目录和虚拟环境"

if (-not (Test-Path $PROJECT_DIR)) {
    New-Item -ItemType Directory -Path $PROJECT_DIR -Force | Out-Null
    Write-Host "✓ 创建目录: $PROJECT_DIR" -ForegroundColor Green
} else {
    Write-Host "目录已存在: $PROJECT_DIR" -ForegroundColor Yellow
}

Set-Location $PROJECT_DIR

# 创建虚拟环境
$venvPath = Join-Path $PROJECT_DIR ".venv"
$activateScript = Join-Path $venvPath "Scripts\Activate.ps1"

# 如果 .venv 存在但激活脚本缺失或 Python 版本不对，删除后重建
$needRebuild = $false
if ((Test-Path $venvPath) -and -not (Test-Path $activateScript)) {
    Write-Host "检测到不完整的虚拟环境，正在删除后重建..." -ForegroundColor Yellow
    $needRebuild = $true
}
if ((Test-Path $venvPath) -and (Test-Path $activateScript)) {
    # 检查现有 venv 的 Python 版本是否 >= 3.12
    $venvPython = Join-Path $venvPath "Scripts\python.exe"
    if (Test-Path $venvPython) {
        $venvVer = & $venvPython --version 2>&1
        if ($venvVer -notmatch "3\.1[2-9]|3\.[2-9][0-9]") {
            Write-Host "虚拟环境 Python 版本 ($venvVer) 低于 3.12，需要重建..." -ForegroundColor Yellow
            $needRebuild = $true
        }
    }
}
if ($needRebuild -and (Test-Path $venvPath)) {
    Remove-Item -Recurse -Force $venvPath
}

if (-not (Test-Path $venvPath)) {
    # Magentic-UI >= 0.2.1 要求 Python 3.12+，uv 会自动下载
    Write-Host "正在创建 Python 3.12 虚拟环境 (uv 将自动下载 Python 3.12)..."
    uv venv --python=3.12 --seed .venv 2>&1 | Write-Host
    Write-Host "✓ 虚拟环境创建完成" -ForegroundColor Green
} else {
    Write-Host "虚拟环境已存在 (Python 3.12+)" -ForegroundColor Yellow
}

# 激活虚拟环境
if (Test-Path $activateScript) {
    & $activateScript
    Write-Host "✓ 虚拟环境已激活" -ForegroundColor Green
} else {
    Write-Host "✗ 无法找到激活脚本: $activateScript" -ForegroundColor Red
    Write-Host "  请手动删除 $venvPath 后重新运行脚本" -ForegroundColor Yellow
    exit 1
}

# ----------------------------------------------------------
# Step 6: 安装 Magentic-UI
# ----------------------------------------------------------
Write-Step "Step 6: 安装 Magentic-UI (含 Ollama 支持)"

Write-Host "正在安装 magentic_ui[ollama] >= 0.2.0 ..."
uv pip install "magentic_ui[ollama]>=0.2.0" 2>&1 | Write-Host

if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Magentic-UI 安装完成" -ForegroundColor Green
} else {
    Write-Host "✗ 安装失败" -ForegroundColor Red
    exit 1
}

# ----------------------------------------------------------
# Step 7: 生成 config.yaml 配置文件
# ----------------------------------------------------------
Write-Step "Step 7: 生成 config.yaml 配置文件"

$configPath = Join-Path $PROJECT_DIR "config.yaml"

# Ollama OpenAI-compatible endpoint
$OLLAMA_V1 = "$OLLAMA_HOST/v1"

$configContent = @"
# MagenticLite 0.2.x config - Ollama on Dell DGX Spark

model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: "$ORCHESTRATOR_MODEL"
      base_url: "$OLLAMA_V1"
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
      model: "$BROWSER_MODEL"
      base_url: "$OLLAMA_V1"
      api_key: "ollama"
      max_retries: 5
      model_info:
        vision: true
        function_calling: false
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

# Disable Quicksand VM sandbox (not supported on native Windows)
sandbox:
  type: "null"

agent_mode: all
"@

# Write as ASCII-safe to avoid GBK decoding issues on Chinese Windows
Set-Content -Path $configPath -Value $configContent -Encoding ASCII
Write-Host "✓ 配置文件已生成: $configPath" -ForegroundColor Green
Write-Host ""
Write-Host "配置摘要:" -ForegroundColor White
Write-Host "  Ollama 地址:    $OLLAMA_V1" -ForegroundColor White
Write-Host "  编排器模型:     $ORCHESTRATOR_MODEL" -ForegroundColor White
Write-Host "  浏览器模型:     $BROWSER_MODEL" -ForegroundColor White
Write-Host "  沙箱模式:       null (无隔离)" -ForegroundColor White

# ----------------------------------------------------------
# Step 8: 启动 Magentic-UI
# ----------------------------------------------------------
Write-Step "Step 8: 启动 Magentic-UI"

Write-Host "启动命令: magentic-ui --port $MAGENTIC_PORT --config config.yaml --reset-config" -ForegroundColor White
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Magentic-UI 即将启动" -ForegroundColor Green
Write-Host " 浏览器访问: http://localhost:$MAGENTIC_PORT" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "按 Ctrl+C 停止服务" -ForegroundColor Yellow
Write-Host ""

# 启动服务 (--reset-config 清除旧配置，--config 加载新配置)
magentic-ui --port $MAGENTIC_PORT --config $configPath --reset-config
