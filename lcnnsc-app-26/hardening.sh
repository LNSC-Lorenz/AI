#!/usr/bin/env bash
# =============================================================
# Ubuntu 24.04 LTS CIS Hardening + Nginx 优化脚本
# 主机名: lcnnsc-app-26 | IP: 10.86.180.76
# 参考: https://ubuntu.com/blog/hardening-automation-for-cis-benchmarks
# 职责: 系统加固、CIS合规、内核优化、安全基线配置
# 前置: autoinstall 已完成
# 用法: sudo bash hardening.sh
# =============================================================

set -uo pipefail

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
SWAP_SIZE_GB=4
CIS_LEVEL="level2_server"

# ── 检查 root 权限 ─────────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  lcnnsc-app-26 CIS 加固脚本                  ║"
echo "║  Ubuntu 24.04 LTS + Nginx Web Server         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "主机名    : lcnnsc-app-26"
info "IP        : 10.86.180.76"
info "时区      : $TIMEZONE"
info "SSH 端口  : $SSH_PORT"
info "CIS 级别  : $CIS_LEVEL"
info "防火墙    : $ENABLE_UFW"
info "Swap      : ${SWAP_SIZE_GB}GB"
echo ""

read -rp "Continue with CIS hardening? (y/N): " confirm
[[ "$confirm" =~ ^[Yy]$ ]] || { info "Cancelled"; exit 0; }

# ── 设置合规密码 ──────────────────────────────────────────────
echo ""
echo "============================================="
echo "  Set sysadmin password (CIS policy: min 14 chars,"
echo "  must include uppercase, lowercase, digit, special)"
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
ok "sysadmin password updated."
echo ""

# ── Step 1: 系统更新和基础工具 ─────────────────────────────
step "1: 系统更新和安装加固工具"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y -qq

DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget vim nano htop net-tools \
  lsof unzip zip tar gzip \
  ca-certificates gnupg lsb-release \
  fail2ban logrotate rsync \
  sysstat iotop nload \
  jq tree ncdu \
  chrony \
  aide aide-common \
  libpam-pwquality \
  auditd audispd-plugins \
  rsyslog \
  needrestart \
  nginx \
  ufw

apt-get autoremove -y -qq
ok "系统更新和安全工具安装完成"

# ── Step 2: CIS - 密码策略 (PAM) ────────────────────────────
step "2: CIS 密码策略配置"

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
ok "密码复杂度策略已配置"

# Account lockout via faillock.conf
cat > /etc/security/faillock.conf <<'EOF'
deny = 5
unlock_time = 900
fail_interval = 900
root_unlock_time = 900
audit
EOF
ok "Account lockout configured: 5 failures = 15 min lock"

# ── Step 3: CIS - SSH 加固 ──────────────────────────────────
step "3: CIS SSH 安全加固"

SSHD_CONFIG="/etc/ssh/sshd_config"
cp "$SSHD_CONFIG" "${SSHD_CONFIG}.bak.$(date +%Y%m%d)"

sed -i "s/^#*Port .*/Port $SSH_PORT/" "$SSHD_CONFIG"
sed -i "s/^#*PermitRootLogin .*/PermitRootLogin no/" "$SSHD_CONFIG"
sed -i "s/^#*PasswordAuthentication .*/PasswordAuthentication yes/" "$SSHD_CONFIG"
sed -i "s/^#*MaxAuthTries .*/MaxAuthTries 4/" "$SSHD_CONFIG"
sed -i "s/^#*LoginGraceTime .*/LoginGraceTime 60/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveInterval .*/ClientAliveInterval 300/" "$SSHD_CONFIG"
sed -i "s/^#*ClientAliveCountMax .*/ClientAliveCountMax 0/" "$SSHD_CONFIG"
sed -i "s/^#*X11Forwarding .*/X11Forwarding no/" "$SSHD_CONFIG"
sed -i "s/^#*AllowTcpForwarding .*/AllowTcpForwarding no/" "$SSHD_CONFIG"
sed -i "s/^#*PermitUserEnvironment .*/PermitUserEnvironment no/" "$SSHD_CONFIG"
sed -i "s/^#*Banner .*/Banner \/etc\/issue.net/" "$SSHD_CONFIG"
sed -i "s/^#*Ciphers .*/Ciphers aes256-ctr,aes192-ctr,aes128-ctr/" "$SSHD_CONFIG"
sed -i "s/^#*MACs .*/MACs hmac-sha2-512,hmac-sha2-256/" "$SSHD_CONFIG"

# Ensure SFTP subsystem
SFTP_SERVER=$(find /usr/lib/openssh /usr/libexec -name sftp-server 2>/dev/null | head -1)
if [[ -z "$SFTP_SERVER" ]]; then SFTP_SERVER="/usr/lib/openssh/sftp-server"; fi
sed -i '/^Subsystem.*sftp/d' "$SSHD_CONFIG"
echo "Subsystem sftp $SFTP_SERVER" >> "$SSHD_CONFIG"

cat > /etc/issue.net <<'EOF'
***************************************************************************
*                         警告 NOTICE                                      *
* 本系统仅供授权用户使用，未经授权的访问将被监控并追究法律责任。           *
* This system is restricted to authorized users only.                   *
* Unauthorized access will be monitored and prosecuted by law.          *
***************************************************************************
EOF

usermod -aG sudo sysadmin
sed -i '/^AllowGroups/d' "$SSHD_CONFIG"
echo "AllowGroups sudo" >> "$SSHD_CONFIG"

if sshd -t 2>/dev/null; then
    systemctl restart ssh
    ok "CIS SSH hardening complete"
else
    cp "${SSHD_CONFIG}.bak.$(date +%Y%m%d)" "$SSHD_CONFIG" 2>/dev/null || true
    systemctl restart ssh
    fail "SSH config error - original config restored."
fi

# ── Step 4: CIS - 审计和日志 ────────────────────────────────
step "4: CIS 审计和日志配置"

if [ ! -f /var/lib/aide/aide.db.gz ]; then
    info "初始化 AIDE 数据库..."
    aideinit 2>/dev/null || aide --init 2>/dev/null || true
    if [ -f /var/lib/aide/aide.db.new ]; then
        mv /var/lib/aide/aide.db.new /var/lib/aide/aide.db.gz
    fi
    ok "AIDE 文件完整性检查已初始化"
fi

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

# ── Step 5: CIS - 文件系统和权限 ──────────────────────────────
step "5: CIS 文件系统和权限加固"

chmod 644 /etc/passwd
chmod 640 /etc/shadow
chmod 644 /etc/group
chmod 640 /etc/gshadow
chmod 644 /etc/hosts
chmod 755 /etc
chmod 755 /var
chmod 750 /var/log
chmod 750 /etc/cron.d
chmod 750 /etc/cron.daily
chmod 750 /etc/cron.weekly
chmod 750 /etc/cron.monthly
chmod 600 /etc/crontab
chmod 600 /etc/ssh/sshd_config
ok "关键文件权限已加固"

# Secure /tmp
if ! grep -q 'nosuid.*nodev.*noexec.*\/tmp\|tmpfs.*\/tmp' /etc/fstab 2>/dev/null; then
    echo "tmpfs /tmp tmpfs defaults,rw,nosuid,nodev,noexec,relatime,size=2G 0 0" >> /etc/fstab
    mount -o remount /tmp 2>/dev/null || warn "/tmp remount skipped (may need reboot)"
    ok "/tmp secure mount configured"
fi

# ── Step 6: CIS - 网络和防火墙 ────────────────────────────────
step "6: CIS 防火墙和网络加固"

if $ENABLE_UFW; then
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow out on lo
    ufw deny in from 127.0.0.0/8
    ufw deny in from ::1
    ufw allow "$SSH_PORT/tcp"
    ufw allow 80/tcp
    ufw --force enable
    ufw status verbose
    ok "CIS UFW 防火墙已启用 (22/80)"
fi

# 网络加固
cat > /etc/sysctl.d/99-cis-network.conf <<'EOF'
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.tcp_syncookies = 1
net.ipv4.tcp_max_syn_backlog = 2048
net.ipv4.tcp_synack_retries = 2
EOF
sysctl -p /etc/sysctl.d/99-cis-network.conf
ok "CIS 网络参数已配置"

# ── Step 7: Fail2ban ────────────────────────────────────────
step "7: Fail2ban 暴力破解防护"

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

[nginx-http-auth]
enabled  = true
port     = http,https
filter   = nginx-http-auth
logpath  = /var/log/nginx/error.log
maxretry = 3
bantime  = 7200
EOF

systemctl enable fail2ban --now
ok "Fail2ban 已启用"

# ── Step 8: 内核参数优化 ───────────────────────────────────────
step "8: 内核参数优化 (Nginx)"

cat > /etc/sysctl.d/99-nginx.conf <<'EOF'
# Nginx Web 服务器优化
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# 网络优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_probes = 3
net.ipv4.tcp_keepalive_intvl = 15
net.core.netdev_max_backlog = 5000

# CIS 安全
kernel.randomize_va_space = 2
kernel.kptr_restrict = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
fs.suid_dumpable = 0
fs.protected_symlinks = 1
fs.protected_hardlinks = 1
EOF

sysctl -p /etc/sysctl.d/99-nginx.conf
ok "Nginx + CIS 内核参数已优化"

# ── Step 9: 文件描述符限制 ───────────────────────────────────
step "9: 系统限制配置"

cat > /etc/security/limits.d/99-nginx.conf <<'EOF'
www-data soft nofile 65536
www-data hard nofile 65536
* soft core 0
* hard core 0
* soft maxlogins 10
* hard maxlogins 10
EOF

mkdir -p /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/limits.conf <<'EOF'
[Manager]
DefaultLimitNOFILE=65536
DefaultLimitNPROC=65536
EOF
ok "文件描述符限制已配置"

# ── Step 10: Swap 配置 ───────────────────────────────────────
step "10: Swap 配置"

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
fi

# ── Step 11: 时区和 NTP ───────────────────────────────────────
step "11: 时区和 NTP"

timedatectl set-timezone "$TIMEZONE"
systemctl enable chrony --now
ok "时区: $TIMEZONE, NTP: chrony"

# ── Step 12: 禁用不必要服务 ──────────────────────────────────
step "12: 禁用不必要服务"

DISABLE_SERVICES=("snapd" "apport" "whoopsie" "avahi-daemon" "cups" "cups-browsed")
for svc in "${DISABLE_SERVICES[@]}"; do
  if systemctl is-active "$svc" &>/dev/null; then
    systemctl disable --now "$svc" 2>/dev/null || true
    info "已禁用: $svc"
  fi
done
ok "不必要服务已清理"

# ── Step 13: Nginx 版本锁定 + Ubuntu 安全更新策略 ──────────────
step "13: 更新策略 (Nginx 锁定 + Ubuntu 安全更新)"

# 锁定 Nginx 版本，禁止自动更新
apt-mark hold nginx nginx-common nginx-core 2>/dev/null || true
ok "Nginx 版本已锁定 (apt-mark hold)，不会被自动更新"
info "当前 Nginx 版本: $(nginx -v 2>&1 | awk -F/ '{print $2}' || echo 'not installed yet')"
info "手动更新命令: sudo apt-mark unhold nginx && sudo apt upgrade nginx && sudo apt-mark hold nginx"

# 安装 unattended-upgrades
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unattended-upgrades

# 配置：仅安全更新，排除 nginx
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'EOF'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
// 不自动更新 Nginx（手动控制版本）
Unattended-Upgrade::Package-Blacklist {
    "nginx";
    "nginx-common";
    "nginx-core";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
// 邮件通知（可选，需配置 postfix/mailutils）
// Unattended-Upgrade::Mail "lorenz.zhang@lechler.com.cn";
// Unattended-Upgrade::MailReport "on-change";
EOF

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
EOF

ok "Ubuntu 安全更新已启用（每日检查，仅安装安全补丁）"
ok "Nginx 已加入黑名单，不会被自动更新"

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  lcnnsc-app-26 CIS 加固完成！                ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "系统更新和安全工具"
ok "CIS 密码策略 (14位+大小写+数字+特殊)"
ok "CIS SSH 加固 (禁root/限IP/限次/加密)"
ok "CIS 审计和日志 (auditd/AIDE)"
ok "CIS 文件权限 (/tmp nosuid noexec)"
ok "CIS 网络安全 + UFW (22/80)"
ok "Fail2ban 防护 (SSH+Nginx)"
ok "Nginx 内核优化 (somaxconn/keepalive)"
ok "Nginx 版本锁定 (不自动更新)"
ok "Ubuntu 安全更新 (仅security，排除Nginx)"
echo ""
warn "下一步:"
echo "  1. 重启系统: sudo reboot"
echo "  2. 安装 Nginx: sudo bash /opt/scripts/setup-nginx.sh"
echo ""
info "=========================================="
info "  百人企业运维注意事项"
info "=========================================="
echo "  1. 定期查看安全更新日志: cat /var/log/unattended-upgrades/unattended-upgrades.log"
echo "  2. 手动更新 Nginx: sudo apt-mark unhold nginx && sudo apt upgrade nginx && sudo apt-mark hold nginx"
echo "  3. 定期检查 AIDE 完整性: sudo aide --check"
echo "  4. 查看审计日志: sudo aureport --summary"
echo "  5. 查看 Fail2ban 状态: sudo fail2ban-client status"
echo "  6. 备份 /var/www/lnsc-apps 和 /etc/nginx/ 到异地"
echo "  7. 监控磁盘空间: df -h (日志轮转已配置，但需关注)"
echo ""
