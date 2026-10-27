# 02 · 日常巡检 SOP（Runbook）

> 全套只读。任何一步都不改配置、不重启服务。
> 全部命令在 DGX 上以 root 执行（`ssh root@10.86.20.57`）。

---

## 一、每日巡检（5 分钟，建议 09:00 / 17:00）

```bash
cd /opt/LNSC-DGX            # 或你存放本包的位置
bash scripts/dgx-healthscan.sh                 # 全量快照（含 GPU/内存/服务/API）
bash scripts/prompt-size.sh                    # 最近请求的 prompt 规模与 prefill 耗时
bash scripts/dgx-change.sh status              # 变更项状态
bash scripts/dgx-metrics-collect.sh            # 补一条指标（若 cron 未启用）
tail -20 /var/log/lnsc/alerts.log 2>/dev/null  # 看有没有新告警
```

### 判据表（PASS / WARN / FAIL）

| 指标 | PASS | WARN | FAIL | 判定命令 |
|---|---|---|---|---|
| `/health` | `{"status":"ok"}` | — | 非 ok | `curl -s :8081/health` |
| `MemAvailable` | ≥ 4 GiB | 1~4 GiB | **< 1 GiB** | `grep MemAvailable /proc/meminfo` |
| `SwapUsed` 增速 | 0 | 缓慢上升 | 5 分钟内 >100 MiB | 对比 `metrics.csv` 两行 |
| llama `Pss_Anon` | < 42 GiB | 42~55 GiB | > 55 GiB | `grep Pss_Anon /proc/$(pgrep -x llama-server)/smaps_rollup` |
| `total_slots` | 1 | — | >1（重复实例） | `curl -s :8081/props \| grep -o '"total_slots":[0-9]*'` |
| 上下文余量 | ≥ 8k tokens | 4k~8k | < 4k | `n_ctx - n_prompt_tokens` |
| GPU 温度 | < 75 °C | 75~85 °C | ≥ 85 °C | `nvidia-smi --query-gpu=temperature.gpu --format=csv` |
| GPU 降频 | `clocks.sm` ≈ 3000 | 2000~2500 且 util 高 | < 1500 且 util 高 | 同上 `clocks.sm,clocks.max.sm` |
| OOM 记录 | 无 | — | 有 | `dmesg -T \| grep -i oom-kill` |
| 服务托管 | systemd active | — | 手工 pts 进程 | `pgrep -ax llama-server` + `ls -l /proc/<pid>/fd/1` |

### 🔄 机器重启后自检（一条命令）

服务已 `enable`，重启后会自动拉起；但**冷页缓存**要真读 104 GB，`/health` 大约 **1.5~2.5 分钟**才 ok（`TimeoutStartSec=900` 足够）。

```bash
# 每 10 秒看一次，直到 health=200
for i in $(seq 1 30); do
  printf '%s health=%s mem=%sG\n' "$(date +%H:%M:%S)" \
    "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 http://127.0.0.1:8081/health)" \
    "$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)"
  sleep 10
done
# 就绪后确认三件事
curl -s http://127.0.0.1:8081/props | tr ',' '\n' | grep -E '"n_ctx"|modalities'
journalctl -u llama-qwen38 -b --no-pager | grep -iE 'no FlashAttention|error' || echo '日志干净'
systemctl is-active llama-qwen38 ollama
```

判据：`health=200` + `n_ctx=196608` + 日志无 `no FlashAttention`/`error`。
若 3 分钟后仍未就绪 → `journalctl -u llama-qwen38 -b --no-pager | tail -50`，并注意 `StartLimitBurst=3` 会**在 3 次失败后主动停止重试**（这是设计，防止反复读盘）。

- ✅ **服务已由 systemd 托管**（`llama-qwen38`），关终端不会再杀服务；日志用 `journalctl -u llama-qwen38` 看。
- ✅ 上下文已扩到 **196608**，`--metrics` 已开启（`curl -s :8081/metrics`）。
- ⚠️ `MemAvailable` 常态约 **8~9 GiB**（权重 103.68 GiB 的真实代价）。**低于 1 GiB 就直接进 05-incident 的 I1**，不要继续做其它变更。
- ✅ **视觉/视频已启用**（`--mmproj mmproj-F16.gguf`，2026-10-27 23:32）。`/props` 应显示 `vision:true`、`video:true`。
  - 回滚：删掉 unit 里 `--mmproj` 那行 → `daemon-reload && systemctl restart llama-qwen38`。
  - ⚠️ 视频帧 token 消耗极大（几十帧 = 数万 token），别让客户端无脑传长视频。
- ⚠️ `-ctk` 与 `-ctv` **必须是同型**（本 build 只编译了 `q4_0-q4_0 / q8_0-q8_0 / f16-f16 / bf16-bf16`）。改动后第一件事是 `journalctl -u llama-qwen38 -b | grep -i "no FlashAttention"`，有输出说明掉进了 slow path。
- ⚠️ `MemoryMax=116G` 只约束进程 anon + 页缓存（实测仅 30 GiB 量级），**管不到 GPU 设备内存**，所以限额不等于安全，仍要看监控。

---

## 二、每周巡检（15 分钟）

```bash
# 1) 快照留档
bash scripts/dgx-snapshot.sh

# 2) 磁盘与日志
df -h / ; du -sh /var/log/lnsc ; ls -lh /var/log/lnsc | tail

# 3) 内存增长趋势（看 Pss_Anon 是否单调上涨）
awk -F, 'NR>1{print $1, $2"MiB"}' /var/log/lnsc/metrics.csv | tail -20

# 4) 上下文占用峰值
awk -F, 'NR>1{if($11>m){m=$11;t=$1}}END{print "峰值 ctx%:", m, t}' /var/log/lnsc/metrics.csv

# 5) 服务清单漂移（与 01-inventory.md 对照）
systemctl list-units --type=service --state=running --no-legend | grep -iE 'ollama|vllm|webui|llama'

# 6) journal 里有没有新错误
journalctl --since '7 days ago' -p err --no-pager | tail -30
```

---

## 三、变更前后检查单

### 变更前（全部为"是"才继续）

- [ ] `curl -s 127.0.0.1:8081/slots | grep -c '"is_processing":true'` → **0**
- [ ] `bash scripts/dgx-change.sh plan <id>` 输出已逐条 review
- [ ] 已确认 `rollback <id>` 的逻辑与依据文件（`/var/log/lnsc/state/`）
- [ ] 已记录当前 `MemAvailable` / `n_ctx` / `prompt_tokens`（写进 06-changelog）
- [ ] 已通知使用者：预计中断 X 分钟
- [ ] 已跑 `bash scripts/dgx-snapshot.sh`（apply 会自动再跑一次）

### 变更后（3 条全绿才算完成）

```bash
curl -s 127.0.0.1:8081/health                                  # → {"status":"ok"}
curl -s 127.0.0.1:8081/props | grep -o '"n_ctx":[0-9]*'        # → 期望值
grep MemAvailable /proc/meminfo                                # → 不低于变更前
```

然后：把结果补进 `docs/06-changelog.md`，`rec` 已自动写入 `audit-*.log`。

---

## 四、常见"看起来像故障"的正常现象

| 现象 | 说明 |
|---|---|
| `nvidia-smi` 的 `memory.total/used` 显示 `[N/A]` | GB10 是统一内存，正常 |
| `buff/cache` 只有 1~2 GiB | 模型吃掉了池子，文件页被回收，正常 |
| `Pss_File` 只有 160 MB 左右 | GGUF 不在 page cache，正常（不影响推理速度） |
| 重启后首字慢 | 需从 NVMe 重读 103.7 GiB，1~3 分钟，正常 |
| `load average` 很低但推理在跑 | GPU 瓶颈不在 CPU 核上，正常 |
| `prompt_tokens` 有时骤降 | 客户端换了新线程/新会话，正常 |

---

## 五、交接模板（3 行）

```
状态: MemAvailable=?MiB | llama pid=? | 托管方式=? | n_ctx=? | ctx余量=?
风险: (是/否) 有 pts 进程 | (是/否) ollama 暴露 | (是/否) 有活跃请求
待办: 见 03-change-plan.md 队列 C? ~ C?
```