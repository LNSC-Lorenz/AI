# Ubuntu 24.04 LTS Autoinstall 在 ESXi 上的无人值守部署 (Magentic-UI)

## 概述

使用 Ubuntu 24.04 LTS Server 的 **Autoinstall**（Subiquity 自动安装）功能，在 VMware ESXi 上实现完全无人值守安装。
安装后手动执行安全加固和 Magentic-UI 部署脚本。

## 架构概览

```
┌───────────────────────────────┐         ┌──────────────────────────────┐
│   Ubuntu Server (ESXi VM)     │         │   Dell DGX Spark             │
│                               │  HTTP   │                              │
│  ┌─────────────────────────┐  │────────►│  ┌────────────────────────┐  │
│  │  Magentic-UI            │  │         │  │  Ollama (:11434)       │  │
│  │  (localhost:8081)       │  │         │  │  ├─ qwen3.6:35b        │  │
│  │  + Quicksand 沙箱       │  │         │  │  ├─ fara-7b:q5         │  │
│  └─────────────────────────┘  │         │  └────────────────────────┘  │
│  ┌─────────────────────────┐  │         │                              │
│  │  Docker Engine          │  │         └──────────────────────────────┘
│  └─────────────────────────┘  │
│  ┌─────────────────────────┐  │
│  │  UFW + Fail2ban + CIS  │  │
│  └─────────────────────────┘  │
└───────────────────────────────┘
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `autoinstall/user-data` | Autoinstall 主配置（cloud-config 格式），包含网络/分区/账户/Docker |
| `autoinstall/meta-data` | cloud-init 元数据（必须存在） |
| `autoinstall/Create-CidataISO.ps1` | Windows PowerShell 脚本，自动创建 cidata ISO |
| `autoinstall/verify.sh` | 安装后验证脚本 |
| `harden-ubuntu.sh` | Ubuntu CIS 安全加固脚本（15 步加固） |
| `deploy-magentic-ui.sh` | Magentic-UI 部署脚本（连接远程 Ollama） |

---

## 当前配置参数

| 项目 | 值 |
|------|------|
| 主机名 | `LAB-Magentic-UI-01` |
| IP 地址 | `10.87.5.188/24`（静态） |
| 网关 | `10.87.5.1` |
| DNS | `10.87.5.11`, `10.87.5.12` |
| 网卡 | `ens192`（ESXi VMXNET3） |
| 系统盘 | `/dev/sda`，LVM 分区（/、/var、/tmp、/home） |
| 管理员 | `magentic` / `ChangeMe2026!@#` |
| Docker | 安装阶段自动安装 |
| Python | 3.12（安装阶段自动安装） |

---

## ESXi 虚拟机资源分配

### 新建虚拟机设置

| 项目 | 值 |
|------|------|
| 虚拟机名称 | `magentic-ui` |
| 客户机操作系统 | Linux → **Ubuntu Linux (64-bit)** |
| 引导固件 | **EFI** |

### 硬件配置

| 资源 | 配置 | 说明 |
|------|------|------|
| **CPU** | 8 vCPU | 可按实际需求调整（最低 4） |
| **内存** | 16 GB | 可按实际需求调整（最低 8） |
| **系统盘 (sda)** | 100 GB | 厚置备延迟置零，SCSI 0:0 |
| **网卡** | VMXNET3 | 对应 Ubuntu 内 `ens192` |
| **SCSI 控制器** | VMware Paravirtual | 性能优于 LSI Logic |

### 分区方案（系统盘 sda）

| 挂载点 | 大小 | 说明 |
|--------|------|------|
| `/boot/efi` | 512 MB | EFI 系统分区（ESP，FAT32） |
| `/boot` | 1 GB | 内核文件（ext4） |
| `/` (lv-root) | 50 GB | 系统根目录 |
| `/var` (lv-var) | 30 GB | 日志、apt 缓存、Docker 数据 |
| `/tmp` (lv-tmp) | 10 GB | 临时文件 |
| `/home` (lv-home) | 剩余 | 用户目录、Magentic-UI 项目 |

---

## 部署步骤

### 1. 制作 cidata ISO

#### 方法一：使用 PowerShell 脚本（推荐，自动处理）

**前提：** 安装 Windows ADK（评估和部署工具包）或 7-Zip

```powershell
# 进入 autoinstall 目录
cd c:\Users\zhlo\Documents\GIT\AI\Ubuntu-MagenticUI\autoinstall

# 运行创建脚本（自动检测工具、转换换行符、验证结果）
.\Create-CidataISO.ps1

# 或指定输出路径
.\Create-CidataISO.ps1 -OutputPath "D:\VMs\cidata.iso"
```

脚本功能：
- 自动检测并使用可用的工具（oscdimg 或 7-Zip）
- 自动将 `user-data` 和 `meta-data` 的换行符转换为 Unix 格式（LF）
- 验证 ISO 卷标和内容
- 显示验证结果

#### 方法二：手动使用 oscdimg（Windows ADK）

```powershell
# 安装 Windows ADK 后，使用 oscdimg（在 autoinstall 目录下执行）
oscdimg -n -d -L"cidata" .\ cidata.iso
```

#### 方法三：在 Linux 上制作

```bash
# 在 autoinstall 目录下执行
sudo apt-get install -y genisoimage
genisoimage -output cidata.iso -volid cidata -joliet -rock user-data meta-data
```

> **注意：** ISO 卷标必须为 `cidata`（小写），否则 cloud-init 无法识别。

### 2. ESXi 新建虚拟机

1. vSphere Client → **新建虚拟机**
2. 按上方"硬件配置"表分配资源
3. **CD/DVD 驱动器 1**：挂载 `ubuntu-24.04-live-server-amd64.iso`
4. **CD/DVD 驱动器 2**：挂载 `cidata.iso`（上传到数据存储）
5. 启动顺序确认 CD/DVD 在硬盘之前
6. 启动虚拟机 → 安装**全自动进行**，约 10~15 分钟后自动重启

### 3. 安装完成后登录

```bash
ssh magentic@<服务器IP>
# 密码: ChangeMe2026!@#
```

### 4. 执行安全加固

```bash
# 上传脚本到服务器
scp harden-ubuntu.sh deploy-magentic-ui.sh magentic@<服务器IP>:~/

# 执行 CIS 加固
sudo bash harden-ubuntu.sh

# 查看加固报告
cat /var/log/cis-hardening-report.txt

# 重启系统
sudo reboot
```

### 5. 部署 Magentic-UI

```bash
# 重启后重新登录
ssh magentic@<服务器IP>

# 部署 Magentic-UI（连接远程 Ollama）
# 重要：必须以 magentic 用户运行，不要用 sudo/root
bash deploy-magentic-ui.sh
```

### 6. 访问

- **Web UI**: `http://<服务器IP>:8081`
- **SSH**: `ssh magentic@<服务器IP>`

---

## 性能说明

- **首次启动**：部署脚本会自动预加载 Ollama 模型，减少首次请求等待时间
- **模型速度**：`qwen3.6:35b` 是 35B 参数模型，每次 Agent 决策需要一定时间；如追求速度，可将 `ORCHESTRATOR_MODEL` 改为更小的模型（如 7B/14B）
- **内存占用**：同时运行 orchestrator 和 web_surfer 两个模型对 DGX Spark 显存压力较大，确保 DGX Spark 有足够显存

---

## 安全加固清单

`harden-ubuntu.sh` 执行以下 15 步 CIS 加固：

- **Step 1**: Ubuntu Pro / USG 检查
- **Step 2**: 系统更新 + 安装加固工具（AIDE、auditd、fail2ban 等）
- **Step 3**: CIS 密码策略（14位复杂度、历史记录、账户锁定）
- **Step 4**: CIS SSH 加固（禁 root、限制组、强加密算法、SFTP）
- **Step 5**: CIS 审计和日志（AIDE 文件完整性、auditd 审计规则）
- **Step 6**: CIS 文件系统和权限（SUID/SGID 扫描、/tmp 安全挂载）
- **Step 7**: CIS 防火墙和网络加固（UFW: SSH + Magentic-UI 端口）
- **Step 8**: Fail2ban 暴力破解防护
- **Step 9**: 内核参数优化（Docker + Magentic-UI + CIS）
- **Step 10**: 系统限制配置（文件描述符、进程数）
- **Step 11**: Swap 配置
- **Step 12**: 日志和监控配置（Magentic-UI 日志轮转）
- **Step 13**: 禁用不必要服务（snapd、apport、cups 等）
- **Step 14**: Docker 安全加固（无容器间通信、用户命名空间隔离）
- **Step 15**: CIS 合规报告生成

---

## DGX Spark 端准备

确保 DGX Spark 上 Ollama 可被远程访问：

```bash
# 在 DGX Spark 上执行
export OLLAMA_HOST=0.0.0.0
ollama serve

# 确认模型
ollama list
# 应看到 qwen3.6:35b 和 fara-7b:q5
```

---

## Magentic-UI 配置

编辑 `deploy-magentic-ui.sh` 顶部配置区：

```bash
OLLAMA_HOST="http://10.87.5.55:11434"    # DGX Spark 的实际 IP
ORCHESTRATOR_MODEL="qwen3.6:35b"          # 编排器模型
BROWSER_MODEL="batiai/fara-7b:q5"         # 浏览器代理模型
MAGENTIC_PORT=8081                         # Web UI 端口
```

---

## 自定义配置

### 修改密码

```bash
# 生成新密码哈希（在任意 Linux 上执行）
openssl passwd -6 'YourNewPassword'
```

将输出替换 `autoinstall/user-data` 中 `password:` 字段的值。

### 切换为静态 IP

编辑 `autoinstall/user-data` 中 network 段：

```yaml
network:
  version: 2
  ethernets:
    ens192:
      dhcp4: false
      optional: true
      match:
        name: "en*"              # 匹配任意以太网接口
      set-name: ens192           # 统一命名为 ens192
      addresses: [10.87.5.188/24]
      routes:
        - to: default
          via: 10.87.5.1
      nameservers:
        addresses: [10.87.5.11, 10.87.5.12]
```

### ESXi 网卡名称参考

| ESXi 网卡类型 | Ubuntu 内设备名 |
|--------------|----------------|
| VMXNET3（推荐） | `ens192` |
| E1000 | `ens160` |

---

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 进入交互安装界面，未自动安装 | cidata ISO 卷标错误或未识别 | 确认 ISO 卷标为 `cidata`，检查 CD/DVD 2 是否正确挂载 |
| 网卡名不是 `ens192` | 网卡类型非 VMXNET3 | 改用 `match: {name: "en*"}` 通配，或确认实际网卡名 |
| 分区失败 | 磁盘有残留分区表 | `autoinstall/user-data` 已配置 `wipe: superblock-recursive`，检查磁盘顺序 |
| SSH 连不上 | IP 未生效或防火墙 | ESXi 控制台登录确认 IP：`ip addr show ens192` |
| 安装后无法引导 | 引导固件设置错误 | 确认虚拟机固件为 **EFI**，非 BIOS |
| Docker 未安装 | late-commands 中 Docker 安装失败 | 手动安装：`curl -fsSL https://get.docker.com \| sh` |
| Docker 启动失败 | 加固脚本中的 `userns-remap` 或存储驱动不兼容 | 已修复：使用 `overlay2` 并移除 `userns-remap`，重新运行 `harden-ubuntu.sh` 或 `deploy-magentic-ui.sh` |
| 其它机器访问报 `Bad Host header` | Magentic-UI 只接受 localhost Host 头 | 已修复：脚本自动配置 nginx 反向代理，无需手动处理 |
| Ollama 连接失败 | DGX Spark 未就绪 | 确认 `OLLAMA_HOST=0.0.0.0`、防火墙 11434、网络连通 |
| Magentic-UI 启动失败 | Python 或依赖问题 | 检查 `python3.12 --version`、`docker info`、重新运行 deploy 脚本 |
| 复杂任务报 `Chat completion failed` | 模型 `function_calling` 配置或模型超时 | 检查 `config.yaml` 中 `function_calling: true`，查看 `journalctl -u magentic-ui -f` |
