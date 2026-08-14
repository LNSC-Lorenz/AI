# PO-Closing · 采购订单关单核对平台

围绕「PO 清单 → 收货情况 → 关单判定 → 人工核对 → 一键通知」的完整闭环。
**全部业务逻辑在服务端 Python 模块中，前端 `index.html` 只负责展示与调用 API，无业务代码外露。**

```
┌─────────────┐   HTTP/JSON    ┌──────────────────────────────────────────┐
│  index.html │ ─────────────► │  server.py（仅标准库）                    │
│  （纯展示）  │ ◄───────────── │   ├─ data_source.py  数据源适配           │
└─────────────┘                │   │    ├─ mock  内置演示（默认）            │
                               │   │    ├─ csv   读 rfc/po_gr_check.py 产出 │
                               │   │    └─ rfc   设备上实时调 SAP RFC       │
                               │   ├─ matching.py   关单判定（同 GR_STATUS 口径）│
                               │   ├─ storage.py    SQLite 核对/通知记录    │
                               │   └─ notifier.py   一键通知（默认演练）    │
                               └──────────────┬───────────────────────────┘
                                              ▼
                              SAP: Z_OA_GET_POGR_STATUS（OA 侧交付，rfc/ 目录适配）
```

## 1. 目录结构

| 路径 | 说明 |
|---|---|
| `index.html` | 前端页面（纯展示，无业务逻辑，无外部依赖） |
| `server.py` | HTTP 服务 + API 路由 + 定点定时核查线程 |
| `matching.py` | 关单判定核心逻辑（GR_STATUS 优先，回退 UNTTO 容差判定） |
| `data_source.py` | 数据源适配：mock / csv / rfc |
| `invoices.py` | 发票清单读取（合并 `invoice/` 下全部 *.csv） |
| `storage.py` | SQLite：核对记录、通知日志、关闭标记、最近核查结果 |
| `notifier.py` | 通知：仅内部（SQLite 通知日志 + 控制台），零外部通信 |
| `config.py` | 全部配置走环境变量，默认值可直接演示 |
| `invoice/invoices.csv` | 示例发票清单（页面与定时核查的输入来源，当前 120 条测试数据） |
| `invoice/exchange_invoice_sync.py` | 内网 Exchange 邮箱发票抓取（EWS/NTLM，直读 auto@lechler.com.cn，分年存 CSV，**第 9 列写入来源标记 XML/PDF**，用法见 `invoice/README.md`） |
| `invoice/backfill_src.py` | 一次性回填来源列（存量 CSV 补 XML/PDF 角标数据。规则：有开票明细→XML，无明细有 PO 号→PDF；幂等可重复跑） |
| `rfc/` | RFC 查询脚本 + 设备部署指南（独立文档） |
| `install/` | Ubuntu 安装脚本仅 2 个：`bach_POClosing`（平台 + Exchange 发票抓取；`--verify` 验收 / `--uninstall` 卸载）→ `bach_POClosing_SAP`（NW RFC SDK + pyrfc；`--uninstall`，可后置），用法见 `install/README.md` |

**运行要求：Python ≥ 3.8，零第三方依赖**（仅 rfc 数据源模式需在设备上装 pyrfc）。

## 2. 快速开始（本机演示，mock 数据）

```bash
cd PO-Closing
python3 server.py
# 浏览器打开 http://127.0.0.1:8088
# 页面自动从 invoice/ 文件夹载入发票清单，并套用最近一次定时核查结果
# 点「批量查询 SAP」实时核查；勾选完整收货行 →「标记关闭选中 PO」
```

启动日志会打印当前模式：`数据源=mock`，以及 `定时核查: 03:33 / 12:33`。

## 3. 页面功能（发票维度 · 覆盖 PO 关闭情况）

生产级企业应用 UI：页头（标题+连接状态灯+定时核查时间）、KPI 卡、主表卡片（工具栏/表格/表脚）、页脚系统信息；黑白灰为底、KPI 卡状态色点缀（蓝=总数/绿=完整收货/琥珀=部分/红=待确认）；矩形直角、加载动画、空态、确认弹窗、Esc 关闭、响应式；纯 CSS/JS 实现，零外部依赖。

1. **发票清单来源（打开即载入）**：三级兜底——① 后端在线时从 `invoice/` 文件夹读取全部 `*.csv` 合并载入并自动套用最近一次定时核查结果；② 仅静态托管时直接读取 `invoice/invoices.csv`；③ 纯双击打开（file://）时使用内嵌清单快照。格式：`发票号,PO号,供应商,金额,开票日期,供应商编号,开票内容(JSON),人工标记,来源(XML/PDF)` 每行一条（后四列可省略；**来源列 = 发票号右上角的 XML/PDF 角标**，由抓取脚本写入，存量数据跑 `invoice/backfill_src.py` 回填；开票内容为例 `[{"name":"*服务*xx","qty":1,"total":6600.00}]`，悬浮发票号可见）
2. **批量查询 SAP**：以后端 `/api/po_status` 逐笔核查收货，结果**合并写入服务端快照（刷新/重开页面状态不丢）**；**已完整收货 / 已标记关闭的 PO 自动跳过不再重查**（请求带 `force:1` 可强制）；未查询前状态为「待查询」
3. **KPI 卡片**：发票 PO 总数 / 完整收货（可关闭，绿色突出）/ 部分收货 / 未收货·待确认（含未查询与查无此单）
4. **发票 PO 列表**：复选框、发票号（数字靠右，右上角 **XML/PDF 来源角标**）、PO 号、供应商、发票金额、收货进度条（完整收货纯黑、其余灰）、SAP 收货状态 pill、查看详情（行项目弹窗，**物料号去前导零显示**）；**完整收货行铺浅灰底 + 黑色左条**，仅完整收货行可勾选；**列头点击排序**（PO号/日期/金额/进度）、表头冻结、**分页显示**（每页 50/100 可选，表脚含范围信息与翻页控件）、表脚显示已选项数与数据更新时间；数字/状态列右对齐，列宽由 `<colgroup>` 统一控制（供应商名称列弹性吸收余量）；**导出 Excel**（工具栏按钮，导出当前筛选结果全部页为 .xlsx，原生 JS 手写 ZIP 生成，零依赖）
5. **标记关闭选中 PO**：勾选完整收货行 → **确认弹窗** → 一键标记，服务端 `/api/close` 写入 SQLite 留痕（不写 SAP；真实关单走 BAPI_PO_CHANGE，见 rfc/README.md §4），行状态变为「已标记关闭」
6. **搜索 / 筛选 / 日期检索**：按 PO 号、发票号、供应商搜索；按状态下拉筛选（含「已标记关闭」）；**按开票日期区间检索**（起止日期选择器），日期列可点击排序
7. **设置（页头齿轮）**：弹窗配置**每日同步时间**（HH:MM 逗号分隔，留空关闭）与**通知接收邮箱**（逗号分隔，仅内部登记）；服务端校验格式后写入 SQLite（settings 表）并即时生效，重启后自动加载，优先级高于环境变量默认值
8. **一键通知 / 定时核查**：沿用服务端 `/api/notify` 与定点调度线程（见 §5），结果写入内部通知日志
9. **读取邮件**：工具栏按钮手动触发内网 Exchange 发票抓取（`POST /api/mail_sync` → 服务端子进程执行 `exchange_invoice_sync.py`，脚本自动加载 `invoice/exchange.env`），执行结果**即时写到页头「邮件读取」状态标签**，完成后自动刷新清单；记录留痕通知日志
10. **导出**：工具栏「导出」把当前筛选结果（全部页）导出为 .xlsx

## 4. 切换真实数据（上线步骤）

### 4.1 推荐：csv 模式（与 RFC 脚本解耦，最稳）

```bash
# 1) 在已部署 pyrfc 的 Ubuntu 设备上生成数据（详见 rfc/README.md）
python3 /var/www/lnsc-apps/apps/po-closing/rfc/po_gr_check.py po_list.csv /var/www/lnsc-apps/apps/po-closing/result.csv

# 2) 以 csv 模式启动
export POCLOSE_DATA_SOURCE=csv
export POCLOSE_CSV=/var/www/lnsc-apps/apps/po-closing/result.csv
python3 /var/www/lnsc-apps/apps/po-closing/server.py
```

数据刷新 = 重跑第 1 步（页面再次查询即读新文件，无需重启服务）。

### 4.2 可选：rfc 模式（页面查询实时调 SAP）

```bash
export POCLOSE_DATA_SOURCE=rfc
export POCLOSE_RFC_SCRIPT=/var/www/lnsc-apps/apps/po-closing/rfc/po_gr_check.py
# SAP 连接参数沿用 rfc/README.md 的 SAP_* 环境变量
python3 /var/www/lnsc-apps/apps/po-closing/server.py
```

> 前提：设备已装 SAP NW RFC SDK + pyrfc，且运行 webapp 的 Python 环境能 import pyrfc。

### 4.3 升级部署（重新上传的完整步骤）

**简版 4 步**：整文件夹上传 → 同步落位（排除服务器本地数据）→ 语法检查 → 重启验收。
（角标回填只有首次或 CSV 重建后才需要，已含在下方第 3 条）

**具体**：

1) **上传**：本机整个 `PO-Closing` 文件夹一次性传到服务器（WinSCP 拖入 / scp -r 均可）：

```powershell
scp -r c:\Users\zhlo\Documents\VSCode\AI\AI\PO-Closing user@10.4.26.10:/tmp/
```

2) **同步落位**：rsync 覆盖到应用目录。⚠ 必须排除服务器本地数据——`.env`（SAP 密码）、`poclose.db`（快照/留痕）、`invoice/*.csv`（生产发票清单）；本机仓库不含 .env，但本机的演示 db/csv 不能盖上去：

```bash
sudo rsync -a --delete \
  --exclude '.env' --exclude 'poclose.db' --exclude 'venv/' \
  --exclude 'invoice/*.csv' --exclude 'result.csv' --exclude 'po_list.csv' \
  --exclude '__pycache__/' \
  /tmp/PO-Closing/ /var/www/lnsc-apps/apps/po-closing/
```

3) **语法检查 + 回填角标**（回填仅首次或 CSV 重建后需要，幂等）：

```bash
cd /var/www/lnsc-apps/apps/po-closing
venv/bin/python -m py_compile server.py invoices.py matching.py data_source.py \
  invoice/exchange_invoice_sync.py invoice/backfill_src.py rfc/po_gr_check.py && echo 语法OK
sudo venv/bin/python invoice/backfill_src.py
```

4) **重启 + 验收**：

```bash
sudo systemctl restart poclose
curl http://127.0.0.1:8088/api/health     # 期望 "source": "rfc"
```

浏览器 **Ctrl+F5** 强刷后按 §7 验收。**回滚**：`.env` 改 `POCLOSE_DATA_SOURCE=csv`（吃最近一次快照/周快照）→ `sudo systemctl restart poclose`。

## 5. 环境变量与落地配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `POCLOSE_HOST` / `POCLOSE_PORT` | `127.0.0.1` / `8088` | 监听地址；对外共享用 `0.0.0.0`（请在网络层控制访问） |
| `POCLOSE_DATA_SOURCE` | `mock` | `mock` / `csv` / `rfc` |
| `POCLOSE_CSV` | `result.csv` | csv 模式数据文件 |
| `POCLOSE_DB` | `poclose.db` | SQLite 库文件 |
| `POCLOSE_INVOICE_DIR` | `invoice/` | 发票清单目录（读取全部 *.csv 合并） |
| `POCLOSE_SCHEDULE_TIMES` | `03:33,12:33` | 每天定点核查时刻（HH:MM 逗号分隔，置空关闭）；**页面「设置」修改后存 SQLite 并覆盖此默认值** |
| `POCLOSE_SCHEDULE_NOTIFY` | `0` | 定时核查后自动记录通知（内部日志） |

### 5.1 通知（仅内部，零外部通信）

通知**不做任何外部发送**：一键通知 / 定时核查自动通知的结果都写入 SQLite `notify_log` 表，并输出到服务日志（`journalctl -u poclose -f` 可见）。「设置」弹窗中登记的接收邮箱仅作记录展示。查看路径：通知日志接口 `GET /api/notify/log`。

### 5.3 定时任务两种做法（可叠加）

- **服务内置定点核查（默认开启）**：每天 **03:33** 与 **12:33** 自动执行「读取 invoice 目录 → 连接 SAP 判定 → 结果写入 SQLite」，页面打开时自动套用最近结果（`GET /api/last_run`）；设 `POCLOSE_SCHEDULE_NOTIFY=1` 可同时推送通知
- **系统 cron**（负责刷新 csv 数据，配合 4.1）：

```cron
0 8 * * 1  cd /var/www/lnsc-apps/apps/po-closing && ./venv/bin/python rfc/po_gr_check.py po_list.csv result.csv >> /var/log/pocheck.log 2>&1
```

### 5.4 systemd 常驻（Ubuntu 设备）

```ini
# /etc/systemd/system/poclose.service
[Unit]
Description=PO-Closing Web
After=network.target

[Service]
WorkingDirectory=/var/www/lnsc-apps/apps/po-closing
EnvironmentFile=/var/www/lnsc-apps/apps/po-closing/.env   # 生产配置（含 SAP_*，600 root；模板见 env.production.txt）
ExecStart=/usr/bin/python3 server.py
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now poclose
```

## 6. 安全设计（默认即安全）

- **零外部通信**：除主动连接内网 SAP/Exchange 外，不发起任何外发请求（无 Webhook、无 SMTP）；通知全部落在本机 SQLite + 日志
- 前端零业务逻辑：判定/核对/通知全部服务端完成，页面源码看不到任何规则
- 默认绑定 `127.0.0.1`；对外共享用 `0.0.0.0` 时请在网络层（防火墙/反向代理）控制访问
- 仅托管固定 `index.html`，无目录遍历；POST 体限 1MB；PO 号纯数字校验
- 前端渲染一律 `textContent`，杜绝 XSS；服务端错误不返回堆栈
- 通知默认 dry-run；密码/密钥一律走环境变量，不落源码
- 需要 HTTPS 时前面挂 nginx 反代即可（`proxy_pass http://127.0.0.1:8088`）

## 7. 验收清单

- [ ] `python3 server.py` 启动后浏览器打开页面，自动载入 `invoice/` 清单并显示状态
- [ ] 点「批量查询 SAP」返回状态 pill（完整收货/部分收货/未收货/查无此单）与进度条
- [ ] 发票号右上角显示 XML/PDF 角标（整列为空 = 未跑 `invoice/backfill_src.py` 回填）
- [ ] 详情弹窗物料号去前导零（显示 105635 而非 0000000000105635）
- [ ] 查询后刷新/重开页面：已查状态全部保留；再次查询时完整收货与已标记关闭的 PO 自动跳过（toast 显示跳过笔数）
- [ ] 勾选完整收货行 →「标记关闭选中 PO」→ 行变「已标记关闭」，刷新后仍在
- [ ] 到点（03:33/12:33）后 `last_run` 落库，重开页面自动套用最近核查结果
- [ ] 页头齿轮打开设置：改同步时间为当前时间后 1~2 分钟 → 保存 → 到点日志打印 `[verify]` 且页面时间更新；填邮箱保存后重开仍在
- [ ] csv 模式指向真实 `result.csv` 后，结果与 ME23N 抽查一致（沿用 rfc/README.md §3 抽查表）

## 8. 后续扩展：自动关单闭环

核对数据稳定后，在 RFC 侧追加 `BAPI_PO_CHANGE` 自动置「交货完成」，步骤与灰度策略见 `rfc/README.md` 第 4 节；Web 侧可增加「执行关单」按钮调用同一连接（写操作务必先 QAS 演练）。
