#!/bin/bash
# ════════════════════════════════════════════════════════════
#  服务器端扫描：扫描挂载的 QMS 共享盘，生成 catalog.json 到 APP_DIR 部署目录
#  脚本本身可以放在任意位置（如 /home/sysadmin/）
#  用法: sudo bash 2_scan-qms.sh
#  首次运行会自动把自己注册到 root crontab（每周六 02:22），无需手动设置定时
# ════════════════════════════════════════════════════════════

SRC='/var/www/lnsc-apps/qms'
APP_DIR='/var/www/lnsc-apps/apps/qms'   # 固定部署目录，前端上传应用名固定为 QMS（ID 自动转小写 qms）
OUT="$APP_DIR/catalog.json"

# ── 自动注册 cron（每周六 02:22），已存在则跳过 ──
SELF="$(readlink -f "$0")"
if [ "$EUID" -eq 0 ] && ! crontab -l 2>/dev/null | grep -qF "$SELF"; then
  (crontab -l 2>/dev/null; echo "22 2 * * 6 /bin/bash $SELF") | crontab -
  echo "已注册 cron: 22 2 * * 6 /bin/bash $SELF"
fi

if [ ! -d "$SRC" ] || ! mountpoint -q "$SRC"; then
  echo "ERROR: $SRC 未挂载，请先运行 1_mount-qms.sh" >&2
  exit 1
fi

# 部署目录不存在则预创建（前端上传应用名 QMS 时会写入同一目录）
if [ ! -d "$APP_DIR" ]; then
  mkdir -p "$APP_DIR"
  echo "部署目录 $APP_DIR 不存在，已预创建（等待前端上传应用 QMS）"
fi
# 属主跟随 apps 父目录，确保 Node 上传进程有写权限（root 创建会导致前端上传 500）
PARENT_OWNER="$(stat -c '%U:%G' "$(dirname "$APP_DIR")")"
chown "$PARENT_OWNER" "$APP_DIR"
chmod 775 "$APP_DIR"

find "$SRC" -type f \( \
    -iname '*.pdf' \
    -o -iname '*.doc' -o -iname '*.docx' \
    -o -iname '*.xls' -o -iname '*.xlsx' -o -iname '*.xlsm' \) \
    ! -iname '~$*' \
    -printf '%P\n' 2>/dev/null | \
python3 -c '
import sys, json, os, datetime

CAT_BY_FOLDER = {
    "001 质量手册 Quality Manual": "MM",
    "002 程序文件 Procedure": "PR",
    "003 作业指导书 WI": "WI",
    "004 表单 Form": "FM",
    "005 外来文件及清单": "EXT",
}

files = []
for line in sys.stdin:
    rel = line.rstrip("\n")
    if not rel:
        continue
    rel = rel.replace("\\", "/")
    folder = os.path.dirname(rel)
    top = folder.split("/")[0] if folder else ""
    files.append({
        "filename": os.path.basename(rel),
        "folder": folder,
        "cat": CAT_BY_FOLDER.get(top, "")
    })
files.sort(key=lambda x: (x["folder"], x["filename"]))
out = {
    "generated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    "files": files
}
print(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
' > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"

chmod 644 "$OUT"
COUNT=$(python3 -c "import json; print(len(json.load(open('$OUT'))['files']))")
echo "Done. $COUNT files indexed -> $OUT"
