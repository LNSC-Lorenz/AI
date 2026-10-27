#!/usr/bin/env bash
# LNSC-DGX · 受控变更框架
#   默认只读:  status / plan 不改任何东西
#   apply:     自动 快照 → 备份 → 执行 → 验证 → 审计；失败自动回滚
#   rollback:  严格还原到变更前状态
# 铁律: 一次只改一个变更项；有活跃请求时拒绝重启；所有动作写 /var/log/lnsc/audit-*.log
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-/var/log/lnsc}"
AUDIT="$LOG_DIR/audit-$(date +%Y%m%d).log"
STATE="$LOG_DIR/state"
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8081}"

UNIT=llama-qwen38.service
UNIT_PATH="/etc/systemd/system/$UNIT"
BIN="${BIN:-/opt/llama.cpp/build/bin/llama-server}"
MODEL="${MODEL:-/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf}"
CTX="${CTX:-131072}"     # 要扩到 192k: CTX=196608 CTV=q4_0
CTK="${CTK:-q8_0}"
CTV="${CTV:-q8_0}"
MEM_HIGH="${MEM_HIGH:-}"     # 留空则不设（当前实际占用约 120 GiB, 设低了会触发 cgroup 限流）
MEM_MAX="${MEM_MAX:-118G}"   # 兜底：进程疯长时被杀, 而不是把整机拖进 swap
METRICS="${METRICS:-1}"

say(){ printf '%s\n' "$*"; }
rec(){ mkdir -p "$LOG_DIR" "$STATE" 2>/dev/null; printf '%s | %-16s | %s\n' "$(date '+%F %T')" "$1" "$2" | tee -a "$AUDIT"; }
die(){ rec "FAIL" "$*"; say "❌ $*"; exit 1; }
root_needed(){ [[ ${EUID:-0} -eq 0 ]] || die "需要 root: sudo $0 $*"; }
busy(){ curl -s --max-time 4 "$LLAMA_URL/slots" 2>/dev/null | grep -q '"is_processing":true'; }

usage(){ cat <<EOF
用法: $0 <command> <change-id>
  status             只读：显示全部变更项当前状态
  plan   <id>        只读：打印将要执行的步骤
  apply  <id>        执行（需 root；自动快照+审计；失败自动回滚）
  rollback <id>      回滚

change-id:
  swappiness       vm.swappiness 60 → 10        （在线可做, 不停服务）
  systemd-llama    手工进程 → systemd + --metrics + MemoryMax（⚠️ 需停机窗口）
  ollama-isolate   ollama 0.0.0.0:11434 → 127.0.0.1:11434（秒级, 空闲时做）

环境变量: CTX CTK CTV MEM_HIGH MEM_MAX METRICS MODEL BIN LLAMA_URL
EOF
}

cmd_status(){
  say "== 变更项状态（只读，不改任何东西）=="
  say "swappiness     : $(cat /proc/sys/vm/swappiness 2>/dev/null)"
  say "persist 文件   : $(ls /etc/sysctl.d/99-lnsc-swappiness.conf 2>/dev/null || echo 不存在)"
  say "systemd 单元   : $(ls "$UNIT_PATH" 2>/dev/null || echo '不存在（当前为手工启动）')"
  say "单元状态       : $(systemctl is-active "$UNIT" 2>/dev/null | head -1 || true)"
  say "ollama 监听    : $(ss -ltn 2>/dev/null | awk '/:11434/{print $4}' | paste -sd, - || echo 未监听)"
  say "ollama drop-in : $(ls /etc/systemd/system/ollama.service.d/*.conf 2>/dev/null | paste -sd, - || echo 无)"
  local p; p=$(pgrep -x llama-server | head -1 || true)
  say "llama pid      : ${p:-未运行}"
  say "  原 cmdline   : $(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)"
  say "有请求在处理   : $(busy && echo YES || echo no)"
  say "审计日志       : $AUDIT"
}

cmd_plan(){
  case "${1:-}" in
    swappiness)
      say "【swappiness】vm.swappiness 60 → 10（降低 swap 倾向，缓解统一内存抖动）"
      say "  1) 备份当前值 → $STATE/swappiness.orig"
      say "  2) 写 /etc/sysctl.d/99-lnsc-swappiness.conf"
      say "  3) sysctl --system；验证 == 10"
      say "  影响: 只影响内核回收策略，不重启服务；回滚: rollback swappiness" ;;
    systemd-llama)
      say "【systemd-llama】手工进程 → systemd 托管（+ --metrics + MemoryMax）"
      say "  前置: 无活跃请求 + CONFIRM=i-accept-downtime"
      say "  1) 快照 scripts/dgx-snapshot.sh"
      say "  2) 保存原 cmdline → $STATE/llama-orig-cmdline.txt（回滚依据）"
      say "  3) 写 $UNIT_PATH  (-c $CTX -ctk $CTK -ctv $CTV metrics=$METRICS)"
      say "  4) SIGINT 手工进程 → systemctl enable --now"
      say "  5) 验证 /health + n_ctx，失败自动 rollback"
      say "  影响: ⚠️ 中断 1~3 分钟（重读 103.7 GiB 权重）" ;;
    ollama-isolate)
      say "【ollama-isolate】0.0.0.0:11434 → 127.0.0.1:11434（消除 17GB 模型误调导致 OOM）"
      say "  1) 快照 → 2) 写 ollama.service.d/zz-lnsc-bind.conf（**必须 zz- 前缀**）" 
      say "     ⚠️ 现有 override.conf 里写着 OLLAMA_HOST=0.0.0.0:11434；drop-in 按文件名排序，"
      say "        只有排在 override.conf 之后的文件才能覆盖它 → 故用 zz- 前缀"
      say "  3) restart ollama"
      say "  影响: 远程调用 ollama 将失败（这是目的）；秒级；回滚: rollback ollama-isolate" ;;
    *) usage; exit 2 ;;
  esac
  say ""
  say "→ 确认后执行: sudo $0 apply ${1:-}"
}

cmd_apply(){
  local id="${1:-}"; root_needed apply "$id"
  local snap; snap=$(bash "$ROOT/scripts/dgx-snapshot.sh" 2>/dev/null | tail -1)
  rec "$id/apply" "START snapshot=${snap:-none}"
  case "$id" in
    swappiness)
      cat /proc/sys/vm/swappiness > "$STATE/swappiness.orig" 2>/dev/null
      printf 'vm.swappiness=10\n' > /etc/sysctl.d/99-lnsc-swappiness.conf
      sysctl --system >/dev/null 2>&1
      [[ "$(cat /proc/sys/vm/swappiness)" == "10" ]] || die "验证失败 (swappiness != 10)，请 rollback"
      rec "$id/apply" "OK swappiness=10 orig=$(cat "$STATE/swappiness.orig")"
      say "✅ 完成。回滚: sudo $0 rollback swappiness" ;;

    systemd-llama)
      if busy; then die "有请求正在处理 (is_processing=true)，拒绝重启；等空闲后重试"; fi
      [[ "${CONFIRM:-}" == "i-accept-downtime" ]] || die "需显式确认停机: CONFIRM=i-accept-downtime sudo $0 apply systemd-llama"
      [[ -x "$BIN" ]] || die "找不到 $BIN"
      [[ -f "$MODEL" ]] || die "找不到模型 $MODEL"

      local oldpid; oldpid=$(pgrep -x llama-server | head -1 || true)
      if [[ -n "$oldpid" ]]; then
        tr '\0' ' ' < "/proc/$oldpid/cmdline" > "$STATE/llama-orig-cmdline.txt" 2>/dev/null
        rec "$id/apply" "已保存原 cmdline → $STATE/llama-orig-cmdline.txt"
      fi
      [[ -f "$UNIT_PATH" ]] && { cp -a "$UNIT_PATH" "$STATE/$UNIT.$(date +%s).bak"; rec "$id/apply" "备份旧 unit"; }

      local MFLAG=""; [[ "$METRICS" == "1" ]] && MFLAG="--metrics"
      local MEM_LINES=""
      [[ -n "$MEM_HIGH" ]] && MEM_LINES="${MEM_LINES}MemoryHigh=$MEM_HIGH"$'\n'
      [[ -n "$MEM_MAX"  ]] && MEM_LINES="${MEM_LINES}MemoryMax=$MEM_MAX"$'\n'
      cat > "$UNIT_PATH" <<EOF
[Unit]
Description=llama.cpp Server - Qwen3.8-Flash-Next (GB10) [LNSC-DGX]
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$(dirname "$MODEL")
ExecStart=$BIN -m $MODEL --alias qwen3.8-flash-next \\
  -c $CTX -b 2048 -ub 512 -ngl 999 -fa on \\
  -ctk $CTK -ctv $CTV --jinja --parallel 1 $MFLAG \\
  --host 0.0.0.0 --port 8081
Restart=on-failure
RestartSec=10
TimeoutStartSec=900
KillSignal=SIGINT
TimeoutStopSec=60
${MEM_LINES}StandardOutput=journal
StandardError=journal
SyslogIdentifier=llama-qwen38

[Install]
WantedBy=multi-user.target
EOF
      rec "$id/apply" "写入 $UNIT_PATH (CTX=$CTX CTK=$CTK CTV=$CTV metrics=$METRICS)"
      systemctl daemon-reload || die "daemon-reload 失败"

      if [[ -n "$oldpid" ]]; then
        rec "$id/apply" "SIGINT 手工进程 pid=$oldpid"
        kill -INT "$oldpid" 2>/dev/null || true
        for _ in $(seq 1 60); do kill -0 "$oldpid" 2>/dev/null || break; sleep 1; done
        if kill -0 "$oldpid" 2>/dev/null; then
          rm -f "$UNIT_PATH"; systemctl daemon-reload
          die "旧进程 60s 未退出，已撤销 unit；请人工检查 pid=$oldpid"
        fi
      fi

      if ! systemctl enable --now "$UNIT" >/dev/null 2>&1; then
        systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
        rm -f "$UNIT_PATH"; systemctl daemon-reload
        die "systemctl 启动失败，已回滚 unit"
      fi

      say "⏳ 等待模型加载（1~3 分钟，需重读 103.7 GiB）..."
      local ok=0
      for _ in $(seq 1 120); do
        curl -s --max-time 3 "$LLAMA_URL/health" 2>/dev/null | grep -q '"status":"ok"' && { ok=1; break; }
        sleep 5
      done
      if (( ! ok )); then
        say "❌ 健康检查超时，自动回滚"
        systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
        rm -f "$UNIT_PATH"; systemctl daemon-reload
        rec "$id/apply" "FAIL health timeout → rolled back"
        die "启动失败，已回滚。原命令见 $STATE/llama-orig-cmdline.txt"
      fi
      local nctx; nctx=$(curl -s --max-time 5 "$LLAMA_URL/props" | grep -o '"n_ctx":[0-9]*' | head -1 | cut -d: -f2)
      rec "$id/apply" "OK health=ok n_ctx=$nctx"
      say "✅ 已托管到 systemd，n_ctx=$nctx"
      say "   日志: journalctl -u $UNIT -f"
      say "   回滚: sudo $0 rollback systemd-llama" ;;

    ollama-isolate)
      mkdir -p /etc/systemd/system/ollama.service.d
      local f=/etc/systemd/system/ollama.service.d/zz-lnsc-bind.conf
      [[ -f "$f" ]] && cp -a "$f" "$STATE/zz-lnsc-bind.conf.$(date +%s).bak"
      printf '[Service]\nEnvironment="OLLAMA_HOST=127.0.0.1:11434"\n' > "$f"
      systemctl daemon-reload || die "daemon-reload 失败"
      if ! systemctl restart ollama; then
        rm -f "$f"; systemctl daemon-reload; systemctl start ollama 2>/dev/null || true
        die "ollama 重启失败，已回滚"
      fi
      sleep 3
      if ss -ltn 2>/dev/null | grep -q '127.0.0.1:11434'; then
        rec "$id/apply" "OK ollama → 127.0.0.1:11434"
        say "✅ 完成。回滚: sudo $0 rollback ollama-isolate"
      else
        systemctl status ollama --no-pager -n 5 2>&1 | sed 's/^/   /'
        die "未检测到 127.0.0.1:11434，请人工确认（日志见上）"
      fi ;;
    *) usage; exit 2 ;;
  esac
}

cmd_rollback(){
  local id="${1:-}"; root_needed rollback "$id"
  rec "$id/rollback" "START"
  case "$id" in
    swappiness)
      rm -f /etc/sysctl.d/99-lnsc-swappiness.conf
      local orig; orig=$(cat "$STATE/swappiness.orig" 2>/dev/null || echo 60)
      sysctl -w vm.swappiness="$orig" >/dev/null 2>&1
      rec "$id/rollback" "OK swappiness=$orig"
      say "✅ 已回滚 swappiness=$orig" ;;

    systemd-llama)
      systemctl disable --now "$UNIT" >/dev/null 2>&1 || true
      local bak; bak=$(ls -1t "$STATE/$UNIT".*.bak 2>/dev/null | head -1)
      if [[ -n "$bak" ]]; then cp -a "$bak" "$UNIT_PATH"; say "已还原旧 unit: $bak"
      else rm -f "$UNIT_PATH"; fi
      systemctl daemon-reload
      rec "$id/rollback" "OK unit 已移除/还原"
      say "✅ 已回滚。如需恢复原手工进程（原命令已保存）:"
      say "   $(cat "$STATE/llama-orig-cmdline.txt" 2>/dev/null || echo '(未保存)')" ;;

    ollama-isolate)
      rm -f /etc/systemd/system/ollama.service.d/zz-lnsc-bind.conf
      systemctl daemon-reload && systemctl restart ollama
      rec "$id/rollback" "OK ollama drop-in 已移除（override.conf 保持原样）"
      say "✅ 已回滚 ollama 监听地址" ;;
    *) usage; exit 2 ;;
  esac
}

cmd="${1:-status}"; shift || true
case "$cmd" in
  status)   cmd_status ;;
  plan)     cmd_plan "${1:-}" ;;
  apply)    cmd_apply "${1:-}" ;;
  rollback) cmd_rollback "${1:-}" ;;
  *)        usage; exit 2 ;;
esac