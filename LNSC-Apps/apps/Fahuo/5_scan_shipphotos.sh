#!/bin/bash
# ════════════════════════════════════════════════════════════
#  服务器端扫描：扫描挂载的发货照片共享盘（年/月/日递进目录，DN 命名文件），
#  生成按 DN 分组的索引 shipphotos.json 到 Fahuo 部署目录（前端静态读取）
#  用法: sudo bash 5_scan_shipphotos.sh
#  自动维护 root crontab（2026-09-16 用户规则：06:00 起每 188 分钟一次，至 21:00——
#  时刻序列 06:00/09:08/12:16/15:24/18:32；cron 无 188min 循环语法，用显式时刻）
# ════════════════════════════════════════════════════════════
SRC='/var/www/lnsc-apps/apps/fahuo/ShippingPhotos'
APP_DIR='/var/www/lnsc-apps/apps/fahuo'
OUT="$APP_DIR/shipphotos.json"

# ── 自动维护 cron：本脚本相关的行全部重写为最新排期（旧排期自动替换） ──
SELF="$(readlink -f "$0")"
if [ "$EUID" -eq 0 ]; then
  NEW="0 6 * * * /bin/bash $SELF
8 9 * * * /bin/bash $SELF
16 12 * * * /bin/bash $SELF
24 15 * * * /bin/bash $SELF
32 18 * * * /bin/bash $SELF"
  if [ "$(crontab -l 2>/dev/null | grep -F "$SELF")" != "$NEW" ]; then
    { crontab -l 2>/dev/null | grep -vF "$SELF"; echo "$NEW"; } | crontab -
    echo "已更新 cron（06:00 起每 188 分钟至 21:00）: 06:00/09:08/12:16/15:24/18:32"
  fi
fi

if [ ! -d "$SRC" ] || ! mountpoint -q "$SRC"; then
  echo "ERROR: $SRC 未挂载，请先运行 4_mount_shipphotos.sh" >&2
  exit 1
fi

# 只收图片；文件名须以 DN 数字开头（8260034320_1.jpg / 8260034320.jpg 均收）
find "$SRC" -type f \( \
    -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' \
    -o -iname '*.webp' -o -iname '*.bmp' \) \
    ! -iname '~$*' \
    -printf '%P\n' 2>/dev/null | \
python3 -c '
import sys, json, os, re
photos = {}
for line in sys.stdin:
    rel = line.strip()
    if not rel:
        continue
    stem = os.path.splitext(os.path.basename(rel))[0]
    dn = stem.split("_")[0]                       # 8260034320_1 → 8260034320
    if not re.fullmatch(r"\d{6,}", dn):           # 非 DN 数字命名的跳过
        continue
    photos.setdefault(dn, []).append(rel)
for v in photos.values():
    v.sort()
print(json.dumps(photos, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
' > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

chmod 644 "$OUT"
DNS=$(python3 -c "import json; print(len(json.load(open('$OUT'))))")
COUNT=$(python3 -c "import json; print(sum(len(v) for v in json.load(open('$OUT')).values()))")
echo "Done. $DNS DNs, $COUNT photos -> $OUT"
