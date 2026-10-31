# 06 · 变更与事件记录（Changelog）

> 格式固定，便于 grep 与审计。**只写已发生的事实**，计划中的内容放 `03-change-plan.md`。
> 每条变更必须能在 `/var/log/lnsc/audit-*.log` 里找到对应记录。
> 双机 C8 专用阶段、调优、事故与验收模板见 `docs/13-two-node-changelog.md`；当前仅建立框架，部署未开始。

---

## 一、记录模板

```
### YYYY-MM-DD HH:MM · <变更项 或 事件ID> · <谁>
- 类型: 变更 / 故障 / 巡检
- 触发: 为什么要做
- 操作: 执行的命令（可复制）
- 变更前: MemAvailable=?  n_ctx=?  prompt_tokens=?  Pss_Anon=?
- 变更后: MemAvailable=?  n_ctx=?  /health=?  systemctl=?
- 结果: 成功 / 失败 / 已回滚
- 回滚: 未使用 / 使用了 rollback <id>（原因）
- 快照: /var/log/lnsc/snapshots/<ts>
- 遗留: 待办或观察项
```

---

## 二、已发生历史（据 `journalctl` 中 sudo 记录 + 巡检实测整理）

| 时间 | 事件 | 关键参数 | 结果 |
|---|---|---|---|
| 10-23 起 | 模型下载完成（4 分片，合计 103.69 GiB） | — | ✅ 校验一致 |
| 10-27 15:49 | 首次启动尝试 | `-c 8192 -b 128 -ub 32 -fa off` | 上下文过小 |
| 10-27 17:15 | 调大上下文 | `-c 32768`（同上其余） | 仍不足 |
| 10-27 17:18 | 加 alias 重启 | `-c 32768` + `--alias` | 仍不足 |
| 10-27 19:18 | 再调 | `-c 49152` | ❌ 报 `request (49216) exceeds available context size (49152)` |
| 10-27 20:58 | 尝试 `--no-mmap` | `-c 131072 … --no-mmap` | ❌ `invalid argument: --no-mmap`（本 build 无此选项） |
| 10-27 20:59 | 去掉 `--no-mmap` 重启 | `-c 131072 -b 2048 -ub 512 -ngl 999 -fa on -ctk q8_0 -ctv q8_0 --jinja --parallel 1` | ✅ 当前运行中（pid 52520） |
| 10-27 21:19~21:34 | 巡检（HTTP） | — | 发现 prompt 106k→117k 递增，余量 13.8k |
| 10-27 21:35 | SSH 深度巡检 | — | `MemAvailable 6.40 GiB`，`Pss_Anon 31.4 GiB`，`Pss_File 164 MiB`，日志在 `/dev/pts/2`，`SigIgn=0x1000`（SIGHUP 未忽略） |
| 10-27 21:52 | 沙箱验证变更脚本 | `LOG_DIR=/tmp/lnsc-test` | ✅ 只读模式与防呆闸门全部生效，未污染系统 |
| 10-27 21:52 | 指标采集首行 | — | 🔴 **`MemAvailable` 449 MiB**，`Pss_Anon 39.2 GiB`（20 分钟 +7.8 GiB） |
| 10-27 22:0x | 多模态定性测试 | `POST /v1/chat/completions` 带 1×1 PNG | ❌ `500 image input is not supported - hint: ... provide the mmproj`；同结构纯文本请求 `200` |
| 10-27 22:49 | 运行状态变更（实测） | `pgrep -x llama-server` 无输出；`ss -lntp` 无 8081；`MemAvailable 118.7 GiB`；`SwapFree 15.28 GiB`；`journalctl -k` 无 OOM 记录 | ⚠️ 手动进程已退出（非 OOM 杀），**切换 systemd 的窗口已打开** |
| 10-27 22:50 | C2 unit 重写并校验 | `-c 196608 -ctv q4_0 --metrics`；`MemoryHigh=112G/MemoryMax=116G`；`StartLimitBurst=3`；`LimitNOFILE=65535` | ✅ `systemd-analyze verify` 通过（exit=0），`ldd` 与 `env -i --version` 均正常，未安装到 `/etc` |
| 10-27 22:5x | 发现 `MemorySwapMax` 不生效 | `/sys/fs/cgroup/memory.swap.max` 不存在 | ⚠️ 本机 cgroup 未启用 swap accounting → 从 unit 中删除该行 |
| 10-27 23:01:43 | **执行 C2+C3：迁移 systemd 并扩上下文** | `install` unit → `daemon-reload` → `enable` → `start`（pid 57119） | ✅ 23:02:29 就绪（46 s），`/health` ok，`n_ctx=196608`，`--metrics` 生效 |
| 10-27 23:03:06 | 🔴 发现 FA slow path | journal: `no FlashAttention vector kernel compiled for K/V types q8_0-q4_0, converting K and V to f16 instead (slow)` | 根因：`GGML_CUDA_FA_QUANTS="q4_0-q4_0;q8_0-q8_0;f16-f16;bf16-bf16"`（同型才编译），混型 `q8_0-q4_0` 未编译 |
| 10-27 23:08:08 | 纠正 KV 类型并重启 | `-ctv q4_0` → `-ctv q8_0`（pid 58398） | ✅ 23:09:41 就绪（93 s）；journal **无 FA warning**；decode **29.75 tok/s**（64 token） |
| 10-27 23:10 | 部署后验收 | cgroup `current 30.3 GiB / peak 40.4 GiB`；`MemAvailable 8.5 GiB`；`SwapFree 15.3 GiB`；`anon 27.9 GiB` | ✅ 全部达标；`enabled` + `active` |
| 10-27 23:13 | **真实流量已接入** | `prompt_tokens_total` 从 133（我的两次冒烟）跳到 **29374**；`n_busy_slots_per_decode=1` | ✅ 说明客户端已在用新的 196k 端点，无需额外通知 |
| 10-27 23:16 | 开机自启验证 | `is-enabled=enabled`；`multi-user.target.wants/llama-qwen38.service` 软链存在；`list-dependencies multi-user.target` 含该 unit；`crontab -l`/`/etc/cron.d`/`rc.local` 均无第二个启动入口；`/models`、`/opt/llama.cpp` 同在 `/dev/nvme0n1p2 ext4 /`（本地盘，无延迟挂载风险）；`PPID=1` | ✅ 重启后会自动拉起；冷缓存预计 1.5~2.5 分钟（实测磁盘 1.3 GB/s × 104 G） |
| 10-27 23:26 | 🔎 发现视觉能力缺失的真实原因 | 追踪 `bash_history` → 模型来自 `modelscope download ... unsloth/Qwen3.8-Flash-Next-GGUF --include "UD-Q4_K_XL/*"`；查 ModelScope repo 文件树 → **存在 `mmproj-F16.gguf`（0.90 GB）/ `mmproj-BF16.gguf`（0.91 GB）/ `mtp-*.gguf`（4.14 GB）** | ✅ 定性修正：**模型支持视觉，是当初漏下载 projector** |
| 10-27 23:27 | 下载并放置 projector | `curl` 从 ModelScope 拉 `mmproj-F16.gguf`（862 MiB，33 秒，25 MB/s）→ `/models/qwen3.8-flash-next/`；校验 `GGUF` magic + sha256 `1f7b7f0b984cf065c604360c29c8098362ed61b290db0ff12c6f360bb1a8a980` | ✅ 文件就位，**服务未重启，视觉仍未启用** |
| 10-27 23:30:44 | **执行 C6：启用视觉** | unit 加 `--mmproj /models/qwen3.8-flash-next/mmproj-F16.gguf` → `restart`（pid 60600） | ✅ 23:32:16 就绪（92 s）；`modalities: {"vision":true,"video":true,"audio":false}`；journal `loaded multimodal model` |
| 10-27 23:51 | 🔴 客户端反馈"首次很慢"并被取消 | 请求 prompt **38,972 tokens**，prefill 跑到 50.06 s（36,864 tokens，736 tok/s）时 `cancel task` | ✅ 定性：非故障，是 177B 模型算 39k prefill 的固有成本；**中途取消 = 白等** |
| 10-28 00:07 | **执行 C7：prefill 调优** | `-ub 512 → 1024`；新增 `--cache-reuse 256`；重启 94 s（pid 变更） | ✅ 无 OOM；A/B：8k 955.9→991.1 tok/s（+3.7%），24k 935.3→**1081.8** tok/s（**+15.7%**） |
| 10-28 00:09 | C7 副作用核验 | decode 29.71 tok/s（原 29.75，无退化）；cgroup peak 39.2→40.8 GiB；`MemAvailable` 6.89 GB；39k 实测 **1057 tok/s / 33.1 s**（原 ~53 s） | ✅ 保留该配置；journal 无 error/warn |
| 10-28 00:12 | 新增只读工具 | `scripts/prompt-size.sh`：从 journal 解析最近 N 次请求的 `prompt_tokens / prefill 耗时 / tok/s` + 当前 slot 上下文占用 | ✅ `bash -n` 通过；实测输出与 A/B 数据一致（7218→955.9 vs 7260→991.1） |
| 10-28 07:45~08:43 | 下载 Next-80B UD-Q4_K_XL | 46,067,137,312 B；最终 aria2c 8 连接，平均 42 MiB/s | ✅ 上游=本地 SHA256 `49e554f9…c41a56`；早期 curl 自动 retry 重写 `.part` 的问题已修正 |
| 10-28 08:43~08:56 | 首次切换 Next 失败并恢复 | 仅依赖 `Conflicts=`，旧/新模型退出与加载重叠；Next 被 OOM killer 杀死；另有 pts 手工旧配置实例抢占 8081 | ❌ 服务中断后恢复正确 Flash；切换器改为显式 stop+排空进程+alias 健康检查 |
| 10-28 09:01 | 第二次切换 Next | 启动前 `MemAvailable=118 GiB`，确认无其他 llama-server | ✅ 34.8 s 就绪；Next active，Flash enabled 暂保留；无 FA/OOM 警告 |
| 10-28 09:02~09:04 | Flash/Next 同文本 A/B | 两次约 39k + 强制 512 decode；request SHA256 一致；三项沙箱代码/工具任务 | ✅ prefill 2.14×、长 ctx decode 2.18×、短 ctx 2.33×；质量均 3/3；详见 `docs/07-next80-ab.md` |
| 10-28 09:06 | **Next 设为日常默认** | `enable llama-qwen3next` + `disable llama-qwen38`，当前 Next 不重启 | ✅ Next active+enabled；Flash inactive+disabled，保留复杂推理/视觉回退 |
| 10-28 19:19~19:42 | 下载 27B Q6 + mmproj | Q6 25,299,061,664 B；F16 projector 927,607,488 B | ✅ SHA256 与上游一致；Thinking、工具、视觉均可运行 |
| 10-28 19:22~19:24 | Ollama 27B Q4 质量预检 | 工具/区间通过，跨文件 Decimal API 改错 | ⚠️ 2/3；不作为最终结论，保留失败案例给 Q6 复测 |
| 10-28 19:44~19:54 | 27B Q6 xhigh 灰度与性能 | 39k prefill 约 43.9 s；长 decode 约 8.85 tok/s；短 decode 9.59；xhigh 重构长时间未结束 | ❌ 质量交互成本不可接受，降 medium |
| 10-28 20:02~20:06 | 27B Q6 medium 质量复测 | 工具/区间通过；跨文件任务再次同类 API 错误，170.6 s | ❌ 2/3 且显著慢于 Next；**不采用 27B** |
| 10-28 20:07 | **Flash 恢复为质量默认** | 停 27B；安全切换 Flash；`enable llama-qwen38`、`disable llama-qwen3next` | ✅ Flash active+enabled、Next/27B disabled；8081 不变；详见 `docs/08-qwen38-27b-trial.md` |
| 10-28 20:32~20:49 | **Flash 当前生产实测与资源采样** | 两次 39k+512、热缓存、短 decode、Cline 三类任务、五项推理/长上下文、101 次资源采样 | ✅ Cline 3/3、推理 5/5；prefill 1033.52 tok/s、长 decode 25.00、短 decode 29.47；⚠️ MemAvailable 最低 891 MiB、swap 234→5632 MiB；原始数据与报告见 `docs/09-flash-live-test.md` |
| 10-29 09:15~09:17 | **C9：上下文扩至原生最大 262144** | 等 slot 空闲后备份并重启；`-c 196608→262144`，其余参数不变 | ✅ `/props` 与 `/v1/models` 均为 262144；HTTP 200；无 FA 警告；MemAvailable≈8.9 GiB、swap≈3.7 GiB；证据 `/root/lnsc-ab/ctx262144/` |
| 10-30 07:43~08:06 | 双机网络/SSH/NCCL 基础验证 | 双子网双向 ping、双向 root SSH；NCCL 2.31.2/tests 2.19.7 构建；1GB all_gather OK；RoCE `NET/IB` 生效 | ✅ 基础链路可用；RDMA 单连接约 97.4 Gb/s；生产 Flash 常驻时 2GB 压测出现 swap 抖动，已停止 |
| 10-30 08:06 | **按用户要求停止 DGX-1 生产模型** | `systemctl disable --now llama-qwen38` | ✅ inactive+disabled、8081 释放、无残留 llama-server；MemAvailable≈118 GiB，为双机部署腾空间 |
| 10-30 08:10~08:20 | NCCL 全量与 RoCE 诊断 | 16GB all_gather 数据校验 OK；显式 `NCCL_IB_HCA` 后日志确认 RoCE；原始 `ib_write_bw` 约 97.4 Gb/s | ⚠️ NCCL busbw≈3.03 GB/s，不作为链路峰值结论；后续以 vLLM/llama.cpp 实际推理验证 |
| 10-30 08:44 起 | **模型路线调整为 ModelScope GGUF + llama.cpp RPC** | `unsloth/GLM-5.3-Flash-GGUF` UD-Q4_K_XL（185.99 GiB / 6 shards）+ F16 mmproj；当前 build 已确认 `glm5_next` + MTP；RPC 使用 CUDA 13.2 构建 | 🟡 下载与构建中；NVIDIA FP4-Local/vLLM 路线不再作为当前首选 |
| 10-30 09:29 | **RPC/RDMA 分布式冒烟通过** | worker 独立构建 `ggml-rpc-server`；head 补建 RPC 版 `llama-server`；小 GGUF 分布式加载，API 返回 `OK`；worker 日志 `RDMA activated / RoCEv2` | ✅ 双机推理链路可用；冒烟实例已停止，保留构建产物 |
| 10-30 09:35 | netplan 持久化失败并回滚 | `netplan apply` 重载网络导致地址暂时丢失；删除新增 netplan 并恢复 NetworkManager 与临时地址 | ✅ 管理网与私网恢复；改用独立 `lnsc-cx7-addresses.service` 固化，不再调用 netplan |
| 10-30 11:29~14:20 | GLM-5.3 上游兼容性排查 | 旧 build 经小列数 softmax 修复可 health OK，但 MoE 推理出现 `ggml_cuda_mul_mat_q` / RPC 错误；`split-mode=row` 不支持 RPC；撤销临时 ids 补丁并升级上游 `e0f142d5d`，两端重新构建 | ⚠️ 上游新 build 尚未完成推理验收，不视为部署成功 |
| 10-30 14:20 后 | **按用户要求暂停试验并禁用 Wi-Fi** | 停止并 disable `llama-glm53-rpc` 与 `ggml-rpc`；两台 `wlP9s9` DOWN；完成 `docs/14-glm53-rpc-implementation-plan.md` | ⏸️ 当前无 Cline 模型端点；后续按阶段 A→B→C 等用户确认后执行 |
| 10-27 23:16 | 自启隐患记录 | `ollama.service` 同为 `enabled`，重启后也会起（当前不载模型）；尚未做真实 reboot 演练 | 🟠 需在窗口内验证一次 reboot；ollama 待 C4 |

---

## 三、当前风险状态（滚动更新）

| 风险 | 等级 | 状态 | 处置入口 |
|---|---|---|---|
| ~~`MemAvailable` 449 MiB~~ | 🟢 已解除 | 重启释放累计 anon，现 8.5 GiB；swap 几乎未动 | 观察 |
| ~~进程挂在 `pts/2`，`SIGHUP` 未忽略~~ | 🟢 已解除 | 已由 systemd 托管（pid 58398，journal 落盘） | — |
| ~~`Pss_Anon` 持续增长（~8 GiB/20min）~~ | 🟠 中 | 重启后 anon 27.9 GiB（较 39.2 释放 11 GiB）；**仍需验证是否继续线性增长** | 30 分钟观察曲线（见第五节观察项 1） |
| ~~上下文余量 13.8k 且递增~~ | 🟢 已解除 | C9 已扩至原生最大 `-c 262144` | — |
| ~~启动日志未落盘~~ / ~~`--metrics` 未开启~~ | 🟢 已解除 | journal + `/metrics` 均可用 | — |
| ollama `0.0.0.0:11434` + `KEEP_ALIVE=-1` | 🟠 中 | 未处置 | C4 |
| ~~`qwen3.8-flash-next` 不支持图片~~ | 🟢 已解除 | **C6 已启用**：`--mmproj` 加载成功，`vision:true` `video:true`，真图识别验证通过 | — |
| 视频输入已开启但无人管 | 🟡 低 | `video:true` 是 mmproj 附带能力；视频帧 token 消耗极大（几十帧 = 数万 token） | 客户端/文档侧提醒节制 |
| `swappiness=60` | 🟡 低 | 未处置（`MemorySwapMax` 不可用，此项现在是抑制 swap 的唯一手段） | C1 |
| `MemoryMax` 管不到 GPU 设备内存 | 🟠 中 | 实测 cgroup 仅 30 GiB，权重在设备侧；限额只能兜住 anon/页缓存 | 靠监控 + 定期重启（待评估） |
| Flash 常驻内存/swap 压力 | 🟢 日常已缓解 | 默认改为 Next 后 `MemAvailable≈68 GiB`、swap 83 MiB；切回 Flash 时风险重新出现 | 仅硬任务短时切 Flash，监控 swap |
| Next 无视觉 | 🟡 低 | `vision:false`；图片请求不能直接用于当前默认 | `model-switch.sh flash` |
| 模型切换重叠/手工实例抢占 | 🟢 已修正 | `model-switch.sh` 显式排空旧进程、拒绝额外实例、校验目标 alias | 禁止并行手工启动；用统一切换入口 |
| `--host 0.0.0.0` 且无 `--api-key` | 🟡 低 | 内网任何人可用，`/metrics` 同时暴露 | 评估加 `--api-key` 或防火墙 |

---

## 四、待执行变更队列（冻结中，解冻后按序）

| 顺序 | 变更项 | 需窗口 | 预计 | 状态 |
|---|---|---|---|---|
| 1 | C2 重启 + systemd + `--metrics` | **是** | 1~3 分钟 | ✅ 10-27 23:01 完成 |
| 2 | C3 上下文 131072 → 196608（`-ctk q8_0 -ctv q8_0`） | **是** | 同上合并 | ✅ 10-27 23:01 完成 |
| 3 | 观察 30 分钟 `Pss_Anon` / `MemAvailable` 曲线 | — | 30 分钟 | ⏳ 待做（见第五节） |
| 4 | C1 `swappiness` | 否 | 5 秒 | ⏳ 可随时 |
| 5 | C4 `ollama-isolate` | 否（ollama 空闲） | 5 秒 | ⏳ 可随时 |
| 6 | 监控落地（logrotate + metrics cron） | 否 | 5 分钟 | ⏳ 待批准 |
| 7 | **C8 双机 GLM-5.3 / vLLM TP2** | **是，按 P1~P8 分窗口** | 网络/NCCL/下载/验收分阶段 | 🟡 **文档完成，部署未开始**（见 `docs/10~13`） |
| 8 | C9 上下文 196608 → 262144 | 是，约 2 分钟 | 原生最大，KV +1.5 GiB | ✅ 10-29 09:17 完成 |

> 解冻条件：无活跃请求 + 已通知使用者 + 已选定窗口（见 `03-change-plan.md` 第七节）。

---

## 五、待观察项（需要数据才能定性）

1. `Pss_Anon` 的增长是"每次新请求上升"还是"随时间线性上升"？
   - 判据：对比 `metrics.csv` 里 `prompt_tokens` 变化点与下一行的 `mem_avail_mb`
2. 换 `-ctv q4_0` + 重启后，增长速度是否变化？（若只是 KV 相关，应明显变慢）
3. 长请求（>100k prompt）时 `n_ubatch=512` 的 prefill 实际速度（迁移 systemd 后可从 journal 读到）
4. GPU 满载时是否降频（当前空闲 2411/3003 MHz，需要在满载时采样）

采集这四项所需命令都在 `docs/02-runbook.md` 与 `docs/04-monitoring.md`。