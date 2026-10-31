# 17 · Dell NCCL 2.28.3 对照构建与 A/B

> 日期：2026-10-30  
> 物理说明：用户确认只使用一根 DAC；Dell 对照采用单电缆 `22.2623 GB/s busbw`，不使用双电缆 `25.6128` 作为目标。  
> 结论：**统一 CUDA 13.0 后，NCCL 2.28.3 仍约 3.02 GB/s；版本和 CUDA 差异不是主因。Q1 继续暂缓。**

## 1. 独立构建

未覆盖现有 `/root/nccl/`、`/root/nccl-tests/` 或 NCCL 2.31.2。

| 项目 | 值 |
|---|---|
| NCCL | `v2.28.3-1` |
| NCCL commit | `f1308997d0420148b1be1c24d63f19d902ae589b` |
| nccl-tests | `v2.17.6` |
| tests commit | `da0b547b1b9c6e3b1d4c15578087874522ae3761` |
| 构建目录 | `/root/nccl-2.28.3/`、`/root/nccl-tests-2.17.6/` |
| GPU 目标 | `compute_121 / sm_121` |
| CUDA | 两端统一 13.0.2，nvcc `13.0.88` |
| GCC | 两端 13.3.0 |

worker 使用原有 `/usr/local/cuda-13.0`。head 新增独立 `/opt/cuda-13.0`，从 worker 复制 4.7 GiB 工具链；两端 `nvcc` SHA256 均为：

```text
fbb111f057786ddd10ba723d993cc7dd43abf978b6baa32fedd3c9d806dc79e1
```

没有修改 head 的 `/usr/local/cuda`、CUDA alternatives 或驱动。

## 2. 构建验证

- head、worker 两个 transient build unit 均 `Result=success`、`ExecMainStatus=0`。
- 两端均生成 `libnccl.so.2.28.3` 和 `all_gather_perf`。
- A/B 日志确认：`nccl-headers=22803 nccl-library=22803`。

构建日志：

```text
/root/lnsc-ab/two-node/dell-nccl228-build-head.log
/root/lnsc-ab/two-node/dell-nccl228-build-worker.log
/root/lnsc-ab/two-node/cuda130-copy-head.log
```

## 3. 同口径 A/B

测试：`all_gather_perf -b 16G -e 16G -f 2`，20 iterations，数据校验开启。无 MTU/QP/channel 等临时调优参数。

| 组合 | busbw GB/s | 数据校验 |
|---|---:|---|
| 当前 NCCL 2.31.2 + tests 2.19.7 | 3.02651 | 0 wrong |
| Dell NCCL 2.28.3 + tests 2.17.6 + 统一 CUDA 13.0 | **3.01622** | 0 wrong |
| Dell 单电缆参考 | 22.2623 | 0 wrong |

Dell 对照相对当前基线变化约 -0.34%，属于相同水平。当前带宽约为 Dell 单电缆参考的 13.6%。

证据：`/root/lnsc-ab/two-node/dell-nccl228-allgather16G.log`

## 4. 判断与下一步

1. 可以排除“仅由 NCCL 2.31.2 版本导致”。
2. 可以排除“仅由 head/worker CUDA 13.2/13.0 不一致导致”。
3. 后续分层诊断已定位到 CUDA/平台 GDR 能力断层，见 `docs/18-rdma-gdr-layered-diagnosis.md`。
4. 不继续叠加 NCCL 参数或版本试验，不覆盖当前库。
5. **Qwen Q1 长下载继续暂缓**；若后续仅为功能验证而选择继续，必须明确当前 NCCL 性能未达到 Dell 单电缆参考。
