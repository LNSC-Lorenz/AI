#!/usr/bin/env bash
# LNSC-DGX · 只读巡检（在 DGX 本机执行，或由外部经 SSH 调用）
# 全部命令只读：不启动/不停止服务、不改配置、不写任何文件（除临时 pipe）
# 用法: ./scripts/dgx-healthscan.sh [API_BASE]     默认 API_BASE=http://127.0.0.1:8081
set -uo pipefail

API="${1:-${API:-http://127.0.0.1:8081}}"
MODEL_DIR="${MODEL_DIR:-/models/qwen3.8-flash-next}"
WARN=0
w() { printf '  [WARN] %s\n' "$*"; WARN=$((WARN+1)); }
h() { printf '\n===== %s =====\n' "$*"; }

h "0. 基本信息"
echo "  时间      : $(date -Is)"
echo "  主机      : $(hostname)  ($(uname -m), kernel $(uname -r))"
echo "  系统      : $( (grep -h PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '\"') || echo unknown)"
echo "  运行时长  : $(if command -v uptime >/dev/null 2>&1; then uptime -p 2>/dev/null || uptime; else awk '{printf "%.0f 秒", $1}' /proc/uptime 2>/dev/null; fi)"
echo "  CPU 核数  : $(nproc)"
echo "  负载      : $(cut -d' ' -f1-3 /proc/loadavg) (1/5/15 min)"

h "1. 内存（统一内存，GB10）"
awk '/^(MemTotal|MemFree|MemAvailable|Buffers|Cached|SwapTotal|SwapFree|Dirty):/{printf "  %-13s %8.2f GiB\n", $1, $2/1048576}' /proc/meminfo
avail_mb=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo 2>/dev/null)
swap_used_mb=$(awk '/SwapTotal/{t=$2}/SwapFree/{f=$2}END{print int((t-f)/1024)}' /proc/meminfo 2>/dev/null)
[[ "$avail_mb" =~ ^[0-9]+$ ]] || avail_mb=999999
[[ "$swap_used_mb" =~ ^[0-9]+$ ]] || swap_used_mb=0
echo "  -> MemAvailable=${avail_mb} MiB   SwapUsed=${swap_used_mb} MiB"
(( avail_mb < 2048 )) && w "MemAvailable < 2GiB，已进入危险区（177B 模型稳态约 8~10GiB 属正常，但不应继续下降）"
(( swap_used_mb > 512 )) && w "swap 已用 ${swap_used_mb}MiB，说明发生过内存压力"

h "2. GPU（nvidia-smi）"
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=name,compute_cap,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw,clocks.sm --format=csv,noheader 2>/dev/null | sed 's/^/  /'
  echo "  -- 计算进程 --"
  nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader 2>/dev/null | sed 's/^/  /' || echo "  (无)"
else
  w "无 nvidia-smi"
fi

h "3. llama-server 进程"
if pgrep -x llama-server >/dev/null 2>&1; then
  pgrep -x llama-server | while read -r p; do
    echo "  PID $p  RSS=$(awk '/VmRSS/{printf "%.2f GiB", $2/1048576}' /proc/$p/status 2>/dev/null)  elapsed=$(ps -o etime= -p "$p" 2>/dev/null | tr -d ' ')"
    tr '\0' ' ' < /proc/$p/cmdline 2>/dev/null | sed 's/^/    cmd: /'; echo
  done
  cnt=$(pgrep -x llama-server | wc -l | tr -d ' ')
  (( cnt > 1 )) && w "存在 ${cnt} 个 llama-server 实例"
else
  echo "  (无 llama-server 进程)"
fi
echo "  -- 内存占用 Top5 --"
ps -eo pid,rss,etime,comm --sort=-rss 2>/dev/null | head -6 | sed 's/^/  /'

h "4. 端口监听"
if command -v ss >/dev/null 2>&1; then
  ss -ltn 2>/dev/null | awk 'NR==1 || /:(8080|8081|8082|11434|8000|3000)\s/' | sed 's/^/  /'
else
  netstat -ltn 2>/dev/null | grep -E ':(8080|8081|8082|11434|8000|3000)' | sed 's/^/  /' || echo "  无 ss/netstat"
fi

h "5. 服务与容器"
systemctl list-units --type=service --all --no-legend --no-pager 2>/dev/null | grep -iE 'llama|ollama|vllm' | sed 's/^/  /' || echo "  (无相关 systemd 服务)"
command -v docker >/dev/null 2>&1 && { echo "  -- docker --"; docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null | sed 's/^/  /'; } || echo "  (无 docker)"

h "6. 模型与磁盘"
[[ -d "$MODEL_DIR" ]] && du -sh "$MODEL_DIR" 2>/dev/null | sed 's/^/   体积: /'
[[ -d "$MODEL_DIR" ]] && ls -la "$MODEL_DIR"/*/*.gguf 2>/dev/null | awk '{printf "  %10.2f GiB  %s\n", $5/1073741824, $9}' || echo "  (未找到 gguf)"
df -h / /models 2>/dev/null | awk 'NR==1 || /\/$|\/models/' | sed 's/^/  /'

h "7. 服务 API（$API）"
if command -v curl >/dev/null 2>&1; then
  echo "  /health: $(curl -s --max-time 5 "$API/health" || echo '(无响应)')"
  props=$(curl -s --max-time 5 "$API/props" 2>/dev/null)
  models=$(curl -s --max-time 5 "$API/v1/models" 2>/dev/null)
  slots=$(curl -s --max-time 5 "$API/slots" 2>/dev/null)
  # 通用取值（不依赖 python），供两条分支与上下文余量计算共用
  nctx=$(echo "$props" | grep -o '"n_ctx":[0-9][0-9]*'              | head -1 | cut -d: -f2)
  ptok=$(echo "$slots" | grep -o '"n_prompt_tokens":[0-9][0-9]*'    | head -1 | cut -d: -f2)
  # python3 必须"真的能跑"才用（有些环境只有 App Execution Alias 存根，会静默失败）
  have_py=0
  if command -v python3 >/dev/null 2>&1 && echo '{}' | python3 -c 'import json,sys' >/dev/null 2>&1; then
    have_py=1
  fi
  if (( have_py )); then
    [[ -n "$props" ]] && echo "$props" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  n_ctx =",d["default_generation_settings"]["n_ctx"],"| slots =",d.get("total_slots"),"| alias =",d.get("model_alias"),"| ftype =",d.get("model_ftype"))' 2>/dev/null
    [[ -n "$models" ]] && echo "$models" | python3 -c 'import json,sys;m=json.load(sys.stdin)["data"][0]["meta"];print("  n_params = {:,} | size = {:.2f} GiB | n_ctx_train = {}".format(m["n_params"], m["size"]/2**30, m["n_ctx_train"]))' 2>/dev/null
    [[ -n "$slots" ]] && echo "$slots" | python3 -c 'import json,sys;s=json.load(sys.stdin)[0];print("  processing =",s.get("is_processing"),"| prompt_tokens =",s.get("n_prompt_tokens"),"| cached =",s.get("n_prompt_tokens_cache"))' 2>/dev/null
  else
    echo "  (python3 不可用，改用 grep 解析)"
    echo "  n_ctx       : $nctx"
    echo "  total_slots : $(echo "$props"  | grep -o '"total_slots":[0-9][0-9]*'  | head -1 | cut -d: -f2)"
    echo "  model_alias : $(echo "$props"  | grep -o '"model_alias":"[^"]*"'     | head -1 | cut -d: -f2 | tr -d '\"')"
    echo "  n_params    : $(echo "$models" | grep -o '"n_params":[0-9][0-9]*'    | head -1 | cut -d: -f2)"
    sz=$(echo "$models" | grep -o '"size":[0-9][0-9]*' | head -1 | cut -d: -f2)
    echo "  size        : ${sz:-?} bytes ($(awk -v b="${sz:-0}" 'BEGIN{printf "%.2f", b/1073741824}') GiB)"
    echo "  n_ctx_train : $(echo "$models" | grep -o '"n_ctx_train":[0-9][0-9]*' | head -1 | cut -d: -f2)"
    echo "  processing  : $(echo "$slots"  | grep -o '"is_processing":[a-z]*'   | head -1 | cut -d: -f2)"
    echo "  prompt_tok  : $ptok"
    echo "  cached_tok  : $(echo "$slots"  | grep -o '"n_prompt_tokens_cache":[0-9][0-9]*' | head -1 | cut -d: -f2)"
  fi
  # 上下文余量: 现有 prompt 离 n_ctx 还有多少（决定"下一次请求会不会再撞限"）
  if [[ "$nctx" =~ ^[0-9]+$ && "$ptok" =~ ^[0-9]+$ ]] && (( ptok > 0 )); then
    left=$(( nctx - ptok ))
    echo "  ctx 余量    : ${left} tokens (n_ctx ${nctx} - prompt ${ptok})"
    (( left < 8192 )) && w "剩余上下文 < 8k，长回答会被截断/触发 context shift"
  fi
  m=$(curl -s --max-time 5 "$API/metrics" 2>/dev/null | grep -E '^# ' -v | grep -E 'kv_cache_usage_ratio|requests_deferred|requests_processing|tokens_predicted_total' )
  if [[ -n "$m" ]]; then echo "  -- metrics --"; echo "$m" | sed 's/^/  /'; else echo "  /metrics: 未启用（启动参数需加 --metrics）"; fi
else
  w "本机无 curl，跳过 API 检查"
fi

h "汇总"
echo "  告警项: $WARN"
echo "  （本脚本只读，未做任何变更；如需更多细节请贴出上面完整输出）"
exit 0