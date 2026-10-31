# 12 · 双机运维、故障处置与回滚

## 0. 当前 GGUF+RPC 部署单元

| 节点 | unit | 作用 |
|---|---|---|
| DGX-2/worker | `ggml-rpc.service` | 提供 CUDA/RDMA RPC 设备，监听私网 `192.168.100.11:50052` |
| DGX-1/head | `llama-glm53-rpc.service` | 对 Cline 提供 `8081/v1`，并调用 worker |

启动顺序：先启 worker `ggml-rpc`，再启 head `llama-glm53-rpc`；停止顺序相反。不得把 worker 的 RPC 端口暴露给 Cline 或公网。
当前生产仍由既有 llama.cpp unit 管理；`llama-glm53-rpc` 与 `ggml-rpc` 在 GLM 下载和验收前保持 inactive + disabled。后续阶段启动前必须先获得用户确认，且仅使用有线网络。

## 1. 日常状态核对

```bash
# 两节点分别执行并留档；地址以 inventory 为准
hostname; date --iso-8601=seconds
free -h; df -h /
ibdev2netdev; ip -br addr
# head：确认只有一个面向 Cline 的逻辑端点
curl -fsS http://127.0.0.1:8000/health
curl -fsS http://127.0.0.1:8000/v1/models
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

每日同时检查：worker/head 容器、NCCL/RoCE 错误、GPU 利用率、MemAvailable、swap、磁盘、模型加载/重启、HTTP 取消与超时。
任何“head 健康但 worker 异常”都不视为集群健康。

## 2. 启停与变更纪律

- 启动：确认私网/SSH/NCCL→确认模型与镜像→**worker 先起→head 后起→API 验证**。
- 停止：停止接流量→head 停止→worker 停止→确认无残留进程。
- 禁止双 head、禁止 worker 直接接受 Cline、禁止未经评审的额外模型副本。
- 容器、镜像、checkpoint、recipe、NCCL 参数必须同版本；变更先备份并在维护窗口执行。
- 官方 recipe 使用 privileged/host network/host IPC，仅限固定镜像与私网；不得把该权限复制到普通测试容器。

## 3. 监控与告警

| 指标 | 观察 | 处置 |
|---|---|---|
| MemAvailable | 持续 <2 GiB 或快速下降 | 停止新请求；保留日志，先降压而非调参 |
| swap | 连续增长、影响延迟 | 停止长上下文/并发；评估是否回滚 |
| RoCE/NCCL | timeout、retry、链路 Down、带宽突降 | 停止集群，先查线缆/IP/HCA/子网 |
| worker | exited/restarting、rank 缺失 | 整个逻辑服务降级，不只重启 head |
| API | 503 长时不退、5xx、工具解析失败 | 查加载日志/parser/模型 revision |
| 性能 | decode 突然下降、TTFT 排队 | 先查其他请求和链路，再决定是否调参 |
| 磁盘 | checkpoint/cache 增长、空间不足 | 停止下载；保留校验信息，清理需审批 |

监控原始 CSV 按节点分开保存，并和请求时间戳对齐；密钥不得入日志。

## 4. 故障手册

| 现象 | 优先检查 | 安全动作 |
|---|---|---|
| QSFP 无链路 | 线缆、对应 CX7 口、速率、子接口 | 恢复物理链路；不改生产管理网 |
| SSH 单向失败 | 用户名、key、known_hosts、私网路由 | 修通后再跑 NCCL，禁止跳过验证 |
| NCCL hang | HCA/子网/MTU/防火墙/rank/master 地址 | 停止测试与容器，保留完整日志 |
| head 503 | 模型仍加载、worker 未就绪、checkpoint 权限 | 等待有上限；失败则按顺序排空 |
| 启动即 OOM | 两节点内存、cache、context、并发、版本 | 先停止；不得直接加 swap |
| decode 很慢 | 并发排队、NCCL 实际带宽、MTP、reasoning 长度 | 先做单请求/关 MTP/降并发对照 |
| 工具调用失败 | `glm47` parser、auto choice、模型 ID、模板 | 保留原始响应，先修兼容性而非 Prompt |
| 结果质量差 | checkpoint/revision、推理档位、历史 thinking、量化 | 与官方默认配置对齐后复测 |
| 两节点配置漂移 | digest、recipe、环境变量、镜像 | 停止集群，按基线统一后重启 |

## 5. 回滚路径

### 服务回滚

1. 停止 Cline 新请求并记录当前上下文。
2. 按 head→worker 顺序停止双机容器；官方示例为 `docker stop vllm_cluster`（名称以实际 recipe 为准）。
3. 确认两节点无相关进程、8000 不再提供错误服务。
4. 在 DGX-1 用既有 `bash /root/lnsc-ab/bin/model-switch.sh flash` 恢复生产。
5. 验证 Flash `/health`、alias、视觉和短 chat；记录中断时长与恢复结果。

### 网络回滚

仅撤销本次新增 netplan/IP/SSH 配置，使用 P1 备份；不得顺手清空其他网络。网络回滚后再次验证管理网与 Flash。

### 数据回滚

模型/cache 默认保留用于审计；删除必须单独审批。禁止以“回滚”为由删除原始日志、失败证据或当前生产模型。

## 6. 更新与重启

- 验收期间冻结 driver/CUDA/container/vLLM/model；更新单独开变更单并重跑 V0~V8。
- 双机 reboot 先停止接流量并排空容器；启动后先验证 RoCE/NCCL，再 worker→head。
- 未做双机故障恢复演练前，不设生产自动重启；不得让 systemd 在失败时形成反复全量下载/加载。
- 交接必须包含：当前 rank 状态、模型/镜像 revision、网络配置、最近告警、回滚负责人。
