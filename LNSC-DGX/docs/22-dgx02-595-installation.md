# 22 · DGX02 安装 595.71.05 与最终版本对齐

> 日期：2026-10-30  
> 状态：**完成；两台 kernel、CUDA、GPU driver 已完全一致，Secure Boot 保持 enabled，NCCL 约 19.08 GB/s。**

## 1. 最终版本

| 项目 | DGX01 | DGX02 |
|---|---|---|
| Kernel | 6.17.0-1021-nvidia | 6.17.0-1021-nvidia |
| GPU Driver | 595.71.05 | **595.71.05** |
| CUDA Toolkit | 13.2.2 | 13.2.2 |
| NCCL | 2.31.2 | 2.31.2 |

DGX02 使用 `nvidia-headless-no-dkms-595-open`，没有安装 DKMS、kernel 7.0 或 595.99。Secure Boot 仍 enabled。

## 2. 关键安装路径

1. 确认 Ubuntu 的 `linux-modules-nvidia-595-open-6.17.0-1021-nvidia` 依赖 `nvidia-kernel-common-595=595.71.05`，可使用 Canonical 预编译签名模块。
2. 从 Launchpad 下载 `595.71.05-0ubuntu0.24.04.1` 的 arm64 历史包，未使用 NVIDIA 仓库的 DKMS 包。
3. 安装 `nvidia-headless-no-dkms-595-open` 及配套用户态库。
4. 安装 `linux-modules-nvidia-595-open-6.17.0-1021-nvidia=6.17.0-1021.21`。
5. 验证 `modinfo -k 6.17.0-1021-nvidia nvidia`：
   - version=595.71.05
   - signer=Canonical Ltd. Kernel Module Signing
   - vermagic=6.17.0-1021-nvidia
6. `apt-get check` 通过后重启 DGX02。
7. 验证 kernel、driver、CUDA、QSFP、finance 容器和 NCCL。

包、SHA256 manifest、模拟与安装日志位于：

```text
/root/lnsc-ab/two-node/version-align-20261030/debs-59571/
/root/lnsc-ab/two-node/version-align-20261030/install-59571*.log
/root/lnsc-ab/two-node/version-align-20261030/verification-after-595-reboot.txt
```

## 3. 验证结果

- `uname -r`：6.17.0-1021-nvidia
- `nvidia-smi`：595.71.05
- `/usr/local/cuda`：/usr/local/cuda-13.2
- Secure Boot：enabled
- Dify：0 个容器
- finance-sqlapi：运行中
- finance-postgres：healthy
- QSFP 两个私网地址和 ping：正常

NCCL 16 GiB all-gather：

```text
Avg bus bandwidth: 19.0772 GB/s
Out of bounds values: 0 OK
```

证据：`/root/lnsc-ab/two-node/nccl-after-595-align-16G.log`

## 4. 下一步

Qwen Q1 已开始：固定 TensorRT-LLM arm64 digest 拉取镜像，随后下载固定 revision 的 Qwen3-235B-A22B-FP4。Q1 只准备文件，不启动推理服务。
