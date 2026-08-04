#!/bin/bash
# Ubuntu 24.04 LTS Autoinstall 验证脚本 - LAB-Magentic-UI-00
# 运行方式: sudo bash verify.sh

echo '=========================================='
echo '  Ubuntu Autoinstall 验证 (LAB-Magentic-UI-00)'
echo '=========================================='
echo ''

# 1. 主机名检查
echo '[1/11] 主机名'
hostnamectl | grep 'Static hostname'
echo ''

# 2. 网络检查
echo '[2/11] 网络配置'
ip addr show | grep -E 'inet |ens192'
echo ''
echo '网关:'
ip route | grep default
echo ''
echo 'DNS:'
grep nameserver /etc/resolv.conf
echo ''

# 3. 磁盘分区检查
echo '[3/11] 磁盘分区'
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,LABEL
echo ''

# 4. 用户检查
echo '[4/11] 用户配置'
id magentic
echo 'sudo 权限:'
grep magentic /etc/sudoers /etc/sudoers.d/* 2>/dev/null | head -3
echo ''

# 5. SSH 检查
echo '[5/11] SSH 服务'
systemctl status ssh --no-pager 2>/dev/null || systemctl status sshd --no-pager
echo ''
echo 'SSH 配置:'
grep -E 'PermitRootLogin|PasswordAuthentication' /etc/ssh/sshd_config | head -2
echo ''

# 6. Docker 检查
echo '[6/11] Docker 服务'
systemctl status docker --no-pager 2>/dev/null | head -5
echo ''
echo 'Docker 版本:'
docker --version 2>/dev/null || echo 'Docker 未安装'
echo ''
echo 'Docker 运行状态:'
if docker info >/dev/null 2>&1; then
    echo 'Docker daemon is running and responsive (OK)'
else
    echo 'Docker daemon is not responding - check journalctl -u docker'
fi
echo ''

# 7. Python 检查
echo '[7/11] Python 环境'
python3.12 --version 2>/dev/null || echo 'Python 3.12 未安装'
echo ''

# 8. KVM 检查
echo '[8/11] KVM 虚拟化'
if [ -e /dev/kvm ]; then
    echo '/dev/kvm 可用 (OK)'
    ls -la /dev/kvm
else
    echo '/dev/kvm 不存在 (FAIL) (需在 ESXi 开启嵌套虚拟化)'
fi
echo ''

# 9. uv 检查
echo '[9/11] uv 包管理器'
su - magentic -c 'which uv 2>/dev/null && uv --version 2>/dev/null' || echo 'uv 未安装（将在 deploy 阶段安装）'
echo ''

# 10. Magentic-UI 项目目录检查
echo '[10/11] Magentic-UI 项目目录'
if [ -d /home/magentic/magentic-lite-00 ]; then
    echo '项目目录 /home/magentic/magentic-lite-00 已就绪 (OK)'
else
    echo '项目目录未创建（将在 deploy 阶段创建）'
fi
echo ''

# 11. nginx 检查
echo '[11/11] nginx'
systemctl status nginx --no-pager 2>/dev/null | head -3 || echo 'nginx 未安装'
echo ''

# 总结
echo '=========================================='
echo '  验证完成'
echo '=========================================='
echo ''
echo '如以上都正常，则 Ubuntu Autoinstall 部署成功！'
echo ''
echo '后续步骤:'
echo '1. （可选）上传并运行安全加固: sudo bash harden-ubuntu.sh'
echo '2. 上传并运行 Magentic-UI 部署: bash deploy-magentic-ui-00.sh'
echo ''
