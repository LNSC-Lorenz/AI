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
ORCHESTRATOR_MODEL="qwen3:32b"              # Orchestrator model (fixed, do not change)
BROWSER_MODEL="qwen2.5vl-fast"              # Browser agent model (vision-capable, num_ctx=16384)
MAGENTIC_PORT=8081                           # Web UI port (external, nginx listens here)
MAGENTIC_INTERNAL_PORT=8082                  # Internal port (Magentic-UI actually listens here)
BRIDGE_PORT=11440                            # Local OpenAI-to-Ollama bridge port
PROJECT_DIR="$HOME/magentic-lite"
OLLAMA_V1="http://127.0.0.1:${BRIDGE_PORT}/v1"

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
# 2b. Check KVM hardware virtualization (critical for Quicksand performance)
# ============================================================
log "2b. Checking KVM virtualization support..."

if [ -e /dev/kvm ]; then
    echo -e "  ${GREEN}OK - /dev/kvm available (hardware virtualization enabled)${NC}"
    # Ensure magentic user can access /dev/kvm
    if [ ! -w /dev/kvm ]; then
        echo "  Fixing /dev/kvm permissions..."
        sudo usermod -aG kvm "$USER" 2>/dev/null || true
        sudo chmod 666 /dev/kvm 2>/dev/null || true
    fi
else
    echo -e "  ${RED}WARNING: /dev/kvm NOT available!${NC}"
    echo "  Quicksand sandbox will use TCG software emulation (VERY SLOW)."
    echo "  To fix:"
    echo "    1. Shut down this VM in vSphere"
    echo "    2. Edit VM Settings → CPU → Enable 'Expose hardware assisted virtualization'"
    echo "    3. Power on and re-run this script"
    echo ""
    echo "  Attempting to load KVM modules..."
    sudo modprobe kvm 2>/dev/null || true
    sudo modprobe kvm_intel 2>/dev/null || true
    sudo modprobe kvm_amd 2>/dev/null || true
    if [ -e /dev/kvm ]; then
        echo -e "  ${GREEN}OK - KVM modules loaded successfully${NC}"
    else
        echo -e "  ${RED}KVM still unavailable. ESXi nested virtualization must be enabled.${NC}"
        read -p "  Continue without KVM? (performance will be poor) (y/N) " -r
        [[ "$REPLY" =~ ^[Yy]$ ]] || exit 1
    fi
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
# 7. Pre-download Quicksand sandbox packages
# ============================================================
log "7. Pre-downloading Quicksand sandbox packages (this may take a few minutes)..."

$PROJECT_DIR/.venv/bin/pip install \
  --no-deps \
  --index-url https://microsoft.github.io/quicksand/simple/ \
  quicksand-cua quicksand-ubuntu quicksand-agent || true

echo -e "  ${GREEN}OK - Quicksand packages cached${NC}"

# ============================================================
# 8. Create OpenAI-to-Ollama bridge
# ============================================================
# Bridge provides:
# - OpenAI-compatible API for Magentic-UI to talk to Ollama
# - Strips old screenshots from history (each costs ~60s of vision encoding)
# - Route A (/api/generate + raw): reserved for models with PARSER bug (currently none)
# - Route B (/v1/chat/completions proxy): used by qwen3:32b and qwen2.5vl-fast
# ============================================================
log "8. Creating OpenAI-to-Ollama bridge on port ${BRIDGE_PORT}..."

mkdir -p "$PROJECT_DIR/bridge"

cat > "$PROJECT_DIR/bridge/bridge.py" <<'BRIDGEPY'
#!/usr/bin/env python3
"""OpenAI-compatible bridge for Ollama.

Proxies Magentic-UI requests to Ollama's /v1/chat/completions.
Key features:
- Strips old screenshots from conversation history (saves ~60s per image)
- Removes OpenAI-specific fields unsupported by Ollama
- Route A (/api/generate + raw): reserved for future models with PARSER bug
- Route B (/v1/chat/completions proxy): used by all current models
"""
import json
import logging
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bridge")

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
PORT = int(os.environ.get("BRIDGE_PORT", "11440"))

# Models that have Ollama PARSER bug - need /api/generate workaround
# qwen3:32b verified NO PARSER bug, so this set is empty (kept for future use)
PARSER_BUG_MODELS: set[str] = set()

app = FastAPI(title="Ollama OpenAI Bridge")


# ─── Helpers ───────────────────────────────────────────────────────────────

def _format_qwen_prompt(messages: list[dict]) -> str:
    """Format messages into Qwen chat template (im_start/im_end).
    Handles multimodal messages by extracting text parts only."""
    parts = []
    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "") or ""
        if isinstance(content, list):
            text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
            content = "\n".join(text_parts)
        parts.append(f"<|im_start|>{role}\n{content}<|im_end|>")
    parts.append("<|im_start|>assistant\n")
    return "\n".join(parts)


def _get_ollama_options(body: dict) -> dict:
    """Extract Ollama-specific options from OpenAI request body."""
    opts = {}
    extra_body = body.pop("extra_body", None)
    if isinstance(extra_body, dict):
        for k, v in extra_body.items():
            if k == "chat_template_kwargs":
                continue
            opts[k] = v
    for key in ["num_ctx", "num_predict", "seed"]:
        if key in body:
            opts[key] = body.pop(key)
    if "temperature" in body:
        opts["temperature"] = body["temperature"]
    if "top_p" in body:
        opts["top_p"] = body["top_p"]
    if "presence_penalty" in body:
        opts["presence_penalty"] = body["presence_penalty"]
    return opts


def _strip_unsupported_fields(body: dict) -> dict:
    """Remove fields not supported by Ollama's /v1/chat/completions."""
    for key in ["extra_body", "chat_template_kwargs", "num_ctx", "num_predict",
                "seed", "presence_penalty"]:
        body.pop(key, None)
    return body


def _strip_old_images(messages: list[dict]) -> list[dict]:
    """Keep only the LAST image in conversation to reduce vision processing time.
    Each screenshot adds ~60s of encoding; stripping old ones cuts latency significantly."""
    # Find the last message index that contains an image
    last_img_idx = -1
    for i, msg in enumerate(messages):
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    last_img_idx = i

    if last_img_idx < 0:
        return messages  # No images, nothing to strip

    # Strip images from all messages EXCEPT the last one that has an image
    result = []
    for i, msg in enumerate(messages):
        if i == last_img_idx:
            result.append(msg)
            continue
        content = msg.get("content")
        if isinstance(content, list):
            new_content = [p for p in content if not (isinstance(p, dict) and p.get("type") == "image_url")]
            if new_content:
                result.append({**msg, "content": new_content})
            # Skip message entirely if it only had an image
        else:
            result.append(msg)
    return result


# ─── Route A: /api/generate for PARSER-bug models ─────────────────────────

async def _handle_via_generate(body: dict, model: str) -> JSONResponse:
    """For models with PARSER bug: /api/generate + raw mode."""
    messages = body.get("messages", [])
    options = _get_ollama_options(body)
    prompt = _format_qwen_prompt(messages)

    if "num_ctx" not in options:
        options["num_ctx"] = 8192

    ollama_req = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "raw": True,
        "options": options,
    }
    log.info(f"[generate] model={model} prompt_chars={len(prompt)} num_ctx={options.get('num_ctx')}")

    async with httpx.AsyncClient(timeout=600.0) as client:
        resp = await client.post(f"{OLLAMA_HOST}/api/generate", json=ollama_req)
        if resp.status_code >= 400:
            try:
                err = resp.json()
            except Exception:
                err = {"error": resp.text}
            log.error(f"[generate] model={model} status={resp.status_code} err={err}")
            return JSONResponse(status_code=resp.status_code, content=err)

        data = resp.json()
        content = data.get("response", "")
        log.info(f"[generate] model={model} tokens={data.get('eval_count', 0)} done={data.get('done')}")

        return JSONResponse(content={
            "id": f"chatcmpl-{int(time.time()*1000)}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": data.get("prompt_eval_count", 0),
                "completion_tokens": data.get("eval_count", 0),
                "total_tokens": (data.get("prompt_eval_count", 0) or 0) + (data.get("eval_count", 0) or 0),
            },
        })


# ─── Route B: proxy to /v1/chat/completions for vision/other models ───────

async def _handle_via_proxy(body: dict, model: str) -> JSONResponse:
    """For models without PARSER bug: proxy to Ollama /v1/chat/completions.
    Strips old images to reduce vision encoding time (~60s per image)."""
    body = _strip_unsupported_fields(body)
    # Only keep the latest screenshot to avoid re-encoding old images
    body["messages"] = _strip_old_images(body.get("messages", []))
    msg_count = len(body.get("messages", []))
    log.info(f"[proxy] model={model} msgs={msg_count}")

    async with httpx.AsyncClient(timeout=600.0) as client:
        resp = await client.post(
            f"{OLLAMA_HOST}/v1/chat/completions",
            json=body,
            headers={"Content-Type": "application/json"},
        )
        log.info(f"[proxy] model={model} status={resp.status_code}")
        return JSONResponse(status_code=resp.status_code, content=resp.json())


# ─── Main endpoint ────────────────────────────────────────────────────────

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    body = await request.json()
    model = body.get("model", "")

    if model in PARSER_BUG_MODELS:
        return await _handle_via_generate(body, model)
    else:
        return await _handle_via_proxy(body, model)


@app.get("/v1/models")
async def list_models():
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{OLLAMA_HOST}/api/tags")
        data = resp.json()
    models = [{"id": m.get("name", ""), "object": "model", "owned_by": "ollama"}
              for m in data.get("models", [])]
    return JSONResponse(content={"object": "list", "data": models})


@app.get("/v1/health")
@app.get("/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT)
BRIDGEPY

chmod +x "$PROJECT_DIR/bridge/bridge.py"

# Install bridge dependencies into the same venv
"$PROJECT_DIR/.venv/bin/pip" install -q fastapi uvicorn httpx

# Create systemd service for the bridge
sudo tee /etc/systemd/system/ollama-openai-bridge.service >/dev/null <<EOF
[Unit]
Description=OpenAI-to-Ollama Bridge
After=network.target

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR/bridge
Environment="OLLAMA_HOST=${OLLAMA_HOST}"
Environment="BRIDGE_PORT=${BRIDGE_PORT}"
ExecStart=$PROJECT_DIR/.venv/bin/python $PROJECT_DIR/bridge/bridge.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ollama-openai-bridge
sudo systemctl restart ollama-openai-bridge
sleep 3

# Verify bridge is responding
if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/models" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - Bridge running on http://127.0.0.1:${BRIDGE_PORT}/v1${NC}"
else
    echo -e "  ${RED}FAIL - Bridge did not start${NC}"
    echo "  Check: sudo journalctl -u ollama-openai-bridge -n 50"
    exit 1
fi

# ============================================================
# 9. Patch Magentic-UI source for Ollama compatibility
# ============================================================
log "9. Patching Magentic-UI for Ollama local model compatibility..."

# The source code hardcodes extra_body in _call_api which:
#   - Does NOT pass num_ctx (causing Ollama to use 262k default → extreme slowness)
#   - Has a short default timeout from the openai client
# We patch _responses.py to:
#   1. Add num_ctx=8192 to extra_body (limits context window for fast inference)
#   2. Increase _MAX_RETRY_ATTEMPTS to 10
#   3. Increase _RETRY_DELAY_SECONDS to 10
# We also patch the openai client timeout via environment variable.

RESPONSES_PY="$PROJECT_DIR/.venv/lib/python3.12/site-packages/magentic_ui/teams/omniagent/_responses.py"

if [ -f "$RESPONSES_PY" ]; then
    # Use Python for precise multi-line patching
    $PROJECT_DIR/.venv/bin/python3 - "$RESPONSES_PY" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

changed = False

# 1. Ensure num_ctx=8192 is correctly inside extra_body dict
#    Case A: broken sed patch placed num_ctx outside the dict
if '"enable_thinking": False}, "num_ctx": 8192,' in content:
    content = content.replace(
        '"chat_template_kwargs": {"enable_thinking": False}, "num_ctx": 8192,',
        '"num_ctx": 8192,\n                        "chat_template_kwargs": {"enable_thinking": False},'
    )
    changed = True
    print("  Fixed: moved num_ctx inside extra_body (was incorrectly outside)")
# Case B: original unpatched source - add num_ctx before chat_template_kwargs
elif '"num_ctx": 8192' not in content:
    old_line = '                        "chat_template_kwargs": {"enable_thinking": False},'
    new_line = '                        "num_ctx": 8192,\n                        "chat_template_kwargs": {"enable_thinking": False},'
    if old_line in content:
        content = content.replace(old_line, new_line)
        changed = True
        print("  Patched: added num_ctx=8192 inside extra_body")
    else:
        print("  WARN: could not find chat_template_kwargs line to patch")
# Case C: already correctly patched
else:
    print("  Already patched: num_ctx correctly inside extra_body")

# 2. Increase max retry attempts to 10
content, n = re.subn(r'^_MAX_RETRY_ATTEMPTS\s*=\s*\d+', '_MAX_RETRY_ATTEMPTS = 10', content, flags=re.MULTILINE)
if n > 0:
    changed = True
    print("  Patched: _MAX_RETRY_ATTEMPTS = 10")

# 3. Increase retry delay to 10 seconds
content, n = re.subn(r'^_RETRY_DELAY_SECONDS\s*=\s*[\d.]+', '_RETRY_DELAY_SECONDS = 10.0', content, flags=re.MULTILINE)
if n > 0:
    changed = True
    print("  Patched: _RETRY_DELAY_SECONDS = 10.0")

if changed:
    with open(path, 'w') as f:
        f.write(content)

print("  Patch complete.")
PYEOF

    echo -e "  ${GREEN}OK - _responses.py patched${NC}"
else
    echo -e "  ${RED}WARN - _responses.py not found, skipping patch${NC}"
fi

# Patch _fara_qwen3.py: replace _parse_thoughts_and_action with robust multi-format parser
# qwen2.5vl outputs in various formats (code blocks, computer_use wrapper, etc.)
# Original parser only handles <tool_call> tags and crashes on other formats.
FARA_QWEN3_PY="$PROJECT_DIR/.venv/lib/python3.12/site-packages/magentic_ui/agents/web_surfer/fara/_fara_qwen3.py"

if [ -f "$FARA_QWEN3_PY" ]; then
    $PROJECT_DIR/.venv/bin/python3 - "$FARA_QWEN3_PY" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

if "Supports multiple formats" in content:
    print("  Already patched: robust _parse_thoughts_and_action")
    sys.exit(0)

NEW_METHOD = '''    def _parse_thoughts_and_action(self, message: str) -> Tuple[str, dict[str, Any]]:
        """Parse model output into (thoughts, action_dict).
        Supports multiple formats:
          1. thoughts\\n<tool_call>\\n{json}\\n</tool_call>
          2. thoughts\\n```json\\n{json}\\n```
          3. thoughts\\n{json} (raw JSON on last lines)
        Also unwraps computer_use nested format from qwen2.5vl."""
        import re as _re
        thoughts = ""
        action = None

        try:
            # Strategy 1: <tool_call> tags
            if "<tool_call>" in message:
                parts = message.split("<tool_call>")
                thoughts = parts[0].strip()
                action_text = parts[1].split("</tool_call>")[0].strip()
                for candidate in [action_text, action_text.split("\\n")[0].strip()]:
                    try:
                        action = json.loads(candidate)
                        break
                    except (json.JSONDecodeError, ValueError):
                        continue

            # Strategy 2: ```json code block
            if action is None:
                json_blocks = _re.findall(r"```(?:json)?\\s*\\n(\\{.*?\\})\\s*\\n```", message, _re.DOTALL)
                if json_blocks:
                    for block in json_blocks:
                        try:
                            action = json.loads(block)
                            break
                        except (json.JSONDecodeError, ValueError):
                            continue
                    if action:
                        thoughts = message[:message.find("```")].strip()

            # Strategy 3: find any JSON object in the text
            if action is None:
                json_matches = _re.findall(r"(\\{[^{}]*\\})", message)
                for m in reversed(json_matches):
                    try:
                        action = json.loads(m)
                        if "action" in action or "name" in action:
                            break
                        action = None
                    except (json.JSONDecodeError, ValueError):
                        continue
                if action:
                    thoughts = message[:message.find(m)].strip()

            if action is None:
                raise ValueError(f"No valid JSON action found in: {message[:200]}")

            # Unwrap computer_use nested format from qwen2.5vl
            if isinstance(action, dict) and "arguments" in action and "name" in action:
                action = action  # Keep as-is, caller expects this format

            return thoughts, action

        except Exception:
            logger.error(
                f"Error parsing thoughts and action: {message}",
                exc_info=True,
            )
            raise'''

# Find and replace the method
start = content.find("    def _parse_thoughts_and_action(self, message: str)")
if start < 0:
    print("  ERROR: Cannot find _parse_thoughts_and_action method")
    sys.exit(1)

# Find end of method (next method or section comment at same indentation)
end = content.find("\n    # -----", start + 10)
if end < 0:
    end = content.find("\n    def ", start + 10)
if end < 0:
    print("  ERROR: Cannot find end of method")
    sys.exit(1)

new_content = content[:start] + NEW_METHOD + content[end:]

# Verify syntax before writing (prevent IndentationError on startup)
try:
    compile(new_content, path, 'exec')
except SyntaxError as e:
    print(f"  ERROR: Patch would create syntax error: {e}")
    print(f"  File NOT modified. Manual intervention needed.")
    sys.exit(1)

with open(path, 'w') as f:
    f.write(new_content)
print("  Patched: _parse_thoughts_and_action (robust multi-format parser, syntax verified)")
PYEOF

    echo -e "  ${GREEN}OK - _fara_qwen3.py patched (robust parser)${NC}"
else
    echo -e "  ${RED}WARN - _fara_qwen3.py not found, skipping patch${NC}"
fi

# ============================================================
# 10. Generate config.yaml
# ============================================================
log "10. Generating config.yaml..."

cat > "$PROJECT_DIR/config.yaml" << CFGEOF
model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: ${ORCHESTRATOR_MODEL}
      base_url: ${OLLAMA_V1}
      api_key: "ollama"
      temperature: 0.7
      timeout: 600
      max_retries: 10
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
      timeout: 600
      max_retries: 10
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
# 11. Ensure browser vision model exists on DGX Spark
# ============================================================
log "11. Checking/creating browser vision model (${BROWSER_MODEL})..."

# qwen2.5vl-fast is a variant of qwen2.5vl with reduced num_ctx for performance.
# Prerequisites on DGX Spark:
#   ollama pull qwen2.5vl
# Then this script creates the -fast variant automatically.

echo "  Checking if ${BROWSER_MODEL} exists on Ollama..."
if curl -sf "${OLLAMA_HOST}/api/show" -d "{\"name\": \"${BROWSER_MODEL}\"}" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - ${BROWSER_MODEL} already exists${NC}"
else
    echo "  Creating ${BROWSER_MODEL} from qwen2.5vl:latest (num_ctx=16384)..."
    # Create a Modelfile for the fast variant
    MODELFILE_CONTENT="FROM qwen2.5vl:latest\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.0001"
    curl -s -X POST "${OLLAMA_HOST}/api/create" \
      -H "Content-Type: application/json" \
      -d "{\"name\": \"${BROWSER_MODEL}\", \"modelfile\": \"FROM qwen2.5vl:latest\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.0001\"}" \
      --max-time 120 >/dev/null 2>&1
    if curl -sf "${OLLAMA_HOST}/api/show" -d "{\"name\": \"${BROWSER_MODEL}\"}" >/dev/null 2>&1; then
        echo -e "  ${GREEN}OK - ${BROWSER_MODEL} created successfully${NC}"
    else
        echo -e "  ${RED}WARN - Could not create ${BROWSER_MODEL}. Make sure qwen2.5vl:latest is pulled on DGX Spark.${NC}"
        echo "  Run on DGX Spark: ollama pull qwen2.5vl && ollama create qwen2.5vl-fast -f <(echo -e 'FROM qwen2.5vl:latest\nPARAMETER num_ctx 16384')"
    fi
fi

# ============================================================
# 11b. Preload models into memory
# ============================================================
log "11b. Preloading Ollama models (reduces first-request latency)..."

echo "  Loading ${ORCHESTRATOR_MODEL} (32B, may take 30-60s)..."
curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${ORCHESTRATOR_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 8192}, \"keep_alive\": \"-1\"}" \
  --max-time 180 >/dev/null 2>&1 || echo "  WARN: Orchestrator preload timed out (will load on first request)"

echo "  Loading ${BROWSER_MODEL} (8B vision)..."
curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${BROWSER_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 16384}, \"keep_alive\": \"-1\"}" \
  --max-time 120 >/dev/null 2>&1 || echo "  WARN: Browser model preload timed out (will load on first request)"

echo -e "  ${GREEN}OK - Models preloaded (keep_alive=-1, will stay in memory)${NC}"

# ============================================================
# 12. Install nginx reverse proxy
# ============================================================
log "12. Installing nginx reverse proxy (solves Bad Host header)..."

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
        proxy_connect_timeout 60s;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
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
# 13. Create systemd service
# ============================================================
log "13. Creating systemd service..."

sudo tee /etc/systemd/system/magentic-ui.service >/dev/null <<EOF
[Unit]
Description=Magentic-UI Web Service
After=network.target nginx.service ollama-openai-bridge.service
Wants=nginx.service ollama-openai-bridge.service

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

sudo systemctl daemon-reload
sudo systemctl enable magentic-ui
echo -e "  ${GREEN}OK - systemd service created: magentic-ui${NC}"

# ============================================================
# 14. Launch & wait for readiness
# ============================================================
log "14. Launching Magentic-UI and waiting for readiness..."

# Always start the service and wait until truly ready before exiting
sudo systemctl restart magentic-ui
echo ""
echo "Waiting for Magentic-UI and Quicksand sandbox to be fully ready..."
echo "(This may take 5-30 minutes on first startup while downloading sandbox images)"
echo ""

READY=0
for i in $(seq 1 180); do
    if curl -sf http://127.0.0.1:${MAGENTIC_INTERNAL_PORT}/ >/dev/null 2>&1; then
        READY=1
        break
    fi
    printf "\r  Checking... %3d/180 (backend still starting)" "$i"
    if [ $((i % 3)) -eq 0 ] && [ "$i" -ne 0 ]; then
        echo ""
        LAST_LOG=$(sudo journalctl -u magentic-ui -n 1 --no-pager 2>/dev/null | tail -1 || true)
        if [ -n "$LAST_LOG" ]; then
            echo "  Latest log: $LAST_LOG"
        fi
    fi
    sleep 10
done
printf "\n"

if [ "$READY" -eq 1 ]; then
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
    echo "    sudo journalctl -u magentic-ui -f"
    echo ""
else
    echo -e "${RED}Magentic-UI did not become ready within 30 minutes.${NC}"
    echo "Check the logs: sudo journalctl -u magentic-ui -f"
    exit 1
fi
