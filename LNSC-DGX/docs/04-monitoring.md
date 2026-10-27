# 04 · 监控与日志（Monitoring）

> 原则：**不引入新守护进程、不装新依赖**。用 cron + bash + logrotate 完成 90% 的观察需求；
> 只有当确实需要趋势图表时，才启用第 4 节的 Prometheus（可选）。

---

## 一、三层结构

| 层 | 手段 | 频率 | 回答什么问题 |
|---|---|---|---|
| L1 指标 | `dgx-metrics-collect.sh` + cron | 5 分钟 | 内存/上下文/GPU 趋势，是否在恶化 |
| L2 全量快照 | `dgx-healthscan.sh` / `dgx-snapshot.sh` | 每日 / 变更前后 | 当前完整状态，回滚依据 |
| L3 服务指标 | llama.cpp `/metrics`（需 `--metrics`） | 按需/抓取 | 队列、KV 使用率、token 吞吐 |

---

## 二、安装 L1（可逆）

```bash
sudo mkdir -p /var/log/lnsc

# 每 5 分钟采集
sudo tee /etc/cron.d/lnsc-metrics > /dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root /opt/LNSC-DGX/scripts/dgx-metrics-collect.sh >/dev/null 2>&1
EOF

# 日志轮转（防止"留日志"变成"吃满磁盘"）
sudo cp /opt/LNSC-DGX/systemd/lnsc-logrotate.conf /etc/logrotate.d/lnsc
sudo logrotate -d /etc/logrotate.d/lnsc        # 先 dry-run 检查语法

# 立即跑一次验证
sudo /opt/LNSC-DGX/scripts/dgx-metrics-collect.sh && tail -2 /var/log/lnsc/metrics.csv
```

**回滚**（两条命令，无残留）：
```bash
sudo rm -f /etc/cron.d/lnsc-metrics /etc/logrotate.d/lnsc
```

> 脚本内 `LOG_DIR` 可用环境变量覆盖（沙箱测试时用 `LOG_DIR=/tmp/lnsc-test`）。

---

## 三、`metrics.csv` 字段与解读

```
ts,mem_avail_mb,swap_used_mb,cached_mb,gpu_temp_c,gpu_power_w,gpu_util,llama_alive,n_ctx,prompt_tokens,ctx_pct,is_processing
2026-10-27T21:52:42,450,846,1183,41,10.69,0,1,131072,41095,31,false
```

| 字段 | 含义 | 关注点 |
|---|---|---|
| `mem_avail_mb` | `/proc/meminfo` 的 MemAvailable | **核心指标**，<1024 立即处置 |
| `swap_used_mb` | swap 已用 | 5 分钟内涨 >100 MiB 说明在抖动 |
| `cached_mb` | page cache | 长期 <1 GiB 属正常（模型占满了） |
| `gpu_temp_c` / `gpu_power_w` | GPU 温度/功耗 | 温度 ≥85 或功耗长期顶格 → 查降频 |
| `llama_alive` | 进程是否存在 | 0 = 服务已死 |
| `n_ctx` / `prompt_tokens` | 上下文与当前 prompt | 求差 = 余量 |
| `ctx_pct` | 上下文占用百分比 | ≥95 会触发 `exceeds context size` |
| `is_processing` | 是否有请求在跑 | **变更前必须为 false** |

### 常用查询

```bash
C=/var/log/lnsc/metrics.csv

# 最近 12 条
tail -12 $C | column -s, -t

# 最低可用内存与发生时间
awk -F, 'NR>1{if(m==""||$2<m){m=$2;t=$1}}END{print "最低 MemAvailable:", m"MiB @", t}' $C

# 可用内存 <1 GiB 的次数
awk -F, 'NR>1 && $2<1024' $C | wc -l

# 上下文占用峰值
awk -F, 'NR>1{if($11>m){m=$11;t=$1}}END{print "峰值 ctx%:", m" @", t}' $C

# swap 增长速度（每 5 分钟变化量）
awk -F, 'NR>2{print $1, $3-p} {p=$3}' $C | tail -20
```

### 告警（`alerts.log`）

阈值在 `dgx-metrics-collect.sh` 顶部，可用环境变量覆盖：

| 变量 | 默认 | 触发条件 |
|---|---|---|
| `TH_MEMAVAIL_MB` | 2048 | `MemAvailable` 低于此值 |
| `TH_SWAP_MB` | 2048 | swap 使用高于此值 |
| `TH_GPU_TEMP` | 85 | GPU 温度 ≥ 此值 |
| `TH_CTX_RATIO` | 95 | 上下文占用 ≥ 此百分比 |

外发（默认关闭）：`export LNSC_WEBHOOK=https://...` 后，有告警时 POST 一条 JSON。

---

## 四、L3：llama.cpp `/metrics`（可选，需重启一次启用）

迁移到 systemd 后（`docs/03-change-plan.md` 的 C2），启动参数会带 `--metrics`，届时：

```bash
curl -s 127.0.0.1:8081/metrics | grep -E 'kv_cache_usage_ratio|requests_(deferred|processing)|tokens_per_second|prompt_tokens_total'
```

若已有 Prometheus，可加（**没有就跳过，不要为此额外装 Prometheus**）：

```yaml
scrape_configs:
  - job_name: 'dgx-llama'
    scrape_interval: 30s
    static_configs:
      - targets: ['10.86.20.57:8081']
```

---

## 五、日志保留策略

| 文件 | 轮转 | 保留 | 说明 |
|---|---|---|---|
| `audit-YYYYMMDD.log` | weekly + maxsize 50M | 12 份 | 变更审计 |
| `metrics.csv` | 同上 | 12 份 | `copytruncate` 保证 cron 继续追加 |
| `alerts.log` | 同上 | 12 份 | |
| `snapshots/*.tar.gz` | 由脚本自管 | 最近 **14** 份 | 每份约 50 KB |

磁盘占用估算：`metrics.csv` 每行约 90 B × 288 行/天 ≈ **25 KB/天**，一年 <10 MB，可忽略。

---

## 六、监控的"最小可用"承诺

即使不装 cron，只要保留两条命令就能满足日常：

```bash
bash scripts/dgx-healthscan.sh      # 看现状
bash scripts/dgx-metrics-collect.sh # 落一行账
```

**不要**为了"监控得更全"去装 Prometheus + Grafana + node_exporter —— 在当前 449 MiB 可用内存下，
监控组件自己就是风险源（违反 `docs/00-rules.md` 第二节）。