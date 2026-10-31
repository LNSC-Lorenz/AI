# tools/merge-hint — 今日可合并清单（每日提示）

每天把「同承运商 + 同收件地址 + 同收件人 + 同电话、且都还没下单」的单据挑出来，告诉车间这几张可以合成一张运单，并给出可省票数。

**只读**：只调 `GET /api/orders`，不写库、不下单、不改 Fahuo 应用代码。目录在 `tools/` 下，不在 `apps/` 里，`deploy.ps1` 不会把它部署到服务器。

## 分组口径（与 App 完全一致）

与下单页「合并」开关同一严格键（见 `apps/Fahuo/assets/js/pages/2-order.js` 的 `mergeKeyOf`）：

```
单据类型 + 承运商 + 省 + 市 + 区 + 街道 + 收件人 + 电话   逐项完全相等
```

- 只统计**待下单**行（`waybill_no` 为空）；已下单的行不会被列进来。
- 今天的单子 + 逾期未下单的单子一起分组（逾期的今天补发时同样能拼一票），并标注逾期档。
- 承运商还没选的行无法下单也无法合并，单独列在「缺承运商」区；同收件凑够 2 张时会提示「选好承运商后即可合成 1 张运单」。
- **App 目前只对外协单开放合并下单**，所以清单里：外协组标注「App 可直接合并：外协单页签 → 多选 → 合并」；发货单/其他组标注「App 暂未开放合并下单」，只做拆单量提示（2026-10-28 决策：暂不改 App，先看清单价值）。
- 末尾附**昨日拆单复盘**：昨天同一收件信息实际开出几张运单、本可省几张，用来验证值不值得开合并。

## 用法

```powershell
# 直接跑核心脚本（清单打印到屏幕，同时写文件）
node tools\merge-hint\merge-hint.mjs

# 推荐用包装脚本（自动切 UTF-8 控制台，中文不乱码）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\run-daily.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\run-daily.ps1 -Open    # 生成后用记事本打开
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\run-daily.ps1 -Clip    # 复制到剪贴板，直接贴群里
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\run-daily.ps1 -Date 2026-10-27

# 每天 07:45 自动出清单并弹窗（当前用户，无需管理员权限）
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\install-task.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\install-task.ps1 -Time 08:30 -NoOpen
powershell -NoProfile -ExecutionPolicy Bypass -File tools\merge-hint\install-task.ps1 -Uninstall
```

| 参数 | 说明 |
|---|---|
| `--date=YYYY-MM-DD` / `-Date` | 指定“今天”，默认取本机当天 |
| `--base=URL` / `-Api` | API 地址，默认 `http://10.86.180.76/apps/fahuo/api`，也可用环境变量 `FAHUO_API` |
| `--out=文件` | 输出文件，默认 `%USERPROFILE%\Documents\Fahuo\可合并清单-YYYY-MM-DD.txt`（带 BOM，记事本直接可读） |
| `--json` | 输出结构化 JSON（给别的脚本/看板用，不写文件） |
| `--quiet` | 不打印到屏幕，只写文件 |

依赖：Node.js 18+（用内置 `fetch`）。服务器不通时报错退出码非 0，不产生半成品文件。

## 文件

| 文件 | 作用 |
|---|---|
| `merge-hint.mjs` | 核心：拉单 → 按严格键分组 → 出清单（文本/JSON） |
| `run-daily.ps1` | 每日运行包装：UTF-8 控制台、默认输出路径、`-Open` 弹窗、`-Clip` 贴剪贴板 |
| `install-task.ps1` | 注册/删除 Windows 计划任务（任务名 `FahuoMergeHint`，当前用户） |

## 边界

- 清单是**建议**，不会替你在 App 里下单；发货单/其他类型的合并下单尚未在 App 开放。
- 严格键不做地址模糊匹配：同地址但字符串不同（多个空格、全半角、街道留空与否）会被判成不同收件，与 App 拦截行为一致。
- 数据取 `/api/orders` 默认最近 500 行，按 `ship_date` 过滤当天与逾期，够覆盖日常量；跨年历史不在范围内。
