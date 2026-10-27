# LNSC-DGX · GB10 上运行 Qwen3.8-Flash-Next（含运维包）

DGX Spark（GB10 Grace Blackwell，sm_121 / CUDA 13 / 121.6 GiB 统一内存）上，用 **llama.cpp**
跑 `Qwen3.8-Flash-Next`（**177B 参数 / 103.68 GiB 权重 / 原生 262144 上下文**）的：
最终启动参数、内存预算、**日常巡检 SOP、受控变更框架、监控与故障预案**。

> 所有脚本都是 **Linux(DGX) 侧**用的。从 Windows 拷过去先转行尾并赋权：
> ```bash
> sed -i 's/\r$//' scripts/*.sh && chmod +x scripts/*.sh
> ```

## 🟢 当前状态（2026-10-27 23:10，已解除冻结）

| 项 | 值 |
|---|---|
| 服务 | ✅ `/health` ok，`n_ctx=196608`，pid 58398 |
| 托管 | ✅ **systemd `llama-qwen38`**（`enabled` + `active`），日志进 journal，`MemoryHigh=112G/MemoryMax=116G` |
| 内存 | 🟢 `MemAvailable` 8.5 GiB（cgroup `current` 30.3 GiB / `peak` 40.4 GiB），`SwapFree` 15.3 GiB 几乎未动 |
| 上下文 | 🟢 196608（原生 262144），KV `q8_0/q8_0` ≈ 4.6 GiB |
| 性能 | 🟢 decode **29.7 tok/s**；prefill **1081 tok/s @24k**（`-ub 1024`，2026-10-28 调优后 +15.7%） |
| 可观测 | 🟢 `/metrics` 已开启；`journalctl -u llama-qwen38` 可回溯 |
| 视觉 | ✅ **已启用**（2026-10-27 23:32）：`--mmproj mmproj-F16.gguf`，`vision:true` `video:true`；真图识别验证通过（红图→`Red`），decode 30.08 tok/s |
| ollama | 🟠 `0.0.0.0:11434` + `OLLAMA_KEEP_ALIVE=-1`（待 C4 收敛） |
| 变更 | ✅ 已解冻；剩余队列见 `docs/06-changelog.md` 第四节 |

> 🔴 **一条硬规则**：`-ctk` 与 `-ctv` 必须同型。本 build 只编译了
> `q4_0-q4_0 / q8_0-q8_0 / f16-f16 / bf16-bf16` 四种 FA 组合，
> 用 `-ctk q8_0 -ctv q4_0` 会掉进 "converting K and V to f16 instead (slow)" 的慢路径。

---

## 📚 文档包导航（先读 00）

| 文件 | 什么时候看 |
|---|---|
| [`docs/00-rules.md`](docs/00-rules.md) | **必读**。十条铁律、"不过度"红线、变更准入五问、留痕与回滚规范 |
| [`docs/01-inventory.md`](docs/01-inventory.md) | 变更前核对环境；含实测硬件/模型/服务/参数支持矩阵/内存基线 |
| [`docs/02-runbook.md`](docs/02-runbook.md) | 每日 5 分钟 / 每周 15 分钟巡检；判据阈值表（PASS/WARN/FAIL） |
| [`docs/03-change-plan.md`](docs/03-change-plan.md) | 要动手时看。C1~C5 变更项，每项含前置/命令/验证/回滚/影响 |
| [`docs/04-monitoring.md`](docs/04-monitoring.md) | 装监控（cron + logrotate，可逆）；CSV 字段、阈值、查询 |
| [`docs/05-incident.md`](docs/05-incident.md) | 出事时看。I1~I6 预案：OOM / 上下文超限 / 终端带走进程 / 整机卡死 / ollama / 输出异常 |
| [`docs/06-changelog.md`](docs/06-changelog.md) | 记录模板 + 已发生历史 + 当前风险清单 + 待执行队列 |
| [`docs/health-report-2026-10-27.md`](docs/health-report-2026-10-27.md) | 两次巡检的完整原始报告 |

## 🛠 脚本一览（默认全部只读）

| 脚本 | 作用 | 是否改动系统 |
|---|---|---|
| `scripts/dgx-healthscan.sh` | 一次性体检（系统/GPU/进程/端口/服务/API） | ❌ 只读 |
| `scripts/dgx-snapshot.sh` | 证据快照 → `/var/log/lnsc/snapshots/<ts>/` + tar.gz + sha256 | ❌ 只写日志目录 |
| `scripts/dgx-metrics-collect.sh` | 采一行指标到 `metrics.csv`，超阈值写 `alerts.log` | ❌ 只写日志 |
| `scripts/prompt-size.sh` | 看最近几次请求的 prompt 规模与 prefill 耗时，判断"慢"是客户端 prompt 太大还是服务端变慢 | ❌ 只读 |
| `scripts/dgx-change.sh` | 受控变更：`status` / `plan` / `apply` / `rollback` | ✅ 仅 `apply`/`rollback` |
| `scripts/preflight.sh` | 部署前体检（参数写法、原生上下文） | ❌ 只读 |
| `scripts/start-llama-server.sh` | 手工启动（含防呆，已被 systemd 方案取代） | 启动服务 |
| `systemd/llama-qwen38.service` | 常驻单元模板 | 安装后生效 |
| `systemd/lnsc-logrotate.conf` | 日志轮转（12 周，防止吃满磁盘） | 安装后生效 |

**快速上手**
```bash
bash scripts/dgx-healthscan.sh          # 1. 看现状（只读）
bash scripts/dgx-change.sh status       # 2. 看变更项状态（只读）
bash scripts/dgx-change.sh plan systemd-llama   # 3. 看变更计划（只读）
# 真正执行前，先读 docs/03-change-plan.md 并用 docs/00-rules.md 的五问自检
```

---

## 1. 当前运行方式（systemd 托管）

**日常操作只有这四条：**

```bash
systemctl status llama-qwen38 --no-pager        # 看状态
journalctl -u llama-qwen38 -b -f                # 看实时日志
sudo systemctl restart llama-qwen38             # 重启（约 45~95 秒恢复）
curl -s http://127.0.0.1:8081/health            # 健康检查
```

实际生效的启动命令（写在 `/etc/systemd/system/llama-qwen38.service`，仓库同源）：

```bash
/opt/llama.cpp/build/bin/llama-server \
  -m /models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf \
  --alias qwen3.8-flash-next \
  --mmproj /models/qwen3.8-flash-next/mmproj-F16.gguf \
  -c 196608 \
  -b 2048 -ub 1024 \
  -ngl 999 \
  -fa on \
  -ctk q8_0 -ctv q8_0 \
  --cache-reuse 256 \
  --jinja --metrics \
  --parallel 1 \
  --host 0.0.0.0 --port 8081
```

> 手动启动脚本 `scripts/start-llama-server.sh` 仍保留（应急用），但**平时不要用**，
> 否则会和 systemd 抢 8081，并触发"每 10 秒重读 103.68 GiB"的重启风暴。

### 与最初的错误命令对比

| 项 | 错误写法 | 正确写法 | 原因 |
|---|---|---|---|
| 上下文 | `-c 49152` | `-c 196608` | 49k 请求直接超限报 `exceeds the available context size (49152 tokens)`；196608 < 原生 262144，无需 rope |
| 逻辑批 | `-b 128` | `-b 2048` | 太小，prefill 被卡死 |
| 微批 | `-ub 32` | `-ub 512` | prefill 快 10~20 倍（49k prompt：约 1540 轮 → 约 96 轮） |
| FA | `-fa off` | `-fa on` | 混合注意力（Gated DeltaNet + full attn）关 FA 极慢；且 **KV 量化只支持 FA 路径** |
| KV 量化 | 无 | `-ctk q8_0 -ctv q8_0` | KV 减半；⚠️ **两者必须同型**，混型会掉进 slow path（见上） |
| 权重加载 | 无 | **不要加** `--no-mmap` / `--direct-io` | 本 build 没有这些参数（`invalid argument`） |
| 单卡切分 | `-sm layer` | 删除 | 单 device 下无效 |
| 模板 | 无 | `--jinja` | Qwen 的 chat template / thinking / tool-call 正确解析 |
| slot | 无 | `--parallel 1` | `-c` 会被 slot 均分，显式声明防误加 |
| 托管 | 手动 `&` / pts | `systemd` | 关终端即死；且无 `MemoryMax` 兜底 |

---

## 2. 内存预算（**实测校准版**，121GiB 可见，约 7GiB 被固件占用）

> 下面数字来自 2026-10-27 对 `http://10.86.20.57:8081` 的实测（见 `docs/health-report-2026-10-27.md`），
> 不是估算：`n_params=176.9B`、权重 `meta.size=103.7 GiB`、`n_ctx_train=262144`。

**权重本身就占 103.7 GiB** —— 这是所有内存问题的根源，KV 反而是小头。

| `-c` | KV `q8_0`（≈24 KiB/token） | 权重 | 权重+KV | 剩余给 OS/余量 |
|---|---|---|---|---|
| 49152 | 1.1 GiB | 103.7 GiB | 104.8 GiB | ~16 GiB |
| 98304 | 2.2 GiB | 103.7 GiB | 105.9 GiB | ~15 GiB |
| **131072（当前）** | **3.0 GiB** | 103.7 GiB | 106.7 GiB | ~14 GiB |
| 262144 | 6.0 GiB | 103.7 GiB | 109.7 GiB | ~11 GiB ⚠️ 实测不可取 |

实测状态：`-c 131072` 下 `used≈112 GiB / available≈8.9 GiB / buff-cache≈9.8 GiB`，
与「103.7 权重 + 3 KV + ~5 OS」吻合，**属正常稳态，不是故障**。

### 三条红线（按 177B 模型重新定义）

1. **看 `available` 的"趋势"而不是绝对值** —— 103.7 GiB 模型跑起来后 `available` 稳态只有 8~10 GiB 是正常的；
   真正的红线是**持续下降到 2 GiB 以下**，或 `buff/cache` 被压到接近 0 后仍在读盘。
2. **`Swap used` 不应持续增长** —— GB10 上 swap 抖动 = 整机卡死前兆。
3. **只允许一个 `llama-server` 实例**。判定方法不要再用 `used` 猜，直接看 API：
   ```bash
   curl -s http://127.0.0.1:8081/props | jq '.total_slots, .model_alias'
   curl -s http://127.0.0.1:8081/v1/models | jq '.data[0].meta | {n_params, size, n_ctx, n_ctx_train}'
   ```
   第二个命令返回的 `size` 就是权重体积，用 `used - size` 才是 KV+OS 的真实占用。

---

## 3. 部署流程

```bash
# 0) 拷到 DGX（示例）
scp -r LNSC-DGX/ user@dgx:/opt/LNSC-DGX

# 1) 前置检查（一次性，会告诉你这个 build 支持什么参数、模型原生上下文多少）
cd /opt/LNSC-DGX && ./scripts/preflight.sh

# 2) 手工试跑
sudo ./scripts/start-llama-server.sh

# 3) 另开终端验证
./scripts/healthcheck.sh

# 4) 转成常驻服务
sudo cp systemd/llama-qwen38.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now llama-qwen38
sudo systemctl status llama-qwen38 --no-pager
```

---

## 4. 目录说明

| 路径 | 作用 |
|---|---|
| `scripts/preflight.sh` | 上机前体检：compute_cap、可用内存、重复实例、**本 build 支持的参数写法**、模型原生 `context_length` |
| `scripts/start-llama-server.sh` | 一键启动；**自适应** `-fa` / `--flash-attn` / `--no-mmap` / `--direct-io` 写法差异；带重复实例与内存双重防呆 |
| `scripts/healthcheck.sh` | 验 `n_ctx` / `n_batch` / 内存 / 冒烟对话 |
| `systemd/llama-qwen38.service` | 常驻服务，含 `MemoryMax=100G`（把「整机卡死」降级为「进程被杀」，SSH 永远能进） |
| `docs/troubleshooting.md` | 报错 → 处置对照表 |

---

## 5. 确认进度

### 已由实测确认（2026-10-27）

- [x] 原生上下文 **262144** → `-c 131072` 无需 rope 缩放，无质量风险
- [x] 权重实际体积 **103.7 GiB**（`n_params=176.9B`）→ 内存紧张的原因在权重，不在 KV
- [x] `total_slots=1` → 无重复实例
- [x] `n_ctx=131072` 生效，`-c 49152` 的报错已解决
- [x] 模板/thinking 正常（`generation_prompt = <|im_start|>assistant\n thinking\n`）
- [x] decode 实测 **29.3 tok/s**

### 仍需确认（SSH 第二轮后更新）

- [x] build 版本：`version: 0.7.0-dev (build 0, commit unknown)`，aarch64，GNU 13.3.0
- [x] FA 写法：`-fa, --flash-attn [on|off|auto]` → 现用 `-fa on` **正确**
- [x] `--no-mmap` / `--direct-io`：**本 build 都不存在**（连 `--mmap`/`--mlock` 都没有）→ 此项永久关闭
- [x] `--metrics`：**支持但未开启** → 下次重启加上
- [ ] `n_ubatch` / `KV buffer size` 实际值 —— 启动日志只输出到 `/dev/pts/2` 未落盘，**已不可回查**；迁 systemd 后从 journal 取