#!/bin/bash
# ════════════════════════════════════════════════════════════
#  挂载 Windows 共享盘到 Ubuntu 服务器（测试用）
#  用法: sudo bash mount-libq.sh
#  卸载: sudo umount /mnt/libq
# ════════════════════════════════════════════════════════════

# ── 配置区（按需修改）───────────────────────────────────────
SHARE='//10.86.180.4/department/LNSC-06_QD-Quality/07_Open/001 销售测试沟通'
MOUNT_POINT='/var/www/lnsc-apps/libq'
CRED_FILE='/etc/libq-cred'

# Windows 域账号
DOMAIN='LECHLER'
SMB_USER='rpacn01'
SMB_PASS='@kHRNJqfB61111'

set -e

# ── 检查 root ──
if [ "$EUID" -ne 0 ]; then
  echo "请用 sudo 运行: sudo bash mount-libq.sh"
  exit 1
fi

# ── 安装 cifs-utils ──
if ! command -v mount.cifs >/dev/null 2>&1; then
  echo "[1/4] 安装 cifs-utils ..."
  apt-get install -y cifs-utils
else
  echo "[1/4] cifs-utils 已安装"
fi

# ── 写入凭据文件（每次覆盖，确保最新）──
echo "[2/4] 写入凭据文件 $CRED_FILE"
cat > "$CRED_FILE" <<EOF
username=$SMB_USER
password=$SMB_PASS
domain=$DOMAIN
EOF
chmod 600 "$CRED_FILE"
echo "  已保存（权限 600，仅 root 可读）"

# ── 创建挂载点 ──
echo "[3/4] 创建挂载点 $MOUNT_POINT"
mkdir -p "$MOUNT_POINT"

# ── 挂载 ──
echo "[4/4] 挂载共享盘 ..."
if mountpoint -q "$MOUNT_POINT"; then
  echo "  已挂载，先卸载旧的"
  umount "$MOUNT_POINT"
fi

mount -t cifs "$SHARE" "$MOUNT_POINT" \
  -o credentials="$CRED_FILE",ro,iocharset=utf8,uid=www-data,gid=www-data,vers=3.0

# ── 验证 ──
echo
echo "══════ 挂载成功，文件列表预览 ══════"
ls -la "$MOUNT_POINT" | head -20
echo
echo "文件总数: $(find "$MOUNT_POINT" -type f | wc -l)"
echo
echo "测试 www-data 读取权限:"
sudo -u www-data head -c 10 "$(find "$MOUNT_POINT" -type f | head -1)" >/dev/null 2>&1 \
  && echo "  OK - Nginx 可读取" \
  || echo "  FAILED - Nginx 无法读取，检查 uid/gid 参数"
# ── 写入 fstab 开机自动挂载（已存在则跳过）──
FSTAB_LINE="${SHARE// /\\040} $MOUNT_POINT cifs credentials=$CRED_FILE,ro,iocharset=utf8,uid=www-data,gid=www-data,vers=3.0 0 0"
if grep -qF "$MOUNT_POINT" /etc/fstab; then
  echo "fstab 已有 $MOUNT_POINT 条目，跳过"
else
  echo "$FSTAB_LINE" >> /etc/fstab
  echo "已写入 /etc/fstab，重启自动挂载"
fi
echo
echo "══════ 挂载配置全部完成 ══════"
