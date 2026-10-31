# 00 · 运维铁律（Rules）

> 本文件优先级最高。任何操作与此冲突时，以此为准。
> 适用：DGX Spark `DGX01-2512`（GB10 / aarch64），承载 `Qwen3.8-Flash-Next`（177B / 103.7 GiB 权重）。

---

## 一、十条铁律

| # | 规则 | 理由 |
|---|---|---|
| 1 | **只读优先**：能查就不改；脚本默认 dry-run，`apply` 才动手 | 这套机器只有 121.6 GiB 统一内存，没有"试一下"的余量 |
| 2 | **一次只改一个变量**，改完观察 ≥30 分钟 | 同时改两个参数，出问题无法归因 |
| 3 | **变更=快照+审计+回滚** 三者缺一不可 | 见第四、五节 |
| 4 | **有活跃请求时不重启**：`curl /slots` 的 `is_processing` 必须为 `false` | 重启会中断用户任务并丢上下文 |
| 5 | **不留无主进程**：服务必须由 systemd 托管 | 手工 `sudo` 起的进程挂在 `/dev/pts/2`，关终端即死（实测 `SIGHUP` 未忽略） |
| 6 | **日志必须落盘**，不许只打到终端 | 当前启动日志只存在于 pts，`KV buffer`/`n_ubatch` 已永久丢失 |
| 7 | **一个模型只跑一个实例** | 103.7 GiB 权重 ×2 = 207 GiB，物理不可能 |
| 8 | **不在同一台机器上再加载任何模型**（含 ollama） | 剩余内存 <1 GiB，17 GB 模型一加载就整机卡死 |
| 9 | **数据留痕最少 30 天**，变更记录永久保留 | 复盘与审计需要 |
| 10 | **写下来的才算做过**：口头/临时命令一律视为未发生 | 交接与复盘依赖文档 |

---

## 附 · 双机专项边界（2×DGX Spark / vLLM TP2）

- 一个跨双机的 vLLM TP2 逻辑实例，**不视为额外第二份模型副本**；head/worker 必须同 recipe、同模型 revision、同镜像 digest。
- 禁止双 head、禁止 worker 对 Cline 开放、禁止在双机基线之外再起 llama.cpp/Ollama/vLLM 做临时对比。
- 只允许 200GbE QSFP 私网/直连；NCCL、RPC 与容器端口不得暴露办公网或公网。
- 官方 recipe 的 privileged 容器属于专项审批范围，必须固定镜像、记录 digest；不能据此放开其他 Docker 测试。
- 双机部署与调优统一按 `docs/10-two-node-deployment.md`、`docs/11-two-node-validation.md`、`docs/12-two-node-operations.md` 执行；未通过验收前，当前 Flash 仍是生产默认。

---

## 二、"不过度"红线（明确不要做的事）

以下操作**收益极低但风险很高**，未经书面评估不得执行：

| ❌ 不要做 | 原因 |
|---|---|
| 升级内核 / 驱动 / CUDA / llama.cpp build | 当前 `sm_121` 下能跑就是成功，升级等于重开一轮兼容性风险 |
| 改 `transparent_hugepage` / `vm.overcommit_memory` | 对统一内存平台影响不可预测，出问题难回滚 |
| 扩大 swap（`/swap.img`） | swap 不是内存；在 UMA 上只会把"卡死"变成"慢慢卡死" |
| 用 `-ub 32` 之类的极小批来"省内存" | 拿 10~20 倍 prefill 速度换 1~2 GiB，得不偿失 |
| `docker run` 再起第二个推理服务 | 见铁律 8 |
| `ollama run` / `vllm serve` 做"对比测试" | 同上，需要对比请另开机器或明确的下线时段 |
| 直接 `kill -9` llama-server | 丢失 KV 与未完成请求；应 `SIGINT`（systemd 已配置 `KillSignal=SIGINT`） |
| 无快照就改 `/etc/systemd/system/*` | 无法回滚 |

---

## 三、变更准入五问（每次都要回答并记入 06-changelog.md）

1. **必要性**：不做会怎样？（能用只读手段规避吗）
2. **影响面**：会中断谁？多久？（参考：重启需 1~3 分钟重读 103.7 GiB）
3. **回滚**：一条命令能否回到原状？回滚后要多久恢复？
4. **验证**：怎么证明改成功了？（必须给出可执行的判据命令）
5. **窗口**：现在有没有活跃请求？（`curl -s :8081/slots | grep is_processing`）

> 五问里任一没有明确答案 → **不做**。

---

## 四、留痕规范

| 类型 | 位置 | 格式 | 保留 |
|---|---|---|---|
| 审计日志 | `/var/log/lnsc/audit-YYYYMMDD.log` | `时间 \| 变更项/动作 \| 结果` | 12 周（logrotate） |
| 指标 | `/var/log/lnsc/metrics.csv` | 每 5 分钟一行 CSV | 12 周 |
| 告警 | `/var/log/lnsc/alerts.log` | `时间 ALERT 内容` | 12 周 |
| 快照 | `/var/log/lnsc/snapshots/<ts>.tar.gz` | 11 个 txt + `MANIFEST.sha256` | 最近 14 份 |
| 变更记录 | `docs/06-changelog.md` | 人写，永久 | 永久 |

- 所有脚本输出必须 `tee -a` 到审计日志，**不许只在终端上看一眼**
- 快照命名 `YYYYMMDD-HHMMSS`，与审计日志里的 `snapshot=` 对应

---

## 五、回滚规范

1. 每个变更项必须提供 `rollback <id>`，且**在 apply 之前先 review 过 rollback 逻辑**
2. 回滚依据一律来自 `/var/log/lnsc/state/`：
   - `swappiness.orig` —— 原始内核参数
   - `llama-orig-cmdline.txt` —— 原始启动命令（可原样重放）
   - `*.bak` —— 被覆盖的单元/drop-in 文件
3. 回滚后必须再跑一次验证命令，并把结果写入审计日志
4. **回滚失败 → 立即停止一切变更**，转为文档记录 + 人工介入

---

## 六、值班交接（3 行）

```
现状: MemAvailable=449MiB (临界), llama-server pid=52520 手工启动于 pts/2, 无 systemd 托管
核弹: 不要关闭 pts/2; 不要调用 ollama; 不要在 8081 上跑长请求
待办: 见 docs/03-change-plan.md 的 C1~C5
```