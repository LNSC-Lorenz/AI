#!/bin/bash
# ============================================================
# deploy-magentic-ui.sh - Deploy Magentic-UI on Ubuntu
# ============================================================
# Installs Magentic-UI (MagenticLite) with Quicksand sandbox,
# connecting to remote Ollama on Dell DGX Spark.
#
# Run as: magentic user (non-root)
# ============================================================

set -euo pipefail

# ============================================================
# 0. Check current user
# ============================================================
if [ "$EUID" -eq 0 ]; then
    echo "ERROR: This script should NOT be run as root."
    echo "Please run as the 'magentic' user: bash deploy-magentic-ui.sh"
    echo "The script uses sudo internally where needed."
    exit 1
fi

# ============================================================
# Configuration - MODIFY THESE VALUES
# ============================================================

OLLAMA_HOST="http://10.87.5.55:11434"      # Dell DGX Spark Ollama address
ORCHESTRATOR_MODEL="qwen3.6:35b"            # Orchestrator model
BROWSER_MODEL="batiai/fara-7b:q5"           # Browser agent model
MAGENTIC_PORT=8081                           # Web UI port (external, nginx listens here)
MAGENTIC_INTERNAL_PORT=8082                  # Internal port (Magentic-UI actually listens here)
PROJECT_DIR="$HOME/magentic-lite"
OLLAMA_V1="${OLLAMA_HOST}/v1"

# ============================================================
# Colors
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }

# ============================================================
# 1. Verify Ollama connectivity
# ============================================================
log "1. Verifying Ollama connectivity at ${OLLAMA_HOST}..."

if curl -sf "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - Ollama reachable${NC}"
    curl -s "${OLLAMA_HOST}/api/tags" | grep -o '"name":"[^"]*"' | while read -r line; do
        echo "    Model: $(echo $line | cut -d'"' -f4)"
    done
else
    echo -e "  ${RED}FAIL - Cannot reach Ollama at ${OLLAMA_HOST}${NC}"
    echo "  Check: DGX Spark running, OLLAMA_HOST=0.0.0.0, firewall port 11434"
    read -p "  Continue anyway? (y/N) " -r
    [[ "$REPLY" =~ ^[Yy]$ ]] || exit 1
fi

# ============================================================
# 2. Verify Docker is running (required for Quicksand sandbox)
# ============================================================
log "2. Checking Docker..."

if ! command -v docker &>/dev/null; then
    echo -e "  ${RED}FAIL - Docker not installed${NC}"
    echo "  Please run autoinstall first or install Docker manually."
    exit 1
fi

if ! sudo systemctl is-active docker >/dev/null 2>&1; then
    echo "  Docker not running, attempting to start..."
    sudo systemctl daemon-reload
    sudo systemctl enable docker
    sudo systemctl start docker
    sleep 5
fi

if sudo systemctl is-active docker >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - Docker $(docker --version)${NC}"
else
    echo -e "  ${RED}FAIL - Docker cannot start${NC}"
    echo "  Check: sudo journalctl -u docker -n 100"
    exit 1
fi

# ============================================================
# 3. Install Python 3.12
# ============================================================
log "3. Checking Python 3.12..."

if ! command -v python3.12 &>/dev/null; then
    echo "  Installing Python 3.12..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv curl
fi
echo -e "  ${GREEN}OK - Python $(python3.12 --version)${NC}"

# ============================================================
# 4. Install uv (fast Python package manager)
# ============================================================
log "4. Installing uv..."

if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$PATH"
echo -e "  ${GREEN}OK - uv $(uv --version)${NC}"

# ============================================================
# 5. Create project directory & venv
# ============================================================
log "5. Setting up project..."

mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

if [ ! -f ".venv/bin/activate" ]; then
    rm -rf .venv 2>/dev/null || true
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate
echo -e "  ${GREEN}OK - venv activated${NC}"

# ============================================================
# 6. Install Magentic-UI
# ============================================================
log "6. Installing Magentic-UI..."

uv pip install "magentic_ui[ollama]>=0.2.0"
echo -e "  ${GREEN}OK - magentic-ui installed${NC}"

# ============================================================
# 7. Generate config.yaml
# ============================================================
log "7. Generating config.yaml..."

cat > "$PROJECT_DIR/config.yaml" << CFGEOF
model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: ${ORCHESTRATOR_MODEL}
      base_url: ${OLLAMA_V1}
      api_key: "ollama"
      temperature: 0.7
      timeout: 120
      max_retries: 3
      model_info:
        vision: false
        function_calling: true
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

  web_surfer:
    provider: OpenAIChatCompletionClient
    config:
      model: ${BROWSER_MODEL}
      base_url: ${OLLAMA_V1}
      api_key: "ollama"
      temperature: 0.7
      timeout: 120
      max_retries: 3
      model_info:
        vision: true
        function_calling: true
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

sandbox:
  type: quicksand

agent_mode: all
CFGEOF

echo "  Orchestrator: $ORCHESTRATOR_MODEL"
echo "  Browser:      $BROWSER_MODEL"
echo "  Ollama:       $OLLAMA_V1"
echo "  Sandbox:      quicksand (browser preview enabled)"
echo -e "  ${GREEN}OK - config.yaml generated${NC}"

# ============================================================
# 8. Preload Ollama models into memory
# ============================================================
log "8. Preloading Ollama models (reduces first-request latency)..."

curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${ORCHESTRATOR_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"keep_alive\": \"10m\"}" >/dev/null 2>&1 || true

curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${BROWSER_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"keep_alive\": \"10m\"}" >/dev/null 2>&1 || true

echo -e "  ${GREEN}OK - Models preloaded (or will load on first request)${NC}"

# ============================================================
# 9. Install nginx reverse proxy
# ============================================================
log "9. Installing nginx reverse proxy (solves Bad Host header)..."

if ! command -v nginx &>/dev/null; then
    echo "  Installing nginx..."
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx
fi

sudo tee /etc/nginx/sites-available/magentic-ui >/dev/null <<NGINX_EOF
server {
    listen ${MAGENTIC_PORT};
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${MAGENTIC_INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:${MAGENTIC_INTERNAL_PORT};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
NGINX_EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/magentic-ui /etc/nginx/sites-enabled/magentic-ui
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo -e "  ${GREEN}OK - nginx listening on 0.0.0.0:${MAGENTIC_PORT} -> 127.0.0.1:${MAGENTIC_INTERNAL_PORT}${NC}"

# ============================================================
# 10. Create systemd service
# ============================================================
log "10. Creating systemd service..."

sudo tee /etc/systemd/system/magentic-ui.service >/dev/null <<EOF
[Unit]
Description=Magentic-UI Web Service
After=network.target nginx.service
Wants=nginx.service

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$PROJECT_DIR/.venv/bin/magentic-ui --host 127.0.0.1 --port $MAGENTIC_INTERNAL_PORT --config $PROJECT_DIR/config.yaml
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable magentic-ui
echo -e "  ${GREEN}OK - systemd service created: magentic-ui${NC}"

# ============================================================
# 11. Test launch
# ============================================================
log "11. Testing Magentic-UI launch..."

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Magentic-UI is ready!${NC}"
echo -e "${GREEN}  Web UI: http://<server-ip>:${MAGENTIC_PORT}${NC}"
echo -e "${GREEN}  Internal: http://127.0.0.1:${MAGENTIC_INTERNAL_PORT}${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "  To start/stop:"
echo "    sudo systemctl start magentic-ui"
echo "    sudo systemctl stop magentic-ui"
echo "    sudo systemctl status magentic-ui"
echo "    journalctl -u magentic-ui -f"
echo ""

# If running interactively (not during autoinstall), launch now
if [ -t 0 ]; then
    read -p "Launch Magentic-UI now? (Y/n) " -r
    if [[ ! "$REPLY" =~ ^[Nn]$ ]]; then
        sudo systemctl restart magentic-ui
        echo ""
        echo "Waiting for Magentic-UI and Quicksand sandbox to be ready..."
        echo "(This may take 2-5 minutes on first startup while downloading sandbox images)"
        echo ""

        READY=0
        for i in $(seq 1 60); do
            if curl -sf http://127.0.0.1:${MAGENTIC_INTERNAL_PORT}/ >/dev/null 2>&1; then
                READY=1
                break
            fi
            printf "\r  Checking... %2d/60 (backend still starting)" "$i"
            sleep 10
        done
        printf "\n"

        if [ "$READY" -eq 1 ]; then
            echo -e "${GREEN}Magentic-UI is ready! Access via http://<server-ip>:${MAGENTIC_PORT}${NC}"
        else
            echo -e "${RED}Magentic-UI did not become ready within 10 minutes.${NC}"
            echo "Check the logs: journalctl -u magentic-ui -f"
        fi
    fi
fi
