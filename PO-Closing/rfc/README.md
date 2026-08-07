# PO 收货批量查询 — 自定义 RFC 创建与部署指南

架构：独立 Ubuntu 设备（已装 NW RFC SDK）→ pyrfc → `Z_RFC_PO_GR_STATUS` → EKPO/EKBE
与 RPA/Prefect 无关；本机（Windows）仅保存源码，不安装任何依赖。

## 1. SAP 侧创建步骤（BASIS/ABAP，约 0.5 人天）

### 1.1 SE11 创建 DDIC 对象（先结构后表类型，逐个激活）

**结构 `ZS_PO_IN`**（输入：PO 号）

| 字段 | 数据元素 |
|---|---|
| EBELN | EBELN |

**结构 `ZS_PO_GR_STATUS`**（输出：行项目级结果）

| 字段 | 数据元素 | 说明 |
|---|---|---|
| EBELN | EBELN | PO 号 |
| EBELP | EBELP | 行项目 |
| MATNR | MATNR | 物料 |
| WERKS | WERKS_D | 工厂 |
| RETPO | RETPO | 退货行标识 |
| ORDER_QTY | BSTMG | 订单数量 |
| MEINS | BSTME | 单位 |
| NET_GR_QTY | BSTMG | 净收货数（S−H，已剔除 103/104） |
| DIFF_QTY | BSTMG | 差异 = 订单数 − 净收货 |
| UNTTO | UNTTO | 交货不足容差 % |
| UEBTO | UEBTO | 过量交货容差 % |
| ELIKZ | ELIKZ | 交货完成 |
| EREKZ | EREKZ | 最终发票 |
| LOEKZ | LOEKZ | 删除标识 |
| CAN_CLOSE | CHAR1 | 容差判定：X=可关单 |
| SUGGEST | CHAR20 | 建议：CLOSABLE / ALREADY_CLOSED / PARTIAL_GR / NO_GR / DELETED |

**表类型**：`ZTT_PO_IN`（行类型 ZS_PO_IN）、`ZTT_PO_GR_STATUS`（行类型 ZS_PO_GR_STATUS）

### 1.2 SE80 创建函数组

- 函数组：`ZPOCLOSE`，包：按需（本地测试可 `$TMP`，正式需传输包）

### 1.3 SE37 创建函数模块

1. 名称 `Z_RFC_PO_GR_STATUS` → 属性页签：**处理类型 = 远程启用模块**
2. **表格参数**页签添加：

| 参数名 | 类型 | 参考类型 |
|---|---|---|
| IT_EBELN | TYPE | ZTT_PO_IN |
| ET_RESULT | TYPE | ZTT_PO_GR_STATUS |
| ET_RETURN | TYPE | BAPIRET2_TAB |

3. 源代码页签粘贴 `Z_RFC_PO_GR_STATUS.abap` 中 FUNCTION 体 → 激活

### 1.4 权限（PFCG 专用角色 → RFC 通讯用户）

| 对象 | 值 |
|---|---|
| S_RFC | RFC_TYPE=FUGR，RFC_NAME=ZPOCLOSE，ACTVT=16 |
| M_BEST_EKO | ACTVT=03（显示采购凭证，按公司代码限定） |

> 用户类型建议：通讯用户（Communications/Data），禁对话登录。

### 1.5 SE37 自测（传输前必做）

输入 2~3 个真实 PO 执行，对照 **ME23N 行项目"采购订单历史"**逐项核对 `NET_GR_QTY`：

- [ ] 普通收货（101）+ 冲销（102）
- [ ] 部分收货 + 容差（UNTTO）行：`CAN_CLOSE` 是否符合预期
- [ ] 退货交货（122）已扣除
- [ ] 已删除行（LOEKZ='L'）→ `SUGGEST=DELETED`
- [ ] 若业务用 103/105 冻结收货：确认无双计
- [ ] 若有退货 PO（RETPO='X'，移动类型 161）：验证净值符号；为负则启用源码中注释的反转行
- [ ] 不存在的 PO → ET_RETURN 有 W 消息

### 1.6 传输

结构 → 表类型 → 函数组/函数 一个请求传输至 QAS → 复测 → PRD。

## 2. 设备侧部署（独立 Ubuntu，非本机）

```bash
# 前提：NW RFC SDK 已在 /usr/local/sap/nwrfcsdk，且 export SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
sudo mkdir -p /opt/pocheck && cd /opt/pocheck
python3 -m venv venv
./venv/bin/pip install pyrfc          # Linux 源码构建，依赖 SDK 环境变量
# 上传脚本与 PO 清单
scp po_gr_check.py po_list.csv user@<device>:/opt/pocheck/

# 连接参数走环境变量（勿写死密码在脚本里）
export SAP_ASHOST=<sap-host> SAP_SYSNR=00 SAP_CLIENT=100
export SAP_RFC_USER=RFC_PO_QUERY SAP_RFC_PASS='***'

/opt/pocheck/venv/bin/python /opt/pocheck/po_gr_check.py po_list.csv result.csv
```

**每周定时（crontab）**：

```cron
0 8 * * 1  cd /opt/pocheck && ./venv/bin/python po_gr_check.py po_list.csv result_$(date +\%Y\%m\%d).csv >> /var/log/pocheck.log 2>&1
```

## 3. 验收清单（设备端首跑）

- [ ] `python -c "from pyrfc import Connection"` 无报错（SDK 链接正常）
- [ ] 10 个 PO 小批量首跑成功，结果与 ME23N 抽查一致
- [ ] `CLOSABLE` 行抽样在 ME9F/ME23N 中确认为"收货完成未关单"
- [ ] 输出 CSV 用 Excel 打开无乱码（UTF-8-SIG）

## 4. 后续扩展：自动关单闭环

查询稳定后，在同一连接上追加 `BAPI_PO_CHANGE`（POITEM/POITEMX 置 `DELIV_COMPL='X'`）：

1. RFC 用户角色追加 M_BEST_EKO ACTVT=02（修改）+ BAPI_PO_CHANGE 所在函数组授权
2. 脚本增加 `--close` 模式：仅对 `CAN_CLOSE=X 且 EREKZ=X`（已最终发票）的行执行关单
3. 先在 QAS 全量演练，PRD 灰度（每日限量）→ 稳定后全量

## 5. 已知边界（落地前确认）

| 项 | 处理 |
|---|---|
| 103/104 冻结收货 | 函数已剔除，避免与 105 双计；需确认业务是否启用该流程 |
| 退货 PO（161） | 符号待真实数据验证，反转代码已预留 |
| 服务类 PO | 走 ESSR/ESLL，本函数不覆盖（EKBE 无 E 记录 → NET_GR_QTY=0，属预期） |
| 已归档 PO | 在线表查不到 → ET_RETURN 报"不存在"，属预期 |
| 每批上限 | 调用方 ≤5000/批（脚本已内置） |