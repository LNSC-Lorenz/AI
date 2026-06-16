# Ubuntu 24.04 LTS Autoinstall 在 ESXi 上的无人值守部署

## 概述

使用 Ubuntu 24.04 LTS Server 的 **Autoinstall**（Subiquity 自动安装）功能，在 VMware ESXi 上实现完全无人值守安装。

## 文件说明

| 文件 | 说明 |
|------|------|
| `user-data` | Autoinstall 主配置（cloud-config 格式），包含网络/分区/账户 |
| `meta-data` | cloud-init 元数据（必须存在） |
| `Create-CidataISO.ps1` | Windows PowerShell 脚本，自动创建 cidata ISO |
| `verify.sh` | 安装后验证脚本 |
| `hardening.sh` | Ubuntu CIS 安全加固脚本（替代 ubuntu-init.sh） |

---

## 当前配置参数

| 项目 | 值 |
|------|------|
| 主机名 | `lcnnsc-db-pg01` |
| IP 地址 | `10.86.180.71/24` |
| 网关 | `10.86.180.200` |
| DNS | `10.86.180.1`, `10.86.180.2` |
| 网卡 | `ens192`（ESXi VMXNET3） |
| 系统盘 | `/dev/sda`，LVM 分区（/、/var、/tmp、/home） |
| 数据盘 | `/dev/sdb`，挂载 `/data`（PostgreSQL 专用） |
| 管理员 | `sysadmin` / `ChangeMe2026` |

---

## ESXi 虚拟机资源分配

### 新建虚拟机设置

| 项目 | 值 |
|------|------|
| 虚拟机名称 | `lcnnsc-db-pg01` |
| 客户机操作系统 | Linux → **Ubuntu Linux (64-bit)** |
| 引导固件 | **EFI** |

### 硬件配置

| 资源 | 配置 | 说明 |
|------|------|------|
| **CPU** | 16 vCPU | 可按实际需求调整（最低 8） |
| **内存** | 64 GB | 可按实际需求调整（最低 32） |
| **系统盘 (sda)** | 150 GB | 厚置备延迟置零，SCSI 0:0 |
| **数据盘 (sdb)** | **500 GB** | 厚置备延迟置零，SCSI 0:1 |
| **网卡** | VMXNET3 | 对应 Ubuntu 内 `ens192` |
| **SCSI 控制器** | VMware Paravirtual | 性能优于 LSI Logic |

> **磁盘格式说明：** 厚置备延迟置零（Thick Provision Lazy Zeroed）预分配全部空间，避免运行时动态扩展影响数据库 I/O 性能。

### 分区方案（系统盘 sda）

| 挂载点 | 大小 | 说明 |
|--------|------|------|
| `/boot/efi` | 512 MB | EFI 引导分区 |
| `/boot` | 1 GB | 内核文件 |
| `/` (lv-root) | 50 GB | 系统根目录 |
| `/var` (lv-var) | 30 GB | 日志、apt 缓存 |
| `/tmp` (lv-tmp) | 10 GB | 临时文件 |
| `/home` (lv-home) | 剩余 | 用户目录 |

### 数据盘（sdb）

| 挂载点 | 大小 | 说明 |
|--------|------|------|
| `/data` | 500 GB | PostgreSQL 数据目录专用 |

---

## 部署步骤

### 1. 制作 cidata ISO

#### 方法一：使用 PowerShell 脚本（推荐，自动处理）

**前提：** 安装 Windows ADK（评估和部署工具包）或 7-Zip

```powershell
# 进入 autoinstall 目录
cd c:\Users\zhlo\Documents\GIT\AI\PostgreSQL\autoinstall

# 运行创建脚本（自动检测工具、转换换行符、验证结果）
.\Create-CidataISO.ps1

# 或指定输出路径
.\Create-CidataISO.ps1 -OutputPath "D:\VMs\cidata.iso"

# 或强制使用特定工具
.\Create-CidataISO.ps1 -Tool Oscdimg    # 使用 Windows ADK
.\Create-CidataISO.ps1 -Tool 7Zip       # 使用 7-Zip
```

脚本功能：
- 自动检测并使用可用的工具（oscdimg 或 7-Zip）
- 自动将 `user-data` 和 `meta-data` 的换行符转换为 Unix 格式（LF）
- 验证 ISO 卷标和内容
- 显示验证结果

#### 方法二：手动使用 oscdimg（Windows ADK）

```powershell
# 安装 Windows ADK 后，使用 oscdimg（推荐）
# ADK 默认路径：C:\Program Files (x86)\Windows Kits\10\Assessment and Deployment Kit\Deployment Tools\amd64\Oscdimg

oscdimg -n -d -L"cidata" .\ cidata.iso
```

参数说明：
- `-n`：允许长文件名
- `-d`：允许小写字母
- `-L"cidata"`：设置卷标为 `cidata`（必须，区分大小写）

#### 方法三：手动使用 7-Zip

```powershell
# 确保 7-Zip 已安装（默认路径：C:\Program Files\7-Zip\7z.exe）

# 创建 UDF 格式的 ISO
7z a -tudf -v"cidata" cidata.iso user-data meta-data
```

#### 方法四：在 Linux 上制作

```bash
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
ssh sysadmin@10.86.180.71
# 密码: ChangeMe2026
```

### 4. 执行系统加固和数据库安装

#### 方案 A：标准优化（ubuntu-init.sh）

```bash
# 上传脚本到服务器
scp ubuntu-init.sh postgresql-install.sh sysadmin@10.86.180.71:~/

# 系统优化
sudo bash ubuntu-init.sh

# 安装 PostgreSQL 18
sudo bash postgresql-install.sh
```

#### 方案 B：CIS 安全加固（hardening.sh）

参考 [Ubuntu CIS Benchmarks](https://ubuntu.com/blog/hardening-automation-for-cis-benchmarks-now-available-for-ubuntu-24-04-lts) 的加固脚本，包含：
- 密码策略（14位复杂度、历史记录）
- SSH 安全加固（算法限制、会话控制）
- 审计日志（auditd、AIDE 文件完整性）
- 防火墙和网络防护
- 系统内核参数优化

```bash
# 上传脚本到服务器
scp hardening.sh postgresql-install.sh sysadmin@10.86.180.71:~/

# 执行 CIS 加固
sudo bash hardening.sh

# 查看加固报告
cat /var/log/cis-hardening-report.txt

# 重启系统
sudo reboot

# 安装 PostgreSQL 18
sudo bash postgresql-install.sh
```

**Ubuntu Pro 用户（可选）：**
```bash
# 自动化 CIS 扫描和修复
sudo apt install ubuntu-security-guide
sudo usg audit cis_level2_server
sudo usg fix cis_level2_server
```

---

## 自定义配置

### 修改密码

```bash
# 生成新密码哈希（在任意 Linux 上执行）
openssl passwd -6 'YourNewPassword'
```

将输出替换 `user-data` 中 `password:` 字段的值。

### ESXi 网卡名称参考

| ESXi 网卡类型 | Ubuntu 内设备名 |
|--------------|----------------|
| VMXNET3（推荐） | `ens192` |
| E1000 | `ens160` |

> 安装完成后确认：`ip link show`

---

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 进入交互安装界面，未自动安装 | cidata ISO 卷标错误或未识别 | 确认 ISO 卷标为 `cidata`，检查 CD/DVD 2 是否正确挂载 |
| 网卡名不是 `ens192` | 网卡类型非 VMXNET3 | 改用 `match: {name: "en*"}` 通配，或确认实际网卡名 |
| 分区失败 | 磁盘有残留分区表 | `user-data` 已配置 `wipe: superblock-recursive`，检查磁盘顺序 |
| `/data` 未挂载 | sdb 磁盘顺序不对 | `lsblk` 确认磁盘名，必要时修改 `user-data` 中 `/dev/sdb` 为实际设备名 |
| SSH 连不上 | IP 未生效或防火墙 | ESXi 控制台登录确认 IP：`ip addr show ens192` |
| 安装后无法引导 | 引导固件设置错误 | 确认虚拟机固件为 **EFI**，非 BIOS |
