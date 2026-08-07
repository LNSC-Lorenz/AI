# PO 收货情况批量查询 —— 方案对比与选型标准

## 1. 背景与目标

- **输入**：PO 号清单（EBELN 列表）
- **目标**：批量获取这些 PO 所有行项目的收货情况，支撑 PO Closing（关单）判断
- **关单判定核心**：净收货数量是否达到订单数量（含容差），即是否可置"交货完成"（ELIKZ）

## 2. 涉及的核心表与判断逻辑

| 表 | 用途 | 关键字段 |
|---|---|---|
| EKKO | 采购订单抬头 | EBELN, BUKRS, LIFNR |
| EKPO | 行项目 | EBELP, MENGE(订单数量), MEINS, ELIKZ(交货完成), LOEKZ(删除标识), UNTTO/UEBTO(交货不足/过量容差), EREKZ(最终发票) |
| EKBE | 采购订单历史（收货记录） | BEWTP='E' 表示收货, SHKZG='S' 收货 / 'H' 冲销退货, MENGE, BWART(移动类型101/102/122等) |

**收货完成判断逻辑：**

```
净收货数 = Σ(EKBE.MENGE where BEWTP='E' and SHKZG='S')
         - Σ(EKBE.MENGE where BEWTP='E' and SHKZG='H')   -- 冲销/退货要扣除

判定：净收货数 >= 订单数 × (1 - UNTTO%)  →  收货完成（系统通常已自动置 ELIKZ='X'）
```

注意事项：
- 排除 LOEKZ='L' 的已删除行项目
- 注意部分收货、退货（102/122 移动类型）场景
- 若目的是关单，还需同时检查发票情况（EKBE BEWTP='Q'、EKPO-EREKZ）
- 服务类 PO 行项目收货走 ESSR/ESLL，需另行处理

## 3. 方案对比

### 方案 1：批量下载收货数据，本地比对

**做法**：将 EKPO + EKBE(BEWTP='E') 导出（SE16N/SE16H/SQL/BEx 导出），用 Excel / Power Query / Python 本地聚合比对。

> ⚠️ **关键优化：不要下载"所有"收货数据。** EKBE 在生产系统通常是千万级大表，应先按 PO 清单（或公司代码+工厂+创建日期范围）过滤后再下载。

- ✅ 无开发量，对 SAP 只产生一次性负载
- ✅ 本地可反复分析、出报表
- ❌ 数据是快照，会过时，需手动刷新
- ❌ 无法自动化闭环

**适用**：一次性 / 阶段性评估，PO 清单固定。

### 方案 2：创建 RFC 函数，接口调用看返回值

**做法**：ABAP 开发 RFC 函数模块——输入 PO 号内表，内部 `FOR ALL ENTRIES` 关联 EKPO/EKBE 聚合，输出行项目级收货状态；外部用 Python `pyrfc` / C# `SAP NCo` 批量调用。

- 替代项：标准 `BAPI_PO_GETDETAIL1`（单 PO 逐条调用，千级以上性能差；但**低频场景（<100 次/周）完全可用 pyrfc 脚本循环调用，零 ABAP 开发**）；`BAPI_PO_GET_LIST`（按条件查清单）
- ✅ 实时数据、逻辑封装在 SAP 内、可反复自动化调用
- ✅ 可直接扩展为**自动关单**闭环（判定后调 `BAPI_PO_CHANGE` 置 ELIKZ）
- ❌ 需 ABAP 开发 + 传输 + RFC 授权（S_RFC），外部需安装 NW RFC SDK
- ❌ 大清单需分批（建议每批 5000 条以内）

**适用**：常态化、自动化流程（如每周自动扫描 + 判定 + 关单）。

### 方案 3：其他方式

| 方式 | 说明 | 前提 |
|---|---|---|
| **3a 直连 HANA 数据库 SQL** | 有只读 DB 账号时**性价比最高**：一条 SQL 直接出结果，可脚本化（Python `hdbcli`）反复跑 | HANA DB 只读账号 |
| **3b S/4HANA OData API** | 标准接口 `API_PURCHASEORDER_PROCESS_SRV`，实体 `A_PurchaseOrderItem` 自带 `IsCompletelyDelivered` 字段，$filter 批量查询 | S/4HANA + 通信场景配置 |
| **3c 标准报表（零开发）** | ME2N / ME2M / ME2L，选择屏幕用"多重选择"直接粘贴/导入 PO 清单，ALV 导出 Excel | GUI 权限，PO 数千条以内 |
| **3d BW / SLT 复制** | 若已有数据复制链路，直接在目标库查询 | 已有 BW/SLT 基础设施 |

## 4. 如何判断哪个方案合适（决策标准）

| 判断维度 | 结论倾向 |
|---|---|
| **PO 数量级** | < 1,000 → 3c 人工报表；1,000~100,000 → 3a/1/2；> 100,000 → 必须过滤+聚合（3a/2） |
| **使用频率** | 一次性 → 1 / 3a / 3c；**低频（<100 次/周）→ 3a 直连 SQL 或标准 BAPI 脚本，不必开发**；高频/每日自动 → 2 / 3b |
| **实时性要求** | 接受 T+1 快照 → 1 / 3d；必须实时 → 2 / 3a / 3b |
| **现有权限** | 有 DB 只读账号 → 3a 最快；有 ABAP 开发资源 → 2；只有 GUI → 3c |
| **最终目的** | 仅查看分析 → 1 / 3a；要自动关单（写操作）→ 必须 2 / 3b（+ `BAPI_PO_CHANGE`） |
| **SAP 版本** | ECC on HANA（无标准 OData API）→ 2 / 3a；S/4HANA → 3b 优先 |

## 5. 推荐路径（PO-Closing 场景）

### 5.1 结合实际情况：查询低频（< 100 次/周）

**结论：此频率下不值得投入开发自定义 RFC（方案 2 完整版），推荐优先级：**

1. **首选 3a 直连 HANA SQL**：把第 6 节 SQL 存成脚本（Python `hdbcli` / HANA Studio / DBeaver），每周按需执行。零开发、零传输、实时数据，一次写好长期复用
2. **次选 方案 2 轻量版（标准 BAPI + pyrfc，不开发）**：无 DB 账号但有 RFC 权限时，Python 脚本循环调标准 `BAPI_PO_GETDETAIL1`，100 次/周毫无压力，无需任何 ABAP 开发与传输
3. **保底 方案 3c / 1**：只有 GUI 权限时，每周人工 ME2N 多重选择导入 PO 清单导出 Excel；或定期按 PO 清单过滤下载一次

> ⚖️ **何时才值得做方案 2 完整版**：频率上升到每天数百次以上，或要实现"无人值守自动关单"闭环（查询→判定→`BAPI_PO_CHANGE` 自动置 ELIKZ）时，自定义 RFC 的开发投入才有回报。

### 5.2 通用路径

- **阶段一（评估摸底）**：方案 3a 直连 SQL（或方案 1 过滤下载）→ 快速摸清"收货完成但未关单"的 PO 规模
- **阶段二（落地自动化）**：S/4HANA 用 OData / ECC 用自定义 RFC，形成「查询 → 判定 → 自动关单」闭环

## 6. 附：直连 HANA SQL 示例

```sql
-- 注意：按实际 Schema 调整（如 SAPABAP1 / SAP<SID>），生产查询建议走只读副本
SELECT
    p."EBELN",
    p."EBELP",
    p."MATNR",
    p."MENGE"  AS "ORDER_QTY",
    p."MEINS",
    p."ELIKZ"  AS "DELIVERY_COMPLETE",
    p."LOEKZ"  AS "DELETION_FLAG",
    COALESCE(SUM(CASE WHEN b."SHKZG" = 'S' THEN  b."MENGE"
                      WHEN b."SHKZG" = 'H' THEN -b."MENGE"
                      ELSE 0 END), 0) AS "NET_GR_QTY"
FROM "EKPO" p
LEFT JOIN "EKBE" b
       ON  b."MANDT" = p."MANDT"
       AND b."EBELN" = p."EBELN"
       AND b."EBELP" = p."EBELP"
       AND b."BEWTP" = 'E'               -- 收货
WHERE p."MANDT" = '<客户端>'
  AND p."EBELN" IN ('4500000001','4500000002' /* ...PO 清单... */)
GROUP BY p."EBELN", p."EBELP", p."MATNR", p."MENGE", p."MEINS", p."ELIKZ", p."LOEKZ"
ORDER BY p."EBELN", p."EBELP";
```

## 7. 附：自定义 RFC 函数设计要点

- **输入**：IT_EBELN（值表或 RANGE 表），外部调用方分批（≤5000/批）
- **逻辑**：EKPO `FOR ALL ENTRIES` 取行项目 → EKBE 按 BEWTP='E' 聚合净收货 → 计算差异与建议动作
- **输出**：EBELN / EBELP / MATNR / 订单数 / 净收货数 / 差异 / ELIKZ / EREKZ / 建议（可关单/部分收货/未收货/已删除）
- **权限**：函数组 S_RFC 授权，生产环境建议专用 RFC 通讯用户（最小权限）