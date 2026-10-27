#!/usr/bin/env bash
# LNSC-DGX · 启动后验证
# 检查: 服务可达 / n_ctx 是否生效 / 统一内存红线 / 冒烟对话
set -uo pipefail

BASE="${BASE:-http://127.0.0.1:8081}"
ALIAS="${ALIAS:-qwen3.8-flash-next}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-20480}"

py() { python3 -c "$@"; }

echo "== 1. 进程与端口 =="
pgrep -ax llama-server 2>/dev/null | sed 's/^/   /' || echo "   !! 没有 llama-server 进程"
ss -ltnp 2>/dev/null | grep -E ':808[0-9]' | sed 's/^/   /' || true

echo "== 2. /props（确认上下文真的生效）=="
if ! props=$(curl -fsS --max-time 5 "$BASE/props" 2>/dev/null); then
  echo "   !! 服务不可达: $BASE"
  exit 1
fi
echo "$props" | py '
import json,sys
d = json.load(sys.stdin).get("default_generation_settings", {})
print("   n_ctx   =", d.get("n_ctx"))
print("   n_batch =", d.get("n_batch"))
n = d.get("n_ctx") or 0
if n >= 131072:
    print("   -> 上下文充足，49k 级请求可正常处理")
elif n >= 65536:
    print("   -> 仅够本轮，多轮对话/加附件会再次撞限")
else:
    print("   -> 上下文偏小，长文档请求仍会被拒")
'

echo "== 3. 统一内存 (红线 ${MIN_AVAIL_MB}MiB) =="
avail_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
swap_mb=$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print int((t-f)/1024)}' /proc/meminfo 2>/dev/null)
[[ "$avail_mb" =~ ^[0-9]+$ ]] || avail_mb=999999
[[ "$swap_mb"  =~ ^[0-9]+$ ]] || swap_mb=0
echo "   MemAvailable=${avail_mb}MiB  SwapUsed=${swap_mb}MiB"
(( avail_mb < MIN_AVAIL_MB )) && echo "   !! 已低于红线：尽快降 -c / 降 -ub，否则会 swap 抖动直至 SSH 断开"
(( swap_mb > 512 ))           && echo "   !! swap 已在增长：统一内存已被吃穿"
command -v nvidia-smi >/dev/null 2>&1 && \
  nvidia-smi --query-compute-apps=pid,used_memory --format=csv 2>/dev/null | sed 's/^/   /'

echo "== 4. 冒烟对话 =="
curl -fsS --max-time 180 "$BASE/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -d "{\"model\":\"$ALIAS\",\"messages\":[{\"role\":\"user\",\"content\":\"只回复两个字符: OK\"}],\"max_tokens\":16}" \
  | py '
import json,sys
d = json.load(sys.stdin)
m = d["choices"][0]["message"]
print("   content:", repr(m.get("content"))[:120])
print("   usage  :", d.get("usage"))
p, c = (d.get("usage") or {}).get("prompt_tokens"), (d.get("usage") or {}).get("completion_tokens")
if p and c:
    print(f"   （提示 {p} tokens / 生成 {c} tokens）")
' || echo "   !! 冒烟请求失败"

echo
echo "== 参考：长上下文 prefill 速度 =="
echo "   若首字延迟仍是分钟级，检查 -ub 是否被覆盖回 32，以及日志里 FA 是否真的 enabled。"
echo "   grep -iE 'flash.?attn|KV buffer|n_ctx' <启动日志>"