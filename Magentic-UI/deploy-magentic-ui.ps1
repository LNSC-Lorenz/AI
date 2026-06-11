#Requires -Version 5.1
<#
.SYNOPSIS
    在 WSL2 中部署 Magentic-UI (MagenticLite 0.2.x)
    含 Quicksand 沙箱 + 右侧浏览器实时预览
    前提: Dell DGX Spark 上已部署 Ollama + qwen3.6 + fara7b

.DESCRIPTION
    本脚本在 PowerShell 中运行，自动:
    1. 检查 Windows 端前置条件 (WSL2, Docker Desktop, Ollama 连通性)
    2. 在 WSL2 内部完成安装和启动 (含 Quicksand 沙箱，支持浏览器预览)

.NOTES
    Author: AI Assistant
    Date:   2026-06-08
    使用方法: 在 PowerShell 中执行 .\deploy-magentic-ui.ps1
#>

# ============================================================
# 用户配置区 - 请根据实际环境修改
# ============================================================

$OLLAMA_HOST = "http://10.87.5.55:11434"    # Dell DGX Spark Ollama 地址
$ORCHESTRATOR_MODEL = "qwen3.6:35b"          # 编排器模型
$BROWSER_MODEL = "batiai/fara-7b:q5"         # 浏览器代理模型
$MAGENTIC_PORT = 8081                        # Web UI 端口

# ============================================================
# Windows 端前置检查
# ============================================================

$ErrorActionPreference = "Continue"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "=== $Message ===" -ForegroundColor Cyan
    Write-Host ""
}

# --- Step 0: 验证 Ollama 连接 ---
Write-Step "Step 0: 验证 DGX Spark Ollama 连接"

try {
    $response = Invoke-RestMethod -Uri "$OLLAMA_HOST/api/tags" -Method Get -TimeoutSec 10
    Write-Host "OK - Ollama connected, models:" -ForegroundColor Green
    foreach ($model in $response.models) {
        Write-Host "  - $($model.name)" -ForegroundColor Yellow
    }
} catch {
    Write-Host "FAIL - Cannot reach $OLLAMA_HOST" -ForegroundColor Red
    Write-Host "  Check: DGX Spark running, OLLAMA_HOST=0.0.0.0, firewall port 11434" -ForegroundColor Red
    $c = Read-Host "Continue? (y/N)"
    if ($c -ne "y") { exit 1 }
}

# --- Step 1: 检查 WSL2 ---
Write-Step "Step 1: 检查 WSL2"

wsl --status 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAIL - WSL2 not enabled. Run: wsl --install" -ForegroundColor Red
    exit 1
}
Write-Host "OK - WSL2 enabled" -ForegroundColor Green

# --- Step 2: 检查 Docker Desktop ---
Write-Step "Step 2: 检查 Docker Desktop"

$dockerCheck = docker info 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "WARN - Docker Desktop not running" -ForegroundColor Yellow
    Write-Host "  Please start Docker Desktop and enable WSL2 integration" -ForegroundColor Yellow
    Write-Host "  Settings > Resources > WSL Integration > Enable" -ForegroundColor Yellow
    $c = Read-Host "Continue? (y/N)"
    if ($c -ne "y") { exit 1 }
} else {
    Write-Host "OK - Docker Desktop running" -ForegroundColor Green
}

# ============================================================
# 在 WSL2 中执行部署和启动
# ============================================================
Write-Step "Step 3: 在 WSL2 中部署 Magentic-UI"

Write-Host "All prerequisites OK. Launching deployment in WSL2..." -ForegroundColor Green
Write-Host "Browser will be available at: http://localhost:$MAGENTIC_PORT" -ForegroundColor Green
Write-Host ""

# 构建传入 WSL2 的 bash 脚本
$bashScript = @"
#!/bin/bash
set -e

# --- Config ---
OLLAMA_HOST="$OLLAMA_HOST"
ORCHESTRATOR_MODEL="$ORCHESTRATOR_MODEL"
BROWSER_MODEL="$BROWSER_MODEL"
MAGENTIC_PORT=$MAGENTIC_PORT
PROJECT_DIR="`$HOME/magentic-lite"
OLLAMA_V1="`$OLLAMA_HOST/v1"

echo ""
echo -e "\033[36m=== [WSL2] Installing dependencies ===\033[0m"
echo ""

# Install Python 3.12 if needed
if ! command -v python3.12 &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv curl
fi
echo -e "\033[32m OK - python3.12 ready\033[0m"

# Install uv
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="`$HOME/.local/bin:`$PATH"
fi
export PATH="`$HOME/.local/bin:`$PATH"
echo -e "\033[32m OK - uv ready\033[0m"

echo ""
echo -e "\033[36m=== [WSL2] Setting up project ===\033[0m"
echo ""

# Create project
mkdir -p "`$PROJECT_DIR"
cd "`$PROJECT_DIR"

# Create venv if needed
if [ ! -f ".venv/bin/activate" ]; then
    rm -rf .venv 2>/dev/null
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate
echo -e "\033[32m OK - venv activated\033[0m"

# Install magentic-ui
uv pip install "magentic_ui[ollama]>=0.2.0"
echo -e "\033[32m OK - magentic-ui installed\033[0m"

echo ""
echo -e "\033[36m=== [WSL2] Generating config.yaml ===\033[0m"
echo ""

# Generate config
cat > "`$PROJECT_DIR/config.yaml" << 'CFGEOF'
model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: ORCHESTRATOR_PLACEHOLDER
      base_url: OLLAMA_V1_PLACEHOLDER
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
      model: BROWSER_PLACEHOLDER
      base_url: OLLAMA_V1_PLACEHOLDER
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
CFGEOF

# Replace placeholders
sed -i "s|ORCHESTRATOR_PLACEHOLDER|`$ORCHESTRATOR_MODEL|g" "`$PROJECT_DIR/config.yaml"
sed -i "s|BROWSER_PLACEHOLDER|`$BROWSER_MODEL|g" "`$PROJECT_DIR/config.yaml"
sed -i "s|OLLAMA_V1_PLACEHOLDER|`$OLLAMA_V1|g" "`$PROJECT_DIR/config.yaml"

echo "  Orchestrator: `$ORCHESTRATOR_MODEL"
echo "  Browser:      `$BROWSER_MODEL"
echo "  Ollama:       `$OLLAMA_V1"
echo "  Sandbox:      quicksand (browser preview enabled)"
echo -e "\033[32m OK - config.yaml generated\033[0m"

echo ""
echo -e "\033[36m=== [WSL2] Launching Magentic-UI ===\033[0m"
echo ""
echo -e "\033[32m============================================\033[0m"
echo -e "\033[32m  Magentic-UI starting on port `$MAGENTIC_PORT\033[0m"
echo -e "\033[32m  Open: http://localhost:`$MAGENTIC_PORT\033[0m"
echo -e "\033[32m============================================\033[0m"
echo ""

magentic-ui --port "`$MAGENTIC_PORT" --config "`$PROJECT_DIR/config.yaml" --reset-config
"@

# 将 bash 脚本写入临时文件 (无 BOM + Unix 换行符 LF)
$tempFile = Join-Path $env:TEMP "magentic-ui-deploy.sh"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$unixContent = $bashScript -replace "`r`n", "`n"
[System.IO.File]::WriteAllText($tempFile, $unixContent, $utf8NoBom)

# 通过 WSL2 执行
$wslTempPath = wsl wslpath -u ($tempFile -replace '\\', '\\')
wsl bash $wslTempPath
