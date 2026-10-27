# 故障 → 处置对照表（GB10 / llama.cpp / Qwen3.8-Flash-Next）

## A. 上下文相关

| 报错 | 原因 | 处置 |
|---|---|---|
| `the request exceeds the available context size (49152 tokens), try increasing it` | `-c` 设小了（49152=48k），且请求 49216 已顶满、无输出空间 | `-c 131072`（脚本默认值）。llama.cpp **不会**自动截断单个超长请求 |
| 改成 131072 后仍报同一个错，但数字变成 65536 | 加了 `--parallel 2`，`-c` 被 slot 均分 | `--parallel 1`，或把 `-c` 提到 262144 |
| 上下文够了但模型"变傻"、答案漏掉前文 | `-c` 超过模型原生 `context_length`，未配 RoPE 缩放 | `llama-gguf <model> \| grep -iE 'context_length\|rope'` 确认；超了必须加 `--rope-scaling yarn --rope-scale 2` |
| 多轮对话中途"忘了"最早的内容 | 默认开启 context shift，静默丢弃最老 token | 客户端做截断/摘要；或 `--no-context-shift` 让它显式报错 |

## B. 性能相关

| 现象 | 原因 | 处置 |
|---|---|---|
| **首次请求要等 30~60 秒才出字**（客户端像卡住） | 客户端首轮 prompt 很大（Cline 实测 **38,972 tokens** = 系统提示 + 工具/MCP 定义 + 历史）。服务端 prefill ≈ **1082 tok/s @24k**，39k 需 **~36 s**；若模型先思考，还要加 decode 时间（29.7 tok/s） | **正常，别中途取消**（取消 = 前面全白算）。对照：5k≈5s / 20k≈18s / 39k≈36s / 100k≈92s。<br>要更快 → 减小客户端 prompt（关不用 MCP、少带 `@file`、开新会话）+ 客户端 timeout 调到 300~600 s |
| 第二轮起就很快（3~9 s） | prompt cache 命中，只算新增 token | 正常。**别频繁重启服务或切模型**，否则 cache 清空又吃全量 prefill |
| 日志出现 `W srv stop: cancel task` | 客户端超时或用户点了停止 | 调大客户端 request timeout；确认开启 streaming |
| 49k prompt 首字要几分钟 | `-ub 32`（GPU 每轮只算 32 token，需 ~1540 轮） | `-b 2048 -ub 1024`（实测 24k: 935→1082 tok/s） |
| 生成速度只有个位数 tok/s | `-ngl` 没生效 / 层被切到 CPU；或 `-fa off` | `-ngl 999` + `-fa on`；看日志 `offloaded N/N layers to GPU` |
| 长上下文时显存突然飙高 | `-fa off` 下 attention 工作区随 `n_ctx` 放大 | `-fa on` |
| 日志出现 `no FlashAttention vector kernel compiled for K/V types q8_0-q4_0, converting K and V to f16 instead (slow)` | **`-ctk` 与 `-ctv` 用了不同类型**。本 build 只编译了同型 4 种：`GGML_CUDA_FA_QUANTS="q4_0-q4_0;q8_0-q8_0;f16-f16;bf16-bf16"`（`GGML_CUDA_FA_ALL_QUANTS=OFF`） | **把两者改成同型**（推荐 `-ctk q8_0 -ctv q8_0`，KV ≈ 24 KiB/token）。<br>实测代价：`k=q8_0,v=q4_0` 时每步把历史 K/V 转 f16，196k 上下文下相当于每步多搬 ~3.5 GB → 长上下文 decode 明显变慢。<br>要用混型只能重编译：`-DGGML_CUDA_FA_QUANTS="q4_0-q4_0;q8_0-q8_0;q8_0-q4_0;f16-f16"` |
| 想查这个 build 到底支持哪些 FA 组合 | 编译期决定，不是运行期 | `grep GGML_CUDA_FA_QUANTS /opt/llama.cpp/build/CMakeCache.txt` |
| 第二批请求比第一批慢很多 | page cache 被 KV 挤掉，GGUF 重新读盘 | 加 `--no-mmap` 或 `--direct-io`；或 `sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'` |

## C. 参数/构建相关

| 报错 | 原因 | 处置 |
|---|---|---|
| `error: invalid argument: --no-mmap` | **本机 build 实测没有该选项**（`--help` 里 `--no-mmap`/`--direct-io`/`--mmap`/`--mlock` 全部缺失） | **删掉即可，不要重试**。page cache 被挤掉是可回收的 clean 页，不影响推理速度，仅让重启时重新读盘（103.7 GiB） |
| `-fa` 报 invalid argument | 不同 build 的 FA 开关写法不同：`-fa on` / `-fa 1` / `--flash-attn on` | `llama-server --help \| grep -i flash`，按实际写法传；脚本已自动探测 |
| `error: invalid argument: -sm` | 某些 build 无 split-mode | 单卡直接删掉 |
| `no kernel image is available for execution on the device` | 二进制编译时未指定 `sm_121` | 重新编译：`cmake -B build -DGGML_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=121` |
| KV 量化启动即报错 | `-ctk/-ctv` 要求 FA 路径 | 先 `-fa on` 再开 KV 量化 |

## D. 内存/系统相关（GB10 独有）

| 现象 | 判定 | 处置 |
|---|---|---|
| `free -h` 显示 `used 112Gi / available 8.9Gi` | **先查权重体积再判断**：`curl -s :8081/v1/models \| jq '.data[0].meta.size'`。若 ≈104 GiB（177B@Q4_K_M），则 `used 112Gi` 是**正常稳态**；若权重只有 40~50 GiB 却 used 100Gi+，才是重复实例 | 重复实例才 kill：`pgrep -ax llama-server` → `sudo kill <旧PID>` |
| `used` 很高但 `available` 尚可 | 正常：`used` 里含可回收的 page cache | **看 `available`，不看 `used`** |
| `Swap used` 持续增长 | 统一内存已被吃穿，进入抖动区 | 立刻降 `-c`/`-ub`；`sysctl vm.swappiness=10`；systemd 加 `MemoryMax` |
| SSH 卡死、无响应 | 统一内存耗尽导致整机 thrash | 只能硬断电；此后务必用 systemd + `MemoryMax=100G` 托管，把故障降级为进程被杀 |
| `nvidia-smi` 显示 ~100GiB | 权重占了两份（mmap page cache + GPU buffer） | 加 `--no-mmap`/`--direct-io`；不加也不致命（那份是可回收的 clean page cache） |

## F. 图片 / 多模态（✅ 2026-10-27 23:32 已修复：加入 mmproj 后 vision+video 均可用）

> **现状**：`modalities: {"vision":true,"video":true,"audio":false}`，真图识别验证通过。
> 下面 F1~F2 保留为"故障期记录与判定手法"，排查同类问题时仍可用。

### F1. 报错原文（历史）

```json
{"error":{"code":500,"message":"image input is not supported - hint: if this is unexpected, you may need to provide the mmproj","type":"server_error"}}
```

**任何客户端（Cline / OpenAI SDK / curl）给 `qwen3.8-flash-next` 发图片都会得到这条 500，属预期行为，不是 bug，不要反复重试。**

### F2. 三步判定（任意机器 30 秒可复现）

```bash
# 1) 模型声明的模态
curl -s http://127.0.0.1:8081/props | tr ',' '\n' | grep -A3 modalities
#   期望（当前）：{"vision":false,"video":false,"audio":false}

# 2) 启动命令有没有 --mmproj
ps -o args= -p "$(pgrep -x llama-server | head -1)" | tr ' ' '\n' | grep -i mmproj
#   当前：无输出

# 3) 磁盘上有没有投影器文件
find / -xdev -iname '*mmproj*' 2>/dev/null
#   当前：无

# 4) 反证：直接喂一张图
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":[{"type":"text","text":"hi"},
       {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}}]}],"max_tokens":8}'
#   当前：500（纯文本同样请求 → 200）
```

### F3. 定性结论（2026-10-27 23:28 更新）

| 项 | 事实 |
|---|---|
| 模型架构 | 支持视觉。chat template 内含 `do_vision_count`、`<\|vision_start\|><\|image_pad\|><\|vision_end\|>`、`Picture N:` |
| 模型来源 | `modelscope download --model unsloth/Qwen3.8-Flash-Next-GGUF --include "UD-Q4_K_XL/*"` —— **当初只下了 4 个语言塔分片** |
| repo 实际提供 | ✅ `mmproj-F16.gguf`（0.90 GB）、`mmproj-BF16.gguf`（0.91 GB）、`mtp-*.gguf`（4.14 GB，推测解码用） |
| 本机现状 | ✅ **`mmproj-F16.gguf` 已于 23:27 下载并放到 `/models/qwen3.8-flash-next/`**<br>（862 MiB，`GGUF` magic 正确，sha256 `1f7b7f0b984cf065c604360c29c8098362ed61b290db0ff12c6f360bb1a8a980`） |
| 服务现状 | ❌ 仍未启用：启动命令没有 `--mmproj`，`/props` 仍 `vision:false`，发图仍 500 |
| 结论 | **不是模型不支持，是部署少了一个 0.9 GB 文件 + 一个启动参数。文件已就绪，等重启窗口启用** |

> 换句话说：**改一行 `ExecStart` 就能让 177B 模型看懂图片**，代价只有 0.9 GB 常驻内存 + 一次重启。

### F4. 启用视觉的三个前置条件（第 1、3 条已满足）

1. ~~拿到配对 projector~~ ✅ **已就位**：`/models/qwen3.8-flash-next/mmproj-F16.gguf`
   - ⚠️ 不要挪用 Ollama 里 `qwen3.8:27b` 的 clip projector（931 MB，dims 5120）—— 那是 27B 的视觉塔，与 176.9B 不配对
2. **重启 llama-server**（窗口内），在 `ExecStart` 里加 `--mmproj /models/qwen3.8-flash-next/mmproj-F16.gguf`
3. **内存余量**：projector 常驻 **0.9 GB**；图片 token 进 KV（Qwen-VL 一张 1080p ≈ 1~2k token，按 24 KiB/token ≈ **25~50 MB/图**）
   - 当前 `MemAvailable` **7.1 GB**，`cgroup current` 32.1 GiB → **加 0.9 GB 完全可行**（余量降到约 6.2 GB）
   - ⚠️ 若之后把上下文提到 262144，需要重新核算

### F5. 启用路径（C6，需窗口）

```bash
# 1) 备份并改 unit（只改 ExecStart，加一行 --mmproj）
sudo cp -a /etc/systemd/system/llama-qwen38.service /root/llama-qwen38.service.bak.$(date +%s)
sudo sed -i 's#^  --alias qwen3.8-flash-next \\#  --alias qwen3.8-flash-next \\\n  --mmproj /models/qwen3.8-flash-next/mmproj-F16.gguf \\#' \
  /etc/systemd/system/llama-qwen38.service
sudo systemctl daemon-reload
sudo systemd-analyze verify /etc/systemd/system/llama-qwen38.service

# 2) 重启用（约 95 秒）
sudo systemctl restart llama-qwen38

# 3) 验收：modalities 必须变 true
curl -s http://127.0.0.1:8081/props | tr ',' '\n' | grep -A3 modalities
journalctl -u llama-qwen38 -b --no-pager | grep -iE 'mtmd|clip|mmproj|vision|error' | tail -10
grep MemAvailable /proc/meminfo

# 4) 真图测试（1x1 PNG，期望 HTTP=200 而不是 500）
curl -s -o /dev/null -w 'HTTP=%{http_code}\n' -X POST http://127.0.0.1:8081/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"qwen3.8-flash-next","messages":[{"role":"user","content":[{"type":"text","text":"what color"},
       {"type":"image_url","image_url":{"url":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="}}]}],"max_tokens":16}'
```

**回滚**：`sudo systemctl disable --now llama-qwen38` 并恢复备份 unit，或删掉 `--mmproj` 那行后 `daemon-reload && restart`。

**失败判据**：若 `/props` 仍 `vision:false`，或 journal 出现 `failed to load model`/`mtmd` 相关错误 → 说明 projector 与权重不配套，立即回滚（文件可保留，不影响文本模式）。

### F6. 顺带发现的隐患

`/models/qwen3.8-flash-next/` 顶层还残留一份 shard 1 副本
（`Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf`，10.9 MB，root 所有），
真身是 `UD-Q4_K_XL/` 里的那份。若有人把 `-m` 指到顶层目录，llama.cpp 会去找不存在的
`00002~00004` 而启动失败。建议清理（占用仅 10 MB，低优先）：

```bash
rm -f /models/qwen3.8-flash-next/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf
```

---

## E. 验收标准

启动后必须同时满足：

```bash
curl -s http://127.0.0.1:8081/props | jq '.default_generation_settings.n_ctx'   # 131072
free -h                                                                          # available ≥ 20Gi
sudo nvidia-smi --query-compute-apps=pid,used_memory --format=csv                # 单实例 ≈ 51~55 GiB
```

启动日志里应有（最准的占用依据）：

```
llama_kv_cache_unified: CUDA0 KV buffer size = 3072.00 MiB     # q8_0 @128k（f16 则是 6144）
llama_model_loader: ... model buffer size = 4xxxx.xx MiB
llama_context: n_ctx = 131072, n_batch = 2048, n_ubatch = 512
```