#!/usr/bin/env bash
# =============================================================
# Ubuntu 24.04 LTS 系统优化脚本
# 职责：系统优化（内核/防火墙/工具/Swap等）
# 前置：autoinstall 已完成（硬件配置/用户/SSH 已由 autoinstall 处理）
# 用法: sudo bash ubuntu-init.sh
# 完成后运行: sudo bash postgresql-install.sh
# =============================================================

set -euo pipefail

# ── 颜色输出 ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[OK]   $*${RESET}"; }
warn() { echo -e "${YELLOW}[WARN] $*${RESET}"; }
info() { echo -e "${CYAN}[INFO] $*${RESET}"; }
fail() { echo -e "${RED}[FAIL] $*${RESET}"; exit 1; }
step() { echo -e "\n${CYAN}══════════════════════════════════════${RESET}"; \
         echo -e "${CYAN}  Step $*${RESET}"; \
         echo -e "${CYAN}══════════════════════════════════════${RESET}"; }

# ── 配置区（按需修改）────────────────────────────────────────
TIMEZONE="Asia/Shanghai"        # 时区
SSH_PORT=22                     # SSH 端口
ENABLE_UFW=true                 # 是否启用防火墙
SWAP_SIZE_GB=8                  # Swap 大小（GB），0 表示不创建
PG_DATA_DIR="/data/postgresql"  # PostgreSQL 数据目录（与 autoinstall 数据盘一致）

# ─────────────────────────────────────────────────────────────

# 必须以 root 运行
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ubuntu 24.04 LTS 系统优化脚本                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "主机名    : $(hostname)"
info "时区      : $TIMEZONE"
info "SSH 端口  : $SSH_PORT"
info "防火墙    : $ENABLE_UFW"
info "Swap      : ${SWAP_SIZE_GB}GB"
info "PG 数据盘 : $PG_DATA_DIR"
echo ""
read -rp "确认以上配置并继续? (y/N): " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "已取消"; exit 0; }

# ── Step 1: 系统更新 ─────────────────────────────────────────
step "1: 系统更新"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y -qq
apt-get autoremove -y -qq
ok "系统更新完成"

# ── Step 2: 安装常用工具 ─────────────────────────────────────
step "2: 安装常用工具"
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git vim nano htop net-tools \
  lsof unzip zip tar gzip \
  ca-certificates gnupg lsb-release \
  build-essential software-properties-common \
  fail2ban logrotate rsync \
  sysstat iotop nload \
  jq tree ncdu \
  chrony
ok "常用工具安装完成"

# ── Step 3: 设置时区和时间同步 ──────────────────────────────
step "3: 设置时区和时间同步"
timedatectl set-timezone "$TIMEZONE"
systemctl enable chrony --now
timedatectl status
ok "时区设置为: $TIMEZONE，NTP 同步已启用"

# ── Step 4: SSH 安全加固（补充 autoinstall 已做的基础配置）────
step "4: SSH 安全加固"
SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

sed -i "s/^#*Port .*/Port $SSH_PORT/" "$SSHD_CONFIG"
sed -i "s/^#*PermitRootLogin .*/PermitRootLogin no/" "$SSHD_CONFIG"
sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication yes/" "$SSHD_CONFIG"
sed -i "s/^#*MaxAuthTries .*/MaxAuthTries 5/" "$SSHD_CONFIG"
sed -i "s/^#*LoginGraceTime .*/LoginGraceTime 30/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveInterval .*/ClientAliveInterval 300/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveCountMax .*/ClientAliveCountMax 2/" "$SSHD_CONFIG"

# 禁用 X11 转发
sed -i "s/^#*X11Forwarding .*/X11Forwarding no/" "$SSHD_CONFIG"

systemctl restart ssh
ok "SSH 配置完成（端口: $SSH_PORT，禁止 root 登录）"
warn "请确认新 SSH 连接可用后再关闭当前会话！"

# ── Step 5: 防火墙配置 ───────────────────────────────────────
step "5: 防火墙配置 (UFW)"
if $ENABLE_UFW; then
  apt-get install -y -qq ufw
  ufw --force reset
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow "$SSH_PORT/tcp"    # SSH
  ufw allow 5432/tcp           # PostgreSQL（如需远程访问）
  ufw --force enable
  ufw status verbose
  ok "UFW 防火墙已启用"
else
  warn "防火墙配置已跳过（ENABLE_UFW=false）"
fi

# ── Step 6: Fail2ban 配置 ────────────────────────────────────
step "6: Fail2ban 暴力破解防护"
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = $SSH_PORT
logpath  = %(sshd_log)s
EOF

systemctl enable fail2ban --now
ok "Fail2ban 已启用（5次失败封禁1小时）"

# ── Step 7: 系统内核参数优化（适合数据库服务器）────────────
step "7: 内核参数优化"
cat > /etc/sysctl.d/99-postgresql.conf <<EOF
# 共享内存（PostgreSQL 使用）
kernel.shmmax = 17179869184
kernel.shmall = 4194304

# 网络优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300

# 文件系统
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.overcommit_memory = 2
vm.overcommit_ratio = 80

# 开启透明大页（PostgreSQL 推荐关闭）
# 在下方 Step 会处理
EOF

sysctl -p /etc/sysctl.d/99-postgresql.conf
ok "内核参数已优化"

# 禁用透明大页（Transparent Huge Pages）
if [ -f /sys/kernel/mm/transparent_hugepage/enabled ]; then
  echo never > /sys/kernel/mm/transparent_hugepage/enabled
  echo never > /sys/kernel/mm/transparent_hugepage/defrag
  # 持久化
  cat >> /etc/rc.local <<'EOF'
echo never > /sys/kernel/mm/transparent_hugepage/enabled
echo never > /sys/kernel/mm/transparent_hugepage/defrag
EOF
  chmod +x /etc/rc.local
  ok "透明大页已禁用（PostgreSQL 性能优化）"
fi

# ── Step 8: 文件描述符限制 ──────────────────────────────────
step "8: 文件描述符限制"
cat >> /etc/security/limits.conf <<EOF

# PostgreSQL 优化
postgres soft nofile 65536
postgres hard nofile 65536
postgres soft nproc  65536
postgres hard nproc  65536
* soft nofile 65536
* hard nofile 65536
EOF

cat > /etc/systemd/system.conf.d/limits.conf <<EOF
[Manager]
DefaultLimitNOFILE=65536
EOF
ok "文件描述符限制已设置为 65536"

# ── Step 9: 创建 Swap ───────────────────────────────────────
step "9: 创建 Swap"
if [[ $SWAP_SIZE_GB -gt 0 ]]; then
  SWAP_FILE="/swapfile"
  if swapon --show | grep -q "$SWAP_FILE"; then
    warn "Swap 已存在，跳过创建"
  else
    fallocate -l "${SWAP_SIZE_GB}G" "$SWAP_FILE"
    chmod 600 "$SWAP_FILE"
    mkswap "$SWAP_FILE"
    swapon "$SWAP_FILE"
    echo "$SWAP_FILE none swap sw 0 0" >> /etc/fstab
    ok "Swap ${SWAP_SIZE_GB}GB 创建完成"
  fi
  swapon --show
else
  warn "跳过 Swap 创建（SWAP_SIZE_GB=0）"
fi

# ── Step 10: 日志轮转配置 ────────────────────────────────────
step "10: 日志轮转配置"
cat > /etc/logrotate.d/postgresql-custom <<EOF
/var/log/postgresql/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    sharedscripts
    postrotate
        systemctl reload postgresql 2>/dev/null || true
    endscript
}
EOF
ok "日志轮转已配置（保留30天）"

# ── Step 11: 禁用不必要服务 ──────────────────────────────────
step "11: 禁用不必要服务"
DISABLE_SERVICES=("snapd" "apport" "whoopsie" "avahi-daemon")
for svc in "${DISABLE_SERVICES[@]}"; do
  if systemctl is-active "$svc" &>/dev/null; then
    systemctl disable --now "$svc" 2>/dev/null || true
    info "已禁用: $svc"
  fi
done
ok "不必要服务已清理"

# ── Step 12: 数据盘权限配置 ──────────────────────────────────
step "12: 数据盘权限配置"
if mountpoint -q /data; then
  mkdir -p "$PG_DATA_DIR"
  chmod 755 /data
  ok "数据盘 /data 已挂载，目录 $PG_DATA_DIR 已创建"
else
  warn "/data 未挂载，请检查 autoinstall 分区配置"
  info "手动挂载: lsblk 查看磁盘，然后 mount /dev/sdb1 /data"
fi

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ubuntu 系统优化完成！                        ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "系统更新"
ok "常用工具"
ok "时区: $TIMEZONE"
ok "SSH 加固（端口: $SSH_PORT）"
$ENABLE_UFW && ok "UFW 防火墙" || warn "防火墙未启用"
ok "Fail2ban"
ok "内核参数优化（PostgreSQL 专用）"
ok "文件描述符: 65536"
ok "Swap: ${SWAP_SIZE_GB}GB"
ok "数据盘: $PG_DATA_DIR"
echo ""
warn "下一步："
echo "  安装 PostgreSQL 18:"
echo "     sudo bash postgresql-install.sh"
echo ""
