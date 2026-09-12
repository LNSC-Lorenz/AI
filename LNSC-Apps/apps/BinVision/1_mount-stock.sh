#!/bin/bash
# ════════════════════════════════════════════════════════════
#  挂载 RPA 数据输出目录（物料移动频次.xlsx）到 Ubuntu 服务器
#  用法: sudo bash 1_mount-stock.sh
#  卸载: sudo umount /var/www/lnsc-apps/binstock
#
#  作用: 把 RPA 数据输出目录（含 物料移动频次.xlsx）挂到 /var/www/lnsc-apps/binstock，
#        供 2_scan-stock.sh 定期读取并生成 stock.json。
#  （与 Purchase search drawing 的 1_mount-drawings.sh 结构完全一致，
#    仅改了共享路径/挂载点/凭据文件名，并额外安装报告解析依赖）
# ════════════════════════════════════════════════════════════

# ── 配置区（按需修改）───────────────────────────────────────
SHARE='//10.86.180.4/Department/LNSC-12_LD-Logistics/05_Mixed/12-M_Muti/99_RPA/01_AutoJob_RPA02_06/06_DataOutput'
MOUNT_POINT='/var/www/lnsc-apps/binstock'
CRED_FILE='/etc/binstock-cred'

# Windows 域账号
DOMAIN='LECHLER'
SMB_USER='rpacn01'
SMB_PASS='@kHRNJqfB61111'

set -e

# ── 检查 root ──
if [ "$EUID" -ne 0 ]; then
  echo "请用 sudo 运行: sudo bash 1_mount-stock.sh"
  exit 1
fi

# ── 安装 cifs-utils ──
if ! command -v mount.cifs >/dev/null 2>&1; then
  echo "[1/5] 安装 cifs-utils ..."
  apt-get install -y cifs-utils
else
  echo "[1/5] cifs-utils 已安装"
fi

# ── 安装报告解析依赖（python3 必备；openpyxl/xlrd 可选，缺失时扫描脚本用内置解析器兜底）──
echo "[2/5] 安装报告解析依赖 python3 / openpyxl / xlrd ..."
if ! command -v python3 >/dev/null 2>&1; then
  apt-get install -y python3
fi
apt-get install -y python3-openpyxl python3-xlrd \
  || echo "  （可选依赖安装失败：.xlsx 会用内置解析器兜底；.xls 支持需要 python3-xlrd）"

# ── 写入凭据文件（每次覆盖，确保最新）──
echo "[3/5] 写入凭据文件 $CRED_FILE"
cat > "$CRED_FILE" <<EOF
username=$SMB_USER
password=$SMB_PASS
domain=$DOMAIN
EOF
chmod 600 "$CRED_FILE"
echo "  已保存（权限 600，仅 root 可读）"

# ── 创建挂载点 ──
echo "[4/5] 创建挂载点 $MOUNT_POINT"
mkdir -p "$MOUNT_POINT"

# ── 挂载 ──
echo "[5/5] 挂载共享盘 ..."
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
echo "报告文件数: $(find "$MOUNT_POINT" -type f \( -iname '*.xls' -o -iname '*.xlsx' -o -iname '*.csv' -o -iname '*.txt' \) | wc -l)"
echo
echo "══════ 挂载配置全部完成 ══════"

# ── 写入 fstab 开机自动挂载（已存在则跳过）──
FSTAB_LINE="${SHARE// /\\040} $MOUNT_POINT cifs credentials=$CRED_FILE,ro,iocharset=utf8,uid=www-data,gid=www-data,vers=3.0 0 0"
if grep -qF "$MOUNT_POINT" /etc/fstab; then
  echo "fstab 已有 $MOUNT_POINT 条目，跳过"
else
  echo "$FSTAB_LINE" >> /etc/fstab
  echo "已写入 /etc/fstab，重启自动挂载"
fi
