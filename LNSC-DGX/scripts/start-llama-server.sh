#!/usr/bin/env bash
# LNSC-DGX · 一键启动 Qwen3.8-Flash-Next (llama.cpp / GB10)
#
# 特点:
#   1. 自动探测本 build 的参数写法 (-fa on / --flash-attn on / --no-mmap / --direct-io)
#   2. 双重防呆: 已有 llama-server 在跑 / 可用内存不足 -> 拒绝启动
#   3. 所有关键参数可用环境变量覆盖, 例如: CTX=262144 ./start-llama-server.sh
set -uo pipefail

MODEL="${MODEL:-/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf}"
SERVER="${SERVER:-/opt/llama.cpp/build/bin/llama-server}"
ALIAS="${ALIAS:-qwen3.8-flash-next}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8081}"

CTX="${CTX:-196608}"       # 上下文: 与 systemd unit 保持一致(196608 < 原生 262144, 无需 rope)
BATCH="${BATCH:-2048}"      # 逻辑批
UBATCH="${UBATCH:-1024}"    # 微批: 决定 prefill 速度. 实测 24k prompt: 512→935 tok/s, 1024→1082 tok/s(+15.7%)
                            # 内存紧张时降到 512/256；cgroup peak 会 +1.6 GiB 左右
NGL="${NGL:-999}"
KV_TYPE="${KV_TYPE:-q8_0}"  # ⚠️ K/V 用同一类型(本 build 只编译同型 FA 组合:
                            #    q4_0-q4_0 / q8_0-q8_0 / f16-f16 / bf16-bf16)
                            #    置空(KV_TYPE=)可关闭 KV 量化
MMPROJ="${MMPROJ:-/models/qwen3.8-flash-next/mmproj-F16.gguf}"  # 视觉投影器; MMPROJ= 置空可关闭
MIN_AVAIL_MB="${MIN_AVAIL_MB:-25600}"
FORCE="${FORCE:-0}"         # FORCE=1 跳过防呆

die() { echo "!! $*" >&2; exit 1; }

[[ -x "$SERVER" ]]        || die "找不到 $SERVER"
[[ -f "$MODEL" ]]         || die "找不到模型 $MODEL"

# ---------- 防呆 1: 重复实例 ----------
if pgrep -x llama-server >/dev/null 2>&1 && [[ "$FORCE" != "1" ]]; then
  echo "!! 已有 llama-server 在运行（统一内存下并行两个大模型会拖垮整机）:"
  pgrep -ax llama-server | sed 's/^/   /'
  die "先 sudo kill <PID> 停掉旧实例；确需并行请用 FORCE=1 $0"
fi

# ---------- 防呆 2: 可用内存 ----------
avail_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
[[ "$avail_mb" =~ ^[0-9]+$ ]] || avail_mb=999999   # 读不到就不拦, 避免误判
if (( avail_mb < MIN_AVAIL_MB )) && [[ "$FORCE" != "1" ]]; then
  echo "!! MemAvailable=${avail_mb}MiB < ${MIN_AVAIL_MB}MiB"
  echo "   建议: sudo kill <PID>  /  sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'"
  die "内存不足，拒绝启动（强行启动 = 整机 swap 卡死）"
fi

# ---------- 自适应参数 ----------
help_txt=$("$SERVER" --help 2>&1)
FA_ARGS=()
if grep -qE -- '--flash-attn[ =]' <<<"$help_txt"; then
  FA_ARGS=(--flash-attn on)
elif grep -qE -- '(^|[[:space:]])-fa[,[:space:]]' <<<"$help_txt"; then
  FA_ARGS=(-fa on)
else
  echo "!! 本 build 无 FA 开关，跳过（KV 量化一并关闭）"
  KV_TYPE=""
fi

ARGS=(-m "$MODEL" --alias "$ALIAS"
      -c "$CTX" -b "$BATCH" -ub "$UBATCH" -ngl "$NGL"
      "${FA_ARGS[@]}"
      --jinja --parallel 1 --host "$HOST" --port "$PORT")

# 视觉投影器（mmproj）：模型本身支持视觉，缺的就是这个 0.9 GB 文件
if [[ -n "$MMPROJ" ]]; then
  if [[ -f "$MMPROJ" ]] && grep -q -- '--mmproj' <<<"$help_txt"; then
    ARGS+=(--mmproj "$MMPROJ")
  elif [[ -n "$MMPROJ" ]]; then
    echo "!! 未找到 $MMPROJ 或本 build 不支持 --mmproj：以纯文本模式启动"
  fi
fi

if [[ -n "$KV_TYPE" ]]; then
  if grep -q -- '-ctk' <<<"$help_txt"; then
    ARGS+=(-ctk "$KV_TYPE" -ctv "$KV_TYPE")
  else
    echo "!! 本 build 无 -ctk/-ctv，跳过 KV 量化"
  fi
fi

# 统一内存: 尽量不让 GGUF 在 page cache 里再占一份
if grep -q -- '--no-mmap' <<<"$help_txt"; then
  ARGS+=(--no-mmap)
elif grep -q -- '--direct-io' <<<"$help_txt"; then
  ARGS+=(--direct-io)
else
  echo "!! 本 build 既不支持 --no-mmap 也不支持 --direct-io：跳过（page cache 那份可被内核回收，安全）"
fi

# KV shifting 复用中间对齐块：客户端编辑/重发消息时少算 prefill（0 = 关闭）
if [[ "${CACHE_REUSE:-256}" != "0" ]] && grep -q -- '--cache-reuse' <<<"$help_txt"; then
  ARGS+=(--cache-reuse "${CACHE_REUSE:-256}")
fi

# 可观测性: /metrics 端点（默认开启, METRICS=0 关闭）
if [[ "${METRICS:-1}" == "1" ]] && grep -q -- '--metrics' <<<"$help_txt"; then
  ARGS+=(--metrics)
fi

echo "== 启动参数 =="
printf '   %s' "$SERVER"; printf ' %q' "${ARGS[@]}"; echo
per_tok=24; [[ -z "$KV_TYPE" ]] && per_tok=48   # q8_0≈24KiB/token, f16≈48KiB/token
kv_gib=$(( CTX * per_tok / 1024 / 1024 ))
echo "== 备忘 ==  可用内存 ${avail_mb}MiB | 预期占用 ≈ 权重 103.68GiB + KV ${kv_gib}GiB ≈ $(( 104 + kv_gib ))GiB"
echo "       (weight 103.68GiB 是真身, 不是 48GiB; 该模型为 176.9B 参数 MoE)"
echo
echo "提示: 日常请用 systemctl restart llama-qwen38, 本脚本仅作应急手动启动。"

exec "$SERVER" "${ARGS[@]}"