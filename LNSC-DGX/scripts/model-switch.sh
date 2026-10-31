#!/usr/bin/env bash
# LNSC-DGX · Flash / Next 互斥切换；不改 enabled 状态，失败自动恢复先前服务。
set -euo pipefail

ACTION="${1:-status}"
BASE="${BASE:-http://127.0.0.1:8081}"
LOCK=/tmp/lnsc-model-switch.lock
exec 9>"$LOCK"
flock -n 9 || { echo "另一个切换正在进行" >&2; exit 2; }

show_status() {
  for u in llama-qwen38 llama-qwen3next; do
    printf '%-20s active=%-10s enabled=%s\n' "$u" \
      "$(systemctl is-active "$u" 2>/dev/null || true)" \
      "$(systemctl is-enabled "$u" 2>/dev/null || true)"
  done
  curl -sS --max-time 3 "$BASE/health" 2>/dev/null || true
  echo
}

wait_health() {
  local unit="$1" limit="$2" started=$SECONDS alias
  if [[ "$unit" == llama-qwen38 ]]; then
    alias=qwen3.8-flash-next
  else
    alias=qwen3-next-80b-a3b-instruct
  fi
  while (( SECONDS - started < limit )); do
    if curl -fsS --max-time 3 "$BASE/v1/models" 2>/dev/null \
       | grep -Fq "\"id\":\"$alias\""; then return 0; fi
    if systemctl is-failed "$unit" >/dev/null 2>&1; then return 1; fi
    sleep 3
  done
  return 1
}

wait_slot_idle() {
  local started=$SECONDS slots
  while (( SECONDS - started < 180 )); do
    slots=$(curl -fsS --max-time 3 "$BASE/slots" 2>/dev/null) || return 0
    if ! grep -q '"is_processing":true' <<<"$slots"; then return 0; fi
    sleep 3
  done
  echo "当前请求持续占用 slot；为避免取消 prefill，暂不切换" >&2
  return 1
}

drain_model() {
  local unit="$1" started=$SECONDS
  systemctl stop "$unit" 2>/dev/null || true
  while (( SECONDS - started < 150 )); do
    if ! pgrep -x llama-server >/dev/null 2>&1; then
      systemctl reset-failed "$unit" 2>/dev/null || true
      return 0
    fi
    sleep 2
  done
  echo "停止 $unit 后仍有 llama-server，拒绝继续：" >&2
  pgrep -ax llama-server >&2 || true
  return 1
}

restore_previous() {
  [[ -z "$previous" ]] && return 0
  systemctl reset-failed "$previous" 2>/dev/null || true
  systemctl start "$previous"
  wait_health "$previous" 900
}

case "$ACTION" in
  status)
    show_status
    ;;
  flash|next)
    if [[ "$ACTION" == flash ]]; then
      TARGET=llama-qwen38; OTHER=llama-qwen3next; LIMIT=900
    else
      TARGET=llama-qwen3next; OTHER=llama-qwen38; LIMIT=600
    fi
    previous=""
    systemctl is-active "$OTHER" >/dev/null 2>&1 && previous="$OTHER"
    if systemctl is-active "$TARGET" >/dev/null 2>&1; then
      echo "$TARGET 已在运行，无需切换"
      show_status
      exit 0
    fi
    if ! wait_slot_idle; then
      exit 3
    fi
    echo "切换：${previous:-无先前服务} -> $TARGET（enabled 状态不变）"
    if [[ -n "$previous" ]]; then
      drain_model "$previous" || exit 1
    fi
    if pgrep -x llama-server >/dev/null 2>&1; then
      echo "发现非受控或其他 llama-server，拒绝启动第二实例：" >&2
      pgrep -ax llama-server >&2
      echo "${previous:-先前服务} 保持停止；请先处理上述进程" >&2
      exit 1
    fi
    systemctl reset-failed "$TARGET" 2>/dev/null || true
    free -h
    if ! systemctl start "$TARGET"; then
      echo "systemctl start $TARGET 失败" >&2
      if ! drain_model "$TARGET"; then
        echo "进程未清空，禁止自动恢复以免端口/内存冲突" >&2
        exit 1
      fi
      restore_previous || true
      exit 1
    fi
    if ! wait_health "$TARGET" "$LIMIT"; then
      echo "$TARGET 健康检查失败，自动恢复 ${previous:-无}" >&2
      journalctl -u "$TARGET" -n 30 --no-pager >&2 || true
      if ! drain_model "$TARGET"; then
        echo "进程未清空，禁止自动恢复以免端口/内存冲突" >&2
        exit 1
      fi
      restore_previous || true
      exit 1
    fi
    echo "切换成功：$TARGET /health OK"
    show_status
    ;;
  *)
    echo "用法：bash model-switch.sh status|flash|next" >&2
    exit 2
    ;;
esac
