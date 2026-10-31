# 15 · Qwen3-235B-A22B-FP4 阶段 0 只读预检

> 时间：2026-10-30 15:00 左右  
> 范围：DGX01-2512 / DGX02-2603  
> 结论：**条件通过；可评估 Q1 下载，但 Q2 启动/性能验收前必须处理 NCCL 带宽与 SSH host key 问题。**

## 1. 执行边界

本轮只执行只读检查：没有下载模型、没有拉取镜像、没有启动或停止容器、没有修改网络/SSH/systemd 配置，也没有运行新的 NCCL 压测。

## 2. 节点与资源

| 项目 | head | worker | 判断 |
|---|---|---|---|
| hostname | DGX01-2512 | DGX02-2603 | 已核实 |
| 管理地址 | 10.86.20.57 | 10.86.20.56 | 有线 |
| OS | Ubuntu 24.04.4 LTS | Ubuntu 24.04.4 LTS | 一致 |
| kernel | 6.17.0-1021-nvidia | 6.17.0-1014-nvidia | 不一致，先记录 |
| GPU / driver | GB10 / 595.71.05 | GB10 / 580.142 | 驱动不一致，暂不盲目升级 |
| 统一内存 | 121 GiB，available 118 GiB | 121 GiB，available 117 GiB | 满足双节点评估条件 |
| swap 当前基线 | 743 MiB used | 1.4 GiB used | 后续看增量，不要求绝对为零 |
| Docker | 29.1.3 | 29.1.3 | 一致 |
| 磁盘可用 | 1.3 TiB | 1.5 TiB | 足够模型与容器 |
| host CUDA toolkit | nvcc 12.0 | nvcc 不在 PATH | TensorRT-LLM 容器自包含，暂不安装 |
| TRT-LLM 镜像 | 不存在 | 不存在 | Q1 需要拉取 |
| Qwen 模型缓存 | 未发现 | 未发现 | Q1 需要下载 |
| 8355 端口 | 空闲 | 空闲 | 可按 Dell 初始方案使用 |
| Wi-Fi | DOWN | DOWN | 符合有线约束 |

head 的 `llama-glm53-rpc`、`ggml-rpc`、`llama-qwen38` 均 inactive/disabled；worker 的 `ggml-rpc` inactive/disabled。当前没有 GLM/Flash 模型端点。

**worker 正在运行 Dify、PostgreSQL、Redis、Weaviate、Nginx 等现有业务容器。** 后续只能操作明确命名的 Qwen 容器，禁止 `docker system prune`、批量删除容器或干扰这些服务。预检时 worker load average 约 0.14，未看到 GPU compute process。

## 3. 网络与 SSH

- head QSFP：`192.168.100.10/24`、`192.168.101.10/24`。
- worker QSFP：`192.168.100.11/24`、`192.168.101.11/24`。
- 两个子网双向 ping 均为 0% packet loss。
- 两个 QSFP 链路均为 200000 Mb/s、Full Duplex。
- head→worker root SSH 可用。
- worker→head 使用 `StrictHostKeyChecking=no` 时 key 认证成功；默认 host key 验证曾失败。后续应在核对指纹后固化 host key，而不是长期依赖关闭校验。

## 4. 模型与容器获取条件

### TensorRT-LLM

NGC registry 两节点均可访问；`/v2/` 返回 401 是 registry 的正常认证挑战，不代表网络失败。

Dell 镜像 `nvcr.io/nvidia/tensorrt-llm/release:1.0.0rc3` manifest 可读取，并包含 arm64：

```text
arm64 digest:
sha256:cf146585db31f747685ccb42952e517a33dcca82bb3083a46bdfc057b50b642d
```

Q1 应固定该 arm64 digest，不使用浮动 tag 作为最终证据。

### Hugging Face / 镜像

- head 直接访问 Hugging Face 出现 20 秒超时；worker 直接访问返回 200。
- 两节点访问 `hf-mirror.com` 的 Qwen config 均可响应。
- head 当前 shell 有 `HF_TOKEN` 环境变量；本报告不记录其值。
- 仅验证了小配置文件获取，**尚未验证完整模型仓库下载**。

Qwen config 实测关键字段：

```text
architectures=Qwen3MoeForCausalLM
num_hidden_layers=94
hidden_size=4096
num_experts=128
num_experts_per_tok=8
num_attention_heads=64
num_key_value_heads=4
max_position_embeddings=40960
rope_scaling=null
```

因此初版 Cline context 应限定为 **32768 或 40960**，不能直接套用 GLM 的 131072。`--max_num_tokens 32768` 也不等于已经完成长上下文验收。

## 5. NCCL 性能门槛

已读取现有 16 GiB 日志，本轮没有重新压测：

| 项目 | 当前集群 | Dell 参考 |
|---|---:|---:|
| all_gather 数据校验 | 0 wrong / OK | 0 wrong / OK |
| 16 GiB busbw | 3.0271 GB/s | 22.2623 GB/s（单 DAC） |
| RoCE 双 HCA | 日志确认两个 HCA 均建 QP | 双电缆 |

当前功能正确，但带宽约为 Dell 单电缆参考值的 14%。由于 Tensor Parallel=2 对通信敏感，**不能把“能启动”直接等同于“性能可用”**。

证据：

- `/root/lnsc-ab/two-node/nccl-all_gather-16G.log`
- `/root/lnsc-ab/two-node/nccl-all_gather-16G-roce.log`

## 6. Go / No-Go

| 阶段 | 判断 | 条件 |
|---|---|---|
| Q1 镜像/模型下载 | 条件通过 | 磁盘、arm64 镜像和镜像站可用；先提示长时操作并固定 revision/digest |
| Q2 双节点启动 | 暂缓 | 先复核 NCCL 性能；处理 MPI host key 信任；保护 worker 现有业务 |
| Q3 API 验收 | 未开始 | 等 Q2 成功 |
| Q4 性能/Cline | 未开始 | 初版 context 32768/40960；不得虚标 128k |
| 生产交接 | 不通过 | 当前无 Qwen 运行实例，且无性能/质量证据 |

## 7. 建议下一步

优先做一次独立的 **NCCL 性能复核/调优阶段**，每次只改变一个变量，并与 16 GiB 原始日志对比；确认后再决定是否进入 Q1 长下载。若用户希望先准备模型，也可以仅执行 Q1 下载，但不能自动继续启动模型。

任何预计超过 5 分钟的操作，必须先显示：`⚠️⚠️【长时操作预警】`，说明内容、预计时间和影响范围，再等待确认。
