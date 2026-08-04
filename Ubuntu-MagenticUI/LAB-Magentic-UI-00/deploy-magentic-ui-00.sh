#!/bin/bash
# ============================================================
# deploy-magentic-ui-00.sh - Full Magentic-UI 0.1.6 deployment
# ============================================================
# Targets: Ubuntu 24.04 LTS, Ollama remote endpoint, qwen3:32b + qwen2.5vl-fast
# Run as: magentic user (non-root)
# ============================================================

set -euo pipefail

if [ "$EUID" -eq 0 ]; then
    echo "ERROR: Run this script as the 'magentic' user, not root."
    exit 1
fi

# Configuration
OLLAMA_HOST="http://10.87.5.55:11434"
ORCHESTRATOR_MODEL="qwen3:32b"
BROWSER_MODEL="qwen2.5vl-fast"
MAGENTIC_PORT=8081
MAGENTIC_INTERNAL_PORT=8082
BRIDGE_PORT=11440
PROJECT_DIR="$HOME/magentic-lite-00"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[DEPLOY] $1"; }

# 1. Verify Ollama
log "Verifying Ollama at ${OLLAMA_HOST}..."
if curl -sf ${OLLAMA_HOST}/api/tags >/dev/null 2>&1; then
    echo "  OK - Ollama reachable"
    curl -s ${OLLAMA_HOST}/api/tags | grep -o '"name":"[^"]*"' | while read -r line; do
        echo "    Model: $(echo $line | cut -d'"' -f4)"
    done
else
    echo "  FAIL - Cannot reach Ollama at ${OLLAMA_HOST}"
    read -p "  Continue anyway? (y/N) " -r
    case $REPLY in [Yy]*) ;; *) exit 1;; esac
fi

# 2. Docker
log "Checking Docker..."
if ! command -v docker &>/dev/null; then
    echo "  FAIL - Docker not installed"
    exit 1
fi
if ! sudo systemctl is-active docker >/dev/null 2>&1; then
    sudo systemctl daemon-reload
    sudo systemctl enable docker
    sudo systemctl start docker
    sleep 5
fi
echo "  OK - Docker $(docker --version)"

# 3. KVM
log "Checking KVM..."
if [ -e /dev/kvm ]; then
    echo "  OK - /dev/kvm available"
    if [ ! -w /dev/kvm ]; then
        sudo usermod -aG kvm "$USER" 2>/dev/null || true
        sudo chmod 666 /dev/kvm 2>/dev/null || true
    fi
else
    echo "  WARNING: /dev/kvm not available. Quicksand will be slow."
    sudo modprobe kvm 2>/dev/null || true
    sudo modprobe kvm_intel 2>/dev/null || true
    sudo modprobe kvm_amd 2>/dev/null || true
    if [ -e /dev/kvm ]; then
        echo "  OK - KVM modules loaded"
    else
        echo "  Enable nested virtualization in ESXi for best performance."
        read -p "  Continue without KVM? (y/N) " -r
        case $REPLY in [Yy]*) ;; *) exit 1;; esac
    fi
fi

# 4. Python 3.12
log "Checking Python 3.12..."
if ! command -v python3.12 &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv curl
fi
echo "  OK - $(python3.12 --version)"

# 5. uv
log "Checking uv..."
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
echo "  OK - $(uv --version)"

# 6. Project + venv
log "Setting up project..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
if [ ! -f ".venv/bin/activate" ]; then
    rm -rf .venv 2>/dev/null || true
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate

# 7. Install Magentic-UI 0.1.6
log "Installing Magentic-UI 0.1.6..."
uv pip install --python .venv/bin/python "magentic_ui[ollama]==0.1.6"
# Ensure bridge deps
uv pip install --python .venv/bin/python fastapi uvicorn httpx Pillow
echo "  OK - Magentic-UI installed"

# 8. Copy bridge and config
log "Copying bridge and config..."
mkdir -p "$PROJECT_DIR/bridge"
cp "$SCRIPT_DIR/bridge-v3.py" "$PROJECT_DIR/bridge/bridge.py"
cp "$SCRIPT_DIR/config.yaml" "$PROJECT_DIR/config.yaml"
echo "  OK - bridge and config copied"

# 9. Bridge systemd service
log "Creating bridge service..."
sudo tee /etc/systemd/system/ollama-openai-bridge-00.service >/dev/null <<EOF
[Unit]
Description=Ollama OpenAI Bridge v3 (LAB-Magentic-UI-00)
After=network.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR
Environment=OLLAMA_HOST=$OLLAMA_HOST
Environment=BRIDGE_PORT=$BRIDGE_PORT
ExecStart=$PROJECT_DIR/.venv/bin/python $PROJECT_DIR/bridge/bridge.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# 10. Magentic-UI systemd service
log "Creating Magentic-UI service..."
sudo tee /etc/systemd/system/magentic-ui-00.service >/dev/null <<EOF
[Unit]
Description=Magentic-UI 0.1.6 (LAB-Magentic-UI-00)
After=network.target ollama-openai-bridge-00.service
Wants=ollama-openai-bridge-00.service

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR
Environment=OPENAI_TIMEOUT=600
ExecStart=$PROJECT_DIR/.venv/bin/magentic-ui --host 127.0.0.1 --port $MAGENTIC_INTERNAL_PORT --config $PROJECT_DIR/config.yaml
Restart=on-failure
RestartSec=5
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

# 11. nginx
log "Configuring nginx..."
if ! command -v nginx &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx
fi

sudo tee /etc/nginx/sites-available/magentic-ui-00 >/dev/null <<'NGINX_EOF'
server {
    listen 8081;
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:8082;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:8082;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_connect_timeout 60s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
NGINX_EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/magentic-ui-00 /etc/nginx/sites-enabled/magentic-ui-00
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo "  OK - nginx on 0.0.0.0:$MAGENTIC_PORT"

# 12. Start bridge
log "Starting bridge..."
sudo systemctl daemon-reload
sudo systemctl enable ollama-openai-bridge-00
sudo systemctl restart ollama-openai-bridge-00

# 13. Preload models
log "Preloading models (keep_alive=-1)..."
curl -s -X POST ${OLLAMA_HOST}/api/generate -H 'Content-Type: application/json' \
    -d '{"model":"qwen3:32b","prompt":"hi","stream":false,"options":{"num_ctx":8192},"keep_alive":"-1"}' >/dev/null 2>&1 || echo "  WARN: qwen3:32b preload timeout"
curl -s -X POST ${OLLAMA_HOST}/api/generate -H 'Content-Type: application/json' \
    -d '{"model":"qwen2.5vl-fast","prompt":"hi","stream":false,"options":{"num_ctx":16384},"keep_alive":"-1"}' >/dev/null 2>&1 || echo "  WARN: qwen2.5vl-fast preload timeout"

# 14. Start Magentic-UI
log "Starting Magentic-UI 0.1.6..."
sudo systemctl enable magentic-ui-00
sudo systemctl restart magentic-ui-00

echo ""
echo "Waiting for Magentic-UI and Quicksand to be ready..."
echo "(First startup may take 5-30 minutes while Docker images download)"
echo ""

READY=0
for i in $(seq 1 180); do
    if curl -sf http://127.0.0.1:$MAGENTIC_INTERNAL_PORT/ >/dev/null 2>&1; then
        READY=1
        break
    fi
    printf "\r  Checking... %3d/180" "$i"
    if [ $((i % 3)) -eq 0 ] && [ $i -ne 0 ]; then
        echo ""
        LAST_LOG=$(sudo journalctl -u magentic-ui-00 -n 1 --no-pager 2>/dev/null | tail -1 || true)
        [ -n "$LAST_LOG" ] && echo "  Latest log: $LAST_LOG"
    fi
    sleep 10
done
printf "\n"

if [ "$READY" -eq 1 ]; then
    echo ""
    echo "============================================"
    echo "  Magentic-UI (LAB-00) is ready!"
    echo "  Web UI: http://<server-ip>:$MAGENTIC_PORT"
    echo "  Internal: http://127.0.0.1:$MAGENTIC_INTERNAL_PORT"
    echo "============================================"
    echo ""
    echo "  Start/Stop:"
    echo "    sudo systemctl start magentic-ui-00"
    echo "    sudo systemctl stop magentic-ui-00"
    echo "    sudo systemctl status magentic-ui-00"
    echo "    sudo journalctl -u magentic-ui-00 -f"
    echo ""
    echo "  Bridge logs:"
    echo "    sudo journalctl -u ollama-openai-bridge-00 -f"
    echo ""
else
    echo "Magentic-UI did not become ready within 30 minutes."
    echo "Check logs: sudo journalctl -u magentic-ui-00 -f"
    exit 1
fi
