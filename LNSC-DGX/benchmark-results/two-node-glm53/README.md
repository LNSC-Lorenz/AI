# 双机 GLM-5.3 原始数据目录约定

此目录只保存**已执行测试**的原始证据；目前没有通过验收的双机 GLM-5.3 部署结果。

当前状态与分阶段执行计划见 `docs/14-glm53-rpc-implementation-plan.md`。已完成网络、NCCL、RPC dense 冒烟和模型下载；GLM MoE 推理尚未验收。后续测试按阶段 A→B→C 等用户确认后执行，不把启动日志当作性能或质量证据。

DGX 原始证据目录：`/root/lnsc-ab/two-node/`。后续从该目录归档到本目录。

## Run ID

```text
<YYYYMMDD-HHMMSS>-<P1|P2|P3|P4|P5|P6|P7|T0|T1|...>
```

每个 run 必须包含：

- `inventory-*.json`：两节点硬件、OS、驱动、CUDA、容器与模型 revision
- `network-*.txt`、`ssh-validation.log`、`nccl-all_gather.log`
- `commands.log`：可公开命令；不得包含 HF_TOKEN 或其他密钥
- `api-*.json`：health/models/chat/stream/tools 原始响应
- `perf-summary.json`：冷/热 prefill、长短 decode、MTP、wall/排队
- `quality-summary.json`、`reasoning-summary.json`
- `monitor-head.csv`、`monitor-worker.csv`、`network.csv`
- `summary.json`、`report.md`

## 资源 CSV 字段

```text
timestamp,mem_available_mib,swap_used_mib,cgroup_mib,process_swap_mib,gpu_util_percent,sm_clock_mhz
```

网络监控另行记录：接口、时刻、吞吐、错误、丢包、NCCL timeout（若有）。原始性能数字必须注明官方参考、单机基线或本集群实测，禁止混写。
