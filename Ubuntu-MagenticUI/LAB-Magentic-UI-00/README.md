# Ubuntu 24.04 LTS 全功能 Magentic-UI 0.1.6 部署方案（LAB-Magentic-UI-00）

## 概述

本方案参考 `LAB-Magentic-UI-01/02/03` 的部署经验，升级到 **Magentic-UI 0.1.6** 完整版本，
完整实现 Microsoft Research 博客中描述的四大核心能力：

- **Co-Planning（协同规划）**：生成步骤计划并由用户编辑、确认后再执行。
- **Co-Tasking（协同执行）**：执行过程中实时展示动作与观察，用户可随时暂停、介入或接管浏览器。
- **Action Guards（动作护栏）**：对不可逆或敏感动作（点击、提交、写入、执行等）请求用户批准。
- **Plan Learning（计划学习）**：成功任务自动保存计划到记忆，后续可自动检索并复用。

同时启用完整的 5 智能体团队：
`Orchestrator` + `WebSurfer` + `Coder` + `FileSurfer` + `ActionGuard`。

## 架构概览

```
┌────────────────────────────────────────────┐         ┌──────────────────────────────┐
│   Ubuntu Server (ESXi VM / 物理机)         │         │   Ollama 推理节点            │
│   LAB-Magentic-UI-00                       │  HTTP   │   10.87.5.55:11434           │
│                                            │────────►│                              │
│  ┌────────────────────────────────────┐    │         │  ┌────────────────────────┐  │
│  │  nginx (:8081)                     │    │         │  │  qwen3:32b (编排器)    │  │
│  │   └► Magentic-UI 0.1.6 (:8082)    │    │         │  │  qwen2.5vl-fast (视觉) │  │
│  │       ├─ Orchestrator              │    │         │  └────────────────────────┘  │
│  │       ├─ WebSurfer (浏览器沙箱)     │    │         └──────────────────────────────┘
│  │       ├─ Coder (Docker 代码执行)    │    │
│  │       ├─ FileSurfer (文件操作)      │    │
│  │       └─ ActionGuard (动作护栏)     │    │
│  └────────────────────────────────────┘    │
│  ┌────────────────────────────────────┐    │
│  │  OpenAI→Ollama Bridge v3 (:11440)  │    │
│  │  - 连接池 / 截图压缩 / 历史截断     │    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

## 与 LAB-01/02/03 的区别

| 维度 | LAB-01/02/03 | **LAB-00** |
|------|--------------|-----------|
| 软件版本 | `magentic_ui >= 0.2.0` (MagenticLite) | `magentic_ui[ollama] == 0.1.6` (完整 Magentic-UI) |
| 智能体数量 | 2（编排 + 浏览器） | 5（编排/浏览器/编码/文件/护栏） |
| 协同规划 | 无/有限 | 启用 `cooperative_planning` |
| 计划学习 | 无 | 启用 `retrieve_relevant_plans: reuse` |
| 动作护栏 | 基础 | 启用 `approval_policy: auto-conservative` |
| 浏览器沙箱 | Quicksand / Playwright | Quicksand VM (Docker) |

## 文件说明

| 文件 | 说明 |
|------|------|
| `README.md` | 本说明文档 |
| `deploy-magentic-ui-00.sh` | 一键部署脚本（非 root 用户运行） |
| `bridge-v3.py` | OpenAI 兼容桥接服务（图片压缩、历史截断） |
| `config.yaml` | 0.1.6 全功能配置模板（已映射到 Ollama） |
| `autoinstall/user-data` | Ubuntu 24.04 Autoinstall 主配置 |
| `autoinstall/meta-data` | cloud-init 元数据 |
| `autoinstall/Create-CidataISO.ps1` | Windows 下生成 cidata ISO |
| `autoinstall/verify.sh` | 安装后验证脚本 |

## Ubuntu Autoinstall 自动安装

本方案提供完整的 `autoinstall` 配置，可在 ESXi 上实现 Ubuntu 24.04 无人值守安装。

### 推荐配置

| 项目 | 值 |
|------|------|
| 主机名 | `LAB-Magentic-UI-00` |
| 静态 IP | `10.87.5.180/24` |
| 网关 | `10.87.5.1` |
| DNS | `10.87.5.11`, `10.87.5.12` |
| 网卡 | `ens192`（VMXNET3） |
| 系统盘 | `/dev/sda`，LVM 分区（/、/var、/tmp、/home） |
| 管理员 | `magentic` / `ChangeMe2026!@#` |
| 预装 | Docker、Python 3.12、uv、nginx、KVM、build-essential、Pillow 依赖 |

### ESXi 虚拟机硬件要求

| 资源 | 推荐 | 说明 |
|------|------|------|
| CPU | 8 vCPU | 最低 4；必须开启嵌套虚拟化 |
| 内存 | 16 GB | 最低 8 GB |
| 系统盘 | 100 GB | 厚置备延迟置零，SCSI 0:0 |
| 网卡 | VMXNET3 | 对应 `ens192` |
| 引导固件 | EFI | 需挂载 ubuntu-24.04-live-server-amd64.iso + cidata.iso |

### 制作 cidata ISO

在 Windows PowerShell（管理员）中：

```powershell
cd ..\Ubuntu-MagenticUI\LAB-Magentic-UI-00\autoinstall
.\Create-CidataISO.ps1
```

输出 `cidata00.iso`，卷标为 `cidata`。

### 安装流程

1. ESXi 新建虚拟机，CPU 勾选 **向客户操作系统公开硬件辅助的虚拟化**。
2. CD/DVD 1 挂载 `ubuntu-24.04-live-server-amd64.iso`。
3. CD/DVD 2 挂载 `cidata00.iso`。
4. 启动后自动完成分区、网络、用户、Docker、Python、uv 等安装并重启。
5. 重启后 SSH 登录，运行验证：

```bash
sudo bash /home/magentic/LAB-Magentic-UI-00/autoinstall/verify.sh
```

6. 再执行 Magentic-UI 部署脚本：

```bash
cd ~/LAB-Magentic-UI-00
bash deploy-magentic-ui-00.sh
```

## 前置条件

1. Ubuntu 24.04 LTS 已安装并启用 Docker、KVM（嵌套虚拟化）。
2. Ollama 节点（如 `10.87.5.55:11434`）已拉取 `qwen3:32b` 与 `qwen2.5vl-fast`。
3. 网络可达 Ollama，且模型 `KEEP_ALIVE=-1` 已建议配置。

## 部署步骤

1. 将本目录上传到目标服务器的 `magentic` 用户目录：

```bash
scp -r LAB-Magentic-UI-00 magentic@<服务器IP>:~
```

2. SSH 登录并执行部署：

```bash
ssh magentic@<服务器IP>
cd ~/LAB-Magentic-UI-00
bash deploy-magentic-ui-00.sh
```

3. 部署完成后访问：

```
http://<服务器IP>:8081
```

## 默认配置

- 主机名：`LAB-Magentic-UI-00`
- Web UI 端口：`8081`（nginx 反向代理）
- 后端端口：`8082`
- Ollama 桥接端口：`11440`
- 模型：
  - `qwen3:32b` → Orchestrator / Coder / FileSurfer / ActionGuard
  - `qwen2.5vl-fast` → WebSurfer

## 安全与运维

- 部署脚本会检测 `/dev/kvm`，缺失时提示开启嵌套虚拟化。
- 首次启动 Docker 镜像下载约需 5–10 分钟，请耐心等待。
- 查看服务日志：

```bash
sudo journalctl -u magentic-ui-00 -f
sudo journalctl -u ollama-openai-bridge-00 -f
```

## 参考

- [Magentic-UI 0.1 发布说明](https://github.com/microsoft/magentic-ui/releases)
- [Magentic-UI Research Blog](https://www.microsoft.com/en-us/research/blog/magentic-ui-an-experimental-human-centered-web-agent/)
