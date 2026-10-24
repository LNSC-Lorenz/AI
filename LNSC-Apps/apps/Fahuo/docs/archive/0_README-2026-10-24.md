# LNSC 全链发货平台 | LNSC Full-Chain Delivery System

国内发货全链路过程管理的内网网页应用，覆盖从地址录单、打单、清单到 SAP 对接的发货全流程。
前端纯静态（HTML + CSS + JS，无框架、无构建）；数据持久化采用 **SQLite**（单文件，零运维）。

> **当前状态**：五模式全部可用 —— 录单（识别+行内编辑+类型分视图）/ 下单（类型过滤+四套面单模板）
> / 清单（全列搜索）/ SAP（交货-清单视图）/ 标签（SAP 标签管理平台并入，iframe 嵌入）；
> SQLite 持久化 + 离线 mock 回退。（⑤ 追溯/可视化页 2026-10-12 用户规则移除）

## 架构

```
HMI触屏 / PC 浏览器（静态页）
      │ fetch JSON（自动探测：同源 /fahuo/api/ → 直连 :8091/api）
      ▼
server.py（Python 标准库）或 server.js（Node 版，本地开发用）
      │  REST API + 静态文件服务，端口 8091
      ▼
fahuo.db（SQLite 单文件，WAL 模式）
      │ cron 每日 .backup 到 backup/（保留 30 天）
      ▼
backup/fahuo-YYYYMMDD.db
```

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/orders?date=YYYY-MM-DD` | 发货单列表（默认全部，最新在前，上限 500；`?date=` 按天筛选） |
| POST | `/api/orders` | 新建发货单（so/省市区/街道/姓名/电话/承运商/ship_date） |
| PUT | `/api/orders/<id>` | 更新任意字段；status 变更自动打时间戳（printed/shipped/returned） |
| DELETE | `/api/orders/<id>` | 删除 |
| GET | `/api/stats` | 看板统计：昨日发货 / 今日待发货 / 计划发货 / 今日回单 |
| GET | `/api/label/health` | 标签平台健康检查（模板/客户/历史计数；2026-10-12 Label 并入，原 Node :8092 退役） |
| GET | `/api/label/db` | 标签平台整库读取（meta/templates/rules/fields/customers/deliveries/history） |
| PUT | `/api/label/db` | 标签平台整库事务清写（payload 缺省分表不变；每天首写自动备份 `label-YYYYMMDD.db` 保留 7 份） |
| GET | `/api/upload?dn=` | 该 DN 已上传文件列表 `{dn, files[]}`；**不带 dn → `{counts:{dn:n}}` 全量照片计数**（清单"发货照片"列一次取数） |
| POST | `/api/upload?dn=&name=` | 上传文件到 `Upload/<DN>/<文件名>`（body=原始字节，≤50MB） |
| DELETE | `/api/upload?dn=&name=` | 删除该 DN 的某个上传文件（目录删空自动移除） |
| POST | `/api/carrier/order` | 承运商下单（顺丰/德邦/跨越→carriers 包；专车/自提→厂内 ZC/ZT 单号） |
| POST | `/api/carrier/cancel` | 取消下单 `{id}`：**仅未揽收**（route_status=待揽收；专车/自提本地清除）；成功后清空运单字段回待下单，可改数据/参数重新下单 |
| GET | `/api/carrier/route?carrier=&waybill_no=` | 承运商轨迹查询 |
| POST | `/api/admin/clear-orders` | 清空订单表（设置页「清除模拟数据」） |

> 前端在 API 不可达时**自动降级为本地模式**（仅内存暂存，刷新丢失，页面给出提示），
> 双击 index.html 的纯预览场景不受影响。

## 页面布局

```
┌──────────┬────────────────────────────────────────┬──────────┐
│          │  标题栏：LNSC 全链发货平台              │          │
│  - 1 -   ├──────────────────────┬─────────────────┤  昨日发货 │
│ 录单模式 │  地址粘贴框           │  地址粘贴框      │   16单   │
│ (激活)   │  （点击识别）         │  + 顺丰/德邦    │          │
│          │  [识别]              │  省/市/区 下拉  │ 今日待发货│
│  - 2 -   │                      │  街道与公司     │   16单   │
│ 下单模式 │                      │  SO/日期 [确认] │          │
│          ├──────────────────────┴─────────────────┤  计划发货 │
│  - 3 -   │  SO │ 地址 │ 姓名 │ 联系方式 │ 备注 │ 承运商 │ 16单 │
│ 清单模式 │  （发货清单表，待数据填充）              │          │
│          │                                        │   今日回单   │
│  - 4 -   │                                        │   16单   │
│ SAP模式  │                                        │          │
└──────────┴────────────────────────────────────────┴──────────┘
```

- **左侧模式导航**：录单 / 打单 / 清单 / SAP 四种工作模式切换（当前默认激活「录单模式」）
- **中间录单区**：左侧粘贴地址文本一键识别；右侧展示解析结果（省/市/区、街道与公司、承运商、SO、日期），人工确认后入单
- **中间清单表**：已录入发货单列表（DN、地址、姓名、联系方式、备注、承运商）
- **右侧统计**：昨日发货 / 今日待发货 / 计划发货 / 今日回单 四类单量看板（当前为占位数据 16单）
- **标题栏**：左段 LECHLER 组合标志（`shared/lechler-c-logo-combination-mark-cmyk-00.svg`，白底按源文件品牌色 #006878 显示，黑白模式随主题转纯黑）；中段主题色斜切段内为中文名 + 英文全称同一行并排（「LNSC 全链发货平台」+「LNSC Full-Chain Delivery System」）；右段 Logistics + 时钟 + 主题色块 + 警告/API 状态点/设置/关于（2026-10-08 用户指定）

## 文件说明（目录结构：页面 / 共享 / 服务 三块）

```
Fahuo/
├── index.html                  入口重定向 → pages/1-entry.html（保 /apps/fahuo/ 根地址可用）
├── pages/                      【页面层：一号一页，页名即文件名】
│   ├── 1-entry.html / 1-entry.js   ① 录单（地址识别 + OCR + 共享地址池 + 发货清单表）
│   ├── 2-order.html / 2-order.js   ② 下单（DN 选择 + 承运商设置 + 真实下单 + 云打印面单 + 打单列表）
│   ├── 3-list.html  / 3-list.js    ③ 清单（整合全列 + 模糊搜索）
│   ├── 4-sap.html   / 4-sap.js     ④ SAP（B1/HANA「交货-清单」视图，对接时替换 Service Layer）
│   └── 6-label.html                ⑤ 标签（SAP 标签管理平台 iframe 整页嵌入中间区，无独立 JS；
│                                       label 口令门 2026-10-12 已移除；入口=左侧导航「标签」块，
│                                       右上标签图标按钮已撤——同日用户规则三翻转终定）
│   （⑤ 5-trace.html / 5-trace.js 追溯/可视化页：2026-10-12 用户规则「移除追溯的页面和功能」
│       全撤——页面文件删除、各页左侧导航撤块；style.css 里 .viz*/.dev-wm 样式暂留未用）
├── shared/                     【前端共享资源】
│   ├── style.css                   样式（黑白/蓝色双主题，1080P 一屏满边，五页共用；
│   │                               蓝色模式主色 = RGB 0,104,120 #006878，2026-10-08 用户指定）
│   ├── topbar.js                   顶部栏：时钟/主题/设置/关于/markApi 状态点
│   │                               （标签图标按钮在设置左侧，5 页 HTML 内联，功能待接线；2026-10-12）
│   ├── stats.js                    右侧统计看板（API 实时，两位占位）
│   ├── region.js                   全国省市区数据（34省/342市/3056区县, MIT）
│   ├── icon/                       图标（printer、file-type-* 等）
│   ├── lib/                        本地组件（OCR tesseract + chi_sim/eng 训练数据、xlsx、docx-preview、
│   │                               jszip、JsBarcode/qrcode〈自绘面单条码二维码〉；浏览器直接加载）
│   ├── fonts/simhei.ttf            中文字体（ot_label 自绘面单用；9.7MB 版权字体，**随包部署不入库**）
│   ├── App.ico                     站点图标（历史，保留）
│   ├── lechler-c-logo-symbol-mark-cmyk-00.svg/.png   浏览器标签 favicon（当前站点图标，SVG 主 + PNG 兜底）
│   └── lechler-c-logo-combination-mark-cmyk-00.svg   标题栏左段 LECHLER 组合标志（白底按源文件品牌色显示，黑白模式转纯黑）
├── ot_label.py                 自绘面单渲染（PIL：100×150mm PDF + 缓存，server.py import；方案备选未启用）
├── server.py                   API 服务（生产，位置不变：Python 标准库零依赖，静态根=Fahuo/）
├── server.js                   API 服务（本地开发，Node≥22.5；经子进程调同一 carriers 包）
├── carriers.env                承运商密钥（chmod 600，systemd EnvironmentFile 注入；2026-09-30 移出版本控制）
├── carriers/                   【承运商层：一家一文件】
│   ├── sf_express.py               顺丰（下单 + 云打印面单，严格按官方流程）
│   ├── deppon.py                   德邦（签名破解版 + logisticID 逐单自增）
│   ├── kye.py                      跨越（骨架，待报文样例）
│   ├── base.py                     HTTP/签名/PDF下载 公共件
│   ├── __init__.py                 注册表分发 + 面单 PDF 提取
│   ├── cli.py                      Node 子进程统一入口（order/route/label）
│   ├── .db_logistic_seq            德邦 logisticID 自增计数（勿删）
│   └── 增值服务产品表-*.pdf         顺丰官方《增值服务产品表》（serviceList 取值唯一依据）
│       （测试/探针脚本 `_*.py` 仅存本地仓库作证据存档，**不同步服务器**——2026-10-12
│        用户规则「仅同步必须的文件，所有的测试都不要同步」；现网 9 个探针已清除，见文末）
├── fahuo.db                    SQLite 订单库（备份=复制该文件）
├── label/                      SAP 标签管理平台（2026-10-12 自 apps/Label 并入：设计器/模板/规则/
│   │                           客户/打印历史；API 并入 fahuo-api `/api/label/*`，原 Node :8092 与
│   │                           label.service 退役；数据库沿用 /opt/label/data/label.db；
│   │                           server.js / import-customers.js / data/ 仅本地留存，部署排除）
├── oid.seq                     承运商客户单号持久序列（勿删，删了撞单）
├── Upload/                     发货单附件（按 DN 建子文件夹）
├── .gitignore                  运行时数据/密钥/字节码/字体不入库（与 apps/SSH/excludes.conf 同源）
├── 0_README.md                 本文档
├── 1_install-api.sh            服务器一键部署（systemd + 每日备份 cron + 自检）
└── 7_harden_webroot.sh         webroot 加固（幂等）：清字节码 + 密钥 600 + nginx 拦截源码/密钥/库
```

## 承运商 API 对接（carriers/ 包）

**架构**：不开独立服务，`server.py` 内嵌 `carriers/` 包，统一端点 `/api/carrier/order|route|label|cancel`；
本地 `server.js` 经 python 子进程（`carriers/cli-*.py`）调**同一个包**，行为一致。
密钥经 `carriers.env`（chmod 600）+ systemd `EnvironmentFile` 注入，**永不入代码库**。

**取消下单**（2026-09-16 接入；**2026-09-24 顺丰真单闭环验证通过**）：
- 顺丰 `EXP_RECE_UPDATE_ORDER`：✅ **有权限**，四张真实测试单全部取消成功（resStatus=2）；
  报文 `{orderId, dealType:"2"}`（waybillNo 非必需）。
  ⚠️ **A1004"无对应服务权限"双重根因**（09-16/09-24 两次误诊教训）：
  ① **密钥污染**——`carriers.env`(CRLF) 经 bash `source` 注入使 partnerID 尾带 `\r`，网关不识别 → A1004
  （已修：`base.get_cfg` 一律 strip + 服务器 env 转 LF；systemd EnvironmentFile 注入本就干净，生产从未受影响）；
  ② **服务确实未订阅**——净密钥复测 `EXP_RECE_CANCEL_ORDER`（老取消）/`EXP_RECE_SEARCH_ORDER_RESP`（订单回显）仍 A1004，需丰桥申请开通。
  遇 A1004 先用净密钥复测再下结论
- 德邦 `standard-order/cancelOrder.action`（async 网关）：**2026-09-17 真单闭环验证通过**（权限已开通，3002 解除）；
  ⚠️ async 入账延迟：下单后立即取消报"不存在订单信息"，代码内已做 5s/15s 退避重试；
  `cancelOrderNotify` 同名存在，可用 `DB_CANCEL_IF` 环境变量切换；dpapi sync 路径 404 已排除
- 德邦轨迹 `standard-query/newTraceQuery.action`（sync 网关，2026-09-17 对接）：参数 **`mailNo`+`customerCode`**
  （waybillNo/waybillNos 均报 2006）；响应 `responseParam.trace_list`（无记录=空数组非错误）；
  节点归一化为顺丰同构 acceptTime/acceptAddress/remark，状态映射 待揽收/已揽收/运输中/派送中/已签收
- 下单返回持久化 `order_id`（oid）+ 德邦 `logistic_id` 到 `order_resp`，取消时取用（老单无 oid 需人工后台取消）

**轨迹查询**（2026-10-24 到付 20028 事故终定，**查询参数固定口径，勿改**）：
- 顺丰 `EXP_RECE_SEARCH_ROUTES`（同一下单网关，表单 POST）：
  msgData 固定形态 `{"language":"zh-CN","trackingType":1,"trackingNumber":["<运单号>"],"checkPhoneNo":"<后4位>"}`
- ⚠️ **`checkPhoneNo` 必填**（收/寄方手机号后4位，**双方任一均可**——实测 收件7801 / 寄件8088 / 收件4412 全通过）：
  到付单（`payMethod=2`、无 monthlyCard）不传 → `reasonCode 20028`「月结卡号不匹配」、路由恒空被误显「待揽收」；
  参数名必须**长名 `checkPhoneNo`**（短名 `checkNo` 无效仍 20028）；寄付月结单同样兼容 → 平台**全量传**
- 平台取数口径：收件 `phone` 优先、寄件 `emp_phone` 兜底，去非数字后取后4位（server.py `_phone_last4`/`_row_phone4`）；
  `GET /api/carrier/route` 支持 `?phone4=` 显式覆盖（DB 无记录时的手工兜底）
- 响应：`apiResultData.msgData.routeResps[0].routes[]`（双层嵌套）；空路由时以 `reasonRemark` 为状态
  （如「月结卡号不匹配」「暂无路由信息」），**不再盲显「待揽收」**（20028 事故掩盖根因的教训）
- 德邦不受影响（`newTraceQuery` 只认 `mailNo`+`customerCode`；`check_phone_no` 仅签名兼容透传忽略）

**回签单**（2026-09-17 官方文档《【新】下单服务接口 德邦.doc》终定，真单面单验证"签收单原件返回"）：
- 德邦：**纸质回单 → `addServices` 对象子字段 `{backSignBill:"1", returnRequirement:"R1", returnBillQty:1}`**——
  ⚠️ 三个字段必须在 **addServices 内**，放顶层被静默忽略（12 种形态实测面单均"无需返单"，教训：层级错了不报错）；
  backSignBill=1(原件返回)/2(电子签收单) 时 returnRequirement+returnBillQty 必填；R1:签名 R2:盖章 … R8:面单
- 德邦 `payType` 官方枚举（文档+面单双证）：**0=寄付现结(现付) 1=到付 2=寄付月结**；
  曾写死 1 致寄付月结错显"到付"（#492）；大客户模式可能不支持 0
- 顺丰：**纸质回签单 `isSignBack=1`（签单返还，官方唯一有效值；2026-09-23 现网事故终定）；
  拍照回传=增值服务 `IN91`（serviceList 下发，2026-09-24 官方产品表终定）**；
  ⚠️ **副作用实测（2026-09-17 "选1显示2"根因）**：`isSignBack=1` 时下单响应 `waybillNoInfoList` 会**多返一条
  `waybillType=3` 的签单返还回单运单**（SF1064 号段）——**件数只认 `waybillType` 1(母)/2(子)**，
  回单运单存档 `order_resp.sign_back_no` 备查（不计件数、不参与合并打印）；此前未过滤导致回单被误判为子件
  （清单②角标/打印2页）
- ⚠️ **`isSignBack=2/3`（拍照回传）运营端静默无效——2026-09-23 现网事故**：近期顺丰单双勾"纸质+拍照"按旧规则
  发 2，面单照印回签单号（type=3 运单号），但**收方快递员终端无回单任务、打不了回单**；服务器实测
  （_sf_signback_route_probe）：主运单轨迹完整已签收，**回单运单恒"待揽收"0 节点** → 顺丰网关接受 =2
  并返号，但运营端不启动签单返还流程；09-17 探针"=2 已含纸质流程"系 API 表面误判。
  `extraInfoList attrCode POD` 被 S0003 拒、`=3` 组合值同样静默无效（_sf_signback3_probe）。
  **修复（2026-09-24 官方《增值服务产品表》终定）**：纸质回单 → `isSignBack=1`（签单返还唯一有效字段值；
  纸质签单返还增值服务 IN03 下单时无需下发）；**拍照回传 → 增值服务
  `serviceList:[{"name":"IN91","value":"13"}]`**（IN91=拍照回传，value 固定 13=签回单拍照，见下表），
  不再借用 isSignBack=2/3；实际下发存档 `order_resp.serviceList` 备查（_sf_in91_probe 真单验证）。
  **方案A 面单标识（2026-09-24 → 2026-10-08 用户改口径）**：勾选**拍照回传**时下单 `remark` 自动追加
  「需拍照回传」（如并单 DN 清单后），实际下发存档 `order_resp.remark`；标准模板 fm_76130 备注区
  是否打印以真实面单实证。
  ✅ **2026-10-08 用户改口径（终定，取代方案A 里「需纸质回单」的打印）**：**「需纸质回单」不再打印**，
  拍照回传标识只留 remark「需拍照回传」。
  ✅ **2026-10-08 同日撤销（用户原话「移除备注加的 的回单 3个字」）**：曾上线「勾了回单（纸质/拍照任一）
  则托寄物末尾加『的回单』」（如「喷嘴 25pcs的回单」）——**已移除，托寄物恒原样传递、不加任何后缀**；
  回单渠道仍走增值服务（纸质=`isSignBack=1` / 拍照=`serviceList IN91`），不受影响。
  用户实证单：DN 8260034693 SO 3260027425（面单：托寄物「喷嘴 25pcs」/ 订单号=oid 2106 /
  备注「DN：… SO：… 需纸质回单/需拍照回传」）——现行为：托寄物「喷嘴 25pcs」（原样）+
  备注「DN：… SO：… 需拍照回传」。落点：顺丰 `carriers/sf_express.py`、德邦 `carriers/deppon.py`
  （同规则；德邦无拍照回传，故只论纸质回单）；离线探针 `carriers/_label_marks_probe.py`
  （拦下单报文逐字段断言，不触网/不下真单，部署脚本内置）；
  服务端脚本 `/home/sysadmin/_deploy_labelmarks.sh`、`_verify_labelmarks.sh`
  （暂存源 `/home/sysadmin/fahuo-lm`：sf_express.py / deppon.py / _label_marks_probe.py / 0_README.md）
  平台侧新增**回单运单追踪**（server.py `_refresh_sign_back`）：主单签收终态后改追踪 sign_back_no 轨迹，
  回单运单终态 → 自动置 returned + returned_at（回单日期自动填；发货日起 30 天窗口、复用节流）
  （2026-09-29 口径修正：仅历史单自动置；新单只提示，见下"修复状态清单"）。
  ✅ **2026-10-12 回单签收日期显示（用户规则「回单是有单号的，显示回单的签收日期」）**：
  追踪时从回单运单轨迹提取签收时间存档 `order_resp.sign_back_date`（终态节点 acceptTime，
  含「签收/回单」字样节点优先、兜底最新节点；已提示过终态的旧单自动补查一次回填 `SIGNBACK-DATE` 审计）；
  历史单自动置 returned 时 `returned_at` 取该节点时间（不再用检测时刻）。
  清单「回单日期」列 = 人工置回单日（实物核实 `returned_at`）优先，否则回单运单签收日期
  （`3-list.js retDateOf`，表格/搜索/分享导出同口径）；列内显示为**年/月日 两行版式**
  （2026-10-12 用户指定：如 `2026/` 换行 `10/11`；搜索/分享导出仍 ISO `YYYY-MM-DD` 单行）。
  ✅ **2026-10-12 在途档（用户规则「如果还没有签收，且有路由信息，就显示在途」）**：回单运单
  未签收但已有路由节点 → 追踪时存档 `order_resp.sign_back_status`（待揽收/无轨迹不写），
  列显示「**在途**」（`retCellOf`：人工回单日 > 签收日期 > 在途 > —；搜索/分享导出同口径）。
  **2026-10-24 用户规则更新**：列显示改为「**回单 > \<回单运单状态\>**」灰色徽章（如 回单 > 运送中），
  **可点击查看回单路由**（`openSignBackRoute`，与回单日期徽章同款弹窗）——「在途」二字弃用；
  优先级不变：人工回单日 > 签收日期 > 回单状态徽章 > —。
  **回签单面单打印（2026-09-25 用户规则 → 2026-10-08 官方口径落地）**：回单回不来系到方地址未维护——
  回签单（type=3 SF1064）面单必须打印随货走。打印链路追加签回单号，服务端取到即合并追加、取不到静默跳过，
  绝不阻塞主面单；件数角标/步骤弹窗仍不计回单（"选1显示2"教训不复发）。
  ✅ **2026-10-08 官方口径终定（文档 + 顺丰客服核实 + 真单实锤）**：`documents[]` 单号字段按单据类型
  **择一**——`masterWaybillNo`(母) / `branchWaybillNo`(子) / **`backWaybillNo`(签回单)**；文档原话
  「打印签回单时，masterWaybillNo 和 branchWaybillNo 为空」。此前把 SF106 回单号塞进 `masterWaybillNo`
  → 恒得 1 页正向 POD 签收联（即 09-30 撤回的错误第 2 页）；改传 `backWaybillNo` 即得**反向回签单**：
  实测（探针 `carriers/_sb_back_probe.py`，order#557 主单 SF5148042784954 / 回单 SF1065010577207）
  =1 页「1/1　回: SF1065010577207」+「关联主运单: SF5148042784954」+ 收=范蓓蓓/莱克勒喷嘴系统（常州）
  德城路99号 + **到付** + 寄=客户地址——收寄互反、票面回链原主单号，与速打两联出纸一致。
  链路：前端 `2-order.js` 打印时传 `back_no=<signBackNo>`（顺丰且有回单号）→ 服务端 `_carrier_label`
  调 `print_label(..., back=True)` → `_cloud_print_docs([{backWaybillNo:…}])` → 与主面单合并为一个多页
  PDF（一次预览一次打印随货走）；兼容旧参 `optional_no`+`with_optional=1`（旧探针语义同 back_no）。
  （⚠️ 该追加历经 2026-09-29 放弃、09-30 恢复、**09-30 二次撤回**（附加页恒为正向 POD 签收联）、
  **10-08 官方参数修正后重新启用**）
  **速打反向回签单面单实测（2026-09-29）**：SF 速打客户端同一打印任务出纸主运单+反向回签单两张
  （SF5155825356371 + SF1065003763540，订单号 U0676092993637282）：两联收/寄地址互反，回签单
  「到付」+「签回单原单号」回链主单，主单明细栏同印回单号（路由 532W-BG-WBD01E-00 / 519WA-HT-000）
  → 反向回签单（反向+到付）在**速打**中签收前即可出纸（2026-09-30 更正：此路仅速打可用，丰桥云打印取不到，见下"打印链路二次终定"）；
  且反向联收方=莱克勒 江苏常州金坛德城路99号（与 SIGN_BACK_ADDR 一致），新单返回段到方地址面单侧已正确。
  ⚠️ **自查更正（2026-09-29，撤回"Fahuo 打印链路经 optional_no 合并追加该反向联"的未验证断言）**：
  Fahuo 链路 SF106 号云打印实测（#557，`_sb_pages.py` 归档）=1 页**正向 POD 签收联**（寄=莱克勒/
  收=客户/寄付月结，与主面单同收件人、单号不同）——追加出纸即用户指出的"**两张面单同收件人
  不同单号**"重复缺陷 → **已放弃追加**：服务端 `_carrier_label` 仅显式 `with_optional=1` 才合并
  （供探针逐页核验），前端不再传 `optional_no`，打印=仅官方主面单。目标出纸=速打同款两联
  （官方主面单 + 官方反向回签单：收寄互反/到付/签回单原单号回链）；反向联的云打印取得路径
  （单据类型/阶段）三路实测均失败（详见下"打印链路二次终定"）→ 官方取法待顺丰答复；自绘方案具备落地条件，待用户决策。
   ✅ **打印链路二次终定（2026-09-30 用户指令，撤回当日"恢复两页"）**：用户口径——第 2 页必须是
   **反向回签单**（寄=客户地址 / 收=莱克勒 范蓓蓓 德城路99号 / 到付 / 单号=回单号 SF106… / 票面回链原主单号）；
   而丰桥云打印对 SF106 号恒=1 页**正向**"POD标快"签收联（新单 SF1065005847082 + 已签收 SF1064997481417
   双实证）→ 错误第 2 页**已撤回**：服务端 `optional_no` 追加改为仅显式 `with_optional=1` 才生效
   （探针核验用，取不到静默跳过、绝不阻塞主面单），前端不再传 `optional_no`；**默认出纸=1 页官方主面单**；
   反向回签单暂由**速打**补打（官方客户端唯一可出纸路径，见上 09-29 速打实测）。
   已部署现网+冒烟（2026-09-30，备份 /home/sysadmin/fahuo-backup-20260930-101527）：默认=**1 页**主面单
   （SF5155141607457，HTTP 200，76,952B）✅、`with_optional=1`+`optional_no`=2 页（153,709B，探针）✅、
   线上 2-order.js 不传 `optional_no`（0 次）✅、nginx 静态 JS 与磁盘 MD5 一致 ✅（脚本 /home/sysadmin/_smoke_label3.sh）。
   **面单规格实测（2026-09-30）**：官方面单每页 215×368pt = 75.8×129.8mm（≈76×130mm 热敏卷），主/附加页同尺寸。
   **反向回签单取得路径评估（2026-09-30，回答用户"能不能实现"）**：
   ① 官方（首选）：需顺丰给出该单据类型的丰桥参数（serviceCode/templateCode/documents），或在丰桥控制台
      "云打印模板管理"确认是否存在回单专用模板；当前 API 无已知取法，咨询文案已成文（工作区根部
      `_consult_sf_reverse_signback.md`，2026-09-30）待发 95338/丰桥支持/销售；
   ② 自绘（平台内可随时实现）：复用已验证链路 `ot_label.py`——服务端 PIL 300dpi→1 位色 PDF、页尺寸恒等于纸张，
      条码/二维码由浏览器 JsBarcode/qrcode 生成后 POST 上传（服务器已部署 simhei.ttf + 两个前端库）；
      按 76×130mm 版式渲染：寄=客户地址、收=SIGN_BACK_ADDR、到付、单号=signBackNo(o)、票面回链原主单号；
      数据齐备，且 SF106 反向运单在下单时已存在于顺丰系统（自绘票面仅承载该已存在运单）。
      风险：非官方模板，需现场实测一次快递员受理/扫描；路由码（如 519WA-HT-000）我方无数据、不印。
✅ **最终口径（2026-10-08 官方参数终定，取代 09-30「速打补打」决策）**：Fahuo 出纸=**官方主面单 + 官方
   反向回签单**合并 PDF（同一打印任务，随货走）——第 2 页经 `documents[].backWaybillNo` 取得，
   实测即用户要求的版式（收寄互反 / 到付 / 票面「关联主运单」回链原主单号 / 单号=SF106 回单号），
   与速打出纸两联一致 → 无需再走速打补打；自绘方案（上②）仍**不启用**。
   （历史：2026-09-30 用户决策"维持 1 页主面单、反向回签单由速打补打"——其前提"丰桥取不到"已被官方参数推翻）
  速打可作官方客户端补打/核对入口
   **已部署现网 + 烟测实证（2026-10-08，备份 `/home/sysadmin/fahuo-backup-20261008-120207`）**：
   默认=**1 页主面单**（77,010B）✅；**无效回单号降级=1 页**（HTTP 200，追加失败静默跳过、绝不阻塞
   主面单）✅；`back_no=SF1065010577207`=**2 页**（153,846B），第 2 页含「回: SF106…7207 /
   关联主运单: SF5148042784954 / 到付 / 收=莱克勒 德城路99号 / 寄=客户」= **收寄互反** ✅；
   线上 2-order.js 传 `back_no`（1 处）、旧门控 `with_optional` 前端残留 0 ✅；
   nginx 静态 JS 与磁盘 MD5 一致（d8d74f20…）✅；服务 fahuo-api active ✅
   （脚本：`/home/sysadmin/_deploy_back.sh`、`_smoke_back.sh`、`_pick_sb.py`、`_cmp_back.py`）
   **回单逻辑终定（2026-09-29 用户指正 + 轨迹实锤；此前"改单终定"结论作废）**：官方逻辑——选择回单后
   顺丰自动带一张回单返回运单：**运单号=原单回单号（SF106），收件人签收后自动反向、运费到付返回**。
   轨迹实锤（_sb_routes.py 拉取 4 张历史回单运单全节点）：SF1064982980091（#485 上海→常州）、
   SF1064982958300（#487 湖州→常州）、SF1064983709198（#494→常州）、SF1064997481417（#543 苏州→常州）
   全部反向运抵常州龙城转运→金坛万和工业区店派送并"已签收"——返回段确实自动发生。
   ⚠️ 此前误判复盘：据云打印 PDF 面单"寄=莱克勒/收=客户/寄付月结"断言"顺丰不自动反向、需人工改单
   （EXP_RECE_UPDATE_ORDER 8252）"——**错误**。那张面单是 **POD 签收联**（"POD标快"抬头，随货给客户签收用），
   返回段由顺丰系统自动反向发起，与签收联面单内容无关；改单探针方向本身即错。
   **真正根因 = 回单返回"到方地址"未维护**：历史 4 张回单被派送至错误到方地址签收
   （轨迹"已派送成功（仓库）"但莱克勒未收到实物）。行动：向 95338/顺丰销售发"回单返回到方地址维护申请"
   （到方地址=莱克勒 范蓓蓓 15190535163 常州市金坛区德城路99号），并协查历史 4 张误投回单去向、重新派送。
   平台侧：步骤弹窗回单块改为"回单返回：顺丰自动返回（同 SF106 回单号，反向+到付）——需维护到方地址"
   + 一键复制维护申请文案（2-order/3-list `signBackInfoEl`）
   ✅ **2026-10-08 用户定案：该块已整块撤除**——用户确认①顺丰账号侧「回单返回到方地址」已维护为
   莱克勒 德城路99号（顺丰侧固定值）、②4 张历史误投回单已结案 ⇒ 平台侧不再需要"申请维护"（否则每张新单都会带一份
   过期诉求）。改动：2-order/3-list 删掉申请文案 + 「复制到方地址维护申请」按钮 + **硬编码的 4 个历史
   误投单号**，也不再拉取 `GET /api/signback_addr`；弹窗该块只留信息——
   标题「回单返回：顺丰自动反向 + 到付（同 SF106 回单号）」，正文「回单运单号+原运单+DN / 返回方式
   （签收后顺丰自动反向、运费到付返回莱克勒 金坛区德城路99号）/ 平台打印（主面单+反向回签单同一 PDF
   随货走；实物回单到达后人工置「已回单」）」；**平台侧不保留任何到方地址配置/接口**（用户 2026-10-08 口径：
   地址固定、无维护动作 ⇒ 见下"固定值收尾"条目）
   （脚本：`_edit_signback_ui.ps1`、`_deploy_signback_ui.sh`、`_verify_signback_ui.sh`；
   暂存源 `/home/sysadmin/fahuo-sbui`：2-order.js / 3-list.js / 0_README.md；纯静态改动，无需重启服务）
   ✅ **2026-10-08 续（同一口径收尾；用户原话「到方地址就是固定的，不需要提示维护」）：平台侧不留任何"维护"机制**
   ——撤除 `carriers/sf_express.py` 的 `SIGN_BACK_ADDR` 常量、`server.py` 的 `GET /api/signback_addr` 路由与
   `_signback_addr()` 方法（全盘 grep /var/www + /home/sysadmin 确认无调用方）、前端注释里的"备查"指向；
   本次含 Python 改动 ⇒ 需重启 fahuo-api（脚本：`_edit_signback_fixed.ps1`、`_deploy_signback_fixed.sh`）
   **回单修复状态清单（截至 2026-09-29 更正）**：
   - ✅ 已修复并实测：`isSignBack=1` 下单 + 回单号存档 `order_resp.sign_back_no`；回单运单追踪
     （**2026-09-29 用户定夺：对新单生效**）：created_at ≥ 2026-09-29 的订单回单运单终态只写提示
     `order_resp.sign_back_final` + 审计 SIGNBACK-FINAL，**不自动置 returned**——终态可能是错误地址
     签收，实物核实到达莱克勒后人工置 returned（PUT）；历史单维持自动置不回溯；已提示过的单停查
     省接口；步骤弹窗回单块原含一键复制"到方地址维护申请"（signBackInfoEl）——已随 2026-10-08 撤除
   - ✅ **已修复（2026-10-08 官方参数）**：反向回签单合并出纸**重新启用**且版式正确——`documents[].backWaybillNo`
     实锤=反向回签单（收寄互反/到付/「关联主运单」回链）；前端传 `back_no`、服务端 `back=True`；
     `with_optional=1`/`optional_no` 旧参保留兼容（语义同 back_no）。历史：09-30 曾因只试
     `masterWaybillNo` 得正向 POD 联而撤回（见上 10-08 终定）
   - ✅ **到方地址＝顺丰侧固定值（2026-10-08 用户口径终定）**：回单返回段（SF106 反向+到付）派送到方地址
     恒为莱克勒本部（莱克勒喷嘴系统（常州）有限公司 范蓓蓓 15190535163 / 江苏常州金坛 德城路99号
     （邮编 213200），与寄件人 `_SENDER` 同源）——**顺丰账号侧已设定完成、地址固定不变、无需任何维护**。
     丰桥下单接口**无**到方地址下发字段（extraInfoList POD 实测 S0003 拒）；据此平台侧相关机制全部撤除：
     前端"需维护到方地址"提示 + 一键复制维护申请文案（2026-10-08 先撤）、`carriers/sf_express.SIGN_BACK_ADDR`
     常量与 `GET /api/signback_addr` 接口（同日撤除；全盘 grep 确认无调用方，属死代码）
   - ✅ 已闭环 2026-10-08（原 ❌ 待办，外部依赖顺丰侧，用户确认已完成）：**回单返回"到方地址"账号侧设定**——
     历史动作＝把平台维护申请文案发 95338/顺丰销售（2026-09-29；该文案与复制按钮已于 2026-10-08 撤除）；
     回单收不到的真正根因＝账号侧到方地址未维护，现已设定为固定值；协查历史 4 张误投回单
     （SF1064982980091/SF1064982958300/SF1064983709198/SF1064997481417）重新派送——**已结案（2026-10-08 用户确认）**
      ⏳ 遗留可选项（同一批次口径，待用户定夺）：`server.py` `SIGN_BACK_MANUAL_SINCE`（2026-09-29）
      新单回单运单终态"不自动置 returned、只写 `order_resp.sign_back_final` 提示"——误投根因已消除，
      是否恢复自动置 returned 未定；实物回单是否已返还仍以人工核实为准
   - ⏳ 待验证：remark（需纸质回单/需拍照回传）在**主单** fm_76130 模板是否打印（**POD 签收联已实证打印**：
     #557 回单联备注区含"DN：8260034649 SO：12600537 需纸质回单/需拍照回传"）；
     实物回单到达莱克勒=最终闭环标志
- 前端 UI：拍照回传仅选顺丰时可勾选（其他承运商禁用+强制取消）

### 顺丰增值服务产品表（serviceList；官方《增值服务产品表-20260924164208.pdf》扫描件转录）

下单报文增值服务统一走 `serviceList:[{"name":<SERVICECODE>,"value":...,"value1":...,"value5":...}]`；
备注"参考IN67样例"= 照 IN67 报文形态改 name/value。原文扫描件列宽截断处以 … 标记。

| 名称 | SERVICECODE | 说明 | 备注 |
|---|---|---|---|
| 基础保 | INSURE | value为基础保的保价，声明价值以原寄地所在区域币种 | 参考入参 `"serviceList":[{"name":"INSURE","value":"5…` |
| 包装服务 | IN67 | wCode物料编码/联系发件网点获取；createTime取下 | 参考入参：`"serviceList":[{"name":"IN67","value5":"{…` |
| 定时派送(指定时段) | TDELIVERY | value为派送日期（格式：yyyy-MM-dd）；value1为派 | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 委托取件 | IN10 | value 委托类型：1、保密；2、带函；3、保密+带函 | 参考入参：`"serviceList":[{"name":"IN10","value":"1"]…` |
| 签单返还(纸质回单) | IN03 | 签单返回下订单时不需要下发IN03，此处说明仅用于费 | 下发按如下字段下发 isSignBack 是否返回签回单（签… |
| **拍照回传** | **IN91** | **value为图片类型 13：签回单拍照（固定传值）**，valu… | 参考入参：`"serviceList":[{"name":"IN91","value":"13…` |
| 原产地证代办 | IN61 | Origin Certificate Agency | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 进口报关 | IN07 | Import Declaration | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 稽核服务 | IN57 | Banquet Auditing | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 打印服务 | IN79 | Print Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 代收货款 | COD | value为货款，以原寄地所在区域币种为准，如中国内地 | 参考入参：`"serviceList":[{"name":"COD","value":"3.2…` |
| 派件地址变更服务 | IN88 | Receiver Address Modification | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 安装服务 | IN103 | value1传值：送装一体传SIGH，送装分离为空 value5… | `value5:"{"serviceItemInfos":[{"count":1,"cusServiceC…` |
| 大件入户 | IN98 | Large-size To-door | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 送货上楼 | DOORTODOOR | Delivery Upstairs | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 送货服务 | IN74 | Delivery Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 提货服务 | IN73 | Cold Chain Retrieval Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 装卸服务 | IN65 | Loading and Unloading Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 挂号 | IN66 | Registered | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 国际电商专递操作费 | IN96 | E-Commerce Express Handling Fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 顺丰国际小包平邮处理费 | IN94 | E-Parcel Unregistered Handling Fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 密钥认证 | IN59 | Value: 1.口令 2.身份证 3.口令/身份证（李家成 2021-1… | 参考入参：`"serviceList":[{"name":"IN59","value":"3",…` |
| 验货服务 | IN52 | value 格式样例: [{"optId":1}]optId 只支持1,2,3 且不能… | 参考入参：`"serviceList":[{"name":"IN52","value":"[{…` |
| 保单配送 | IN87 | Insurance Policy Delivery | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 票据专送 | IN99 | Bill Delivery | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 超长超重附加费 | IN23 | Overweight and Oversize | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 特殊入仓 | IN102 | Special Warehousing | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 特殊出仓 | IN80 | Special Warehouse-out | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 撤展服务 | IN60 | Exhibition-exit Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 集报散派 | IN95 | Break-bulk Direct | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 资源调节 | IN100 | Resource Allocation Fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 燃油附加费 | IN15 | Fuel Surcharge | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 丰巢自寄优惠 | IN113 | Hive Box Shipping Discount | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 定时派送(等通知) | IN04 | Fixed Time Delivery (Upon Notification) | 参考入参：`"serviceList":[{"name":"NOTICE"}] ]` |
| 散单代收服务 | XCOD | value为货款，以原寄地所在区域币种为准，如中国内地 | 参考入参：`"serviceList":[{"name":"XCOD","value":"1…` |
| 木质包装 | IN31 | Wooden Packaging | 木质包装 |
| 国际住宅附加费 | IN38 | Residential Surcharge | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 基础保（高价值） | IN21 | SPP (High-value) | 基础保（高价值） |
| 国际偏远附加费 | IN16 | International Remote Surcharge | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 快运到付现结优惠 | IN109 | Paid-by-receiver Shipment Discount (Cash) | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 宅配延伸 | IN116 | value 是宅配规则id，value1是宅配名称，value2是每 | 参考入参：`"serviceList":[{"name":"IN116","value":"2103…` |
| 准时宝 | IN121 | Timely Delivery Guarantee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 参展服务 | IN123 | Exhibition Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 丰巢超重费 | OS04 | Hive Box Overweight Fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 货物保管 | CARGOSAFEKEEPING | Shipment Storage | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 医药温控服务 | IN130 | Temperature Tracing (Offline) | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 温度追溯（实时） | IN131 | Temperature Tracing (Real-time) | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 超额现结费 | OS09 | Overpayment fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 升舱服务 | IN132 | Upgraded Aviation Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 自取件 | IN09 | 自取件 | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 标准化包装服务 | IN14 | Standard Packaging Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 指定时间派送 | IN11 | Fixed Time Delivery | 指定時間派送 |
| 保价（台湾） | IN25 | SPP (Taiwan) | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 资源调节费 | IN104 | 资源调节费 | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 入仓垫付费 | OS03 | Warehouse-in Advanced Payment Fee | 入仓垫付费 |
| 税金代垫服务费 | IN110 | Tax Advanced Payment Service Fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 直派服务 | IN139 | Direct Delivery Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 出口报关 | IN137 | Export Declaration | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 收件微派 | OS11 | Micro Pickup | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 派件微派 | OS12 | Micro Delivery | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 产品优惠 | OS06 | Product Discount | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 乡村达 | IN127 | Instant Push of Code Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 加急派送 | URGENT | Urgent Delivery | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 其他服务（新） | IN200 | Other Charges（New） | `value5:"{"exts":[{"vasCodeSub":"IN200-0257","vasC…` |
| 打包服务 | IN142 | Package Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 溯源服务 | IN141 | Traceability Service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 丰卡速通 | IN143 | Card Activation | 丰卡速通 |
| 到齐再派 | IN144 | value 传值批次号（多订单统一派送的批次号）定义规… | 分仓场景参考入参：`"serviceList":[{"name":"IN144","v…` |
| 部分拦截 | IN146 | Partial Interception | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 电子回单 | IN149 | name：服务代码，固定为 IN149；value：2 使用后台… | `"serviceList":[{"name":"IN149","value":"3","value1":…` |
| 惊喜送达 | IN150 | Surprise express | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 磁检服务 | IN140 | Cargo Magnetic Inspection | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 专人专送 | IN151 | Hand Carry Serivce | 专人专送 |
| 仓储方案服务 | TMP777728 | Warehouse solution service | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 仓储集收操作费 | TMP777727 | Warehouse collection fee | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 尚派服务 | IN153 | Customized Delivery | 参考增值服务IN67样例，修改name值为对应的SERVICECODE |
| 木质包装拆除 | IN152 | Wooden support removal service | value值需要拆包装的数量，参数示例：`"serviceList":[{"…` |
| 检测服务 | IN155 | Testing Service | 检测服务 |
| 偏远附加费(收方偏远) | IN156 | Remote Surcharge (Recipient) | 偏远附加费(收方偏远) |
| 偏远附加费(寄方偏远) | IN157 | Remote Surcharge (Sender) | 偏远附加费(寄方偏远) |
| 按需达 | CP0029 | Delivery On Demand | 按需达 |
| 定额保 | IN160 | value为定额保的价格等级（500,1000,2000,5000,100… | 参考入参 `"serviceList":[{"name":"IN160","value":"50…` |
| 足额保 | IN159 | value为足额保的保价 | 参考入参 `"serviceList":[{"name":"IN159","value":"20…` |
| 惠转退 | IN158 | 惠转退 | 参考入参：`"serviceList":[{"name":"IN158"}] ]` |
| 换货服务 | IN161 | value1为首次下单的运单号 | `"serviceList": [{ "name": "IN161", "value1": "SF1160…` |

> 原表另有以下名称但**未提供 SERVICECODE/说明**（扫描件空行，暂不可用）：偏远自取附加费、顺丰护卫、
> 高速费/停车费、国际代收税金、云转、包裹操作费、赔偿款返还、国际处理费、特货服务、大件保价、
> 夜收服务费、派收一体服务、一对一急收。

> 2026-09-24 清理：一次性历史探针脚本已批量删除（本地+服务器），仅保留本文引用的
> `_sf_in91_probe.py`（IN91 通道验证）、`_sf_signback_route_probe.py` / `_sf_signback3_probe.py` /
> `_sf_type12_contrast.py`（09-23 事故证据链）；服务器残留的明文凭据旧脚本 `SF.txt` 一并删除。
> 2026-09-29 归档：`_sb_update_probe.py`（改单接口边界数据；其"需人工改单"前提已作废，见"回单逻辑终定"）、
> `_sb_pages.py`（回单面单 PDF 逐页提取——#557 实证当时口径（masterWaybillNo）下仅 1 页 POD 签收联、
> 备注区已打印"需纸质回单/需拍照回传"；**2026-10-08 已改按 backWaybillNo 口径复现**：见下 `_sb_back_probe.py`）、
> 2026-10-08 归档：`_sb_back_probe.py`（**反向回签单取得终定实证**：同单 #557 主单 SF5148042784954 +
> 回单 SF1065010577207 —— `documents[].backWaybillNo` 口径出 1 页「1/1　回: SF1065010577207」+「关联主运单:
> SF5148042784954」+ 收=范蓓蓓/莱克勒 德城路99号 + **到付** + 寄=客户地址，与速打两联版式一致；
> 随后并入生产链路 `cloud_print_back()` → `/api/carrier/label?back_no=` → 2-order 打印自动带联）
> `_sb_routes.py`（4 张历史回单运单轨迹全节点：上海/湖州/苏州→常州金坛"已签收"，反向返回实锤证据链）。
> ⚠️ **清理事故**：`_` 前缀通配误删包入口 `__init__.py`，现网报"carriers 包缺失"（#551/so 8260034595
> 下单失败；该单 status 仍 pending、未产生运单，UI 重下即可）。已从 git 恢复并重新部署（19:01）。
> 教训：批量删除必须显式白名单，`__` 双下划线包文件绝不通配匹配。

> **2026-09-30 目录清理 + webroot 加固（本次）**
> - **本地仓库登记删除 35 个**"已从磁盘移除但仍被 git 跟踪"的文件：`carriers/__pycache__/*.pyc`（5）、
>   `_cancel_out.txt`、`_dp_back_probe{,2,3,4}.py`、`_dp_cancel_probe/test`、`_dp_final_verify`、
>   `_dp_pay_probe`、`_dp_receipt_verify`、`_dp_trace_probe`、`_dp_verify`、`_probe_cancel{,2}`、
>   `_qty_label_test`、`_qty_order`、`_sf_exptype_probe`、`_sf_limit_probe`、`_sf_parcels_test`、
>   `_sf_pod_probe{,2,3,4}`、`_sf_print2`、`_sf_product_verify{,2}`、`_sf_query_order`、
>   `_sf_reorder_test`、`_sf_signback_test`、`_sf_signback_verify`（共 29 个一次性探针）。
> - **生产依赖补入库**（此前已部署但从未提交，仓库重建会丢）：`ot_label.py`、
>   `shared/lib/JsBarcode.all.min.js`、`shared/lib/qrcode.min.js`、`shared/icon/file-type-png.svg`、
>   5 个证据探针、官方《增值服务产品表》PDF。
> - **密钥出库**：`carriers.env` 一直被 git 跟踪（含顺丰校验码 / 德邦签名密钥），已 `git rm --cached`
>   移出版本控制并写入 `.gitignore`；⚠️ **历史提交仍含旧值 → 密钥需在丰桥/德邦后台轮换**。
> - **新增 `apps/Fahuo/.gitignore`**：`fahuo.db*`、`oid.seq`、`carriers/.db_logistic_seq`、`carriers.env`、
>   `Upload/`、`ShippingPhotos/`、`shipphotos.json`、`__pycache__/`、`*.pyc`、`shared/fonts/`（版权字体随包部署）。
> - **现网删除**：`__pycache__/`、`carriers/__pycache__/`（7 个 .pyc，运行时自动重建，无需重启）。
> - **安全事件（发现并修复）**：nginx `location /apps/ { try_files $uri $uri/ =404; }` 把应用目录当静态根，
>   实测 `/apps/fahuo/carriers.env` → 200 **真实密钥**，`fahuo.db`、`backup/*.db`、`server.py`、`0_README.md`
>   同样可下载；其他应用同缺陷（`/apps/po-closing/.env`、`poclose.db`、`/apps/ctms/user_info.txt`、
>   `toolinventory-server.db`）。修复（`7_harden_webroot.sh`，幂等）：插入
>   `location ~* ^/apps/.*\.(py|pyc|pyo|sh|env|trc|db|seq|log|md|txt|bak|orig|swp)$ → 404`、
>   `^/apps/*/(carriers|backup|install)/ → 404`、`server.js → 404`；`carriers.env` 权限收紧 600。
>   只拦代码/密钥/数据类扩展名，前端实际抓取的 `.js/.css/.json/.xlsx` 一律放行
>   （`shipphotos.json`、`stock.json`、`catalog.json`、`media.json`、`drawings.json`、信息表.xlsx 均正常）。
>   `.txt` 也拦是因为 `/apps/ctms/user_info.txt` 是扫码登录凭证（用户ID/姓名）可直接下载；
>   `.csv` 暂未拦（`po-closing/po_list.csv`、`result.csv` 可能是导出下载入口）——需产品侧确认后再决定。
> - **踩坑**：`cp -a` 备份软链会把「备份软链」也落进 `sites-enabled/` → nginx 重复加载同一 vhost
>   （`conflicting server name` 警告；reload 期间旧 worker 会短暂按旧配置应答，易误判加固"失败"）。
>   备份必须 `readlink -f` + `cp -aL` 写到 `sites-available/`。
>   回滚：`cp -aL /etc/nginx/sites-available/lac.lechler.com.cn.bak-20260930-193513 \
>   /etc/nginx/sites-available/lac.lechler.com.cn && systemctl reload nginx`。
> - **验证**：`7_harden_webroot.sh` 自检 35/35 全绿（敏感 19 项 → 404、前端 15 项 → 200、接口 200）；
>   面单冒烟 8 项全绿（默认 1 页 76,952B、探针 2 页 153,510B、线上 JS MD5 与磁盘一致、服务 active）。

> **2026-10-12 现网测试文件清除 + 同步白名单规则（用户原话「直接全移除」「以后同步到服务器上，
> 仅同步必须的文件，所有的测试都不要同步」）**
> - **现网删除 9 个证据探针**（`carriers/_*.py`：`_sb_back_probe` / `_sb_pages` / `_sb_routes` /
>   `_sb_update_probe` / `_sf_in91_probe` / `_sf_signback3_probe` / `_sf_signback_route_probe` /
>   `_sf_type12_contrast` / `_label_marks_probe`）+ `carriers/__pycache__` 字节码；
>   探针**仅存本地仓库**作证据存档（README 各处引用的是存档记录，复现跑本地副本）；
>   删除前已 tar 备份到 `/home/sysadmin/fahuo-sbdate-clean-backup-<ts>/probes.tgz`。
> - **同步白名单规则**：`apps/SSH/excludes.conf` 新增 `_sb_*` `_sf_*` `_dp_*` `_label_*` `_smoke_*`
>   `_verify_*` `_deploy_*` `_edit_*` `_pick_*` `_consult_*` `*_probe*` 排除模式——
>   命名约定：测试/探针/一次性脚本一律**单下划线 `_` 开头**，生产文件绝不以此开头
>   （`__init__.py` 双下划线不受影响，已本地 tar 实测验证排除集不含生产文件）。
> - 保留项（非测试）：cron 依赖 `5_scan_shipphotos.sh` / `6_backup_db.sh`，ops 脚本
>   `1_install-api.sh` / `4_mount_shipphotos.sh` / `7_harden_webroot.sh`，生产模块
>   `ot_label.py` / `carriers/cli.py`（server.js 子进程入口）/ `.db_logistic_seq`（德邦计数，勿删）/
>   官方《增值服务产品表》PDF（serviceList 取值依据）/ `audit.log`（审计）/ `server.js`（开发镜像）。
> - 同批上线：顺丰**回单运单签收日期**提取与显示（`sign_back_date`，见上"回单运单追踪"段）。

> **2026-10-12 顶部栏标签图标按钮（用户规则「右上设置的左边添加一个标签样式的按钮」，
> 确认=图标按钮）**：5 页统一在「设置」左侧插入 feather tag 图标按钮（title=标签，
> 与既有图标按钮同款 `btn icon-btn` 样式，stroke-width 1.8 对齐设置齿轮）。
> ✅ **同日接线（用户规则「复制 Label 到 Fahuo、读取 readme、迁移所有功能如端口、
> 按钮连接到 label 的 index.html」）**：`apps/Label`（SAP 标签管理平台：DN→客户→模板→
> 预览→打印→历史，含访问口令 1879）整体并入 `Fahuo/label/`——
> - **前端**：静态文件原样迁移（index/designer.html + css/js/assets + readme.md）；
>   `label-core.js` API 基址改为 fahuo-api（`:8091 /api/label/*`，候选：nginx 反代
>   `/apps/fahuo/api/label` → 同源 `../api/label` → 直连 `:8091/api/label`）；
>   标签按钮经 `shared/topbar.js` 统一接线 → `../label/index.html`。
> - **后端**：原独立 Node `server.js :8092`（label.service）**退役**，整库读写 API 原样
>   并入 `server.py`：`GET /api/label/health`、`GET/PUT /api/label/db`
>   （整库读组装 / 事务清写缺省分表不变 / 每天首写备份保留 7 份，语义与 Node 版一致）；
>   **数据库不动**，沿用 `/opt/label/data/label.db`（fahuo-api 以 root 直读直写）。
> - **退役清理**：`label.service` stop+disable；nginx `label unified-entry` 块
>   （`/apps/label/api/ → 8092`）移除并 reload；旧 webroot `/var/www/lnsc-apps/apps/label`
>   tar 备份后删除；`apps.conf` label 行注释；`excludes.conf` 新增
>   `label/server.js`、`label/import-customers.js`、`label/data`（不进 webroot）。
> - `import-customers.js`（客户 xlsx → customers 表导入工具）仍可对 `/opt/label/data`
>   直接使用（Node 一次性运维脚本，本地留存）。
> - ✅ **同日再升级（用户规则「label移除密码验证」「整个页面嵌入在fahuo主页面里，像录单
>   一样，就显示在页面的中间位置」）**：label 访问口令门（1879 前端拦截）**整段物理删除**；
>   新增 **`pages/6-label.html`** 为页面族第 ⑥ 员，中间区以 **iframe**（`.label-frame`，
>   `.main.label-main` 两行 grid 吃满 1fr）整页嵌入 `label/index.html`——iframe 隔离 label
>   自有 CSS/JS（`$` 助手、全局样式）与主站冲突；标签图标按钮改跳 `6-label.html`。
>   ⚠️ **入口口径当日三翻转终定（用户规则「左侧添加标签按钮，页面就是label，页面的尺寸
>   与其他页面保持一致。移除右上标签图标的按钮」）**：左侧导航加回「标签」块（⑤ 号位，
>   追溯撤后顺移；6-label 本页 active，页壳与其余页面同尺寸同布局）；
>   **右上标签图标按钮全撤**（topbar.js 接线同步移除）。
>   （翻转史：左上加 → 撤左改右上 → 终定回左上+撤右上）
> - ✅ **同日内容区尺寸对齐（用户规则「标签页面的中间主内容区域的尺寸与其他页面保持
>   一致」）**：label 外壳原设计「内缩 14px + 限宽 1360px 居中」——`label/css/style.css`
>   `#label-app` 改满边（margin:0 / width:100% / max-width:none / min-height:100% +
>   `html,body{height:100%}`），iframe 内内容区与其他页主内容区同尺寸。
> - ✅ **2026-10-13 标签页两件修复（用户反馈核实）**：①右上 API 状态点恒灰——本页无独立
>   JS，各页 `markApi` 均由页面 JS 调用、本页无人调用 → 页尾补内联探测脚本（口径同
>   `3-list.js`：候选 `../api` → 直连 `:8091`，`/stats` 探测点亮）；②设置齿轮图标
>   显示不全——建页时手抄 SVG 路径笔误（`...1-2 2 2...` 应为 `...1-2-2 2...`，齿轮弧度
>   方向错），整行换回与 1-entry 逐字符一致的齿轮 SVG。
>   ⚠️ 配套教训：**新建 `pages/*.html` 一律 LF 无 BOM**（本次修复经 PowerShell
>   `WriteAllLines` 误落 CRLF，已归正；行尾不一致会让 grep 行级比对假阳性失败）。
> - ✅ **2026-10-13 页签样式对齐（用户规则「标签页面的标签设计和模板管理像下单页面
>   左上侧的承运商选项一样的UI位置和效果」+ 截图终态）**：`label/css/style.css` 的
>   `.tab` 全面对齐下单页承运商按钮 `.pw-cb`——高 30px / 2px 主题色描边 / 8px 圆角 /
>   17px 800 / **白底非选中、主题色反白选中**（原实心主题色+深底选中废止）、间距 8px；
>   位置本就在外壳 `.app-bar` 左上（页签左/操作右），不动。
>   同补：`label/index.html` 的 style.css 链接加 `?v=` 破缓存（iframe 内 CSS
>   缓存顽固，防用户端看不到新样式；窄窗口 ≤820px 有媒体查询紧凑覆盖，宽屏不受影响）。
>   同补②（用户规则「位置靠近」）：页签与下方内容板纵向间距 20px → **6px**
>   （`.app-bar` 底距 8→2 + `#main` 顶距 12→4，对齐下单页承运商按钮与面单间距）；
>   版本号 `?v=20261013b`。
>   同补③（用户规则「标签设计和模板管理的高度与中间的设计区域等高」）：
>   高度链 `#label-app`（flex 列）→ `#main`（flex:1）→ `.view`/`#designer-host`（flex:1）
>   → `.label-designer`/`.ld-grid`（flex:1）全部打通——**两个视图纵向撑满 iframe 中间区**，
>   模板管理表格卡同满；独立 designer.html 不受影响（body 非 flex 时 flex:1 退化 auto）；
>   版本号 `?v=20261013c`（style + designer 双 CSS）。
>   ⚠️ **缓存链实证补丁（用户截图反馈「高度一致」→ 核实为三栏高度不齐）**：外层 Ctrl+F5
>   **不清 iframe 文档缓存**——旧 `label/index.html`（?v=b + 无版本 designer.css）继续引旧
>   CSS，「等高」规则不生效、三栏按内容自然高度排列（左栏矮于中栏）；页签样式在 v=b 已进，
>   造成「部分新部分旧」假象。修复：`6-label.html` 的 **iframe src 也加 `?v=`**
>   （此后改 label 任意资源，三级版本号同步升：iframe src → index.html → 两个 CSS 链接）。
> - ✅ **2026-10-13 页签改左侧竖轨（用户规则「标签设计 和模板管理 2个按钮的高度与中间的
>   设计区域外框等高」+「双方上边的高度相同」）**：两按钮从顶部横排改为**左侧竖排**
>   （仿主站左侧导航）——外壳重构 `.app-bar`（仅操作按钮右置）+ `.lb-body`（flex 行：
>   `#lb-rail` 竖排 `#tabs` + `#main`），按钮保持承运商样式（2px 描边/白底/选中反白/
>   8px 圆角/17px 800），宽 112px、**各 50% 高、合计与外框同高、顶边与外框顶边对齐**；
>   窄屏 ≤820px 回落顶部横排；全资源版本号 `?v=20261013d`（iframe src + 双 CSS + 三 JS）。
>   ⚠️ **缓存根治（用户截图「这个布局」= 竖轨前的旧布局）**：浏览器对 HTML 文档启发式缓存
>   使旧 iframe 文档持续命中（强刷/导航不重验证）——nginx 新增 `fahuo-html-nocache` 块
>   （幂等）：fahuo 全部 `.html` 强制 `Cache-Control: no-cache, must-revalidate`
>   （curl -sI 已实证；css/js 本就有 no-store，无影响；reload 期间旧 worker 会短暂按旧配置
>   应答，验证需等 worker 切换）。此后页面任何改动，普通刷新/导航即达，不再依赖 Ctrl+F5。
>   ⚠️ **布局终定（用户原话「完全理解错误，2个按钮与左侧的文本 条码等 是同一列，布局像
>   下单页面的左侧一样」——此前的「竖轨」理解作废并回退）**：`designer.js` 左栏改
>   `.ld-leftcol`（页签行 + 组件面板一列），`script.js` 挂载后把 `#tabs` 从 `.app-bar`
>   **移入左列顶端**（组件面板正上方，同下单页左侧承运商按钮行；按钮 flex:1 等宽、
>   承运商样式不变，面板 flex:1 与中栏同高、双方上边对齐）；竖轨版 `.lb-body/#lb-rail`
>   全部撤除；版本号 `?v=20261013e`。
> - ✅ **2026-10-13 移除两按钮（用户规则「移除标签设计和预览2个按钮」）**：
>   ①「**标签设计**」页签——设计视图是默认主视图、页签冗余，`#tabs .tab[data-view=designer]`
>   隐藏，仅留「模板管理」钮且**兼任返回**（`go()` 单钮往返：点当前页签=切回设计视图）；
>   ②「**预览**」操作按钮——中栏已有内嵌打印预览、弹窗冗余，`ld-preview` 不再上移到
>   `.app-acts`（留在隐藏工具栏内）；版本号 `?v=20261013f`。
> - ✅ **2026-10-13 模板管理钮移位（用户规则「模板管理 按钮移到 导出 的左边」）**：
>   `#tabs` 改移入 `#app-acts` **首位**（右上操作行最左，导出左边；左列只剩组件面板）；
>   `.tabs/.tab` 基础样式直接生效（横排 8px 间距、承运商规格不变），单钮往返兼任返回不变；
>   左列页签专则清理；版本号 `?v=20261013g`。
> - ✅ **2026-10-13 操作行四钮图标化（用户规则「这4个都用图标代替」+ 截图）**：
>   模板管理（feather **layers**）/ 导出（**download**）/ 导入（**upload**）/ 保存（**save**）
>   全部文字换 SVG 图标（stroke=currentColor 18px，title+aria 保留原名悬停；
>   保存保持 btn-primary 实心高亮）；独立 designer.html 工具栏同步尺寸；版本号 `?v=20261013h`。
> - ✅ **2026-10-13 图标行间距加大（用户规则「4个图标与下部内容间距加大」）**：
>   `.app-bar` 底距 2→10px + `#main` 顶距 4→6px，操作行与下方内容合计间距 **6px → 16px**
>   （前史：20px→6px「位置靠近」→ 16px）；style.css 版本号 `?v=20261013i`（JS/另一 CSS 未动）。
> - ✅ **2026-10-13 图标去框去影 + 最大化（用户规则「移除图标外框和阴影 图标最大化显示」）**：
>   4 钮（模板管理/导出/导入/保存）`border:0` + `box-shadow:none` + 背景透明
>   （**选中页签与保存仍实心示意状态**），图标 **18→24px**、按钮内边距收窄让图标占满；
>   版本号 `?v=20261013j`。
> - ✅ **2026-10-13 尺寸卡片下划线减淡（用户规则「尺寸里面的横线 减淡显示」）**：
>   `designer.css` `.ld-spin input` 下划线 **#006878 → #9fc4c9**（浅青，与标尺刻度同色；
>   右栏尺寸卡片宽/高步进器输入）；版本号 `?v=20261013k`。
> - ✅ **2026-10-13 预览放大 + 悬停缩放（用户规则「中下位置的预览视图 当鼠标放上去的时候
>   可以实现缩放。同时默认载入也放大化显示」）**：`fitPreview` 由「只缩不放大
>   `Math.min(1,…)`」改为**允许放大至 2× 填满预览区**（默认载入即放大化）；
>   悬停再在 fit 基础上**放大 1.6×**（`.ld-preview-stage` overflow:hidden 裁剪 = 放大镜，
>   `.18s` 过渡平滑缩放，移出还原）；版本号 `?v=20261013l`。
> - ✅ **2026-10-13 默认创建模式 + 保存强校验（用户规则「标签页面载入的时候 默认是标签创建的
>   模式，显示基本模板，公司代码和名称为空，当保存的时候要求必须输入 公司代码 和名称」）**：
>   ① `mount()` 不再自动载入首个模板——默认进入**标签创建模式**：基本底版
>   `BASE_ELEMENTS`（100×50mm 工业简洁版式）+ 公司代码/名称留空（指定 `_pendingCode`
>   打开特定模板的路径保留）；② `save()` 强校验：**公司代码必填**，且必须在
>   `customers` 客户基本数据库中**查到对应名称**（查不到=名称空，拦截并聚焦输入框）；
>   版本号 `?v=20261013m`。
> - ✅ **2026-10-13 预览滚轮缩放（用户规则「通过鼠标实现放大缩小」）**：中下打印预览区
>   滚轮无级缩放——以 fit 倍率为基准 **0.3×~4×**（上滚 ×1.15 放大、下滚 ÷1.15 缩小，
>   `preventDefault` 防页面滚动，倍率保持不回弹；取代前版悬停固定放大 1.6×）；
>   版本号 `?v=20261013n`。
> - ✅ **2026-10-13 整页适配一屏（用户规则「标签页面的内容高度与下单页面的中间内容高度
>   一致」+ 确认「内容超出一屏：iframe 出现内部滚动条，要压缩适配到一屏内」）**：
>   中栏舞台/打印预览由固定 357px 改**弹性均分**（`flex:1 1 0`、min-height 放开，
>   空间不足可收缩）；`.ld-grid` 子项清 `min-height` 防内容最小高度撑破行高；
>   左组件面板/右属性面板超高改**内部滚动**（overflow-y auto）；`inlinePreview` 补
>   首帧重试（弹性高度布局前 clientHeight=0 时下一帧重算 fit）——**iframe 级滚动条消除，
>   内容高度=下单页中间内容高度**；版本号 `?v=20261013p`。
> - ✅ **2026-10-13 底部状态条移除（用户规则「移除 9 个元素 · 100 × 50 mm
>   拖动吸附对齐 · Delete 删除选中 · Esc 关闭弹窗」）**：中栏底部 `.ld-status`
>   （元素计数 / 尺寸 / 操作提示）整段摘除——SHELL 模板移除该 div（`ld-st-count`/
>   `ld-st-size` 更新点本为 null 安全，无副作用），中栏上下区随之分得更多高度；
>   版本号 `?v=20261013q`。
> - ✅ **2026-10-13 预览区加高（用户规则「预览区域的高度太低」）**：中栏「舞台:预览」
>   弹性比 **1:1 → 2:3**（打印预览占 60%；fit 与滚轮缩放按新高度自动重算）；
>   版本号 `?v=20261013r`。
> - ✅ **2026-10-13 设计区与预览区等高（用户规则「设计区与预览区 等高」）**：
>   弹性比 **2:3 → 1:1**（各 50%；前版预览 60% 作废回摆）——舞台与预览严格同高；
>   版本号 `?v=20261013s`。
> - ✅ **2026-10-13 顶部栏位置对齐（用户规则「位置粗乱」）**：`.app-bar` 改为 `align-items: center`，
>   `.tabs` / `.app-acts` 全部 `align-self: center` 且 `align-items: center`，取消 `padding-top: 10px`；
>   操作图标钮统一 `height: 30px` 与页签同高，内边距收窄；页签图标-only 横向内边距 12px → 8px；
>   版本号 `?v=20261013t`。
> - ✅ **2026-10-13 页签显示完整文本（用户规则「文字没有完全显示 这里是完整显示文本」）**：
>   恢复「标签设计」页签显示，模板管理页签改回文字「模板管理」（不再用图标）；
>   两页签均保留 2px 主题色描边白底，横向内边距 8px → 18px 保证完整显示；
>   移除单钮往返逻辑（现在直接点对应页签切视图）；版本号 `?v=20261013u`。
> - ✅ **2026-10-13 基本标签 LOGO 左侧竖线左移（用户规则「基本标签的LOGO左侧的竖线 离LOGO再远些」）**：
>   `BASE_ELEMENTS` 中右侧分隔线 `rsep` 的 x 坐标由 `88.5` 调整为 `86`（线宽 0.5，LOGO 旋转后左边界约 90.5，
>   间距由约 1.5mm 增至约 4mm）；版本号 `?v=20261013af`。
> - ✅ **2026-10-13 模板管理与清单列表分页（用户规则「模板管理和清单 使用分页功能」）**：
>   模板管理视图与清单模式均增加统一分页条：每页 10/20/50/100 可选，默认 50，显示「当前页 / 总页数」，
>   上一页/下一页按钮自动禁用；搜索/筛选时重置到第 1 页；版本号 `?v=20261013ag`。
> - ✅ **2026-10-14 移除分页功能（用户规则「移除分页功能」）**：
>   回退模板管理与清单模式的分页改动，恢复为完整列表显示（仍保留前 200 条提示）；
>   移除 `.tpl-pager` / `.lm-pager` 相关 HTML/JS/CSS；版本号升级到 `?v=20261013ai` 以刷新缓存。
> - ✅ **2026-10-14 右栏线条统一优化（用户规则「统一并优化里面的线条」「下划线或单元框的线」）**：
>   公司代码/名称输入框由隐藏下划线改为可见浅青下划线 `#9fc4c9`；DN 输入框下划线由深青 `--ld-brand` 改为浅青 `#9fc4c9`；
>   属性面板等通用输入框边框由灰 `--ld-line` 改为浅青 `#9fc4c9`；所有下划线/单元框线颜色统一，聚焦时统一变深青 `--ld-brand`；
>   版本号 `?v=20261013aj`。
> - ✅ **2026-10-14 DN 区域增加高度（用户规则「DN 区域增加高度」）**：
>   `.ld-dncard` 上下内边距由 `14px 10px` 调整为 `18px 16px`，并增加 `min-height: 64px`，
>   使 DN 输入卡片更高、更便于点击/输入；版本号 `?v=20261013ak`。
> - ✅ **2026-10-14 DN 图标变大（用户规则「DN里的图标也变大」）**：
>   生成按钮由 `36×36` → `44×44`，图标由 `20px` → `24px`，圆角由 `8px` → `10px`；
>   版本号 `?v=20261013al`。
> - ✅ **2026-10-14 右栏输入框统一为横线显示（用户规则「都以横线显示，不要框，横线格式参考录单里的横线」）**：
>   公司代码/名称、尺寸、DN、属性面板所有输入框由单元框改为 1px 下划线（参考录单 `.fld` 样式），
>   颜色统一为 `--ld-line-inner: #85b7be`，聚焦时变深青 `--ld-brand`；版本号 `?v=20261013am`。
> - ✅ **2026-10-14 加大右栏 4 块间距（用户规则「加大4块 的间距」）**：
>   `.ld-right` 上下间距由 `12px` 调整为 `20px`；版本号 `?v=20261013an`。
> - ✅ **2026-10-14 DN 驱动标签打印 + 打印时输入（用户规则「核心功能…等确认后再生成功能」「可以多个，不回写，数量取自DN，UI可以弹出，要大，可能与中间的设计与预览一样大，在弹窗页面同意显示」）**：
>   - 文本元素新增 `promptAtPrint` 属性，设计器属性面板可勾选「打印时输入」；
>   - 点击 DN 卡片「生成」打开大尺寸弹窗（`ld-modal-box-dn`，宽约 1100px，高约 90vh），
>     左侧显示 DN 物料明细（物料编号/描述/数量/份数，均可编辑，单独打印按钮），右侧显示标签预览，
>     `promptAtPrint` 字段在预览上直接渲染为可编辑输入框（参考录单下划线样式）；
>   - 支持按份数重复打印、全部打印；SAP 接口未就绪，当前使用 mock 物料数据；
>   - 版本号 `?v=20261013ao`。
> - ✅ **2026-10-14 下单明细表增加备注列（用户规则「下单模块的下方明细表中增加备注列」）**：
>   打单列表表头/列宽/数据行新增「备注」列，显示纯备注（剥离入库拼接的 PO/采购员/发件人/附件 标签，与清单页 `cleanNote` 一致）；
>   `2-order.html` 的 `shared/style.css` 与 `2-order.js` 同步加版本号破缓存；版本号 `?v=20261013ao`。
> - ✅ **2026-10-14 下单明细表承运商/单号合并列（用户规则「这样显示，减少一列：德邦 / DPK365112500689」）**：
>   承运商与单号合并为「承运商/单号」一列，上行显示承运商，下行显示运单号（仍可点击打开步骤弹窗）；
>   表头、列宽、数据行及 `updateRowCells` 索引同步调整；版本号 `?v=20261013ap`。
> - ✅ **2026-10-14 下单明细表再减一列（用户规则「这样显示，再减少一列：德邦 > 已下单 / DPK365112500689」）**：
>   承运商/单号列并入下单状态，上行显示 `承运商 > 已下单/待下单`，下行显示运单号；
>   列数由 9 列减为 8 列；版本号 `?v=20261013aq`。
> - ✅ **2026-10-14 下单列表行高压低（用户规则「行高再低些」）**：
>   `.pw-list .order-table td` 上下内边距由 `9px` 调整为 `5px`，承运商/单号/状态两行 `line-height: 1.25`；
>   版本号 `?v=20261013ar`。
> - ✅ **2026-10-14 下单列表微调（用户规则「> 加粗显示，打印与备注列交换，备注列加宽显示」）**：
>   承运商/单号/状态列的 `>` 加粗；打印列与备注列交换（先打印后备注）；备注列宽由 10% 加宽到 14%；
>   版本号 `?v=20261013as`。
> - ✅ **2026-10-14 下单列表 esc 缺失修复（用户反馈「现在没显示了 请确认」）**：
>   2-order.js 补充 `esc()` HTML 转义函数（承运商/状态行内 innerHTML 拼接所需），修复合并列导致的列表不渲染；
>   版本号 `?v=20261013at`。
> - ✅ **2026-10-14 备注列加宽、查看列减窄（用户规则「备注列加宽 查看列减窄」）**：
>   备注列宽由 14% → 18%，查看列宽由 110px → 80px；版本号 `?v=20261013au`。
> - ✅ **2026-10-14 外协单增加上传附件（用户规则「外协单增加上传附件的功能」）**：
>   录单页外协单也显示「上传文件」按钮，附件目录键为 PO（发货单仍为首个 DN）；
>   下单页「查看」列对外协单改用 PO 查询附件（`o.so || o.po`）；版本号 `?v=20261013av`。
> - ✅ **2026-10-15 清单发货照片列加文件图标+上传+号（用户规则「清单 图片按钮的下边（同一行）加上一个文件的图标，路径指向录单上传的文件。同时文件图标的右边添加一个+的符号，点击可以实现同样的添加文件到对应的DN号的文件夹」）**：
>   发货照片列单元格改为两行：上行共享盘照片图标，下行录单上传文件图标 + 上传「+」号；
>   文件图标显示该 DN 在 `Upload/<DN>/` 的附件数量，可点击预览（图片直显/其他格式链接）；
>   「+」号点击弹出文件选择，上传到 `Upload/<DN>/` 后刷新图标状态；版本号 `?v=20261013aw`。
> - ✅ **2026-10-15 清单照片列图标同一行 + +号移入弹窗（用户规则「调整为同一行 + 号移到点击文件图标的弹窗里」）**：
>   照片图标与文件图标改为同一行并排；「+」号从单元格移到文件预览弹窗头部（「+ 上传」按钮），上传后自动刷新弹窗内文件列表；
>   版本号 `?v=20261013ax`。
> - ✅ **2026-10-15 清单上传文件点击后以预览方式展开（用户规则「点击文件图标后 以预览的方式展开」）**：
>   文件预览弹窗内每个文件以卡片形式展示：图片直接显示、PDF 内嵌 iframe、Excel 用 SheetJS 转表、Word 用 docx-preview 渲染；
>   3-list.html 引入 `docx-preview.min.js` 与 `xlsx.full.min.js`；版本号 `?v=20261013ay`。
> - ✅ **2026-10-15 清单回单日期并入下单状态列（用户规则「回单都是在签收后发生的，所以把回单日期放在已下单的下面，格式为：回单 ₂₆ 10-19」）**：
>   回单日期从独立列移除，合并到下单状态列下方；格式为「回单 <sup>26</sup> 10-19」（年份小号上标）；
>   清单列数由 11 列减为 10 列；版本号 `?v=20261013az`。
> - ✅ **2026-10-15 专车手动关闭按钮（用户规则「手动关闭按钮 路由状态的专车直送 下面添加按钮， > 送达？ 点击后 弹出关闭备注和关闭 变 已送达」）**：
>   专车订单路由状态「专车直送」下方新增「> 送达？」按钮；点击弹出关闭弹窗（关闭备注 + 关闭按钮），
>   关闭后 `route_status` 置为「已送达」，`close_note` 字段存备注；`orders` 表新增 `close_note` 列；
>   版本号 `?v=20261013ba`。
> - ✅ **2026-10-15 专车关闭按钮换行显示（用户反馈「没有换行显示」）**：
>   路由状态文本与「> 送达？」按钮改为上下两行显示（按钮独占一行）；版本号 `?v=20261013bb`。
> - ✅ **2026-10-15 新增 HELP/操作说明页面（用户规则「右上关于的左侧生成一个HELP/操作说明 的图标， 点击后新增一个HELP 页面， 内容是从录单，下单和清单的 操作说明， 图文并茂，简洁明了」）**：
>   各页标题栏「关于」左侧新增 HELP 图标按钮，点击跳转 `pages/7-help.html`；
>   HELP 页含录单/下单/清单三步操作指引（图标 + 步骤卡片 + 提示）；版本号 `?v=20261013bc`。
> - ✅ **2026-10-20 HELP 页 UI/尺寸/颜色与其他页面一致（用户反馈「完全不合适， 页面，大小，格式，各种缺少」「首先UI和尺寸，颜色上与其他页面一致， 左右2测的8个按钮要保留， 这是页面一致」）**：
>   `pages/7-help.html` 重写为与其他页面一致的布局：左侧 5 个模式导航按钮、标题栏含警告/设置/HELP/关于、右侧 5 个统计卡片；
>   中间 HELP 内容使用与其他页面相同的颜色、边框、尺寸；版本号 `?v=20261013bd`。
> - ✅ **2026-10-20 HELP 页内容加宽显示（用户规则「加宽显示」）**：
>   `.help-main` 由 `max-width: 920px` 改为 `width: 100%`，步骤卡片最小宽度由 220px 调整为 300px；版本号 `?v=20261013be`。
> - ✅ **2026-10-20 HELP 页添加界面示意图（用户规则「添加实际截图」）**：
>   录单/下单/清单三个模块各增加界面示意图（`pages/help-img/entry.svg`、`order.svg`、`list.svg`）；
>   注：服务器无 headless 截图工具，当前为线框示意图，可后续替换为真实截图；版本号 `?v=20261013bf`。
> - ✅ **2026-10-20 HELP 页移除示意图（用户反馈「截图太大 移掉」）**：
>   移除 HELP 页中三张界面示意图，恢复纯文字步骤布局；版本号 `?v=20261013bg`。
> - ✅ **2026-10-20 HELP 页步骤再详细些（用户规则「步骤再详细些」）**：
>   录单/下单/清单三个模块步骤由 4 步扩展为 6 步，补充日期与承运商、备注填写、面单预览确认、回单日期、紧急识别等细节；
>   版本号 `?v=20261013bh`。
> - ✅ **2026-10-20 HELP 页步骤每行 3 个（用户规则「help 里的步骤每行3个」）**：
>   `.help-steps` 网格由自适应改为固定 3 列；版本号 `?v=20261013bi`。
> - ✅ **2026-10-20 外协单采购员改为下拉选择（用户规则「采购员： Lan Wu (Lansing) ， Yun Liu，Weidan Gu (Nora)，Tao Zhang (Neil) 供选」）**：
>   录单页外协单「采购员」由文本输入改为下拉选择，选项为 Lan Wu (Lansing) / Yun Liu / Weidan Gu (Nora) / Tao Zhang (Neil)；
>   版本号 `?v=20261013bj`。
> - ✅ **2026-10-20 上传文件按钮再往下移（用户规则「发货单和外协单的 上传文件按钮再往下移」）**：
>   「上传文件」按钮从 `.type-box` 内部移到 `.prio-btns`（紧急按钮）下方，位置更低；版本号 `?v=20261013bk`。
> - ✅ **2026-10-20 上传文件按钮移回原框靠底显示（用户规则「上传 文件 按钮还是再原来的框里 就是靠底显示」）**：
>   「上传文件」按钮移回 `.type-box` 内部，利用 `margin-top: auto` 靠底显示；版本号 `?v=20261013bm`。
> - ✅ **2026-10-20 回单日期与专车关闭按钮改为椭圆白字（用户规则「回单 26 10-12 和 > 送达？ 背景白字显示，椭圆」）**：
>   清单「回单 ₂₆ 10-19」与下单「> 送达？」均改为椭圆徽章样式：深色背景 + 白色文字 + 圆角胶囊；
>   版本号 `?v=20261013bl`。
> - ✅ **2026-10-20 椭圆文字加粗（用户规则「椭圆再圆些 椭圆里的文字加粗显示」）**：
>   回单日期与专车关闭按钮的椭圆徽章文字加粗显示；版本号 `?v=20261013bn`。
> - ✅ **2026-10-20 录单地址检索覆盖公司名称（用户规则「录单的地址检索功能 覆盖到公司名称」）**：
>   地址池搜索过滤字段增加 `company`，输入公司名称也可匹配地址记录；版本号 `?v=20261013bo`。
> - ✅ **2026-10-20 录单地址检索补充 addr_key 全文（用户反馈「已经确定在录单 检索地址，输入公司名称 无法实现检索」）**：
>   地址池搜索过滤字段再增加 `addr_key`（完整地址含公司名），即使 `company` 字段为空也能按公司名称检索；
>   版本号 `?v=20261013bv`。
> - ✅ **2026-10-20 上传按钮整体下移（用户规则「上传的 按钮 整体 下移些」）**：
>   `.upload-btn` 上外边距由 `auto` 调整为 `20px`，按钮在原框内位置更低；版本号 `?v=20261013bw`。
> - ✅ **2026-10-20 录单发货单 SO 下添加 IS负责人 行（用户规则「录单 发货单 SO下添加一行： IS负责人」）**：
>   发货单表单 SO 下方新增「IS负责人」输入行，随订单保存到 `orders.is_owner`；版本号 `?v=20261013bx`。
> - ✅ **2026-10-20 查看列文件多时加左右箭头滚动（用户规则「上传的文件很多的情况下， 左右加上左右的箭头，用户可以点击查看没有显示出来的文件」）**：
>   下单页「查看」列文件图标改为横向滚动容器，文件多于 2 个时显示左右箭头，点击滚动查看未显示的文件；版本号 `?v=20261013by`。
> - ✅ **2026-10-21 查看列放宽显示多个文件 + 初始滚到最右（用户规则「不合适 改为向左滚动显示」「尽量放宽显示， 预览多个」）**：
>   查看列宽由 80px 调整为 200px，文件容器内宽 160px；初始滚动到最右显示最新文件，左箭头向左滚动查看旧文件；版本号 `?v=20261013bz`。
> - ✅ **2026-10-21 查看列箭头加大 + 每点一次换一页（用户规则「点击效果太差， 箭头太小， 且每点一次的偏移太小，是不是可以每点一次箭头就换页显示」）**：
>   箭头字体加大到 22px、加粗、hover 高亮；每点一次箭头滚动一整页（容器宽度），换页显示文件；版本号 `?v=20261013ca`。
> - ✅ **2026-10-21 SO/备注悬浮提示 + 备注换行（用户规则「下单页面里的列表 每格（SO和备注） 如果超过单元格宽度 当鼠标悬浮时候 需要提示显示所有的内容。同时备注可以换行显示」）**：
>   SO 与 备注 单元格加 `title` 悬浮提示显示完整内容；备注列允许换行显示（`white-space: normal`）；版本号 `?v=20261013cb`。
> - ✅ **2026-10-21 Excel 文件改为下载（用户规则「excel也没法预览 也不提示下载 调整为可以下载」）**：
>   下单页「查看」列 Excel/CSV 文件点击直接下载（不再尝试本地打开）；清单页上传弹窗文件名改为下载链接；版本号 `?v=20261013cc`。
> - ✅ **2026-10-21 Excel 下载路径修复（用户规则「下载失败」）**：
>   下载链接由 `apiBase + "/uploads/"` 改为相对路径 `../Upload/<DN>/<文件名>`（与清单页预览一致）；版本号 `?v=20261013cd`。
> - ✅ **2026-10-21 已揽收及之后状态选中时下单按钮置灰（用户规则「下单页面里 对已揽收和之后的状态的运单，当选中时候， 那个下单的按钮 直接灰色显示」）**：
>   `refreshOrderBtn` 改为检查所有选中行，任一选中行已揽收或之后状态（非待揽收且非专车/自提）→ 下单按钮置灰禁用；版本号 `?v=20261013ce`。
> - ✅ **2026-10-21 下单按钮禁用样式更明显（用户规则「没有任何变化」）**：
>   `.pw-order-btn:disabled` 加灰色背景/边框样式，禁用时下蛋按钮明确置灰；版本号 `?v=20261013cf`。
> - ✅ **2026-10-21 专车已送达也置灰（用户规则「专车的已送达 也灰」）**：
>   专车/自提订单已送达或已关闭时，下单按钮也置灰禁用；版本号 `?v=20261013cg`。
> - ✅ **2026-10-21 所有列表 DN 标题改为 DN/PO，外协单显示 PO（用户规则「所有列表的 DN标题改为DN/PO， 如果是外协单，就把PO号显示在这里」）**：
>   录单/下单/清单页 DN 列标题改为 DN/PO；外协单该列显示 PO 号（`o.order_type === "外协单"` 时显示 `o.po`）；版本号 `?v=20261013ch`。
> - ✅ **2026-10-21 今日待发货加入外协单和其他运单（用户规则「今日待发货加入外协单和其他的运单」）**：
>   外协单/其他类型运单只要未发货即计入今日待发货（不再限 ship_date=今天）；清单页今日待发货筛选同步调整；版本号 `?v=20261013ci`。
> - ✅ **2026-10-21 修复录单/清单页空白（esc 函数未定义）（用户规则「DN/PO 添加后， 录单和清单的页面都空了 都没有显示出来」）**：
>   1-entry.js 和 3-list.js 缺少 `esc()` 函数定义，导致 JS 错误页面渲染中断；补上 `esc` 定义；版本号 `?v=20261013cj`。
> - ✅ **2026-10-21 PO 显示与 DN 一致，98260 为上标（用户规则「PO的显示个与DN一致， 98260为上标」）**：
>   新增 `poHtml(po)` 函数，PO 以 98260 前缀上标显示（与 DN 的 82600 上标一致）；录单/下单/清单页 DN/PO 列外协单改用 `poHtml`；版本号 `?v=20261013ck`。
> - ✅ **2026-10-21 下单页 DN 区外协单 PO 也用 98260 上标（用户规则「下单里的外协单 里的列表的PO也调整为这个显示格式」）**：
>   下单页左侧 DN 队列外协单 chip 的 PO 号改用 `poHtml`，98260 前缀上标显示；版本号 `?v=20261013cl`。
> - ✅ **2026-10-21 PO 加大加粗显示（用户规则「加大加粗显示」）**：
>   DN 区外协单 chip 的 PO 号字体加大到 15px、加粗到 900；版本号 `?v=20261013cm`。
> - ✅ **2026-10-21 录单 IS负责人添加候选（用户规则「录单的IS负责人： 添加候选 Linglin Zheng (Sonya) 等 8 人」）**：
>   IS负责人输入框加 `datalist` 自动补全，候选：Linglin Zheng (Sonya)、Yuxiang Zhu (Lynn)、Xia Yang (Sherry)、Shanshan Tian (Elaine)、Lili Zhou (Cassie)、Jing Ding (Sophia)、Wen Shen (Sally)、Jiayan Wu (Linda)；版本号 `?v=20261013cn`。
> - ✅ **2026-10-21 外协单面单 PO 与 DN 同大字号（用户规则「下单-外协单的 PO像发货单里的DN一样大小。 同时列表的PO号也按照DN的格式显示」）**：
>   面单 DN 位：发货单显示 DN，外协单显示 PO（同 18px 大字号）；运单备注位不再重复 PO；列表 PO 已按 DN 格式显示（98260 上标）；版本号 `?v=20261013co`。
> - ✅ **2026-10-21 IS负责人改为下拉选择（用户规则「下拉显示」「下拉格式与外协单的一致」）**：
>   IS负责人由 datalist 自动补全改为 `<select>` 下拉选择（与外协单采购员下拉格式一致）；版本号 `?v=20261013cp`。
> - ✅ **2026-10-21 录单 SO 与 IS负责人 一行显示（用户规则「录单 SO与请选择IS负责人在一行显示」）**：
>   SO 与 IS负责人 字段合并到同一行（`type-dn-row`）；版本号 `?v=20261013cq`。
> - ✅ **2026-10-21 修复 SO 与 IS负责人 一行显示（用户规则「没有变化」）**：
>   `.type-dn-row` 默认 `flex-direction: column` 导致字段垂直堆叠；新增 `.type-dn-row-2col` 类（`flex-direction: row`），SO 与 IS负责人 单独一行显示；版本号 `?v=20261013cr`。
> - ✅ **2026-10-21 今日待发货恢复到之前的逻辑（用户规则「今日待发货恢复到之前的逻辑」）**：
>   恢复 `ship_date=今天` 口径（撤销外协单/其他运单不限 ship_date 的改动）；清单页今日待发货筛选同步恢复；版本号 `?v=20261013cs`。
> - ✅ **2026-10-21 修复 SO 与 IS负责人 一行超出界（用户规则「SO 与 IS负责人 是在一行了 但是 超出界了」）**：
>   `.type-dn-row-2col` 间距由 12px 调整为 8px，`.fld` 加 `min-width: 0` 允许收缩，标签列收窄到 56px；版本号 `?v=20261013ct`。
> - ✅ **2026-10-21 移除 IS负责人 标签字符（用户规则「移除 IS负责人 字符， 保留 请选择IS负责人 即可」）**：
>   IS负责人 下拉框去掉左侧「IS负责人」标签，只保留下拉占位文字「请选择IS负责人」；版本号 `?v=20261013cu`。
> - ✅ **2026-10-21 DN/SO 标签收窄 + 必填*符号最后显示（用户规则「DN SO 与填写的位置太远， 调整窄些， 同时填写的内容都对齐， 必填的*符号调整到最后显示」）**：
>   `.fld span` 标签宽度由 64px 收窄到 32px，拉近与填写位置；必填*符号移到输入框后显示（红色加粗）；版本号 `?v=20261013cv`。
> - ✅ **2026-10-21 修复 SO 标签未收窄（用户规则「SO没有收窄」）**：
>   `.type-dn-row-2col .fld span` 宽度由 56px 调整为 32px（与 `.fld span` 一致）；版本号 `?v=20261013cw`。
> - ✅ **2026-10-21 IS负责人 下拉框加宽（用户规则「请选择IS负责人 加宽些」）**：
>   `.type-dn-row-2col .fld:last-child` flex 由 1 调整为 1.6，IS负责人 下拉框比 SO 输入框宽 60%；版本号 `?v=20261013cx`。
> - ✅ **2026-10-21 员工姓名/员工电话 标签加宽（用户规则「其他里面的 员工姓名和员工电话 加宽显示全」）**：
>   `#modeOther .fld span` 宽度由 32px 调整为 64px，员工姓名/员工电话 标签显示全；版本号 `?v=20261013cy`。
> - ✅ **2026-10-21 外协单 PO/采购员/公司电话 内容靠右显示（用户规则「外协单里的 PO 采购员 公司电话， 的内容 都靠右显示」）**：
>   `#modeOut .line-input` 加 `text-align: right`，外协单 PO/采购员/公司电话 输入内容靠右显示；版本号 `?v=20261013cz`。
> - ✅ **2026-10-21 外协单/其他必填符号红色加大（用户规则「外协单和其他里 的必填符号与发货单里的一样 设置为红色， 同时 所有的必填符号再加大些显示」）**：
>   外协单 PO/采购员、其他 员工姓名/员工电话 的 * 符号改为 `<b class="req">`（与发货单一致）；所有必填 * 符号 font-size 加大到 18px、红色加粗；版本号 `?v=20261013da`。
> - ✅ **2026-10-21 发货单 SO/IS负责人下方添加异常/允许发货滑动开关（用户规则「发货单里的 SO与IS负责人下方 添加2个滑动开关： 分别是 异常 允许发货 格式与下单页面里的多选一致」）**：
>   SO/IS负责人下方新增「异常」「允许发货」2 个滑动开关（`ms-switch` 样式，与下单页多选开关一致）；版本号 `?v=20261013db`。
> - ✅ **2026-10-21 公司电话靠右显示（用户规则「0519 6822-8088 靠右显示」）**：
>   `.buyer-phone b` 加 `text-align: right`，公司电话 0519 6822-8088 靠右显示；版本号 `?v=20261013dc`。
> - ✅ **2026-10-21 滑动开关平铺到边 + 滑块按钮加长（用户规则「上下左右位置调整， 平铺到边， 滑块按钮加长显示」）**：
>   `.toggle-row` 改 `justify-content: space-between` 平铺到边；`.toggle-row .ms-switch` 宽度由 52px 加长到 72px；版本号 `?v=20261013dd`。
> - ✅ **2026-10-21 录单 DN/PO 第二行显示 IS负责人/采购员 + 标题改 DN / PO（用户规则「录单页面， DN/PO 第二行显示 IS负责人或采购员， 可以跨列到SO列。 DN/PO 改为 DN / PO」）**：
>   录单页 DN/PO 列第二行显示 IS负责人（发货单）或采购员（外协单）；DN/PO 列标题改为「DN / PO」；版本号 `?v=20261013de`。
> - ✅ **2026-10-21 公司电话右边与下拉箭头对齐（用户规则「电话号码右边与上边的下拉箭头对齐」）**：
>   `.buyer-phone b` 加 `padding-right: 20px`，公司电话右边与上边采购员下拉箭头对齐；版本号 `?v=20261013df`。
> - ✅ **2026-10-21 异常/允许发货改为勾选框 + 位置往下调整（用户规则「异常 与 允许发货 位置往下调整」「异常与允许发货改为勾选， 像勾选表示将地址信息存到常用地址池里的勾选按钮一样」）**：
>   异常/允许发货由滑动开关改为 `pool-check` 勾选框（与存地址簿勾选框一致）；位置往下调整（`margin-top: 8px`）；版本号 `?v=20261013dg`。
> - ✅ **2026-10-21 DN/PO 下 IS负责人/采购员 按回单格式显示（用户规则「DN / PO 下的 IS负责人和采购 姓名的显示 按照 清单里 回单的格式表达， 实体背景和白色加粗字符」）**：
>   `.dn-owner` 改为实体背景+白色加粗字符（与清单回单 badge 一致）；版本号 `?v=20261013dh`。
> - ✅ **2026-10-21 异常/允许发货挨在一起靠右 + 文字在左勾选框在右（用户规则「异常与允许发货 挨在一起靠右显示， 文字在做，勾选框在右」）**：
>   `.toggle-row` 改 `justify-content: flex-end` 靠右显示；`.chk-wrap` 改 `flex-direction: row-reverse` 文字在左勾选框在右；版本号 `?v=20261013di`。
> - ✅ **2026-10-21 修复 DN/PO 下 IS负责人/采购员 换行显示（用户规则「DN/PO 下 IS负责人/采购员 按回单格式显示 ， 没有生效， 看似没有换行」）**：
>   `.dn-owner` 由 `display: inline-block` 改为 `display: block`（换行显示），加 `width: fit-content` 保持背景宽度贴合文字；版本号 `?v=20261013dj`。
> - ✅ **2026-10-21 DN/PO 同行显示 IS负责人/采购员 跨列到 SO + 应用到下单/清单（用户规则「DN/PO 下的 IS负责人/采购员 姓名 不要换行显示， 可以跨列显示， 跨到SO列， 同时录单里 DN/PO 下的 IS负责人/采购员 姓名 显示逻辑同样用到下单和清单页面里」）**：
>   DN/PO 列 `colspan=2` 跨列到 SO 列，DN/PO 号与 IS负责人/采购员 同一行显示；录单/下单/清单三页同步应用；版本号 `?v=20261013dk`。
> - ✅ **2026-10-21 DN/PO 第二行显示 IS负责人/采购员 回单格式（用户规则「不是显示在一行，还是换行显示，在第二行如果长度长了，可以跨列显示」）**：
>   恢复两行显示：第一行 DN/PO 号，第二行 IS负责人/采购员（回单格式黑底白字加粗，`white-space: nowrap` 长度长可跨列）；录单/下单/清单三页同步应用；版本号 `?v=20261013dl`。
> - ✅ **2026-10-21 下单页外协单 PO 列也用 98260 上标（用户规则「这里的PO号也有上标那个格式显示」）**：
>   下单页外协单 PO 列改用 `poHtml`，98260 前缀上标显示；版本号 `?v=20261013dm`。
> - ✅ **2026-10-22 异常勾选功能（用户规则「按照这个内容，颜色还是保持之前一样的， 同时当点击异常后，可以发货与暂不发货才可以点击，点击异常需要输入验证码1879. 点击异常后，DN号强制为年月日如261022>01>? ... 当勾选异常后，整行的记录文字用黄色显示」）**：
>   异常勾选需验证码 1879；勾选后显示「可以发货/暂不发货」互斥子选项；DN 自动生成 `年月日>序号>?`；异常订单整行黄色显示；数据库加 `abnormal` 列；版本号 `?v=20261013dn`。
> - ✅ **2026-10-22 异常勾选改为弹窗密码 + 子选项中括号（用户规则「首先都显示出来， 独立以弹窗显示要输入密码，密码不要明文显示， 可以发货/暂不发货 有中括号」）**：
>   可以发货/暂不发货 初始显示但禁用（异常勾选后启用）；prompt 改为独立弹窗密码输入（`type=password` 不明文）；子选项加中括号 `[可以发货]` `[暂不发货]`；版本号 `?v=20261013do`。
> - ✅ **2026-10-22 中括号位置修正 + 添加显示异常行勾选（用户规则「注意中括号的位置， 添加显示异常行的勾选」）**：
>   中括号包裹整个标签+勾选框（`abn-bracket` 类）；新增「显示异常行」勾选，勾选后只显示异常订单行；版本号 `?v=20261013dp`。
> - ✅ **2026-10-22 异常勾选行整体下移（用户规则「整体下移些」）**：
>   `.toggle-row-down` margin-top 由 8px 调整为 16px；版本号 `?v=20261013dq`。
> - ✅ **2026-10-22 勾选框小些 + 中括号位置修正加粗加高（用户规则「勾选框小些」「中括号位置仍然不对， 做中括号在可以发货的左边，右中括号在暂不发货的勾选框右边」「中括号加粗价高显示」）**：
>   勾选框由 20px 缩小到 16px（`pool-check-sm`）；中括号改为左括号在可以发货左边、右括号在暂不发货勾选框右边（包裹两个子选项）；中括号 font-weight 900、font-size 18px 加粗加高显示；版本号 `?v=20261013dr`。
> - ✅ **2026-10-22 勾选框再调小 + 中括号再加高 + 水平居中对齐（用户规则「这里的勾选框再调小， 这里的中括号再加高显示，这里的水平居中对齐，不要水平基线对齐」）**：
>   勾选框由 16px 缩小到 14px；中括号 font-size 由 18px 调整为 22px、line-height 1；`.chk-wrap` 保持 `align-items: center` 水平居中对齐；版本号 `?v=20261013ds`。
> - ✅ **2026-10-22 勾选框再调小 + 中括号不加粗 + 强制水平居中对齐（用户规则「没有看到任何变化，没有变小，没有水平居中对齐，中括号太粗了」）**：
>   勾选框由 14px 缩小到 12px（`!important` 强制）；中括号 font-weight 由 900 调整为 400（不加粗）；`.chk-wrap` 加 `!important` 强制 `align-items: center` 水平居中对齐；版本号 `?v=20261013dt`。
> - ✅ **2026-10-22 勾选框再大些 + 弹窗缩短 + 关闭符号修正 + 中括号水平居中（用户规则「勾选框再大些」「异常后的弹窗太长，且关闭符号位置不对，也太小」「中括号也要与整行水平居中对齐」）**：
>   勾选框由 12px 调整为 18px；弹窗宽度 280px、内边距缩小、关闭符号 28px；`.abn-sub` 加 `!important` 强制 `align-items: center`；版本号 `?v=20261013du`。
> - ✅ **2026-10-22 异常勾选行向上移动 + 向中间收拢（用户规则「中括号还是偏下了， 都向上移动些， 且向中间收拢些」）**：
>   `.toggle-row` 改 `justify-content: center` 向中间收拢、gap 由 16px 调整为 12px；`.toggle-row-down` margin-top 由 16px 调整为 8px 向上移动；版本号 `?v=20261013dv`。
> - ✅ **2026-10-22 数据库补全 is_owner/abnormal 列（用户规则「最近添加了好多的内容，检查下数据库是不是已经完全记录」）**：
>   INSERT 语句补 `is_owner`、`abnormal` 列；UPDATE 允许字段补 `is_owner`、`abnormal`；版本号 `?v=20261013dw`。
> - ✅ **2026-10-22 异常勾选行整体向下偏移 + 中括号向上移 + 向中间靠拢（用户规则「整体向下偏移些，但是中括号向上移些，也向中间靠拢」）**：
>   `.toggle-row-down` margin-top 由 8px 调整为 16px（整体向下）；`.toggle-row` gap 由 12px 调整为 8px（向中间靠拢）；`.abn-bracket` 加 `margin-top: -2px`（中括号向上移）；版本号 `?v=20261013dx`。
> - ✅ **2026-10-22 修复直接关闭弹窗异常仍选中（用户规则「点击异常后，弹窗打开了， 发现直接关闭弹窗，异常就选择状态了，应该还是空的状态」）**：
>   弹窗关闭回调改为 `cb(false)`，直接关闭弹窗=取消，异常保持空状态；版本号 `?v=20261013dy`。
> - ✅ **2026-10-22 修复 IS负责人 不显示在 DN/PO 第二行（用户规则「测试了一个，发现IS负责人并没有显示在DN / PO 的第二行」）**：
>   `row_to_json` 函数补 `is_owner`、`abnormal` 字段返回；版本号 `?v=20261013dz`。
> - ✅ **2026-10-22 添加手动刷新路由状态接口（用户规则「SF5141480295413 已经在派送了， 但是页面显示还是待揽收， 请核实」）**：
>   新增 `GET /api/carrier/refresh_route?waybill_no=xxx` 接口，手动刷新指定运单的路由状态；版本号 `?v=20261013ea`。
> - ✅ **2026-10-22 修复顺丰 API 密钥未加载导致路由状态不更新（用户规则「网站输入没有回复， 请核实后，直接刷新路由状态，但是原因必须理清楚」）**：
>   根本原因：systemd `EnvironmentFile` 未正确注入 carriers.env 到进程环境变量，导致顺丰 API 报「未配置密钥」；修复：server.py 启动时主动加载 carriers.env 兜底；版本号 `?v=20261013eb`。
> - ✅ **2026-10-22 修复 DN/PO 第二行姓名未跨列显示（用户规则「DN / PO 的第二行姓名并没有实现跨一列显示」）**：
>   根因：`.order-table td` 全局 `overflow: hidden` 把超宽 badge 裁在单元格边界；修复：`.order-table td:first-child` 改 `overflow: visible`，
>   `.dn-owner` 加 `position: relative; z-index: 1` 压过右侧 SO 列文字；录单/下单/清单三页同规则生效；版本号 `?v=20261013ec`。
> - ✅ **2026-10-22 修复清单页 DN 列显示错乱（用户规则「清单列 有显示错乱 检查并修正」）**：
>   根因：上一版 `td:first-child { overflow: visible }` 一刀切，清单页（无姓名 badge）异常单的长 DN（如 `261022>01>?`）溢出压到 SO 列第一行文字；
>   修复：放开裁剪的规则收窄为 `.order-table td:first-child:has(.dn-owner)`——只有真正含姓名 badge 的单元格（录单/下单页）才允许跨列，清单页恢复省略号；版本号 `?v=20261013ed`。
> - ✅ **2026-10-22 修复清单页整表列不对齐（用户规则「依然是错乱的， 列不对齐」）**：
>   根因：清单表头/colgroup 为 10 列（回单日期列 10-15 已并入下单状态列），但 3-list.js 数据数组仍残留 `dayOf(o.returned_at)` 单元格，
>   叠加当日的 姓名 `colSpan=2` 改动，每行实际占 11 格 → 浏览器隐式撑出第 11 列，全表错位；
>   修复：数组移除残留的回单日期单元格（10 格=10 列）；姓名跨列改为视觉溢出方案——未下单（单号空）时给姓名格加 `.nm-span`（overflow:visible），
>   有单号保持省略避免与运单号相撞；单号格（rt-over 运单号+路由第二行）归位第 6 列；版本号 `?v=20261013ee`。
> - ✅ **2026-10-22 版式固化入文档（用户规则「这次对了， 固化配置到md」）**：
>   新增「版式定案（勿回退）」章节：表格跨列铁律（格子数=列数、禁用 colspan、一律视觉溢出）、DN/PO 两行+badge 跨列规则、
>   清单 10 列映射表；同步修正「清单模式」章节过时的列描述（回单日期独立列→并入下单状态列）。文档改动，版本号不变。
> - ✅ **2026-10-22 地址列 18 字规则 + 清单 DN badge 同步 + 列标题统一 DN（用户规则「录单页面的街道， 如果超过18个汉字， 那在地址列， 与省市区显示在一行。且公司显示在第二行。如果超出18个字，那就换行显示，且公司显示在第三行」「DN/PO的第二行的姓名格式同步到清单页面里的 DN / PO 列」「录单页面，外协单里PO改未DN， 所有DN / PO的列标题都改为 DN」）**：
>   ① 录单页地址列：街道≤18字→省市区+街道第一行、公司第二行；街道>18字→街道换行第二行、公司第三行（`fillAddrCell` 重写，取 `o.company`）；
>   ② 清单页 DN 列第二行同步 IS负责人/采购员 `.dn-owner` badge（3-list.js 补 `esc`），三页同款；
>   ③ 号码行统一包 `.dn-num`（inline-block 限宽省略），badge 格放开裁剪后异常长 DN 也不得溢出压 SO 列；
>   ④ 录单页外协单表单标签 PO→DN；录单/下单/清单列标题 DN / PO、DN/PO 统一改为 DN（外协单该列仍显示 PO 号，98260 上标不变）；
>   版本号 `?v=20261013ef`。
> - ✅ **2026-10-22 清单搜索加入 DN 列姓名（用户规则「清单页面里， 姓名也加入搜索」）**：
>   顶部搜索框字段补充 `is_owner`、`buyer`（DN 列第二行 IS负责人/采购员 badge 可搜）；版本号 `?v=20261013eg`。
> - ✅ **2026-10-22 清单页地址列 13 字规则 + 公司行（用户规则「清单页面里的街道， 如果超过13个汉字， 那在地址列， 与省市区显示在一行。且公司显示在第二行。如果超出13个字，那就换行显示，且公司显示在第三行」）**：
>   3-list.js `fillAddrCell` 重写：街道≤13字→省市区+街道第一行、公司第二行；街道>13字→街道换行第二行、公司第三行（取 `o.company`，同录单页 18 字规则版式）；版本号 `?v=20261013eh`。
> - ✅ **2026-10-22 重建清单上传文件图标与预览功能（用户规则「清单里查看上传文件的图标和功能没有了」）**：
>   根因：3-list.js 曾在旧版覆盖中丢失上传功能 JS（CSS 类 `.file-ic`/`.pm-file-*` 及 3-list.html 的 SheetJS/docx-preview 引入均保留）；
>   重建：`GET /api/upload` 一次全取附件计数；发货照片列同一行并排「文件图标」（>0 变深可点，数量角标）；
>   预览弹窗文件卡片：图片直显 / PDF iframe / Excel SheetJS / Word docx-preview（滚轮缩放 0.2×–3×），文件名=下载链接；
>   弹窗头部「+ 上传」→ POST `/api/upload?dn=&name=`，传完自动刷新计数/图标/列表；版本号 `?v=20261013ei`。
> - ✅ **2026-10-22 下单页打单列表外协单：PO号→DN + 姓名第二列（用户规则「下单页面里， 列表里还是PO号， 改为DN， 且姓名还是显示在第二列」）**：
>   外协单视图前两列由「采购员 / PO号」改为「DN / 采购员」：第一列显示 PO 号（98260 前缀上标，`.dn-num` 限宽省略），
>   第二列显示采购员姓名；`LIST_HEADS` 动态表头同步；版本号 `?v=20261013ej`。
> - ✅ **2026-10-22 修复清单外协单 DN 列空白（用户规则「清单页面里的 外协单 没有显示DN」）**：
>   3-list.js DN 列对所有类型都用 `dnHtml(o.so)`，外协单无 DN 显示空占位；修复：外协单改用 `poHtml`（98260 上标），
>   补 `poOf`/`buyerOf` 旧数据 note 标签反解回退；版本号 `?v=20261013ek`。
> - ✅ **2026-10-22 下单页打单列表外协单：采购员列移除、姓名并入 DN 格第二行 badge（用户规则「外协单 列表 里的采购员列移除， 采购员姓名显示再DN的第二列， 格式与其它DN一致」）**：
>   外协单视图 `LIST_HEADS` 由 `["DN","采购员"]` 改 `["DN",""]`（第二列留空）；DN 格第一行 PO 号（98260 上标）+
>   第二行采购员 `.dn-owner` badge（回单格式，与发货单 DN 一致）；版本号 `?v=20261013el`。
> - ✅ **2026-10-22 清单其他类型 DN 列显示发件人姓名（用户规则「清单页面里，如果是其它类型的发货， DN列显示发件人姓名」）**：
>   3-list.js DN 列：其他（员工快递）无 DN/PO，改显示发件人姓名（加粗主体，`senderOf` 优先 `emp_name`、旧数据 note 标签反解）；版本号 `?v=20261013em`。
> - ✅ **2026-10-22 清单导出新增下单时间/签收时间（用户规则「清单页面 在导出时候， 需要把快递的下单时间， 签收时间都导出」）**：
>   下单时间=`printed_at`（PUT 写回时运单号由空→非空自动打戳，复用既有列）；签收时间=新列 `signed_at`
>   （路由轮询/手动刷新首次进入 签收|回单|已送达 类状态时取最新节点时间补当年；人工置达路径 PUT 同样打戳）；
>   `row_to_json` 返回两字段；导出（复制/邮件/Teams/Excel）表头加「下单时间」「签收时间」两列；
>   历史已签收单部署时按 `route_latest` 节点时间回填 `signed_at`；版本号 `?v=20261013en`（含 server.py 改动+重启）。
> - ✅ **2026-10-22 清单其他类型发件人姓名移至 DN 列第二行 badge（用户规则「清单页面里，如果是其它类型的发货， DN列第二行显示发件人姓名，位置与格式与发货单的DN的第二行一致」）**：
>   其他类型 DN 列第一行恢复号码位（无 DN 显示占位），发件人姓名改第二行 `.dn-owner` badge（黑底白字回单格式，与发货单 IS负责人一致）；版本号 `?v=20261013eo`。
> - ✅ **2026-10-22 下单页打单列表备注列加宽（用户规则「下单页面的 外协单列表的 备注列加宽」）**：
>   `.col2-note` 由 18% 加宽到 26%（外协单视图第二列已空，备注空间更充裕；全类型视图同享）；版本号 `?v=20261013ep`。
> - ✅ **2026-10-22 所有列表备注列换行最多 3 行（用户规则「所有列表的 备注列， 都可以换行显示，最多显示3行」）**：
>   新增 `.clamp3`（-webkit-line-clamp:3）；录单/下单/清单三页备注单元格内容统一包 `.clamp3` 容器（悬浮 title 仍显示完整备注）；版本号 `?v=20261013eq`。
> - ✅ **2026-10-22 下单页打单列表备注列再加宽 + DN 列减窄（用户规则「下单页面的 外协单列表的 备注列加宽  DN列减窄」）**：
>   `.col2-note` 26%→29%，`.col2-dn` 9%→6%（号码上标后紧凑，badge 有跨列规则兜底）；版本号 `?v=20261013er`。
> - ✅ **2026-10-22 下单页 DN 列加宽一点点（用户规则「下单 - 发货单  - DN列加宽一点点」）**：
>   `.col2-dn` 6%→7.5%（备注列 29% 不动）；版本号 `?v=20261013es`。
> - ✅ **2026-10-22 下单页 DN 列再加宽一点点（用户规则「下单 - 发货单  - DN列加宽一点点」第二次）**：
>   `.col2-dn` 7.5%→9%（备注列 29% 不动）；版本号 `?v=20261013et`。
> - ✅ **2026-10-22 下单页 DN 列大幅加宽（用户规则「没有任何变化 还有加宽。是列表里 DN列 的宽度加宽」）**：
>   `.col2-dn` 9%→14%（已排除缓存因素：HTML/CSS 均 no-cache；前两次微调用户无感知，本次大幅加宽确保可见）；版本号 `?v=20261013eu`。
> - ✅ **2026-10-23 清单备注列改回单行+悬浮看全部（用户规则「清单页面里的备注不要换行，可以悬浮显示全部，可以鼠标滑动显示全部」）**：
>   清单备注格去掉 `.clamp3`，恢复单行省略；加 `title` 悬浮显示全文；悬浮时单元格横向可滚动（鼠标滑动查看全部）；录单/下单页保持 3 行换行不变；版本号 `?v=20261013ev`。
> - ✅ **2026-10-23 下单页 DN 列减半 + 备注列加宽（用户规则「下单页面的 外协单列表的 备注列加宽  DN列减窄 减到一半」）**：
>   `.col2-dn` 14%→7%（减半），`.col2-note` 29%→36%（DN 释放 7% 并入）；版本号 `?v=20261013ew`。
> - ✅ **2026-10-23 撤销全局减半，改仅外协单视图 DN 列收窄 2/3（用户规则「你改的位置不对， 发货单 外协单 和其他， 发货单不用改FN列宽， 只改外协单的DN列宽， 撤销上一步， 再执行把外协单的DN 列宽调窄到原先的2/3」）**：
>   撤销：`.col2-dn` 7%→14%、`.col2-note` 36%→29%（恢复 ew 前状态）；
>   执行：新增 `.pw-list.ot-wx col.col2-dn { width: 9.3% }`（14%×2/3≈9.3%），2-order.js 类型切换时给 `.pw-list` 加/除 `ot-wx` 类——仅外协单视图 DN 列收窄，发货单/其他视图保持 14%；版本号 `?v=20261013ex`。
> - ✅ **2026-10-23 下单/清单 DN 列第二行 badge 组（跨 3 列 + 两个日期块）（用户规则「下单与清单里的 DN列 的第二行 的姓名， 之前是可以跨列2列， 现在调窄为跨3列， 添加2个显示块， 如截图， 第一个是要求发货日期，第二个是实际承运商的下单日期」）**：
>   第二行改为 `.dn-badges` 横排组：`▼ 要求发货日期`（ship_date）+ `▶ 承运商下单日期`（printed_at）+ 姓名 badge，黑底白字同款、悬浮 title 说明；
>   `.dn-badges` `max-width: 300%` 限制最多跨 3 列；放开裁剪选择器扩展 `:has(.dn-badges)`；异常行日期 badge 同黄色；录单页保持原样；版本号 `?v=20261013ey`。
> - ✅ **2026-10-23 回填历史运单 printed_at（用户规则「页面只显示了 要求发货日期 ， 没有实际承运商的下单日期， 少了一个显示块」）**：
>   根因：`printed_at` 为 10-22 新增打戳，仅新单有值；回填脚本 `_backfill_printed_at.py`：专车/自提从 ZC/ZT 单号解析日期、
>   快递调 `/api/carrier/route` 取最早轨迹节点、失败回退 `created_at`；▶ 下单日期块随之显示。
> - ✅ **2026-10-23 清单 SO 列加宽 + 姓名列收窄（用户规则「清单页面里的 SO 列 加宽些  姓名列 窄些， 其它列宽不变」）**：
>   `.col3-so` 6%→8%，`.col3-name` 8%→6%（等量互换，其它列不变；6% 为电话 11 位不省略下限）；版本号 `?v=20261013ez`。
> - ✅ **2026-10-23 修复外协单视图姓名块被裁（用户规则「下单 - 外协单   这里是跨了几列」）**：
>   badge 组跨度 `max-width: 300%`（≈3 个 DN 列宽）；外协单视图 DN 收窄 9.3% 后 300%≈27.9% < 实际 3 列 28.3%，姓名块被裁；
>   放宽到 310%（恰好覆盖完整 3 列）；版本号 `?v=20261013fa`。
> - ✅ **2026-10-23 清单 badge 组跨满第三列（用户规则「清单里的 DN列 的第二行 号向没有跨到第三列」）**：
>   清单 DN 列 5.5%，310%≈17.05% < 前三列合计 17.5%（5.5+8+4）；新增 `.lm-list .dn-badges { max-width: 320% }`（≈17.6%，恰好覆盖完整 3 列）；版本号 `?v=20261013fb`。
> - ✅ **2026-10-23 清单 badge 组再放宽防截断（用户规则「还是有截断」）**：
>   3 块总宽（2 日期块+长姓名如 Linglin Zheng (Sonya)）超 3 列容量；`.lm-list .dn-badges` 320%→400%（≈22%），
>   块间距 4px→3px、内边距 8px→6px 同步收紧；版本号 `?v=20261013fd`。
> - ✅ **2026-10-23 下单外协单视图 badge 组放宽防截断（用户规则「下单  外协单   也有截断」）**：
>   外协单视图 DN 列 9.3%，310%≈28.8% 仅比 3 列多 0.5%，三块总宽放不下；新增 `.pw-list.ot-wx .dn-badges { max-width: 340% }`（≈31.6%）；版本号 `?v=20261013fe`。
> - ✅ **2026-10-23 下单外协单视图 badge 组再加宽（用户规则「下单 外协 里的 还是没显示全  还有加宽」）**：
>   `.pw-list.ot-wx .dn-badges` 340%→400%（≈37.2%，与清单页一致）；版本号 `?v=20261013ff`。
> - ✅ **2026-10-23 重建清单回单日期徽章（用户规则「清单页面里 之前添加的回单日期的显示块都消失了， 加回来」）**：
>   下单状态列下方恢复「回单 ₂₆ 10-19」徽章（`.ret-badge` 黑底白字加粗微圆角，年份小号上标）；
>   日期取人工置回单日 `returned_at` 优先、否则签收日期 `signed_at`（10-22 新增字段）；版本号 `?v=20261013fg`。
> - ✅ **2026-10-23 修正回单日期取数逻辑（用户规则「回单日期逻辑不对， 要显示回单签收的日期， 顺丰是有的， 德邦我不确定」）**：
>   回单日期≠主单签收时间（signed_at 误用，移除）；正确=回单返回运单（顺丰 type=3）轨迹签收节点，
>   服务端既有存档 `order_resp.sign_back_date`（人工置回单日 `returned_at` 优先）；
>   回单运单在途未签收显示灰色「在途」徽章（2026-10-12 规则恢复）；德邦无回单运单追踪，仅人工置回单后显示；版本号 `?v=20261013fh`。
> - ✅ **2026-10-23 修复录单 IS负责人 点行不回显（用户规则「录单 发货单， 当选中已经录单的某行， IS负责人还是不能回显在原位置」）**：
>   `fillForm` 回填漏 `isOwnerInput.value = o.is_owner`（保存路径 line 841 与列表 DN 第二行均正常），补回填 + `resetForm` 同步复位；版本号 `?v=20261013fi`。
> - ✅ **2026-10-23 清单点击回单日期徽章显示路由信息（用户规则「清单页面 当点击 回单 26 10-23 可以显示路由信息」「只是 点击 回单 26 10-23 可以显示路由信息 其它不要变」）**：
>   仅回单日期徽章（`.ret-badge`）可点击，弹步骤窗显示回单运单（顺丰 type=3 回签单 SF106）轨迹；「在途」徽章等其余元素保持原样不可点；
>   无回单运单（德邦/专车自提人工置回单）回退主运单路由并提示；查回单路由不回写主单 `route_status`；版本号 `?v=20261013fj`。
> - ✅ **2026-10-23 录单 IS负责人 回显加固（用户规则「录单 选中录单的行 IS负责人不能回显在 原本输入的位置」）**：
>   `<select>` 赋值不回显的根因：值不在 8 个固定下拉项中（2026-10-21 前 datalist 手输时期的历史值/含空格）时浏览器显示为空；
>   `fillForm` 回显前去空格，无匹配项则临时补 `<option>` 保证原样显示；版本号 `?v=20261013fk`。
> - ✅ **2026-10-23 录单备注列加宽 + 要求发货日期列减窄（用户规则「录单页面 ， 备注 列加宽 ，要求发货日期 列减窄，其它列宽不变」）**：
>   `.col-note` 7%→8.5%、`.col-date` 7%→5.5%（两列总量不变，其它列不动；col 通用类仅录单页使用，打单 col2-*/清单 col3-* 独立不受影响）；
>   配套：日期列表头 13px+减内距、数据格减内距（`#orderBody td:nth-child(8)`），保证表头「要求发货日期」不换行、ISO 日期 10 字符不省略；版本号 `?v=20261013fl`。
> - ✅ **2026-10-23 录单姓名/日期列调窄 + 备注列再加宽（用户规则「录单页面 要求发货日期列和姓名列调窄， 备注列加宽」）**：
>   `.col-name` 9%→7.5%、`.col-date` 5.5%→5%、`.col-note` 8.5%→10.5%（三列总量 23% 不变，其它列不动）；
>   日期数据格同步 13px（与表头一致）保 10 字符不省略；11 位电话在 7.5% 下仍完整；版本号 `?v=20261013fm`。
> - ✅ **2026-10-23 录单列宽再调整一档（用户规则「再调整一次」）**：
>   `.col-name` 7.5%→6.5%、`.col-date` 5%→4.5%、`.col-note` 10.5%→11.5%（三列总量 23% 不变，其它列不动）；
>   日期列配套 12px+内距 2px 保表头不换行、ISO 日期 10 字符不省略；版本号 `?v=20261013fn`。
> - ✅ **2026-10-23 录单姓名列再窄 1/4（用户规则「姓名列再窄1/4」）**：
>   `.col-name` 6.5%→4.9%（减 1/4），余量 1.6% 给备注 `.col-note` 11.5%→13.1%，其它列不动；
>   姓名列数据格配套 12px+内距 2px 保 11 位电话不省略；版本号 `?v=20261013fp`。
> - ✅ **2026-10-23 录单姓名列字号还原（用户规则「不要改字体大小，调整回去」）**：
>   撤销姓名列数据格 12px 字号，恢复原字体大小，仅保留 2px 内距收紧（列宽 4.9%/备注 13.1% 不变）；版本号 `?v=20261013fq`。
> - ✅ **2026-10-23 录单 IS负责人 占位文字改名（用户规则「请选择IS负责人 改为 请选择SO负责人」）**：
>   下拉占位文字「请选择IS负责人」改为「请选择SO负责人」（仅占位文字，下拉 8 人选项值与保存字段 is_owner 均不变）。
> - ✅ **2026-10-24 修复顺丰到付件路由查询 20028「月结卡号不匹配」（用户规则「把这三个到付的路由信息更新一次，同时避免以后无法查询」）**：
>   根因：顺丰 `EXP_RECE_SEARCH_ROUTES` 对到付/非寄付月结单必须传 `checkPhoneNo`（收/寄方电话后4位），否则返 reasonCode 20028「月结卡号不匹配」；
>   参数名实测终定：**`checkPhoneNo`（长名）有效**（SF5141480295413+7801→10 条路由已签收；SF5148488174214+8088→已揽收），`checkNo`（短名）无效仍报 20028。
>   修复：① `carriers/sf_express.py` `query_route/_real_query_route` 加 `check_phone_no` 参数→报文 `checkPhoneNo`；空路由时以 `reasonRemark` 为状态（不再盲显示「待揽收」）；
>   ② `carriers/__init__.py`/`deppon.py`/`kye.py` 签名兼容透传；
>   ③ `server.py` 新增 `_phone_last4()`/`_row_phone4()`（收件 phone 优先、寄件 emp_phone 兜底取后4位），`_refresh_routes`/`_refresh_sign_back`/`_carrier_refresh_route` SELECT 补 `phone,emp_phone` 并传参；
>   `GET /api/carrier/route` 支持 `?phone4=` 查询参或 DB 反查。
>   含 server.py 改动 + 重启 fahuo-api。当日全部到付运单（`order_resp.settings.pay=到付`，共 13 行）已批量刷新：
>   SF5148373314496/SF5141480295413 已签收（signed_at=10-22 11:08）、DPK365119041832 已签收（10-23 14:23）、
>   SF5148488174214 已揽收（10-24 09:46 在途）、DPK365119953069 并单组 9 行真实「待揽收」；
>   查询参数口径已固化入「承运商 API 对接 → 轨迹查询」节。
> - ✅ **2026-10-24 回单在途徽章改显真实状态 + 可点击查路由（用户规则「回单 显示 在途 二字 不合适， 可以改为 回单 > 运送中 ，同时可以点击查看路由信息」）**：
>   回单运单未签收徽章文本「在途」→「回单 > <sign_back_status>」（如 回单 > 运送中 / 已揽收 / 派送中），灰底样式不变；
>   补 cursor+click → `openSignBackRoute(o)`（与回单日期徽章同款弹回单路由）；版本号 `?v=20261013fk`。
> - ✅ **2026-10-20 椭圆按钮再方些（用户规则「椭圆按钮 再方些」）**：
>   回单日期与专车关闭按钮的圆角由 999px（胶囊）调整为 6px（微圆角）；版本号 `?v=20261013bp`。
> - ✅ **2026-10-20 紧急单未下单警告符号红色背景常显（用户规则「紧急单 只要未下单， 那警告符号一直红色背景显示」）**：
>   顶栏警告图标在存在未下单紧急单时红色背景常显（不再闪烁）；`topbar.js` 新增 `updateWarnBtn`，
>   录单/下单/清单页加载订单后联动更新；版本号 `?v=20261013bq`。
> - ✅ **2026-10-20 警告红框改小红点 + Excel/Word 预览鼠标缩放（用户规则「警告的红框再小些」「完全实现Excel和word的预览，且可以通过鼠标缩放」）**：
>   警告图标红色满框背景改为右上角小红点；清单上传文件预览中 Excel（SheetJS）与 Word（docx-preview）内容支持鼠标滚轮缩放（0.2×–3×）；
>   版本号 `?v=20261013br`。
> - ✅ **2026-10-20 警告红框改外圈描边小框（用户规则「警告还是红框 不要太大就可以」）**：
>   警告图标改为外圈红色描边小框（outline 2px + offset 2px），不满框红底；版本号 `?v=20261013bs`。
> - ✅ **2026-10-20 警告图标红色背景与其他图标同尺寸（用户规则「调整为红色背景， 但是大小不要大，注意整行其他图标的大小，保持一致」）**：
>   警告图标改为红色背景但与其他 icon-btn 同尺寸（不再加 outline），颜色 `#d32f2f`、图标白色；
>   版本号 `?v=20261013bt`。
> - ✅ **2026-10-20 警告图标红色背景内容居中（用户规则「红色背景里的没有居中显示」）**：
>   警告图标红色背景内 SVG 改为 flex 居中显示；版本号 `?v=20261013bu`。
> - ✅ **2026-10-14 基本模板横线居中（用户规则「基本模板里的横线在2条竖线的中间」）**：
>   `BASE_ELEMENTS` 中 3 条字段下划线（`line0/line1/line2`）及对应标题（`cap0/cap1/cap2`）宽度由 77/76 统一改为 73.5，
>   保持左端 x=8 不变，使内容块在左竖线（右缘 3.5）与右分隔竖线（x=86）之间左右间距均为 4.5mm，实现水平居中；
>   版本号 `?v=20261013ah`。
> - ✅ **2026-10-13 DN 输入 + 生成图标按钮 + 模板管理图标换新（用户规则「可以输入DN号，打印改为生成，只有生成是按钮，可以换为图标显示，不要生成二字。同时右上的模板管理图标也换一个」）**：
>   右栏底部改为 DN 输入卡片：`.panel.ld-dncard`，含 `ld-dn` 输入框（可输入 DN 号）和 `ld-generate` 图标按钮（无文字，仅一个右箭头圆圈图标）；
>   原 `printLabel()` 改为 `generateLabel()`，生成时把 DN 号并入示例数据（`dn` / `VBELN`）并在打印窗口标题体现；
>   模板管理图标从 feather `layers` 换为 `grid`（2×2 方块）；版本号 `?v=20261013ae`。
> - ✅ **2026-10-13 右栏「打印」按钮按截图样式重绘（圆角线框 + 左上角 DN 标签 + 右侧「打印」文字）**：
>   移除打印机 SVG，改为 `<span class="ld-print-tag">DN</span><span class="ld-print-txt">打印</span>`；
>   CSS 调整为 `border-radius:10px`、`border:2px solid var(--ld-brand)`、文字右对齐、悬停实心；版本号 `?v=20261013ad`。
> - ✅ **2026-10-13 公司代码/名称双输入 + 代码自动补全（用户规则「默认载入 代码和公司名称都要输入，当输入代码的时候，可以从之前删除的数千个代码和名称清单里搜索匹配」）**：
>   右栏「公司代码」卡片的公司名称由只读 div 改为 `<input>`；代码输入框外套相对定位容器，
>   输入时从 `DB.customers`（客户主数据，数千条）按代码前缀/名称包含实时搜索，
>   下拉展示前 10 条匹配（代码 + 名称），点击自动回填代码与公司名称；公司名称输入框也支持
>   按名称搜索匹配；保存强校验新增「公司名称不能为空」；版本号 `?v=20261013ac`。
> - ✅ **2026-10-13 设计区域再高一点点（用户规则「再高一点点」）**：
>   中栏「舞台:预览」弹性比 **1:1 → 3:2**（设计区 60%，打印预览 40%，比等分略高）；
>   版本号 `?v=20261013ab`。
> - ✅ **2026-10-13 设计区域调矮（用户规则「设计区域调整矮一些」）**：
>   中栏「舞台:预览」弹性比 **2:1 → 1:1**（设计区与打印预览各占 50%，设计区变矮）；
>   版本号 `?v=20261013aa`。
> - ✅ **2026-10-13 属性面板图例遮挡修复（用户截图「能看出问题吗？」→「没有生效」→ 已换 flex 列布局）**：
>   右栏「属性/文本」面板的浮动图例被 `overflow-y: auto` 的上边框线遮住；
>   改为 **flex 列布局**：滚动条下放到 `.panel-body`，面板顶部只留 `padding-top: 14px`，
>   图例与「尺寸」卡片一样完整显示在边框线下方，不再被裁切/遮挡；版本号 `?v=20261013z`。
> - ✅ **2026-10-13 预览区调小（用户规则「预览的 再调小些」）**：
>   中栏「舞台:预览」弹性比 **1:1 → 2:1**（设计区占 2/3，打印预览占 1/3）；
>   版本号 `?v=20261013w`。 
> - ✅ **2026-10-13 移除标签设计按钮 + 模板管理图标化（用户规则「移除标签设计按钮
>   模板管理调整为图标」）**：`script.js` 隐藏「标签设计」页签，模板管理改回 feather layers
>   图标；`style.css` 恢复 `#tabs .tab[data-view="designer"] { display: none; }`，
>   模板管理钮去框去影、24px 图标、单钮往返切视图；版本号 `?v=20261013x`。 
> - ✅ **同日撤 ⑤ 追溯页（用户规则「移除追溯的页面和功能」）**：`pages/5-trace.html` +
>   `5-trace.js` 删除（该页一直挂「开发中」大水印、功能未完成）；各页左侧导航「追溯」块
>   全撤；「关于」弹窗文案同步（链路改 录单→下单→清单→SAP→标签，特性行改 清单/SAP/标签）；
>   `style.css` 的 `.viz*` 可视化样式暂留未用（`.dev-wm` 水印 SAP 页仍在用）。



### 编号体系设计（重要·不可违反）

> **DN 只是平台内部标识符，与顺丰及任何承运商没有任何关系。**
> **DN 不下发承运商、不参与承运商逻辑、不围绕它做任何规避设计。**

| 编号 | 用途 | 规则 |
|---|---|---|
| **DN** | 平台内部：列表/队列/上传目录/厂内 ZC·ZT 单号 | 仅内部使用，**永不下发承运商** |
| **承运商客户单号** | 顺丰 `orderId` / 德邦 `custOrderNo` | **持久自增序列**（`oid.seq` 文件，服务端 `next_oid()` 统一分配），**永不复用** |

**撞单教训（真实事故）**：
1. 曾把裸 DN 当顺丰 `orderId` 发送，与公司既有发货流程撞单——顺丰按 orderId 幂等返回了他方真实运单。
2. 曾用**数据库自增 id** 作 oid——数据库清空后 id 重新计数，**新订单撞旧 oid**，顺丰再次幂等返回
   旧运单（新下单打印出永远是同一张旧面单，数据在首单时刻冻结）。
3. 目录重构时 oid.seq 被重置回低位，orderId=5 再次撞旧单。
4. **（2026-09-15）本地 oid.seq 跳到 1000，但服务器那份是早期测试自建的（=5）**——deploy 按设计
   排除 oid.seq（数据永不上传），计数器从未同步。服务器新单 orderId=6 撞旧测试单，顺丰幂等返回
   旧运单：预览是新数据、PDF 面单是旧运单冻结内容（"标签错位"假象）。修复：服务器 oid.seq 跳到
   2000 号段（与本地 1000 段错开，两段都高于历史全部已用 id）。
根因相同：承运商 orderId 注册表是**永久的**，任何会复用的内部编号都不能当它。
修复：orderId/custOrderNo 一律由 `next_oid()` 分配（文件持久自增，清库/重建不复用）。
**运维规则：oid.seq 每环境独立（本地/服务器各自一份），跳号时必须两边都跳；撞单排查第一步 =
看 order_resp 里的 order_id 是否远小于 oid.seq。**

**关联影响**：官方面单"订单号"字段显示 oid 而非 DN（两套体系的正常表现）；
同一订单 oid 固定，重复点下单幂等防重仍有效。

### 包结构与模式

```
carriers/
├── __init__.py   # 注册表分发 + find_pdf_b64/find_label_files（面单 PDF 提取）
├── base.py       # HTTP 封装、签名工具、fetch_url_pdf_b64、CarrierError（零依赖）
├── sf_express.py # 顺丰丰桥（✅ 生产已通：下单+云打印）
├── deppon.py     # 德邦（✅ 生产凭证已填：下单+面单 queryBillPrint 协议已通）
├── kye.py        # 跨越（骨架，待报文样例）
└── cli.py        # Node server.js 子进程入口（order/route/label 三合一）
```

**正式模式**：全部走生产环境；未配密钥=直接报错（**绝不生成模拟单号**）。
改动只改 carriers.env + `systemctl restart fahuo-api`。

**顺丰（生产 ✅）**：
- 下单 `EXP_RECE_CREATE_ORDER`：表单 + `Base64(MD5(msgData+timestamp+checkword))`；
  响应双层嵌套，运单在 `apiResultData.msgData.waybillNoInfoList`
- 随设置区传递：产品类型（`expressTypeId` 映射表 `_PRODUCT_TYPE`：**1=特快 / 2=标快**，
  2026-09-18 A/B 对照终定，见下）/

> **⚠️ 硬规则（用户 2026-09-18 明令，不得质疑）：`expressTypeId=1` 就是顺丰特快，`2` 是顺丰标快。**
> 顺丰客服口径 + A/B 真单对照双重确认；近线"1→标快"是特快产品近线不可用被降级，绝非 1=标快。
  托寄物原样（不自动填充、不加回单后缀；**为空时面单显示的是丰桥模板/账户默认文案**（如"气动元件"），
  需在控制台模板里改默认，或下单时在设置区填写）/
  付款方式（月结=1带卡·现结=1·到付=2）/ 保价（`declaredValue`，不写=不保价）
- 产品/时效字段（**2026-09-18 A/B 对照终定，推翻 9-17 矩阵的错误解读**）：
  - **`expressTypeId`：1=特快 / 2=标快**（235=卡航 232=同城半日达；请求只发此字段，无 limitTypeCode/cargoTypeCode）——
    探针 `_sf_type12_contrast` 同时刻同路线唯一变量对照：济南 **1→特快T4、2→标快T6**；
    **历史映射写反**，致选"标快"实发特快请求 → 远线单全被按特快执行/计费（#478 长春 #493 济南 #494 玉溪）
  - **近线无特快产品**：1(特快)请求在常州等同城/近线被顺丰**降级**为标快（proCode 标快 T6）——
    9-17"1→标快铁证"实系降级误判（用户指正）；**请求产品真迹在面单二维码 k4 字段**（k4=T4=特快）
  - 响应 `routeLabelInfo`：`expressTypeCode` 恒定 **B1**（不随请求/结果变，别用它判断）；
    **`limitTypeCode`/`proCode` = 实际执行产品**：T4=特快 ⇔ proCode=特快，T6=标快 ⇔ proCode=标快
  - 旧证据均不可靠：首张"特快"面单=撞单他方订单；"467 发 2→特快"=撞单 oid 幂等重放污染；
    "远线强制升级/傍晚降级"的改派理论随映射翻案作废（傍晚空运截单降级仍属合理推测，未单测）
  - 前端可见性：运单悬浮提示显示 `实际产品：proCode`（2-order/3-list wbLink）
- 云打印面单 `COM_RECE_CLOUD_PRINT_WAYBILLS`（模板 `fm_76130_standard_LKLPZA6VYES4`，76×130mm，2026-09-15 用户指定；原 150mm 模板弃用）：
  返回 **url+token**（非内嵌 PDF），下载需请求头 **`X-Auth-Token: <token>`**（无头/Authorization 头均 404）；
  新单立即取可能"找不到该运单"（下单→云打印同步延迟），前端按 1/2/4/8s 退避重试
- 配置：`SF_APP_KEY`=顾客代码、`SF_APP_SECRET`=生产校验码、`SF_CUST_CODE`=月结卡 5192587798
- ⚠️ 需在开放平台按服务开通权限：下单/路由查询/云打印各自独立（未开通报 A1004）
- 轨迹 `EXP_RECE_SEARCH_ROUTES`（2026-09-15 已开通）：`firstStatusName` 为状态源（已揽收/运送中/
  派送中/已签收；勿取 acceptAddress=地点）；**route_status 自动刷新**（双通道）：`/api/orders` 加载触发
  + **常驻定时线程 `_route_timer`**（用户规则：**白天 07:00–22:00 每 26 分钟一轮，夜里不刷**；
  `ROUTE_DAY_INTERVAL_S/ROUTE_DAY_START/ROUTE_DAY_END` 常量可调）。
  每单节流 `ROUTE_THROTTLE_S`=300s，`route_checked_at` 列记录检查时间，签收/回单停刷，失败保持旧值；
  `route_latest` 列存最新轨迹节点文本（时间线卡片显示）
- 未来可选：承运商推送（顺丰路由推送 / 德邦 standTraceSubscribe）时效秒级，但需承运商可访问回调地址
  （内网服务器外网不可达，需安全审批开映射，故暂用轮询）

**德邦（生产凭证已填，协议已实测）**：
- 协议：form 四字段 `companyCode`(顶层)+`timestamp`(毫秒)+`digest`+`params`(订单JSON)；
  **digest = Base64(MD5(params原文 + appkey + timestamp) 的 hex 串)**（实测破解，与控制台签名工具逐字节一致）；
  签名提交统一封装 `_signed_post()`（下单/面单共用）
- `companyCode` 必须同时是 params JSON 首字段；logisticID **每单消耗一个**（复用报 2006），
  由 `_next_logistic_id()` 自增（计数存 `carriers/.db_logistic_seq`，生产若固定则 `DB_LOGISTIC_INCR=0`）
- 面单 `queryBillPrint`（同步网关 dpapi.deppon.com）：**已用真实运单 DPK365088772140 实测打通**
  - ⚠️ **customerCode 必须填客户编码（DB_CUST_CODE）**：填公司编码（EWBLKLPZXT）恒报
    "未查询到可以打印的订单"（该报错不代表无权限/无单，文档样例号也报这句）
  - 成功响应：`{"result":true,"data":[{"fileName","fileUrl","waybillNumber"}]}`；
    **fileUrl = 华为 OBS 预签名 URL（免 token）**，归一化为通用 files[]（url+token）交 find_label_files 提取
  - 尺寸：返回的是运单**预生成的 PDF**（76×130mm 一联单，文件固定不变）；实测 10 种尺寸
    参数名均被静默忽略——**接口不支持选尺寸**。打印方案（已与用户确认）：浏览器打印该 PDF
    时自动缩放铺满 100×150 标签纸即可（等比缩放，内容完整清晰），无需改代码
  - ⚠️ **面单 PDF 下单后异步生成（实测延迟可达几分钟）**：立即取报"未查询到可以打印的订单"。
    前端 `printOfficialOrHtml` 对德邦按 5/10/20s 退避覆盖短延迟；仍在生成时**不回退 HTML 面单**
    （用户要求只用官方模板），汇总弹窗提示"面单生成中，稍后点 🖨️ 重打"
- 凭证：dop.deppon.com → 我的基本信息（companyCode/客户编码/appkey）；已填入 carriers.env

## 部署

```bash
# 服务器（Ubuntu，自带 python3，零依赖）：
scp 1_install-api.sh server.py sysadmin@10.86.180.76:/home/sysadmin/
# 前端文件按平台流程上传到 apps/fahuo 后：
ssh sysadmin@10.86.180.76 'sudo bash /home/sysadmin/1_install-api.sh'

# Windows 本地开发：
双击 start-fahuo.bat   # 或 node server.js
```

**更新后何时重启**：

| 改动 | 操作 |
|---|---|
| `server.py` / `carriers/*.py` / `carriers.env` | **必须** `sudo systemctl restart fahuo-api`（代码/密钥在进程启动时载入） |
| 前端 html / js / css | 无需重启，普通刷新即生效（见下方 nginx 缓存规则） |
| 数据库（新增列） | 无需操作，启动时自动迁移 |

**nginx 缓存规则（2026-09-15 补丁，配置备份在同目录 .bak-时间戳）**：
平台 `/etc/nginx/sites-available/lac.lechler.com.cn` 原规则 `^/(apps|images)/.*\.(css|js|…)$` = **7 天 immutable 长缓存**——部署新 JS 后浏览器仍跑旧缓存（曾致"修复无效/页面假死"假象）。
已在其前插入 fahuo 专属规则 `^/apps/fahuo/.*\.(css|js)$` → `no-store`（迭代期与根目录约定一致；稳定后可删）。
其他应用（ctms/po-closing 等）仍为长缓存，未受影响。
前端兜底：各页 API 探测 fetch 均带 `AbortSignal.timeout(5000)`——候选地址被防火墙丢包时 5s 快速失败，
不再长时间挂起（外网 8091 被 ufw 拦截属预期，统一入口走 nginx `/apps/fahuo/api/`）。

## 录单模式功能

- **地址智能识别**：粘贴一段地址文本（可含姓名、手机号），点击「识别」自动解析出
  省 / 市 / 区（县）/ 街道与公司，姓名和手机号随单保存
- **图片识别（OCR）**：左面板同时支持图片输入 —— 截图 **Ctrl+V 直接粘贴**、**拖拽图片**、
  或点「图片」按钮选择文件；本地 Tesseract.js 引擎（chi_sim+eng）识别文字后自动解析填充，
  识别中按钮显示实时进度
  > 注意：OCR 使用 Web Worker + WASM，**本地 file:// 双击打开可能被浏览器拦截**，
  > 请通过 LNSC-Apps 平台（http）部署访问；文本识别不受此限制。
- **省市区下拉**：省 / 市 / 区三级完整行政区划数据联动（342 市、3056 区县），
  选省后市联动、选市后区联动；直辖市自动合并"市辖区/县"显示为省名；解析结果可手动修正
- **下单类型**：发货单 / 外协单 / 其他 单选（上部右 1/6 列），右盒内容随类型切换，
  三视图严格等高（114px 固定 + 6px 行距 + 垂直居中；64px 定宽标签，整行下划线与标签左对齐）：
  - 发货单：**DN 必填**（多 DN：按 `82600+5位` 自动拆分多行、合并同一运单，上一行），**SO 号选填**（下一行；
    用户规则 2026-09-15），**SO 无写入限制**（2026-10-08 用户原话「取消录单时候 SO 的写入限制」：
    去掉 `maxlength=10` 与 `inputmode=numeric`，任意文本、任意长度均可录入；前端与 `server.py` 均不校验
    SO 格式，原样存 `so_no`），SO 号随单入库并显示在录单/下单/清单/SAP 全部列表
  - 外协单：**PO + 采购员必填**，公司电话固定显示（0519 6822-8088）
  - 其他（员工快递）：**员工姓名 + 电话必填**（员工=**发件人**，不占用收件人姓名字段）
  - 发件方信息随备注入库（`PO：xxx 采购员：xxx` / `发件人：姓名 电话`），点行编辑可完整回填；
    各列表**备注列只显示收件区纯备注**（显示时自动剥离结构化标签，搜索仍覆盖完整内容）
  - 外协单 / 其他**没有 DN 和 SO 号**（仅发货单携带，入库强制清空）
- **行内编辑**：点击列表行回填全部字段（含省市区联动、类型/优先级/承运商选中、备注拆解），
  「确定」变「保存」，PUT 写回（离线本地改行）；**已下单（有运单号）的行锁定禁止编辑**（灰显 + 点击提示）
- **通讯录（地址池）**：粘贴区左下通讯录图标 → 居中弹窗（640px），顶部搜索（姓名/电话/地址模糊过滤），
  一键回填省市区/街道/姓名/电话；「存到常用地址池」**默认勾选**（2026-09-24，不需要时手动取消），
  确认入单时按地址去重入池（在线写服务端
  addr_pool 全用户共享，离线回退本地）；**DN 发货单收件地址建单即自动入池**（2026-09-24：服务端
  addr_key 去重 OR IGNORE 零副作用；同日一次性回填历史 55 张 DN 单的 49 个去重地址）；列表上限 500→5000
- **上传附件**：仅发货单（先填 DN），**多文件同时上传**到 `Upload/<DN>/`；虚线框已传态
  「已上传 N个 + 文件名翻滚显示（框高不变）」，文件名后 **× 可删**（DELETE 接口）；
  选中已传文件的行自动显示已上传态；文件名不入备注
- **承运商**：顺丰 / 德邦 / 跨越 / 专车 / 自提 单选竖列（72px 窄列，黑底白字为选中）
- **确认入单**：校验地址非空后写入下方发货清单表（DN、地址、姓名、联系方式、备注、承运商），
  右侧「今日待发货」统计自动 +1，表单重置等待下一单
- **日期**：默认填入当天日期，可手动修改

> 解析为启发式规则：手机号按 `1[3-9]xxxxxxxxx` 提取；姓名取手机号前或首个独立中文短词；
> 省/市/区均按 `region.js` 真实行政区划数据最长匹配（支持"苏州"等简称、"阿坝"等自治州缩写、
> "青龙"等自治县缩写），区县未命中时回退后缀正则提取。
> 极少数歧义地址（如青海省"海南州"已按最长匹配处理）请人工核对下拉结果。

> 四个页面共用同一套布局（左侧模式导航 / 中间内容 / 右侧统计看板），
> 左侧模式按钮为页面链接，点击即在四种模式间切换，当前模式以黑底白字高亮。

## 下单模式（pages/2-order.html）

顺丰/德邦/跨越 电子面单下单工作台。中间区 **1/4 + 3/4** 布局：

```
┌──────────────┬───────────────────────────────────────────┐
│ 承运商切换     │ 上段：录单 DN（5列大按钮平铺滚动，右上多选开关） │
│ 顺丰/德邦/跨越 │ 中段：承运商设置（2行）+ 正方形「下单」按钮      │
│ 130面单模拟框  │ 下段：打单列表（DN|联系人|电话|单号|下单状态|路由状态）│
│ (三套模板)    │      （表头固定，数据区独立滚动）                │
└──────────────┴───────────────────────────────────────────┘
```

- **四套面单模板**：顺丰（丰桥 130×230mm）/ 德邦（DPK 单号、默认快递标准件、重量体积、送货上楼）/
  跨越（KY 单号、限时速运、昼夜取派）按官网通用格式模拟；专车 / 自提 共用厂内送货单模板（ZC/ZT 编号）
- **三方联动**：面单 ⇄ DN 按钮 ⇄ 列表行，点任一处三处同步选中并滚动到可见位置
- **DN 类型过滤**：DN 区顶部「发货单 / 外协单 / 其他」过滤（默认发货单），标题随切换
  （DN发货单 / PO外协单 / 个人其他）；外协/其他显示**两行 chip**（18px 加粗 + 14px 次行）：
  其他 = 对方姓名+电话 / 发件员工（靠右灰色），外协 = 对方公司 / PO（加粗靠左）+ 采购员（靠右）
- **承运商**：从订单数据带入；本页可改（多选批量改，API 在线时 PUT 写回数据库）；
  「自提」按钮加宽（flex 1.7）与 2 字按钮视觉均衡
- **设置区单行自适应**：产品下拉随承运商重建（标快/大件3.60/次日达…），付款/保价/托寄物
  三套模板同步传入，德邦激活时追加重量/体积输入；同承运商切换 DN 不重置已选设置
- **多选批量**：方形开关开启后 DN 多选；下单按钮二次确认 + 防连点，混选自动按承运商分组套用各自产品
- **操作密码门**：下单 / 取消下单弹固定密码 `18879` 主题弹窗（2026-09-16 用户规则，防误触软闸、非安全边界）；
  **「其他」（员工快递）类型下单免验证**（2026-10-08 用户规则：发货单/外协单仍弹，
  混选批次含非其他单时从严照弹；取消下单无论类型都弹）
- **DN 队列**：按钮区只显示待下单；下单成功生成单号（SF/DPK/KY）回填列表并移出队列，防重复下单；
  **下单时承运商回写**（录单未选承运商的单，下单用页面所选并 PUT 入库，列表/刷新一致显示）
- **打单列表**：随类型过滤（前两列含义随切：发货单=DN/SO、外协=采购员/PO号、其他=发件人/收件城市）；
  仅显示**近 7 天录单 + 全部已下单**；列：DN SO 优先级 联系人 承运商 单号 下单状态 路由状态 打印 查看
- **「查看」列**：格式图标（icon/file-type-*.svg）——PDF 点击预览弹窗（可打印）、
  Excel 用本地 Excel 程序打开（ms-excel 协议）、Word 预览（docx-preview）、
  图片（PNG/JPG/GIF/BMP/WEBP）预览弹窗直显（统一 file-type-png 图标）、其它格式统一 File 图标
- **模拟路由时间线**：点选已下单行，面单下方显示节点时间线（已下单→已揽收→运输中→…，
  节点间隔按运单号哈希生成，稳定不跳变；真实轨迹接口就绪后换 `/api/carrier/route` 数据即可）
- **打印列**：打印机图标（icon/printer.svg）单行补打
- **单号字段**：orders 表 `waybill_no` / `route_status`（旧库自动迁移），下单回填、列表"单号/下单状态/路由状态"联动
- **丰密脱敏**：面单手机号显示为 `138****5678`
- **面单打印**：面单下方「打印面单」按钮，**统一 100×150mm 标签纸**出纸仅打印面单
  （屏幕显示保持 130×230 设计稿不变，打印时 CSS 等比缩放 0.652 水平居中适配标签纸）
- **扫码枪**：全局数字缓冲 + Enter 定位 DN 自动选中（输入框聚焦时不拦截）
- **API 状态点**：标题栏圆点，在线=黑实心 / 离线=灰；**五页统一**（同位置同元素，
  topbar.js `markApi()` 统一接口），顶部栏五页逐元素一致 + `scrollbar-gutter: stable`，
  模式切换时顶部栏位置完全静止
- **顶部栏弹窗**（topbar.js 统一注入，五页共享）：
  - **设置**：承运商启用开关（顺丰/德邦/跨越，关闭后录单/下单页隐藏；localStorage）+
    清除模拟数据（调 `/api/admin/clear-orders` 清空订单表）
  - **关于**：版本迭代风弹窗（应用头 + 版本区块 + 特性列表 + 支持联系方式）
- **寄件人固定**：莱克勒喷嘴系统（常州）有限公司，江苏常州金坛 德城路99号，邮编 213200；
  **寄件联系人随类型**（2026-09-15 用户规则）：发货单=**范蓓蓓 15190535163**（`_SENDER_CONTACT` 映射表，
  顺丰 contact/tel、德邦 name/mobile；其他类型暂用公司电话 0519 6822-8088）
- **favicon**：全页面统一 App.ico；右侧统计看板四页共享 stats.js

## 版式定案（2026-10-22 用户实测确认，勿回退）

> 以下三条均为用户实测「对了」的终态，后续改动不得破坏：

1. **表格跨列铁律：每行格子数（含 colspan 展开）必须等于 colgroup 列数**。
   需要"跨列显示"时**一律用视觉溢出**（`overflow: visible` 让内容绘出单元格），
   **禁止用 `colspan`**——colspan 会改变格子数，与 colgroup 不一致即整表错位
   （2026-10-22 清单列不对齐事故：残留回单日期单元格 + 姓名 colspan=2 → 11 格 vs 10 列）。
2. **DN 列两行显示**（录单/下单/清单三页 `.order-table` 第一列，**列标题统一为「DN」**，外协单该列仍显示 PO 号）：
   第一行号码（DN=82600 / PO=98260 前缀小号上标 + 剩余位加粗），外层包 `.dn-num`（inline-block 限宽省略，
   异常长 DN 如 `261022>01>?` 不得溢出压 SO 列）；
   第二行 **badge 组**（下单/清单页；2026-10-23 起）：`▼ 要求发货日期`（ship_date）+ `▶ 承运商下单日期`（printed_at）+
   姓名（发货单=IS负责人 / 外协单=采购员 / 其他=发件人），均为黑底白字加粗圆角（回单格式），
   **横排最多跨 3 列**（`.dn-badges { max-width: 300% }`），由 `:has(.dn-owner)/:has(.dn-badges) { overflow: visible }` 放开裁剪，
   badge 带 `position:relative; z-index:1` 压过右列文字；录单页第二行仍为单姓名 badge（可跨列到 SO 列）。
   录单页外协单表单标签为「DN」（原 PO，2026-10-22 改）。
3. **清单页 10 列定案**（colgroup 与数据数组一一对应）：

   | # | 列 | 内容 |
   |---|---|---|
   | 1 | DN | 第一行号码 `.dn-num`（发货单=82600 前缀上标 / 外协单=PO 号 98260 上标 / 其他=无号占位）+ 第二行 `.dn-owner` 姓名 badge（发货单=IS负责人 / 外协单=采购员 / 其他=发件人） |
   | 2 | SO | `soHtml`（32600 前缀上标） |
   | 3 | （无标题） | 类型（发货单/外协单/其他） |
   | 4 | 地址 | 省市区 / 街道 两行 |
   | 5 | 姓名 | 姓名+电话两行；**未下单（单号空）时加 `.nm-span` 可视觉跨列到单号空位**，有单号保持省略防与运单号相撞 |
   | 6 | 单号 | 运单号（可点→步骤弹窗）+ 最新路由第二行（`.rt-over`，上下翻页） |
   | 7 | 下单状态 | 已下单/待下单（回单日期 2026-10-15 起并入此列，**无独立列**） |
   | 8 | 路由状态 | route_status |
   | 9 | （无标题） | 发货照片图标 + 上传文件图标（同一行；文件图标>0 变深可点→预览弹窗，含「+ 上传」） |
   | 10 | 备注 | cleanNote 纯备注 |
4. **地址列街道阈值 + 公司行规则**（2026-10-22，录单页阈值 18 字 / 清单页阈值 13 字）：
   街道 ≤阈值 → 省市区+街道 **同一行**（第一行），**公司第二行**；
   街道 >阈值 → 街道**换行**（第二行），**公司第三行**；公司取 `o.company`，无公司不渲染该行。

## 清单模式（pages/3-list.html）

- **组合筛选**：类型组（发货单/外协单/其他）× 优先级组（紧急/重要/一般）独立单选、AND 组合，
  再与顶部搜索框关键词叠加；全部在右侧看板口径（?f=）基础集合内进行
- 列：DN/PO SO （类型列） 地址 姓名 单号 下单状态 路由状态 **发货照片** 备注（共 10 列，见上「版式定案」；
  **无联系方式列**，电话并入姓名列第二行；搜索仍覆盖手机号；回单日期并入下单状态列、无独立列）
- **发货照片列**（路由状态后、备注前；2026-09-16）：无列标题，Feather 风格灰色图片图标占位；
  共享盘检索到对应 DN 照片时图标**变深可点** → 弹出预览（整列大图，点图开原图）
- **发货照片链路**（参照 LibQ 1_mount/2_scan 模式）：
  - `4_mount_shipphotos.sh`：cifs 挂载 `\\10.86.180.24\VideoandPhoto\LNSC-05\01_ShippingPhotos_Send`
    到应用内 `ShippingPhotos/`（年/月/日递进目录；nginx 静态直出免改配置；fstab 开机自动挂）
  - `5_scan_shipphotos.sh`：find 扫描 DN 命名图片（`8260034320_1.jpg`/`8260034320.jpg`）
    → `shipphotos.json`（`{DN:[相对路径]}`）；**root cron 每 5 分钟**自动重扫
  - 前端直接读静态 `shipphotos.json`（?t= 防缓存），图片 URL = `../ShippingPhotos/<相对路径>`
  - `shipphotos.json`/`ShippingPhotos` 已入 excludes.conf，部署永不覆盖
- 备注列只显示收件区纯备注（发件方结构化标签显示时剥离，搜索覆盖完整内容）

## 本地预览

直接双击 `index.html` 即可在浏览器中打开（file:// 协议，无任何依赖）。

## 开发路线（TODO）

- [x] **录单模式**：地址智能识别（粘贴文本 → 解析省/市/区/街道/姓名/电话）
- [x] **承运商选择**：顺丰 / 德邦 单选切换
- [x] **清单模式**：整合录单+下单全部列（DN/地址/姓名/联系方式/备注/承运商/单号/下单状态/路由状态）+ 顶部搜索框实时过滤
- [ ] **清单编辑**：行内编辑/删除已入库单（收件信息修正入口）
- [x] **下单模式 UI**：三套面单模板 + DN 平铺选择 + 多选批量 + 自适应承运商设置 + 三方联动
- [x] **下单模式对接**：carriers/ 架构落地，**顺丰生产已通**（真实下单+云打印官方面单 PDF）；
  德邦协议已实测验证（签名/自增单号，生产凭证待填）；跨越待报文样例
- [x] **DN 队列过滤**：DN 区只显示待下单，下单成功移出，防重复下单
- [x] **单号字段**：orders 表 waybill_no / route_status（自动迁移），下单回填
- [x] **面单打印**：@media print 统一 80×130mm 标签纸出纸（2026-09-15 换纸；官方面单 PDF 76×130 按实际大小 1:1 不缩放，HTML 模板等比 0.565 适配）
- [x] **下单防连点/二次确认/承运商分组**、丰密脱敏、扫码枪、API 状态点
- [x] **SAP模式 UI**：B1/HANA「交货-清单」DN 列表，**分组表头区分数据来源**：
  SAP 交货单信息（编号/客户/日期/状态/总计）| 录单/下单信息（承运商/运单号/快递状态），DN 号为关联键
- [ ] **SAP模式对接**：B1 Service Layer（REST）拉取未清 DN；运单号回写交货单跟踪号字段
- [x] **统计看板**：昨日发货 / 今日待发货 / 计划发货 / 今日回单 真实数据接入
- [x] 数据持久化（SQLite + server.py / server.js）
- [x] LNSC-Apps 平台部署脚本（1_install-api.sh）
- [x] **录单页行内编辑**：点行回填 → 保存 PUT 写回（离线本地改行）
- [x] **下单类型分视图**：发货单 SO/DN、外协单 PO/采购员（+公司电话）、其他发件员工；
  分类型必填校验、发件方信息随备注入库、行编辑回填、备注列纯备注显示（cleanNote）
- [x] **下单页 DN 类型过滤**：发货单/外协单/其他（默认发货单），标题随切，
  外协/其他两行 chip（公司+PO+采购员 / 姓名电话+发件员工）
- [x] **顶部栏五页统一**：API 状态点全页面一致（markApi 统一接口）+ scrollbar-gutter 防位移；
  设置/关于弹窗 topbar.js 统一注入
- [x] **上传附件体系**：Upload/<DN>/ 归档 + 多文件上传 + 已上传态翻滚显示 + ×删除 + 查看列预览/本地打开（图片 PNG 图标 + 弹窗预览）
- [x] **通讯录地址池**：勾选入池 + 弹窗搜索 + 一键回填
- [x] **已下单锁定**：录单页有运单号的行禁止行内编辑
- [x] **清单组合筛选**：类型 × 优先级 × 搜索 三重叠加
- [x] **面单打印统一**：80×130mm 标签纸（2026-09-15 换纸；官方 PDF 1:1 不缩放，HTML 模板缩放居中）
- [x] **设置中心**：承运商开关 + 一键清除模拟数据（/api/admin/clear-orders）
