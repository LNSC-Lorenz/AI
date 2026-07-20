#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# [02] RPA Platform — Prefect Server + PostgreSQL 部署
# 前置条件：01-setup-docker.sh 已执行
# ==============================================================================

echo "=========================================="
echo " [02] Prefect Server 部署"
echo "=========================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/rpa-platform"
GATEWAY_USER="rpa"

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 请使用 sudo 运行此脚本"
    exit 1
fi

# --- 检查 Docker ---
if ! command -v docker &>/dev/null; then
    echo "ERROR: Docker 未安装，请先运行 01-setup-docker.sh"
    exit 1
fi

# --- 部署文件 ---
echo "[1/3] 部署项目文件..."
mkdir -p "$INSTALL_DIR"
cp "$SCRIPT_DIR/docker-compose.yml" "$INSTALL_DIR/"
chown -R "$GATEWAY_USER":"$GATEWAY_USER" "$INSTALL_DIR"

# --- 启动容器 ---
echo "[2/3] 启动 Prefect Server + PostgreSQL..."
cd "$INSTALL_DIR"
docker compose up -d

# --- 等待就绪 ---
echo "[3/3] 等待 Prefect Server 就绪..."
READY=false
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:4200/api/health >/dev/null 2>&1; then
        READY=true
        break
    fi
    echo "  等待中... ($i/30)"
    sleep 2
done

echo ""
if $READY; then
    echo "=========================================="
    echo " [02] Prefect Server 部署完成 ✓"
    echo "=========================================="
    echo " Prefect UI:   http://$(hostname -I | awk '{print $1}'):4200"
    echo " Prefect API:  http://127.0.0.1:4200/api"
    echo " PostgreSQL:   127.0.0.1:5432"
    echo ""
    echo " 下一步: sudo bash 03-setup-gateway.sh"
    echo "=========================================="
else
    echo "=========================================="
    echo " [02] WARNING: Prefect Server 未在 60s 内就绪"
    echo "=========================================="
    echo " 请检查: docker compose logs prefect-server"
    echo "=========================================="
fi
