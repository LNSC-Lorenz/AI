# 19 · NVIDIA Connect Two Sparks 官方配置对照

> 参考：`NVIDIA/dgx-spark-playbooks/nvidia/connect-two-sparks`，main README SHA `c3612c8ec74a6dbbcc60f38088b1fba6d5d1695a`  
> 日期：2026-10-30  
> 结论：**当前 QSFP 物理/逻辑接口和 IP 配置符合官方 Playbook；不需要重跑 netplan。GDR 问题不在该连接文档范围内。**

## 1. 一根 DAC 与两个逻辑接口

官方明确说明：每个物理端口有两个逻辑接口。例如 `enp1s0f1np1` 和 `enP2p1s0f1np1` 可以对应同一个物理 QSFP 端口。一根 QSFP 即可实现完整带宽；两根线缆时才需要为四个接口配置地址。

因此当前“一根 DAC，但两个接口 UP 并参与 RDMA”不是异常，也不是两条独立物理链路。

官方示例使用 `f1` 逻辑接口 UP、`f0` DOWN；当前两台与此一致。

## 2. 配置对照

| 官方要求/示例 | 当前状态 | 判断 |
|---|---|---|
| 两台相同用户名 | 均为 root | 符合 |
| 一根 QSFP 直连 200GbE | 用户确认一根 DAC | 符合 |
| 两端使用相同物理端口 | 两端均为 f1 UP | 符合 |
| 每个物理端口两个逻辑接口 | 两个 f1 逻辑接口均 UP | 符合官方说明 |
| Node 1 `.100.10/24`、`.101.10/24` | head 完全一致 | 符合 |
| Node 2 `.100.11/24`、`.101.11/24` | worker 完全一致 | 符合 |
| 示例 MTU 1500 | 两台均 1500 | 符合 |
| 双向 SSH key | key 可用；反向 host key 信任仍需规范固化 | 基本符合 |
| netplan 或手工 IP 二选一 | 使用独立 systemd 地址单元 | 等效持久化，不重跑 netplan |

## 3. 与性能问题的关系

该文档只覆盖物理连接、IP 和 SSH，不包含 GPU Direct RDMA、CUDA DMA-BUF 或 NCCL 环境变量设置。因此：

1. 不需要通过修改 MTU、重新应用 netplan或增加第二根 DAC 来修复当前 NCCL 低速。
2. 两个逻辑接口并发 RDMA 约 185 Gb/s，与“一根线缆可实现完整带宽”的官方说明一致。
3. 当前 GDR 断层仍需按 CUDA/GB10 支持路径处理，见 `docs/18-rdma-gdr-layered-diagnosis.md`。
4. 不运行 `discover-sparks`，因为现有地址和 key 已基本配置；仅 host key 信任需要后续规范化。

官方链接：<https://github.com/NVIDIA/dgx-spark-playbooks/tree/main/nvidia/connect-two-sparks>
