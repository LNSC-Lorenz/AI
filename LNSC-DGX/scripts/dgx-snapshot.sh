#!/usr/bin/env bash
# LNSC-DGX · 只读证据快照
# 作用: 把"变更前/变更后"的系统与模型状态落盘, 供对比与回滚依据。
# 只读: 不修改任何系统配置; 仅写 /var/log/lnsc/snapshots/<ts>/。
# 输出: 最后一行打印快照目录, 便于其他脚本捕获。
set -uo pipefail

LOG_DIR="${LOG_DIR:-/var/log/lnsc}"
SNAP_ROOT="$LOG_DIR/snapshots"
KEEP="${KEEP:-14}"
TS="$(date +%Y%m%d-%H%M%S)"
D="$SNAP_ROOT/$TS"
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8081}"
PID_LLAMA="$(pgrep -x llama-server 2>/dev/null | head -1 || true)"

mkdir -p "$D" || { echo "无法创建 $D" >&2; exit 1; }

# 1) 基础身份
{
  echo "snapshot=$TS"
  echo "host=$(hostname)"
  echo "kernel=$(uname -r)"
  echo "arch=$(uname -m)"
  echo "uptime=$(uptime -p 2>/dev/null || uptime)"
  echo "loadavg=$(cut -d' ' -f1-3 /proc/loadavg)"
} > "$D/00-identity.txt"

# 2) 内存/交换
{ head -20 /proc/meminfo; echo '--- swapon ---'; swapon --show 2>&1;
  echo '--- sysctl ---'; sysctl vm.swappiness vm.vfs_cache_pressure vm.overcommit_memory 2>&1; } > "$D/10-memory.txt"

# 3) GPU
{ nvidia-smi 2>&1 | head -20
  echo '--- query ---'
  nvidia-smi --query-gpu=name,compute_cap,driver_version,utilization.gpu,temperature.gpu,power.draw,clocks.sm --format=csv 2>&1
  echo '--- apps ---'
  nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv 2>&1
} > "$D/20-gpu.txt"

# 4) 进程与参数（回滚的原始依据）
{
  echo '--- pgrep ---'; pgrep -ax llama-server 2>&1
  if [[ -n "$PID_LLAMA" ]]; then
    echo "--- cmdline(pid=$PID_LLAMA) ---"
    tr '\0' ' ' < "/proc/$PID_LLAMA/cmdline" 2>/dev/null; echo
    echo '--- smaps_rollup ---'; grep -E '^(Rss|Pss|Pss_Anon|Pss_File|Pss_Shmem)' "/proc/$PID_LLAMA/smaps_rollup" 2>/dev/null
    echo '--- fd(日志去向) ---'; ls -l "/proc/$PID_LLAMA/fd/1" "/proc/$PID_LLAMA/fd/2" 2>&1
    echo '--- SigIgn(判断 SIGHUP 是否被忽略) ---'; grep -E '^Sig(Ign|Blk)' "/proc/$PID_LLAMA/status" 2>/dev/null
  fi
} > "$D/30-process.txt"

# 5) 端口与服务
{ ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null
  echo '--- units ---'
  systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -iE 'llama|ollama|vllm|webui|docker'
  echo '--- favorites ---'
  for u in ollama vllm openwebui docker; do printf '%s=%s\n' "$u" "$(systemctl is-active $u 2>&1)"; done
} > "$D/40-services.txt"

# 6) 存量 systemd 单元与 drop-in（回滚依据）
{ ls -l /etc/systemd/system/*.service /etc/systemd/system/*.service.d 2>/dev/null
  for u in ollama vllm openwebui; do
    [[ -f "/etc/systemd/system/$u.service" ]] && { echo "=== $u.service ==="; cat "/etc/systemd/system/$u.service"; }
  done
} > "$D/50-units.txt"

# 7) 模型与磁盘
{ df -h / /models 2>/dev/null
  du -sh /models/qwen3.8-flash-next 2>/dev/null
  ls -l /models/qwen3.8-flash-next/UD-Q4_K_XL/*.gguf 2>/dev/null
} > "$D/60-storage.txt"

# 8) 运行态 API（服务活着才有）
{
  echo "url=$LLAMA_URL"
  echo "health=$(curl -s --max-time 5 "$LLAMA_URL/health" 2>/dev/null)"
  echo '--- props ---'; curl -s --max-time 5 "$LLAMA_URL/props" 2>/dev/null | head -c 400; echo
  echo '--- models.meta ---'; curl -s --max-time 5 "$LLAMA_URL/v1/models" 2>/dev/null | grep -o '"meta":{.*}' | head -c 500; echo
  echo '--- slots ---'; curl -s --max-time 5 "$LLAMA_URL/slots" 2>/dev/null | grep -oE '"(n_ctx|n_prompt_tokens|n_prompt_tokens_cache|is_processing|n_decoded)":("?[a-z0-9]+"?)' | head -20
} > "$D/70-api.txt"

# 9) OOM/内核日志（最近）
{ dmesg -T 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -20 || echo '(无)'; } > "$D/80-oom.txt"

# 10) 审计日志尾部（谁做过什么）
{ ls -l "$LOG_DIR" 2>/dev/null; tail -30 "$LOG_DIR"/audit-*.log 2>/dev/null; } > "$D/90-audit-tail.txt"

# 11) 哈希清单（完整性）
( cd "$D" && sha256sum ./*.txt > MANIFEST.sha256 2>/dev/null )

# 12) 打包 + 保留最近 N 份
tar -czf "$SNAP_ROOT/$TS.tar.gz" -C "$SNAP_ROOT" "$TS" 2>/dev/null
mapfile -t old < <(ls -1dt "$SNAP_ROOT"/2*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)))
for f in "${old[@]:-}"; do [[ -n "$f" ]] && rm -f "$f"; done
mapfile -t oldd < <(ls -1dt "$SNAP_ROOT"/2*/ 2>/dev/null | tail -n +$((KEEP+1)))
for f in "${oldd[@]:-}"; do [[ -n "$f" ]] && rm -rf "$f"; done

echo "$D"