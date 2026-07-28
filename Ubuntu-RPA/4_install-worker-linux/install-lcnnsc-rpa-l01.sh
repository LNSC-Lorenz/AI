#!/usr/bin/env bash
# ============================================================
#  Install Prefect Worker on lcnnsc-rpa-l01
#  Usage: sudo bash install-lcnnsc-rpa-l01.sh
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/setup-linux-agent.sh" ] || [ ! -d "$SCRIPT_DIR/flows" ]; then
    echo "ERROR: 缺少 setup-linux-agent.sh 或 flows/ 目录"
    echo "请将 4_install-worker-linux 下的 setup-linux-agent.sh 和 flows/ 一并上传到本目录"
    exit 1
fi

sudo bash "$SCRIPT_DIR/setup-linux-agent.sh" \
    "http://10.86.180.120:4200/api" \
    "linux-rpa-pool" \
    "lcnnsc-rpa-l01"
