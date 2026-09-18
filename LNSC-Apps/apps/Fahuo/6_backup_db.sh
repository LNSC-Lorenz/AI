#!/bin/bash
# ════════════════════════════════════════════════════════════
#  每日备份 fahuo.db（sqlite 在线备份 API，WAL 模式下也一致）
#  → backup/fahuo-YYYYMMDD-HHMM.db，保留最近 14 份
#  用法: sudo bash 6_backup_db.sh
#  首次运行自动注册到 root crontab（每日 06:30），无需手动设置定时
#  背景：2026-09-16 复盘——orders 表 474 条历史记录被清且无备份可恢复
# ════════════════════════════════════════════════════════════
APP_DIR='/var/www/lnsc-apps/apps/fahuo'
BAK_DIR="$APP_DIR/backup"
KEEP=14

# ── 自动注册 cron（每日 06:30，清单开工前），已存在则跳过 ──
SELF="$(readlink -f "$0")"
if [ "$EUID" -eq 0 ] && ! crontab -l 2>/dev/null | grep -qF "$SELF"; then
  (crontab -l 2>/dev/null; echo "30 6 * * * /bin/bash $SELF") | crontab -
  echo "已注册 cron: 30 6 * * * /bin/bash $SELF"
fi

mkdir -p "$BAK_DIR"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$BAK_DIR/fahuo-$STAMP.db"

APP_DIR="$APP_DIR" OUT="$OUT" python3 - <<'PY'
import os, sqlite3
src = sqlite3.connect(os.path.join(os.environ["APP_DIR"], "fahuo.db"))
dst = sqlite3.connect(os.environ["OUT"])
src.backup(dst)          # sqlite 在线备份：WAL 模式下也拿到一致快照
dst.close(); src.close()
n = sqlite3.connect(os.environ["OUT"]).execute("SELECT COUNT(*) FROM orders").fetchone()[0]
print(f"backup ok: {os.environ['OUT']} (orders={n})")
PY

# ── 只保留最近 KEEP 份 ──
ls -1t "$BAK_DIR"/fahuo-*.db 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "保留最近 $KEEP 份："
ls -1t "$BAK_DIR"/fahuo-*.db 2>/dev/null | head -5
