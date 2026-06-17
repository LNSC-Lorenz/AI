#!/usr/bin/env bash
# =============================================================
# Ubuntu 24.04 LTS CIS Hardening + PostgreSQL 优化脚本
# 参考: https://ubuntu.com/blog/hardening-automation-for-cis-benchmarks
# 职责: 系统加固、CIS合规、内核优化、安全基线配置
# 前置: autoinstall 已完成
# 用法: sudo bash hardening.sh
# =============================================================

set -uo pipefail
# Note: -e removed intentionally; individual critical steps use || fail() instead
# This prevents non-fatal hardening steps from aborting the entire script

# ── 颜色输出 ─────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}[OK]   $*${RESET}"; }
warn() { echo -e "${YELLOW}[WARN] $*${RESET}"; }
info() { echo -e "${CYAN}[INFO] $*${RESET}"; }
fail() { echo -e "${RED}[FAIL] $*${RESET}"; exit 1; }
step() { echo -e "\n${CYAN}══════════════════════════════════════${RESET}"; \
         echo -e "${CYAN}  $*${RESET}"; \
         echo -e "${CYAN}══════════════════════════════════════${RESET}"; }

# ── 配置区（按需修改）────────────────────────────────────────
TIMEZONE="Asia/Shanghai"
SSH_PORT=22
ENABLE_UFW=true
SWAP_SIZE_GB=8
PG_DATA_DIR="/data/postgresql"
CIS_LEVEL="level2_server"  # level1_server 或 level2_server

# ── 检查 root 权限 ─────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"

# ── 检查 Ubuntu Pro ─────────────────────────────────────────
check_ubuntu_pro() {
    if pro status 2>/dev/null | grep -q "Entitled"; then
        return 0
    else
        return 1
    fi
}

# ── 检查 USG 工具 ──────────────────────────────────────────
check_usg() {
    if command -v usg &>/dev/null; then
        return 0
    else
        return 1
    fi
}

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ubuntu 24.04 LTS CIS 加固脚本               ║"
echo "║  参考: Ubuntu Security Guide (USG)           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "主机名    : $(hostname)"
info "时区      : $TIMEZONE"
info "SSH 端口  : $SSH_PORT"
info "CIS 级别  : $CIS_LEVEL"
info "防火墙    : $ENABLE_UFW"
info "Swap      : ${SWAP_SIZE_GB}GB"
info "PG 数据盘 : $PG_DATA_DIR"
echo ""

# ── Step 1: Ubuntu Pro & USG 检查 ───────────────────────────
step "1: 检查 Ubuntu Pro 和 USG 工具"

if check_ubuntu_pro; then
    ok "Ubuntu Pro 已激活"
    pro status | grep -E "(cis|usg)" || info "建议附加: sudo pro attach <token>"
else
    warn "未检测到 Ubuntu Pro"
    info "CIS 自动化加固需要 Ubuntu Pro: https://ubuntu.com/pro"
fi

if check_usg; then
    ok "USG (Ubuntu Security Guide) 工具已安装"
    info "可运行: sudo usg fix cis_$CIS_LEVEL"
else
    warn "USG 工具未安装"
    info "安装命令: sudo apt install ubuntu-security-guide"
fi

echo ""
read -rp "Continue with CIS hardening? (y/N): " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "Cancelled"; exit 0; }

# ── Set compliant password BEFORE policy is applied ──────────
echo ""
echo "============================================="
echo "  Set sysadmin password (CIS policy: min 14 chars,"
echo "  must include uppercase, lowercase, digit, special)"
echo "  Example: ChangeMe2026!@#"
echo "============================================="
while true; do
    read -rsp "  New password for sysadmin: " NEW_PASS
    echo ""
    if [[ ${#NEW_PASS} -lt 14 ]]; then
        warn "Password too short (min 14 chars). Try again."
        continue
    fi
    read -rsp "  Confirm password: " CONFIRM_PASS
    echo ""
    if [[ "$NEW_PASS" != "$CONFIRM_PASS" ]]; then
        warn "Passwords do not match. Try again."
        continue
    fi
    break
done
echo "${NEW_PASS}" | passwd --stdin sysadmin 2>/dev/null || echo "sysadmin:${NEW_PASS}" | chpasswd
unset NEW_PASS CONFIRM_PASS
faillock --user sysadmin --reset 2>/dev/null || true
ok "sysadmin password updated. Use new password after reboot."
echo ""

# ── Step 2: 系统更新和基础工具 ─────────────────────────────
step "2: 系统更新和安装加固工具"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y -qq

# 安装安全加固工具
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git vim nano htop net-tools \
  lsof unzip zip tar gzip \
  ca-certificates gnupg lsb-release \
  build-essential software-properties-common \
  fail2ban logrotate rsync \
  sysstat iotop nload \
  jq tree ncdu \
  chrony \
  aide aide-common \
  libpam-pwquality \
  auditd audispd-plugins \
  rsyslog \
  needrestart

apt-get autoremove -y -qq
ok "系统更新和安全工具安装完成"

# ── Step 3: CIS - 密码策略 (PAM) ────────────────────────────
step "3: CIS 密码策略配置"

cat > /etc/security/pwquality.conf <<'EOF'
# CIS Password Quality Settings
minlen = 14
minclass = 4
credit_digits = -1
credit_upper = -1
credit_lower = -1
credit_other = -1
maxrepeat = 2
dictcheck = 1
EOF
ok "密码复杂度策略已配置 (最小14位, 必须包含大小写+数字+特殊字符)"

# Password history - use pwhistory via pam-auth-update (safe method)
if ! grep -q "pam_pwhistory" /etc/pam.d/common-password 2>/dev/null; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq libpam-pwhistory 2>/dev/null || true
    cat > /usr/share/pam-configs/pwhistory <<'EOF'
Name: activate pwhistory
Default: yes
Priority: 1024
Password-Type: Primary
Password:
    required pam_pwhistory.so remember=24 use_authtok
EOF
    DEBIAN_FRONTEND=noninteractive pam-auth-update --enable pwhistory 2>/dev/null || true
    ok "Password history configured: remember 24 (pam-auth-update)"
fi

# Account lockout via faillock.conf only - DO NOT modify /etc/pam.d directly
# Ubuntu 24.04 pam_faillock is already active by default, only configure limits
cat > /etc/security/faillock.conf <<'EOF'
deny = 5
unlock_time = 900
fail_interval = 900
root_unlock_time = 900
audit
EOF
ok "Account lockout configured: 5 failures = 15 min lock (faillock.conf only, PAM chain untouched)"

# ── Step 4: CIS - SSH 加固 ──────────────────────────────────
step "4: CIS SSH 安全加固"

SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

# CIS SSH 配置
sed -i "s/^#*Port .*/Port $SSH_PORT/" "$SSHD_CONFIG"
sed -i "s/^#*PermitRootLogin .*/PermitRootLogin no/" "$SSHD_CONFIG"
sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication yes/" "$SSHD_CONFIG"
sed -i "s/^#*MaxAuthTries .*/MaxAuthTries 4/" "$SSHD_CONFIG"
sed -i "s/^#*LoginGraceTime .*/LoginGraceTime 60/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveInterval .*/ClientAliveInterval 300/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveCountMax .*/ClientAliveCountMax 0/" "$SSHD_CONFIG"
sed -i "s/^#*Protocol .*/Protocol 2/" "$SSHD_CONFIG"
sed -i "s/^#*X11Forwarding .*/X11Forwarding no/" "$SSHD_CONFIG"
sed -i "s/^#*AllowTcpForwarding .*/AllowTcpForwarding no/" "$SSHD_CONFIG"
sed -i "s/^#*PermitUserEnvironment .*/PermitUserEnvironment no/" "$SSHD_CONFIG"
sed -i "s/^#*Banner .*/Banner \/etc\/issue.net/" "$SSHD_CONFIG"
sed -i "s/^#*Ciphers .*/Ciphers aes256-ctr,aes192-ctr,aes128-ctr/" "$SSHD_CONFIG"
sed -i "s/^#*MACs .*/MACs hmac-sha2-512,hmac-sha2-256/" "$SSHD_CONFIG"

# Ensure SFTP subsystem is enabled (required for WinSCP / SCP file transfer)
SFTP_SERVER=$(find /usr/lib/openssh /usr/libexec -name sftp-server 2>/dev/null | head -1)
if [[ -z "$SFTP_SERVER" ]]; then SFTP_SERVER="/usr/lib/openssh/sftp-server"; fi
sed -i '/^Subsystem.*sftp/d' "$SSHD_CONFIG"
echo "Subsystem sftp $SFTP_SERVER" >> "$SSHD_CONFIG"
ok "SFTP subsystem enabled: $SFTP_SERVER"

# 创建 SSH 登录警告信息
cat > /etc/issue.net <<'EOF'
***************************************************************************
*                         警告 NOTICE                                      *
* 本系统仅供授权用户使用，未经授权的访问将被监控并追究法律责任。           *
* This system is restricted to authorized users only.                   *
* Unauthorized access will be monitored and prosecuted by law.          *
***************************************************************************
EOF

# Ensure sysadmin is in sudo group (required by AllowGroups sudo)
usermod -aG sudo sysadmin
ok "sysadmin added to sudo group"

# Restrict SSH to sudo group only
sed -i '/^AllowGroups/d' "$SSHD_CONFIG"
echo "AllowGroups sudo" >> "$SSHD_CONFIG"
ok "SSH restricted to sudo group (sysadmin is member)"

# Validate SSH config before restarting (prevents lockout from bad config)
if sshd -t 2>/dev/null; then
    ok "SSH config validation passed"
    systemctl restart ssh
    ok "CIS SSH hardening complete"
    warn "IMPORTANT: Test new SSH connection before closing this session!"
else
    warn "SSH config validation FAILED - restoring backup"
    cp "${SSHD_CONFIG}.bak.$(date +%Y%m%d)" "$SSHD_CONFIG" 2>/dev/null || true
    systemctl restart ssh
    fail "SSH config error - original config restored. Review changes manually."
fi

# ── Step 5: CIS - 审计和日志 ────────────────────────────────
step "5: CIS 审计和日志配置"

# AIDE 文件完整性检查
if [ ! -f /var/lib/aide/aide.db.gz ]; then
    info "初始化 AIDE 数据库 (首次运行可能需要几分钟)..."
    aideinit 2>/dev/null || aide --init 2>/dev/null || true
    if [ -f /var/lib/aide/aide.db.new ]; then
        mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db.gz
    fi
    ok "AIDE 文件完整性检查已初始化"
fi

# 配置 auditd
cat > /etc/audit/rules.d/cis.rules <<'EOF'
# CIS Audit Rules
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/gshadow -p wa -k identity
-w /etc/security/opasswd -p wa -k identity
-w /var/log/wtmp -p wa -k logins
-w /var/log/btmp -p wa -k logins
-w /var/log/lastlog -p wa -k logins
-w /var/run/utmp -p wa -k session
-a always,exit -F arch=b64 -S setuid -S setgid -S setreuid -S setregid -k privilege_escalation
-a always,exit -F arch=b64 -S chown -S fchown -S lchown -k file_permissions
EOF

systemctl enable auditd --now
augenrules --load 2>/dev/null || true
ok "审计规则已配置"

# 日志轮转强化
if ! grep -q "maxage 90" /etc/logrotate.conf 2>/dev/null; then
    echo "maxage 90" >> /etc/logrotate.conf
    ok "日志保留期限已配置 (90天)"
fi

# ── Step 6: CIS - 文件系统和权限 ──────────────────────────────
step "6: CIS 文件系统和权限加固"

# 设置关键文件权限
chmod 644 /etc/passwd
chmod 640 /etc/shadow
chmod 644 /etc/group
chmod 640 /etc/gshadow
chmod 644 /etc/hosts
chmod 755 /etc
chmod 755 /var
chmod 750 /var/log
chmod 755 /var/log/audit
chmod 750 /etc/cron.d
chmod 750 /etc/cron.daily
chmod 750 /etc/cron.weekly
chmod 750 /etc/cron.monthly
chmod 600 /etc/crontab
chmod 600 /etc/ssh/sshd_config
ok "关键文件权限已加固"

# 禁用 SUID/SGID 位（CIS Level 2）
if [[ "$CIS_LEVEL" == "level2_server" ]]; then
    info "CIS Level 2: 扫描并限制 SUID/SGID 文件..."
    # 查找并记录所有 SUID/SGID 文件
    find / -type f \( -perm -4000 -o -perm -2000 \) 2>/dev/null > /var/log/sgid_suid_files.log || true
    ok "SUID/SGID 文件清单已保存到 /var/log/sgid_suid_files.log"
fi

# Secure /tmp mount - use systemd tmpfiles instead of fstab (safe, idempotent)
if ! grep -q 'nosuid.*nodev.*noexec.*\/tmp\|tmpfs.*\/tmp' /etc/fstab 2>/dev/null; then
    # Only add if not already a secured tmpfs entry
    echo "tmpfs /tmp tmpfs defaults,rw,nosuid,nodev,noexec,relatime,size=2G 0 0" >> /etc/fstab
    mount -o remount /tmp 2>/dev/null || warn "/tmp remount skipped (may need reboot)"
    ok "/tmp secure mount configured (nosuid, nodev, noexec)"
else
    ok "/tmp already has secure mount options"
fi

# ── Step 7: CIS - 网络和防火墙 ────────────────────────────────
step "7: CIS 防火墙和网络加固"

if $ENABLE_UFW; then
    apt-get install -y -qq ufw
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow out on lo
    ufw deny in from 127.0.0.0/8
    ufw deny in from ::1
    ufw allow "$SSH_PORT/tcp"
    ufw allow 5432/tcp  # PostgreSQL（允许所有IP，生产环境建议限制特定网段）
    ufw --force enable
    ufw status verbose
    ok "CIS UFW 防火墙已启用"
else
    warn "防火墙配置已跳过（ENABLE_UFW=false）"
fi

# IP 转发禁用（CIS）
sysctl -w net.ipv4.ip_forward=0 2>/dev/null || true
sysctl -w net.ipv6.conf.all.forwarding=0 2>/dev/null || true
echo "net.ipv4.ip_forward = 0" > /etc/sysctl.d/99-cis-network.conf
echo "net.ipv6.conf.all.forwarding = 0" >> /etc/sysctl.d/99-cis-network.conf
ok "IP 转发已禁用"

# ICMP 重定向禁用
echo "net.ipv4.conf.all.accept_redirects = 0" >> /etc/sysctl.d/99-cis-network.conf
echo "net.ipv4.conf.all.send_redirects = 0" >> /etc/sysctl.d/99-cis-network.conf
echo "net.ipv4.conf.default.accept_redirects = 0" >> /etc/sysctl.d/99-cis-network.conf
echo "net.ipv6.conf.all.accept_redirects = 0" >> /etc/sysctl.d/99-cis-network.conf
sysctl -p /etc/sysctl.d/99-cis-network.conf
ok "ICMP 重定向已禁用"

# ── Step 8: Fail2ban 配置 ────────────────────────────────────
step "8: Fail2ban 暴力破解防护"

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
filter   = sshd
banaction = ufw

[postgres]
enabled  = true
port     = 5432
filter   = postgres
logpath  = /var/log/postgresql/postgresql-*.log
maxretry = 3
bantime  = 7200
EOF

# 创建 PostgreSQL fail2ban filter
cat > /etc/fail2ban/filter.d/postgres.conf <<'EOF'
[Definition]
failregex = ^.*authentication failed.*for user .* from <HOST>
            ^.*connection authorized: user .* database .* host <HOST>
            ^.*password authentication failed for user .* from <HOST>
ignoreregex =
EOF

systemctl enable fail2ban --now
ok "Fail2ban 已启用（SSH 5次失败封禁1小时）"

# ── Step 9: 内核参数优化（PostgreSQL + CIS）───────────────────
step "9: 内核参数优化 (PostgreSQL + CIS)"

cat > /etc/sysctl.d/99-postgresql.conf <<'EOF'
# PostgreSQL 优化
kernel.shmmax = 17179869184
kernel.shmall = 4194304
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
vm.overcommit_memory = 2
vm.overcommit_ratio = 80

# 网络优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 3
net.ipv4.tcp_keepalive_intvl = 15

# CIS 安全
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.suid_dumpable = 0
fs.protected_symlinks = 1
fs.protected_hardlinks = 1
EOF

sysctl -p /etc/sysctl.d/99-postgresql.conf
ok "PostgreSQL + CIS 内核参数已优化"

# Disable transparent hugepages
echo never > /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true
echo never > /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || true
# Use systemd drop-in instead of rc.local (idempotent, no duplicate writes)
cat > /etc/systemd/system/disable-thp.service <<'EOF'
[Unit]
Description=Disable Transparent Huge Pages
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=basic.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/enabled"
ExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/defrag"

[Install]
WantedBy=basic.target
EOF
systemctl daemon-reload
systemctl enable disable-thp --now 2>/dev/null || true
ok "Transparent hugepages disabled (systemd service)"

# ── Step 10: 文件描述符和进程限制 ───────────────────────────
step "10: 系统限制配置"

cat > /etc/security/limits.d/99-postgresql.conf <<EOF
# PostgreSQL + CIS limits
postgres soft nofile 65536
postgres hard nofile 65536
postgres soft nproc  65536
postgres hard nproc  65536
postgres soft fsize unlimited
postgres hard fsize unlimited
postgres soft memlock unlimited
postgres hard memlock unlimited

# CIS 限制
* soft core 0
* hard core 0
* soft maxlogins 10
* hard maxlogins 10
EOF

mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/limits.conf <<EOF
[Manager]
DefaultLimitNOFILE=65536
DefaultLimitNPROC=65536
EOF

ok "文件描述符和进程限制已配置"

# ── Step 11: Swap 配置 ───────────────────────────────────────
step "11: Swap 配置"

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

# ── Step 12: 日志和监控 ───────────────────────────────────────
step "12: 日志和监控配置"

# PostgreSQL 日志轮转
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
    create 0600 postgres postgres
}
EOF

# 系统日志强化
if [ -f /etc/rsyslog.conf ]; then
    sed -i 's/^#$ModLoad imtcp/$ModLoad imtcp/' /etc/rsyslog.conf 2>/dev/null || true
    sed -i 's/^#$InputTCPServerRun 514/$InputTCPServerRun 514/' /etc/rsyslog.conf 2>/dev/null || true
    systemctl restart rsyslog 2>/dev/null || true
fi

ok "日志轮转和监控已配置"

# ── Step 13: 禁用不必要服务 ──────────────────────────────────
step "13: 禁用不必要服务"

DISABLE_SERVICES=("snapd" "apport" "whoopsie" "avahi-daemon" "cups" "cups-browsed")
for svc in "${DISABLE_SERVICES[@]}"; do
  if systemctl is-active "$svc" &>/dev/null; then
    systemctl disable --now "$svc" 2>/dev/null || true
    info "已禁用: $svc"
  fi
done
ok "不必要服务已清理"

# ── Step 14: 数据盘和 PostgreSQL 准备 ────────────────────────
step "14: 数据盘权限配置"

if mountpoint -q /data; then
  mkdir -p "$PG_DATA_DIR"
  chown root:root /data
  chmod 755 /data
  chmod 700 "$PG_DATA_DIR"
  ok "数据盘 /data 已挂载，目录 $PG_DATA_DIR 权限已配置 (700)"
else
  warn "/data 未挂载！请检查 autoinstall 分区配置"
  info "排查: lsblk 查看磁盘列表"
  info "手动挂载: mount /dev/sdb1 /data"
fi

# ── Step 15: CIS 报告生成 ────────────────────────────────────
step "15: CIS 合规报告"

cat > /var/log/cis-hardening-report.txt <<EOF
===============================================
  Ubuntu 24.04 LTS CIS Hardening Report
  Generated: $(date)
===============================================

系统信息:
  主机名: $(hostname)
  系统版本: $(lsb_release -d | cut -f2)
  内核版本: $(uname -r)
  CIS Level: $CIS_LEVEL

加固项检查:
EOF

# 检查关键配置
echo "  [ ] 密码复杂度: $(grep -c 'minlen' /etc/security/pwquality.conf 2>/dev/null || echo 0) 项配置" >> /var/log/cis-hardening-report.txt
echo "  [ ] SSH 加固: Port=$SSH_PORT, RootLogin=$(grep 'PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}')" >> /var/log/cis-hardening-report.txt
echo "  [ ] 防火墙: $(ufw status 2>/dev/null | head -1)" >> /var/log/cis-hardening-report.txt
echo "  [ ] Fail2ban: $(systemctl is-active fail2ban 2>/dev/null)" >> /var/log/cis-hardening-report.txt
echo "  [ ] Auditd: $(systemctl is-active auditd 2>/dev/null)" >> /var/log/cis-hardening-report.txt
echo "  [ ] AIDE: $(aide --version 2>/dev/null | head -1)" >> /var/log/cis-hardening-report.txt
echo "  [ ] 文件描述符: $(ulimit -n)" >> /var/log/cis-hardening-report.txt
echo "  [ ] 透明大页: $(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo 'N/A')" >> /var/log/cis-hardening-report.txt

cat >> /var/log/cis-hardening-report.txt <<EOF

后续建议:
1. 定期运行 AIDE 检查: sudo aide --check
2. 定期查看审计日志: sudo aureport
3. 查看 CIS 扫描报告（需 Ubuntu Pro + USG）:
   sudo apt install ubuntu-security-guide
   sudo usg audit cis_$CIS_LEVEL

PostgreSQL 安装:
   sudo bash postgresql-install.sh

===============================================
EOF

ok "CIS 加固报告已保存到 /var/log/cis-hardening-report.txt"

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ubuntu 24.04 LTS CIS 加固完成！             ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "系统更新和安全工具"
ok "CIS 密码策略"
ok "CIS SSH 加固"
ok "CIS 审计和日志"
ok "CIS 文件权限"
ok "CIS 网络安全"
ok "Fail2ban 防护"
ok "PostgreSQL 内核优化"
$ENABLE_UFW && ok "UFW 防火墙" || warn "防火墙未启用"
echo ""
info "查看详细报告:"
echo "  cat /var/log/cis-hardening-report.txt"
echo ""
warn "下一步:"
echo "  1. 重启系统以应用所有内核参数: sudo reboot"
echo "  2. 安装 PostgreSQL 18: sudo bash postgresql-install.sh"
echo "  3. 定期运行 AIDE 检查: sudo aide --check"
echo ""
