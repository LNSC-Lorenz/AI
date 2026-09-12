# LNSC 仓储库位动态视图 | BinVision

可视化 LNSC 仓库各仓储区（HRS / AC / SC / RMS / RMO / RMT / RMW）库位饱和度的内网网页应用。
数据来自 RPA 自动生成的「物料移动频次.xlsx」（列：`MATNR / PART_NO / DESCRIPTION / LGTYP / LGPLA / CHARG / COUNT`，
取 LGTYP + LGPLA + COUNT 三列），COUNT 区按品类数、SUM 区按库存总量，
红/黄/绿/灰四色显示库位状态。纯静态单页（HTML + CSS + JS，无框架、无构建），通过 LNSC-Apps 平台部署。

## 架构

（与 Purchase_Search_Drawing 完全一致的发布架构）

```
共享盘 \\10.86.180.4\Department\LNSC-12_LD-Logistics\05_Mixed\12-M_Muti\
        99_RPA\01_AutoJob_RPA02_06\06_DataOutput\物料移动频次.xlsx
  （RPA 自动生成并定期更新，无需人工放置）
        │  (CIFS 只读挂载)
        ▼
Ubuntu 服务器 /var/www/lnsc-apps/binstock          ← 1_mount-stock.sh
        ▼
stock.json (库存索引，服务器扫描该文件生成)          ← 2_scan-stock.sh (+cron 每 30 分钟)
        ▼
浏览器 index.html  (运行时 fetch stock.json，计算库位饱和度并渲染)
```

- 网页部署访问时，页面启动即 `fetch('stock.json', {cache:'no-store'})`，所有用户看到同一份数据。
- 本地双击 `index.html`（file:// 协议）时不 fetch，自动回退到「本机导入数据 / 内置示例数据」。
- 手动导入（📥 导入库存报告）仍保留：数据存本浏览器 localStorage，仅本机生效；
  点击「清空所有库存数据」即恢复为服务器共享数据。

## stock.json 格式

由 `2_scan-stock.sh` 生成（`stock.json` 必须与 `index.html` 同目录）：

```json
{
  "generated": "2026-08-21 10:30",
  "file": "物料移动频次.xlsx",
  "rows": [["LGTYP", "LGPLA", COUNT], ["HRS", "05-02-10", 7], ...]
}
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `index.html` | 应用本体（界面 + 全部前端逻辑），启动时 fetch `stock.json` |
| `lib/xlsx.full.min.js` | SheetJS 解析库，随应用一起上传（内网手动导入 Excel 无需外网，本地缺失时回退 CDN） |
| `stock.json` | 库存索引（服务器扫描生成，**不要手工维护**），本地仓库不保留 |
| `README.md` | 本文档 |
| `1_mount-stock.sh` | **服务器**一次性配置：将 RPA 数据输出目录 CIFS 挂载到 `/var/www/lnsc-apps/binstock`（写 fstab，重启自动恢复），并安装报告解析依赖 |
| `2_scan-stock.sh` | **服务器**扫描脚本：读取挂载点中的 `物料移动频次.xlsx`，解析 LGTYP/LGPLA/COUNT 生成 `stock.json`，首次运行自动注册 cron（每 30 分钟） |

## 功能

- **四色饱和度**：COUNT 区（HRS/AC/SC）按库位品类数、SUM 区（RMS/RMO/RMT/RMW）按库存总量，阈值可调。
- **HRS 货架立面图**：01/02 排双深度、03/04/05 排单深度，按真实「列 × 层」布局渲染。
- **汇总卡片**：每区库位总数、已用数、🟢🟡🔴⚪ 分布。
- **自动更新**：RPA 更新「物料移动频次.xlsx」后，`stock.json` 由 cron 自动重扫（每 30 分钟），网页数据随之更新，**全员共享、无需上传、无需人工干预**。
- **手动导入（本机覆盖）**：支持 .xls / .xlsx / .csv，自动识别表头（LGTYP/LGPLA + 数量列 STOCK/AVAILABLE/COUNT）；追加模式可分批导入。
- **库位表管理**：内置全量库位表，可在线编辑并持久化到浏览器。

## 数据源：物料移动频次.xlsx

由 RPA 任务 `AutoJob_RPA02_06` 自动生成并定期更新（无需人工放置文件）。列结构：

| MATNR | PART_NO | DESCRIPTION | LGTYP | LGPLA | CHARG | COUNT |
|-------|---------|-------------|-------|-------|-------|-------|

- `LGTYP`（仓储区）+ `LGPLA`（库位号）两列定位，表头须在前 10 行内。
- 数量列按 `STOCK` → `AVAILABLE` → `COUNT` 优先级识别（当前报告为 `COUNT`，即该库位上该物料的数量）。
- 同一库位多条物料记录时：COUNT 区按库位去重计数，SUM 区按库位把 COUNT 加总。
- 七大仓储区之外的区（P01~P13、GF、FWA/FWW、901/902/911/914/916/917/922/999 等拣选/暂存区）自动忽略，不计入库位饱和度。
- 文件名固定为 `物料移动频次.xlsx`；若文件临时缺失，扫描脚本回退取目录中最新的 .xls/.xlsx/.csv/.txt 文件，并保留旧的 `stock.json` 不清空。

## 部署（两条命令 + 前端上传）

服务器端依次运行两个脚本（可重复执行）：

```bash
scp 1_mount-stock.sh 2_scan-stock.sh sysadmin@10.86.180.76:/home/sysadmin/
ssh sysadmin@10.86.180.76 'sudo bash /home/sysadmin/1_mount-stock.sh && sudo bash /home/sysadmin/2_scan-stock.sh'
```

- **`1_mount-stock.sh`**：装 cifs-utils → 写凭据 → 挂载共享盘到 `/var/www/lnsc-apps/binstock` → 写入 fstab（重启自动恢复）→ 安装 python3/openpyxl/xlrd 解析依赖。
- **`2_scan-stock.sh`**：自动注册 cron（每 30 分钟）→ 预创建部署目录 → 解析最新报告生成 `stock.json` 到 `APP_DIR`。

然后前端上传 `index.html` + `lib/` 整个目录，**应用名固定填 `BinVision`**（ID 自动转小写 `binvision`，与脚本 `APP_DIR` 对应）。

> **重要**：`2_scan-stock.sh` 顶部的 `APP_DIR` 必须改成本应用在平台上的实际部署目录
> （`/var/www/lnsc-apps/apps/<应用ID>`，应用 ID = 上传时应用名的小写）。
> `stock.json` 必须与 `index.html` 位于同一目录，前端的 `fetch('stock.json')` 才能取到。

数据由 RPA 自动更新（`物料移动频次.xlsx`），最多 30 分钟网页自动刷新，无需人工干预。

> 注意：前端重新上传应用会用本地文件覆盖服务器目录，`stock.json` 会在下一个 cron 周期自动重新生成。

## 配置项

| 位置 | 配置 | 说明 |
|------|------|------|
| `1_mount-stock.sh` | `SHARE` | RPA 数据输出目录共享路径（`.../01_AutoJob_RPA02_06/06_DataOutput`） |
| `1_mount-stock.sh` | `MOUNT_POINT` | 服务器挂载点（默认 `/var/www/lnsc-apps/binstock`） |
| `2_scan-stock.sh` | `SRC` | 须与 `MOUNT_POINT` 一致 |
| `2_scan-stock.sh` | `REPORT_NAME` | RPA 固定输出文件名（默认 `物料移动频次.xlsx`） |
| `2_scan-stock.sh` | `APP_DIR` | 前端部署目录（`/var/www/lnsc-apps/apps/binvision`） |

## 常见问题

- **网页显示「内置部分数据」而不是服务器数据**：`stock.json` 未生成或不在应用目录。
  先在服务器运行 `2_scan-stock.sh`，确认挂载目录中存在 `物料移动频次.xlsx`、脚本里的 `APP_DIR` 与前端部署目录一致。
- **扫描报「未找到表头」**：报告前 10 行里没有同时包含 `LGTYP` 和 `LGPLA` 的表头行。
- **扫描报 .xls 需要 python3-xlrd**：服务器执行 `sudo apt-get install -y python3-xlrd`，或将报告另存为 `.xlsx` / `.csv`。
- **挂载失败**：确认共享盘路径存在、凭据账号有读权限；重新运行 `1_mount-stock.sh`。
- **手动导入按钮无反应/报错 SheetJS 加载失败**：确认 `lib/` 目录随应用一起上传（内网无外网时 CDN 不可达）。
- **本地双击 index.html**：file:// 下无法 fetch，属正常现象，页面自动使用本机导入/内置示例数据。
