#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# [01] RPA Platform — Docker 安装
# 前置条件：Ubuntu 24.04 LTS (autoinstall 已完成)
# ==============================================================================

echo "=========================================="
echo " [01] Docker 环境安装"
echo "=========================================="

GATEWAY_USER="rpa"

# --- 检查 root ---
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 系统依赖 ---
echo "[1/4] 安装系统依赖..."
apt-get update -qq
apt-get install -y --no-install-recommends \
    curl wget git ca-certificates gnupg lsb-release \
    python3 python3-pip python3-venv \
    nginx \
    htop jq unzip

# --- Node.js 20 LTS ---
echo "[2/4] 安装 Node.js..."
if command -v node &>/dev/null; then
    echo "  Node.js 已安装: $(node --version)"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
    echo "  Node.js 安装完成: $(node --version)"
fi

# --- Docker Engine ---
echo "[3/4] 安装 Docker..."
if command -v docker &>/dev/null; then
    echo "  Docker 已安装: $(docker --version)"
else
    curl -fsSL https://get.docker.com | bash
    systemctl enable --now docker
    echo "  Docker 安装完成: $(docker --version)"
fi

if ! docker compose version &>/dev/null; then
    apt-get install -y docker-compose-plugin
fi

# --- Docker 镜像加速（国内网络必须）---
echo "  配置 Docker 镜像加速..."
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl daemon-reload
systemctl restart docker
echo "  Docker 镜像加速已配置"

# --- 用户权限 + 目录 ---
echo "[4/4] 配置用户权限和目录..."
mkdir -p /opt/rpa-platform
chown "$GATEWAY_USER":"$GATEWAY_USER" /opt/rpa-platform
if id "$GATEWAY_USER" &>/dev/null; then
    usermod -aG docker "$GATEWAY_USER"
    echo "  用户 $GATEWAY_USER 已加入 docker 组"
else
    echo "  WARNING: 用户 $GATEWAY_USER 不存在，请检查 autoinstall"
fi

echo ""
echo "=========================================="
echo " [01] Docker 安装完成 ✓"
echo "=========================================="
echo " Docker:  $(docker --version)"
echo " Compose: $(docker compose version)"
echo " Node.js: $(node --version)"
echo " npm:     $(npm --version)"
echo ""
echo " 下一步: sudo bash 02-deploy-prefect.sh"
echo "=========================================="
