#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# [03] RPA Platform — FastAPI Gateway 部署
# 前置条件：02-deploy-prefect.sh 已执行
# ==============================================================================

echo "=========================================="
echo " [03] FastAPI Gateway 部署"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/rpa-platform"
GATEWAY_USER="rpa"
PREFECT_API_URL="http://127.0.0.1:4200/api"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 部署 Gateway 代码 ---
echo "[1/4] 部署 Gateway 文件..."
mkdir -p "$INSTALL_DIR/gateway"
cp "$SCRIPT_DIR"/gateway/*.py "$INSTALL_DIR/gateway/"
cp "$SCRIPT_DIR"/gateway/requirements.txt "$INSTALL_DIR/gateway/"
chown -R "$GATEWAY_USER":"$GATEWAY_USER" "$INSTALL_DIR/gateway"

# --- Python venv ---
echo "[2/4] 创建 Python 虚拟环境..."
python3 -m venv "$INSTALL_DIR/gateway/.venv"
"$INSTALL_DIR/gateway/.venv/bin/pip" install --upgrade pip -q
"$INSTALL_DIR/gateway/.venv/bin/pip" install -r "$INSTALL_DIR/gateway/requirements.txt" -q

# --- systemd service ---
echo "[3/4] 注册 systemd 服务..."
cat > /etc/systemd/system/rpa-gateway.service <<EOF
[Unit]
Description=RPA FastAPI Gateway
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=$GATEWAY_USER
WorkingDirectory=$INSTALL_DIR/gateway
Environment=PREFECT_API_URL=$PREFECT_API_URL
ExecStart=$INSTALL_DIR/gateway/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# --- 启动 ---
echo "[4/4] 启动 Gateway 服务..."
systemctl daemon-reload
systemctl enable --now rpa-gateway

sleep 2
if systemctl is-active rpa-gateway &>/dev/null; then
    echo ""
    echo "=========================================="
    echo " [03] FastAPI Gateway 部署完成 ✓"
    echo "=========================================="
    echo " API:     http://127.0.0.1:8100"
    echo " Health:  http://127.0.0.1:8100/health"
    echo " Service: rpa-gateway (systemd)"
    echo ""
    echo " 下一步: sudo bash 04-build-frontend.sh"
    echo "=========================================="
else
    echo ""
    echo "=========================================="
    echo " [03] WARNING: Gateway 未启动"
    echo "=========================================="
    echo " 请检查: journalctl -u rpa-gateway -n 50"
    echo "=========================================="
fi
