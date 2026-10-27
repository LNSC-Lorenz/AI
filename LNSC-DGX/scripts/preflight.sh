#!/usr/bin/env bash
# LNSC-DGX · 上机前体检
# 用途: 确认二进制/GPU/内存/参数写法/模型原生上下文, 输出 FAIL 时不要启动服务
set -uo pipefail

MODEL="${MODEL:-/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf}"
BIN_DIR="${BIN_DIR:-/opt/llama.cpp/build/bin}"
SERVER="${SERVER:-$BIN_DIR/llama-server}"
MIN_AVAIL_MB="${MIN_AVAIL_MB:-20480}"

ok=0; warn=0; bad=0
say_ok()   { printf '  [ OK ] %s\n' "$*"; ok=$((ok+1)); }
say_warn() { printf '  [WARN] %s\n' "$*"; warn=$((warn+1)); }
say_bad()  { printf '  [FAIL] %s\n' "$*"; bad=$((bad+1)); }

echo "== 1. 二进制 =="
if [[ -x "$SERVER" ]]; then
  say_ok "$("$SERVER" --version 2>&1 | head -1)"
else
  say_bad "找不到可执行文件: $SERVER"
  echo; echo "体检中止: 没有 llama-server 无法继续"; exit 1
fi

echo "== 2. GPU =="
if command -v nvidia-smi >/dev/null 2>&1; then
  cap=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d ' ')
  tot=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1)
  if [[ -z "$cap" ]]; then
    say_warn "驱动不支持 compute_cap 查询（老驱动），跳过"
  elif [[ "$cap" == "12.1" ]]; then
    say_ok "compute_cap=$cap (GB10 正确), memory.total=$tot"
  else
    say_warn "compute_cap=$cap（GB10 应为 12.1）；若为 12.1 却报 no kernel image，说明编译时未指定 sm_121"
  fi
else
  say_warn "无 nvidia-smi：可能是非 CUDA 构建，速度会差一个数量级"
fi

echo "== 3. 统一内存 =="
avail_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
swap_mb=$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print int((t-f)/1024)}' /proc/meminfo 2>/dev/null)
[[ "$avail_mb" =~ ^[0-9]+$ ]] || avail_mb=999999
[[ "$swap_mb"  =~ ^[0-9]+$ ]] || swap_mb=0
printf '  MemAvailable=%s MiB   SwapUsed=%s MiB\n' "$avail_mb" "$swap_mb"
if (( avail_mb < MIN_AVAIL_MB )); then
  say_bad "available < ${MIN_AVAIL_MB}MiB：先杀掉重复实例 + drop_caches 再继续"
else
  say_ok "available 充足"
fi
if (( swap_mb > 512 )); then
  say_warn "swap 已用 ${swap_mb}MiB，说明发生过内存压力"
fi

echo "== 4. 重复实例 =="
cnt=$(pgrep -x llama-server 2>/dev/null | wc -l | tr -d ' ')
if (( cnt > 1 )); then
  say_bad "发现 $cnt 个 llama-server 进程：统一内存下两个大模型必炸"
  pgrep -ax llama-server 2>/dev/null | sed 's/^/         /'
elif (( cnt == 1 )); then
  say_warn "已有一个 llama-server 在跑，启动新实例前先停掉它"
  pgrep -ax llama-server 2>/dev/null | sed 's/^/         /'
else
  say_ok "llama-server 进程数: 0"
fi

echo "== 5. 本 build 的参数支持度（决定最终命令行）=="
help_txt=$("$SERVER" --help 2>&1)
FA_STYLE=""
if grep -qE -- '--flash-attn[ =]' <<<"$help_txt"; then
  FA_STYLE="--flash-attn"
elif grep -qE -- '(^|[[:space:]])-fa[,[:space:]]' <<<"$help_txt"; then
  FA_STYLE="-fa"
fi
if [[ -n "$FA_STYLE" ]]; then
  say_ok "flash attention 写法: $FA_STYLE"
else
  say_warn "help 中未找到 FA 开关（本 build 可能强制开 FA）"
fi
for f in --no-mmap --direct-io; do
  if grep -q -- "$f" <<<"$help_txt"; then say_ok "支持 $f"; else say_warn "不支持 $f（启动脚本会自动跳过）"; fi
done
for f in -ctk -ctv --jinja --parallel; do
  grep -q -- "$f" <<<"$help_txt" && say_ok "支持 $f" || say_warn "未找到 $f"
done

echo "== 6. 模型原生上下文（决定 -c 能不能直接给 131072）=="
if [[ -x "$BIN_DIR/llama-gguf" && -f "$MODEL" ]]; then
  meta=$("$BIN_DIR/llama-gguf" "$MODEL" 2>/dev/null | grep -iE 'context_length|rope' || true)
  if [[ -n "$meta" ]]; then
    echo "$meta" | sed 's/^/         /'
    native=$(echo "$meta" | grep -i 'context_length' | grep -oE '[0-9]{4,}' | head -1)
    if [[ -n "${native:-}" ]]; then
      if (( native >= 131072 )); then
        say_ok "原生 $native：-c 131072 可直接用，无需 rope 缩放"
      else
        say_warn "原生仅 $native：-c 超过它必须加 --rope-scaling yarn --rope-scale 2/4，否则静默掉质量"
      fi
    fi
    if ! echo "$meta" | grep -qi 'rope_scale\|rope.scaling\|yarn'; then
      say_warn "metadata 无 rope 缩放字段：说明模型未内建 YaRN，超原生长度需手工指定"
    fi
  else
    say_warn "未读到 metadata（llama-gguf 可能不叫这个名字）"
  fi
elif [[ ! -f "$MODEL" ]]; then
  say_warn "模型文件不存在: $MODEL"
else
  say_warn "缺少 llama-gguf，无法读取原生上下文"
fi

echo
printf '结果: OK=%d  WARN=%d  FAIL=%d\n' "$ok" "$warn" "$bad"
if (( bad > 0 )); then
  echo "=> 存在 FAIL 项，请先处理再启动服务。"
  exit 1
fi
echo "=> 体检通过，可执行: sudo ./scripts/start-llama-server.sh"
exit 0