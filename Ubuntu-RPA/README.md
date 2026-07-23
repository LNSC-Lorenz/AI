# RPA Platform — Prefect 3 + FastAPI + Vue3 + Multi-Agent

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Ubuntu Server (lcnnsc-rpa-00 / 10.86.180.120)      │
│  ┌────────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Prefect    │ │ FastAPI  │ │ Vue3 (Nginx)     │  │
│  │ Server     │ │ Gateway  │ │ Frontend         │  │
│  │ :4200      │ │ :8100    │ │ :80              │  │
│  └─────┬──────┘ └────┬─────┘ └──────────────────┘  │
│        │ PostgreSQL :5432                            │
└────────┼──────────────┼─────────────────────────────┘
         │              │
    ┌────▼──────────────▼─────┐   ┌──────────────────────┐
    │  Windows VM (RPA Agent)  │   │  Linux VM (RPA Agent) │
    │  ┌───────────────────┐  │   │  ┌────────────────┐  │
    │  │ Prefect Worker    │  │   │  │ Prefect Worker │  │
    │  │  ├─ SAP GUI Flow  │  │   │  │  ├─ Web Flow   │  │
    │  │  ├─ Web Flow      │  │   │  │  └─ Python Flow│  │
    │  │  └─ Python Flow   │  │   │  └────────────────┘  │
    │  └───────────────────┘  │   └──────────────────────┘
    └─────────────────────────┘
```

## Components

| Component | Tech | Port | Location |
|-----------|------|------|----------|
| Orchestrator | Prefect 3 Server | 4200 | Ubuntu (Docker) |
| Database | PostgreSQL 16 | 5432 | Ubuntu (Docker) |
| API Gateway | FastAPI | 8100 | Ubuntu (systemd) |
| Frontend | Vue3 + Vite | 80 | Ubuntu (Nginx) |
| Windows Worker | Prefect Worker | — | Windows VM (SAP + Web + Python) |
| Linux Worker | Prefect Worker | — | Linux VM (Web + Python) |

## Deployment

### [1] autoinstall — Ubuntu Autoinstall (ESXi VM)

```powershell
cd "[1] autoinstall"
.\Create-CidataISO.ps1
# 上传 ISO 到 ESXi → 挂载到 VM → 自动安装 Ubuntu 24.04
# 安装完成后: sudo bash verify.sh
```

### [2] install-ubuntu — 服务端安装 (按编号顺序执行)

```bash
cd "/opt/scripts/[2] install-ubuntu"
sudo bash 00-harden-ubuntu.sh      # CIS 安全加固 (reboot after)
sudo bash 01-setup-docker.sh       # Docker + 系统依赖
sudo bash 02-deploy-prefect.sh     # Prefect Server + PostgreSQL
sudo bash 03-setup-gateway.sh      # FastAPI Gateway (systemd)
sudo bash 04-build-frontend.sh     # Vue3 前端构建
sudo bash 05-setup-nginx.sh        # Nginx 反向代理
```

### [3] install-worker-windows — Windows Worker 安装

```powershell
# Run as Administrator
.\setup-windows-agent.ps1 -PrefectApiUrl http://10.86.180.120:4200/api

# Register flows
cd C:\RPA-Agent\flows
python must_deploy.py
```

### [4] install-worker-linux — Linux Worker 安装

```bash
sudo bash setup-linux-agent.sh http://10.86.180.120:4200/api linux-rpa-pool rpa-linux-agent-01

# Register flows
cd /opt/rpa-agent/flows
/opt/rpa-agent/.venv/bin/python must_deploy.py
```

## 使用说明

### 前置条件

| 项目 | 要求 |
|------|------|
| ESXi 虚拟机 | BIOS 模式启动、VMXNET3 网卡、80GB+ 硬盘 |
| Ubuntu ISO | ubuntu-24.04-live-server-amd64.iso |
| Windows ADK | 本机已安装（oscdimg.exe 用于生成 cidata ISO） |
| 网络环境 | 服务器能访问互联网（Docker 镜像拉取） |

### 完整部署步骤

#### 第一步：创建 Autoinstall ISO（在 Windows 管理机上）

1. 打开 PowerShell（管理员）
2. 修改 `[1] autoinstall/user-data` 中的 IP 和主机名（如需更改）
3. 运行 `.\Create-CidataISO.ps1` 生成 `cidata-rpa.iso`
4. 将 `cidata-rpa.iso` 上传到 ESXi 数据存储

#### 第二步：自动安装 Ubuntu（在 ESXi 上）

1. 新建 VM：Ubuntu 64-bit、BIOS 启动、VMXNET3 网卡、80GB+ 硬盘
2. CD/DVD 1 → 挂载 `ubuntu-24.04-live-server-amd64.iso`
3. CD/DVD 2 → 挂载 `cidata-rpa.iso`
4. 启动 VM，等待自动安装完成并重启（约 10-15 分钟）
5. SSH 登录验证：`ssh rpa@10.86.180.120`（密码 `ChangeMe2026!@#`）
6. 运行验证脚本：`sudo bash /opt/scripts/verify.sh`（可选）

#### 第三步：上传部署脚本到服务器

```bash
scp -r "[2] install-ubuntu" rpa@10.86.180.120:/opt/scripts/
```

#### 第四步：服务端部署（SSH 到服务器，按顺序执行）

```bash
cd '/opt/scripts/[2] install-ubuntu'

# 1. 安全加固（完成后重启）
sudo bash 00-harden-ubuntu.sh
sudo reboot

# 2. 重启后继续
sudo bash 01-setup-docker.sh       # Docker + Node.js + Nginx + 依赖
sudo bash 02-deploy-prefect.sh     # Prefect Server + PostgreSQL (Docker)
sudo bash 03-setup-gateway.sh      # FastAPI Gateway (systemd 服务)
sudo bash 04-build-frontend.sh     # Vue3 前端构建
sudo bash 05-setup-nginx.sh        # Nginx 反向代理配置
```

#### 第五步：部署 Windows Worker（在 Windows RPA 机器上）

```powershell
# 以管理员身份运行 PowerShell
.\setup-windows-agent.ps1 -PrefectApiUrl http://10.86.180.120:4200/api

# 注册流程
cd C:\RPA-Agent\flows
python must_deploy.py
```

#### 第六步：部署 Linux Worker（在 Linux RPA 机器上，可选）

```bash
sudo bash setup-linux-agent.sh http://10.86.180.120:4200/api linux-rpa-pool rpa-linux-agent-01

# 注册流程
cd /opt/rpa-agent/flows
/opt/rpa-agent/.venv/bin/python must_deploy.py
```

### 部署后验证

| 验证项 | 命令/地址 |
|--------|-----------|
| Prefect UI | http://10.86.180.120:4200 |
| RPA 前端 | http://10.86.180.120 |
| API 健康检查 | `curl http://10.86.180.120/api/health` |
| Docker 状态 | `sudo docker ps` (应有 prefect-server + postgres) |
| Gateway 状态 | `sudo systemctl status rpa-gateway` |
| Worker 状态 | Prefect UI → Work Pools 页面查看 Agent 在线 |

### 常见问题

| 问题 | 解决方案 |
|------|---------|
| Docker 拉镜像超时 | 配置镜像加速：编辑 `/etc/docker/daemon.json` 添加 `registry-mirrors` |
| Nginx 502 Bad Gateway | 检查 Gateway 服务：`sudo systemctl status rpa-gateway` |
| Worker 连不上 Server | 检查防火墙：`sudo ufw status`，确保 4200 端口开放 |
| 前端白屏 | 检查构建：`ls /var/www/rpa-frontend/`，重新运行 `04-build-frontend.sh` |

---

## Prefect 工作原理

```
┌────────────────────────────────────────────────────────────────┐
│                    Prefect Server (Ubuntu)                       │
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────────┐  │
│  │ Scheduler│───▶│ API 4200 │◀───│ UI (浏览器访问)           │  │
│  └──────────┘    └────┬─────┘    └──────────────────────────┘  │
│                       │                                          │
└───────────────────────┼──────────────────────────────────────────┘
                        │ 任务调度指令
          ┌─────────────┼─────────────┐
          ▼                           ▼
┌─────────────────────┐    ┌─────────────────────┐
│  Windows Worker      │    │  Linux Worker        │
│  (主动轮询 Server)   │    │  (主动轮询 Server)   │
│                      │    │                      │
│  拿到任务 → 执行流程  │    │  拿到任务 → 执行流程  │
│  ├─ SAP GUI 自动化   │    │  ├─ Web 爬虫         │
│  ├─ Web 自动化       │    │  └─ Python ETL       │
│  └─ Python ETL       │    │                      │
│                      │    │  执行完 → 上报结果    │
│  执行完 → 上报结果    │    └─────────────────────┘
└─────────────────────┘
```

**核心原理**：
- **Server** 负责调度：存储 Flow 定义、管理调度计划、记录执行历史
- **Worker** 负责执行：主动向 Server 轮询（pull 模式），拿到任务后在本地执行
- **Flow** 是任务：一段 Python 代码，用 `@flow` 装饰器标注
- **Deployment** 是注册：把 Flow 注册到 Server，绑定 Work Pool + 调度计划
- **Work Pool** 是分组：把 Worker 按能力分组（如 windows-rpa-pool / linux-rpa-pool）

> Worker 到 Server 是 **出站连接**（Worker → Server），不需要 Server 能访问 Worker 网络。

---

## 使用指南（平台搭建完成后）

### Windows Worker 系统要求

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11 / Server 2016+ (64-bit) |
| Python | 3.10+ (脚本会自动通过 winget 安装 3.12) |
| 网络 | 能访问 Prefect Server (`10.86.180.120:4200`) |
| 权限 | 管理员权限（安装服务） |
| SAP GUI | 如需 SAP 自动化，需预装 SAP Logon + 启用 Scripting |

**无特殊 Windows 版本限制**，只要是 64-bit 且能运行 Python 3.10+ 即可。

### Windows Worker 安装关键步骤

```powershell
# 1. 将 [3] install-worker-windows 文件夹复制到 Windows 机器
# 2. 以管理员打开 PowerShell，进入该目录
cd "C:\path\to\[3] install-worker-windows"

# 3. 一键安装（自动完成：Python → venv → Prefect → 注册服务）
.\setup-windows-agent.ps1 -PrefectApiUrl http://10.86.180.120:4200/api

# 4. 注册 Flow（告诉 Server 这台机器能跑哪些任务）
cd C:\RPA-Agent\flows
C:\RPA-Agent\.venv\Scripts\python.exe must_deploy.py
```

安装完成后：
- Worker 作为 Windows 服务 `PrefectRPAWorker` 自动运行（开机自启）
- 日志位于 `C:\RPA-Agent\logs\`
- Flow 代码位于 `C:\RPA-Agent\flows\`

### Windows Worker 部署实例（lcnnsc-rpa-w01 / lcnnsc-rpa-w02）

以两台全新安装的 Windows Server 为例，两台加入同一 Work Pool 实现 HA / 负载分担。

**前提**（vCenter 模板克隆 + 自定义规范已完成）：

| 项目 | lcnnsc-rpa-w01 | lcnnsc-rpa-w02 |
|------|----------------|----------------|
| 计算机名 | `lcnnsc-rpa-w01` | `lcnnsc-rpa-w02` |
| IP | `10.86.180.121/24` | `10.86.180.122/24` |
| 已加域 | ✅（域用户有本地管理员权限） | ✅ |
| 能访问 Server | `http://10.86.180.120:4200` | 同左 |

**第 1 步：复制安装文件夹**

把 `[3] install-worker-windows/` 整个复制到 Worker 机器，如 `C:\Temp\install-worker-windows\`

**第 2 步：以管理员运行 PowerShell 执行安装**

```powershell
# ===== lcnnsc-rpa-w01 上执行 =====
cd C:\Temp\install-worker-windows
Set-ExecutionPolicy Bypass -Scope Process -Force
.\setup-windows-agent.ps1 `
    -PrefectApiUrl "http://10.86.180.120:4200/api" `
    -WorkPoolName "windows-rpa-pool" `
    -WorkerName "lcnnsc-rpa-w01"
```

```powershell
# ===== lcnnsc-rpa-w02 上执行（仅 WorkerName 不同） =====
cd C:\Temp\install-worker-windows
Set-ExecutionPolicy Bypass -Scope Process -Force
.\setup-windows-agent.ps1 `
    -PrefectApiUrl "http://10.86.180.120:4200/api" `
    -WorkPoolName "windows-rpa-pool" `
    -WorkerName "lcnnsc-rpa-w02"
```

脚本自动完成：Python 3.12 安装 → 虚拟环境 → Prefect + 依赖 → 复制 flows → 注册 Windows 服务（开机自启）。

**第 3 步：验证 Worker 上线**

Prefect UI（http://10.86.180.120:4200）→ **Work Pools** → `windows-rpa-pool` → Workers 列表应显示 `lcnnsc-rpa-w01` 和 `lcnnsc-rpa-w02` 均为 Online。

**第 4 步：首次部署验证（try-on，任选一台执行）**

```powershell
# 复制 [5] try-on 的 test_deploy.py 到 C:\RPA-Agent\flows\
cd C:\RPA-Agent\flows
C:\RPA-Agent\.venv\Scripts\python.exe test_deploy.py
```

Prefect UI → **Deployments** → `hello` → **Run** → Flow Runs 显示 `Completed`，日志输出 `Hello from lcnnsc-rpa-w01...`（或 w02，由谁先抢到任务决定）。

**第 5 步：注册正式业务 Flows（任选一台执行一次即可）**

```powershell
cd C:\RPA-Agent\flows
C:\RPA-Agent\.venv\Scripts\python.exe must_deploy.py
```

> Deployment 注册到 Server 是全局的，同一 Work Pool 内两台 Worker 自动分担任务；一台停机，另一台继续工作。

### 日常使用流程

1. **创建/修改 Flow** → 编辑 `C:\RPA-Agent\flows\` 下的 `.py` 文件
2. **注册 Flow** → 运行 `must_deploy.py` 将变更同步到 Server
3. **触发执行** → 在 RPA 前端（http://10.86.180.120）点击 "Trigger" 或设置定时调度
4. **查看结果** → 前端 Dashboard / Jobs 页面查看执行状态和日志

### 服务管理命令

```powershell
# Windows Worker 服务管理
nssm status PrefectRPAWorker     # 查看状态
nssm restart PrefectRPAWorker    # 重启
nssm stop PrefectRPAWorker       # 停止

# 或使用 Windows 服务管理器: services.msc → Prefect RPA Worker
```

```bash
# Ubuntu Server 服务管理
sudo docker compose -f '/opt/scripts/[2] install-ubuntu/docker-compose.yml' ps      # 查看容器
sudo docker compose -f '/opt/scripts/[2] install-ubuntu/docker-compose.yml' restart  # 重启
sudo systemctl status rpa-gateway     # Gateway 状态
sudo systemctl restart rpa-gateway    # 重启 Gateway
```

---

## Frontend (Job 全可视化)

Vue3 + TailwindCSS 全可视化面板：

| 页面 | 功能 |
|------|------|
| Dashboard | 统计概览 (Total/Running/Pending/Completed/Failed) + 成功率 + 最近 Job |
| Jobs | Job 列表 + 状态筛选 + 时间/耗时 + 详情入口 |
| Job Detail | 单个 Job 详情（参数/状态时间线/Tags） |
| Deployments | Deployment 卡片 + 一键 Trigger + 调度状态 |

## 操作流程

### 管理页面

| 页面 | 地址 | 用途 |
|------|------|------|
| Prefect UI | http://10.86.180.120:4200 | 完整管理（调度/日志/Worker 状态） |
| RPA 前端 | http://10.86.180.120 | 简化面板（日常运维） |

### 发布任务（Flow → Deployment）

```
1. 编写 Flow 代码（纯 Python + @flow 装饰器）
   → 放到 Worker 机器：C:\RPA-Agent\flows\xxx_flow.py

2. 注册 Deployment（告诉 Server 这个任务存在）
   → cd C:\RPA-Agent\flows
   → C:\RPA-Agent\.venv\Scripts\python.exe must_deploy.py

3. 注册成功后，Prefect UI → Deployments 页面可以看到
```

### 手动触发任务

```
方式 1：Prefect UI
   → Deployments → 选择任务 → 右上角 Run → 填参数 → Submit

方式 2：RPA 前端
   → Deployments 页面 → 点 Trigger 按钮

方式 3：API 调用
   → curl -X POST http://10.86.180.120:4200/api/deployments/<id>/create_flow_run
```

### 查看状态和日志

| 操作 | Prefect UI 路径 |
|------|----------------|
| 任务列表 | Flow Runs（状态：Pending → Running → Completed/Failed） |
| 任务日志 | Flow Runs → 点具体一条 → Logs 标签 |
| Worker 在线状态 | Work Pools → 选 pool → Workers 列表 |
| 设置定时调度 | Deployments → 选任务 → Schedule → 添加 cron 表达式 |

### 典型工作流程

```
编写 Flow (.py)
    ↓
must_deploy.py 注册到 Server
    ↓
Prefect UI / RPA 前端 点 Trigger（或定时触发）
    ↓
任务进入队列（Pending）
    ↓
Worker 轮询拿到任务（Running）
    ↓
执行完成（Completed / Failed）
    ↓
查看日志和结果
```

---

## Directory Structure

```
Ubuntu-RPA/
├── [1] autoinstall/                     # Ubuntu 无人值守安装
│   ├── Create-CidataISO.ps1
│   ├── meta-data
│   ├── user-data
│   └── verify.sh
│
├── [2] install-ubuntu/                  # 服务端安装
│   ├── 00-harden-ubuntu.sh
│   ├── 01-setup-docker.sh
│   ├── 02-deploy-prefect.sh
│   ├── 03-setup-gateway.sh
│   ├── 04-build-frontend.sh
│   ├── 05-setup-nginx.sh
│   ├── docker-compose.yml
│   ├── gateway/
│   │   ├── main.py
│   │   ├── config.py
│   │   └── requirements.txt
│   ├── frontend/
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   └── src/
│   │       ├── App.vue
│   │       ├── views/Dashboard.vue
│   │       ├── views/Jobs.vue
│   │       ├── views/JobDetail.vue
│   │       └── views/Deployments.vue
│   └── nginx/
│       └── rpa.conf
│
├── [3] install-worker-windows/          # Windows Worker 安装
│   ├── setup-windows-agent.ps1
│   ├── install-lcnnsc-rpa-w01.cmd      # w01 / w02 / w03 一键安装
│   ├── install-lcnnsc-rpa-w02.cmd
│   ├── install-lcnnsc-rpa-w03.cmd
│   └── flows/
│       ├── must_deploy.py               # 正式业务 Flow 注册（模板）
│       └── requirements.txt
│
├── [4] install-worker-linux/            # Linux Worker 安装
│   ├── setup-linux-agent.sh
│   ├── install-lcnnsc-rpa-l01.sh       # l01 / l02 / l03 一键安装
│   ├── install-lcnnsc-rpa-l02.sh
│   ├── install-lcnnsc-rpa-l03.sh
│   ├── autoinstall/                     # ESXi 无人值守装机（同 [1] 模式）
│   │   ├── Create-CidataISO.ps1         # -HostName 参数选择主机
│   │   ├── lcnnsc-rpa-l01/              # .126  user-data + meta-data
│   │   ├── lcnnsc-rpa-l02/              # .127
│   │   └── lcnnsc-rpa-l03/              # .128
│   └── flows/
│       ├── web_flow.py
│       ├── python_flow.py
│       ├── must_deploy.py
│       └── requirements.txt
│
├── [5] try-on/                          # 首次部署验证
│   ├── test_deploy.py                   # 单文件：hello-flow + 注册
│   └── README.md
│
└── README.md
```
