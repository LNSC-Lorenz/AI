# 05 · 故障处置预案（Incident Playbook）

> 所有场景都遵守：**先止血 → 再定位 → 最后才改配置**。
> 每次处置结束，把时间线与结论补进 `docs/06-changelog.md`。

---

## I1 · `MemAvailable` 跌破 1 GiB / OOM 前兆 🔴（当前已发生）

**识别**
```bash
grep -E 'MemAvailable|SwapFree' /proc/meminfo
grep -E '^(Rss|Pss_Anon|Pss_File)' /proc/$(pgrep -x llama-server)/smaps_rollup
dmesg -T | grep -i 'oom-kill' | tail -3
```

**止血（按顺序，做到哪一步够了就停）**

1. 停掉**会抢内存但当前无用**的服务：
   ```bash
   systemctl stop ollama            # 36 MB 常驻 + 但阻止任何人加载 17 GB 模型
   ```
2. 释放 page cache（安全，只丢缓存）：
   ```bash
   sync; echo 3 > /proc/sys/vm/drop_caches
   ```
3. 确认没有第二个 llama 实例（`pgrep -ax llama-server | wc -l` 必须为 1）
4. **仍 <500 MiB → 必须重启 llama-server**（会中断 1~3 分钟，但能释放累积的 ~8 GiB 匿名内存）：
   ```bash
   kill -INT $(pgrep -x llama-server)     # 不要 -9
   # 等待退出后按 03-change-plan 的 C2/C5 重新拉起
   ```

**根因（已确认部分）**
- 权重 103.68 GiB 吃掉绝大部分统一内存，长期 `MemAvailable` 只有 6~10 GiB
- `llama-server` 的 `Pss_Anon` 在使用过程中**持续上涨**（实测 20 分钟 +8 GiB）且不自行释放

**不要做**
- 不要扩 swap（UMA 上无意义）
- 不要 `kill -9`（丢 KV、留脏共享内存）
- 不要靠 `-ub 32` 省内存

---

## I2 · `exceeds the available context size` 🔴

**症状**：`the request (N tokens) exceeds the available context size (M tokens), try increasing it`
（当前 `M=131072`；历史出现过 `M=49152`）

**判断**：这是**单次请求**超过 `n_ctx`，llama.cpp 不会自动截断。

**止血**
1. 看真实水位：`curl -s 127.0.0.1:8081/slots | tr ',' '\n' | grep -E 'n_prompt_tokens|n_ctx'`
2. **短期**：让客户端减少历史（保留 system + 最近 N 轮），把 `max_tokens` 调到 ≤ 余量
3. **中期**：按 `03-change-plan.md` C3 扩到 196608（须先解决内存问题）

**根因**：客户端历史累积（实测 106k → 117k 递增）+ 客户端 `max_tokens` 计算基于过期 prompt 长度。

**反面教材**：直接把 `-c` 拉到 262144 且 KV 全 q8_0 → KV +3 GiB → 直接触发 I1。

---

## I3 · 关终端把服务带走了 🟠

**症状**：`curl :8081/health` 无响应；`pgrep -x llama-server` 为空；`dmesg`/`journal` 里 `sudo` 会话结束时间点吻合。

**判断依据**（历史上本机就是这种状态）：
```bash
ls -l /proc/<pid>/fd/1        # → /dev/pts/N 表示无日志落盘
grep SigIgn /proc/<pid>/status # 0x1000 = 只有 SIGPIPE 被忽略, SIGHUP 没忽略 → 关终端必死
```

**止血**：按 `03-change-plan.md` C2 迁到 systemd（这是根治，不是临时方案）。
**临时**：需要避免误关时，用 `setsid`/`nohup` 重启，但这只是缓解，**仍必须尽快迁 systemd**。

---

## I4 · 整机卡死 / SSH 无响应 🔴

**识别**：SSH 超时、ping 通但无响应、风扇拉满。

**止血**
1. 优先走**物理/带外**登录（GB10 无 IPMI，只能用本地键盘/显示器）
2. 本地 TTY：`Ctrl+Alt+F3` 登录 → `kill -INT $(pgrep -x llama-server)`
3. 仍然不行 → 长按电源强制关机（**这是最后手段，会丢所有上下文**）

**复盘必查**：`journalctl -b -1 -k | grep -i oom` 与 `/var/log/lnsc/metrics.csv` 最后 10 行。

---

## I5 · 有人调用了 ollama 的大模型 🟠

**识别**：`ollama ps` 非空；`MemAvailable` 骤降；`systemctl status ollama` 显示模型加载。

**止血**
```bash
ollama ps                      # 看加载了什么
systemctl restart ollama       # 立刻卸掉模型（3~5 秒）
```
**根治**：按 C4 收敛到 `127.0.0.1`，或直接 `systemctl disable --now ollama`。
**注意**：`override.conf` 里有 `OLLAMA_KEEP_ALIVE=-1`，模型**永远不会自动卸载**，必须显式停止。

---

## I6 · 模型有响应但输出异常 / 卡住 🟡

**识别**：tok/s 掉到个位数；`n_decoded` 长时间不涨；日志刷 `context shift`。

**排查顺序**
1. `nvidia-smi --query-gpu=clocks.sm,clocks.max.sm,power.draw,temperature.gpu --format=csv`
   → 频率远低于 3000 且温度高 = 降频（检查散热/机箱空间）
2. 上下文是否已满 → 触发 context shift（静默丢弃最老 token，表现为"忘事"）
3. `Pss_Anon` 是否已逼近上限（内存不足会导致频繁回收，速度崩）
4. 客户端是否一次发来超长 prompt（prefill 慢，不是 decode 慢）

---

## 处置记录模板（贴进 06-changelog.md）

```
时间: 2026-XX-XX HH:MM
场景: I1 / I2 / I3 / I4 / I5 / I6
触发: 现象与判据命令输出
止血: 执行了什么命令, 结果如何
根因: 已确认 / 待确认
后续: 需要做哪条 C 项变更
```

---

## 升级路径（超出本文件范围时）

| 情况 | 找谁/做什么 |
|---|---|
| 需要改驱动/CUDA/内核 | 必须走变更评审，不在本文范围 |
| 需要多机部署或换模型 | 重新做容量评估（`01-inventory.md` 的基线是单模型 103.7 GiB） |
| 怀疑硬件故障（温度异常/ECC/掉卡） | NVIDIA 支持渠道；先保留 `nvidia-smi -q` 全量输出与 `dmesg` |