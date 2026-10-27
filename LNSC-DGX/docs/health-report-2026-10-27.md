# DGX 巡检报告 · 2026-10-27

**目标**：`http://10.86.20.57:8081`（llama.cpp，OpenAI 兼容 API，只读巡检，未做任何变更）
**方式**：HTTP 端点探测（`/health`、`/props`、`/v1/models`、`/slots`、`/metrics`、`/v1/chat/completions`）

---

## 1. 结论

| 维度 | 状态 | 说明 |
|---|---|---|
| 服务可用性 | ✅ 正常 | `/health` → `{"status":"ok"}` |
| 上下文 | ✅ 已修复 | `n_ctx=131072` 已生效（原 49216 报错解决） |
| 原生长度 | ✅ 无需 rope | `n_ctx_train=262144`，131072 只用了一半，无质量风险 |
| 并发 slot | ✅ 1 | `total_slots=1`，无重复实例 |
| 前缀缓存 | ✅ 生效 | 长请求 `n_prompt_tokens=106712`，`cache=104207` |
| 生成速度 | ⚠️ 符合预期 | 实测 **29.3 tok/s**（34.12 ms/token），在 177B@Q4 的合理区间 |
| 可观测性 | ❌ 缺失 | `/metrics` 返回 501，启动参数无 `--metrics` |
| 内存余量 | ⚠️ 偏紧但正常 | `available≈8.9 GiB`，因权重 103.7 GiB；不建议再放大 `-c` |

**没有发现故障。** 之前"`used 112Gi` = 两个实例"的判断已证伪：`used 112Gi ≈ 权重 103.7 + KV 3 + OS 5`。

---

## 2. 模型实测档案

| 字段 | 值 |
|---|---|
| alias | `qwen3.8-flash-next` |
| 路径 | `/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf` |
| 架构/量化 | `Q4_K - Medium`（文件名标 UD-Q4_K_XL，GGUF 内记录为 Q4_K_M） |
| **参数量** | **176,943,899,520 ≈ 177 B** |
| **权重体积** | **111,323,630,080 B ≈ 103.7 GiB** |
| `n_ctx` / `n_ctx_train` | 131072 / **262144** |
| `n_embd` / `n_vocab` | 2560 / 248320 |
| 模态 | text only（vision/audio 均 false） |
| 思考模板 | slot 的 `generation_prompt` = `<|im_start|>assistant\n thinking\n` → **thinking 模板已正确生效** |

**关键修正**：权重 103.7 GiB，不是此前假设的 ~48 GiB。所有内存/上下文的结论都要按 177B 重算。

---

## 3. 运行时观测

### 巡检瞬间正在处理的长请求（`/slots`）

```json
{"id":0,"n_ctx":131072,"is_processing":true,"id_task":11719,
 "n_prompt_tokens":106712,"n_prompt_tokens_processed":218,"n_prompt_tokens_cache":104207,
 "params":{"max_tokens":32000,"stream":true,"chat_format":"peg-native","reasoning_format":"deepseek"},
 "next_token":[{"has_next_token":true,"n_remain":29713,"n_decoded":2287}]}
```

* 10.6 万 token 的请求正在跑，**证明 128k 上下文是必需项**，`-c 49152` 从一开始就不可能够用
* `n_prompt_tokens_cache=104207`：**prefix caching 命中 97.7%**，多轮/续问场景 prefill 开销很小
* 客户端 `max_tokens=32000` 合理（131072 − 106712 还剩 24360，留了余量）

### 吞吐实测（54 token prompt + 16 token 输出）

```json
"timings":{"prompt_n":54,"prompt_ms":988.0,"prompt_per_second":54.7,
           "predicted_n":16,"predicted_ms":511.8,"predicted_per_second":29.3}
```

* **decode 29.3 tok/s**：与"带宽 273GB/s ÷ 激活参数×4.5bit × 效率0.5"的估算一致
* `prompt_per_second=54.7` 不可当 prefill 基准（54 token 含冷启动/CUDA graph 构建）；真实 prefill 需用 1k+ token 才能测准
* ⚠️ 测试内容中文变成 `???`：是 **PowerShell 5.1 的 `Invoke-WebRequest` 未按 UTF-8 编码 body** 导致（模型侧把 `只回复OK` 收到成 `???OK`），**不是模型问题**

---

## 4. 建议动作（按性价比排序）

| # | 动作 | 收益 | 成本 |
|---|---|---|---|
| 1 | 启动参数加 `--metrics` | 拿到 `kv_cache_usage_ratio` / `requests_deferred` / `tokens_per_second`，才能做趋势监控 | 重启一次 |
| 2 | **保持 `-c 131072`，不要升到 262144** | 262144 需 KV 翻倍到 ~6 GiB，`available` 会掉到 3~5 GiB，进入 swap 抖动区 | 0（不改） |
| 3 | 加 `--no-mmap` 或 `--direct-io` | 重启时不必把 103.7 GiB 再灌进 page cache 挤压内存（该 build 是否支持需 `--help` 确认） | 重启一次 |
| 4 | 长请求场景给 `-ub 512` 复核 | 当前 prefill 参数无法从 API 读出，需看启动日志 | 无 |
| 5 | systemd 托管 + `MemoryMax` | 把"整机卡死"降级为"进程被杀" | 见 `systemd/llama-qwen38.service` |

### 若内存继续恶化（`available` < 2 GiB 或 swap 持续增长）

按顺序：`-c 98304` → `-ctk q8_0 -ctv q8_0` 确认已开 → 降低并发（保持 `--parallel 1`）。
**不要**试图靠 `-ub` 降到 32 来"省内存"，那是拿 prefill 速度换几个 GB，代价完全不对等。

---

## 5. 下次巡检用的命令

```bash
H=10.86.20.57:8081
curl -s http://$H/health; echo
curl -s http://$H/props   | jq '{n_ctx:.default_generation_settings.n_ctx, slots:.total_slots}'
curl -s http://$H/v1/models | jq '.data[0].meta'
curl -s http://$H/slots   | jq '.[0] | {is_processing,n_prompt_tokens,n_prompt_tokens_cache,n_decoded:.next_token[0].n_decoded}'
curl -s http://$H/metrics | grep -E 'kv_cache_usage_ratio|requests_(deferred|processing)|tokens_per_second'   # 需 --metrics
```
---

## 6. 第二轮：SSH 深度巡检（root@DGX01-2512，2026-10-27 21:35）

### 6.1 环境实测

| 项 | 值 |
|---|---|
| 主机 / 系统 | `DGX01-2512` / Ubuntu 24.04.4 LTS，kernel 6.17.0-1021-nvidia，**aarch64**，20 核 |
| 运行时长 | up 4 days 7:39，负载 `0.03 / 0.41 / 0.54`（空闲） |
| GPU | **NVIDIA GB10, compute_cap 12.1**, driver 595.71.05 |
| GPU 空闲状态 | 41~42 °C，**10.7 W**，`clocks.sm 2411 / 3003 MHz`，util 0% → **无降频、无过热** |
| 内存 | `MemTotal 121.63 GiB`，`MemAvailable 6.40 GiB`（5 次/1 秒采样恒定，无泄漏） |
| Swap | `/swap.img` 16 GiB，已用 **732 MiB**，`swappiness=60` |
| 磁盘 | `/dev/nvme0n1p2` 1.9T，用 376G，可用 **1.4T (22%)** |
| OOM 历史 | dmesg 无任何 `oom-kill` 记录 ✅ |

### 6.2 llama.cpp 构建实测

```
version: 0.7.0-dev (build 0, commit unknown)
built with GNU 13.3.0 for Linux aarch64
```

`--help` 实测只有这两项相关：

| 参数 | 支持 | 说明 |
|---|---|---|
| `-fa, --flash-attn [on\|off\|auto]` | ✅ | 现用 `-fa on`，写法正确 |
| `--metrics` | ✅ | **未开启**（所以 `/metrics` 返回 501） |
| `--no-mmap` | ❌ 不存在 | 之前的 `invalid argument: --no-mmap` 属正常 |
| `--direct-io` | ❌ 不存在 | 同上 |
| `--mmap` / `--mlock` | ❌ 不存在 | 本 build 删掉了整套 mmap 开关 |

→ 20:58:55 带 `--no-mmap` 启动失败、20:59:57 去掉后成功，与实测一致。**此项以后不用再试。**

### 6.3 内存分解（`/proc/52520/smaps_rollup`）

| 指标 | 值 | 含义 |
|---|---|---|
| `Rss` | 32.34 GiB | 进程驻留 |
| `Pss_Anon` | **31.4 GiB** | 匿名内存（CUDA 主机侧/缓冲） |
| `Pss_File` | **164 MiB** | **GGUF 文件页几乎全被内核回收** |
| `Pss_Shmem` | 750 MiB | 共享内存（CUDA 映射） |
| GPU 侧 `used_gpu_memory` | **81153 MiB (79.2 GiB)** | `nvidia-smi --query-compute-apps` |

`79.2 (GPU) + 31.4 (anon) ≈ 110.6 GiB`，其中权重 103.69 GiB、KV+compute 约 7 GiB。

⚠️ `Pss_File` 仅 164 MiB ⇒ page cache 被压到 2.38 GiB，GGUF 完全不在内存缓存里。这既是 `MemAvailable` 只有 6.4 GiB 的直接结果，也意味着**重启要重新从 NVMe 读 103.7 GiB**。

### 6.4 模型文件完整性

| 分片 | 大小 |
|---|---|
| `-00001-of-00004` | 10.9 MB |
| `-00002-of-00004` | 46.44 GiB |
| `-00003-of-00004` | 45.99 GiB |
| `-00004-of-00004` | 11.26 GiB |
### 6.5 同机其它服务（**风险源**）

| 服务 | 状态 | 端口 | 内存 |
|---|---|---|---|
| `openwebui.service` | active | 3000 | 30 MB |
| `ollama.service` | **active** | **11434** | 36 MB（模型未加载） |
| `docker.service` | active | — | 无容器 |
| `vllm.service` | inactive (dead) | — | Qwen3.6-35B-A3B-FP8，未启动 |

`ollama list` 含 **`qwen3.8:27b`（17 GB）**、**`qwen3-coder:30b`（18 GB）**。
**`MemAvailable` 只有 6.4 GiB —— 任何人经 11434 调起 17 GB 模型都会 OOM / 整机卡死。**

### 6.6 进程托管状态（**第二风险**）

```
/proc/52520/fd/1 -> /dev/pts/2      # 日志只输出到终端，未落盘
SigIgn: 0000000000001000            # bit12=SIGPIPE；bit0(SIGHUP) 未被忽略
```

* 无 systemd 单元，是 `sudo` 在 pts 上手起的
* **SIGHUP 未忽略 ⇒ 关终端 / SSH 断连，llama-server 会被杀**
* 启动日志（`KV buffer size`、`n_ubatch` 实际值）只存在于 `/dev/pts/2`，已无法回查

### 6.7 启动历史（journal 的 sudo 记录）

| 时间 | 关键参数 |
|---|---|
| 15:49 | `-c 8192 -b 128 -ub 32 -fa off` |
| 17:15 / 17:18 | `-c 32768 …` |
| 19:18 | `-c 49152 …` ← 报 49216 超限那次 |
| 20:58 | `-c 131072 … -ctk q8_0 -ctv q8_0 **--no-mmap**` → 失败 |
| **20:59（当前）** | `-c 131072 -b 2048 -ub 512 -ngl 999 -fa on -ctk q8_0 -ctv q8_0 --jinja --parallel 1` |

### 6.8 上下文水位（持续恶化）

| 采样时刻 | prompt tokens | 占 n_ctx (131072) | 余量 |
|---|---|---|---|
| 21:19 | 106,712 | 81.4% | 24,360 |
| 21:27 | 113,889 | 86.9% | 17,183 |
| 21:29 | 114,642 | 87.5% | 16,430 |
| 21:34 | 117,205 | 89.4% | **13,867** |

单调上升（约 +1k/数分钟）。**按此速率 30~60 分钟内会再次触发 `exceeds the available context size`（这次是 131072）。**

---

## 7. 处置方案（按紧迫度）

### P0 · 上下文即将再次撞限

| 方案 | 内存代价 | 说明 |
|---|---|---|
| **A. 客户端截断/摘要**（推荐） | 0 | prompt 从 49k 涨到 117k 是**应用侧历史累积**，不是模型需求。保留 system+最近 N 轮或摘要老历史；`max_tokens` 32k→8~12k |
| **B. `-c 196608 -ctk q8_0 -ctv q4_0`** | **+0.4 GiB** | 192k 上下文，K 保 q8_0，安全 |
| C. `-c 262144 -ctk q4_0 -ctv q4_0` | **±0**（KV≈3.0 GiB，与现在相同） | 双倍上下文不加内存；代价是长上下文 V 精度下降 |
| D. `-c 262144 -ctk q8_0 -ctv q8_0` | +3.0 GiB → available ~3.4 GiB | ❌ 不建议 |

> 原生 262144，以上方案**都不需 rope 缩放**。改动需重启（等当前长任务结束）。

### P1 · 进程随时可能被终端带走 → 迁 systemd

```bash
sudo tee /etc/systemd/system/llama-qwen38.service > /dev/null <<'EOF'
[Unit]
Description=llama.cpp Server - Qwen3.8-Flash-Next (GB10)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/models/qwen3.8-flash-next/UD-Q4_K_XL
ExecStart=/opt/llama.cpp/build/bin/llama-server \
  -m /models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf \
  --alias qwen3.8-flash-next \
  -c 196608 -b 2048 -ub 512 -ngl 999 \
  -fa on -ctk q8_0 -ctv q4_0 \
  --jinja --parallel 1 --metrics \
  --host 0.0.0.0 --port 8081
Restart=on-failure
RestartSec=10
TimeoutStartSec=900
MemoryHigh=112G
MemoryMax=116G
StandardOutput=journal
StandardError=journal
SyslogIdentifier=llama-qwen38

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now llama-qwen38
```

### P2 · ollama 是定时炸弹

```bash
sudo systemctl stop ollama && sudo systemctl disable ollama      # 不再需要时
# 或至少只监听本机：
sudo systemctl edit ollama     # Environment="OLLAMA_HOST=127.0.0.1:11434"
```

### P3 · 内存调优

```bash
sudo sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf
```

### P4 · `--no-mmap` / `--direct-io`

**本 build 不支持，此项关闭。** page cache 被挤掉可接受（clean 页可回收、不影响推理速度，代价仅是重启慢）。