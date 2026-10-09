# PO 收货状态查询 — RFC 对接指南

架构：独立 Ubuntu 设备（已装 NW RFC SDK）→ pyrfc → `Z_OA_GET_POGR_STATUS`（SAP 侧 OA 交付的业务函数）
与 RPA/Prefect 无关；本机（Windows）仅保存源码，不安装任何依赖。

## 1. 接口说明（Z_OA_GET_POGR_STATUS）

**输入** `IT_EBELN`：PO 号清单（每批 ≤5000，脚本已内置分批）

**输出**：`EV_STATUS`（S 成功 / W 未查询到相关数据 / E 失败）+ `EV_MESSAGE` + 明细表

**明细表字段**（粒度 = 订单行 × 物料凭证行，头部字段随凭证行重复）：

| 字段 | 说明 |
|---|---|
| EBELN / EBELP | PO 号 / 行项目 |
| MATNR / MEINS | 物料 / 单位 |
| PO_MENGE | 订单数量 |
| GR_MENGE | 净收货数量（退货/冲销已扣除） |
| GR_STATUS / GR_STATUS_TEXT | 0 未收货 / 1 部分收货 / 2 收货完成（含人工关单） |
| MBLNR / MJAHR / ZEILE | 物料凭证号 / 年度 / 凭证行 |
| DOC_MENGE / BLDAT / BUDAT | 凭证数量 / 凭证日期 / 过账日期 |

**权限**：RFC 通讯用户需对该函数所在函数组有 S_RFC 执行权限（PFCG 角色，找 Basis 维护）。

> **适配要点**（`po_gr_check.py` 已实现）：
> 按 EBELN+EBELP **去重取首行**（头部字段随凭证行重复，直接 sum 会翻倍）；
> EBELN 前导零归一；GR_STATUS 0/1/2 → 未收货/部分收货/完整收货；
> 凭证明细收入 `GR_DOCS`（JSON）供前端下钻；函数名可用 `SAP_FM` 环境变量覆盖。

## 2. 设备侧部署（Ubuntu，2026-08 实测通过）

落点：应用 `/var/www/lnsc-apps/apps/po-closing/`；SDK `/usr/local/sap/nwrfcsdk`；参数 `.env`（600 root）。

### 2.1 一键安装（SDK + 工具链 + pyrfc + cron）

```bash
cd /var/www/lnsc-apps/apps/po-closing
sudo bash install/bach_POClosing_SAP --with-sdk
```

- SDK 用仓库自带 `install/linux-nwrfc750P_5-70002752/nwrfcsdk`（750 PL5，完整性已校验），免下载；也可 `--with-sdk /path/SAPNWRFC.zip`
- 自动：编译工具链（build-essential/python3-dev）→ 编译 pyrfc → 追加每周一 08:00 快照 cron
- **pyrfc 钉死 3.3.1**：PyRFC 仓库 2026-05 被 SAP 归档，PyPI 全版本 yanked，必须精确指定版本号才能安装（yanked 警告可忽略）。3.3.1 为最终版，支持 Python 3.12，与 SDK PL5 搭配实测可用

### 2.2 SAP 参数（.env，600 root）

```ini
POCLOSE_DATA_SOURCE=rfc
SAP_ASHOST=172.31.4.50     # 应用服务器
SAP_SYSNR=07               # 实例号（RFC 端口 33<实例号> = 3307）
SAP_CLIENT=100             # 集团
SAP_RFC_USER=WEAVER        # RFC 通讯用户（禁对话登录，无法 GUI 验证）
SAP_RFC_PASS=密码           # 原样填写，含 $ 空格 引号均可（引号会被自动剥除）
SAP_LANG=EN                # 登录语言，以目标系统已装语言包为准
```

**关键：脚本（po_gr_check.py / rfc_smoke_test.py）用 Python 直接解析 .env，不经 shell**——
密码含 `$`、反引号、空格时 shell 加载（`set -a; . .env`）会展开/截断，表现为
「密码肯定对但 SAP 报 Name or password is incorrect」。本项目实测踩坑后固化。
（Web 服务走 systemd EnvironmentFile 注入，不经 shell，同样安全。）

### 2.3 连通性冒烟测试（不依赖业务函数）

```bash
cd /var/www/lnsc-apps/apps/po-closing
sudo venv/bin/python rfc/rfc_smoke_test.py
# 默认调 Z_OA_GET_MATDATA I_MATNR=945120
# （实测返回 E_MAT: 945120 / 9CN0371500010 密封环 / PC / ZMAT，与 OA 数据一致）
# 自定义：rfc_smoke_test.py <函数名> <参数=值> ...
# 参数名猜错会自动调 RFC_FUNCTION_DESCRIBE 打印真实签名；返回空试 18 位前导零物料号
```

### 2.4 业务函数验证 + 生效

```bash
# 无 SAP 依赖的适配层自测（映射/去重/判定）：
sudo venv/bin/python rfc/_test_adapt.py          # 期望 ALL PASS

# 真实连通：
printf '4526018353\n' | sudo tee po_list.csv >/dev/null
sudo venv/bin/python rfc/po_gr_check.py po_list.csv result.csv && cat result.csv
sudo systemctl restart poclose
curl http://127.0.0.1:8088/api/health   # 期望 "source": "rfc"
```

### 2.5 排错对照（2026-08 实测排障记录）

| 现象 | 根因 | 处置 |
|---|---|---|
| pip 报 yanked / from versions: none | PyRFC 已归档，全版本 yanked | 精确 `pip install pyrfc==3.3.1`（脚本已固化） |
| `KeyError: SAP_RFC_PASS`（其余变量正常） | 密码含空格，shell 加载被截断 | 脚本 Python 直读 .env 后根治 |
| 密码确认无误仍 Name or password is incorrect | 密码含 `$`/反引号被 shell 展开 | 同上——绕过 shell 后即通 |
| error during logon（无详情） | 登录语言包未装 / client 不存在 | 换 SAP_LANG（EN↔ZH）；找 Basis 确认 client |
| Name or password is incorrect | 密码错或账号锁 | 通讯账号无法 GUI 验证，以 RFC 调用为准；SU01 解锁/重置 |
| FU_NOT_FOUND | 函数未激活 / 无权限 | 找 Basis 确认 Z_OA_GET_POGR_STATUS 状态与授权 |

> 判断口诀：**能收到 SAP 的应用层报错（如密码错误）= 网络/SDK/协议全通**，问题只在凭据或函数。

## 3. 验收清单（设备端首跑）

- [ ] `python -c "from pyrfc import Connection"` 无报错（SDK 链接正常）
- [ ] 10 个 PO 小批量首跑成功，收货状态/数量与 ME23N 抽查一致
- [ ] 不存在的 PO → 前端显示「查无此单」（EV_STATUS=W 不报错）
- [ ] 输出 CSV 用 Excel 打开无乱码（UTF-8-SIG）

## 4. 后续扩展：自动关单闭环

查询稳定后，在同一连接上追加 `BAPI_PO_CHANGE`（POITEM/POITEMX 置 `DELIV_COMPL='X'`）：

1. RFC 用户角色追加 M_BEST_EKO ACTVT=02（修改）+ BAPI_PO_CHANGE 所在函数组授权
2. 脚本增加 `--close` 模式：仅对 `CAN_CLOSE=X` 的行执行关单（发票核对通过为前提）
3. 先在 QAS 全量演练，PRD 灰度（每日限量）→ 稳定后全量

## 5. 已知边界（落地前确认）

| 项 | 处理 |
|---|---|
| 已删除 PO 行 | 接口无删除标识（LOEKZ），已删行显示为「未收货」（噪音，可接受） |
| 已人工关单未足额行 | GR_STATUS=2 口径含关单，展示为收货完成（业务上该单已完结，属预期） |
| 服务类 PO | 走 ESSR/ESLL，接口不覆盖 → 显示未收货/查无此行，属预期 |
| 已归档 PO | 查不到 → 按「查无此单」（missing）处理，属预期 |
| 每批上限 | 调用方 ≤5000/批（脚本已内置） |
