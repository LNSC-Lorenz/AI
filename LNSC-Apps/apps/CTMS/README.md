# HTML-ToolM_App_1210

刀具出入库管理系统 - HTML版本

## 说明

本项目是 `ToolM_App_1210` WPF版本的HTML模式转换，所有UI保持一致。

## 技术栈

- 前端：纯 HTML/CSS/JavaScript + SheetJS/xlsx（替代 MiniExcel）
- 后端：`server.js` — 零依赖 Node.js 服务（需要 Node.js 22+，内置SQLite）
- 数据库：服务器上的 SQLite（`toolinventory-server.db`），**多台电脑共享同一份库存数据**

## 架构（正式部署：nginx 统一入口 + 独立后端，与 PO-Closing 同模式）

```
浏览器（多台电脑） ⇄ nginx :443/80
                        ├─ /apps/ctms/      静态前端（/var/www/lnsc-apps/apps/ctms/）
                        └─ /apps/ctms/api/  反代 → 127.0.0.1:3001/api/
                                                      ⇄ CTMS server.js (systemd ctms.service)
                                                      ⇄ /opt/ctms/toolinventory-server.db (SQLite)
```

- **每个应用一个独立后端服务**（PO-Closing=8088 / CTMS=3001），nginx 做统一入口反代；门户 server.js (:3000) 也内置了同样的 `/apps/ctms/api → 3001` 反代，双保险
- nginx 反代补丁由 `PO-Closing/install/bach_POClosing_proxy` 统一打入（已含 CTMS 段，幂等）
- 前端 `db.js` 自动探测 API 地址：先试 `/apps/ctms/api/`（nginx/门户反代），不通则**浏览器直连 `http://<服务器>:3001/api/`**（后端带 CORS；仅限 HTTP 内网，HTTPS 站点必须走反代）
- 所有出入库操作实时写入服务器数据库，**多台电脑共享同一份数据，实时一致**
- 需要 **Node.js 22.13+**（内置 node:sqlite；验证：`node -e "require('node:sqlite')"`）
- 首次启动时若数据库为空，`server.js` 自动从 `initial_inventory.js` 导入 WPF 版历史数据（seed 后自动归档为 `.bak`）
- 前端不引用 `initial_inventory.js`（仅后端 seed 使用）

## 本地测试（Windows）

```powershell
node server.js 3000
# 浏览器打开 http://localhost:3000
```

## 部署方法（Ubuntu，一键脚本，与 PO-Closing 同模式）

### 1. 上传 CTMS 目录到服务器后，执行安装脚本

```bash
sudo bash install/bach_CTMS
```

脚本自动完成：
- 前端文件 → `/var/www/lnsc-apps/apps/ctms/`（页面 + 初始化Excel）
- 后端 `server.js` + `user_info.txt` + `initial_inventory.js` → `/opt/ctms/`（web root 之外，防下载）
- 数据库：已存在则**保留**（更新代码不丢数据）；没有则拷贝仓库内的 `toolinventory-server.db`
- 创建 `ctms.service`（端口 3001，开机自启，自动重启）
- ufw 放行 3001（前端直连兜底，与 PO-Closing 8088 同模式）
- 自检：`/api/health` + 库存记录数

卸载：`sudo bash install/bach_CTMS --uninstall`（保留数据目录）

### 2. nginx 统一入口反代（一次即可，含 CTMS 段，幂等）

```bash
sudo bash PO-Closing/install/bach_POClosing_proxy
curl http://127.0.0.1/apps/ctms/api/health   # 应返回 {"ok":true}
```

> 不配 nginx 也能用：前端会自动改为浏览器直连 `http://<服务器>:3001`（限 HTTP 内网；HTTPS 站点必须配反代）。

### 3. 前提：服务器 Node.js 22.13+（内置 node:sqlite）

```bash
node -e "require('node:sqlite'); console.log('node:sqlite OK')"
# 版本不足时脚本会自动在服务启动参数中加 --experimental-sqlite
```

### 4. 配置"上传Excel"写入路径（页面【上传Excel】按钮需要）

后端在 `/opt/ctms` 运行，而 Excel 在 web 目录，需用环境变量告诉后端真实路径：

```bash
sudo mkdir -p /etc/systemd/system/ctms.service.d
sudo tee /etc/systemd/system/ctms.service.d/override.conf << 'EOF'
[Service]
Environment=EXCEL_PATH=/var/www/lnsc-apps/apps/ctms/data/车间工具库存管理-信息表.xlsx
EOF
sudo systemctl daemon-reload && sudo systemctl restart ctms

# 验证接口（应返回"文件内容无效或过小"而非 Not Found）
curl -X POST http://127.0.0.1:3001/api/upload-excel
```

> 不配也能跑系统，只是【上传Excel】按钮会把文件写到 `/opt/ctms/` 下（页面拿不到）。

### 5. 访问

- 门户首页点击 **CTMS** 卡片，或直接打开 `http://<服务器IP>/apps/ctms/`
- CTMS 卡片注册在门户 `apps.json` 中（内置应用，不会从门户 UI 被误删）
- 多台电脑同时打开时，操作结果实时写入同一数据库，刷新页面即可看到最新库存

## 数据管理

- **数据库文件**：`/opt/ctms/toolinventory-server.db`（唯一数据库，web root 之外防下载）
- **主数据 Excel**：`/var/www/lnsc-apps/apps/ctms/data/车间工具库存管理-信息表.xlsx`（库位/名称/安全库存等静态主数据的唯一权威，见下方"功能更新"第 5、6 条）
- **初始数据归档**：首次导入成功后自动将 `initial_inventory.js` 重命名为 `.bak`，避免误删数据库后静默用旧数据重建
- **每日自动备份**（凌晨2点，保留最近30天）：

```bash
sudo mkdir -p /backup/ctms
echo '0 2 * * * root cp /opt/ctms/toolinventory-server.db /backup/ctms/toolinventory-$(date +\%Y\%m\%d).db && find /backup/ctms -name "*.db" -mtime +30 -delete' | sudo tee /etc/cron.d/ctms-backup
```

- **恢复备份**：停止门户服务 → 用备份文件覆盖 `toolinventory-server.db` → 重启门户服务
- **导出报表**：页面底部按钮直接生成Excel下载

## 功能对照

| WPF 功能 | HTML 实现 |
|----------|-----------|
| SQLite 数据库（本机） | SQLite 数据库（服务器，多机共享） |
| MiniExcel | SheetJS (xlsx) |
| WPF 控件 | HTML/CSS 自定义组件 |
| 扫码枪输入 | 键盘事件监听 |
| 导出 Excel | 浏览器下载 xlsx 文件 |

## 目录结构（2026-10 重组为标准 HTML5 布局）

```
CTMS/
├── index.html            # 页面入口
├── css/styles.css        # 样式
├── js/                   # 前端脚本：app.js(主逻辑) / db.js(API服务) / user_info.js(用户数据)
├── lib/xlsx.full.min.js  # 第三方库：SheetJS
├── assets/               # 图标等静态资源（lechler logo）
├── data/车间工具库存管理-信息表.xlsx   # 主数据 Excel（前端 fetch 读取，上传Excel写入）
├── rfc/                  # SAP RFC 脚本（部署见 rfc/README.md）
├── install/bach_CTMS     # Ubuntu 一键安装脚本
└── server.js / user_info.txt / initial_inventory.js / *.db   # 后端（部署于 /opt/ctms，web root 之外）
```

## 界面结构

- **主界面**: 5列柜子网格布局，每个柜子含多个抽屉和状态指示灯
- **详情界面**: 左侧柜子预览 + 中间刀具卡片(8×4) + 右侧操作面板
- **底部功能栏**: 导出操作按钮 / 柜子快速切换按钮

## SAP RFC：工单物料查询（2026-10，移植自 PO-Closing）

- 新增 `POST /api/order-material`：按工单号实时查 SAP 物料信息（`Z_OA_GET_ORDERMAT_ORDERNR`），返回物料号/描述/单位/工单数量(GAMNG)等
- 依赖服务器端 pyrfc 环境（SDK 与 PO-Closing 同机复用），部署与验证步骤见 `rfc/README.md`
- 本机 Windows 开发无需任何依赖，接口会返回友好错误，不影响其他功能
- **【生成出入库记录】新增 3 列**（追加在末尾，原有 A–M 列不动）：
  - `工单数量` = SAP GAMNG（按导出记录中的工单号批量实时查询；查无此单或 RFC 不可用则留空，导出不受阻）
  - `产品图号` = SAP 物料描述 MAKTX
  - `单价汇总` = 数量(K列) × 单价(D列)，两位小数
- **SAP 查询体验与稳定性**（2026-10-16）：RFC 接口为单工单逐条查询（约 0.3~0.5s/条），导出时显示"正在查询SAP工单信息（x/y）"进度遮罩，分批 50 个/次避免超时；后端 RFC 调用由 spawnSync 改为异步 execFile（修复查询期间整个 CTMS 后端阻塞所有 API 的问题），超时默认放宽到 5 分钟（`CTMS_RFC_TIMEOUT_MS`）

## 功能更新（2026-09）

1. **出库数量与工单数量独立**：扣账数量（数字键盘）和工单信息（含工单数量）互不影响
   - 只填扣账数量 → 仅扣账出库
   - 只填工单信息 → 仅登记工单（库存不变，写入一条"变化数量=0"的记录，导出类型显示"工单登记"）
   - 两者都填 → 扣账+绑定工单存同一条记录，导出在同一个表格（"变化数量"与"数量"两列）
2. **工单信息保留**：工单号/物料名称/材质/数量提交后不再自动清空，同一工单可连续领用，不需要时手工删除
3. **防重复扣账**：出入库请求未完成时屏蔽重复点击（修复偶发"领1件扣多件"）
4. **库位搜索**：主界面左下角搜索框，按型号/名称/SAP号/唯一ID/品牌模糊查找，结果显示库位（柜/抽屉/行/位）和当前库存，点击（或回车）直接跳到对应柜抽屉并闪烁高亮目标卡片。模糊匹配做了归一化：全角→半角、忽略大小写、忽略空格和 `- _ / \ . × Φ` 等分隔符（`D10.5-45`、`d10 5 45`、`10545` 互相可搜）
5. **Excel 为主数据权威**：每次页面加载时，自动把 Excel 中的物料名称同步覆盖到数据库（只覆盖不清空）；出入库时同理。改名称只需改 Excel，刷新页面即全系统生效。同时前端加载 Excel 已禁用浏览器缓存（`no-store`），保证每次拿到的都是最新表
6. **页面上传Excel**：搜索框右侧【上传Excel】按钮，选择新版 xlsx 后直接写入服务器 web 目录（旧文件自动备份为 `…-备份日期-时间.xlsx`），上传后页面立即用新表刷新，无需 SSH/拷贝。需配置 `EXCEL_PATH` 环境变量（见"部署方法"第 4 步）。历史流水中的物料名称保留当时快照不回溯；新记录自动使用 Excel 名称
7. **上传Excel时同步 M/N 库存列**（2026-10）：Excel 的 `新品库存`(M列)/`旧品库存`(N列) 此前仅在建库初始化时用一次，之后改动无效。现在上传新表后，自动比对新表数量与软件实时数量，**弹出差异清单（前 10 项预览），确认后才以 Excel 为准更新**；某列留空 = 该列不动，0 是有效值；变更逐条写入出入库历史（人员记为 `Excel同步`，含变更前后数量，导出记录可追溯）。**日常打开页面不做此同步**——Excel 是静态快照，若每次加载都以它为准，会把未及时更新表格期间的出入库结果覆盖回退

