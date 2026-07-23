# [5] Try-On — 首次部署验证

最简单的 Prefect Flow，用于验证 Server / Worker / UI 整条链路。

## 文件

| 文件 | 说明 |
|------|------|
| `test_deploy.py` | 单文件：hello-flow 定义（主机信息 + 加法）+ 注册到 Server（自动识别 Windows/Linux Work Pool） |
| `test_edge_search.py` | 单文件：浏览器自动化（Playwright 打开 Bing 搜索 lechler + 截图）+ 注册到 Server |

## 前提

- Worker 已通过 `setup-windows-agent.ps1` / `setup-linux-agent.sh` 安装完成
- Prefect UI → Work Pools 中该 Worker 显示 Online

## 使用步骤（以 Windows Worker 为例）

### 1. 复制文件到 Worker 的 flows 目录

```powershell
# 假设 [5] try-on 已复制到 C:\Temp\try-on，按实际路径调整
Copy-Item C:\Temp\try-on\test_deploy.py -Destination C:\RPA-Agent\flows\
```

### 2. 注册到 Server

**必须在 `C:\RPA-Agent\flows` 目录下运行**：

```powershell
cd C:\RPA-Agent\flows
C:\RPA-Agent\.venv\Scripts\python.exe test_deploy.py
```

成功输出：

```
Deployed: hello-flow/hello
Work pool: windows-rpa-pool
Code path: C:\RPA-Agent\flows
```

Linux Worker 同理，路径换成 `/opt/rpa-agent/flows/` 和 `/opt/rpa-agent/.venv/bin/python`。

### 3. 触发运行

- Prefect UI: http://10.86.180.120:4200 → **Deployments** → `hello-flow/hello` → **Run**
- 或 RPA 前端: http://10.86.180.120 → **Deployments** → **Trigger**

### 4. 验证结果

- **Flow Runs** 页面看到状态变为 `Completed`
- 日志中显示 Worker 主机名，如 `Hello from LCNNSC-RPA-W01 (Windows), 1 + 2 = 3`
- **Worker 本机证据文件**（每次运行追加一行，确认任务真的在 Windows 端落地执行了）：

```powershell
Get-Content C:\Temp\hello-flow-proof.txt
# [2026-07-23 14:30:00] hello-flow ran on lcnnsc-rpa-w01 (Windows), result = 3
```

Linux Worker 对应 `/tmp/hello-flow-proof.txt`。

## 浏览器自动化测试（test_edge_search.py）

验证 Playwright + Edge 能否在 Worker 上跑通（步骤同上，换个文件名）：

```powershell
Copy-Item C:\Temp\try-on\test_edge_search.py -Destination C:\RPA-Agent\flows\
cd C:\RPA-Agent\flows
C:\RPA-Agent\.venv\Scripts\python.exe test_edge_search.py
```

UI 触发 `edge-search-flow/edge-search` → Run 后验证：

```powershell
# 截图（搜索结果页面）
Invoke-Item C:\Temp\edge-search-lechler.png
# 执行记录
Get-Content C:\Temp\edge-search-proof.txt
```

注意：

- Worker 作为 Windows 服务运行在非交互会话，**桌面上看不到浏览器窗口**，以截图为准
- 优先使用系统自带 Edge，但 Edge 无法在 LocalSystem 服务账户下运行，会自动回退 Playwright 自带 Chromium（同为 Chromium 内核，效果一致）
- 搜索引擎用 `cn.bing.com`（Google 对无头浏览器弹人机验证页且国内不可访问）

链路打通后，编写正式业务 Flow 并在 `must_deploy.py`（`[3]`/`[4]` flows 目录下）中注册。
