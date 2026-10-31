# 11 · 双机验证、A/B 与调优矩阵

> 原则：先证明链路和功能正确，再测速度；先官方默认，再一次只改一个变量。任何“通过”必须有原始文件。

## 1. 数据目录与命名

```text
benchmark-results/two-node-glm53/<YYYYMMDD-HHMMSS>-<阶段>/
  inventory-head.json / inventory-worker.json
  network-head.txt / network-worker.txt
  ssh-validation.log / nccl-all_gather.log
  container-digest.txt / model-revision.txt
  api-health.json / api-models.json / api-chat.json / api-tools.json
  perf-summary.json / quality-summary.json / reasoning-summary.json
  monitor-head.csv / monitor-worker.csv / network.csv
  summary.json / report.md / commands.log
```

原始响应必须保留；token、密钥、内部源码和敏感 prompt 不进入公开报告。

## 2. 分层验证矩阵

| ID | 验证 | 通过判据 | 证据 |
|---|---|---|---|
| V0 硬件 | 两节点同 128GB、QSFP 正确、磁盘充足 | `ibdev2netdev` 链路 Up、速率符合预期 | 两节点 inventory |
| V1 网络/SSH | 私网地址、路由、MTU、双向 SSH | ping/SSH 全通；无管理网误改 | network + ssh log |
| V2 NCCL | 官方 all_gather，多 buffer 复测 | 无 timeout/拓扑错误；带宽可复现 | nccl-all_gather.log |
| V3 供应链 | 镜像、checkpoint、版本一致 | digest/revision 固定，两节点一致 | digest + revision |
| V4 服务 | worker→head，API、流式、工具 | `/health` 正常；模型 ID 正确；自动工具调用成功 | api-*.json |
| V5 性能 | 冷/热 prefill、长短 decode、MTP | 与当前 Flash 同口径数据齐全 | perf-summary.json |
| V6 质量 | Cline、推理、长上下文 | 不劣于当前 Flash；真实任务无严重回退 | quality/reasoning |
| V7 稳定性 | 并发 1/2/4、30 分钟、故障恢复 | 无 OOM/NCCL 错误/持续 swap 增长 | 三份 CSV + 日志 |
| V8 Cline 验收 | 真实 VSCode+Cline 工作流 | 少人工接管、结果可接受、仅 head 端点 | 验收记录 |

任一底层阶段失败，不执行后续高负载测试。

## 3. 性能 A/B（与当前 Flash 对齐）

### 固定条件

- 同一模型服务先空闲，记录是否有其他请求；`--parallel`/active sequences 明确。
- 相同请求文本、context、输出上限、采样参数；同一批唯一 nonce。
- 使用 llama.cpp/vLLM 各自 timings，同时记录客户端 wall time；排队不得算成纯计算。
- 冷测试至少 2 次，热缓存、短 prompt、长 prompt 分开。

### 指标

| 类别 | 必记字段 |
|---|---|
| prompt | 文本 SHA256、实际 prompt_tokens、cache tokens、新增 tokens |
| prefill | ms、tok/s、TTFT |
| decode | 强制 512 tokens 的 ms、tok/s；长/短上下文分别记录 |
| 总成本 | wall time、reasoning tokens、最终答案 tokens、排队时间 |
| MTP | 是否启用、draft 数、接受率（若后端提供） |
| 资源 | 每节点 MemAvailable、swap、cgroup、GPU util/clock、链路利用率 |
| 可靠性 | HTTP 错误、NCCL 错误、取消、worker 重启、OOM |

官方 33.94 tok/s 仅作参考；本地结果必须与当前 Flash 的 25.00/29.47 tok/s 同口径比较。

## 4. 质量与长上下文

1. 复用 `ab-quality.py`：工具调用、区间修复、跨文件 Decimal 重构；代码只在降权沙箱运行。
2. 复用 `reasoning-suite.py`：数学、逻辑、SQL/NULL、中文 NLU、23k 记录检索。
3. 长上下文按阶段：64k→131k→262k→官方 500k；每阶段先做 needle/多跳检索，再做真实仓库任务。
4. 至少 5 个当前真实失败案例：记录根因、无关修改、测试、人工接管次数、总耗时。
5. 视觉/视频单独验收，不把文本通过当作多模态通过。

质量门槛：核心任务不得比 Flash 退步；若只提升官方分数而真实 Cline 仍需频繁接管，不进入生产默认。

## 5. 调优矩阵（每次只改一项）

| 顺序 | 变量 | 初始值 | 实验方向 | 何时回滚 |
|---|---|---|---|---|
| T0 官方基线 | 固定 recipe | 原样 | 必须先留档 | 不适用 |
| T1 推理档位 | 官方默认 max | high / low（仅明确目标） | 质量下降或耗时不合理即回退 |
| T2 MTP | 5 tokens | 0 做消融，再恢复比较 | 接受率低/结果异常/速度反降 |
| T3 active sequences | 1（隔离）→4（官方） | 比较并发与单请求延迟 | 排队/内存/错误明显上升 |
| T4 context | 131072 | 262144→500000 | KV 压力、长检索退化或 swap 增长 |
| T5 batched tokens | 4096 | 仅一项上下调整 | prefill 无收益或 decode 受损 |
| T6 GPU memory utilization | 0.87 | 小步调整并留安全余量 | OOM/缓存不足/频繁重载 |
| T7 网络参数 | 保持 recipe | 仅在 NCCL 证据支持时调 | 带宽下降/超时/不稳定 |

禁止同时改模型、量化、容器、TP、MTP、batch 和网络；禁止用降低量化掩盖配置问题。

## 6. 生产准出门（建议）

- 功能：chat、stream、reasoning、automatic tool calling 全部通过。
- 质量：Cline/推理不低于 Flash；真实失败案例有明确改善。
- 速度：decode 目标先以 ≥30 tok/s 为参考；若低于当前 Flash 且质量无显著收益，不上线。
- 稳定：30 分钟无 OOM/NCCL 致命错误；各节点 MemAvailable 目标 ≥2 GiB；无持续 swap 增长。
- 运维：启停顺序、监控、回滚、版本 digest、原始数据齐全。
- 验收：实际 Cline 使用者确认“总完成时间和人工接管次数可接受”。

未过门：保留为实验服务，不改变当前生产默认。
