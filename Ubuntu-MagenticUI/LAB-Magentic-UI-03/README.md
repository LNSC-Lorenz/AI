# Ubuntu 24.04 LTS Autoinstall 在 ESXi 上的无人值守部署 (Magentic-UI LAB-03)

## 概述

基于 LAB-01 方案（Magentic-UI + Quicksand 沙箱），针对 LAB-01 和 LAB-02 的实施经验进行了全面性能优化。

**核心改进方向**：
- **VM 加载更快**：autoinstall 阶段预装 nginx、uv、Magentic-UI venv、Quicksand 包
- **模型响应更快**：桥接层 v2 引入连接池、截图压缩、激进历史截断、生成长度限制
- **首次启动更快**：模型预热 + 幂等部署脚本（已安装的组件自动跳过）

**参考文档**：
- [Magentic-UI README](https://github.com/microsoft/magentic-ui/blob/main/README.md)
- [Magentic-UI Research Blog](https://www.microsoft.com/en-us/research/blog/magentic-ui-an-experimental-human-centered-web-agent/)
- [Configuration Guide](https://github.com/microsoft/magentic-ui/blob/main/docs/configuration.md)
- [Troubleshooting](https://github.com/microsoft/magentic-ui/blob/main/docs/troubleshooting.md)

## 与 LAB-01 / LAB-02 的对比

| 维度 | LAB-01 | LAB-02 | **LAB-03** |
|------|--------|--------|-----------|
| 浏览器方案 | Quicksand VM (KVM) | Playwright 直接控制 | **Quicksand VM (KVM)** |
| 桥接层 | v1 (每请求新连接) | 无桥接 | **v2 (连接池 + 图片压缩)** |
| 截图处理 | 仅剥离旧图 | 仅保留当前页 | **压缩降分辨率 1280x720 + 剥离旧图** |
| 历史截断 | 仅剥离旧截图 | 无 | **system + 最近 6 条 + 最新截图** |
| num_predict | 无限制 | 无限制 | **编排器 2048 / 浏览器 1024** |
| autoinstall 预装 | Docker + Python + KVM | Docker + Python | **+ nginx + uv + venv + Quicksand + Pillow** |
| 部署脚本 | 全量安装 | 全量安装 | **幂等检测，已安装自动跳过** |
| 温度参数 | 0.7 / 0.7 | 0.7 / 0.7 | **0.3 / 0.1 (更确定性)** |
| 请求计时 | 无 | 无 | **有 (elapsed + t/s)** |

## 架构概览

```
┌────────────────────────────────────┐         ┌──────────────────────────────┐
│   Ubuntu Server (ESXi VM)          │         │   Dell DGX Spark             │
│   LAB-Magentic-UI-03               │  HTTP   │   10.87.5.55                 │
│                                    │────────►│                              │
│  ┌──────────────────────────────┐  │         │  ┌────────────────────────┐  │
│  │  nginx (:8081)               │  │         │  │  Ollama (:11434)       │  │
│  │   └► Magentic-UI (:8082)    │  │         │  │  ├─ qwen3:32b (32B)    │  │
│  │       └► Quicksand VM (KVM) │  │         │  │  ├─ qwen2.5vl-fast (8B)│  │
│  └──────────────────────────────┘  │         │  │  KEEP_ALIVE=-1         │  │
│  ┌──────────────────────────────┐  │         │  └────────────────────────┘  │
│  │  Bridge v2 (:11440)          │  │         │                              │
│  │  ├─ 连接池 (persistent)      │  │         └──────────────────────────────┘
│  │  ├─ 截图压缩 (1280x720 q60)  │  │
│  │  ├─ 历史截断 (last 6 msgs)   │  │
│  │  └─ num_predict 限制         │  │
│  └──────────────────────────────┘  │
│  ┌──────────────────────────────┐  │
│  │  Docker + UFW + Fail2ban     │  │
│  └──────────────────────────────┘  │
└────────────────────────────────────┘
```

## 性能优化详解

### 1. 桥接层 v2 — 连接池

LAB-01 的桥接层每个请求都创建新的 `httpx.AsyncClient`，涉及 TCP 握手和连接建立开销。v2 使用全局持久化客户端：

```python
_http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(600.0, connect=10.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
)
```

**效果**：每次请求节省 ~50-100ms 连接开销，对短推理（2-3s）占比显著。

### 2. 桥接层 v2 — 截图压缩降分辨率

LAB-01 仅剥离旧截图，但保留的截图仍以原始分辨率（通常 1920x1080 PNG）发送给 Ollama，产生 ~4900 vision tokens。

v2 使用 Pillow 将截图压缩为 1280x720 JPEG q60：

```python
img = img.resize((1280, 720), Image.LANCZOS)
img.save(out_buf, format="JPEG", quality=60, optimize=True)
```

**效果**：
- 原始 1920x1080 PNG (~2MB) → 1280x720 JPEG q60 (~80KB)
- Vision tokens: ~4900 → ~1600（减少 ~67%）
- 视觉编码时间: ~60s → ~20s（估算）

### 3. 桥接层 v2 — 激进历史截断

LAB-01 仅剥离旧截图但保留所有文本消息。长对话（20+ 轮）会导致 prompt 膨胀，推理变慢。

v2 保留 `system 消息 + 最近 6 条非系统消息 + 最新截图`：

```python
system_msgs = [m for m in messages if m.get("role") == "system"]
non_system = [m for m in messages if m.get("role") != "system"]
kept = non_system[-MAX_HISTORY_MESSAGES:]  # last 6
```

**效果**：prompt token 数从可能的 10k+ 降至 ~3k，推理时间线性减少。

### 4. 桥接层 v2 — 生成长度限制

防止模型生成过长输出导致超时。桥接层在 proxy 路径注入 `max_tokens`
（Ollama OpenAI 兼容层映射为 `num_predict`）：

| 模型 | max_tokens |
|------|-----------|
| qwen3:32b (编排器) | 2048 |
| qwen2.5vl-fast (浏览器) | 1024 |

> 注意：上下文长度 (`num_ctx`) 无法通过 `/v1/chat/completions` 传递，
> 必须在 DGX Spark 服务端设置 `OLLAMA_CONTEXT_LENGTH=8192`（见下方 DGX 配置）。

### 5. Autoinstall 预装

LAB-01 在 deploy 阶段才安装 nginx、uv、Magentic-UI、Quicksand 包，耗时 ~8 分钟。

LAB-03 在 autoinstall 的 `late-commands` 阶段预装：
- nginx（反向代理）
- uv（Python 包管理器）
- Python venv + Magentic-UI + Quicksand 包
- Pillow（图片压缩依赖）
- build-essential + libjpeg-dev + zlib1g-dev

**效果**：deploy 脚本执行时间从 ~15 分钟降至 ~5 分钟（主要是模型预热时间）。

### 6. 幂等部署脚本

deploy 脚本对每一步都做存在性检查：
- `pip show magentic_ui` → 已安装则跳过
- `pip show quicksand-cua` → 已安装则跳过
- `command -v nginx` → 已安装则跳过
- `.venv/bin/activate` → 已存在则跳过

**效果**：重复运行 deploy 脚本不会重复安装，仅更新配置和重启服务。

### 7. 温度参数优化

| 角色 | LAB-01 | LAB-03 | 原因 |
|------|--------|--------|------|
| 编排器 | 0.7 | **0.3** | 规划需要确定性，减少随机性 |
| 浏览器 | 0.7 | **0.1** | 动作选择需要高度确定性 |

## 文件说明

| 文件 | 说明 |
|------|------|
| `autoinstall/user-data` | Autoinstall 主配置，预装 nginx/uv/venv/Quicksand |
| `autoinstall/meta-data` | cloud-init 元数据 |
| `autoinstall/Create-CidataISO.ps1` | Windows PowerShell 脚本，自动创建 cidata ISO |
| `autoinstall/verify.sh` | 安装后验证脚本（11 项检查） |
| `harden-ubuntu.sh` | Ubuntu CIS 安全加固脚本（15 步加固） |
| `deploy-magentic-ui.sh` | Magentic-UI 部署脚本（桥接 v2 + 幂等） |

---

## 当前配置参数

| 项目 | 值 |
|------|------|
| 主机名 | `LAB-Magentic-UI-03` |
| IP 地址 | `10.87.5.183/24`（静态） |
| 网关 | `10.87.5.1` |
| DNS | `10.87.5.11`, `10.87.5.12` |
| 网卡 | `ens192`（ESXi VMXNET3） |
| 系统盘 | `/dev/sda`，LVM 分区（/、/var、/tmp、/home） |
| 管理员 | `magentic` / `ChangeMe2026!@#` |
| Docker | autoinstall 阶段自动安装 |
| Python | 3.12（autoinstall 阶段自动安装） |
| nginx | autoinstall 阶段预装 |
| uv | autoinstall 阶段预装 |
| Magentic-UI venv | autoinstall 阶段预创建 |
| Quicksand 包 | autoinstall 阶段预下载 |

---

## ESXi 虚拟机资源分配

### 新建虚拟机设置

| 项目 | 值 |
|------|------|
| 虚拟机名称 | `LAB-Magentic-UI-03` |
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

```powershell
cd c:\Users\zhlo\Documents\GIT\AI\Ubuntu-MagenticUI\LAB-Magentic-UI-03\autoinstall
.\Create-CidataISO.ps1
```

### 2. ESXi 新建虚拟机

1. vSphere Client → **新建虚拟机**
2. 按上方"硬件配置"表分配资源
3. **CPU → 勾选"向客户操作系统公开硬件辅助的虚拟化"** ⚠️ **必须开启！**
4. **CD/DVD 驱动器 1**：挂载 `ubuntu-24.04-live-server-amd64.iso`
5. **CD/DVD 驱动器 2**：挂载 `cidata03.iso`（上传到数据存储）
6. 启动顺序确认 CD/DVD 在硬盘之前
7. 启动虚拟机 → 安装**全自动进行**，约 15~25 分钟后自动重启

> **⚠️ 关键：** 必须开启嵌套虚拟化，否则 Quicksand 沙箱使用 TCG 纯软件模拟，性能极差。

> **注意：** autoinstall 阶段会预装 Magentic-UI venv 和 Quicksand 包，安装时间比 LAB-01 长约 5-10 分钟，但节省了 deploy 阶段的时间。

### 3. 安装完成后登录

```bash
ssh magentic@10.87.5.183
# 密码: ChangeMe2026!@#
```

### 4. 执行安全加固

```bash
scp harden-ubuntu.sh deploy-magentic-ui.sh magentic@10.87.5.183:~/
sudo bash harden-ubuntu.sh
cat /var/log/cis-hardening-report.txt
sudo reboot
```

### 5. 部署 Magentic-UI

```bash
ssh magentic@10.87.5.183
bash deploy-magentic-ui.sh
```

### 6. 访问

- **Web UI**: `http://10.87.5.183:8081`
- **SSH**: `ssh magentic@10.87.5.183`

---

## 性能预期

| 指标 | LAB-01 | **LAB-03 (预期)** | 改善 |
|------|--------|-------------------|------|
| deploy 脚本耗时 | ~15 min | **~5 min** | autoinstall 预装 |
| 编排器推理 | 2-3s | **2-3s** | 模型本身不变 |
| 浏览器视觉编码 | ~60s/图 | **~20s/图** | 截图压缩 67% |
| 长对话推理 | 10-30s | **3-8s** | 历史截断 |
| 完整浏览器任务 | 5-6 min | **2-3 min** | 综合优化 |
| 首次 Quicksand 启动 | 5-30 min | **5-30 min** | 包已预装但 VM 镜像仍需下载 |

---

## 安全加固清单

`harden-ubuntu.sh` 执行以下 15 步 CIS 加固（与 LAB-01 相同）：

- **Step 1-15**: Ubuntu Pro 检查、系统更新、CIS 密码策略、SSH 加固、审计日志、文件权限、UFW 防火墙、Fail2ban、内核优化、系统限制、Swap、日志轮转、禁用不必要服务、Docker 安全、CIS 合规报告

---

## ⚠️ 模型策略（锁定，不可更改）

> **规则**：本项目固定使用以下 2 个模型，**不测试、不切换、不推荐其他模型**。

| 角色 | 模型名 | 说明 |
|---|---|---|
| **编排器** | `qwen3:32b` | 任务规划 + tool calling，无 PARSER bug |
| **浏览器代理** | `qwen2.5vl-fast` | 视觉模型，处理截图，num_ctx=16384 |

仅此 2 个模型。不接受替代方案。

---

## DGX Spark 端准备

### 1. 配置 Ollama 远程访问和性能优化

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf > /dev/null << 'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0"
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_MAX_LOADED_MODELS=3"
Environment="OLLAMA_CONTEXT_LENGTH=8192"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KV_CACHE_TYPE=q8_0"
EOF

sudo systemctl daemon-reload
sudo systemctl restart ollama
```

> **⚠️ `OLLAMA_CONTEXT_LENGTH=8192` 是关键性能参数！**
> Ollama 的 `/v1/chat/completions` OpenAI 兼容端点**不支持** `options`/`num_ctx` 传参，
> 编排器 qwen3:32b 走该端点时只能使用服务器默认上下文长度。若不设置此参数，
> 模型可能以默认大上下文（40k+）运行，KV cache 巨大导致推理极慢。
> `qwen2.5vl-fast` 的 Modelfile 中 `PARAMETER num_ctx 16384` 优先级更高，不受此影响。
>
> **其他两个参数**：
> - `OLLAMA_FLASH_ATTENTION=1`：启用 Flash Attention，长 prompt 处理提速 ~20-30%
> - `OLLAMA_KV_CACHE_TYPE=q8_0`：KV cache 8-bit 量化，显存占用减半，可加载更大上下文

### 2. 拉取和创建模型

```bash
ollama pull qwen3:32b
ollama pull qwen2.5vl

cat > /tmp/Modelfile.fast << 'EOF'
FROM qwen2.5vl:latest
PARAMETER num_ctx 16384
PARAMETER temperature 0.0001
EOF
ollama create qwen2.5vl-fast -f /tmp/Modelfile.fast

ollama list
# qwen3:32b, qwen2.5vl:latest, qwen2.5vl-fast
```

### 3. 验证

```bash
curl http://10.87.5.55:11434/api/tags
ollama show qwen3:32b --modelfile | grep -i parser  # 应无输出
ollama show qwen2.5vl-fast --verbose 2>&1 | grep -A2 "Capabilities"  # completion, vision
```

---

## Magentic-UI 配置

`deploy-magentic-ui.sh` 自动生成 `config.yaml`：

```yaml
model_client_configs:
  orchestrator:
    provider: OpenAIChatCompletionClient
    config:
      model: qwen3:32b
      base_url: http://127.0.0.1:11440/v1
      api_key: "ollama"
      temperature: 0.3        # LAB-03: 更确定性
      timeout: 600
      max_retries: 10
      model_info:
        vision: false
        function_calling: true
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

  web_surfer:
    provider: OpenAIChatCompletionClient
    config:
      model: qwen2.5vl-fast
      base_url: http://127.0.0.1:11440/v1
      api_key: "ollama"
      temperature: 0.1        # LAB-03: 高度确定性
      timeout: 600
      max_retries: 10
      model_info:
        vision: true
        function_calling: true
        json_output: true
        family: unknown
        structured_output: false
        multiple_system_messages: false

sandbox:
  type: quicksand

agent_mode: all
```

---

## 桥接层 v2 日志解读

```bash
sudo journalctl -u ollama-openai-bridge -f
```

典型日志输出：
```
[proxy] model=qwen2.5vl-fast msgs=5
  [truncate] 12 -> 7 messages
  [img] 1920x1080 2048KB -> 78KB
[proxy] model=qwen2.5vl-fast status=200 elapsed=18.3s
  [proxy] tokens: prompt=2100 completion=156
```

- `msgs=N`: 截断后的消息数
- `[truncate] X -> Y`: 历史截断前后的消息数
- `[img] WxH origKB -> newKB`: 图片压缩前后大小
- `elapsed=Xs`: 请求总耗时
- `tokens: prompt=N completion=N`: Ollama 返回的 token 用量

---

## 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 进入交互安装界面 | cidata ISO 卷标错误 | 确认 ISO 卷标为 `cidata`，检查 CD/DVD 2 挂载 |
| 网卡名不是 `ens192` | 网卡类型非 VMXNET3 | `match: {name: "en*"}` 通配已配置 |
| SSH 连不上 | IP 未生效或防火墙 | ESXi 控制台：`ip addr show ens192` |
| 安装后无法引导 | 引导固件设置错误 | 确认虚拟机固件为 **EFI** |
| `QEMU is using TCG` 警告 | ESXi 未开启嵌套虚拟化 | vSphere → CPU → 勾选"向客户操作系统公开硬件辅助的虚拟化" |
| `/dev/kvm` 不存在 | KVM 内核模块未加载 | `sudo modprobe kvm kvm_intel`，确认 ESXi 嵌套虚拟化已开启 |
| `Chat completion failed after N attempts` | Ollama 推理超时 | 1) 确认 KVM 2) 检查 `journalctl -u ollama-openai-bridge -f` 看耗时 3) 确认模型已加载 `ollama ps` |
| 浏览器报错 `'arguments'. Retrying...` | 视觉模型输出裸 JSON 动作，parser 未归一化为 `{"name","arguments"}` 格式 | 重新上传并运行最新 `deploy-magentic-ui.sh`（parser v2 补丁），然后 `sudo systemctl restart magentic-ui` |
| `Page.screenshot: Timeout 15000ms` | 通常是前一错误重试时页面忙碌的次生现象 | 先修复上一行错误；若独立出现，检查 `/dev/kvm` 和 VM CPU 负载 |
| 桥接日志显示 `[img] downscale failed` | Pillow 未安装 | `$PROJECT_DIR/.venv/bin/pip install Pillow` |
| deploy 脚本很快完成但 Magentic-UI 启动慢 | Quicksand VM 首次下载镜像 | 正常现象，首次启动 5-30 分钟 |
| 浏览器动作太慢 | 截图仍然很大 | 检查桥接日志 `[img]` 行确认压缩生效 |
| Magentic-UI `Bad Host header` | nginx 未正确配置 | `sudo nginx -t`，检查 `/etc/nginx/sites-enabled/` |

---

## 自定义配置

### 修改密码

```bash
openssl passwd -6 'YourNewPassword'
```

替换 `autoinstall/user-data` 中 `password:` 字段。

### 修改 IP 地址

编辑 `autoinstall/user-data` 中 `addresses: [10.87.5.183/24]`。

### 调整桥接参数

编辑 `deploy-magentic-ui.sh` 中的桥接代码或直接编辑服务器上的 `$PROJECT_DIR/bridge/bridge.py`：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_HISTORY_MESSAGES` | 6 | 保留的非系统消息数 |
| `MAX_IMAGE_WIDTH` | 1280 | 截图最大宽度 |
| `MAX_IMAGE_HEIGHT` | 720 | 截图最大高度 |
| `JPEG_QUALITY` | 60 | JPEG 压缩质量 |
| `NUM_PREDICT_LIMITS` | 2048/1024 | 各模型最大生成 token 数 |

修改后重启桥接：`sudo systemctl restart ollama-openai-bridge`
