# 10 · 两台 DGX Spark 直连部署主计划（GLM-5.3-Flash / vLLM TP2）

> 状态：**文档与基线准备阶段，尚未执行双机部署**。
> 当前生产仍是单机 `llama-qwen38`（Flash-Next，8081）。本计划不授权停机、改网或覆盖现有服务。
>
> **2026-10-30 当前状态**：优先采用 **ModelScope GGUF + llama.cpp RPC**。模型已下载，上游 `e0f142d5d` 已在两台构建；基础 RPC/RDMA 冒烟通过，但 GLM-5.3 MoE 推理尚未验收。**当前暂停试验，等待用户按 [14](14-glm53-rpc-implementation-plan.md) 分阶段确认；不得连续自动执行后续阶段。只使用有线网络，Wi-Fi 已禁用。**

## 1. 目标与边界

目标：两台 128GB DGX Spark 通过 200GbE QSFP 直连，以官方 vLLM recipe 运行一个逻辑模型服务，提升 Cline 复杂编程、推理、长上下文与并发体验。

- Cline 只连接 head `:8000/v1`；worker headless，不对客户端暴露第二个模型。
- 采用 `nvidia/GLM-5.3-Flash-FP4-Local`，不是把现有 GGUF 强行拆成两台。
- 先验证网络和工具链，再下载大 checkpoint；先官方默认参数，再一次只调一个变量。
- 双机是一个 TP2 逻辑实例；禁止额外启动第二份副本或独立测试模型。
- 保留单机 Flash 回退路径；双机未通过验收前，不改生产默认。

## 2. 已知基线（禁止混写）

| 数据 | 来源 | 数值 |
|---|---|---|
| 当前 Flash 39k prefill | 本机 2026-10-28 实测 | 37.712 s / 1033.52 tok/s |
| 当前 Flash decode | 本机实测 | 长上下文 25.00、短上下文 29.47 tok/s |
| 当前功能质量 | 本机实测 | Cline 3/3、推理 5/5 |
| 当前资源风险 | 本机 101 次采样 | MemAvailable 最低 891 MiB；swap 234→5632 MiB |
| GLM-5.3 双机 decode | **NVIDIA 官方 2026-10-16 实测** | **33.94 tok/s** |
| GLM coding E2E | NVIDIA SPEED-Bench，非本机数据 | 1216.70 s |

官方数据仅作参考，不是本集群验收结果。

## 3. 官方架构与模型

```text
Cline → DGX-1/head:8000/v1
          vLLM rank 0 + 本地模型分片
              ↕ 200GbE / RoCE / NCCL
        DGX-2/worker（headless）
          vLLM rank 1 + 本地模型分片
```

模型：GLM-5.3-Flash，320B 总参数、18B 激活，原生多模态，混合稀疏/线性注意力。
官方 recipe 核心值：

| 项 | 初始值 |
|---|---|
| checkpoint | `nvidia/GLM-5.3-Flash-FP4-Local` |
| container | `eugr/spark-vllm-b12x:nightly-20261015`（官方文档引用的社区 ARM64/B12X 镜像） |
| 并行 | `tensor_parallel_size=2`、`pipeline_parallel_size=1` |
| 精度 | FP4-Local / `modelopt_mixed`；KV `fp8` |
| 上下文 | 官方 500000；验收时从 131072 分阶段提升 |
| 序列 | 官方 `max_num_seqs=4`；性能隔离测试先用 1 |
| batch | `max_num_batched_tokens=4096` |
| MTP | `num_speculative_tokens=5` |
| parser | reasoning `glm45`；tool `glm47`；auto tool choice |
| 显存预算 | `gpu_memory_utilization=0.87`，未经数据不先改 |
| 其他 | prefix caching、chunked prefill、B12X backend |

## 4. 部署前 inventory（全部填写后才允许变更）

| 项 | DGX-1/head | DGX-2/worker |
|---|---|---|
| hostname / 管理 IP | 待填 | 待填 |
| root/sudo 与相同用户名 | 待填 | 待填 |
| DGX OS / kernel | 待填 | 待填 |
| driver / CUDA / firmware | 待填 | 待填 |
| 统一内存（应相同） | 128 GB | 128 GB |
| 本地盘剩余空间（目标 ≥600 GiB） | 待填 | 待填 |
| ConnectX 端口/子接口 | 待填 | 待填 |
| QSFP 链路与协商速率 | 待填 | 待填 |
| RoCE HCA / GID / MTU | 待填 | 待填 |
| 容器 runtime / `docker info` | 待填 | 待填 |
| HF_TOKEN 获取方式（只记录位置，不记密钥） | 待填 | 待填 |
| 当前生产服务与回滚 owner | Flash-Next | 不应有生产模型 |

版本原则：对齐官方参考环境（driver 580.159.03、CUDA 13.0.88、recipe 镜像 20261015）；验收期间不升级驱动/CUDA/容器/模型。

## 5. 阶段与准出门

| 阶段 | 工作 | 准出门 | 状态 |
|---|---|---|---|
| P0 文档与基线 | 本框架、单机原始数据、官方 recipe 固化 | 评审通过 | 已完成 |
| P1 物理与配置备份 | QSFP 直连、两节点快照、备份 netplan/SSH/服务 | 可回滚、无生产中断 | 未开始 |
| P2 网络/SSH | 推荐 NVIDIA Sync Cluster Assistant；或官方手工 netplan | 双链路 IP 正确、互通、SSH 双向免密 | 未开始 |
| P3 NCCL | 按官方 NCCL playbook 构建/测试 | 保存 all_gather 日志与带宽；无错误/异常拓扑 | 未开始 |
| P4 镜像/模型 | 固定 digest/revision；两节点缓存；校验磁盘与权限 | 下载完整、来源可追溯、无密钥泄漏 | 未开始 |
| P5 worker→head | 严格官方 recipe；worker 先起，head 后起 | `/health`、`/v1/models`、日志无致命错误 | 未开始 |
| P6 API/Cline | chat、stream、reasoning、automatic tool calling、按需视觉 | Cline 只连 head 且工具调用成功 | 未开始 |
| P7 A/B 与调优 | 按 11 文档执行，保存原始 JSON/CSV | 质量过线、速度可接受、可回滚 | 未开始 |
| P8 生产交接 | 文档、监控、启停顺序、回滚演练、负责人签字 | 才允许替换默认端点 | 未开始 |

## 6. 网络与安全底线

- 使用同型号 CX7 对应端口；双子接口放不同子网，具体地址以现场 inventory 为准，不照抄示例。
- 推荐 Sync Cluster Assistant；成功后不要重复手工 netplan/SSH 步骤。
- RoCE/NCCL/容器端口只允许双机私网；不得暴露办公网或公网。
- `privileged` 容器、host network、host IPC 仅允许固定官方 recipe，需记录镜像 digest。
- HF_TOKEN 不进 README、命令日志、JSON、CSV 或 Git。
- 不先启用 jumbo MTU；先按官方默认验证，调优另开变更单。

## 7. 回退与禁止事项

- 任一节点网络异常、NCCL 失败、worker 反复重启、模型质量不达标：停止两节点容器，不继续调参。
- 回退时先停止新增服务，再按既有 `model-switch.sh flash` 恢复单机；禁止两个生产栈同时抢流量。
- 禁止：双 head、worker 对 Cline 开放、未固定版本升级、边下载边验收、用 Q3/超低量化替代官方 FP4 recipe。
- 所有实际动作与结果写入 `docs/13-two-node-changelog.md`；计划不写成已完成。

## 8. 官方依据

- 双机直连：https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/playbook-connect-two-sparks
- NCCL：https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/playbook-nccl
- vLLM 双机：https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/playbook-vllm-cluster
- GLM recipe：https://github.com/NVIDIA/dgx-spark-playbooks/blob/main/nvidia/playbook-vllm-cluster/assets/glm53-flash-2x128gb.yaml
- 性能与目录：https://nvidia.github.io/local-ai-inference-recipes/hardware/dgx-spark-2gpu/
- Sync：https://docs.nvidia.com/sync/latest/cluster-assistant.html
- 模型卡：https://huggingface.co/zai-org/GLM-5.3-Flash
