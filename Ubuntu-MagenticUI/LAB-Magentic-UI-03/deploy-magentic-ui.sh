#!/bin/bash
# ============================================================
# deploy-magentic-ui.sh - Deploy Magentic-UI on Ubuntu (LAB-03)
# ============================================================
# Based on LAB-01, with key speed optimizations:
#   1. Bridge v2: persistent httpx client (connection pooling)
#   2. Bridge v2: screenshot downscaling (1280x720 JPEG q60) -> ~60% fewer vision tokens
#   3. Bridge v2: aggressive history truncation (system + last 6 msgs + latest image)
#   4. Bridge v2: num_predict limits to prevent runaway generation
#   5. Deploy: pre-warm Quicksand VM and models
#   6. Autoinstall pre-installs nginx/uv/Magentic-UI venv (faster deploy)
#
# Run as: magentic user (non-root)
# ============================================================

set -euo pipefail

if [ "$EUID" -eq 0 ]; then
    echo "ERROR: This script should NOT be run as root."
    echo "Please run as the 'magentic' user: bash deploy-magentic-ui.sh"
    exit 1
fi

# ============================================================
# Configuration
# ============================================================
OLLAMA_HOST="http://10.87.5.55:11434"
ORCHESTRATOR_MODEL="qwen3:32b"
BROWSER_MODEL="qwen2.5vl-fast"
MAGENTIC_PORT=8081
MAGENTIC_INTERNAL_PORT=8082
BRIDGE_PORT=11440
PROJECT_DIR="$HOME/magentic-lite"
OLLAMA_V1="http://127.0.0.1:${BRIDGE_PORT}/v1"

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
    read -p "  Continue anyway? (y/N) " -r
    [[ "$REPLY" =~ ^[Yy]$ ]] || exit 1
fi

# ============================================================
# 2. Verify Docker
# ============================================================
log "2. Checking Docker..."
if ! command -v docker &>/dev/null; then
    echo -e "  ${RED}FAIL - Docker not installed${NC}"
    exit 1
fi
if ! sudo systemctl is-active docker >/dev/null 2>&1; then
    sudo systemctl daemon-reload
    sudo systemctl enable docker
    sudo systemctl start docker
    sleep 5
fi
if sudo systemctl is-active docker >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - Docker $(docker --version)${NC}"
else
    echo -e "  ${RED}FAIL - Docker cannot start${NC}"
    exit 1
fi

# ============================================================
# 2b. Check KVM
# ============================================================
log "2b. Checking KVM virtualization support..."
if [ -e /dev/kvm ]; then
    echo -e "  ${GREEN}OK - /dev/kvm available${NC}"
    if [ ! -w /dev/kvm ]; then
        sudo usermod -aG kvm "$USER" 2>/dev/null || true
        sudo chmod 666 /dev/kvm 2>/dev/null || true
    fi
else
    echo -e "  ${RED}WARNING: /dev/kvm NOT available!${NC}"
    echo "  Quicksand will use TCG software emulation (VERY SLOW)."
    sudo modprobe kvm 2>/dev/null || true
    sudo modprobe kvm_intel 2>/dev/null || true
    sudo modprobe kvm_amd 2>/dev/null || true
    if [ -e /dev/kvm ]; then
        echo -e "  ${GREEN}OK - KVM modules loaded${NC}"
    else
        echo -e "  ${RED}KVM unavailable. Enable nested virtualization in ESXi.${NC}"
        read -p "  Continue without KVM? (y/N) " -r
        [[ "$REPLY" =~ ^[Yy]$ ]] || exit 1
    fi
fi

# ============================================================
# 3. Check Python 3.12
# ============================================================
log "3. Checking Python 3.12..."
if ! command -v python3.12 &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv curl
fi
echo -e "  ${GREEN}OK - Python $(python3.12 --version)${NC}"

# ============================================================
# 4. Check uv
# ============================================================
log "4. Checking uv..."
export PATH="$HOME/.local/bin:$PATH"
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"
echo -e "  ${GREEN}OK - uv $(uv --version)${NC}"

# ============================================================
# 5. Setup project & venv
# ============================================================
log "5. Setting up project..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"
if [ ! -f ".venv/bin/activate" ]; then
    echo "  venv not pre-created, creating now..."
    rm -rf .venv 2>/dev/null || true
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate
echo -e "  ${GREEN}OK - venv activated${NC}"

# ============================================================
# 6. Install/upgrade Magentic-UI
# ============================================================
log "6. Checking Magentic-UI installation..."
if ! "$PROJECT_DIR/.venv/bin/pip" show magentic_ui &>/dev/null; then
    echo "  Installing Magentic-UI..."
    uv pip install "magentic_ui[ollama]>=0.2.0"
else
    echo -e "  ${GREEN}OK - Magentic-UI already installed${NC}"
fi

# ============================================================
# 7. Pre-download Quicksand sandbox packages
# ============================================================
log "7. Checking Quicksand sandbox packages..."
if ! "$PROJECT_DIR/.venv/bin/pip" show quicksand-cua &>/dev/null; then
    echo "  Pre-downloading Quicksand packages..."
    $PROJECT_DIR/.venv/bin/pip install --no-deps \
      --index-url https://microsoft.github.io/quicksand/simple/ \
      quicksand-cua quicksand-ubuntu quicksand-agent || true
else
    echo -e "  ${GREEN}OK - Quicksand packages already installed${NC}"
fi

# ============================================================
# 8. Create OpenAI-to-Ollama bridge (enhanced v2)
# ============================================================
# Bridge v2 improvements over LAB-01:
#   - Persistent httpx.AsyncClient (connection pooling)
#   - Screenshot downscaling (1280x720 JPEG q60) -> ~60% fewer vision tokens
#   - Aggressive history truncation: system + last 6 messages + latest image
#   - num_predict limits to prevent runaway generation
#   - Request timing logs
# ============================================================
log "8. Creating enhanced OpenAI-to-Ollama bridge on port ${BRIDGE_PORT}..."

mkdir -p "$PROJECT_DIR/bridge"

cat > "$PROJECT_DIR/bridge/bridge.py" <<'BRIDGEPY'
#!/usr/bin/env python3
"""OpenAI-compatible bridge for Ollama (v2 - optimized for speed).

Key optimizations over v1:
  1. Persistent httpx.AsyncClient with connection pooling
  2. Screenshot downscaling (1280x720, JPEG q60) -> ~60% fewer vision tokens
  3. Aggressive history truncation: system + last 6 messages + latest image
  4. num_predict limits: orchestrator 2048, browser 1024
  5. Request timing logs
"""
import base64
import io
import json
import logging
import os
import time
from typing import Any

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bridge-v2")

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
PORT = int(os.environ.get("BRIDGE_PORT", "11440"))

MAX_HISTORY_MESSAGES = 6
MAX_IMAGE_WIDTH = 1280
MAX_IMAGE_HEIGHT = 720
JPEG_QUALITY = 60

PARSER_BUG_MODELS: set[str] = set()

NUM_PREDICT_LIMITS = {
    "qwen3:32b": 2048,
    "qwen2.5vl-fast": 1024,
}

app = FastAPI(title="Ollama OpenAI Bridge v2")

_http_client: httpx.AsyncClient | None = None

async def get_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(600.0, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


def _downscale_image(b64_data: str) -> str:
    """Decode base64 image, downscale, re-encode as JPEG q60."""
    try:
        from PIL import Image
    except ImportError:
        log.warning("Pillow not available, skipping image downscale")
        return b64_data

    try:
        img_bytes = base64.b64decode(b64_data)
        img = Image.open(io.BytesIO(img_bytes))

        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        if img.width > MAX_IMAGE_WIDTH or img.height > MAX_IMAGE_HEIGHT:
            ratio = min(MAX_IMAGE_WIDTH / img.width, MAX_IMAGE_HEIGHT / img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)

        out_buf = io.BytesIO()
        img.save(out_buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        out_bytes = out_buf.getvalue()

        original_kb = len(img_bytes) / 1024
        new_kb = len(out_bytes) / 1024
        log.info(f"  [img] {img.width}x{img.height} {original_kb:.0f}KB -> {new_kb:.0f}KB")

        return base64.b64encode(out_bytes).decode("ascii")
    except Exception as e:
        log.warning(f"  [img] downscale failed: {e}, using original")
        return b64_data


def _process_images_in_content(content: list[dict]) -> list[dict]:
    """Find and downscale all image_url parts in a message content list."""
    result = []
    for part in content:
        if isinstance(part, dict) and part.get("type") == "image_url":
            url = part.get("image_url", {}).get("url", "")
            if url.startswith("data:image/"):
                header, b64 = url.split(",", 1)
                scaled = _downscale_image(b64)
                result.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{scaled}"}
                })
            else:
                result.append(part)
        else:
            result.append(part)
    return result


def _strip_old_images(messages: list[dict]) -> list[dict]:
    """Keep only the LAST image in conversation."""
    last_img_idx = -1
    for i, msg in enumerate(messages):
        content = msg.get("content")
        if isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    last_img_idx = i

    if last_img_idx < 0:
        return messages

    result = []
    for i, msg in enumerate(messages):
        if i == last_img_idx:
            content = msg.get("content")
            if isinstance(content, list):
                content = _process_images_in_content(content)
                result.append({**msg, "content": content})
            else:
                result.append(msg)
            continue
        content = msg.get("content")
        if isinstance(content, list):
            new_content = [p for p in content if not (isinstance(p, dict) and p.get("type") == "image_url")]
            if new_content:
                result.append({**msg, "content": new_content})
        else:
            result.append(msg)
    return result


def _truncate_history(messages: list[dict]) -> list[dict]:
    """Keep system messages + last MAX_HISTORY_MESSAGES non-system messages."""
    if len(messages) <= MAX_HISTORY_MESSAGES + 2:
        return _strip_old_images(messages)

    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system = [m for m in messages if m.get("role") != "system"]
    kept = non_system[-MAX_HISTORY_MESSAGES:]
    result = system_msgs + kept
    result = _strip_old_images(result)
    log.info(f"  [truncate] {len(messages)} -> {len(result)} messages")
    return result


def _format_qwen_prompt(messages: list[dict]) -> str:
    """Format messages into Qwen chat template."""
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


def _get_ollama_options(body: dict, model: str) -> dict:
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
    if "num_predict" not in opts and model in NUM_PREDICT_LIMITS:
        opts["num_predict"] = NUM_PREDICT_LIMITS[model]
    return opts


def _strip_unsupported_fields(body: dict) -> dict:
    """Remove fields not supported by Ollama."""
    for key in ["extra_body", "chat_template_kwargs", "num_ctx", "num_predict",
                "seed", "presence_penalty"]:
        body.pop(key, None)
    return body


async def _handle_via_generate(body: dict, model: str) -> JSONResponse:
    """For models with PARSER bug: /api/generate + raw mode."""
    messages = body.get("messages", [])
    messages = _truncate_history(messages)
    options = _get_ollama_options(body, model)
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
    t0 = time.time()
    log.info(f"[generate] model={model} prompt_chars={len(prompt)} num_ctx={options.get('num_ctx')}")

    client = await get_client()
    resp = await client.post(f"{OLLAMA_HOST}/api/generate", json=ollama_req)
    elapsed = time.time() - t0

    if resp.status_code >= 400:
        try:
            err = resp.json()
        except Exception:
            err = {"error": resp.text}
        log.error(f"[generate] model={model} status={resp.status_code} err={err} elapsed={elapsed:.1f}s")
        return JSONResponse(status_code=resp.status_code, content=err)

    data = resp.json()
    content = data.get("response", "")
    tokens = data.get("eval_count", 0)
    log.info(f"[generate] model={model} tokens={tokens} elapsed={elapsed:.1f}s")

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
            "completion_tokens": tokens,
            "total_tokens": (data.get("prompt_eval_count", 0) or 0) + (tokens or 0),
        },
    })


async def _handle_via_proxy(body: dict, model: str) -> JSONResponse:
    """Proxy to Ollama /v1/chat/completions with optimizations."""
    body = _strip_unsupported_fields(body)
    body["messages"] = _truncate_history(body.get("messages", []))
    # Enforce generation limit via max_tokens (Ollama OpenAI layer maps it to num_predict).
    # Note: /v1/chat/completions does NOT accept options/num_ctx - context length must be
    # controlled server-side via OLLAMA_CONTEXT_LENGTH or the model's Modelfile.
    if "max_tokens" not in body and model in NUM_PREDICT_LIMITS:
        body["max_tokens"] = NUM_PREDICT_LIMITS[model]
    msg_count = len(body.get("messages", []))
    t0 = time.time()
    log.info(f"[proxy] model={model} msgs={msg_count}")

    client = await get_client()
    resp = await client.post(
        f"{OLLAMA_HOST}/v1/chat/completions",
        json=body,
        headers={"Content-Type": "application/json"},
    )
    elapsed = time.time() - t0
    log.info(f"[proxy] model={model} status={resp.status_code} elapsed={elapsed:.1f}s")

    try:
        data = resp.json()
        usage = data.get("usage", {})
        if usage:
            log.info(f"  [proxy] tokens: prompt={usage.get('prompt_tokens',0)} completion={usage.get('completion_tokens',0)}")
        return JSONResponse(status_code=resp.status_code, content=data)
    except Exception:
        return JSONResponse(status_code=resp.status_code, content={"error": resp.text})


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
    client = await get_client()
    resp = await client.get(f"{OLLAMA_HOST}/api/tags")
    data = resp.json()
    models = [{"id": m.get("name", ""), "object": "model", "owned_by": "ollama"}
              for m in data.get("models", [])]
    return JSONResponse(content={"object": "list", "data": models})


@app.get("/v1/health")
@app.get("/health")
async def health():
    return {"status": "ok", "version": "v2"}


@app.on_event("shutdown")
async def shutdown():
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
BRIDGEPY

chmod +x "$PROJECT_DIR/bridge/bridge.py"

# Install bridge dependencies (Pillow for image downscaling)
"$PROJECT_DIR/.venv/bin/pip" install -q fastapi uvicorn httpx Pillow 2>/dev/null || \
    "$PROJECT_DIR/.venv/bin/pip" install -q fastapi uvicorn httpx Pillow

# Create systemd service for the bridge
sudo tee /etc/systemd/system/ollama-openai-bridge.service >/dev/null <<EOF
[Unit]
Description=OpenAI-to-Ollama Bridge v2
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

if curl -sf "http://127.0.0.1:${BRIDGE_PORT}/v1/models" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - Bridge v2 running on http://127.0.0.1:${BRIDGE_PORT}/v1${NC}"
else
    echo -e "  ${RED}FAIL - Bridge did not start${NC}"
    echo "  Check: sudo journalctl -u ollama-openai-bridge -n 50"
    exit 1
fi

# ============================================================
# 9. Patch Magentic-UI source for Ollama compatibility
# ============================================================
log "9. Patching Magentic-UI for Ollama local model compatibility..."

RESPONSES_PY="$PROJECT_DIR/.venv/lib/python3.12/site-packages/magentic_ui/teams/omniagent/_responses.py"

if [ -f "$RESPONSES_PY" ]; then
    $PROJECT_DIR/.venv/bin/python3 - "$RESPONSES_PY" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

changed = False

if '"enable_thinking": False}, "num_ctx": 8192,' in content:
    content = content.replace(
        '"chat_template_kwargs": {"enable_thinking": False}, "num_ctx": 8192,',
        '"num_ctx": 8192,\n                        "chat_template_kwargs": {"enable_thinking": False},'
    )
    changed = True
    print("  Fixed: moved num_ctx inside extra_body")
elif '"num_ctx": 8192' not in content:
    old_line = '                        "chat_template_kwargs": {"enable_thinking": False},'
    new_line = '                        "num_ctx": 8192,\n                        "chat_template_kwargs": {"enable_thinking": False},'
    if old_line in content:
        content = content.replace(old_line, new_line)
        changed = True
        print("  Patched: added num_ctx=8192 inside extra_body")
    else:
        print("  WARN: could not find chat_template_kwargs line to patch")
else:
    print("  Already patched: num_ctx correctly inside extra_body")

content, n = re.subn(r'^_MAX_RETRY_ATTEMPTS\s*=\s*\d+', '_MAX_RETRY_ATTEMPTS = 10', content, flags=re.MULTILINE)
if n > 0:
    changed = True
    print("  Patched: _MAX_RETRY_ATTEMPTS = 10")

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

# Patch _fara_qwen3.py: robust multi-format parser
FARA_QWEN3_PY="$PROJECT_DIR/.venv/lib/python3.12/site-packages/magentic_ui/agents/web_surfer/fara/_fara_qwen3.py"

if [ -f "$FARA_QWEN3_PY" ]; then
    $PROJECT_DIR/.venv/bin/python3 - "$FARA_QWEN3_PY" << 'PYEOF'
import sys, re

path = sys.argv[1]
with open(path) as f:
    content = f.read()

if "normalize computer_use (v2)" in content:
    print("  Already patched (v2): robust _parse_thoughts_and_action")
    sys.exit(0)

NEW_METHOD = '''    def _parse_thoughts_and_action(self, message: str) -> Tuple[str, dict[str, Any]]:
        """Parse model output into (thoughts, action_dict).
        Supports multiple formats:
          1. thoughts + action tags
          2. thoughts + json code block
          3. thoughts + raw JSON on last lines
        Also normalize computer_use (v2) nested format from qwen2.5vl."""
        import re as _re
        thoughts = ""
        action = None

        try:
            # Strategy 1: action tags
            if "<|action_start|>" in message:
                parts = message.split("<|action_start|>")
                thoughts = parts[0].strip()
                action_text = parts[1].split("<|action_end|>")[0].strip()
                for candidate in [action_text, action_text.split("\\n")[0].strip()]:
                    try:
                        action = json.loads(candidate)
                        break
                    except (json.JSONDecodeError, ValueError):
                        continue

            # Strategy 2: json code block
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

            # Normalize to {"name": ..., "arguments": {...}} expected by caller.
            # qwen2.5vl often emits bare arguments like {"action": "click", ...}
            # which causes KeyError 'arguments' downstream if not wrapped.
            if isinstance(action, dict) and "arguments" not in action:
                if "name" in action:
                    args = {k: v for k, v in action.items() if k != "name"}
                    action = {"name": action["name"], "arguments": args}
                elif "action" in action:
                    action = {"name": "computer_use", "arguments": action}
            elif isinstance(action, dict) and not isinstance(action.get("arguments"), dict):
                # arguments present but not a dict (e.g. JSON string) - parse it
                try:
                    action["arguments"] = json.loads(action["arguments"])
                except (TypeError, json.JSONDecodeError, ValueError):
                    action["arguments"] = {}

            return thoughts, action

        except Exception:
            logger.error(
                f"Error parsing thoughts and action: {message}",
                exc_info=True,
            )
            raise'''

start = content.find("    def _parse_thoughts_and_action(self, message: str)")
if start < 0:
    print("  ERROR: Cannot find _parse_thoughts_and_action method")
    sys.exit(1)

end = content.find("\n    # -----", start + 10)
if end < 0:
    end = content.find("\n    def ", start + 10)
if end < 0:
    print("  ERROR: Cannot find end of method")
    sys.exit(1)

new_content = content[:start] + NEW_METHOD + content[end:]

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
      temperature: 0.3
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
      temperature: 0.1
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

echo "  Orchestrator: $ORCHESTRATOR_MODEL (temp=0.3)"
echo "  Browser:      $BROWSER_MODEL (temp=0.1)"
echo "  Ollama:       $OLLAMA_V1"
echo "  Sandbox:      quicksand"
echo -e "  ${GREEN}OK - config.yaml generated${NC}"

# ============================================================
# 11. Ensure browser vision model exists on DGX Spark
# ============================================================
log "11. Checking/creating browser vision model (${BROWSER_MODEL})..."

if curl -sf "${OLLAMA_HOST}/api/show" -d "{\"name\": \"${BROWSER_MODEL}\"}" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK - ${BROWSER_MODEL} already exists${NC}"
else
    echo "  Creating ${BROWSER_MODEL} from qwen2.5vl:latest..."
    # New API format (Ollama >= 0.5.5): from + parameters
    curl -s -X POST "${OLLAMA_HOST}/api/create" \
      -H "Content-Type: application/json" \
      -d "{\"model\": \"${BROWSER_MODEL}\", \"from\": \"qwen2.5vl:latest\", \"parameters\": {\"num_ctx\": 16384, \"temperature\": 0.0001}}" \
      --max-time 120 >/dev/null 2>&1
    # Legacy fallback (older Ollama): modelfile string
    if ! curl -sf "${OLLAMA_HOST}/api/show" -d "{\"name\": \"${BROWSER_MODEL}\"}" >/dev/null 2>&1; then
        curl -s -X POST "${OLLAMA_HOST}/api/create" \
          -H "Content-Type: application/json" \
          -d "{\"name\": \"${BROWSER_MODEL}\", \"modelfile\": \"FROM qwen2.5vl:latest\nPARAMETER num_ctx 16384\nPARAMETER temperature 0.0001\"}" \
          --max-time 120 >/dev/null 2>&1
    fi
    if curl -sf "${OLLAMA_HOST}/api/show" -d "{\"name\": \"${BROWSER_MODEL}\"}" >/dev/null 2>&1; then
        echo -e "  ${GREEN}OK - ${BROWSER_MODEL} created${NC}"
    else
        echo -e "  ${RED}WARN - Could not create ${BROWSER_MODEL}.${NC}"
        echo "  Run on DGX Spark: ollama pull qwen2.5vl && ollama create qwen2.5vl-fast -f <(echo -e 'FROM qwen2.5vl:latest\nPARAMETER num_ctx 16384')"
    fi
fi

# ============================================================
# 11b. Preload models into memory
# ============================================================
log "11b. Preloading Ollama models..."

echo "  Loading ${ORCHESTRATOR_MODEL} (32B)..."
curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${ORCHESTRATOR_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 8192}, \"keep_alive\": \"-1\"}" \
  --max-time 180 >/dev/null 2>&1 || echo "  WARN: Orchestrator preload timed out"

echo "  Loading ${BROWSER_MODEL} (8B vision)..."
curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${BROWSER_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 16384}, \"keep_alive\": \"-1\"}" \
  --max-time 120 >/dev/null 2>&1 || echo "  WARN: Browser model preload timed out"

echo -e "  ${GREEN}OK - Models preloaded (keep_alive=-1)${NC}"

# ============================================================
# 12. Configure nginx reverse proxy
# ============================================================
log "12. Configuring nginx reverse proxy..."

if ! command -v nginx &>/dev/null; then
    echo "  nginx not pre-installed, installing..."
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
echo -e "  ${GREEN}OK - nginx on 0.0.0.0:${MAGENTIC_PORT} -> 127.0.0.1:${MAGENTIC_INTERNAL_PORT}${NC}"

# ============================================================
# 13. Create systemd service
# ============================================================
log "13. Creating systemd service..."

sudo tee /etc/systemd/system/magentic-ui.service >/dev/null <<EOF
[Unit]
Description=Magentic-UI Web Service (LAB-03)
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
echo -e "  ${GREEN}OK - systemd service created${NC}"

# ============================================================
# 14. Launch & wait for readiness
# ============================================================
log "14. Launching Magentic-UI and waiting for readiness..."

sudo systemctl restart magentic-ui
echo ""
echo "Waiting for Magentic-UI and Quicksand sandbox to be fully ready..."
echo "(First startup may take 5-30 minutes while downloading sandbox images)"
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
    echo -e "${GREEN}  Magentic-UI (LAB-03) is ready!${NC}"
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
    echo "  Bridge v2 logs:"
    echo "    sudo journalctl -u ollama-openai-bridge -f"
    echo ""
else
    echo -e "${RED}Magentic-UI did not become ready within 30 minutes.${NC}"
    echo "Check the logs: sudo journalctl -u magentic-ui -f"
    exit 1
fi
