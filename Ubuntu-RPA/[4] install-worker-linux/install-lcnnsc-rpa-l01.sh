#!/usr/bin/env bash
# ============================================================
#  Install Prefect Worker on lcnnsc-rpa-l01
#  Usage: sudo bash install-lcnnsc-rpa-l01.sh
# ============================================================
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

sudo bash "$SCRIPT_DIR/setup-linux-agent.sh" \
    "http://10.86.180.120:4200/api" \
    "linux-rpa-pool" \
    "lcnnsc-rpa-l01"
