# 13 · 双机部署 Changelog / 调优与事故留痕

> 只记录已发生事实；计划放 10/11 文档。没有证据编号或原始文件的“完成”视为未发生。

## 1. 阶段状态

| 阶段 | 状态 | 时间/负责人 | 证据路径或说明 |
|---|---|---|---|
| P0 文档与单机基线 | ✅ 已建立 | 2026-10-28 | 10~12 文档；`docs/09-flash-live-test.md` |
| P1 物理连接与备份 | ✅ 已完成 | 2026-10-30 | QSFP 两条 200GbE Up；netplan/服务备份在 `/root/lnsc-ab/two-node/` |
| P2 网络与 SSH | ✅ 已完成 | 2026-10-30 | 双子网双向 ping；双向 root SSH；证据 `P2-network/` |
| P3 NCCL | ⚠️ 功能通过，性能待调优 | 2026-10-30 | NCCL 2.31.2 + tests 2.19.7 构建成功；all_gather 数据校验 OK；RDMA 97.4 Gb/s、NCCL busbw 3.03 GB/s，需以模型性能继续评估 |
| P4 镜像与模型 | 🟡 模型下载完成，校验/上游构建待复核 | 2026-10-30 | GLM-5.3 UD-Q4_K_XL + mmproj 已下载；head 7/7 SHA256；worker 文件齐但清单待复核；上游 `e0f142d5d` 两端已构建 |
| P5 worker→head | ⚠️ 基础冒烟通过，GLM MoE 阻塞 | 2026-10-30 | dense GGUF RPC/RDMA 冒烟 OK；旧 build GLM health OK 但 MoE 推理 CUDA/RPC 错误；新 build 未验收 |
| P6 API/Cline | ⏸️ 暂停，等待阶段 A 确认 | 2026-10-30 | head/worker 模型服务均 inactive + disabled；无 Cline 端点 |
| P7 A/B 与调优 | ⏳ 未开始 | 待填 | JSON/CSV、对比报告 |
| P8 生产交接 | ⏳ 未开始 | 待填 | 验收、回滚演练、owner |

## 2. 单次变更记录模板

```text
### YYYY-MM-DD HH:MM · <C8-Px 或 TUNEx> · <执行人>
- 类型: 网络 / 软件 / 模型 / 部署 / 调优 / 故障 / 回滚
- 必要性: 为什么现在做；不做会怎样
- 影响面: 当前流量、预计中断、两节点分别影响
- 前置: 无活跃请求；备份路径；回滚命令已 review
- head/worker 版本: OS= driver= CUDA= container-digest= model-revision=
- 网络基线: 接口/IP/HCA/MTU/配置 SHA256（不得写密钥）
- 实际命令: 见 commands.log（仅可公开部分）
- 变更前: API= 性能= 内存= swap= NCCL= 质量=
- 变更后: API= 性能= 内存= swap= NCCL= 质量=
- 结果: 成功 / 失败 / 已回滚
- 证据: benchmark-results/two-node-glm53/<run-id>/
- 遗留: 下一步、观察时长、负责人
```

## 3. 调优记录

| ID | 唯一变量 | 原值→新值 | 同口径结果 | 资源/副作用 | 决定 | 证据 |
|---|---|---|---|---|---|---|
| T0 | 官方 recipe 基线 | 不变 | 待测 | 待测 | 必须先留档 | 待填 |
| T1 | reasoning_effort | max→待填 | 待测 | 待测 | 待决定 | 待填 |
| T2 | MTP tokens | 5→0 消融 | 待测 | 待测 | 待决定 | 待填 |
| T3 | max_num_seqs | 1→2→4 | 待测 | 待测 | 待决定 | 待填 |
| T4 | max_model_len | 131072→262144→500000 | 待测 | 待测 | 待决定 | 待填 |
| T5 | max_num_batched_tokens | 4096→待填 | 待测 | 待测 | 待决定 | 待填 |
| T6 | gpu_memory_utilization | 0.87→待填 | 待测 | 待测 | 待决定 | 待填 |

每次只改一项；失败后先恢复原值，不连续叠加第二个变量。

## 4. 事故与回滚记录

| 时间 | 现象/影响 | 根因证据 | 临时处置 | 恢复时间与验证 | 是否回滚/后续 |
|---|---|---|---|---|---|
| 待填 | 待填 | 日志路径 | 待填 | 待填 | 待填 |

## 5. 生产验收签字

```text
- 功能与工具调用：通过 / 不通过（证据：）
- 质量不低于 Flash：通过 / 不通过（证据：）
- 性能可接受：通过 / 不通过（数据：）
- 30 分钟稳定与资源：通过 / 不通过（数据：）
- Cline 真实任务验收：通过 / 不通过（人员：）
- 回滚演练：通过 / 不通过（时间：）
- 是否允许替换生产默认：是 / 否
- head owner / worker owner / 审批人 / 日期：
```

未签字前，当前 Flash 继续作为生产默认。
