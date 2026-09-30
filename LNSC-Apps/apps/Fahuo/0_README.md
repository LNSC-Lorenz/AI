# LNSC 全链发货平台 | LNSC Full-Chain Delivery System

国内发货全链路过程管理的内网网页应用，覆盖从地址录单、打单、清单到 SAP 对接的发货全流程。
前端纯静态（HTML + CSS + JS，无框架、无构建）；数据持久化采用 **SQLite**（单文件，零运维）。

> **当前状态**：五模式全部可用 —— 录单（识别+行内编辑+类型分视图）/ 下单（类型过滤+四套面单模板）
> / 清单（全列搜索）/ SAP（交货-清单视图）/ 可视化（点阵动态看板）；SQLite 持久化 + 离线 mock 回退。

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

## 文件说明（目录结构：页面 / 共享 / 服务 三块）

```
Fahuo/
├── index.html                  入口重定向 → pages/1-entry.html（保 /apps/fahuo/ 根地址可用）
├── pages/                      【页面层：一号一页，页名即文件名】
│   ├── 1-entry.html / 1-entry.js   ① 录单（地址识别 + OCR + 共享地址池 + 发货清单表）
│   ├── 2-order.html / 2-order.js   ② 下单（DN 选择 + 承运商设置 + 真实下单 + 云打印面单 + 打单列表）
│   ├── 3-list.html  / 3-list.js    ③ 清单（整合全列 + 模糊搜索）
│   ├── 4-sap.html   / 4-sap.js     ④ SAP（B1/HANA「交货-清单」视图，对接时替换 Service Layer）
│   └── 5-trace.html / 5-trace.js   ⑤ 追溯（可视化三模块 + 点阵明细 + 运单步骤）
├── shared/                     【前端共享资源】
│   ├── style.css                   样式（纯黑线框，1080P 一屏满边，五页共用）
│   ├── topbar.js                   顶部栏：时钟/主题/设置/关于/markApi 状态点
│   ├── stats.js                    右侧统计看板（API 实时，两位占位）
│   ├── region.js                   全国省市区数据（34省/342市/3056区县, MIT）
│   ├── icon/                       图标（printer、file-type-* 等）
│   ├── lib/                        本地组件（OCR tesseract、xlsx、docx-preview、jszip、pdf.js）
│   └── App.ico                     站点图标
├── server.py                   API 服务（生产，位置不变：Python 标准库零依赖，静态根=Fahuo/）
├── server.js                   API 服务（本地开发，Node≥22.5；经子进程调同一 carriers 包）
├── carriers.env                承运商密钥（chmod 600，systemd EnvironmentFile 注入，不入库）
├── carriers/                   【承运商层：一家一文件】
│   ├── sf_express.py               顺丰（下单 + 云打印面单，严格按 SF.txt 标准流程）
│   ├── deppon.py                   德邦（签名破解版 + logisticID 逐单自增）
│   ├── kye.py                      跨越（骨架，待报文样例）
│   ├── base.py                     HTTP/签名/PDF下载 公共件
│   ├── __init__.py                 注册表分发 + 面单 PDF 提取
│   ├── cli.py                      Node 子进程统一入口（order/route/label）
│   ├── SF.txt                      顺丰云打印官方流程样例（sf_express 的依据）
│   └── .db_logistic_seq            德邦 logisticID 自增计数（勿删）
├── fahuo.db                    SQLite 订单库（备份=复制该文件）
├── oid.seq                     承运商客户单号持久序列（勿删，删了撞单）
├── Upload/                     发货单附件（按 DN 建子文件夹）
├── 0_README.md                 本文档
└── 1_install-api.sh            服务器一键部署（systemd + 每日备份 cron + 自检）
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
  **方案A 面单标识（2026-09-24）**：勾选回单/拍照时下单 `remark` 自动追加「需纸质回单/需拍照回传」
  （如并单 DN 清单后），实际下发存档 `order_resp.remark`；标准模板 fm_76130 备注区是否打印以真实面单实证。
  平台侧新增**回单运单追踪**（server.py `_refresh_sign_back`）：主单签收终态后改追踪 sign_back_no 轨迹，
  回单运单终态 → 自动置 returned + returned_at（回单日期自动填；发货日起 30 天窗口、复用节流）
  （2026-09-29 口径修正：仅历史单自动置；新单只提示，见下"修复状态清单"）
  **回签单面单打印（2026-09-25 用户规则）**：回单回不来系到方地址未维护——回签单（type=3 SF1064）面单
  必须打印随货走：打印链路追加 `optional_no` 参数（服务端取到即合并追加、取不到静默跳过，绝不阻塞主面单），
  件数角标/步骤弹窗仍不计回单（"选1显示2"教训不复发）；实测 SF1064997481417 云打印可出纸
  （单张=2页，与主单 SF1223687759657 合并=3页 154KB）
  （⚠️ 该追加 2026-09-29 自查后已放弃——见下方"自查更正"：追加页=正向 POD 签收联，与主面单同收件人不同单号）
  **速打反向回签单面单实测（2026-09-29）**：SF 速打客户端同一打印任务出纸主运单+反向回签单两张
  （SF5155825356371 + SF1065003763540，订单号 U0676092993637282）：两联收/寄地址互反，回签单
  「到付」+「签回单原单号」回链主单，主单明细栏同印回单号（路由 532W-BG-WBD01E-00 / 519WA-HT-000）
  → 反向回签单（反向+到付）官方模板**签收前即可出纸**，自绘反向面单（sb_label.py 实验）永久不需要；
  且反向联收方=莱克勒 江苏常州金坛德城路99号（与 SIGN_BACK_ADDR 一致），新单返回段到方地址面单侧已正确。
  ⚠️ **自查更正（2026-09-29，撤回"Fahuo 打印链路经 optional_no 合并追加该反向联"的未验证断言）**：
  Fahuo 链路 SF106 号云打印实测（#557，`_sb_pages.py` 归档）=1 页**正向 POD 签收联**（寄=莱克勒/
  收=客户/寄付月结，与主面单同收件人、单号不同）——追加出纸即用户指出的"**两张面单同收件人
  不同单号**"重复缺陷 → **已放弃追加**：服务端 `_carrier_label` 仅显式 `with_optional=1` 才合并
  （供探针逐页核验），前端不再传 `optional_no`，打印=仅官方主面单。目标出纸=速打同款两联
  （官方主面单 + 官方反向回签单：收寄互反/到付/签回单原单号回链）；反向联的云打印取得路径
  （单据类型/阶段）待 `carriers/_sb_pages.py <回单号> <主单号>` 逐页核验后接入；自绘永久作废。
   ✅ **已部署生效（2026-09-30）**：server.py / carriers/sf_express.py / pages/2-order.js / 0_README.md
   上传 10.86.180.76:/var/www/lnsc-apps/apps/fahuo（原文件备份 /home/sysadmin/fahuo-backup-20260930-081651），
   `systemctl restart fahuo-api` 成功、MD5 与本地一致。现网冒烟（脚本留存服务器 /home/sysadmin/_smoke_label.sh）：
   默认打印=**1 页官方主面单**（SF5155141607457，HTTP 200，76,952B）✅ 重复页缺陷消除；
   `with_optional=1`+`optional_no`=2 页（主面单+POD 签收联合并，153,510B）✅ 探针路径保留可用；
   nginx no-store 生效，线上 2-order.js 中 `optional_no` 出现 0 次（前端不再传参实锤）。
  速打可作官方客户端补打/核对入口
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
   **回单修复状态清单（截至 2026-09-29 更正）**：
   - ✅ 已修复并实测：`isSignBack=1` 下单 + 回单号存档 `order_resp.sign_back_no`；回单运单追踪
     （**2026-09-29 用户定夺：对新单生效**）：created_at ≥ 2026-09-29 的订单回单运单终态只写提示
     `order_resp.sign_back_final` + 审计 SIGNBACK-FINAL，**不自动置 returned**——终态可能是错误地址
     签收，实物核实到达莱克勒后人工置 returned（PUT）；历史单维持自动置不回溯；已提示过的单停查
     省接口；步骤弹窗回单块一键复制"到方地址维护申请"（signBackInfoEl）
   - ❌ 已放弃（2026-09-29 自查）：POD 签收联打印链路（`optional_no` 合并追加出纸）——追加页=正向
     POD 签收联，与主面单同收件人、单号不同，即用户指出的"两张面单同收件人不同单号"重复缺陷；
     服务端 `with_optional` 默认关、前端不再传；官方反向回签单待取得路径核验后按速打同款两联接入
   - ✅ **到方地址已平台统一维护（2026-09-29 用户口径终定）**：唯一权威源 `carriers/sf_express.SIGN_BACK_ADDR`
     （莱克勒喷嘴系统（常州）有限公司 范蓓蓓 15190535163 / 江苏常州金坛 德城路99号（邮编 213200），
     与寄件人 `_SENDER` 同源）；`GET /api/signback_addr` 暴露给前端，2-order/3-list 维护申请文案改为
     引用该配置（离线兜底同文，改地址只改服务端一处）。丰桥下单接口**无**到方地址下发字段
     （extraInfoList POD 实测 S0003 拒），故顺丰账号侧仍需人工维护（见下待办）
   - ❌ 待办（外部依赖，顺丰侧）：**回单返回"到方地址"账号侧维护**——把平台生成的维护申请文案（步骤弹窗
     一键复制）发 95338/顺丰销售，到方地址=上述 SIGN_BACK_ADDR——回单收不到的真正根因；
     协查历史 4 张误投回单（SF1064982980091/SF1064982958300/SF1064983709198/SF1064997481417）重新派送
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
> `_sb_pages.py`（回单面单 PDF 逐页提取——#557 实证 POD 签收联仅 1 页、备注区已打印"需纸质回单/需拍照回传"）、
> `_sb_routes.py`（4 张历史回单运单轨迹全节点：上海/湖州/苏州→常州金坛"已签收"，反向返回实锤证据链）。
> ⚠️ **清理事故**：`_` 前缀通配误删包入口 `__init__.py`，现网报"carriers 包缺失"（#551/so 8260034595
> 下单失败；该单 status 仍 pending、未产生运单，UI 重下即可）。已从 git 恢复并重新部署（19:01）。
> 教训：批量删除必须显式白名单，`__` 双下划线包文件绝不通配匹配。



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
  托寄物原样（不自动填充；**为空时面单显示的是丰桥模板/账户默认文案**（如"气动元件"），
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
  - 发货单：**DN 必填**（10 位数字校验，上一行），**SO 号选填**（下一行；用户规则 2026-09-15），SO 号随单入库并显示在录单/下单/清单/SAP/可视化全部列表
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

## 清单模式（pages/3-list.html）

- **组合筛选**：类型组（发货单/外协单/其他）× 优先级组（紧急/重要/一般）独立单选、AND 组合，
  再与顶部搜索框关键词叠加；全部在右侧看板口径（?f=）基础集合内进行
- 列：DN SO （优先级/类型合并列） 地址 姓名 备注 单号 下单状态 路由状态 **发货照片** 回单日期
  （**无联系方式列**；搜索仍覆盖手机号）
- **发货照片列**（路由状态后、回单日期前；2026-09-16）：无列标题，Feather 风格灰色图片图标占位；
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
