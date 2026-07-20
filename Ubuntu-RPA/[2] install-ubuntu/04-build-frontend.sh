#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# [04] RPA Platform — Vue3 前端构建
# 前置条件：Node.js 20+ 已安装 (autoinstall 已包含)
# ==============================================================================

echo "=========================================="
echo " [04] Vue3 前端构建"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/rpa-platform"
GATEWAY_USER="rpa"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 检查 Node.js ---
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js 未安装"
    echo "  运行: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - && sudo apt-get install -y nodejs"
    exit 1
fi
echo "  Node.js: $(node --version)"
echo "  npm:     $(npm --version)"

# --- 部署前端源码 ---
echo "[1/3] 部署前端文件..."
mkdir -p "$INSTALL_DIR/frontend"
cp -r "$SCRIPT_DIR"/frontend/* "$INSTALL_DIR/frontend/"
chown -R "$GATEWAY_USER":"$GATEWAY_USER" "$INSTALL_DIR/frontend"

# --- 安装依赖 ---
echo "[2/3] 安装 npm 依赖..."
cd "$INSTALL_DIR/frontend"
sudo -u "$GATEWAY_USER" npm install --silent

# --- 构建 ---
echo "[3/3] 构建生产版本..."
sudo -u "$GATEWAY_USER" npm run build

if [ -d "$INSTALL_DIR/frontend/dist" ]; then
    echo ""
    echo "=========================================="
    echo " [04] 前端构建完成 ✓"
    echo "=========================================="
    echo " 输出目录: $INSTALL_DIR/frontend/dist"
    echo " 文件数量: $(find $INSTALL_DIR/frontend/dist -type f | wc -l)"
    echo ""
    echo " 下一步: sudo bash 05-setup-nginx.sh"
    echo "=========================================="
else
    echo ""
    echo "=========================================="
    echo " [04] WARNING: 构建失败，dist 目录不存在"
    echo "=========================================="
fi
