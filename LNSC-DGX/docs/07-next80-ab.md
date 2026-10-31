# 07 · Qwen3-Next-80B A/B 实测与日常默认切换（2026-10-28）

> 历史选型记录。2026-10-28 晚经 27B 与真实任务复评后，质量默认已改回 Flash；当前状态见 `docs/08-qwen38-27b-trial.md`。

## 结论

**日常默认改为 `llama-qwen3next`；`llama-qwen38` 保留为复杂推理/视觉回退。**
当前运行态：Next `active + enabled`；Flash `inactive + disabled`。二者同用 8081，客户端无需改地址。
Next 没有 mmproj，`vision:false`；需要图片时必须切回 Flash。

## 模型与校验

- repo：`unsloth/Qwen3-Next-80B-A3B-Instruct-GGUF`
- 文件：`/models/qwen3-next-80b-a3b-instruct/UD-Q4_K_XL/Qwen3-Next-80B-A3B-Instruct-UD-Q4_K_XL.gguf`
- 大小：`46,067,137,312 bytes = 42.90 GiB`
- 上游/本地 SHA256：`49e554f954afbfc9f627b8be236adf16c1e51d8e5ecaa0e65ac8ede4e2c41a56`
- 本机加载：34.8 秒；`n_params=79,674,391,296`，原生上下文 262144

下载最终使用 aria2c 8 连接，平均 42 MiB/s。早期 curl 内部 retry 曾在超时后从 0 重写 `.part`，已废弃该方式；脚本现使用 `.aria2` 控制文件，并校验大小、GGUF magic 和上游 SHA256。

## A/B 方法

- 两个 unit 的推理参数相同：`-c 196608 -b 2048 -ub 1024 -ngl 999 -fa on -ctk q8_0 -ctv q8_0 --cache-reuse 256 --jinja --parallel 1 --metrics`
- 同一 session、同一请求文本；两次 cold 的 request SHA256 均逐一一致：
  - run 0：`3ea7948c9e456e0b7692d5872b123cd38b6d2bc56abda25d2f2d00df9c31f104`
  - run 1：`ff2af25bbc0363bd1f3d847fce112628288b7fe56e0136917d6a04d4872d2c4e`
- 每次 cold：约 39k prompt + 强制 512-token decode；另测同 prompt 热缓存、短 prompt 512-token decode。
- 原始结果：DGX `/root/lnsc-ab/flash39/`、`/root/lnsc-ab/next39/`；工具在 `/root/lnsc-ab/bin/`。

## 性能结果（两次 cold 均值）

| 指标 | Flash-Next | Next-80B | Next / Flash |
|---|---:|---:|---:|
| 实际 prompt tokens | 38,978 | 38,934 | tokenizer 差 44，请求文本相同 |
| 39k prefill 时间 | 37.26 s | **17.45 s** | **2.14× 快** |
| prefill 吞吐 | 1045 tok/s | **2232 tok/s** | **2.14×** |
| 长上下文 decode 512 | 24.75 tok/s | **53.90 tok/s** | **2.18×** |
| cold 总耗时（prefill+512） | 58.42 s | **27.21 s** | **2.15× 快** |
| 短 prompt decode 512 | 29.40 tok/s | **68.55 tok/s** | **2.33×** |
| 同 39k prompt 热缓存 | 0.265 s | **0.207 s** | 均只新算 4 token |

这些是 GB10 本机实测，不是理论推算。短/长上下文差异明显，因此不要只引用一个 decode 数字。

## Cline 类质量任务

工具调用、区间合并 bug 修复、跨文件 Decimal 金额重构。代码在无网络临时目录中，以 `nobody` 降权运行，限制 CPU/内存/文件数；测试工装先用参考实现自验通过。

| 任务 | Flash | Next |
|---|---|---|
| `read_file` 工具名和路径参数 | PASS，2.705 s | PASS，0.760 s |
| 区间合并（空/乱序/嵌套/不可变输入） | PASS，158.936 s / 4669 tokens | PASS，1.867 s / 107 tokens |
| 跨文件金额计算与格式化 | PASS，84.500 s | PASS，3.333 s |
| 合计 | **3/3** | **3/3** |

注意：Flash 第一次在 4096-token 上限下因 reasoning 未结束而 `content` 为空，不能据此判为代码能力失败；统一提高到 16384 后重跑通过。Next 为 Instruct 非思考模型，日常输出短很多。
这些任务是冒烟/回归测试，不代表复杂架构设计、疑难推理与 Flash 等质；硬任务仍保留 Flash 回退。

## 内存观测

- Flash 基线期间：`MemAvailable` 约 14~15 GiB；llama-server `VmSwap` 一度约 15.2 GiB，swap 几乎耗尽。
- Next A/B 后：`MemAvailable` 约 68~69 GiB；cgroup 46.36 GiB；swap 仅 83 MiB。
- Next 启动前已确认旧模型完全退出，`MemAvailable=118 GiB`；没有双模型重叠。

## 首次切换故障与修正

第一次仅依赖 `Conflicts=`，旧 Flash 退出与新 Next 加载存在重叠，Next 在 08:52 被 OOM killer 杀死。另有一终端手工启动旧参数 Flash 抢占 8081，导致 systemd 恢复失败。
最终修正 `model-switch.sh`：

1. 切换前等 slot 空闲；
2. 显式 stop 旧 unit，并等待所有 `llama-server` 进程消失；
3. 有遗留/手工进程时拒绝启动第二实例；
4. 健康检查必须匹配目标 `/v1/models` alias，而非只看任意 `/health`；
5. 目标失败时先排空目标进程，再恢复旧 unit；不清理额外进程时不盲目恢复。

第二次切换于 09:01 成功；良好启动后无 FA slow-path、OOM 或加载错误。

## 日常操作与回滚

```bash
# 状态 / 运行时互斥切换（不改 enabled）
bash /root/lnsc-ab/bin/model-switch.sh status
bash /root/lnsc-ab/bin/model-switch.sh flash   # 复杂推理、图片
bash /root/lnsc-ab/bin/model-switch.sh next    # 回到日常模型

# 当前开机默认：Next（已执行）
systemctl enable llama-qwen3next
systemctl disable llama-qwen38

# 如需把开机默认永久恢复为 Flash
bash /root/lnsc-ab/bin/model-switch.sh flash
systemctl enable llama-qwen38
systemctl disable llama-qwen3next
```

## 尚未验证

- 未做整机 reboot；只验证了 unit 的 enabled 链接与当前运行态。
- 未做 30 分钟以上真实流量 soak；需继续看 swap、MemAvailable、cancel task 和长上下文 decode。
- 三项代码任务较简单；复杂推理质量仍需真实 Cline 使用验收。
- Next 无视觉；不要把图片请求发给它。
