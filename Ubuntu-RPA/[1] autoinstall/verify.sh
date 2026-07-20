#!/bin/bash
# Ubuntu 24.04 LTS Autoinstall 验证脚本 - RPA Platform
# 运行方式: sudo bash verify.sh

echo "=========================================="
echo "  Ubuntu Autoinstall 验证 (RPA Platform)"
echo "=========================================="
echo ""

# 1. 主机名检查
echo "[1/9] 主机名"
hostnamectl | grep "Static hostname"
echo ""

# 2. 网络检查
echo "[2/9] 网络配置"
ip addr show | grep -E "inet |ens192"
echo ""
echo "网关:"
ip route | grep default
echo ""
echo "DNS:"
cat /etc/resolv.conf | grep nameserver
echo ""

# 3. 磁盘分区检查
echo "[3/9] 磁盘分区"
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,LABEL
echo ""

# 4. 用户检查
echo "[4/9] 用户配置"
id rpa
echo "sudo权限:"
grep rpa /etc/sudoers /etc/sudoers.d/* 2>/dev/null | head -3
echo ""

# 5. SSH检查
echo "[5/9] SSH服务"
systemctl status ssh --no-pager 2>/dev/null || systemctl status sshd --no-pager
echo ""
echo "SSH配置:"
grep -E "PermitRootLogin|PasswordAuthentication" /etc/ssh/sshd_config | head -2
echo ""

# 6. Docker检查
echo "[6/9] Docker 服务"
systemctl status docker --no-pager 2>/dev/null | head -5
echo ""
echo "Docker 版本:"
docker --version 2>/dev/null || echo "Docker 未安装"
echo ""
echo "Docker 运行状态:"
if docker info >/dev/null 2>&1; then
    echo "Docker daemon is running and responsive"
else
    echo "Docker daemon is not responding - check 'journalctl -u docker'"
fi
echo ""
echo "Docker Compose 版本:"
docker compose version 2>/dev/null || echo "Docker Compose 未安装"
echo ""

# 7. Python检查
echo "[7/9] Python 环境"
python3.12 --version 2>/dev/null || echo "Python 3.12 未安装"
echo ""

# 8. 已安装软件包检查
echo "[8/9] 已安装软件包"
dpkg -l | grep -E "open-vm-tools|curl|ca-certificates|docker-ce" | head -5
echo ""

# 9. cloud-init状态
echo "[9/9] cloud-init状态"
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
echo "1. 上传 [2] install-ubuntu 到 /opt/scripts/"
echo "   scp -r '[2] install-ubuntu' rpa@10.86.180.120:/opt/scripts/"
echo "2. 按顺序运行部署脚本:"
echo "   cd '/opt/scripts/[2] install-ubuntu'"
echo "   sudo bash 00-harden-ubuntu.sh && sudo reboot"
echo "   sudo bash 01-setup-docker.sh"
echo "   sudo bash 02-deploy-prefect.sh"
echo "   sudo bash 03-setup-gateway.sh"
echo "   sudo bash 04-build-frontend.sh"
echo "   sudo bash 05-setup-nginx.sh"
echo ""
