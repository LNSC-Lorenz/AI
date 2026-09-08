#!/bin/bash
# ════════════════════════════════════════════════════════════
#  服务器端扫描：扫描挂载的共享盘，生成 media.json 到 APP_DIR 部署目录
#  脚本本身可以放在任意位置（如 /home/sysadmin/）
#  用法: sudo bash 2_scan.sh
#  首次运行会自动把自己注册到 root crontab（每 30 分钟），无需手动设置定时
# ════════════════════════════════════════════════════════════

SRC='/var/www/lnsc-apps/libq'
APP_DIR='/var/www/lnsc-apps/apps/libq'   # 固定部署目录，前端上传应用名固定为 LibQ（ID 自动转小写 libq）
OUT="$APP_DIR/media.json"

# ── 自动注册 cron（每 30 分钟），已存在则跳过 ──
SELF="$(readlink -f "$0")"
if [ "$EUID" -eq 0 ] && ! crontab -l 2>/dev/null | grep -qF "$SELF"; then
  (crontab -l 2>/dev/null; echo "*/30 * * * * /bin/bash $SELF") | crontab -
  echo "已注册 cron: */30 * * * * /bin/bash $SELF"
fi

if [ ! -d "$SRC" ] || ! mountpoint -q "$SRC"; then
  echo "ERROR: $SRC 未挂载，请先运行 1_mount-libq.sh" >&2
  exit 1
fi

# 部署目录不存在则预创建（前端上传应用名 LibQ 时会写入同一目录）
if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  echo "部署目录 $APP_DIR 不存在，已预创建（等待前端上传应用 LibQ）"
fi
# 属主跟随 apps 父目录，确保 Node 上传进程有写权限（root 创建会导致前端上传 500）
PARENT_OWNER="$(stat -c '%U:%G' "$(dirname "$APP_DIR")")"
chown "$PARENT_OWNER" "$APP_DIR"
chmod 775 "$APP_DIR"

find "$SRC" -type f \( \
    -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.gif' \
    -o -iname '*.bmp' -o -iname '*.webp' -o -iname '*.svg' \
    -o -iname '*.mp4' -o -iname '*.avi' -o -iname '*.mov' \
    -o -iname '*.wmv' -o -iname '*.mkv' -o -iname '*.webm' \
    -o -iname '*.pdf' \
    -o -iname '*.docx' -o -iname '*.xlsx' -o -iname '*.doc' -o -iname '*.xls' \) \
    ! -iname '~$*' \
    -printf '%P\t%TY-%Tm-%Td\t%s\n' 2>/dev/null | \
SRC="$SRC" python3 -c '
import sys, json, os
items = []
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) != 3:
        continue
    rel, date, size = parts
    items.append({
        "name": os.path.basename(rel),
        "path": os.path.dirname(rel),
        "date": date,
        "size": int(size)
    })
items.sort(key=lambda x: (x["path"], x["name"]))
print(json.dumps(items, ensure_ascii=False, separators=(",", ":")))
' > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

chmod 644 "$OUT"
COUNT=$(python3 -c "import json; print(len(json.load(open('$OUT'))))")
echo "Done. $COUNT files indexed -> $OUT"
