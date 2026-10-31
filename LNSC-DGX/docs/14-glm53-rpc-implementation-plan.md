# 14 · GLM-5.3 双机 RPC 实施计划与当前状态

> 更新：2026-10-30  
> 状态：**暂停试验，等待用户确认下一阶段**  
> 约束：**只使用有线网络**；管理网走 `enP7s7`，双机 RPC/NCCL 走两条 QSFP；不使用 Wi-Fi。

## 1. 目标与边界

目标是让两台直连 GB10/DGX Spark 共同运行 GLM-5.3，并由 Cline 只连接 head 的 OpenAI API。当前采用 **ModelScope GGUF + llama.cpp RPC**，不是 NVIDIA vLLM FP4-Local。

当前不以“模型能启动”作为完成标准。必须同时通过模型加载、MoE 推理、流式输出、工具调用、长上下文和 Cline 验收，才可交付。

**本文件之后的阶段不会自动连续执行。每一阶段开始前先向用户报告并等待确认。**

## 2. 当前进度

| 项目 | 当前事实 | 状态 |
|---|---|---|
| 双机硬件/版本盘点 | 两台均为 Ubuntu 24.04.4、20 CPU、121 GiB RAM、1.9 TB NVMe、GB10 | 已完成 |
| 驱动/内核 | head：595.71.05 / 6.17.0-1021；worker：580.142 / 6.17.0-1014 | 已记录，不盲目升降级 |
| Docker/OpenMPI | Docker 29.1.3；OpenMPI 4.1.6 | 一致 |
| NCCL | NCCL 2.31.2、nccl-tests 2.19.7 在两台构建；all_gather 数据校验通过 | 已完成 |
| RDMA | 原始 `ib_write_bw` 约 97.4 Gb/s；RPC 冒烟日志确认 `RDMA activated / RoCEv2` | 基础链路通过 |
| 私网 | `.100` 与 `.101` 两个 /24 私网，head `.10`、worker `.11`；由独立 `lnsc-cx7-addresses.service` 配置 | 已完成 |
| Wi-Fi | 两台 `wlP9s9` 均 DOWN | 已禁用 |
| RPC 基础冒烟 | 小型 dense GGUF 双机加载、chat、RDMA 均成功 | 已完成 |
| GLM-5.3 模型 | `unsloth/GLM-5.3-Flash-GGUF` UD-Q4_K_XL，6 shards + F16 mmproj，约 186 GiB | 下载完成 |
| 文件校验 | head 7 个文件均有 SHA256；worker 文件已齐，SHA256 清单尚未全部复核 | 下一阶段复核 |
| llama.cpp | 已升级并构建上游 `e0f142d5d`，含 MMQ/MoE 修复；head 与 worker 均有 RPC 构建 | 已构建，未验收 |
| 正式服务 | `ggml-rpc.service`、`llama-glm53-rpc.service` 已安装 | 均 inactive + disabled |
| GLM 推理 | 旧 build 可加载并 `/health` OK，但实际 MoE 推理发生 CUDA/RPC 错误；上游新 build 尚未完成推理验证 | **阻塞** |
| Cline | 当前没有本地 GLM API；Flash 也保持 inactive + disabled | 未连接 |

## 3. 已安装和保留的内容

### 3.1 两节点网络与系统配置

- head 管理地址：`10.86.20.57/24`；worker 管理地址：`10.86.20.56/24`。
- head QSFP：`192.168.100.10/24`、`192.168.101.10/24`。
- worker QSFP：`192.168.100.11/24`、`192.168.101.11/24`。
- 接口：`enp1s0f1np1`、`enP2p1s0f1np1`。
- 两节点私网地址配置单元：`lnsc-cx7-addresses.service`，当前 enabled。
- 不再使用 netplan 应用私网变更；之前一次 netplan 重载已回滚并恢复。

### 3.2 NCCL/RPC 构建

- NCCL：`/root/nccl/`，版本 2.31.2。
- nccl-tests：`/root/nccl-tests/`，版本 2.19.7。
- llama.cpp：`/opt/llama.cpp/`，当前上游提交 `e0f142d5d`。
- RPC 构建目录：`/opt/llama.cpp/build-rpc/`。
- head RPC API 二进制：`/opt/llama.cpp/build-rpc/bin/llama-server`。
- worker RPC 二进制：`/opt/llama.cpp/build-rpc/bin/ggml-rpc-server`。
- 两端分别使用本机 CUDA 工具链构建，未直接复制 CUDA 二进制。

### 3.3 模型文件

目录：`/models/glm-5.3-flash-gguf/`

- 主模型：`UD-Q4_K_XL/GLM-5.3-Flash-UD-Q4_K_XL-00001-of-00006.gguf`
- 共 6 个语言模型分片。
- 视觉/视频 projector：`mmproj-F16.gguf`
- head 已验证 7 个 SHA256 文件；worker 后续按同一 manifest 复核。
- manifest：`/root/lnsc-ab/two-node/glm53-gguf-manifest.tsv`

### 3.4 已安装 unit

| 节点 | unit | 当前状态 | 用途 |
|---|---|---|---|
| 两台 | `lnsc-cx7-addresses.service` | enabled | 私网地址配置 |
| worker | `ggml-rpc.service` | inactive + disabled | 私网 `192.168.100.11:50052` RPC/RDMA |
| head | `llama-glm53-rpc.service` | inactive + disabled | Cline API `8081/v1` |

GLM 启动超时已调整为 3600 秒，避免首次加载大模型时被 900 秒超时重启。

## 4. 已排除的错误路线

- Hugging Face FP4-Local 下载未完成，因此没有部署 NVIDIA vLLM。
- 旧 build 中，`ncols=4` 的 CUDA softmax 错误通过临时小列数路径修复可越过，但这不是长期方案。
- 后续 MoE 推理出现 `ggml_cuda_mul_mat_q` / `mm_ids_helper` 与 RPC buffer 错误。
- `split-mode=row` 已实测不被 RPC 支持，已撤回。
- 临时 ids 拷贝补丁引入新的 RPC buffer 问题，已撤销。
- 临时补丁已保存到 `/root/lnsc-ab/two-node/llama-patches-before-upstream.diff`，不作为当前生产代码。
- 当前源码已回到上游 `e0f142d5d`，使用上游 MMQ/MoE 修复，不继续叠加实验补丁。

## 5. 分阶段执行计划（每阶段需确认）

### 阶段 A：只读核验，不启动模型

确认后先执行，预计数分钟：

1. 复核两台 hostname、驱动、内核、CUDA、源码 commit、RPC binary。
2. 确认 Wi-Fi DOWN、管理网走有线、两条 QSFP 双向 ping 与 RPC 端口不冲突。
3. 按 manifest 校验 head 与 worker 全部 7 个文件的大小和 SHA256。
4. 校验 unit 内容、`TimeoutStartSec=3600`、无残留 `split-mode=row` 和临时 debug 环境。
5. 输出一份只读核验报告，不启动服务。

**通过条件**：两台源码/二进制一致、模型 SHA256 全部一致、没有活动模型服务或后台下载任务。

### 阶段 B：上游 build 的 GLM 启动验证

仅在阶段 A 通过后执行：

1. worker 启动 `ggml-rpc`，确认仅监听 QSFP 私网。
2. head 启动 `llama-glm53-rpc`。
3. 只等待 `/health` 和 `/v1/models`，不做聊天。
4. 记录启动时间、RPC transport、两端内存、源码 commit 和日志。
5. 完成后保持服务，等待用户确认阶段 C；若失败，停止 head→worker，不自动循环重试。

**通过条件**：health OK，alias `glm-5.3-flash`，`n_ctx=131072`，`n_ctx_train=1048576`，text/image/video 模态正确。

### 阶段 C：最小 MoE 推理验证

1. 一次短 chat，限制 64 tokens。
2. 一次流式 chat。
3. 一次自动工具调用。
4. 任一 CUDA/RPC 错误立即停止，不继续打补丁或长时间重启。
5. 全部通过后才进入性能与长上下文阶段。

**通过条件**：三项 API 均正常、无 CUDA/RPC fatal、两端内存和 swap 稳定。

### 阶段 D：性能、长上下文与 Cline 验收

1. 短上下文 decode、39k prefill、512-token decode。
2. 并发 1→2→4；MTP、context、batch 每次只改一个变量。
3. reasoning suite、工具调用、真实 Cline 任务。
4. 上下文分阶段 131072→196608→262144，再决定是否向 500k 扩展。
5. 至少 30 分钟无 OOM、NCCL/RPC fatal 和持续 swap 增长。

### 阶段 E：生产化

只有阶段 D 通过后才执行：

1. 两台服务 enable + start。
2. Cline 只连接 head：`http://10.86.20.57:8081/v1`。
3. model：`glm-5.3-flash`；context 131072；max output 8192；thinking high。
4. 更新 README、runbook 和 changelog，交付可重复启停与回滚步骤。

## 6. 停止与回滚

任何阶段失败：

```bash
# head
systemctl disable --now llama-glm53-rpc

# worker
systemctl disable --now ggml-rpc
```

保留模型、源码、构建产物和日志，不自动恢复 Flash，也不改变用户要求的 Flash inactive + disabled 状态。若用户明确要求恢复 Flash，再执行：

```bash
bash /root/lnsc-ab/bin/model-switch.sh flash
```

## 7. 证据位置

- 两节点原始日志与 inventory：`/root/lnsc-ab/two-node/`
- 模型 manifest：`/root/lnsc-ab/two-node/glm53-gguf-manifest.tsv`
- 模型与 API 证据：`/root/lnsc-ab/two-node/glm53-*`
- RPC/RDMA 冒烟：`/root/lnsc-ab/two-node/rpc-*`
- 本地文档与状态：`docs/10~14`、`benchmark-results/two-node-glm53/`

## 8. 当前结论

**基础网络、NCCL、RPC dense 冒烟、模型下载和上游构建已完成，但 GLM-5.3 MoE 推理尚未验收，不能称为部署成功。**

下一步默认只执行**阶段 A（只读核验）**，等待用户明确确认后再启动模型。
