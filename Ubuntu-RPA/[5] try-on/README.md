# [5] Try-On — 首次部署验证

最简单的 Prefect Flow，用于验证 Server / Worker / UI 整条链路。

## 文件

| 文件 | 说明 |
|------|------|
| `hello_flow.py` | 简单 Flow：输出主机信息 + 加法计算 |
| `deploy_hello.py` | 注册到 Prefect Server（自动识别 Windows/Linux Work Pool） |

## 使用步骤

### 1. 复制到 Worker 机器

```
Windows: C:\RPA-Agent\flows\
Linux:   /opt/rpa-agent/flows/
```

### 2. 本地测试（可选，不经过 Server）

```powershell
# Windows
C:\RPA-Agent\.venv\Scripts\python.exe hello_flow.py
```

```bash
# Linux
/opt/rpa-agent/.venv/bin/python hello_flow.py
```

### 3. 注册到 Server

```powershell
# Windows
C:\RPA-Agent\.venv\Scripts\python.exe deploy_hello.py
```

```bash
# Linux
/opt/rpa-agent/.venv/bin/python deploy_hello.py
```

### 4. 触发运行

- Prefect UI: http://10.86.180.120:4200 → **Deployments** → `hello-flow/hello` → **Run**
- 或 RPA 前端: http://10.86.180.120 → **Deployments** → **Trigger**

### 5. 验证结果

- **Flow Runs** 页面看到状态变为 `Completed`
- 日志中显示 Worker 主机名，如 `Hello from LCNNSC-RPA-W01 (Windows), 1 + 2 = 3`

链路打通后，即可部署正式的业务 Flow（`[3]`/`[4]` 目录下的 web/sap/etl flows）。
