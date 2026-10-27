#!/usr/bin/env bash
# LNSC-DGX · 查看最近几次请求的 prompt 规模与耗时（只读，不改任何配置）
#
# 用途：客户端"感觉慢"时，用它确认到底是 prompt 太大，还是服务端变慢。
# 用法：
#   bash scripts/prompt-size.sh          # 最近 10 条
#   bash scripts/prompt-size.sh 30       # 最近 30 条
set -uo pipefail

N="${1:-10}"
BASE="${BASE:-http://127.0.0.1:8081}"
UNIT="${UNIT:-llama-qwen38}"

command -v journalctl >/dev/null || { echo "!! 需要 journalctl" >&2; exit 1; }

echo "== 最近 $N 次请求（来自 journal） =="
printf '%-8s %-6s %-11s %-10s %-15s\n' "时间" "task" "prompt_tok" "prefill_s" "prefill_tok/s"
journalctl -u "$UNIT" -b --no-pager 2>/dev/null \
  | awk '/prompt eval time/ {
      t=$3
      task="-"; ntok="-"; ms="-"; tps="-"
      if (match($0, /task [0-9]+/))            { task = substr($0, RSTART+5, RLENGTH-5) }
      if (match($0, /prompt eval time = *[0-9.]+ ms/)) {
          s = substr($0, RSTART, RLENGTH); gsub(/[^0-9.]/, "", s); ms = s + 0 }
      if (match($0, /\/ *[0-9]+ tokens/))      {
          s = substr($0, RSTART, RLENGTH); gsub(/[^0-9]/, "", s); ntok = s + 0 }
      if (match($0, /[0-9.]+ tokens per second/)) {
          s = substr($0, RSTART, RLENGTH); gsub(/[^0-9.]/, "", s); tps = s + 0 }
      printf "%-8s %-6s %-11s %-10.1f %-15.1f\n", t, task, ntok, ms/1000, tps
    }' | tail -"$N"

echo
echo "== 当前 slot（是否在处理 / 上下文占用） =="
slots=$(curl -s --max-time 5 "$BASE/slots" 2>/dev/null)
if [[ -z "$slots" ]]; then
  echo "!! 取不到 $BASE/slots（服务是否在跑？）" >&2
else
  echo "$slots" | tr ',' '\n' | grep -E 'is_processing|n_prompt_tokens|n_prompt_tokens_cache|n_decoded|"n_ctx"' | head -6
  nctx=$(echo "$slots"  | tr ',' '\n' | grep -o '"n_ctx":[0-9]*'        | head -1 | cut -d: -f2)
  npr=$(echo "$slots"   | tr ',' '\n' | grep -o '"n_prompt_tokens":[0-9]*' | head -1 | cut -d: -f2)
  if [[ -n "${nctx:-}" && -n "${npr:-}" && "$nctx" -gt 0 ]]; then
    used=$(( npr * 100 / nctx ))
    echo "上下文占用: ${npr} / ${nctx}  (${used}%)"
    (( npr > 30000 )) && echo "⚠️  prompt 已超过 30k，首轮等待会明显变长（见下方对照表）"
  fi
fi

echo
echo "== 预期首轮 prefill 耗时（本机实测 -ub 1024：约 1050 tok/s） =="
cat <<'TABLE'
  5,000 tokens → 约  5 s
 20,000 tokens → 约 19 s
 39,000 tokens → 约 37 s   ← Cline 默认级别
100,000 tokens → 约 95 s
TABLE
echo
echo "提示：第二轮开始只算新增 token（cache 命中），通常 3~9 s。"
echo "      若日志出现 'cancel task'，说明客户端超时/被手动停止，前功尽弃。"
echo "      排查：journalctl -u $UNIT -b --no-pager | grep -i 'cancel task' | tail"