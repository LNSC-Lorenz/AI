# 16 · 双节点 NCCL 性能复核与单变量调优

> 日期：2026-10-30  
> 节点：DGX01-2512 / DGX02-2603  
> 结论：**功能正确，但当前约 3 GB/s busbw；已试参数均无实质改善，暂不进入 Qwen Q1 长下载。**

## 1. 测试口径

- NCCL：`v2.31.2-1`，commit `7b83616df3ae082a1f32bb74c27458bfe8153a13`
- nccl-tests：`1a65d7f0514b8da6a61ae235d1c5f38549478e29`
- 编译目标：`compute_121 / sm_121`
- 测试：`all_gather_perf -b 16G -e 16G -f 2`
- 用户确认一根 DAC；系统识别两个 200 Gb/s QSFP 接口，RoCEv2
- 除 GDR 诊断外均使用 20 iterations 和数据校验
- Dell 单 DAC 对照参考：`22.2623 GB/s busbw`（双电缆 `25.6128` 不适用）

原始日志位于 `/root/lnsc-ab/two-node/`。

## 2. 单变量结果

| 测试 | busbw GB/s | 相对基线 | 数据校验 | 决定 |
|---|---:|---:|---|---|
| MTU 1500 基线复测 | 3.02651 | — | 0 wrong | 与历史 3.0271 一致 |
| 临时 MTU 9000 | 3.03319 | +0.22% | 0 wrong | 无效，恢复 1500 |
| QP per connection=4 | 3.04993 | +0.78% | 0 wrong | 不采用 |
| max channels=8 | 3.10857 | +2.71% | 0 wrong | 略升但远未达标，不视为修复 |
| QP=4 + split data on QPS=1 | 3.03815 | +0.38% | 0 wrong | 不采用 |
| GDR_LEVEL=PHB，1 GiB 诊断 | 3.04931 | 非长测 | 0 wrong | GDR 仍 Disabled，不扩展长测 |

这些变化都不足以把 3 GB/s 提升到 Dell 的约 25.6 GB/s，因此没有把任何临时参数持久化。

## 3. 已确认事实

1. 两个 RoCE HCA 都参与通信，NCCL 日志明确包含 `rocep1s0f1` 和 `roceP2p1s0f1`。
2. RoCEv2、GID 3、200000 Mb/s 链路正常；数据校验始终通过。
3. MTU 9000 jumbo ping 在两个子网均成功，但对 NCCL 性能几乎无影响。
4. 默认建立 64 channels；限制到 8 只带来约 2.7% 改善。
5. 所有 HCA/网络插件路径均报告 `GPU Direct RDMA Disabled`。
6. 两台 `nvidia-peermem` 模块均存在但初始未加载；临时 `modprobe` 都返回 `Invalid argument`，已确认最终仍未加载。
7. `NCCL_NET_GDR_LEVEL=PHB` 不能启用 GDR，因此未继续强行调整 GDR 参数。
8. 网卡计数器未显示与 8 倍带宽差距相符的丢包/CRC/discard；不能把问题归因于物理误码。
9. NCCL commit 和 sm_121 编译目标正确，但用户空间构建存在差异：head 为 CUDA 13.2，worker 为 CUDA 13.0；驱动也分别为 595.71.05 / 580.142。

**GDR Disabled 是重要线索，但当前证据不足以断言它是唯一根因；GB10 统一内存路径需要按 NVIDIA 支持方式进一步验证。**

## 4. 回滚状态

- 两台两条 QSFP 均已恢复 MTU 1500。
- `nvidia-peermem` 未加载。
- QP/channel/split/GDR 环境变量只存在于对应测试进程，没有写入系统配置。
- 没有残留 `all_gather_perf` 进程。
- GLM/RPC 服务保持 inactive。
- worker 的 Dify 等业务容器未被停止或修改。

## 5. 证据文件

```text
nccl-tune-baseline-1500.log
nccl-tune-mtu9000.log
nccl-tune-qp4-1500.log
nccl-tune-channels8-1500.log
nccl-tune-qp4-split1-1500.log
nccl-tune-gdr-phb-diagnostic.log
nccl-tune-mtu-before-head.txt
nccl-tune-mtu-before-worker.txt
```

## 6. 是否进入 Q1

**当前决定：暂缓 Q1 长下载。**

理由：Qwen TP=2 对集合通信敏感。当前功能虽正确，但通信带宽只有 Dell 单电缆参考约 14%，直接下载并启动大模型很可能得到“能运行但性能不可用”的结果，且会混淆模型与网络问题。Dell 2.28.3 对照结果见 `docs/17-dell-nccl228-comparison.md`。

下一阶段如需继续，应单独确认以下一种路线：

1. **推荐：Dell 对照构建**。在独立目录构建 NCCL 2.28.3，统一两端 CUDA 工具链和编译参数，与当前 2.31.2 做同口径 A/B；不覆盖现有库。
2. 统一 CUDA 13.0 用户空间后重建当前 NCCL 2.31.2，排除两端构建差异。
3. 明确接受当前带宽，仅以功能验证为目的进入 Q1；不得预设性能可接受。

以上构建/下载均可能超过 5 分钟，执行前必须显示 `⚠️⚠️【长时操作预警】` 并等待确认。
