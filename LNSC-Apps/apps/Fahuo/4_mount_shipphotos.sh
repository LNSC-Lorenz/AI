#!/bin/bash
# ════════════════════════════════════════════════════════════
#  挂载 Windows 共享盘（发货照片）到 Fahuo 应用目录内
#  图片经 nginx 静态直出：/apps/fahuo/ShippingPhotos/<年>/<月>/<日>/<DN>_n.jpg
#  用法: sudo bash 4_mount_shipphotos.sh
#  卸载: sudo umount /var/www/lnsc-apps/apps/fahuo/ShippingPhotos
# ════════════════════════════════════════════════════════════

# ── 配置区（按需修改）───────────────────────────────────────
SHARE='//10.86.180.24/VideoandPhoto/LNSC-05/01_ShippingPhotos_Send'
MOUNT_POINT='/var/www/lnsc-apps/apps/fahuo/ShippingPhotos'   # 应用目录内：免改 nginx（参照 LibQ 1_mount-libq.sh 模式）
CRED_FILE='/etc/shipphotos-cred'

# Windows 域账号（与 LibQ 同账号）
DOMAIN='LECHLER'
SMB_USER='rpacn01'
SMB_PASS='@kHRNJqfB61111'

set -e

# ── 检查 root ──
if [ "$EUID" -ne 0 ]; then
  echo "请用 sudo 运行: sudo bash 4_mount_shipphotos.sh"
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
echo "══════ 挂载成功，目录预览 ══════"
ls -la "$MOUNT_POINT" | head -12
echo
echo "图片总数: $(find "$MOUNT_POINT" -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \) | wc -l)"
echo
echo "测试 www-data 读取权限:"
sudo -u www-data head -c 10 "$(find "$MOUNT_POINT" -type f -iname '*.jpg' | head -1)" >/dev/null 2>&1 \
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
echo "下一步：sudo bash 5_scan_shipphotos.sh 生成照片索引 shipphotos.json"
