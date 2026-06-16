#!/bin/bash
# Ubuntu 24.04 LTS Autoinstall 验证脚本
# 运行方式: sudo bash verify.sh

echo "=========================================="
echo "  Ubuntu Autoinstall 验证"
echo "=========================================="
echo ""

# 1. 主机名检查
echo "[1/8] 主机名"
hostnamectl | grep "Static hostname"
echo ""

# 2. 网络检查
echo "[2/8] 网络配置"
ip addr show | grep -E "inet |ens192"
echo ""
echo "网关:"
ip route | grep default
echo ""
echo "DNS:"
cat /etc/resolv.conf | grep nameserver
echo ""

# 3. 磁盘分区检查
echo "[3/8] 磁盘分区"
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,LABEL
echo ""

# 4. 数据盘挂载检查
echo "[4/8] 数据盘 /data"
df -h /data
ls -la /data/
echo ""

# 5. 用户检查
echo "[5/8] 用户配置"
id sysadmin
echo "sudo权限:"
grep sysadmin /etc/sudoers /etc/sudoers.d/* 2>/dev/null | head -3
echo ""

# 6. SSH检查
echo "[6/8] SSH服务"
systemctl status ssh --no-pager 2>/dev/null || systemctl status sshd --no-pager
echo ""
echo "SSH配置:"
grep -E "PermitRootLogin|PasswordAuthentication" /etc/ssh/sshd_config | head -2
echo ""

# 7. 软件包检查
echo "[7/8] 已安装软件包"
dpkg -l | grep -E "open-vm-tools|curl|ca-certificates|postgresql" | head -5
echo ""

# 8. cloud-init状态
echo "[8/8] cloud-init状态"
cloud-init status 2>/dev/null || echo "cloud-init 状态命令不可用"
echo ""

# 总结
echo "=========================================="
echo "  验证完成"
echo "=========================================="
echo ""
echo "如以上都正常，则 Ubuntu Autoinstall 部署成功！"
echo ""
echo "后续步骤:"
echo "1. 运行 ubuntu-init.sh 进行系统优化"
echo "2. 安装 PostgreSQL 18"
echo ""
