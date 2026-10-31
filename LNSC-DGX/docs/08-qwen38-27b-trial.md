# 08 · Qwen3.8-27B 质量候选实测与最终模型选择（2026-10-28）

## 最终结论

**不采用 Qwen3.8-27B 作为 Cline 日常替换模型。** 它在同一跨文件任务上连续犯错，且 Q6 decode 明显慢于 Next 和 Flash。
当前质量默认改回 **Qwen3.8-Flash-Next**；Next-Instruct 保留为速度回退；27B 停止并禁用。

## 当前状态

| unit | active | enabled | 角色 |
|---|---|---|---|
| `llama-qwen38` | active | enabled | 质量主模型，8081 |
| `llama-qwen3next` | inactive | disabled | 速度回退 |
| `llama-qwen38-27b` | inactive | disabled | 本次评测不采用 |

Cline 继续使用 `http://10.86.20.57:8081/v1`，模型名 `qwen3.8-flash-next`。

## 27B 部署与校验

- 模型：`Qwen3.8-27B-UD-Q6_K_XL.gguf`
- 大小：25,299,061,664 B（23.56 GiB）
- SHA256：`701d8fa9ed214ab21bfc130cd2a7df19ca89bbef7713e2dfb19f3c63696aa917`
- mmproj：F16，SHA256 `cbb841a9ee0636b2ec172f5bb8df2ea8dfeb01e90fe7c6126581d662a0b4e43e`
- llama.cpp `qwen35` 支持正常；文本/图片/视频能力正常；Thinking 有独立 `reasoning_content`。
- 27B 模板把 `high` 映射为 `xhigh`。xhigh 跨文件任务长时间推理，交互成本不可接受，因此改测 medium。

## 同文本性能（Q6 xhigh）

| 指标 | Next-Instruct | 27B Q6 |
|---|---:|---:|
| 39k prefill | 约 17.1 s / 2276 tok/s | 约 43.9 s / 887 tok/s |
| 长上下文 decode 512 | 约 52.8 tok/s | 约 8.85 tok/s |
| 39k + 512 总耗时 | 约 27.3 s | 约 102.4 s |
| 短上下文 decode 512 | 66.89 tok/s | 9.59 tok/s |
| 热缓存 | 0.200 s | 0.376 s |

27B 是质量候选，不应因官方 benchmark 或 27B 参数较少而推断其一定更快。

## 代码/工具任务

| 任务 | Next-Instruct | Ollama 27B Q4 | 27B Q6 medium |
|---|---|---|---|
| 工具调用 | PASS，0.760 s | PASS，16.325 s | PASS，5.202 s |
| 区间合并修复 | PASS，1.867 s | PASS，18.662 s | PASS，101.002 s |
| 跨文件 Decimal 重构 | **PASS，3.333 s** | **FAIL，61.152 s** | **FAIL，170.625 s** |
| 合计 | **3/3** | **2/3** | **2/3** |

两个 27B 版本都把原本接收 `items` 的跨文件 API 错改成接收单独 `price, qty`，导致 `TypeError`。Q6 medium 并未修复 Q4 的实质错误。
xhigh 配置在合理交互时间内未结束，不作为日常候选。

## 与已验证 Flash 的对照

Flash 此前在相同三类任务为 **3/3**；区间修复在给予足够推理预算后通过，跨文件重构通过。
其已实测 39k prefill 约 37.3 s、长上下文 decode 约 24.75 tok/s、短上下文约 29.40 tok/s，均比本次 27B Q6 更适合质量优先的 Cline。

## 部署决定与限制

- Flash 恢复 `active + enabled`，客户端仍使用 8081。
- Next 改为 `inactive + disabled`，通过 `model-switch.sh next` 可换速度。
- 27B 文件保留磁盘以便审计，但 unit `inactive + disabled`，不占运行内存。
- Flash 切换后初始 `MemAvailable≈7.4 GiB`，需继续观察长会话 swap；这是质量选择的现实成本。
- 三项自动任务不是完整智力评测；27B 官方分数不抵消本次实际失败。若 Flash 仍达不到真实任务要求，应使用更强的云端模型或增加硬件，而不是继续盲目堆积本地候选。

原始结果：`/root/lnsc-ab/ollama27-q4/`、`/root/lnsc-ab/qwen38-27b-q6/`、`/root/lnsc-ab/qwen38-27b-q6-medium/`、`/root/lnsc-ab/next-for27/`。
