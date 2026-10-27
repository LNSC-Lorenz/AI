#!/usr/bin/env bash
# LNSC-DGX · 5 分钟指标采集（无新依赖，纯 bash+cron）
# 写入: /var/log/lnsc/metrics.csv  (追加)
# 告警: /var/log/lnsc/alerts.log   (超阈值时追加)
# 只读: 不修改系统；仅调用 nvidia-smi / /proc / llama.cpp 的 GET 接口
set -uo pipefail

LOG_DIR="${LOG_DIR:-/var/log/lnsc}"
CSV="$LOG_DIR/metrics.csv"
ALERT="$LOG_DIR/alerts.log"
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8081}"

# 阈值（按 177B/103.7GiB 权重的实测基线设定）
TH_MEMAVAIL_MB="${TH_MEMAVAIL_MB:-2048}"   # available 低于此值告警
TH_CTX_RATIO="${TH_CTX_RATIO:-95}"         # 上下文占用百分比
TH_GPU_TEMP="${TH_GPU_TEMP:-85}"
TH_SWAP_MB="${TH_SWAP_MB:-2048}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
[[ -f "$CSV" ]] || echo "ts,mem_avail_mb,swap_used_mb,cached_mb,gpu_temp_c,gpu_power_w,gpu_util,llama_alive,n_ctx,prompt_tokens,ctx_pct,is_processing" >> "$CSV"

ts=$(date '+%Y-%m-%dT%H:%M:%S')
read -r avail_mb swap_mb cached_mb < <(awk '
  /^MemAvailable:/{a=int($2/1024)}
  /^Cached:/{c=int($2/1024)}
  /^SwapTotal:/{t=$2}
  /^SwapFree:/{f=$2}
  END{printf "%d %d %d\n", a, int((t-f)/1024), c}' /proc/meminfo)

read -r gpu_temp gpu_power gpu_util < <(nvidia-smi --query-gpu=temperature.gpu,power.draw,utilization.gpu --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' | awk -F, '{printf "%s %s %s\n", $1, $2, $3}')
[[ "$gpu_temp" =~ ^[0-9]+$ ]] || gpu_temp=0
[[ "$gpu_power" =~ ^[0-9.]+$ ]] || gpu_power=0
[[ "$gpu_util" =~ ^[0-9]+$ ]] || gpu_util=0

if pgrep -x llama-server >/dev/null 2>&1; then alive=1; else alive=0; fi

slots=$(curl -s --max-time 4 "$LLAMA_URL/slots" 2>/dev/null || true)
n_ctx=$(grep -o '"n_ctx":[0-9]*' <<<"$slots" | head -1 | cut -d: -f2); n_ctx=${n_ctx:-0}
ptok=$(grep -o '"n_prompt_tokens":[0-9]*' <<<"$slots" | head -1 | cut -d: -f2); ptok=${ptok:-0}
proc=$(grep -o '"is_processing":[a-z]*' <<<"$slots" | head -1 | cut -d: -f2); proc=${proc:-false}
if (( n_ctx > 0 )); then ctx_pct=$(( ptok * 100 / n_ctx )); else ctx_pct=0; fi

echo "$ts,$avail_mb,$swap_mb,$cached_mb,$gpu_temp,$gpu_power,$gpu_util,$alive,$n_ctx,$ptok,$ctx_pct,$proc" >> "$CSV"

alarm() { printf '%s ALERT %s\n' "$ts" "$*" >> "$ALERT"; }

(( avail_mb < TH_MEMAVAIL_MB )) && alarm "MemAvailable=${avail_mb}MiB < ${TH_MEMAVAIL_MB}MiB (OOM 前兆)"
(( swap_mb > TH_SWAP_MB ))      && alarm "SwapUsed=${swap_mb}MiB > ${TH_SWAP_MB}MiB (统一内存吃紧)"
(( gpu_temp >= TH_GPU_TEMP ))   && alarm "GPU=${gpu_temp}C >= ${TH_GPU_TEMP}C (可能降频)"
(( ctx_pct >= TH_CTX_RATIO ))   && alarm "上下文占用 ${ctx_pct}% (${ptok}/${n_ctx})，即将触发 exceeds context size"
(( alive == 0 ))                && alarm "llama-server 未运行"

# 可选外发（默认关闭；设置 LNSC_WEBHOOK 后启用，5 分钟最多一条）
if [[ -n "${LNSC_WEBHOOK:-}" && -s "$ALERT" ]]; then
  last="$(tail -1 "$ALERT")"
  [[ "$last" == "$ts"* ]] && curl -s -m 5 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"LNSC-DGX $last\"}" "$LNSC_WEBHOOK" >/dev/null 2>&1 || true
fi
exit 0