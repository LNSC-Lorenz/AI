#!/bin/bash
# ============================================================
# deploy-agentic-ui.sh - Deploy Agentic-UI + Playwright on Ubuntu
# ============================================================
# Lightweight alternative to Magentic-UI:
# - No Quicksand VM overhead
# - Playwright directly controls the browser
# - Same Ollama models: qwen3:32b (orchestrator) + qwen2.5vl-fast (browser)
#
# Run as: magentic user (non-root)
# ============================================================

set -euo pipefail

# ============================================================
# Configuration - MODIFY THESE VALUES
# ============================================================
OLLAMA_HOST="http://10.87.5.55:11434"       # Dell DGX Spark Ollama address
ORCHESTRATOR_MODEL="qwen3:32b"               # High-level planning
BROWSER_MODEL="qwen2.5vl-fast"               # Screenshot + browser action
AGENTIC_PORT=8081                              # Web UI port (external, nginx)
AGENTIC_INTERNAL_PORT=8082                     # Internal port
PROJECT_DIR="$HOME/agentic-ui"
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
# 0. Check current user
# ============================================================
if [ "$EUID" -eq 0 ]; then
    echo "ERROR: This script should NOT be run as root."
    echo "Please run as the 'magentic' user: bash deploy-agentic-ui.sh"
    exit 1
fi

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
# 2. Install Python 3.12
# ============================================================
log "2. Checking Python 3.12..."
if ! command -v python3.12 &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq python3.12 python3.12-venv curl
fi
echo -e "  ${GREEN}OK - Python $(python3.12 --version)${NC}"

# ============================================================
# 3. Install uv
# ============================================================
log "3. Installing uv..."
if ! command -v uv &>/dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi
export PATH="$HOME/.local/bin:$PATH"
echo -e "  ${GREEN}OK - uv $(uv --version)${NC}"

# ============================================================
# 4. Create project directory & venv
# ============================================================
log "4. Setting up project..."
mkdir -p "$PROJECT_DIR"
cd "$PROJECT_DIR"

if [ ! -f ".venv/bin/activate" ]; then
    rm -rf .venv 2>/dev/null || true
    uv venv --python=3.12 --seed .venv
fi
source .venv/bin/activate
echo -e "  ${GREEN}OK - venv activated${NC}"

# ============================================================
# 5. Install dependencies
# ============================================================
log "5. Installing Python packages..."
uv pip install -q fastapi uvicorn websockets openai pillow playwright httpx pydantic

# ============================================================
# 6. Install Playwright browsers
# ============================================================
log "6. Installing Playwright browsers..."
playwright install chromium
sudo playwright install-deps chromium || true
echo -e "  ${GREEN}OK - Playwright Chromium installed${NC}"

# ============================================================
# 7. Create Agentic-UI application
# ============================================================
log "7. Creating Agentic-UI application..."

mkdir -p "$PROJECT_DIR/app"
mkdir -p "$PROJECT_DIR/static"

# ── main FastAPI app ───────────────────────────────────────
cat > "$PROJECT_DIR/app/main.py" <<'PYEOF'
#!/usr/bin/env python3
"""Agentic-UI: FastAPI + Playwright browser agent with Ollama backend."""
import asyncio
import base64
import io
import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from openai import AsyncOpenAI
from playwright.async_api import async_playwright, Page, Browser

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("agentic-ui")

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
ORCHESTRATOR_MODEL = os.environ.get("ORCHESTRATOR_MODEL", "qwen3:32b")
BROWSER_MODEL = os.environ.get("BROWSER_MODEL", "qwen2.5vl-fast")

# OpenAI client pointing to Ollama
client = AsyncOpenAI(base_url=f"{OLLAMA_HOST}/v1", api_key="ollama")

# In-memory browser state
browser_state = {
    "playwright": None,
    "browser": None,
    "page": None,
    "task_history": [],
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Keep one browser instance alive for the app lifetime."""
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=True, args=["--no-sandbox"])
    page = await browser.new_page(viewport={"width": 1280, "height": 720})
    browser_state["playwright"] = pw
    browser_state["browser"] = browser
    browser_state["page"] = page
    log.info("Browser initialized")
    yield
    await page.close()
    await browser.close()
    await pw.stop()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory="static"), name="static")


# ── Helpers ─────────────────────────────────────────────────

async def get_screenshot(page: Page) -> str:
    """Capture page screenshot as base64 JPEG."""
    screenshot_bytes = await page.screenshot(type="jpeg", quality=60, full_page=False)
    return base64.b64encode(screenshot_bytes).decode("utf-8")


async def run_orchestrator(task: str, history: list[dict]) -> str:
    """Use qwen3:32b to plan the next browser goal or summarize answer."""
    messages = [
        {"role": "system", "content": "You are a browser task planner. Break the task into the next single browser action goal. Output ONLY the next step description."},
        {"role": "user", "content": f"Task: {task}\nHistory: {history}\nWhat is the next single step to do?"},
    ]
    try:
        resp = await client.chat.completions.create(
            model=ORCHESTRATOR_MODEL,
            messages=messages,
            temperature=0.3,
            max_tokens=200,
            timeout=120,
            extra_body={"num_ctx": 8192},
        )
        return resp.choices[0].message.content.strip()
    except Exception as e:
        log.error(f"Orchestrator error: {e}")
        return f"error: {e}"


async def run_browser_action(goal: str, screenshot_b64: str, page: Page) -> dict[str, Any]:
    """Use qwen2.5vl-fast to decide the next browser action from screenshot."""
    url = page.url
    system_msg = (
        "You control a browser. Given the screenshot, decide the next action.\n"
        "Output ONLY a JSON object with one of these formats:\n"
        '{"action":"goto","url":"https://..."}\n'
        '{"action":"click","coordinate":[x,y]}\n'
        '{"action":"type","text":"...","coordinate":[x,y]}\n'
        '{"action":"scroll","direction":"down|up"}\n'
        '{"action":"wait","seconds":1}\n'
        '{"action":"done","answer":"final answer"}\n'
        "Coordinates must be integers within 1280x720."
    )
    messages = [
        {"role": "system", "content": system_msg},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": f"Current URL: {url}\nGoal: {goal}\nDecide the next action."},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{screenshot_b64}"}},
            ],
        },
    ]
    try:
        resp = await client.chat.completions.create(
            model=BROWSER_MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=300,
            timeout=300,
            extra_body={"num_ctx": 16384},
        )
        text = resp.choices[0].message.content.strip()
        return parse_action(text)
    except Exception as e:
        log.error(f"Browser model error: {e}")
        return {"action": "error", "message": str(e)}


def parse_action(text: str) -> dict[str, Any]:
    """Extract JSON action from model output."""
    # Try fenced code block
    m = re.search(r"```(?:json)?\n(.*?)\n```", text, re.DOTALL)
    if m:
        text = m.group(1)
    # Try bare JSON object
    if not text.startswith("{"):
        m = re.search(r"(\{.*?\})", text, re.DOTALL)
        if m:
            text = m.group(1)
    try:
        action = json.loads(text)
        if isinstance(action, dict) and "action" in action:
            return action
    except Exception:
        pass
    # Fallback: try to find a JSON object
    for m in re.finditer(r"(\{.*?\})", text, re.DOTALL):
        try:
            action = json.loads(m.group(1))
            if isinstance(action, dict) and "action" in action:
                return action
        except Exception:
            continue
    return {"action": "error", "message": f"Could not parse action: {text[:200]}"}


async def execute_action(page: Page, action: dict) -> dict[str, Any]:
    """Execute a Playwright action."""
    act = action.get("action")
    try:
        if act == "goto":
            await page.goto(action["url"], wait_until="domcontentloaded", timeout=30000)
            return {"status": "ok", "url": page.url}
        elif act == "click":
            x, y = action["coordinate"]
            await page.mouse.click(x, y)
            await asyncio.sleep(0.5)
            return {"status": "ok", "clicked": [x, y]}
        elif act == "type":
            x, y = action.get("coordinate", [0, 0])
            text = action["text"]
            await page.mouse.click(x, y)
            await page.keyboard.type(text, delay=10)
            await asyncio.sleep(0.5)
            return {"status": "ok", "typed": text}
        elif act == "scroll":
            direction = action.get("direction", "down")
            delta = -500 if direction == "down" else 500
            await page.mouse.wheel(0, delta)
            await asyncio.sleep(0.5)
            return {"status": "ok", "scrolled": direction}
        elif act == "wait":
            await asyncio.sleep(action.get("seconds", 1))
            return {"status": "ok", "waited": action.get("seconds", 1)}
        elif act == "done":
            return {"status": "done", "answer": action.get("answer", "")}
        elif act == "error":
            return {"status": "error", "message": action.get("message", "unknown")}
        else:
            return {"status": "error", "message": f"Unknown action: {act}"}
    except Exception as e:
        log.error(f"Action execution error: {e}")
        return {"status": "error", "message": str(e)}


# ── API endpoints ───────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("static/index.html")


@app.post("/api/task")
async def run_task(request: Request):
    """Run a browser task to completion (or max steps)."""
    data = await request.json()
    task = data.get("task", "")
    max_steps = int(data.get("max_steps", 15))

    page = browser_state["page"]
    history = []
    steps = []

    for step in range(max_steps):
        # Orchestrator: decide next sub-goal
        goal = await run_orchestrator(task, history)
        log.info(f"Step {step}: goal={goal}")

        screenshot_b64 = await get_screenshot(page)
        action = await run_browser_action(goal, screenshot_b64, page)
        log.info(f"Step {step}: action={action}")

        result = await execute_action(page, action)
        log.info(f"Step {step}: result={result}")

        steps.append({
            "step": step,
            "goal": goal,
            "action": action,
            "result": result,
            "screenshot": f"data:image/jpeg;base64,{screenshot_b64}",
        })
        history.append({"goal": goal, "action": action, "result": result})

        if result.get("status") == "done":
            return JSONResponse({
                "status": "done",
                "answer": result.get("answer", ""),
                "steps": steps,
            })
        if result.get("status") == "error":
            return JSONResponse({
                "status": "error",
                "message": result.get("message", ""),
                "steps": steps,
            }, status_code=500)

    return JSONResponse({
        "status": "max_steps",
        "steps": steps,
    })


@app.post("/api/reset")
async def reset_browser():
    """Reset browser to blank page."""
    page = browser_state["page"]
    await page.goto("about:blank")
    return {"status": "reset"}


@app.get("/api/health")
async def health():
    return {"status": "ok", "browser": browser_state["page"] is not None}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            task = payload.get("task", "")
            # Run task and stream progress
            page = browser_state["page"]
            history = []
            for step in range(int(payload.get("max_steps", 15))):
                goal = await run_orchestrator(task, history)
                screenshot_b64 = await get_screenshot(page)
                action = await run_browser_action(goal, screenshot_b64, page)
                result = await execute_action(page, action)
                history.append({"goal": goal, "action": action, "result": result})
                await websocket.send_text(json.dumps({
                    "step": step,
                    "goal": goal,
                    "action": action,
                    "result": result,
                    "screenshot": f"data:image/jpeg;base64,{screenshot_b64}",
                }))
                if result.get("status") in ("done", "error"):
                    break
    except WebSocketDisconnect:
        log.info("WebSocket disconnected")
PYEOF

# ── simple HTML UI ──────────────────────────────────────────
cat > "$PROJECT_DIR/static/index.html" <<'HTMLEOF'
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agentic-UI</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { margin-top: 0; }
        .input-group { display: flex; gap: 10px; margin-bottom: 20px; }
        input[type="text"] { flex: 1; padding: 10px; font-size: 16px; border: 1px solid #ddd; border-radius: 4px; }
        button { padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #ccc; }
        .steps { margin-top: 20px; }
        .step { border: 1px solid #eee; padding: 10px; margin-bottom: 10px; border-radius: 4px; }
        .step img { max-width: 100%; border: 1px solid #ddd; }
        .status { padding: 10px; background: #e7f3ff; border-radius: 4px; margin-bottom: 10px; }
        .error { background: #ffe7e7; color: #c00; }
        .done { background: #e7ffe7; color: #080; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Agentic-UI</h1>
        <p>输入任务，AI 会用浏览器自动完成。模型：qwen3:32b + qwen2.5vl-fast</p>
        <div class="input-group">
            <input type="text" id="task" placeholder="例如：打开 www.baidu.com 查看今天天气" value="打开 www.baidu.com 查看今天天气">
            <button id="runBtn" onclick="runTask()">执行</button>
            <button onclick="resetBrowser()" style="background:#6c757d">重置浏览器</button>
        </div>
        <div id="status"></div>
        <div class="steps" id="steps"></div>
    </div>

    <script>
        async function runTask() {
            const task = document.getElementById('task').value;
            const btn = document.getElementById('runBtn');
            const status = document.getElementById('status');
            const steps = document.getElementById('steps');
            btn.disabled = true;
            steps.innerHTML = '';
            status.className = 'status';
            status.textContent = '执行中...';

            try {
                const resp = await fetch('/api/task', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({task: task, max_steps: 15})
                });
                const data = await resp.json();
                if (data.status === 'done') {
                    status.className = 'status done';
                    status.textContent = '完成: ' + data.answer;
                } else if (data.status === 'error') {
                    status.className = 'status error';
                    status.textContent = '错误: ' + data.message;
                } else {
                    status.className = 'status';
                    status.textContent = '达到最大步数';
                }
                (data.steps || []).forEach(s => {
                    const div = document.createElement('div');
                    div.className = 'step';
                    div.innerHTML = `<b>Step ${s.step}</b><br>Goal: ${s.goal}<br>Action: ${JSON.stringify(s.action)}<br>Result: ${JSON.stringify(s.result)}<br><img src="${s.screenshot}" alt="screenshot">`;
                    steps.appendChild(div);
                });
            } catch (e) {
                status.className = 'status error';
                status.textContent = '请求失败: ' + e.message;
            } finally {
                btn.disabled = false;
            }
        }

        async function resetBrowser() {
            await fetch('/api/reset', {method: 'POST'});
            document.getElementById('status').textContent = '浏览器已重置';
        }
    </script>
</body>
</html>
HTMLEOF

# ── env file ───────────────────────────────────────────────
cat > "$PROJECT_DIR/.env" <<EOF
OLLAMA_HOST=${OLLAMA_HOST}
ORCHESTRATOR_MODEL=${ORCHESTRATOR_MODEL}
BROWSER_MODEL=${BROWSER_MODEL}
EOF

echo -e "  ${GREEN}OK - Agentic-UI application created${NC}"

# ============================================================
# 8. Preload models
# ============================================================
log "8. Preloading Ollama models..."

curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${ORCHESTRATOR_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 8192}, \"keep_alive\": \"-1\"}" \
  --max-time 180 >/dev/null 2>&1 || echo "  WARN: Orchestrator preload timed out"

curl -s -X POST "${OLLAMA_HOST}/api/generate" \
  -H "Content-Type: application/json" \
  -d "{\"model\": \"${BROWSER_MODEL}\", \"prompt\": \"hi\", \"stream\": false, \"options\": {\"num_ctx\": 16384}, \"keep_alive\": \"-1\"}" \
  --max-time 120 >/dev/null 2>&1 || echo "  WARN: Browser model preload timed out"

echo -e "  ${GREEN}OK - Models preloaded${NC}"

# ============================================================
# 9. Install nginx reverse proxy
# ============================================================
log "9. Installing nginx reverse proxy..."

if ! command -v nginx &>/dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq nginx
fi

sudo tee /etc/nginx/sites-available/agentic-ui >/dev/null <<NGINX_EOF
server {
    listen ${AGENTIC_PORT};
    server_name _;

    location / {
        proxy_pass http://127.0.0.1:${AGENTIC_INTERNAL_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
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
sudo ln -sf /etc/nginx/sites-available/agentic-ui /etc/nginx/sites-enabled/agentic-ui
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx
echo -e "  ${GREEN}OK - nginx listening on 0.0.0.0:${AGENTIC_PORT}${NC}"

# ============================================================
# 10. Create systemd service
# ============================================================
log "10. Creating systemd service..."

sudo tee /etc/systemd/system/agentic-ui.service >/dev/null <<EOF
[Unit]
Description=Agentic-UI Web Service
After=network.target nginx.service
Wants=nginx.service

[Service]
Type=simple
User=$USER
Group=$USER
WorkingDirectory=$PROJECT_DIR
Environment=PATH=$PROJECT_DIR/.venv/bin:/usr/bin
Environment=OLLAMA_HOST=${OLLAMA_HOST}
Environment=ORCHESTRATOR_MODEL=${ORCHESTRATOR_MODEL}
Environment=BROWSER_MODEL=${BROWSER_MODEL}
ExecStart=$PROJECT_DIR/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${AGENTIC_INTERNAL_PORT}
Restart=on-failure
RestartSec=5
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable agentic-ui
sudo systemctl restart agentic-ui

# ============================================================
# 11. Wait for readiness
# ============================================================
log "11. Waiting for Agentic-UI to be ready..."

READY=0
for i in $(seq 1 60); do
    if curl -sf http://127.0.0.1:${AGENTIC_INTERNAL_PORT}/api/health >/dev/null 2>&1; then
        READY=1
        break
    fi
    printf "\r  Checking... %3d/60" "$i"
    sleep 2
done
printf "\n"

if [ "$READY" -eq 1 ]; then
    echo ""
    echo -e "${GREEN}============================================${NC}"
    echo -e "${GREEN}  Agentic-UI is ready!${NC}"
    echo -e "${GREEN}  Web UI: http://<server-ip>:${AGENTIC_PORT}${NC}"
    echo -e "${GREEN}  Orchestrator: ${ORCHESTRATOR_MODEL}${NC}"
    echo -e "${GREEN}  Browser:      ${BROWSER_MODEL}${NC}"
    echo -e "${GREEN}============================================${NC}"
else
    echo -e "${RED}Agentic-UI did not become ready.${NC}"
    echo "Check logs: sudo journalctl -u agentic-ui -f"
    exit 1
fi
