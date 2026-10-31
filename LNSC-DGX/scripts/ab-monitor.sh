#!/usr/bin/env bash
# LNSC-DGX · 测试期间只读资源采样：CSV + 末尾摘要
set -euo pipefail
OUT="${1:?输出 CSV 路径}"
DURATION="${2:-1800}"
UNIT="${UNIT:-llama-qwen38}"
mkdir -p "$(dirname "$OUT")"
echo 'timestamp,mem_available_mib,swap_used_mib,cgroup_mib,process_swap_mib,gpu_util_percent,sm_clock_mhz' > "$OUT"
start=$SECONDS
while (( SECONDS - start < DURATION )); do
  ma=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  st=$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo)
  sf=$(awk '/SwapFree/{print int($2/1024)}' /proc/meminfo)
  su=$((st-sf))
  cg=$(awk '{print int($1/1048576)}' "/sys/fs/cgroup/system.slice/$UNIT.service/memory.current" 2>/dev/null || echo 0)
  pid=$(pgrep -x llama-server | head -1 || true)
  ps=0
  [[ -n "$pid" ]] && ps=$(awk '/VmSwap:/{print int($2/1024)}' "/proc/$pid/status" 2>/dev/null || echo 0)
  gpu=$(nvidia-smi --query-gpu=utilization.gpu,clocks.sm --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || echo ',')
  util=${gpu%%,*}; clock=${gpu##*,}
  printf '%s,%d,%d,%d,%d,%s,%s\n' "$(date --iso-8601=seconds)" "$ma" "$su" "$cg" "$ps" "${util:-0}" "${clock:-0}" >> "$OUT"
  sleep 10
done
