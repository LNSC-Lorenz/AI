# 21 · DGX02 版本对齐、Dify 移除与 NCCL 恢复

> 日期：2026-10-30  
> 状态：**后续已完成 595 安装，两台 kernel 1021 / driver 595.71.05 / CUDA 13.2.2 完全一致；见文档 22。**

## 1. 最终版本状态

| 项目 | DGX01 / head | DGX02 / worker | 结果 |
|---|---|---|---|
| Kernel | 6.17.0-1021-nvidia / .21 | 6.17.0-1021-nvidia / .21 | 一致 |
| CUDA Toolkit | 13.2.2 | 13.2.2 | 一致 |
| GPU Driver | 595.71.05 | **580.159.03** | 按用户决定暂不安装 595，保留差异 |
| Secure Boot | disabled | enabled | 保留差异；worker 使用 Canonical 签名模块 |
| NCCL | 2.31.2 | 2.31.2 | 一致 |
| ConnectX firmware | 28.45.4028 | 28.45.4028 | 一致 |
| rdma-core | 50.0 | 50.0 | 一致 |
| Docker | 29.1.3 | 29.1.3 | 一致 |

DGX02 使用 `nvidia-headless-no-dkms-580-open`，不安装 DKMS、不引入 kernel 7.0 或 595。实际 1021 NVIDIA 模块版本为 580.159.03，签名者为 `Canonical Ltd. Kernel Module Signing`。

## 2. DGX02 变更

- 安装并启用 kernel `6.17.0-1021.21`。
- 安装并切换 `/usr/local/cuda` 到 `13.2.2`；`nvcc` 为 13.2。
- 将 580 分支更新到 580.159.03，以获取匹配 kernel 1021 的签名模块。
- 按计算节点方案移除 NVIDIA GUI/Xorg metapackage，使用 no-DKMS headless 用户态。
- 删除 Dell NCCL 2.28.3 对照构建目录和本次临时诊断脚本。
- 移除禁用的 GLM/RPC 试验 unit；保留当前 NCCL 2.31.2、模型、源码和证据。
- 旧 1014 kernel 与 CUDA 13.0 文件保留作恢复参考；GPU 回退仍需配套恢复旧 580.142 模块。

安装前/后清单与日志：`/root/lnsc-ab/two-node/version-align-20261030/`

## 3. Dify 移除

已移除 Compose 项目 `docker` 的 Dify 容器和网络，包括 api、worker、web、db_postgres、redis、weaviate、sandbox、plugin daemon、nginx 等。未使用 `down -v`，未删除 volumes 或镜像。

保留：

- `finance-sqlapi`
- `finance-postgres`

重启后两者均恢复，PostgreSQL 为 healthy。

备份位于：

```text
/root/lnsc-ab/two-node/version-align-20261030/dify-backup/
```

包含 Compose 配置、container inspect、volume 清单和 PostgreSQL dump（gzip 约 6.6 MiB）。备份文件含敏感配置，权限为 root-only，不应提交到仓库。

## 4. QSFP 地址持久化修复

重启后 NetworkManager 的自动 DHCP connection 再次移除了 worker QSFP 地址，导致短暂 `No route to host`。

两台均已添加 `lnsc-cx7-addresses.service.d/10-unmanaged.conf`，在地址单元启动前将两个 QSFP 接口设为 NM unmanaged，并恢复：

- head：192.168.100.10 / 192.168.101.10
- worker：192.168.100.11 / 192.168.101.11

管理网 `enP7s7` 未修改。修复后双向 ping 和 SSH 均正常。

## 5. NCCL 结果

同一 NCCL 2.31.2、同一 `all_gather_perf -b 16G -e 16G -f 2`、无调优环境变量：

| 测试 | busbw | 数据校验 |
|---|---:|---|
| 对齐前基线 | 3.02651 GB/s | 0 wrong |
| 对齐后第一次 | **19.1084 GB/s** | 0 wrong |
| 对齐后复测 | **19.0523 GB/s** | 0 wrong |

提升约 6.3 倍，达到 Dell 单 DAC 参考 22.2623 GB/s 的约 86%。结果支持“DGX OS/驱动整栈是主要因素”的判断，不再支持把低速归因于单 DAC 或 NCCL 版本。

证据：`/root/lnsc-ab/two-node/nccl-after-align-16G*.log`

## 6. 当前边界

- 没有开始 Qwen Q1 模型或容器下载。
- 没有恢复 GLM/RPC 服务。
- driver 595 仍按用户决定暂停，不宣称两台所有版本完全一致。
- 后续如进入 Qwen 阶段，应重新按阶段确认，并记录当前 NCCL 新基线。
