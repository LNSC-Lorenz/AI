# Magentic-UI 部署脚本 (Windows)

## 架构概览

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│   Windows 本机           │         │   Dell DGX Spark             │
│                         │         │                              │
│  ┌───────────────────┐  │  HTTP   │  ┌────────────────────────┐  │
│  │  Magentic-UI      │──┼────────►│  │  Ollama (:11434)       │  │
│  │  (localhost:8081)  │  │         │  │  ├─ qwen3              │  │
│  └───────────────────┘  │         │  │  ├─ fara7b             │  │
│  ┌───────────────────┐  │         │  └────────────────────────┘  │
│  │  Docker Desktop   │  │         │                              │
│  │  (WSL2 后端)       │  │         └──────────────────────────────┘
│  └───────────────────┘  │
└─────────────────────────┘
```

## 前提条件

| 组件 | 说明 |
|------|------|
| Dell DGX Spark | 已部署 Ollama，运行 `qwen3` 和 `fara7b` 模型 |
| Ollama 绑定 | DGX Spark 上 Ollama 需绑定 `0.0.0.0`（设置 `OLLAMA_HOST=0.0.0.0`） |
| 网络连通 | Windows 端能访问 DGX Spark 的 11434 端口 |
| Docker Desktop | 已安装并启用 WSL2 后端 |
| WSL2 | 已启用 |

## 快速开始

### 1. 修改配置

编辑 `deploy-magentic-ui.ps1` 顶部的配置区：

```powershell
$OLLAMA_HOST = "http://192.168.1.100:11434"  # 改为 DGX Spark 的实际 IP
$ORCHESTRATOR_MODEL = "qwen3"                 # 编排器模型
$BROWSER_MODEL = "fara7b"                     # 浏览器代理模型
```

### 2. 运行脚本

```powershell
# 以管理员身份打开 PowerShell，执行：
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
.\deploy-magentic-ui.ps1
```

### 3. 访问 UI

浏览器打开 http://localhost:8081

## DGX Spark 端准备

确保 DGX Spark 上 Ollama 已正确配置并可被远程访问：

```bash
# 在 DGX Spark 上执行
# 设置 Ollama 监听所有网络接口
export OLLAMA_HOST=0.0.0.0
ollama serve

# 确认模型已拉取
ollama list
# 应看到 qwen3 和 fara7b
```

## 无 Docker 模式

如不想使用 Docker，修改脚本中：

```powershell
$USE_DOCKER = $false
```

此模式下浏览器代理将在本地运行（无沙箱隔离）。

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| 无法连接 Ollama | 检查 DGX Spark IP、防火墙规则、Ollama 绑定地址 |
| Docker 错误 | 确认 Docker Desktop 已启动，WSL2 集成已启用 |
| Python 版本不对 | 确保 Python >= 3.12，可用 `winget install Python.Python.3.12` |
| 模型响应慢 | 检查 DGX Spark 的 GPU 利用率，确保模型已加载到显存 |
