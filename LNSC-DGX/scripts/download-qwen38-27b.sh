#!/usr/bin/env bash
# LNSC-DGX · 下载 Qwen3.8-27B Q6_K_XL + F16 mmproj（aria2 续传 + 上游 SHA256）
set -euo pipefail
REPO="${REPO:-unsloth/Qwen3.8-27B-GGUF}"
DEST_DIR="${DEST_DIR:-/models/qwen3.8-27b}"
LOCK=/tmp/lnsc-qwen38-27b-download.lock
mkdir -p "$DEST_DIR"
exec 9>"$LOCK"
flock -n 9 || { echo "另一个 27B 下载正在运行" >&2; exit 2; }
command -v aria2c >/dev/null || { echo "需要 aria2c" >&2; exit 1; }

fetch() {
  local file="$1" expected_size="$2" expected_sha="$3"
  local dest="$DEST_DIR/$file" part="$DEST_DIR/$file.part"
  local url="https://modelscope.cn/models/$REPO/resolve/master/$file"
  local size actual
  size=$( [[ -f "$dest" ]] && stat -c %s "$dest" || echo 0 )
  if [[ "$size" == "$expected_size" ]] && [[ "$(head -c 4 "$dest" 2>/dev/null)" == GGUF ]]; then
    if [[ -f "$dest.sha256" ]]; then
      echo "已完成：$dest"
      return 0
    fi
  fi
  size=$( [[ -f "$part" ]] && stat -c %s "$part" || echo 0 )
  if (( size > expected_size )); then
    mv "$part" "$part.oversize.$(date +%s)"
  fi
  echo "$(date --iso-8601=seconds) 下载 $file，从 ${size:-0} 字节续传"
  aria2c --continue=true --max-connection-per-server=8 --split=8 \
    --min-split-size=8M --file-allocation=none \
    --auto-file-renaming=false --allow-overwrite=false \
    --max-tries=0 --retry-wait=5 --connect-timeout=20 --timeout=60 \
    --summary-interval=60 --console-log-level=warn --download-result=full \
    --dir="$DEST_DIR" --out="$(basename "$part")" "$url"
  size=$(stat -c %s "$part")
  [[ "$size" == "$expected_size" ]] || { echo "大小不符：$part $size" >&2; return 1; }
  [[ "$(head -c 4 "$part")" == GGUF ]] || { echo "GGUF magic 不符：$part" >&2; return 1; }
  mv "$part" "$dest"
  actual=$(sha256sum "$dest" | awk '{print $1}')
  [[ "$actual" == "$expected_sha" ]] || { echo "SHA256 不符：$actual != $expected_sha" >&2; return 1; }
  printf '%s  %s\n' "$actual" "$dest" | tee "$dest.sha256"
  echo "DONE $dest bytes=$size"
}

fetch Qwen3.8-27B-UD-Q6_K_XL.gguf 25299061664 701d8fa9ed214ab21bfc130cd2a7df19ca89bbef7713e2dfb19f3c63696aa917
fetch mmproj-F16.gguf 927607488 cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e
