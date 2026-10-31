# 09 · Flash-Next 当前运行实测记录（2026-10-28 20:32–20:49）

## 范围与原始数据

测试对象：当前生产运行的 `qwen3.8-flash-next`，未修改模型、unit 或采样参数，未重启服务。
DGX 原始目录：`/root/lnsc-ab/flash-live-20261028/`
本地原始目录：`benchmark-results/2026-10-28-flash-live/`

包含每次请求原始 JSON、性能与质量 summary、101 行资源采样 `monitor.csv`、阶段日志和模型/props 快照。

## 性能：两次约 39k cold + 强制 512 decode

| 指标 | 两次均值/结果 |
|---|---:|
| 实际 prompt tokens | 38,976 / 38,976 |
| prefill 时间 | **37.712 s** |
| prefill 吞吐 | **1,033.52 tok/s** |
| 长上下文 decode 512 | **20.441 s / 25.00 tok/s** |
| prefill + decode 纯计算总时长 | **58.153 s** |
| 短上下文 decode 512 | **29.47 tok/s** |
| 同 39k prompt 热缓存 | 只新算 **4 tokens / 183.76 ms** |

两次 cold 的 `wall_s` 为 59.485、68.933 秒，热缓存 `wall_s` 为 48.919 秒；期间有其他 Cline 请求排队，因此**性能均值使用 llama.cpp 的 `prompt_ms` 和 `predicted_ms`，不把全部 wall time 当作纯模型计算时间**。

## Cline 类代码与工具任务

代码在无网络临时目录中，以 nobody 降权执行，限制 CPU/内存/文件数。

| 任务 | 结果 | wall_s（含排队） |
|---|---|---:|
| `read_file` 工具名与路径参数 | PASS | 74.061 |
| 区间合并：空/乱序/嵌套/不可变输入 | PASS | 168.994 |
| 跨文件 Decimal 金额计算与格式化 | PASS | 154.311 |
| 合计 | **3/3** | — |

这些 wall time 同样受真实请求排队影响，不能直接和空闲环境下的历史值比较；正确性由沙箱测试判定。

## 理解、推理与长上下文

| 测试 | 结果 | 关键输出 |
|---|---|---|
| 数学耗时计算 | PASS | before=61.51、after=57.60、saved=3.91，均正确 |
| 四任务逻辑约束排序 | PASS | A→B→C→D |
| SQL `COUNT/AVG/SUM` 的 NULL 语义 | PASS | 3 / 80 / 240 / 5 |
| 中文事件分析 | PASS | client_cancel、无服务端故障、cold_prefill、缓存有效 |
| 长上下文三条记录检索 | PASS | 23,476 prompt tokens；NX-7319、QZ-2048、LM-8864 全对，忽略 DECOY |
| 合计 | **5/5** | — |

## 内存、swap 与 GPU（101 次采样，约 16 分 51 秒）

| 指标 | 起始 | 最低/峰值 | 结束 |
|---|---:|---:|---:|
| `MemAvailable` | 5,451 MiB | **最低 891 MiB** | 5,076 MiB |
| `SwapUsed` | 234 MiB | **峰值/结束 5,632 MiB** | 5,632 MiB |
| llama-server `VmSwap` | — | **峰值 5,221 MiB** | — |
| cgroup current | — | 30,418–35,581 MiB | 31,258 MiB |
| GPU util | — | 峰值 96% | — |
| SM clock | — | 2,411–2,554 MHz | — |

最低点发生在 `20:43:07`：`MemAvailable=891 MiB`、swap=4,413 MiB、cgroup=35,581 MiB、进程 VmSwap=4,051 MiB。
阶段边界检查没有看到这一瞬时值，但逐 10 秒 CSV 完整捕获了它。**没有 OOM、没有服务失败，但确实出现低于 1 GiB 的内存压力和持续 swap 增长。**

## 结论

1. 本组功能测试全部通过：**Cline 类 3/3，理解/推理 5/5**。
2. 性能与历史 Flash 基线一致：39k prefill 约 37 秒，长上下文 decode 约 25 tok/s，短上下文约 29.5 tok/s。
3. 总交互耗时还受两件事影响：其他请求排队，以及 Thinking 输出长度；不能只看 tok/s。
4. **当前主要风险是内存而不是正确性**：高负载下 `MemAvailable` 曾低于 1 GiB，swap 从 234 MiB 增至 5,632 MiB。应避免在真实 Cline 流量期间并行跑重型基准，并持续观察 swap；若再次低于 1 GiB，应停止新任务而不是继续压测。
5. 本轮只测试和记录，未对运行配置做任何优化或变更。
