#!/bin/bash
# ════════════════════════════════════════════════════════════
#  完全卸载 HTML01 在服务器上的所有配置
#  逆向清理 mount-libq.sh 和 scan.sh (cron) 的全部改动：
#    1. 删除 scan.sh 的 crontab 定时任务
#    2. 卸载共享盘挂载 /var/www/lnsc-apps/libq
#    3. 删除 /etc/fstab 中的自动挂载条目
#    4. 删除凭据文件 /etc/libq-cred
#    5. 删除挂载点目录
#    6. （可选）删除应用部署目录
#  用法: sudo bash uninstall.sh
# ════════════════════════════════════════════════════════════

MOUNT_POINT='/var/www/lnsc-apps/libq'
CRED_FILE='/etc/libq-cred'
APP_DIR='/var/www/lnsc-apps/apps/HTML01'   # 按实际部署位置调整

set -e

if [ "$EUID" -ne 0 ]; then
  echo "请用 sudo 运行: sudo bash uninstall.sh"
  exit 1
fi

# ── 1. 删除 cron 定时任务 ──
echo "[1/6] 清理 crontab 中的 scan.sh 任务"
if crontab -l 2>/dev/null | grep -q 'scan\.sh'; then
  crontab -l 2>/dev/null | grep -v 'scan\.sh' | crontab -
  echo "  已删除 scan.sh 定时任务"
else
  echo "  未发现 scan.sh 定时任务，跳过"
fi

# ── 2. 卸载共享盘 ──
echo "[2/6] 卸载共享盘 $MOUNT_POINT"
if mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
  umount "$MOUNT_POINT" || umount -l "$MOUNT_POINT"
  echo "  已卸载"
else
  echo "  未挂载，跳过"
fi

# ── 3. 删除 fstab 自动挂载条目 ──
echo "[3/6] 清理 /etc/fstab"
if grep -q "$MOUNT_POINT" /etc/fstab 2>/dev/null; then
  cp /etc/fstab "/etc/fstab.bak.$(date +%Y%m%d%H%M%S)"
  sed -i "\|$MOUNT_POINT|d" /etc/fstab
  echo "  已删除条目（原文件已备份为 /etc/fstab.bak.*）"
else
  echo "  无相关条目，跳过"
fi

# ── 4. 删除凭据文件 ──
echo "[4/6] 删除凭据文件 $CRED_FILE"
if [ -f "$CRED_FILE" ]; then
  rm -f "$CRED_FILE"
  echo "  已删除"
else
  echo "  不存在，跳过"
fi

# ── 5. 删除挂载点目录 ──
echo "[5/6] 删除挂载点目录 $MOUNT_POINT"
if [ -d "$MOUNT_POINT" ]; then
  rmdir "$MOUNT_POINT" 2>/dev/null && echo "  已删除" \
    || echo "  目录非空（可能仍在挂载），未删除，请手动检查: ls $MOUNT_POINT"
else
  echo "  不存在，跳过"
fi

# ── 6. 删除应用部署目录（需确认）──
echo "[6/6] 应用部署目录 $APP_DIR"
if [ -d "$APP_DIR" ]; then
  read -r -p "  是否删除应用目录（index.html/media.json/scan.sh）？[y/N] " ans
  if [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    rm -rf "$APP_DIR"
    echo "  已删除"
  else
    echo "  保留"
  fi
else
  echo "  不存在，跳过"
fi

echo
echo "══════ 卸载完成 ══════"
echo "注意："
echo "  - cifs-utils 系统包未卸载（可能被其他服务使用），如需卸载: apt-get remove cifs-utils"
echo "  - 共享盘上的原始文件不受任何影响（挂载为只读）"
