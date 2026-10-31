#!/usr/bin/env bash
# LNSC-DGX · 下载 Qwen3-Next-80B-A3B-Instruct UD-Q4_K_XL（可续传，不触碰运行中服务）
set -euo pipefail

REPO="${REPO:-unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF}"
FILE="Qwen3-Next-80B-A3B-Instruct-UD-Q4_K_XL.gguf"
EXPECTED_SIZE=46067137312
EXPECTED_SHA256=49e554f954afbfc9f627b8be236adf16c1e51d8e5ecaa0e65ac8ede4e2c41a56
DEST_DIR="${DEST_DIR:-/models/qwen3-next-80b-a3b-instruct/UD-Q4_K_XL}"
DEST="$DEST_DIR/$FILE"
PART="$DEST.part"
URL="https://modelscope.cn/models/$REPO/resolve/master/$FILE"
LOCK="/tmp/lnsc-next80-download.lock"

mkdir -p "$DEST_DIR"
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "另一个下载进程正在运行：$LOCK" >&2
  exit 2
fi

size_of() { [[ -f "$1" ]] && stat -c %s "$1" || echo 0; }
complete() {
  [[ "$(size_of "$1")" == "$EXPECTED_SIZE" ]] \
    && [[ "$(head -c 4 "$1" 2>/dev/null)" == "GGUF" ]]
}
verify_sha() {
  local actual
  actual=$(sha256sum "$1" | awk '{print $1}')
  if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
    echo "SHA256 不匹配：actual=$actual expected=$EXPECTED_SHA256" >&2
    return 1
  fi
  printf '%s  %s\n' "$actual" "$1" | tee "$1.sha256"
}

if complete "$DEST"; then
  echo "已存在且大小/magic 正确：$DEST"
  if [[ ! -f "$DEST.sha256" ]]; then verify_sha "$DEST"; fi
  exit 0
fi

if (( $(size_of "$PART") > EXPECTED_SIZE )); then
  mv "$PART" "$PART.oversize.$(date +%s)"
  echo "发现超大 .part，已保留为 .oversize.* 后重新下载"
fi

if command -v aria2c >/dev/null 2>&1; then
  echo "$(date --iso-8601=seconds) 使用 aria2c：8 连接，从 $(size_of "$PART") 字节续传"
  # .part.aria2 控制文件让进程/机器重启后仍可正确恢复；禁用自动改名，防止产生第二份权重。
  aria2c --continue=true --max-connection-per-server=8 --split=8 \
    --min-split-size=16M --file-allocation=none \
    --auto-file-renaming=false --allow-overwrite=false \
    --max-tries=0 --retry-wait=5 --connect-timeout=20 --timeout=60 \
    --summary-interval=60 --console-log-level=warn --download-result=full \
    --dir="$DEST_DIR" --out="$(basename "$PART")" "$URL"
  if complete "$PART"; then
    mv "$PART" "$DEST"
    verify_sha "$DEST"
    printf 'DONE %s bytes=%d\n' "$DEST" "$(size_of "$DEST")"
    exit 0
  fi
  echo "aria2c 已退出但文件未完整；再次运行本脚本会按 .aria2 控制文件恢复" >&2
  exit 1
fi

for attempt in $(seq 1 60); do
  have=$(size_of "$PART")
  printf '%s attempt=%d downloaded=%d/%d (%.1f%%)\n' \
    "$(date --iso-8601=seconds)" "$attempt" "$have" "$EXPECTED_SIZE" \
    "$(awk -v a="$have" -v b="$EXPECTED_SIZE" 'BEGIN{print 100*a/b}')"

  # 禁用 curl 内部 retry：它可能从 0 重写 PART；失败只由外层循环按已落盘大小 -C - 续传。
  resume=()
  (( have > 0 )) && resume=(-C -)
  if curl -L --fail --silent --show-error \
      --connect-timeout 20 --max-time 1800 \
      --speed-limit 10240 --speed-time 120 \
      "${resume[@]}" -o "$PART" "$URL"; then
    if complete "$PART"; then break; fi
  fi
  sleep 5
done

if ! complete "$PART"; then
  echo "下载未完成：$(size_of "$PART")/$EXPECTED_SIZE；再次运行本脚本可续传" >&2
  exit 1
fi

mv "$PART" "$DEST"
verify_sha "$DEST"
printf 'DONE %s bytes=%d\n' "$DEST" "$(size_of "$DEST")"
