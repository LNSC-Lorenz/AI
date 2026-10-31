# 18 · RDMA 与 NCCL/GDR 分层排查

> 日期：2026-10-30  
> 结论：**RDMA 聚合带宽基本可用；当前没有可用 GDR 路径。后续复核表明 iGPU 的 GDR_SUPPORTED=0 可能是平台行为，需优先排查 DGX OS/驱动整栈，见文档 20。**

## 1. 网络/RDMA 层

### 版本与硬件路径

| 项目 | head | worker |
|---|---|---|
| kernel / mlx5_core | 6.17.0-1021-nvidia | 6.17.0-1014-nvidia |
| ConnectX firmware | 28.45.4028 | 28.45.4028 |
| rdma-core / libibverbs | 50.0-2ubuntu0.2 | 50.0-2ubuntu0.2 |
| perftest | 24.01.0 | 24.01.0 |
| PCIe | 32 GT/s x4，两个 HCA 相同 | 32 GT/s x4，两个 HCA 相同 |

虽然 kernel/mlx5 小版本不同，但固件、rdma-core、PCIe 和两个端口的实测表现一致，当前没有证据支持“网络驱动不同是主因”。

### 原始 RDMA Write，1 MiB 消息

| 测试 | 平均带宽 |
|---|---:|
| 端口 1，1 QP | 97.17 Gb/s |
| 端口 1，2 QP | 98.53 Gb/s |
| 端口 1，4 QP | 99.63 Gb/s |
| 端口 2，4 QP | 99.63 Gb/s |
| 两个逻辑接口并发（同一物理 QSFP） | 92.60 + 92.58 = **185.18 Gb/s** |

判断：

1. 单端口约 100 Gb/s 不能再用“单 QP 限制”解释。
2. 两个逻辑接口并发可达到约 185 Gb/s，说明单 DAC 下的 RoCE、RDMA 和聚合数据路径基本可用。
3. NCCL 只有约 3 GB/s busbw，不能仅由原始网络带宽解释。
4. 没有修改链路、驱动或固件。

证据：`/root/lnsc-ab/two-node/rdma-p1-q*.log`、`rdma-p2-q4.log`、`rdma-dual-p*.log`

## 2. NCCL/GDR 层

### 已排除的简单开关

- `NCCL_NET_GDR_LEVEL=PHB`：GDR 仍 Disabled。
- `NCCL_NET_GDR_LEVEL=SYS`：GDR 仍 Disabled。
- `nvidia-peermem`：两台均 `modprobe: Invalid argument`，最终未加载。
- NCCL 2.28.3 与 2.31.2：均为约 3 GB/s，不是版本差异。

### 内核 DMA-BUF 与 CUDA 能力分离测试

直接调用 `ibv_reg_dmabuf_mr`，使用 NCCL 同样的 dummy fd=-1 探测口径：

```text
head rocep1s0f1:   errno=9 (Bad file descriptor)
head roceP2p1s0f1: errno=9 (Bad file descriptor)
worker rocep1s0f1:   errno=9 (Bad file descriptor)
worker roceP2p1s0f1: errno=9 (Bad file descriptor)
```

对该探测而言，`EBADF` 表示入口和内核 DMA-BUF 路径存在；`EOPNOTSUPP/EPROTONOSUPPORT` 才表示不支持。因此**两端内核/verbs DMA-BUF 路径可用**。

CUDA Driver API 直接查询：

```text
head:   CUDA_DMA_BUF_SUPPORTED=0, cuResult=0
worker: CUDA_DMA_BUF_SUPPORTED=0, cuResult=0
```

这表示当前 CUDA/GB10 驱动栈不允许将 CUDA buffer 通过 DMA-BUF 导出给 RDMA 使用。通用 `ibv_reg_dmabuf_mr` 虽存在，但没有可导出的 CUDA DMA-BUF，NCCL 仍无法建立 GDR。

日志中的 `mlx5dv_reg_dmabuf_mr / MLX5_1.25` 缺失不是当前首要原因：通用 `ibv_reg_dmabuf_mr` 已存在且内核探测通过；真正的阻断点是 CUDA 返回 0。

证据：

- `/root/lnsc-ab/two-node/gdr-dmabuf-head.log`
- `/root/lnsc-ab/two-node/gdr-dmabuf-worker.log`
- `/root/lnsc-ab/two-node/nccl-gdr-sys-diagnostic.log`

## 3. 综合判断

当前链路可概括为：

```text
RDMA 网络层：可用，单 DAC 双逻辑接口聚合约 185 Gb/s
        ↓
内核 verbs DMA-BUF：支持
        ↓
CUDA buffer DMA-BUF 导出：不支持（两端的属性均为 0）
nvidia-peermem 备选路径：不可加载
        ↓
NCCL：GPU Direct RDMA Disabled，退回 host/staging
        ↓
16 GiB all-gather 仅约 3 GB/s busbw
```

因此当前最直接的 NCCL 瓶颈是 **CUDA/平台没有可用 GDR 数据路径**，不是单纯 QSFP 链路、NCCL 版本或 mlx5 驱动差异。

后续扩展能力位查询显示两台均为 INTEGRATED=1、GPU_DIRECT_RDMA_SUPPORTED=0，而 HOST_ALLOC_DMA_BUF_SUPPORTED 在 head/worker 分别为 0/1；同时 worker 仍为官方提到多节点性能回退的 DGX OS 7.4.0。故不能仅凭本报告早先的 DMA-BUF=0 就断言平台故障，应优先按文档 20 核对并统一 Dell 认可的 DGX OS/驱动整栈。

## 4. 对 Qwen 的决定

Qwen TP=2 会继承同一 NCCL/GDR 限制，**Q1 长下载继续暂缓**。

下一步应先核对 NVIDIA 针对 GB10 的 GDR/DMA-BUF 支持矩阵和认证驱动组合。只有在有官方依据和回滚方案后，才考虑驱动/DGX OS 变更；容器升级无法改变这个 host CUDA 属性。
