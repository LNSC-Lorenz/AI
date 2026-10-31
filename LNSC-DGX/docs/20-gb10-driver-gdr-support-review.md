# 20 · GB10 认证软件组合与 GDR 支持复核

> 日期：2026-10-30  
> 结论：**后续已按受控方案将 worker 更新到 kernel 1021 / CUDA 13.2 / driver 580.159.03，NCCL 恢复至约 19.1 GB/s busbw，验证了软件整栈是主要因素。详见文档 21。**

## 1. NVIDIA 当前参考组合

DGX Spark 2026-10 官方发布说明列出：

| 组件 | Founders Edition 当前参考 |
|---|---|
| DGX OS | 7.6.0 |
| GPU Driver | 580.178.04 |
| CUDA Toolkit | 13.0.3 |
| Canonical Kernel | 7.0.0-1019 |

官方特别注明：该版本表只适用于 Founders Edition，GB10 partner 系统可能不同步。当前两台均为 `Dell Pro Max with GB10 FCM1253`，因此不能把 7.6.0 当作可直接强制安装的 Dell 认证版本。

官方更新指南也仅适用于 Founders Edition，并推荐 DGX Dashboard；Dell 设备应采用 Dell/NVIDIA 对该机型提供的更新渠道。

## 2. 当前两台实际组合

| 项目 | head | worker |
|---|---|---|
| DGX OTA | 7.5.0 | **7.4.0** |
| GPU Driver | **595.71.05** | 580.142 |
| CUDA Toolkit | 13.2 | 13.0 |
| Kernel | 6.17.0-1021-nvidia | 6.17.0-1014-nvidia |
| 平台 | Dell GB10 | Dell GB10 |

两端既不是同一组合，也不符合当前 Founders Edition 参考组合。head 的 595 不应被当作 DGX Spark 官方当前 580 认证分支的等效替代。

## 3. 官方多节点性能修复

NVIDIA 2026 年 2 月发布说明明确写有：

> Improved Performance with Multiple DGX Spark Systems: Addressed performance regression noted by some users with multiple connected DGX Spark systems after updating to DGX OS 7.4.0.

worker 当前正是 **DGX OS 7.4.0**，因此该已知问题与本集群直接相关。它不能证明必然就是本机原因，但优先级高于继续猜测 MTU/QP/NCCL 版本。

## 4. CUDA 能力位复核

| 属性 | head | worker | 解释 |
|---|---:|---:|---|
| INTEGRATED | 1 | 1 | GPU 与 host 统一内存 |
| GPU_DIRECT_RDMA_SUPPORTED | 0 | 0 | 当前不暴露传统 nv-p2p GDR API |
| GDR_WITH_CUDA_VMM | 0 | 0 | 当前不支持该 VMM GDR 路径 |
| CUDA_DMA_BUF_SUPPORTED | 0 | 0 | CUDA device buffer 不能走 DMA-BUF 导出 |
| HOST_ALLOC_DMA_BUF_SUPPORTED | **0** | **1** | host pinned buffer DMA-BUF 能力不同 |

因此，`GPU_DIRECT_RDMA_SUPPORTED=0` 与 `INTEGRATED=1` 表明当前 iGPU 平台/驱动不暴露传统 GDR API，**NCCL 日志中的 GDR Disabled 可能是平台行为，而不是单纯配置错误**。

更值得注意的是 host DMA-BUF 能力不同：head=0、worker=1。对统一内存和 host/staging 路径而言，这比单独解读 CUDA_DMA_BUF_SUPPORTED=0 更有区分度，也使整栈驱动组合成为重点。

## 5. 对三个问题的回答

### 认证组合是什么

NVIDIA 当前 Founders Edition 参考是 7.6.0 / 580.178.04 / 13.0.3 / kernel 7.0；Dell GB10 需要以 Dell 实际提供的认证更新为准，不能直接强装该版本。

### 是否有统一内存专用路径

有 C2C 机制，`NCCL_NET_GDR_C2C` 从 NCCL 2.27 起默认已为 1。当前 iGPU 不暴露传统 GDR API，不能简单照搬独显的 nvidia-peermem 方案；host DMA-BUF 与统一内存路径更值得关注。

### 属性为 0 是平台设计还是驱动问题

它是当前平台+驱动组合的真实属性，但不能据此断言硬件永远不支持。两台 GPU_DIRECT_RDMA_SUPPORTED 都为 0，说明它不是 head/worker 驱动不同所单独造成；HOST_ALLOC_DMA_BUF_SUPPORTED 的差异和 DGX OS 7.4.0 已知多节点性能回退，则说明软件整栈仍是最优先的可变因素。

## 6. 建议的受控验证方案

1. 只读查询 Dell Dashboard/厂商更新渠道，记录两台可安装的同一 DGX OS、驱动、CUDA、内核候选版本。
2. 制定维护窗口和恢复方案；worker 运行 Dify 等业务，不能直接重启或 `apt dist-upgrade`。
3. 备份包清单、驱动/内核、恢复镜像、业务和模型配置。
4. 在 Dell 明确支持的渠道下，将两台对齐到同一认证整栈，不使用单机 595 与另一台 580 混搭。
5. 重启后重新查询 CUDA 能力位，再跑同一 16 GiB NCCL A/B。
6. 只有性能恢复后再决定 Qwen Q1；不预设升级一定有效。

官方来源：

- <https://docs.nvidia.com/dgx/dgx-spark/release-notes.html>
- <https://docs.nvidia.com/dgx/dgx-spark/os-and-component-update.html>
- <https://docs.nvidia.com/dgx/dgx-spark/known-issues.html>
