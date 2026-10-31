# 03 · 变更计划（Change Plan）

> **当前状态：✅ 已解冻（2026-10-27 23:01 执行 C2+C3）**
> 触发窗口：旧的手动进程已于 22:49 前退出（`8081` 空闲、`MemAvailable` 118.7 GiB、无 OOM 记录），
> 经确认后按 C2+C3 合并执行，现已由 systemd 托管；2026-10-29 经 C9 调整为原生最大 `262144` 上下文。
> 剩余未执行项：C1（swappiness）、C4（ollama 收敛）、C5 观察项。

每项变更都满足：一次只改一个变量、有快照、有验证、有回滚。
执行入口统一为 `scripts/dgx-change.sh`（默认 dry-run，`apply` 才动手）。

---

## C0 · 已执行记录（2026-10-27 23:01~23:09）

| 项 | 实测值 |
|---|---|
| 托管方式 | `systemd` unit `/etc/systemd/system/llama-qwen38.service`（`enabled` + `active`） |
| 生效参数 | `-c 196608 -b 2048 -ub 512 -ngl 999 -fa on -ctk q8_0 -ctv q8_0 --jinja --parallel 1 --metrics` |
| 限额 | `MemoryHigh=112G`、`MemoryMax=116G`（本机 **不支持** `MemorySwapMax`，cgroup 无 swap accounting） |
| 首次就绪耗时 | **46 秒**（页缓存尚热）；二次重启（纠正 KV 类型）**93 秒** |
| 实测占用 | cgroup `memory.current` 30.3 GiB / `memory.peak` 40.4 GiB（远低于 112G 软限）<br>`MemAvailable` 8.5 GiB、`SwapFree` 15.3 GiB（**swap 几乎未动**） |
| 性能 | decode **29.75 tok/s**（64 token，`temperature=0`），与 128k 基线 29.3 持平 |
| `/metrics` | 已可用（`llamacpp:tokens_predicted_total` 等） |
| 日志 | 进 journal，`srv load_model: initializing, n_slots = 1, n_ctx_slot = 196608` |
| 遗留 | 首次装机时误用 `-ctv q4_0`，触发了 FA slow path（见下方 C3 的 ⚠️），已纠正为 `q8_0` |

---

## C1 · swappiness 60 → 10（最低风险，可随时做）

| 项 | 内容 |
|---|---|
| 目的 | 降低内核换出倾向，缓解统一内存抖动（当前 `SwapUsed` 已在缓慢上涨） |
| 中断 | **无**（不改任何服务） |
| 前置 | 无（不需要无活跃请求） |
| 执行 | `sudo bash scripts/dgx-change.sh apply swappiness` |
| 验证 | `cat /proc/sys/vm/swappiness` → `10` |
| 回滚 | `sudo bash scripts/dgx-change.sh rollback swappiness`（依据 `state/swappiness.orig`） |
| 风险 | 极低；最坏情况是内存压力下更倾向 OOM 而非 swap（本机已有 `MemoryMax` 兜底时更安全） |

---

## C2 · 迁移到 systemd + 开 `--metrics`（**需窗口**）· ✅ 已执行 2026-10-27 23:01

| 项 | 内容 |
|---|---|
| 目的 | ① 消除"关终端就死"（`SIGHUP` 未忽略）② 日志进 journal ③ 开 `/metrics` 可监控 ④ `MemoryMax` 兜底 |
| 中断 | **1~3 分钟**（重读 103.7 GiB 权重）；实测 46~93 秒 |
| 前置 | 无活跃请求；`MemAvailable` ≥ 2 GiB；已通知使用者 |
| 执行 | 直接 `install` 仓库里的 `systemd/llama-qwen38.service` → `daemon-reload` → `enable` → `start`<br>（本机未使用脚本路径，因为旧进程已退出，脚本的"停旧进程"分支用不上） |
| 实际落地防护 | `StartLimitIntervalSec=600` + `StartLimitBurst=3`（**防重启风暴**：启动失败时每 10 s 会重读 103.68 GiB）<br>`ExecStartPre` 模型可读性检查 · `LimitNOFILE=65535` · `TimeoutStopSec=60` · `KillSignal=SIGINT` |
| 验证 | `systemctl is-active` = active；`/health` = ok；`n_ctx` = 196608；`/metrics` 有数据；journal 无 warn |
| 回滚 | `sudo systemctl disable --now llama-qwen38`，再用旧手动命令启动 |
| ⚠️ 未生效项 | `MemorySwapMax=4G` 在本机**无效**——`/sys/fs/cgroup/memory.swap.max` 不存在（cgroup 未启用 swap accounting）。抑制 swap 只能靠 C1 |
| 遗留风险 | `MemoryMax` 只约束 `memory.current`（进程 anon + 页缓存），**管不到 GPU 设备内存**；权重主要在设备侧，实测 cgroup 仅 30 GiB。因此它对"整机 thrash"的兜底是**部分有效**，仍必须靠监控 |

---

## C3 · 扩上下文 · ✅ 已执行（`-c 196608 -ctk q8_0 -ctv q8_0`）

| 项 | 内容 |
|---|---|
| 目的 | 解决 `prompt 117k / 余量 13k` 反复撞限 |
| 实际方案 | `CTX=196608 CTK=q8_0 CTV=q8_0` → KV ≈ **4.6 GiB**（24 KiB/token × 196608） |
| 不采用 `-ctv q4_0` 的原因 | 🔴 **本 build 编译的 FA 组合只有同型 4 种**：`GGML_CUDA_FA_QUANTS="q4_0-q4_0;q8_0-q8_0;f16-f16;bf16-bf16"`（`GGML_CUDA_FA_ALL_QUANTS=OFF`）。<br>用 `q8_0-q4_0` 混型会报 `no FlashAttention vector kernel compiled ... converting K and V to f16 instead (slow)`，**每步解码都要转换全部历史 K/V**，上下文越长越慢。省 1.1 GiB 换这个代价不值得 |
| 若确实要用 q4_0 v | 必须重编译并加组合：<br>`cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121 -DGGML_CUDA_FA_QUANTS="q4_0-q4_0;q8_0-q8_0;q8_0-q4_0;f16-f16"`<br>或直接 `-DGGML_CUDA_FA_ALL_QUANTS=ON`（编译时间显著变长） |
| 不建议 | `CTX=262144`：KV ≈ 6.1 GiB，且 `MemAvailable` 当前仅 8.5 GiB，余量太薄 |
| 验证 | `/props` → `n_ctx=196608`；journal 无 FA warning；decode 29.75 tok/s |
| ⚠️ 副作用 | 客户端可以塞进更多历史 → prefill 时间线性增长（65 tok/s 量级，100k prompt 仍是分钟级）。客户端侧仍需控历史长度 |

---

## C6 · 启用视觉输入（`--mmproj`）· ✅ 已执行 2026-10-27 23:30

| 项 | 内容 |
|---|---|
| 背景 | 2026-10-27 确认：`unsloth/Qwen3.8-Flash-Next-GGUF` **本身就带视觉能力**，当初下载只 `--include "UD-Q4_K_XL/*"`，漏了 `mmproj` |
| 执行 | 23:27 下载 `mmproj-F16.gguf`（862 MiB，sha256 `1f7b7f0b…`）→ 23:30 写入 unit 的 `--mmproj` → `daemon-reload` + `restart`（pid 60600） |
| 中断 | 92 秒（23:30:44 → 23:32:16） |
| 结果 | ✅ `/props` → **`modalities: {"vision":true,"video":true,"audio":false}`**<br>✅ journal：`load_model: loaded multimodal model, '.../mmproj-F16.gguf'`，无 error/warn |
| 真图验证 | 生成 64×64 纯红 PNG → `HTTP 200`（此前 500），模型答 **`Red`**，reasoning 里描述"uniform, solid red field" |
| 性能影响 | decode **30.08 tok/s**（纯文本基线 29.75），视觉启用**未拖慢**文本路径 |
| 内存 | `MemAvailable` 8.0 GB（重启释放的 anon 多于 projector 增加的 0.9 GB），`cgroup current` 28.0 GiB |
| 回滚 | 删掉 unit 里 `--mmproj` 那行 → `daemon-reload && systemctl restart llama-qwen38`（文件留着不影响文本模式） |
| 新发现 | `video` 也变成 `true`。**视频帧 token 消耗远高于图片**（几十帧 = 数万 token），客户端要节制使用 |

---

## C7 · prefill 调优（`-ub 512 → 1024` + `--cache-reuse 256`）· ✅ 已执行 2026-10-28 00:07

| 项 | 内容 |
|---|---|
| 触发 | 客户端反馈"首次加载/生成很慢"：实测单次请求 prompt **38,972 tokens**，全量 prefill 需 **~53 s**，第 50 秒被客户端取消 |
| 诊断 | `GGML_CUDA_FA_QUANTS` 无关；纯属 177B MoE 的 prefill 带宽/算力成本。GPU 利用率已 96%、SM 2587 MHz（未降频） |
| 变更 | `-ub 512` → `-ub 1024`；新增 `--cache-reuse 256` |
| A/B 方法 | 同一脚本、同一唯一 nonce（保证 cache miss），`max_tokens=1` 只测 prefill |
| A/B 结果 | 8k：**955.9 → 991.1 tok/s**（+3.7%）<br>24k：**935.3 → 1081.8 tok/s**（+15.7%，省 3.1 s） |
| 代价 | cgroup `peak` 39.2 → 40.8 GiB（+1.6 GiB）；decode 29.75 → 29.71 tok/s（无退化）；journal 无 error |
| 结论 | 长上下文收益明显（Cline 39k 场景正是长上下文），**保留** |
| 进一步 | `-ub 2048` 可再试，但 `MemAvailable` 仅 6.9 GB，风险上升、收益递减（预估再 +5~10%），**需单独窗口 + 回滚准备** |
| 回滚 | 恢复 `/root/llama-qwen38.service.bak.ub512.*` → `daemon-reload && restart` |

### 真正的瓶颈不在服务端

39k 里有 **~35k 是客户端固定开销**（系统提示 + 工具/MCP 定义 + 历史）。服务端 prefill 已到 1082 tok/s，再压只能靠**减小 prompt**：

| 客户端动作 | 预期效果 |
|---|---|
| 关掉不用的 MCP server | 每个 server 的工具 schema 都会算 token，常见 2~10k |
| 减少 `@file` 引用 / 自动附带文件 | 直接按文件大小吃 token |
| 长会话定期开新会话或 compact | 历史部分线性增长 |
| Cline 的 request timeout 调到 300~600 s、开启 streaming | 避免 50 秒被误判超时取消（**取消=前面 prefill 全部作废**） |

39k → 20k 可把首轮等待从 ~36 s 直接压到 ~19 s，**比任何服务端调参都有效**。

---

## C8 · 双机 GLM-5.3-Flash / vLLM TP2（**文档已备，部署未开始**）

| 项 | 内容 |
|---|---|
| 目的 | 两台 128GB Spark 通过 200GbE QSFP 组成一个逻辑推理服务，改善复杂编程、推理、长上下文与并发，而非只增加独立副本 |
| 目标模型 | `unsloth/GLM-5.3-Flash-GGUF` UD-Q4_K_XL（320B 总参数 / 18B 激活，185.99 GiB）；备选 `nvidia/GLM-5.3-Flash-FP4-Local` |
| 官方路径 | **当前首选 ModelScope GGUF + llama.cpp RPC**：私网/SSH → NCCL 验证 → worker `ggml-rpc` → head `llama-glm53-rpc`；Cline 只连 head `:8081/v1`。备选 NVIDIA Sync + vLLM TP2 |
| 当前状态 | **仅完成部署/验证/运维/留痕框架；未改网、未下载 GLM、未启动双机服务** |
| 执行顺序 | P1 备份与 QSFP → P2 网络/SSH → P3 NCCL → P4 镜像/模型 → P5 worker→head → P6 API/Cline → P7 A/B/调优 → P8 交接 |
| 主计划 | `docs/10-two-node-deployment.md`（硬件、官方基线、模型、阶段准出门） |
| 验证调优 | `docs/11-two-node-validation.md`（分层验证、同口径 A/B、一次一变量） |
| 运维回滚 | `docs/12-two-node-operations.md`（监控、故障、双机/网络/服务回滚） |
| 留痕 | `docs/13-two-node-changelog.md` + `benchmark-results/two-node-glm53/` |
| 生产门槛 | 功能/工具通过；真实质量不劣于 Flash；decode 与总完成时间可接受；30 分钟稳定；回滚演练通过 |
| 回滚 | 停止 head→worker 新增容器，验证无残留后恢复既有 Flash；网络仅用 P1 备份回滚 |
| 禁止 | 未验证 NCCL 就下载/上模型、双 head、暴露私网端口、同时改多项参数、把官方数据写成本机结果 |

**在 C8 验收并签字前，不修改当前 `llama-qwen38` 的 active/enabled 状态。**

---

## C9 · 上下文 196608 → 262144（原生最大）· ✅ 已执行 2026-10-29 09:17

| 项 | 内容 |
|---|---|
| 目的 | 将当前 Flash-Next 上下文调整为模型原生最大值；不使用 YaRN 或 1M 外推 |
| 前置 | 等待活跃 slot 空闲；备份 `/root/llama-qwen38.service.bak.ctx196608.*`；变更脚本检查失败自动恢复 |
| 变更 | unit 与手动启动脚本 `-c 196608 → 262144`；其余 `-b 2048 -ub 1024 -fa on -ctk/-ctv q8_0` 等不变 |
| 验证 | `/v1/models` 与 `/props` 均为 `n_ctx=262144`、`n_ctx_train=262144`；`active+enabled`；短请求 HTTP 200；无 FA slow-path |
| 内存 | KV 估算约 4.6→6.1 GiB（+1.5 GiB）；重启后 `MemAvailable≈8.9 GiB`、swap 约 3.7 GiB（较重启前下降） |
| 证据 | DGX `/root/lnsc-ab/ctx262144/`；本地 `benchmark-results/ctx262144/` |
| 回滚 | 恢复 `/root/llama-qwen38.service.bak.ctx196608.*` → `daemon-reload && restart` |
| 注意 | 最大容量不代表应长期塞满；长 prompt 的 prefill、KV 和 swap 成本仍需监控 |

---

## C4 · ollama 收敛到本机（秒级，低风险）

| 项 | 内容 |
|---|---|
| 目的 | 现有 `override.conf` 是 `OLLAMA_HOST=0.0.0.0:11434` + `OLLAMA_KEEP_ALIVE=-1`，等于把 17 GB 的模型永久暴露在局域网上 |
| 中断 | ollama 重启约 3~5 秒（llama-server 不受影响） |
| 前置 | 确认没有客户端正在用 ollama（`ollama ps` 为空） |
| 执行 | `sudo bash scripts/dgx-change.sh apply ollama-isolate` |
| 机制 | 写 `ollama.service.d/**zz**-lnsc-bind.conf`（**必须 zz- 前缀**，否则被 `override.conf` 覆盖） |
| 验证 | `ss -ltn \| grep 11434` → `127.0.0.1:11434` |
| 回滚 | `sudo bash scripts/dgx-change.sh rollback ollama-isolate` |
| 备选 | 如果 ollama 根本不用：`systemctl disable --now ollama`（更彻底，属独立决策） |

---

## C5 · 降低内存占用（**优先级最高**，需窗口）

现状：`MemAvailable 449 MiB`，`Pss_Anon` 在 20 分钟内从 31.4 → 39.2 GiB 且不自行释放。

| 手段 | 预计释放 | 代价 |
|---|---|---|
| **重启一次**（同 C2） | **~8 GiB**（释放累积的匿名内存） | 1~3 分钟中断 |
| `-ctv q4_0`（仅 V 缓存降精度） | ~1.5 GiB | 长上下文 V 精度略降（一般可接受） |
| `-c 98304`（96k 上下文） | ~1.1 GiB | 上下文变小 |
| `-ub 256` | ~0.5~1 GiB | prefill 略慢 |

**推荐组合（一次到位，但只算"一个"变更单元）**：
```bash
CONFIRM=i-accept-downtime CTX=131072 CTV=q4_0 \
  sudo bash scripts/dgx-change.sh apply systemd-llama
```
> 先重启释放 leak，再观察 `Pss_Anon` 是否继续以 +8 GiB/20min 的速度上涨。
> 若确认是稳定泄漏 → 建立"每 N 小时滚动重启"或"按 `MemAvailable` 阈值自动重启"策略（需另行评估，勿贸然上）。

---

## 六、执行顺序建议

```
解冻后：
  C1 (swappiness)          ← 随时可做，5 秒
  C4 (ollama 收敛)          ← 秒级
  C5+C2 (重启 + systemd + -ctv q4_0)  ← 同一窗口完成，一次重启
  观察 30 分钟 → 记录 Pss_Anon 曲线
  C3 (如需更大上下文，再单独一次)
```

## 七、窗口记录模板（填进 06-changelog.md）

```
窗口: 2026-11-XX 22:00 ~ 22:30
执行: C1 + C4 + C5+C2
变更前: MemAvailable=?  n_ctx=?  prompt_tokens=?  Pss_Anon=?
变更后: MemAvailable=?  n_ctx=?  /health=?  systemctl=?
异常: 无 / 描述
回滚: 未使用 / 使用了 C? (原因)
```