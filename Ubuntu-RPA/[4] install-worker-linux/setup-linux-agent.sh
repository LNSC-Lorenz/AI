#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# RPA Platform — Linux Worker Agent Setup
# 在 Ubuntu/Debian 上安装 Prefect Worker
# 用于运行 Web 自动化 (Playwright) 和 Python ETL 任务
# SAP GUI 任务仍需 Windows Worker
# ==============================================================================

PREFECT_API_URL="${1:-http://10.86.180.120:4200/api}"
WORK_POOL_NAME="${2:-linux-rpa-pool}"
WORKER_NAME="${3:-rpa-linux-agent-01}"
AGENT_DIR="/opt/rpa-agent"
AGENT_USER="rpa"

echo "=========================================="
echo " RPA Platform — Linux Worker Setup"
echo "=========================================="

# --- 检查 root ---
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 系统依赖 ---
echo "[1/6] 安装系统依赖..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    curl wget ca-certificates \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2t64

# --- 用户 ---
echo "[2/6] 配置用户..."
if ! id "$AGENT_USER" &>/dev/null; then
    useradd -r -m -s /bin/bash "$AGENT_USER"
fi

# --- 目录 ---
echo "[3/6] 创建 Agent 目录..."
mkdir -p "$AGENT_DIR/flows" "$AGENT_DIR/logs"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR"/flows/*.py "$AGENT_DIR/flows/"
cp "$SCRIPT_DIR"/flows/requirements.txt "$AGENT_DIR/flows/" 2>/dev/null || true
chown -R "$AGENT_USER":"$AGENT_USER" "$AGENT_DIR"

# --- Python venv ---
echo "[4/6] 创建 Python 虚拟环境..."
sudo -u "$AGENT_USER" python3 -m venv "$AGENT_DIR/.venv"
"$AGENT_DIR/.venv/bin/pip" install --upgrade pip -q
"$AGENT_DIR/.venv/bin/pip" install prefect httpx playwright -q

# Playwright browsers
sudo -u "$AGENT_USER" "$AGENT_DIR/.venv/bin/python" -m playwright install chromium

# --- Prefect 配置 ---
echo "[5/6] 配置 Prefect..."
sudo -u "$AGENT_USER" "$AGENT_DIR/.venv/bin/prefect" config set PREFECT_API_URL="$PREFECT_API_URL"

# 创建 work pool (忽略已存在错误)
sudo -u "$AGENT_USER" "$AGENT_DIR/.venv/bin/prefect" work-pool create "$WORK_POOL_NAME" --type process 2>/dev/null || echo "  Work pool '$WORK_POOL_NAME' 已存在"

# --- systemd service ---
echo "[6/6] 注册 systemd 服务..."
cat > /etc/systemd/system/prefect-worker.service <<EOF
[Unit]
Description=Prefect RPA Worker (Linux)
After=network.target

[Service]
Type=simple
User=$AGENT_USER
WorkingDirectory=$AGENT_DIR
Environment=PREFECT_API_URL=$PREFECT_API_URL
ExecStart=$AGENT_DIR/.venv/bin/prefect worker start --pool $WORK_POOL_NAME --name $WORKER_NAME
Restart=always
RestartSec=5
StandardOutput=append:$AGENT_DIR/logs/worker-stdout.log
StandardError=append:$AGENT_DIR/logs/worker-stderr.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now prefect-worker

sleep 2

echo ""
echo "=========================================="
echo " Linux Worker Setup Complete"
echo "=========================================="
echo " Agent Dir:    $AGENT_DIR"
echo " Work Pool:    $WORK_POOL_NAME"
echo " Worker Name:  $WORKER_NAME"
echo " Prefect API:  $PREFECT_API_URL"
if systemctl is-active prefect-worker &>/dev/null; then
    echo " Service:      prefect-worker (running)"
else
    echo " Service:      prefect-worker (check: journalctl -u prefect-worker)"
fi
echo "=========================================="
