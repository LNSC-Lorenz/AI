#!/usr/bin/env python3
'''OpenAI-to-Ollama bridge v3 for Magentic-UI 0.1.6 full multi-agent.'''
import base64
import io
import json
import logging
import os
import time
import typing
import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('bridge-v3')

OLLAMA_HOST = os.environ.get('OLLAMA_HOST', 'http://127.0.0.1:11434').rstrip('/')
PORT = int(os.environ.get('BRIDGE_PORT', '11440'))

MAX_HISTORY = 6
IMG_W = 1280
IMG_H = 720
JPEG_Q = 60

NUM_PREDICT = {
    'qwen3:32b': 2048,
    'qwen2.5vl-fast': 1024,
}

PARSER_BUG = set()

app = FastAPI(title='Ollama Bridge v3')
_client = None

async def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(600.0, connect=10.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client

def downscale(b64: str) -> str:
    try:
        from PIL import Image
    except ImportError:
        return b64
    try:
        raw = base64.b64decode(b64)
        img = Image.open(io.BytesIO(raw))
        if img.mode in ('RGBA', 'P', 'LA'):
            img = img.convert('RGB')
        if img.width > IMG_W or img.height > IMG_H:
            ratio = min(IMG_W / img.width, IMG_H / img.height)
            img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)
        out = io.BytesIO()
        img.save(out, format='JPEG', quality=JPEG_Q, optimize=True)
        return base64.b64encode(out.getvalue()).decode('ascii')
    except Exception as e:
        log.warning('downscale failed: %s', e)
        return b64

def process_content(content: typing.Union[list, str, None]):
    if not isinstance(content, list):
        return content
    last_img = -1
    for i, part in enumerate(content):
        if isinstance(part, dict) and part.get('type') == 'image_url':
            last_img = i
    new = []
    for i, part in enumerate(content):
        if i != last_img and isinstance(part, dict) and part.get('type') == 'image_url':
            continue
        if i == last_img and isinstance(part, dict) and part.get('type') == 'image_url':
            url = part.get('image_url', {}).get('url', '')
            if url.startswith('data:'):
                head, b64 = url.split(',', 1)
                scaled = downscale(b64)
                new.append({'type': 'image_url', 'image_url': {'url': f'data:image/jpeg;base64,{scaled}'}})
            else:
                new.append(part)
        else:
            new.append(part)
    return new if new else content

def truncate(messages: list) -> list:
    system = [m for m in messages if m.get('role') == 'system']
    others = [m for m in messages if m.get('role') != 'system']
    if len(others) > MAX_HISTORY:
        others = others[-MAX_HISTORY:]
    out = []
    for m in system + others:
        m2 = dict(m)
        m2['content'] = process_content(m2.get('content'))
        out.append(m2)
    return out

@app.post('/v1/chat/completions')
async def chat(req: Request):
    body = await req.json()
    model = body.get('model', '')
    t0 = time.time()
    if 'max_tokens' not in body and model in NUM_PREDICT:
        body['max_tokens'] = NUM_PREDICT[model]
    if 'messages' in body:
        body['messages'] = truncate(body['messages'])
    client = await get_client()
    resp = await client.post(f'{OLLAMA_HOST}/v1/chat/completions', json=body)
    elapsed = time.time() - t0
    log.info('chat model=%s status=%d elapsed=%.1fs', model, resp.status_code, elapsed)
    try:
        data = resp.json()
    except Exception:
        data = {'error': resp.text}
    return JSONResponse(status_code=resp.status_code, content=data)

@app.get('/v1/models')
async def models():
    client = await get_client()
    r = await client.get(f'{OLLAMA_HOST}/v1/models')
    try:
        data = r.json()
    except Exception:
        data = {'error': r.text}
    return JSONResponse(status_code=r.status_code, content=data)

@app.get('/health')
async def health():
    return {'status': 'ok'}

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=PORT)
