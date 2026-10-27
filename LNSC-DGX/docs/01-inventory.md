# 01 · 资产与环境清单（Inventory）

> 采集时间：2026-10-27 21:35 / 21:52（`scripts/dgx-healthscan.sh` + `scripts/dgx-snapshot.sh`）
> 变更前先核对本文件；与本文件不符说明环境已漂移，需重新采集。

---

## 一、硬件与系统

| 项 | 值 |
|---|---|
| 主机名 | `DGX01-2512` |
| 机型 | DGX Spark（GB10 Grace Blackwell Superchip） |
| 架构 | `aarch64`，20 核 |
| 内存 | **统一内存 121.63 GiB**（`MemTotal=127,535,256 kB`；约 7 GiB 被固件/GPU 预留） |
| Swap | `/swap.img` 16 GiB（`swappiness=60`） |
| 磁盘 | `/dev/nvme0n1p2` 1.9T，已用 376G，可用 **1.4T (22%)** |
| OS | Ubuntu 24.04.4 LTS，kernel `6.17.0-1021-nvidia` |
| 运行时长 | up 4 days 7:39（采集时） |

## 二、GPU

| 项 | 值 |
|---|---|
| 型号 | **NVIDIA GB10** |
| compute capability | **12.1（sm_121）** ← 所有二进制必须按此编译 |
| 驱动 | 595.71.05 |
| 空闲状态 | 41~42 °C，10.7 W，`clocks.sm 2411 / 3003 MHz`，util 0% |
| `memory.total` / `memory.used` | **`[N/A]`（统一内存，正常）** —— 用 `/proc/meminfo` 或 `--query-compute-apps` 代替 |

## 三、模型

| 项 | 值 |
|---|---|
| 名称 / alias | `Qwen3.8-Flash-Next` / `qwen3.8-flash-next` |
| 路径 | `/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf` |
| 量化 | 文件名 UD-Q4_K_XL，GGUF 内记录 `Q4_K - Medium` |
| **参数量** | **176,943,899,520（177 B）** |
| **权重体积** | **111,323,630,080 B = 103.68 GiB** |
| `n_ctx_train` | **262144**（原生满血；`-c` 未超此值则**不需要 rope 缩放**） |
| `n_embd` / `n_vocab` | 2560 / 248320 |
| 模态 | text-only |
| 分片校验 | 4 片合计 **111.33 GB**，与 `meta.size` 一致 ✅ |

| 分片 | 大小 |
|---|---|
| `-00001-of-00004` | 10.9 MB |
| `-00002-of-00004` | 46.44 GiB |
| `-00003-of-00004` | 45.99 GiB |
| `-00004-of-00004` | 11.26 GiB |

## 四、推理服务（llama.cpp）

| 项 | 值 |
|---|---|
| 二进制 | `/opt/llama.cpp/build/bin/llama-server` |
| 版本 | `0.7.0-dev (build 0, commit unknown)`，GNU 13.3.0，aarch64 |
| 托管方式 | ❌ **无 systemd，手工 `sudo` 启动**；`fd/1 → /dev/pts/2` |
| PID | 52520（采集时，elapsed 约 35 分钟） |
| 当前参数 | `-c 131072 -b 2048 -ub 512 -ngl 999 -fa on -ctk q8_0 -ctv q8_0 --jinja --parallel 1 --host 0.0.0.0 --port 8081` |
| API | `http://10.86.20.57:8081`（`/health` `/props` `/slots` `/v1/*`；`/metrics` 未启用） |
| 实测吞吐 | decode **29.3 tok/s**（34.12 ms/token） |

### 参数支持矩阵（`--help` 实测）

| 参数 | 支持 | 备注 |
|---|---|---|
| `-fa, --flash-attn [on\|off\|auto]` | ✅ | 现用 `-fa on` |
| `--metrics` | ✅ | **未开启** |
| `--no-mmap` / `--direct-io` / `--mmap` / `--mlock` | ❌ | **本 build 全部没有，不要再试** |

## 五、同机其它服务（内存竞争者）

| 服务 | 状态 | 端口 | 备注 |
|---|---|---|---|
| `openwebui.service` | active | 3000 | RSS ~30 MB |
| `ollama.service` | **active** | **11434** | RSS ~36 MB，模型未加载 |
| `docker.service` | active | — | 无容器 |
| `vllm.service` | inactive (dead) | — | 曾用于 Qwen3.6-35B-A3B-FP8，端口 8000 |

### ⚠️ ollama 的现有 drop-in（`/etc/systemd/system/ollama.service.d/override.conf`）

```ini
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"     ← 全网暴露
Environment="OLLAMA_KEEP_ALIVE=-1"          ← 模型永不卸载
Environment="OLLAMA_NUM_PARALLEL=4"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
```

`ollama list`：`qwen3.8:27b`（17 GB）、`qwen3-coder:30b`（18 GB）。

> 在 `MemAvailable≈0.4 GiB` 的现状下，这台机器**等于只要有人 `ollama run` 就必挂**。
> 收敛监听地址时必须用 **`zz-` 前缀**的 drop-in（文件名排序晚于 `override.conf` 才生效）。

## 六、内存基线（关键）

| 指标 | 21:35 | 21:52 | 变化 |
|---|---|---|---|
| `MemAvailable` | 6.40 GiB | **0.44 GiB** | **-6 GiB** ⚠️ |
| `MemFree` | 5.51 GiB | 0.79 GiB | |
| `Cached` | 2.38 GiB | 1.16 GiB | |
| `SwapUsed` | 732 MiB | 847 MiB | +115 MiB |
| llama `Rss` | 32.34 GiB | **40.14 GiB** | **+7.8 GiB** |
| llama `Pss_Anon` | 31.4 GiB | **39.2 GiB** | +7.8 GiB |
| llama `Pss_File` | 164 MiB | 158 MiB | 基本不变 |
| GPU 侧 `used_memory` | 81,153 MiB | （未变） | |

**结论：`llama-server` 的匿名内存在使用过程中持续增长（约 +8 GiB / 20 分钟量级），且不会自行释放。** 重启可归零。
（`Pss_File` 始终很小说明 GGUF 文件页不占内存；增长的是进程匿名内存 = 运行时缓冲/KV 相关分配。）

## 七、变更边界（不要碰）

- `/opt/llama.cpp/build/**` —— 不重编译、不升级
- 模型目录 `/models/**` —— 只读
- `/etc/systemd/system/ollama.service.d/override.conf` —— **不直接编辑**（用 `zz-` 前缀覆盖）
- NVIDIA 驱动 / CUDA / kernel —— 不动
- 任何 `docker` 相关配置 —— 不动