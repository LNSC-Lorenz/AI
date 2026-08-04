# 打印机清单

内网网页应用：遍历打印服务器 `lcnnsc-print01` / `lcnnsc-print02` 上的所有共享打印机，
员工在页面上点击「连接打印机」即可直接安装到本机（等同资源管理器里双击 `\\lcnnsc-print01\共享名`）。
纯静态单页（HTML + CSS + JS，无框架、无构建），通过 LNSC-Apps 平台部署。

## 架构

```
Windows 打印服务器 lcnnsc-print01 / lcnnsc-print02
        │  (Get-Printer 远程枚举)
        ▼
1_export-printers.ps1  ──生成──► printers.json ──scp──► Web 服务器
        (任意加域 Windows 机器，建议计划任务每小时运行)

浏览器 index.html + printers.json
        │  点击「连接打印机」
        ▼
file://///lcnnsc-print01/<共享名>  (Edge 浏览器 + IntranetFileLinksEnabled 域策略)
        ▼
系统直接打开打印机共享 → 弹出连接/安装窗口
```

浏览器安全模型不允许 http 页面任意跳 file://，解锁方式是域控推送 Edge 策略
`IntranetFileLinksEnabled`（允许 Intranet 区域站点使用 file: 链接）。
用户侧零下载、零安装、零额外操作，点按钮即连接。仅支持 Edge。

## 文件说明

| 文件 | 用途 |
|------|------|
| `index.html` | 应用页面结构 |
| `script.js` | 前端逻辑（加载清单、搜索/筛选/排序、file:// 一键直连） |
| `style.css` | 样式（工业 HMI 风） |
| `printers.json` | 打印机清单（示例数据，由 `1_export-printers.ps1` 生成覆盖） |
| `1_export-printers.ps1` | **导出脚本**（加域 Windows 机器）：远程枚举共享打印机 → 生成 `printers.json` → scp 上传 |
| `0_README.md` | 本文档 |

## 功能

- **汇总卡片**：打印机总数 + 各服务器数量
- **搜索 / 筛选**：全局搜索（名称/共享名/位置/驱动/备注）；按服务器、按位置下拉筛选
- **排序**：点击表头排序，默认按名称
- **一键连接**：点「连接打印机」直接调起系统连接安装（Edge + 域策略，用户零额外操作）
- **完整 UNC 路径**：共享名列直接显示 `\\服务器\共享名`，方便复制使用

## 部署

1. **前端上传**：在 LNSC-Apps 平台上传 `index.html` + `script.js` + `style.css` + `printers.json`，
   **应用名固定填 `Printing`**（ID 自动转小写 `printing`，与导出脚本上传路径 `/var/www/lnsc-apps/apps/printing/` 对应）。

2. **导出脚本**：把 `1_export-printers.ps1` 放到任意一台加域 Windows 机器（如管理跳板机）：
   ```powershell
   # 首次手动运行验证
   powershell -ExecutionPolicy Bypass -File .\1_export-printers.ps1

   # 配计划任务每小时运行（示例）
   schtasks /create /tn "LNSC-ExportPrinters" /tr "powershell -ExecutionPolicy Bypass -File C:\scripts\1_export-printers.ps1" /sc hourly /ru SYSTEM
   ```
   - 运行账号需能远程枚举打印服务器（域内默认 Authenticated Users 可读，若被收紧则加 Print Operators 组）
   - 上传依赖 `scp` + 到 `sysadmin@10.86.180.76` 的 SSH key 免密登录；
     不想配免密也可以只生成本地 `printers.json`，手动 scp 上传

3. **Edge 域策略**（一键直连的前提，域控一次性配置，用户无感知）：
   - **允许 Intranet 站点使用 file: 链接**：
     GPO → 计算机配置 → 管理模板 → Microsoft Edge →
     `允许来自 Intranet 区域的 file: 链接`（IntranetFileLinksEnabled）= **已启用**
   - **确保站点属于 Intranet 区域**（IP 站点默认不在）：
     GPO → 计算机配置 → 管理模板 → Windows 组件 → Internet Explorer → Internet 控制面板 → 安全页 →
     `站点到区域分配列表`：添加 `http://10.86.180.76` = **1**（本地 Intranet）
   - `gpupdate /force` 后生效，仅 Edge 支持该策略（Chrome 无对应机制）

## 常见问题

- **页面显示 PRINTERS.JSON NOT FOUND**：清单未上传，先运行 `1_export-printers.ps1`。
- **点「连接打印机」没反应**：确认用的是 Edge；`edge://policy` 检查 IntranetFileLinksEnabled 是否生效；
  确认 `http://10.86.180.76` 已被站点到区域分配列表划入本地 Intranet 区域；
  都未生效前可按 Toast 提示 Win+R 手动运行 UNC 路径。
- **新加的打印机网页看不到**：等下一个计划任务周期，或手动重跑导出脚本。
- **前端重新上传会覆盖 printers.json**：用本地示例数据覆盖了服务器真实清单，等下次导出自动恢复（与 LibQ/QMS 相同特性）。
