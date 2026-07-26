#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# [05] RPA Platform — Nginx 反向代理配置
# 前置条件：04-build-frontend.sh 已执行
# ==============================================================================

echo "=========================================="
echo " [05] Nginx 反向代理配置"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/rpa-platform"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 部署 Nginx 配置 ---
echo "[1/3] 部署 Nginx 配置..."
mkdir -p "$INSTALL_DIR/nginx"
cp "$SCRIPT_DIR"/nginx/rpa.conf "$INSTALL_DIR/nginx/"
cp "$INSTALL_DIR/nginx/rpa.conf" /etc/nginx/sites-available/rpa
ln -sf /etc/nginx/sites-available/rpa /etc/nginx/sites-enabled/rpa
rm -f /etc/nginx/sites-enabled/default

# --- 验证配置 ---
echo "[2/3] 验证 Nginx 配置..."
nginx -t

# --- 重载 ---
echo "[3/3] 重载 Nginx..."
systemctl enable nginx
systemctl reload nginx

SERVER_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "=========================================="
echo " [05] Nginx 配置完成 ✓"
echo "=========================================="
echo ""
echo " ┌─────────────────────────────────────┐"
echo " │  RPA Platform 部署全部完成！        │"
echo " └─────────────────────────────────────┘"
echo ""
echo " 访问地址:"
echo "   前端面板:    http://$SERVER_IP"
echo "   API Gateway: http://$SERVER_IP/api/"
echo "   Prefect UI:  http://$SERVER_IP:4200"
echo ""
echo " 服务状态:"
systemctl is-active rpa-gateway && echo "   rpa-gateway:  运行中" || echo "   rpa-gateway:  未运行"
systemctl is-active nginx && echo "   nginx:        运行中" || echo "   nginx:        未运行"
docker ps --format '   {{.Names}}: {{.Status}}' 2>/dev/null | head -5
echo ""
echo " 下一步:"
echo "   在 Windows VM 运行: .\\setup-windows-agent.ps1"
echo "=========================================="
