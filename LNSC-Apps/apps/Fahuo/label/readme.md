# SAP Label Management Platform

## 1. 项目目标

建设一个完全自托管、以开源组件为基础的企业级 SAP 标签管理与打印平台。

核心场景：

1. 仓库人员输入 SAP Delivery Number（DN）
2. 系统查询 SAP
3. 自动识别 Customer
4. 自动选择客户对应的 Label Template
5. 自动填充 SAP 数据
6. 根据配置规则计算标签数量
7. 预览
8. 打印
9. 保存打印历史，可追溯、可重打

正常操作人员不需要手工选择客户或模板。

**重要补充场景（打印时即时输入）：**

并不是每次打印都能从 SAP 取得完整的标签数据。

1. 某些情况下 DN / SAP 数据中**没有客户编码（Customer Code）**。
2. 或者标签上需要打印 SAP 里**根本不存在**的字段，
   例如客户料号 / 客户物料编码（Customer Part Number）。
3. 这类字段必须在**打印前由操作人员立即手工录入**，然后才能打印。
4. 手工录入的值必须写入打印历史，保证可追溯、可重打。

因此系统除了「全自动」路径外，必须支持「**打印时即时输入（Ad-hoc）**」路径：

```text
DN → 查 SAP → 缺客户编码 / 字段
   → 操作员立即手工输入
   → 匹配 / 选择模板
   → 预览 → 打印
```

---

## 2. 当前技术路线

最终方向：

> **LabelPrint + 自建 Vue 3 Designer + FastAPI + PostgreSQL**

LabelPrint 作为打印能力组件，而不是整个系统的核心业务数据库。

核心原则：

> **Label JSON 是系统自己的标准模板格式，LabelPrint 是可替换的打印引擎。**

架构：

```text
                         SAP S/4HANA
                              │
                         RFC / OData
                              │
                              ▼
┌─────────────────────────────────────────────────────┐
│              SAP Label Management                  │
│                                                     │
│  Vue 3 + Element Plus                              │
│  ┌───────────────────────────────────────────────┐  │
│  │                Label Designer                │  │
│  │                                               │  │
│  │ Components │      Canvas       │ Properties  │  │
│  │ Text        │                  │ X / Y       │  │
│  │ Image       │   label canvas   │ Width       │  │
│  │ Barcode     │                  │ Height      │  │
│  │ QR Code     │                  │ Font        │  │
│  │ Line        │                  │ Field       │  │
│  │ Rectangle   │                  │             │  │
│  │ SAP Field   │                  │             │  │
│  │ Company     │                  │             │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Template / Customer / Field Mapping / Print Rule  │
│                                                     │
│                 FastAPI                            │
│                 PostgreSQL                         │
└────────────────────────┬────────────────────────────┘
                         │
                    Label JSON
                         │
                         ▼
                  ┌─────────────┐
                  │  LabelPrint │
                  │ Print Engine│
                  └──────┬──────┘
                         │
                  Print Adapter
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
             PDF        TSPL       RAW
              │          │          │
              ▼          ▼          ▼
          Windows      Printer    Network
           Driver
```

---

## 3. 为什么选择 LabelPrint + 自建 Designer

之前考虑过：

- OpenLabelMaker
- LabelPrint
- Vue Print Designer
- PrintDesignPro
- ZPLab
- QR Layout Tool
- SVGDraw
- BarcodeLabelGen
- yu-print-designer

当前选择：

### LabelPrint

优点：

- 开源
- MIT License
- 自托管
- Web 化
- 有模板、变量、预览、打印能力
- 有 REST API
- 可以作为打印后端
- 可以支持多种输出/打印方式

项目地址：

```text
https://github.com/xingrz/labelprint
```

但 LabelPrint 不应该成为整个业务系统的核心。

### 自建 Vue Designer

原因：

- 完全控制 UI
- 完全控制 Label JSON
- SAP 字段可以直接做成拖拽组件
- 客户 Logo 可以作为一等资源
- 可以实现客户/模板/版本/打印规则
- 不被第三方模板数据结构锁定
- 后续可以替换 LabelPrint

---

# 4. Label JSON

Label JSON 是整个系统的核心标准。

示例：

```json
{
  "templateCode": "ABC_PRODUCT",
  "version": 3,
  "size": {
    "width": 100,
    "height": 60,
    "unit": "mm"
  },
  "elements": [
    {
      "id": "logo",
      "type": "image",
      "x": 5,
      "y": 5,
      "width": 25,
      "height": 10,
      "source": "customer_logo"
    },
    {
      "id": "material",
      "type": "field",
      "field": "MATNR",
      "x": 5,
      "y": 20,
      "width": 50,
      "height": 6,
      "fontSize": 12
    },
    {
      "id": "description",
      "type": "field",
      "field": "MAKTX",
      "x": 5,
      "y": 28,
      "width": 80,
      "height": 6,
      "fontSize": 10
    },
    {
      "id": "batch",
      "type": "field",
      "field": "CHARG",
      "x": 5,
      "y": 36,
      "width": 50,
      "height": 6
    },
    {
      "id": "qr",
      "type": "qrcode",
      "x": 70,
      "y": 20,
      "width": 25,
      "height": 25,
      "value": "{{MATNR}}|{{CHARG}}"
    }
  ]
}
```

建议支持的 element：

```text
text
field
image
customer_logo
barcode
qrcode
datamatrix
line
rectangle
rounded_rectangle
table
conditional
group
```

### 字段数据来源（binding / source）

每个元素 / 字段都应声明数据来源，这是支持「打印时即时输入」的关键：

```text
source: "sap"        —— 来自 SAP 字段（如 MATNR / CHARG）
source: "static"     —— 设计时固定的常量文本
source: "customer"   —— 客户主数据（客户编码、客户名称、客户 Logo）
source: "manual"     —— 运行时由操作员在打印页面即时录入
source: "expression" —— 由其它字段计算（如 Copies = CEILING(...)）
```

示例：SAP 中不存在、需要打印时录入的客户料号：

```json
{
  "id": "cust_material",
  "type": "field",
  "source": "manual",
  "label": "客户料号",
  "field": "CUST_MATNR",
  "required": true,
  "x": 5,
  "y": 44,
  "width": 60,
  "height": 6,
  "fontSize": 10
}
```

> 当 `source = "manual"` 时，系统在打印页面自动生成对应录入项，
> 操作员输入后即可预览和打印。

单位统一使用：

```text
mm
```

这样可以避免不同打印机 DPI 导致的版面偏差。

---

# 5. Designer

## 左侧组件

```text
【基础组件】

文本
图片
公司 Logo
线条
矩形
圆角矩形


【条码】

CODE128
CODE39
EAN13
EAN8
ITF


【二维码】

QR Code
DataMatrix


【SAP】

Delivery Number
Customer
Material
Material Description
Batch
Quantity
Plant
Storage Location
Customer PO
Delivery Item


【运行时录入】

手工输入字段
客户编码（Customer Code）
客户料号（Customer Part Number）
备注 / 自定义录入项


【公司】

Company Logo
Customer Logo
Company Name
Address
```

---

## Designer 功能

必须支持：

- Drag & Drop
- Move
- Resize
- Rotate
- Multi-select
- Copy/Paste
- Delete
- Undo/Redo
- Align
- Grid
- Ruler
- Snap
- Layer ordering
- Lock
- Hide
- Properties panel
- Preview
- mm 尺寸
- JSON Save / Load
- 字段数据来源绑定（sap / static / customer / manual）
- 运行时录入字段定义（required / 默认值 / 校验）

界面建议：

```text
┌─────────────────────────────────────────────────────────────┐
│ SAP Label Designer                              Save Preview│
├──────────────┬──────────────────────────────┬───────────────┤
│ Components   │                              │ Properties    │
│              │                              │               │
│ Basic        │       100 × 60 mm            │ X             │
│ ├ Text       │                              │ Y             │
│ ├ Image      │      ┌────────────────┐      │ Width         │
│ ├ Logo       │      │    ABC GmbH    │      │ Height        │
│ ├ Line       │      │                │      │ Font          │
│ └ Rectangle  │      │ Material:      │      │ Font Size     │
│              │      │ 10001234       │      │ Alignment     │
│ Barcode      │      │                │      │ Field         │
│ ├ CODE128    │      │ Batch:         │      │               │
│ └ CODE39     │      │ 26093001       │      │               │
│              │      │                │      │               │
│ QR Code      │      │     [ QR ]     │      │               │
│              │      └────────────────┘      │               │
│ SAP Fields   │                              │               │
│ ├ MATNR      │                              │               │
│ ├ MAKTX      │                              │               │
│ ├ CHARG      │                              │               │
│ └ LFIMG      │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
```

---

# 6. SAP 字段绑定

Designer 不应该要求设计人员手工输入：

```text
{{MATNR}}
{{MAKTX}}
{{CHARG}}
```

而应该直接拖拽 SAP 字段。

例如：

```text
Material       → MATNR
Description    → MAKTX
Batch          → CHARG
Quantity       → LFIMG
Customer PO    → BSTKD
```

Designer：

```text
Designer
   ↓
FastAPI
   ↓
SAP
```

Designer 本身不直接连接 SAP。

---

# 7. Customer Logo

客户 Logo 应该作为独立资源管理。

```text
Customer
│
├── ABC GmbH
│   └── logo.png
├── XYZ AG
│   └── logo.png
└── DEF GmbH
    └── logo.png
```

模板中可以：

```json
{
  "type": "customer_logo"
}
```

打印时：

```text
Customer
   ↓
Customer Logo
   ↓
Render
```

这样同一个模板可以根据客户自动显示不同 Logo。

---

# 8. Customer / Template 自动匹配

不要写死：

```python
if customer == "ABC":
    template = "ABC_V3"
```

应该使用配置：

```text
Customer
   ↓
Label Profile / Print Rule
   ↓
Template
   ↓
Template Version
```

以后可以进一步支持：

```text
Customer
Material
Material Group
Plant
Warehouse
Delivery
Quantity
Packaging
Label Type
```

作为匹配条件。

## 8.1 客户编码缺失时的处理

如果 SAP 数据里没有客户编码，就不能直接走自动匹配。系统必须提供回退策略：

```text
SAP 无 Customer
   ↓
① 操作员立即手工输入客户编码
   ↓
   匹配 Print Rule → 模板
   （若仍无法匹配，转 ②）
   ↓
② 操作员从模板列表手工选择
   ↓
③ 或使用系统默认模板（Default Template）
```

无论走哪条路径，最终选用的 Template / Version，
以及「人工选择 / 人工输入」这一动作，都必须记录到 Print Job，
保证完全可追溯。

---

# 9. 打印数量规则

标签数量不能写死。

例如：

```text
Delivery Quantity = 500 KG
Label Quantity    = 50 KG
```

系统计算：

```text
Copies = CEILING(500 / 50)
       = 10
```

规则应该配置化。

例如：

```text
Customer → Template
Material → Template
Quantity → Copies
Plant → Printer
Warehouse → Printer
```

---

# 10. Operator 页面

普通仓库人员看到的页面应该尽量简单：

```text
┌─────────────────────────────────────────┐
│              Label Printing             │
├─────────────────────────────────────────┤
│ Delivery Number                         │
│ [ 8000123456                    ]       │
│ Customer       ABC GmbH                 │
│ Material       10001234                 │
│ Description    PVC RESIN                │
│ Batch          26093001                │
│ Quantity       500 KG                   │
│ Template       ABC_PRODUCT_V3           │
│ Printer        WH-A-01                  │
│ Copies         10                       │
│       [ Preview ]       [ Print ]       │
└─────────────────────────────────────────┘
```

流程：

```text
Input DN
 ↓
Enter
 ↓
Query SAP
 ↓
Identify Customer
 ↓
Auto-select Template
 ↓
Fill data
 ↓
Calculate Copies
 ↓
Preview
 ↓
Print
```

操作人员不需要选择客户或模板。

## 10.1 打印时即时输入（Ad-hoc）

当 SAP 数据缺失（例如没有客户编码）或标签含运行时字段时，
Operator 页面在查询 DN 之后自动展示「**待补录**」表单：

```text
┌──────────────────────────────────────────────────────┐
│           Label Printing — 待补录信息                 │
├──────────────────────────────────────────────────────┤
│ Delivery Number  8000123456                            │
│ Customer Code    [ ABC-001           ]  ← 手工输入    │
│ Customer Part No [ PX-7788           ]  ← 手工输入    │
│ Batch            [ 26093001          ]  ← 可覆盖 SAP  │
│ Template         ABC_PRODUCT_V3（自动匹配）           │
│ Printer          WH-A-01                               │
│ Copies           10                                    │
│            [ 预览 ]       [ 打印 ]                     │
└──────────────────────────────────────────────────────┘
```

规则：

- 只显示**缺失**或**需要人工确认**的字段，SAP 已有的字段默认只读。
- `source = "manual"` 的字段始终出现，`required = true` 时必须填写。
- 允许对 SAP 字段做**手工覆盖（override）**，覆盖值标记为 manual。
- 提交后先预览，确认无误再打印。
- 所有手工值随本次 Print Job 保存，并记录录入人与时间。

---

# 11. Admin 页面

```text
System Management
│
├── Customers
│   ├── Customer Master（含客户编码）
│   └── Customer Logos
├── Label Templates        ← 设计 / 管理
│   ├── Designer
│   ├── Import / Export（JSON 导入导出）
│   ├── Duplicate / Clone
│   └── Archive / Restore
├── Template Versions      ← 版本维护
│   ├── Publish
│   ├── Rollback
│   └── Compare
├── SAP Field Mapping
├── Runtime Fields         ← 运行时录入字段定义
├── Print Rules
├── Printers
├── Print Jobs
├── Print History
├── Maintenance            ← 运维
│   ├── Data Cleanup
│   ├── Backup / Restore
│   └── Health Check
└── Users & Permissions
```

---

# 12. 数据库设计

核心表：

```text
customers
customer_logos
label_templates
label_template_versions
label_fields
field_mappings
print_rules
printers
print_jobs
print_logs
print_job_inputs      ← 每次打印的手工录入 / 覆盖值
runtime_fields        ← 运行时录入字段定义
users
roles
```

关系：

```text
Customer
  ↓
Label Template
  ↓
Template Version
  ↓
Field Mapping
  ↓
Print Rule
  ↓
Printer
```

---

# 13. Template Version

生产模板绝对不能直接覆盖。

例如：

```text
ABC_PRODUCT
├── V1
├── V2
└── V3 ← Current
```

每次发布产生新的版本。

打印记录必须记录：

```text
Template
Template Version
Customer
DN
Material
Batch
Printer
Copies
User
Time
Status
手工录入字段（Manual Inputs）
```

这样即使未来模板已经修改，也可以追溯历史打印到底使用的是哪个版本。

---

# 14. Print Job

每次打印产生独立 Print Job。

字段：

```text
Print Job ID
Delivery Number
Customer
Material
Batch
Template
Template Version
Printer
Copies
User
Created Time
Started Time
Completed Time
Status
Error Message
```

来自 SAP 的字段与操作员手工录入 / 覆盖的字段必须分开标记
（例如 `origin: sap | manual`），并记录录入人与时间。

状态：

```text
PENDING
PRINTING
SUCCESS
FAILED
CANCELLED
REPRINTED
```

重打不能修改原记录。

正确方式：

```text
Original Job
      ↓
Reprint
      ↓
New Print Job
```

---

# 15. 用户权限

建议四类角色：

### ADMIN

- 客户
- Logo
- 模板
- 规则
- 打印机
- 用户
- 日志

### DESIGNER

- 创建模板
- 修改模板
- 发布版本
- 预览

### OPERATOR

- 查询 DN
- 预览
- 打印
- 授权重打

### AUDITOR

- 查看模板版本
- 查看打印历史
- 查看审计日志

---

# 16. 打印架构

因为实际打印机不是 Zebra，所以不能把系统设计成只支持 ZPL。

推荐：

```text
Label JSON
   ↓
Renderer
   ├── PDF
   ├── TSPL
   ├── ESC/POS
   ├── RAW TCP
   ├── CUPS
   └── Vendor Protocol
```

实际采用哪种协议，需要根据最终打印机品牌和型号确定。

浏览器不应该直接负责任意 RAW 打印。

建议：

```text
Warehouse PC
      │
      │ HTTPS
      ▼
Application Server
      │
      ▼
LabelPrint
      │
      ▼
Print Adapter
      │
      ▼
Printer
```

如果打印机只能通过 Windows 驱动访问，则可以增加：

```text
Windows Print Agent
```

---

# 17. 部署架构

服务器：

```text
Ubuntu Linux
│
├── Nginx
├── Vue Frontend
├── FastAPI
├── PostgreSQL
└── LabelPrint
```

仓库 PC：

```text
Windows
│
├── Browser
└── Printer Driver / Print Agent
```

生产环境建议 Docker：

```text
docker-compose.yml
```

服务：

```text
frontend
backend
postgres
labelprint
nginx
```

常用命令：

```bash
docker compose up -d
docker compose ps
docker compose logs -f backend
```

---

# 18. 项目结构

```text
sap-label-management/
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── designer/
│   │   ├── pages/
│   │   ├── stores/
│   │   ├── api/
│   │   └── types/
│   └── package.json
│
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── sap/
│   │   ├── printing/
│   │   └── main.py
│   └── requirements.txt
│
├── database/
│   ├── migrations/
│   └── seed/
│
├── label-schema/
│   └── label.schema.json
│
├── print-adapter/
│
├── deploy/
│   ├── docker-compose.yml
│   └── nginx/
│
├── docs/
│   ├── architecture.md
│   ├── designer.md
│   ├── label-json.md
│   ├── sap-integration.md
│   └── printing.md
│
└── README.md
```

---

# 19. 技术栈

## Frontend

```text
Vue 3
TypeScript
Vite
Element Plus
Vue Router
Pinia
```

Designer：

```text
SVG / Canvas based editor
```

建议选择成熟的开源 Canvas/SVG 编辑库作为 Designer 基础，不建议从零开始实现图形编辑引擎。

## Backend

```text
Python
FastAPI
Pydantic
SQLAlchemy
```

## Database

```text
PostgreSQL
```

## SAP

根据现有 S/4HANA 环境选择：

```text
SAP RFC
SAP OData
SAP REST API
```

## Printing

```text
LabelPrint
Print Adapter
Windows Printer
Network Printer
```

---

# 20. SAP 数据流程

核心流程：

```text
DN
 ↓
SAP
 ↓
Delivery
 ↓
Customer
 ↓
Delivery Items
 ↓
Material
 ↓
Description
 ↓
Batch
 ↓
Quantity
 ↓
Plant
 ↓
Storage Location
 ↓
Customer PO
```

典型字段：

```text
Delivery Number
Customer
MATNR
MAKTX
CHARG
LFIMG
WERKS
LGORT
BSTKD
```

---

# 21. 开发阶段

## Phase 1 — Designer MVP

首先完成：

- Canvas
- Text
- Image
- Logo
- Barcode
- QR
- Line
- Rectangle
- SAP Field
- Drag & Drop
- Resize
- Move
- Rotate
- Alignment
- Undo / Redo
- JSON Save / Load
- Preview

第一阶段先不要急着接 SAP。

验证：

```text
Vue 3
  ↓
Label Designer
  ↓
Label JSON
  ↓
Save / Load
  ↓
Preview
```

---

## Phase 2 — Template Management

实现：

- Template CRUD
- Template Version
- Customer
- Customer Logo
- Field Mapping
- Template Preview
- Publish

---

## Phase 3 — SAP Integration

实现：

```text
DN
 ↓
SAP
 ↓
Delivery
 ↓
Customer
 ↓
Material
 ↓
Batch
 ↓
Quantity
```

---

## Phase 4 — Printing

集成：

```text
LabelPrint
```

实现：

- Printer
- Print Target
- Print Job
- Preview
- Print
- Print History
- Reprint

---

## Phase 5 — Print Rules

实现：

```text
Customer → Template
Material → Template
Quantity → Copies
Plant → Printer
Warehouse → Printer
```

---

## Phase 6 — Production

增加：

- Authentication
- RBAC
- Audit Log
- Monitoring
- Backup
- Error Handling
- Health Check
- Printer Status
- Retry
- Reprint
- Version Rollback

---

# 22. 核心设计原则

## 1. SAP 与 Designer 解耦

```text
Designer
   ↓
FastAPI
   ↓
SAP
```

## 2. Template 与 Printer 解耦

不要把 ZPL/TSPL 作为唯一模板格式。

```text
Label JSON
   ↓
Renderer
   ↓
Printer
```

## 3. Customer Rule 配置化

不要在代码中硬编码：

```python
if customer == "ABC":
```

而是存入数据库。

## 4. Template Version 化

生产模板永远不直接覆盖。

## 5. Printing 可追溯

每次打印都必须知道：

```text
Who
When
What
Which Template
Which Version
Which Printer
How Many
Result
```

---

## 6. 打印时数据可补录

系统不能假设 SAP 一定能提供全部数据。
Designer 声明的运行时字段 + 缺失字段补录，保证任何情况下都能打出正确标签。
手工录入的值必须进入 Print History，并注明操作员与时间。

---

# 23. MVP 成功标准

第一版完成后，应可以完整实现：

1. 打开 Designer
2. 创建 100 × 60 mm 标签
3. 拖入 Logo
4. 拖入 Material
5. 拖入 Batch
6. 拖入 QR Code
7. QR 绑定 MATNR + CHARG
8. 保存模板
9. 发布 V1
10. 操作员输入 DN
11. 系统查询 SAP
12. 自动识别 Customer
13. 自动选择 Template
14. 自动填充数据
15. Preview
16. Print
17. 保存 Print History
18. Reprint
19. 无客户编码时，手工输入客户编码后成功打印
20. 打印历史中可查到本次手工录入的字段与值

---

# 24. 最终目标

最终建设的不是一个简单的标签打印网页，而是：

> **SAP Label Management Platform**

整体：

```text
SAP
 │
 ├── Production
 ├── Warehouse
 ├── Logistics
 └── Shipping
       │
       ▼
   Label Platform
       │
       ├── Template Designer
       ├── Customer Management
       ├── SAP Mapping
       ├── Print Rules
       ├── Printer Management
       ├── Print History
       └── Reprint
```

目标：

> **Configurable, version-controlled, auditable, extensible enterprise label platform decoupled from SAP and printer vendors.**

---

# 25. 下一步

建议第一步直接开始：

```text
Vue 3
   ↓
Label Designer
   ↓
100 × 60 mm Canvas
   ↓
Text / Image / Logo / Barcode / QR / SAP Field
   ↓
Drag & Drop
   ↓
Properties Panel
   ↓
Label JSON
   ↓
Save / Load
   ↓
Preview
```

Designer 验证通过后，再接：

```text
FastAPI
   ↓
PostgreSQL
   ↓
SAP
   ↓
LabelPrint
   ↓
Printer
```

这种模块化架构可以保证：

- SAP 可替换
- Printer 可替换
- LabelPrint 可替换
- Designer 可持续扩展
- 模板数据完全由企业自己掌控
- 支持打印时即时输入，适配 SAP 数据不完整的情况
- 后续可以扩展到生产、仓储、物流等更多标签场景

---

## 开源与许可证

目标：

- Self-hosted
- Enterprise internal deployment
- Source-code control
- No SaaS dependency
- No commercial closed label designer
- Enterprise-controlled template data

第三方组件正式生产前需要逐项核查许可证。

当前方案中的 LabelPrint 采用 MIT License。

---

## 嵌入到其它页面（Embedding）

本应用已去除页眉、侧边栏与页脚，只对外提供一个可嵌入的根节点 `<div id="label-app">`，可直接嵌入宿主页面的任意容器。

方式一：直接使用 `index.html` 的根节点（脚本检测到 `#label-app` 会自动初始化）

```html
<link rel="stylesheet" href="/apps/label/style.css">
<link rel="stylesheet" href="/apps/label/designer.css">
<div id="label-app">
  <div id="tabs" class="tabs" role="tablist"></div>
  <main id="main"></main>
</div>
<script src="/apps/label/label-core.js"></script>
<script src="/apps/label/designer.js"></script>
<script src="/apps/label/script.js"></script>
```

> 说明：应用内「标签设计」视图直接挂载 `window.LabelDesigner`，因此除 `style.css` 外还需引入 `designer.css` 与 `designer.js`。

方式二：由宿主页面挂载到自定义容器（容器内的 `#tabs` / `#main` 会自动创建）

```html
<link rel="stylesheet" href="/apps/label/style.css">
<link rel="stylesheet" href="/apps/label/designer.css">
<div id="my-slot"></div>
<script src="/apps/label/label-core.js"></script>
<script src="/apps/label/designer.js"></script>
<script src="/apps/label/script.js"></script>
<script>
  LabelApp.mount('#my-slot');   // 挂载整块标签功能
  // LabelApp.go('designer');   // 切换到“标签设计”
  // LabelApp.go('templates');  // 切换到“模板管理”
  // LabelApp.refresh();        // 重新渲染当前视图
</script>
```

说明：

- 组件为**单实例**（一个页面内一个 `#tabs` / `#main`），适合一页嵌入一个标签应用。
- 顶部为功能标签栏（标签设计 / 模板管理），属于组件内部区域，非页面页眉。设计视图使用与独立设计器**同一套**三栏设计器（`window.LabelDesigner`）。
- 查询/打印/设计与弹窗提示均为组件内部交互，覆盖层样式独立，不影响宿主布局。
- 对外接口：`window.LabelApp = { mount(root), go(view), refresh(), views, DB }`。

---

## 独立标签设计器（Standalone / Embeddable Designer）

除主应用内的「标签设计」页签外，另提供一套**独立、可单独打开、可用 iframe 嵌入**的设计器：

| 文件 | 作用 |
| --- | --- |
| `designer.html` | 独立页面外壳（无页眉/侧边栏/页脚），仅含根节点 `#label-designer` |
| `designer.js` | 设计器逻辑，暴露 `window.LabelDesigner` |
| `designer.css` | 设计器独立样式（自带 `:root` 变量，不依赖主应用 `style.css`） |
| `label-core.js` | 主应用与设计器**共享内核**：常量、工具、`SEED`/`DB`、渲染引擎 `buildLabel` |

### 共享数据与内核

- 主应用 `index.html` 与独立设计器 `designer.html` 都先加载 `label-core.js`，因此二者：
  - 读取**同一份数据**（双模存储：SQLite 后端 API 优先、`localStorage` 键 `label_db_v1` 兜底/离线缓存，见下节「部署：SQLite 后端」）；
  - 使用**同一套**标签渲染引擎（`buildLabel` / `createEl`）。
- 结论：在设计器里保存的模板，主应用「模板管理」页签**立即可见可用**；反之亦然。
- 单位统一为 **mm**，画布按 `1mm → 3.4px`（`D_SCALE`）缩放显示。
- **首次打开（2026-10-10 用户要求）**：固定落在「标签设计」页签（忽略 URL hash 里残留的历史页签，会话内切换仍走 hash 路由）；画布默认 **Fit 适配窗口**而非 100%——挂载/首次可见时自动应用一次（隐藏时延迟到可见再补，避免量不到尺寸被钳到 25%），之后手动缩放（− / % / ＋）在会话内保持，`Fit` 按钮随时可重适配。

### 部署：SQLite 后端（2026-10-10 新增）

`server.js`（零依赖，Node ≥22.5 的 `node:sqlite`，22.13+ 免 flag）把应用从「单浏览器 localStorage」升级为「多工位共享的 SQLite 单文件库」：

```bash
node apps/Label/server.js          # 默认 8092 端口；node apps/Label/server.js 9000 可改
# 环境变量 LABEL_DB_DIR 可改数据目录（默认 apps/Label/data/）
```

- **静态托管 + API 一体**：`http://<服务器>:8092/` 即应用本体；API 为 `GET /api/health`、`GET /api/db`、`PUT /api/db`（整库读写、事务写入、分表缺省保留、CORS 放开）；`data/` 与 `server.js` 本体不对外（404）。
- **7 张分表**：`meta` / `templates`（elements 存 JSON 文本）/ `rules` / `fields` / `customers` / `deliveries` / `history`（manual 存 JSON 文本），结构与前端 DB 对象一一对应。
- **双模前端**（`label-core.js`）：页面启动时 `syncDB()` 与后端对账——服务端有数据则迁移合并后采用并触发重渲染；服务端为空则把本地 SEED 推上去**自动播种**；保存时写 localStorage 并异步防抖（400ms）推送后端。API 离线（file:// 直开 / 纯静态预览）自动回退 localStorage，行为与之前完全一致。
- **备份**：每天首次写入自动复制到 `data/backup/label-YYYYMMDD.db`，保留最近 7 份。
- **客户基本数据库（2026-10-10）**：`import-customers.js` 从 `data/Customer Chinese.xlsx` 重建 `customers` 表——`Customer No.`（7 位代码）→ `code`、`CustomerName`（中文名称）→ `name`（不映射 Ufida Cust. No.）；整表替换（事务）、按代码去重、跳过空行。首跑导入 **9100 条**（9019 条中文名称；如 `4101901 = 二重（德阳）重型装备有限公司`）。xlsx 更新后重跑 `node import-customers.js` 即可；公司代码卡片随即按真实清单显示中文名称。清单即「模板管理」页签主表（2026-10-10 由「客户主数据」更名）：**全部客户逐行**（公司代码 / 中文名称 / 尺寸 / 元素 / 更新时间，行末「设计」+ 有模板时「删除」；无模板客户点「设计」新建并预填公司代码；无归属客户的模板如 DEFAULT 排在最前），支持按代码 / 名称 / 模板 code 过滤，每次最多显示 200 条并提示总数。
- 长期方向（多工厂 / 高并发 / 审计）仍是 readme 第 2 章的 FastAPI + PostgreSQL；届时表结构按第 12 章原样扩展即可，前端适配层不变。
- **模板版式归一（2026-10-11）**：分析 `data/物料标签打印模板0.xlsx`（45 张客户标签，语义字段频率：数量 37/39、客户物料号 34/39、描述 21/39、订单号 14/39、Lechler 型号 6/39）——模态格式 = **三栏表格式小标签**（表头行：物料号 | 物料描述 | 数量 + 数据行；几何取 5 张代表 sheet 中位 ≈ **93×24mm**，栏宽比 0.32/0.45/0.23，表头 9mm / 数据 13mm）。`DEFAULT 通用标签` 已按此转换（v2，10 元素：细边框 + 表头分隔线 + 2 栏线 + 3 表头文本 + CUST_MATNR（手工输入）/ MAKTX / LFIMG 字段）；按原 workbook 标签实际情况不含 Logo 与二维码（仅联钢精密页有图片），需要可在设计器自行加回。同批操作：`customers` 表按工作簿 sheet 名上的公司代码裁剪 **9100 → 105**（仅保留有标签模板的公司，双端 label.db 同步；**重跑 import-customers.js 会恢复全量 9100，之后需重新裁剪**）。工作簿歧义 sheet 已按候选 SAP 代码 1:1 复制成 116 张（噪声候选 4102034 / 4145631 已排除），明细见 `data/物料标签打印模板0-完成报告.txt`。
- **基本模板批量生成（2026-10-11）**：按「第 1 行表头 + 第 2 行数据」的两行表结构，把工作簿 107 张带码 sheet 批量转换为公司代码命名的基本模板（表头文本→静态文本、数据格→字段元素，列宽/行高按原表像素换算 mm；字段语义映射：Lechler→MATNR、数量→LFIMG、描述→MAKTX、订单→BSTKD、物料号按数据值形态分 MATNR/CUST_MATNR）。**转换 88 张（draft 状态）**；跳过 14 张：无锡经纬/伍尔特（键值对纵排）、克朗斯（单行）、联钢精密（复杂带图）、山东临工（242mm 超宽）、安德里茨喷淋管（代码与安德里茨重复，取先出现的通用页）；部分多行 sheet（杜尔/比亚迪/达源/金东纸业等）仅取前两行、原表其余内容未转。同批发现服务器上 `DEFAULT`/`新模板 3` 曾被界面删除——因打印规则 R2/R3 引用 `DEFAULT` 兜底，已从本地库恢复 `DEFAULT 通用标签`（v3）；`新模板 3` 为空测试模板，未恢复。
- **模板统一化（2026-10-11 用户要求）**：全部模板统一为 **100×60mm**——保留各模板表头标题（无文本标题的取字段 label，如 ABC_PRODUCT），移除全部数据字段元素，右侧统一加竖排 Lechler 组合标志（`assets/lechler-c-logo-combination-mark-black-00.png`，45×6mm 旋转 -90° 置于右缘；标题栏宽 87mm、右端预留 LOGO 通道不重叠）。双端 label.db 同步，版本各 +1。注意：转换后服务器上 `DEFAULT` 与 `ABC_PRODUCT` 再次被界面删除（用户清理种子模板），当前服务器仅存 88 张公司代码模板；**打印规则 R2/R3 仍引用 `DEFAULT`**，默认打印缺兜底模板，待用户确认后恢复或改挂规则。同批：44 张模板的表头文字单行化（清掉 Excel 换行符与多余空白，如 `工位号\r\nJob No` → `工位号 Job No`），并对 40 张按栏宽自动缩减字号（下限 5.5，如达涅利四栏 8 / 7.5 / 6 / 5.5），保证单行完整显示不截断；LOGO 保持右缘竖排不变。
- **标题转横向 + 表头还原双语两行（2026-10-11 用户要求，撤销上一步单行化/缩字号）**：「标题」指右侧 LECHLER 组合标志——取消 `rotate: -90`，改为**横向**置于内容区右侧（x=63, y=32, 32×4.3mm，右缘离框 3.5mm）；表头文字**从 Excel 工作簿第 1 行还原原版中英双语多行文本**（如 `工位号\r\nJob No`、`数量\r\nDelivery\r\nQty`），字号统一 9。配套调整：表头栏由 87mm **铺满到整框**（分隔线宽度 87→97，列与竖线按 97mm 均分重排，消除右上空缺）；表头元素 y=1.6 / 高 11.8mm；渲染引擎 `createEl` 文本分支新增 **`line-height: 1.15`**（可用 `el.lineHeight` 覆盖），三行表头（如 Delivery Qty）不再被元素底边/分隔线裁切。双端 label.db 同步（版本各 +1），CDP 截图复核通过。
- **表头转置为行式布局（2026-10-11 用户要求「一行一行显示，LOGO 不变」）**：全部模板表头由**列式**（顶部一栏、3~5 列并排）转置为**行式**——每个标题独占一行通栏横条、上下堆叠：左侧标题列宽 60mm、满高分行（行高 57/n，行数分布 2 行×1 / 3 行×49 / 4 行×36 / 5 行×4），行间 0.5mm 横线分隔，标题列与内容区之间加 0.5mm 竖线（x=61.5）构成两栏表结构；标题文字保留中英双语多行原文，字号统一 9（各行内按文本高度**垂直居中**，三行标题在最窄 11.4mm 行高内完整容纳，无需缩字号）；右侧内容区留空待放字段，LECHLER 横向组合标志位置不动（x=63, y=32, 32×4.3mm）。元素重排为 frame + colline + rline1..n-1 + cap0..n-1 + logo；双端 label.db 同步（版本各 +1），CDP 截图复核通过。
- **工业风版式（2026-10-11 用户给定参考图并选定格式B）**：渲染引擎新增 `el.fill`（实心色块）/ `el.color`（线条/边框/文字颜色）/ `el.bold`（粗体）三个元素属性，并修复 `.el-line` CSS 把线高钉死 2px 导致**竖线渲染成小点**的缺陷（高度 >2mm 的线按真实尺寸渲染）。先行产出 3 个候选格式 draft（`FORMAT_A` 横线书写 / `FORMAT_B` 行式标签 / `FORMAT_C` 标题栏，共同语言：黑细边框 + 品牌青 `#006878` + 右缘竖排 LOGO 通道 88.5~98.5mm），用户选定 **格式B** 后批量应用到全部 88 张公司模板（本地含 DEFAULT/ABC_PRODUCT 共 90 张）：每个标题 = 青色标签块（chip，**宽度按实际字符长度计算**——CJK 全宽/拉丁 0.55/空格斜杠窄、粗体 +5%，下限 16mm 上限 60mm、超宽自动缩字号至 5 兜底）+ 白粗字（**fs 7**，双语以 ` / ` 连接为单行）+ 青色书写线（x 8→85，0.7mm 粗）；行块按行数整体**垂直居中**（行高 7.7mm，行距 4.3mm、5 行模板收紧为 3.3mm）；LOGO 恢复右缘竖排（45×6mm，rotate −90）。元素结构 frame + chip{i}/chip{i}t/line{i} + logo；双端 label.db 同步（版本各 +1），CDP 截图复核（4 行达涅利 / 3 行江苏联峰）通过。**同日晚些按用户要求黑白化**：chip 与书写线由品牌青改为纯黑 `#111`（去彩色、黑白打印友好），标签块字号 7→**6**，书写线 0.7→**0.35mm** 细线，chip 高 6→5.5mm、行高 6.85mm、行块仍按行数垂直居中；`FORMAT_B` 候选稿同步更新为最终规格（`FORMAT_A/C` 未选中稿保留青色原样）。CDP 截图复核通过。**再次按用户要求调整（中英换行 + 宽度统一）**：标签块内改**两行显示**（第一段中文一行、其余英文段空格连接一行；分段符识别 `\n`、`/`（有无空格）、连续 2+ 空格——兼容杜尔「杜尔订单号   Durr  PO Number」这类多空格原文）；**标签块宽度全局统一 27.77mm**（全库 ≤30mm 标题行中最宽 22.77mm + 5mm 内边距，夹取 20~32mm）；超长行（如辛北尔康普「Specification or Technical requirment」44mm）不撑宽 chip，按 pre-wrap 自然折行、据实增高文本元素并自动缩字号（下限 5）；chip 高 7.5mm 容纳两行 fs6，行块仍垂直居中。CDP 截图复核（达涅利 4 行 / 辛北尔康普 5 行含超长行 / 杜尔多空格分段）通过。**2026-10-12 按用户新参考图改版（无外框·德国工业简洁风）**：去掉矩形外框与标签块，版式骨架 = 左侧 1mm 粗竖线 + 右侧 0.5mm LOGO 通道分隔竖线（y 3..57，x 分别 2.5 / 88.5）+ 右缘竖排 LOGO；每字段 = 粗体**单行**标题（`中文 / English`，fs 8 左对齐 x=8，超 74mm 自动缩字号至 6 兜底）+ 行槽底部 0.35mm 书写细线（x 8→85），行槽按行数均分内容区（y 4..56），线上方留足书写空间。元素结构 leftbar + rsep + cap{i}/line{i} + logo；双端 label.db 同步（版本各 +1），CDP 截图复核（达涅利 4 行）通过。**同版式设为基础底版（2026-10-12 用户要求）**：`designer.js` 新增 `BASE_ELEMENTS` 常量（3 字段行：物料号 / Material No.、品名 / DESCRIPTION、数量 / QTY + 左右竖线 + 竖排 LOGO，共 9 元素），`newTemplate()` 新建模板时以 `clone(BASE_ELEMENTS)` 自动带出（原为空画布）；设计器工具栏与「模板管理」页签两个新建入口均生效。CDP 验证：新建模板即含 9 元素并同步服务器，测试模板用后已清理。**同日高度压缩（用户要求「字体大小不变，高度减小」）**：全部模板 100×60 → **100×50mm**——标题字号保持 fs 8 不动，行槽改为均分 y 4..46（4 行 pitch 10.4mm），左右竖线高 54→44，LOGO 垂直居中（y=22）；`BASE_ELEMENTS` 与 `newTemplate()` 出厂尺寸同步改为 100×50。双端 label.db 同步（版本各 +1），CDP 截图复核（达涅利）通过。**同日右栏布局改版（用户线框）**：右栏自上而下改为 **公司代码卡片 → 尺寸卡片 → 属性面板 → 底部「打印」按钮**——尺寸卡片为「尺寸：」标签 + 宽/高两个下划线步进输入（▲▼ ±1mm、可直接输入、最小 10mm，画布与状态栏即时联动，`syncSizeInputs()` 随加载同步）；模板属性组移除宽/高字段（仅留模板名称）；新增 `printLabel()`：新开窗口按标签实际毫米渲染（1mm = PXPERMM px ≈ 96dpi），`@page` 精确匹配标签尺寸、零边距、元素样式内联自带，加载后自动唤起系统打印。CDP 验证：步进器 ±1 联动状态栏、属性面板无宽/高字段、按钮渲染于右栏底部。同日微调（用户要求）：步进器 ▲▼ 箭头 8→**12px**，右栏 4 块上下间距 24→**12px**（整栏更紧凑，打印按钮一屏可见）；打印按钮加**打印机图标**——项目无图标库依赖，采用内联 SVG（Feather printer 描边风格，`stroke: currentColor`，悬停随按钮反白），按钮改 flex 水平居中（图标 17px + 文字，gap 8px）；公司代码卡片**高度压缩**（用户要求）：大数字字号 54→**34px**（加 line-height 1.1），卡片 padding 20/12→12/8px，公司名 14→13px、上边距 4→2px，整卡高度约减 1/3。**同日格式调整（用户线框）**：三张卡片标题统一为**压边框浮动图例**（新增通用 `.ld-card-lbl`，原 `.ld-cocard-lbl` 收敛合并）——尺寸卡「尺寸：」行内标签改为图例「尺寸」（两组步进器改为 space-evenly 均布）；属性面板加动态图例 `#ld-props-lbl`：未选中显示「模板」、选中元素显示**元素类型中文名**（新增 `TYPE_CN` 映射：文本/线条/条码/二维码/图片/字段/矩形），面板内原类型 tag 移除（复制/删除按钮组 `margin-left:auto` 保持右对齐）；公司名颜色由墨色改为**品牌青色**（与数字同色）。CDP 验证：三图例渲染正确、选中画布元素图例联动（字段/矩形实测）、按钮组右对齐。**随后按用户要求移除「模板名称」字段，再移除全部内容**：未选中元素时属性面板完全留空（模板名称、操作提示、未选中占位均去除，仅余图例），CDP 复核面板 body 为空。**同日图标放大（用户要求）**：左侧组件面板按钮图标 30→**40px**，右下打印按钮打印机图标 17→**22px**，CDP 实测渲染尺寸复核通过。

### 方式一：直接用 iframe 嵌入

```html
<iframe src="/apps/label/designer.html" style="width:100%;height:720px;border:0"></iframe>
```

### 方式二：作为组件挂载到宿主容器

```html
<link rel="stylesheet" href="/apps/label/designer.css">
<div id="designer-slot"></div>
<script src="/apps/label/label-core.js"></script>
<script src="/apps/label/designer.js"></script>
<script>
  LabelDesigner.mount('#designer-slot'); // 注入三栏设计器（工具栏/组件/画布/属性）
  LabelDesigner.open('ABC_PRODUCT');     // 载入某模板
</script>
```

### 对外接口 `window.LabelDesigner`

```text
mount(root?) 挂载（省略参数则挂到 #label-designer）；返回 api 自身
open(code) / load(code)  载入指定模板进行编辑
get()                    返回当前正在编辑的模板对象
save()                   保存当前模板到 localStorage（已存在则更新，否则追加）
refresh()                重新渲染（模板/组件/画布/属性）
newTemplate()            新建空白模板（自动生成临时 code；填写「公司编码」并保存后即以其为唯一索引）
exportJSON()             弹出可复制的 Label JSON
importJSON()             粘贴 JSON 导入并载入
db                      当前 DB 引用
```

### 设计器能力

- **公司代码索引**：以「公司代码」为模板唯一标识。画布上方的居中输入框、模板下拉、右栏「模板」属性、模板管理表均以公司代码展示；保存时由公司代码派生模板 `code`（`A-Z0-9_-`），冲突则拒绝。
- **组件面板（精简）**：元素与 SAP 字段**全部展开为图标按钮**（2026-10-08 用户要求，不再用下拉框）：4 类元素（文本 / 条码 / 二维码 / 线条）+ 分隔线 + 10 个字段按钮（物料编码 MATNR / 物料描述 MAKTX / 批次 CHARG / 数量 LFIMG / 工厂 WERKS / 库存地点 LGORT / 客户 PO BSTKD / 客户物料编码 KDMAT / 客户订单号 VGBEL / 手工输入 CUST_MATNR），均为 inline SVG 图标 + 中文字段名（+ 字段编码小字），点击即加入画布；2026-10-08 已移除 Logo 元素入口（已有模板中的 logo 元素仍按原样渲染兼容）。
- **画布**：点击选中、拖动移动、右下角手柄缩放；1mm 网格吸附 + 元素/画布边缘与中心对齐参考线（容差 1.2mm）；`Delete`/`Backspace` 删除选中元素；点击空白处取消选中；**刻度尺满边**（轨道铺满画布区整条边，0 刻度与标签边缘对齐，缩放/滚动时自动重排）。**中栏参考 OpenLabelMaker 编辑器**：画布区铺 5mm 点阵背景（与标签网格对齐、随滚动同步）、白色标签轻阴影无边框、右上角浮动**缩放控件**（− / 百分比 / ＋ / Fit，25%–400% 真实缩放，只影响显示不改数据）、底部**状态栏**（元素数 + 标签尺寸 + 操作提示）。
- **属性面板**：X/Y/W/H(mm)、字号、文本内容、字段名 / 显示标签、数据来源（`sap`/`manual`/`static`）、必填（运行时录入）、条码/二维码内容（支持 `{{字段}}` 占位）。
- **模板属性**：公司代码（画布上方居中输入框）、名称 / 宽 / 高（右栏「模板」属性组，未选中元素时显示）。
- **基本模板格式（2026-10-08）**：默认模板（`ABC_PRODUCT` / `DEFAULT`）自带基础版式——黑色边框（rectangle，内缩 1.5mm、2px 线宽）+ 右侧竖排 Lechler 组合标志（`lechler-c-logo-combination-mark-black-00.png`，45×6mm 盒体 `rotate: -90`，符号在下、文字自下而上）；渲染引擎（`createEl`）新增 `el.src`（真实图片 `.el-img`）/ `el.rotate`（绕中心旋转）/ `el.borderWidth`（rectangle 线宽）三个元素属性，画布、常驻打印预览与弹窗预览一致呈现。**旧缓存自动迁移**：SEED 带 `meta.seedVersion`，`loadDB()` 发现本地缓存版本更低时自动用 SEED 内置模板覆盖同名模板（自建模板保留），无需手动清 `localStorage`。
- **导入 / 导出**：Label JSON 的复制与粘贴导入（`code` 冲突则覆盖）。
- **预览**：用示例数据（`sampleData()`）渲染整张标签；中栏下常驻「打印预览」（只读、随设计同步刷新、空间不足自动等比缩小），工具栏「预览」按钮另开弹窗看大图。
### 界面样式（工业风 · 2026-10-08 按新设计稿线框截图重做）

- **主题色**：单一品牌色 RGB 0,104,120（`#006878`），用于外框、分栏细线、选中页签、主按钮、画布描边、表头与焦点态；派生色 `--brand-dark: #004f5c`（悬停/深底）与 `--brand-light: #e6f1f2`（浅底）。设计器侧变量与之一一对应：`--ld-brand` / `--ld-brand-dark` / `--ld-brand-soft`（旧的 `--ld-accent*` 三个别名已随重写删除，取值不变）。
- **外壳与页签（2026-10-08 新 UI 线框）**：外壳**无整体外框**——页签与操作按钮浮于白底；下方三栏各自为独立的 2px 主题色**圆角盒**（圆角 6px，盒间距 24px；描边已按用户要求加粗）。页签是 32px 高**实心**小签（全部主题色底 + 白字，6px 圆角，选中＝深色 `--brand-dark` 区分），距左 ≈21px、间隙 14px，与操作按钮同处顶栏 `.app-bar`。
- **顶栏操作按钮**：预览 / 导出 / 导入（白底）+ 保存（实心主题色）位于顶栏右侧 `#app-acts`——由 `script.js` 在设计器挂载后把工具栏里同一批按钮（id 与绑定不变）移动过来；切到「模板管理」页签时整组隐藏。独立页 `designer.html` 不加载外壳脚本，按钮留在设计器工具栏中。
- **字号与尺寸（2026-10-08 用户要求「字体大些」，整体放大约 12%）**：正文 14px、设计器 13.5px、表格 / 按钮 / 页签 / 输入 13–14px、字段标签 12–12.5px、分组标注 11px、标尺刻度 9.5px；控件内边距 4–6px，圆角：页签 / 按钮 / 三栏容器统一 6px（2026-10-08 用户要求）、其余控件 0–1px。画布内元素的 `fontSize` 属于标签内容（非界面字号），保持不变。为让独立页 `designer.html`（不加载 `style.css`）与嵌入页一致，`designer.css` 另以 `html { font-size: 13.5px; }` 兜底基准字号（`style.css` 的 `body` 字号优先级更高，二者互不影响）。
- **三栏 + 中栏上下（2026-10-08 新 UI 线框；圆角后调小、上下改等高）**：左＝组件面板、中＝设计界面（上）+ 打印预览（下）、右＝公司代码 + 属性面板；三栏各为 2px 主题色**圆角盒**（6px），盒间距 24px（**不再有竖线**）；宽度比 **1 : 3 : 1**（左 20% / 中 60% / 右 20%），由 `grid-template-columns: minmax(150px, 1fr) minmax(260px, 3fr) minmax(150px, 1fr)` + `gap: 24px` 实现；中栏盒内两个标签上下排列、以 28px 留白分隔（**无横线、无标题行**），**上下等高 50 : 50**（舞台 357px = 预览 357px：画布 `min-height: 340px` + 标尺 17px）；面板无节标题，组件按钮为品牌色描边小方块（2 列网格）。
- **公司代码与模板属性（2026-10-10 线框调整）**：右栏拆为上下两个独立圆角盒——顶部**公司代码卡片**（图例式「公司代码」小标签压在盒边上缘；大号加粗等宽代码可直接编辑，仍是模板唯一索引，**恒为 7 位数字**：输入掩码仅允许数字、最长 7 位；下方实时显示公司名，来自 `customers` 按代码查找、无匹配显示 —）；下方为属性面板盒（未选中元素时展示「模板」属性组：名称 / 宽 / 高，即 `data-t` 字段；选中元素时展示元素属性）；两盒间距 24px（≤820px 时 16px）；界面术语统一为「公司代码」（原「公司编码」）。演示客户主数据改用 7 位代码（`4101901` / `4101902`），模板、交货单、打印规则、示例数据同步。
- **工具栏取舍（功能不丢）**：嵌入主应用时设计器工具栏（模板下拉 / 新建模板 / 对齐 / 徽标）由 `.ld-embedded` 隐藏——模板切换 / 新建走「模板管理」页签（点「设计」回到设计器），对齐吸附保持默认开启；独立页 `designer.html` 工具栏完整保留。标尺、「打印预览」标题行保留（设计辅助，视觉占比小）。
- **栏结构稳定**：栏宽比例恒定，窄窗口只整体收窄、**不降级为两栏**（属性面板永不会掉到画布下方）；仅 ≤820px 才堆叠为三个圆角盒竖排（间距 16px，属性面板回到画布下方）。
- **非满边**：应用外框左右各留 14px（`width: calc(100% - 28px)`）、上下内缩（`margin: 10px auto 16px`，页签贴上边缘后顶部只需小间距）并限宽居中（`max-width: 1360px`），避免把元素拉伸去填满窗口。
- **样式归属**：外壳与公共控件在 `style.css`（`--brand` 变量），设计器内部在 `designer.css`（`--ld-*` 变量，限定 `.label-designer`），弹窗/提示为 `ld-*` 前缀（全局安全）。
- **文件结构（2026-10-08 两次重写：先按原截图 1:1 重建渲染结果，再按新设计稿线框重排）**
  - `css/style.css`（8 节）：① 设计令牌 ② 基础 ③ 外壳外框+顶栏（页签/操作区） ④ 视图容器与页头 ⑤ 按钮 ⑥ 表单 ⑦ 表格 ⑧ ≤820px。
  - `css/designer.css`（18 节）：① 设计令牌 ② 基础 ③ 根容器 ④ 工具栏（含 `.ld-embedded` 嵌入隐藏规则） ⑤ 右栏公司代码字段 ⑥ 三栏栅格（圆角盒 + gap） ⑦ 表单控件 ⑧ 按钮 ⑨ 面板（圆角盒） ⑩ 组件面板 ⑪ 画布舞台+标尺 ⑫ 画布 ⑬ 中栏（设计界面/打印预览，同盒留白分隔） ⑭ 画布内元素+对齐参考线 ⑮ 属性面板 ⑯ 弹窗 ⑰ 提示 Toast ⑱ ≤820px。
  - `index.html`（外壳：`.app-bar(#tabs + #app-acts)` + `#main` + `.ld-*` 覆盖层）与 `designer.html`（仅设计器挂载点）；`js/label-core.js`（SEED 版式 + seedVersion 迁移 + `el.src/rotate/borderWidth` 渲染）；`js/designer.js`（SHELL：去节标题/预览标题行，右栏公司代码字段 + 「模板」属性）与 `js/script.js`（顶栏构建、按钮上移、切视图隐藏操作区）按新 UI 调整。
  - **目录结构（2026-10-10 标准 H5 重构）**：入口页（`index.html` / `designer.html`）与后端（`server.js`）、工具（`import-customers.js`）留根目录；前端资源分类入子目录——`css/`（样式 2 个）、`js/`（脚本 3 个）、`assets/`（Lechler 图标与组合标志 3 个）。模板元素与口令卡片的图片路径同步加 `assets/` 前缀（存量 SQLite 库已迁移，服务器侧经 API 整库改写、自动备份）；`data/` 仍不入部署（服务器数据在 `/opt/label/data`）。server.js 静态白名单按扩展名放行子目录，无需改动。
  - 第一次重写删除的零引用残留（原 9 视图版本遗留，逐项 grep 确认无引用）：`.card` / `.stat*` / `.section-title` / `.row` / `.muted` / `.badge*` / `.pill` / `.chips` / `.timeline` / `.legend` / `.toolbar` / `.grid2` / `.form-card` / `.btn-ok` / `.btn-accent`、`.code-block`、`.tab .ic`、未使用令牌 `--bg`；`--ld-accent*` 改名对齐为 `--ld-brand*`（取值不变）。第二次重排再删：`.panel > h4` 节标题、`.pal-group` 分组标注、`.ld-meta` 全宽属性行。
- **验收（可复跑，脚本在 `%TEMP%\label-smoke`）**：`check-ui.js`（48 PASS，含新 UI 断言：无外框、2px 圆角盒、盒间距、右栏公司代码、预览无标题行、图标按钮）、`smoke2.js`（30 PASS，含 seedVersion 旧缓存迁移）、`measure-ui.js`（56 PASS，实测三栏 20/60/20、盒间距 24px、各盒四边 2px 描边、中栏上下等高 50:50、页签距左 ≈21px）、`check-embed.js`（designer.html / index.html 各 18 PASS）**全部 0 FAIL**；`node --check` 三个 JS 文件语法通过；1366 / 760 截图与新 UI 线框逐区比对一致（含 ≤820px 三盒堆叠）。
