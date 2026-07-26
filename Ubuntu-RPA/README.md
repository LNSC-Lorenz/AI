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
| Windows Worker | Prefect Worker (GUI 模式) | — | Windows VM (SAP GUI + Web + Python) |
| Linux Worker | Prefect Worker (systemd) | — | Linux VM (Web + Python) |

**主机清单**

| 主机 | IP | 角色 | Work Pool |
|------|----|----|-----------|
| lcnnsc-rpa-00 | 10.86.180.120 | Prefect Server + Gateway + 前端 | — |
| lcnnsc-rpa-w01/w02/w03 | .121/.122/.123 | Windows Worker (SAP GUI) | windows-gui-pool |
| lcnnsc-rpa-l01/l02/l03 | .126/.127/.128 | Linux Worker (Web/ETL) | linux-rpa-pool |

## Deployment

### 1_autoinstall — Ubuntu Autoinstall (ESXi VM)

```powershell
cd "1_autoinstall"
.\Create-CidataISO.ps1
# 上传 ISO 到 ESXi → 挂载到 VM → 自动安装 Ubuntu 24.04
# 安装完成后: sudo bash verify.sh
```

### 2_install-worker-server — 服务端安装 (按编号顺序执行)

```bash
cd "/opt/scripts/2_install-worker-server"
sudo bash 00-harden-ubuntu.sh      # CIS 安全加固 (reboot after)
sudo bash 01-setup-docker.sh       # Docker + 系统依赖
sudo bash 02-deploy-prefect.sh     # Prefect Server + PostgreSQL
sudo bash 03-setup-gateway.sh      # FastAPI Gateway (systemd)
sudo bash 04-build-frontend.sh     # Vue3 前端构建
sudo bash 05-setup-nginx.sh        # Nginx 反向代理
```

### 3_install-worker-windows — Windows Worker 安装 (GUI 模式)

```powershell
# Run as Administrator（w01/w02/w03 各自右键管理员运行对应 .cmd）
.\install-lcnnsc-rpa-w01.cmd
# 或手动:
.\setup-windows-agent.ps1 -RpaUser "LECHLER\rpacn01" -PrefectApiUrl http://10.86.180.120:4200/api `
    -WorkPoolName windows-gui-pool -WorkerName lcnnsc-rpa-w01
# 安装脚本会自动注册系统 flows (deploy-job)；装完后 RDP 登录一次 rpacn01 即可
```

### 4_install-worker-linux — Linux Worker 安装

```bash
# l01/l02/l03 各自执行对应脚本（内部调用 setup-linux-agent.sh，含 flows 自动注册）
sudo bash install-lcnnsc-rpa-l01.sh
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
2. 修改 `1_autoinstall/user-data` 中的 IP 和主机名（如需更改）
3. 运行 `.\Create-CidataISO.ps1` 生成 `cidata-lcnnsc-rpa-00.iso`（ISO 名自动取 user-data 里的 hostname）
4. 将 `cidata-lcnnsc-rpa-00.iso` 上传到 ESXi 数据存储

#### 第二步：自动安装 Ubuntu（在 ESXi 上）

1. 新建 VM：Ubuntu 64-bit、BIOS 启动、VMXNET3 网卡、80GB+ 硬盘
2. CD/DVD 1 → 挂载 `ubuntu-24.04-live-server-amd64.iso`
3. CD/DVD 2 → 挂载 `cidata-lcnnsc-rpa-00.iso`
4. 启动 VM，等待自动安装完成并重启（约 10-15 分钟）
5. SSH 登录验证：`ssh rpa@10.86.180.120`（密码 `ChangeMe2026!@#`）
6. 运行验证脚本：`sudo bash /opt/scripts/verify.sh`（可选）

#### 第三步：上传部署脚本到服务器

```bash
scp -r "2_install-worker-server" rpa@10.86.180.120:/opt/scripts/
```

#### 第四步：服务端部署（SSH 到服务器，按顺序执行）

```bash
cd '/opt/scripts/2_install-worker-server'

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
# 以管理员身份运行对应机器的一键脚本（w01/w02/w03）
.\install-lcnnsc-rpa-w01.cmd
# 装完后 RDP 登录一次 rpacn01：Worker 自启，3 分钟后会话自动转控制台（RDP 窗口关闭、不锁屏）
```

#### 第六步：部署 Linux Worker（在 Linux RPA 机器上，可选）

```bash
sudo bash install-lcnnsc-rpa-l01.sh   # l01/l02/l03 各自对应脚本
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
- **Work Pool** 是分组：把 Worker 按能力分组（如 windows-gui-pool / linux-rpa-pool）

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

### Windows Worker 安装关键步骤 (GUI 模式)

SAP GUI 自动化必须在交互桌面会话运行，因此 Worker 不是 Windows 服务，
而是以 RPA 用户登录会话里的计划任务运行，共三个计划任务：

| 计划任务 | 触发 | 作用 |
|---------|------|------|
| PrefectRPAWorker-GUI | rpacn01 登录时 | 启动 Worker（start-worker.cmd） |
| PrefectRPAWorker-ConsoleRedirect | 登录 + 3 分钟 | tscon 把会话转控制台，RDP 窗口关闭但会话不锁 |
| PrefectRPAWorker-Watchdog | 每 5 分钟 | Worker 进程死了自动拉起（防掉线池变红） |

```powershell
# 一键安装（自动：机器级 Python → venv → Prefect+依赖 → 计划任务 → 注册 deploy-job）
.\install-lcnnsc-rpa-w01.cmd
# 日常唯一手工步骤：每次重启后 RDP 登录一次 rpacn01（或用 -RpaPassword 启用自动登录实现全无人值守）
```

安装完成后：
- 日志：`C:\RPA-Agent\logs\`（worker-gui.log / watchdog.log / console-redirect.log）
- Flow 代码：`C:\RPA-Agent\flows\`；PREFECT_HOME：`C:\RPA-Agent\.prefect`
- SAP GUI 前提：rpacn01 会话内关闭 Scripting 警告（WarnOnAttach/WarnOnConnection=0），
  并把 SAPUILandscape.xml 复制到 %APPDATA%\SAP\Common\（连接列表）

### Windows Worker 部署实例（w01 / w02 / w03）

三台加入同一 `windows-gui-pool` 实现 HA / 负载分担：

| 项目 | w01 | w02 | w03 |
|------|-----|-----|-----|
| IP | `.121` | `.122` | `.123` |
| 安装入口 | `install-lcnnsc-rpa-w01.cmd` | `...w02.cmd` | `...w03.cmd` |
| RPA 用户 | `LECHLER\rpacn01`（三台相同，域账号） | | |

步骤：复制 `3_install-worker-windows/` 到目标机 → 右键管理员运行对应 `.cmd` →
RDP 登录一次 `rpacn01` → Prefect UI → Work Pools → `windows-gui-pool` 确认 Online。

> Deployment 注册到 Server 是全局的，同一 Work Pool 内多台 Worker 自动分担任务；一台停机，其余继续工作。

### SAP 并发控制（重要）

SAP 账号同时只能登录一处 → 用全局并发锁保证 3 台 Worker 上 SAP job 互斥，其它 job 正常并行：

```powershell
# 建锁（一次性）
prefect global-concurrency-limit create sap-gui --limit 1
```

```python
# 所有 SAP job 的 flow 代码里，把 SAP 环节包进锁（约定俗成）
from prefect.concurrency.sync import concurrency
with concurrency("sap-gui", occupy=1):
    ...  # SAP GUI 操作
```

### 日常使用流程

**方式一：网页一键部署（推荐）**

1. 把 job 整目录打成 zip（内容在根层级，不要多包一层目录）
2. RPA 前端 → **Deploy** 页 → 拖入 zip → 填 Job 名称 + 注册脚本相对路径 → 勾选目标池 → 一键分发
3. 每个目标池的 Worker 自动下载解压到 `flows/<Job名>/` 并执行注册（deploy-job 系统 flow）
4. 前端 **Deployments** 页 Trigger 或设定时调度

**方式二：手工部署**

1. **创建/修改 Flow** → 编辑 `C:\RPA-Agent\flows\` 下的 `.py` 文件
2. **注册 Flow** → 运行 flow 文件的 deploy() 或 `must_deploy.py` 同步到 Server
3. **触发执行** → 在 RPA 前端（http://10.86.180.120）点击 "Trigger" 或设置定时调度
4. **查看结果** → 前端 Dashboard / Jobs 页面查看执行状态和日志

### 服务管理命令

```powershell
# Windows Worker 管理（计划任务，非服务）
Get-ScheduledTask PrefectRPAWorker-GUI | Get-ScheduledTaskInfo   # 状态 (267009=运行中)
Start-ScheduledTask PrefectRPAWorker-GUI                          # 启动
Get-Process python | Stop-Process -Force                          # 停止（看门狗 5 分钟内会自动拉起）
Get-Content C:\RPA-Agent\logs\worker-gui.log -Tail 30            # 日志
```

```bash
# Ubuntu Server 服务管理
sudo docker compose -f '/opt/scripts/2_install-worker-server/docker-compose.yml' ps      # 查看容器
sudo docker compose -f '/opt/scripts/2_install-worker-server/docker-compose.yml' restart  # 重启
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
| Deploy | 拖拽上传 job zip → 选目标池 → 一键分发到 Windows/Linux Worker 并自动注册 |

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
├── 1_autoinstall/                     # Ubuntu 无人值守安装
│   ├── Create-CidataISO.ps1
│   ├── meta-data
│   ├── user-data
│   └── verify.sh
│
├── 2_install-worker-server/                  # 服务端安装
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
│   │       ├── views/Deployments.vue
│   │       └── views/Deploy.vue         # 网页上传 job 包 + 一键分发注册
│   └── nginx/
│       └── rpa.conf
│
├── 3_install-worker-windows/          # Windows Worker 安装 (GUI 模式)
│   ├── setup-windows-agent.ps1          # 主安装脚本（3 个计划任务: Worker/Redirect/Watchdog）
│   ├── install-lcnnsc-rpa-w01.cmd      # w01 / w02 / w03 一键安装
│   ├── install-lcnnsc-rpa-w02.cmd
│   ├── install-lcnnsc-rpa-w03.cmd
│   └── flows/
│       ├── deploy_job.py                # 系统 Flow: 网页上传包的落地+注册通道
│       ├── must_deploy.py               # 正式业务 Flow 注册（含 deploy-job）
│       └── requirements.txt
│
├── 4_install-worker-linux/            # Linux Worker 安装
│   ├── setup-linux-agent.sh
│   ├── install-lcnnsc-rpa-l01.sh       # l01 / l02 / l03 一键安装
│   ├── install-lcnnsc-rpa-l02.sh
│   ├── install-lcnnsc-rpa-l03.sh
│   ├── autoinstall/                     # ESXi 无人值守装机（同 1_autoinstall 模式）
│   │   ├── Create-CidataISO.ps1         # -HostName 参数选择主机
│   │   ├── lcnnsc-rpa-l01/              # .126  user-data + meta-data
│   │   ├── lcnnsc-rpa-l02/              # .127
│   │   └── lcnnsc-rpa-l03/              # .128
│   └── flows/
│       ├── web_flow.py
│       ├── python_flow.py
│       ├── deploy_job.py                # 系统 Flow（同 Windows 版）
│       ├── must_deploy.py
│       └── requirements.txt
│
├── 5_try-on/                          # 首次部署验证 + 首个业务 job 迁移
│   ├── test_deploy.py                   # 单文件：hello-flow + 注册
│   ├── test_edge_search.py
│   ├── RPA01_07/                        # 业务 job: SAP 质量图纸下载（Prefect 化迁移中）
│   │   ├── 01_Conf/Config_download.xlsx # 邮箱/SAP 账号配置（密码 base64）
│   │   └── 05_DataJobFile/
│   │       ├── RPACN01_07_downloadfile.py       # 原业务脚本
│   │       ├── RPACN01_07_downloadfile_flow.py  # Prefect flow 包装（含 sap-gui 全局锁）
│   │       └── test_ews.py                      # EWS 邮箱凭据诊断工具
│   └── README.md
│
└── README.md
```
