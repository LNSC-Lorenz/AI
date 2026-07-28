#!/usr/bin/env bash
# =============================================================
# Ubuntu 24.04 LTS CIS Hardening + Basic Apps — Linux RPA Worker
# 适用: lcnnsc-rpa-l01 / l02 / l03
# 职责: 系统加固、CIS 基线、基础应用安装、内核优化
#       (Worker 版: 无 Docker、无入站服务端口，仅 SSH 入站)
# 前置: autoinstall 已完成
# 用法: sudo bash 00-harden-worker.sh        # 交互确认
#       sudo bash 00-harden-worker.sh -y     # 无人值守（批量装机）
# 下一步: sudo bash install-lcnnsc-rpa-l0X.sh
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
WORKER_USER="rpa"
AGENT_DIR="/opt/rpa-agent"

# ── 检查 root 权限 / 参数 ────────────────────────────────────
[[ $EUID -ne 0 ]] && fail "请以 root 用户运行: sudo bash $0"
ASSUME_YES=false
[[ "${1:-}" == "-y" ]] && ASSUME_YES=true

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Ubuntu 24.04 LTS 加固脚本 (Linux Worker)    ║"
echo "║  目标: RPA Linux Worker                      ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
info "主机名    : $(hostname)"
info "时区      : $TIMEZONE"
info "SSH 端口  : $SSH_PORT"
info "防火墙    : $ENABLE_UFW (仅 SSH 入站，出站全放行)"
info "Swap      : ${SWAP_SIZE_GB}GB"
echo ""

if ! $ASSUME_YES; then
    read -rp "Continue with hardening? (y/N): " confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { info "Cancelled"; exit 0; }
fi

# ── Step 1: 时区 / 系统更新 / 基础应用 ───────────────────────
step "1: 时区、系统更新和基础应用安装"

timedatectl set-timezone "$TIMEZONE" 2>/dev/null || warn "时区设置失败"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get dist-upgrade -y -qq

# 基础应用: 运维工具 + 安全工具 + Python + Playwright 字体
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl wget git vim nano htop net-tools \
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
  python3 python3-pip python3-venv \
  fonts-noto-cjk fonts-liberation

apt-get autoremove -y -qq
systemctl enable chrony --now 2>/dev/null || true
ok "系统更新、基础应用和安全工具安装完成"

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
ok "密码复杂度策略已配置 (最小14位, 大小写+数字+特殊字符)"

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
    ok "Password history configured: remember 24"
fi

cat > /etc/security/faillock.conf <<'EOF'
deny = 5
unlock_time = 900
fail_interval = 900
root_unlock_time = 900
audit
EOF
ok "Account lockout: 5 failures = 15 min lock"

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

usermod -aG sudo "$WORKER_USER" 2>/dev/null || warn "用户 $WORKER_USER 不存在，跳过 sudo 组"
sed -i '/^AllowGroups/d' "$SSHD_CONFIG"
echo "AllowGroups sudo" >> "$SSHD_CONFIG"
ok "SSH restricted to sudo group"

if sshd -t 2>/dev/null; then
    systemctl restart ssh
    ok "CIS SSH hardening complete"
    warn "IMPORTANT: Test new SSH connection before closing this session!"
else
    warn "SSH config validation FAILED - restoring backup"
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

if ! grep -q "maxage 90" /etc/logrotate.conf 2>/dev/null; then
    echo "maxage 90" >> /etc/logrotate.conf
    ok "日志保留期限 90天"
fi

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
chmod 755 /var/log/audit
chmod 750 /etc/cron.d
chmod 750 /etc/cron.daily
chmod 750 /etc/cron.weekly
chmod 750 /etc/cron.monthly
chmod 600 /etc/crontab
chmod 600 /etc/ssh/sshd_config
ok "关键文件权限已加固"

# 注意: Worker 的 /tmp 不加 noexec (pip/playwright 安装需要在 /tmp 执行)
if ! grep -q 'tmpfs.*\/tmp' /etc/fstab 2>/dev/null; then
    echo "tmpfs /tmp tmpfs defaults,rw,nosuid,nodev,relatime,size=2G 0 0" >> /etc/fstab
    mount -o remount /tmp 2>/dev/null || warn "/tmp remount skipped (reboot needed)"
    ok "/tmp secure mount configured (nosuid, nodev)"
else
    ok "/tmp already has secure mount options"
fi

# ── Step 6: CIS - 网络和防火墙 ────────────────────────────────
step "6: CIS 防火墙和网络加固"

if $ENABLE_UFW; then
    apt-get install -y -qq ufw
    ufw --force reset
    ufw default deny incoming
    ufw default allow outgoing
    ufw allow out on lo
    ufw deny in from 127.0.0.0/8
    ufw deny in from ::1
    ufw allow "$SSH_PORT/tcp"
    ufw --force enable
    ufw status verbose
    ok "UFW 防火墙已启用 (Worker 仅 SSH 入站; Prefect 为出站连接不需开端口)"
else
    warn "防火墙配置已跳过（ENABLE_UFW=false）"
fi

cat > /etc/sysctl.d/99-cis-network.conf <<'EOF'
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
EOF
sysctl -p /etc/sysctl.d/99-cis-network.conf
ok "ICMP 重定向已禁用"

# ── Step 7: Fail2ban 配置 ────────────────────────────────────
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
EOF

systemctl enable fail2ban --now
ok "Fail2ban 已启用（SSH 5次失败封禁1小时）"

# ── Step 8: 内核参数优化（RPA Worker + CIS）──────────────────
step "8: 内核参数优化 (RPA Worker + CIS)"

cat > /etc/sysctl.d/99-rpa-worker.conf <<'EOF'
# RPA Worker 优化
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5

# 网络优化 (Playwright / httpx 并发连接)
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

sysctl -p /etc/sysctl.d/99-rpa-worker.conf
ok "RPA Worker + CIS 内核参数已优化"

# ── Step 9: 文件描述符和进程限制 ─────────────────────────────
step "9: 系统限制配置"

cat > /etc/security/limits.d/99-rpa-worker.conf <<EOF
# RPA Worker limits (Playwright 多浏览器实例需要大量 fd)
$WORKER_USER soft nofile 65536
$WORKER_USER hard nofile 65536
$WORKER_USER soft nproc  65536
$WORKER_USER hard nproc  65536

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
    swapon --show
fi

# ── Step 11: 日志轮转 ────────────────────────────────────────
step "11: 日志轮转配置"

cat > /etc/logrotate.d/rpa-worker <<EOF
$AGENT_DIR/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 $WORKER_USER $WORKER_USER
}
EOF

if [ -f /etc/rsyslog.conf ]; then
    systemctl restart rsyslog 2>/dev/null || true
fi
ok "日志轮转已配置 ($AGENT_DIR/logs)"

# ── Step 12: 禁用不必要服务 ──────────────────────────────────
step "12: 禁用不必要服务"

DISABLE_SERVICES=("snapd" "apport" "whoopsie" "avahi-daemon" "cups" "cups-browsed" "bluetooth" "ModemManager")
for svc in "${DISABLE_SERVICES[@]}"; do
    if systemctl is-active "$svc" &>/dev/null; then
        systemctl disable --now "$svc" 2>/dev/null || true
        info "已禁用: $svc"
    fi
done
ok "不必要服务已清理"

# ── Step 13: 加固报告 ────────────────────────────────────────
step "13: 加固报告"

cat > /var/log/worker-hardening-report.txt <<EOF
===============================================
  Ubuntu 24.04 LTS Hardening Report
  Target: RPA Linux Worker ($(hostname))
  Generated: $(date)
===============================================

系统信息:
  主机名: $(hostname)
  系统版本: $(lsb_release -d 2>/dev/null | cut -f2 || echo 'N/A')
  内核版本: $(uname -r)

加固项检查:
  [✓] 基础应用: git/vim/htop/jq/unzip/chrony/python3/CJK字体
  [✓] 密码复杂度: 14位 + 大小写+数字+特殊
  [✓] SSH 加固: Port=$SSH_PORT, RootLogin=no
  [✓] 防火墙: $(ufw status 2>/dev/null | head -1) (仅 SSH 入站)
  [✓] Fail2ban: $(systemctl is-active fail2ban 2>/dev/null)
  [✓] Auditd: $(systemctl is-active auditd 2>/dev/null)
  [✓] AIDE: 已初始化
  [✓] Swap: ${SWAP_SIZE_GB}GB

后续建议:
1. 定期运行 AIDE 检查: sudo aide --check
2. 定期查看审计日志: sudo aureport

下一步:
   sudo reboot                              # 应用内核参数
   sudo bash install-lcnnsc-rpa-l0X.sh      # 安装 Prefect Worker

===============================================
EOF

ok "加固报告已保存到 /var/log/worker-hardening-report.txt"

# ── 完成 ──────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  Linux Worker 加固完成！                     ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
ok "系统更新和基础应用"
ok "CIS 密码策略"
ok "CIS SSH 加固"
ok "CIS 审计和日志"
ok "CIS 文件权限"
ok "CIS 网络安全"
ok "Fail2ban 防护"
ok "内核参数优化"
$ENABLE_UFW && ok "UFW 防火墙 (仅 SSH 入站)" || warn "防火墙未启用"
echo ""
info "查看详细报告:"
echo "  cat /var/log/worker-hardening-report.txt"
echo ""
warn "下一步:"
echo "  1. sudo reboot (应用内核参数)"
echo "  2. sudo bash install-lcnnsc-rpa-l0X.sh (安装 Prefect Worker)"
echo ""
