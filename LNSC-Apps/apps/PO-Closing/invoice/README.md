# invoice/ · 发票清单数据源

本目录是 PO-Closing 平台的发票清单数据源：webapp 启动/定时核查时读取目录下**全部 `*.csv`** 合并去重（格式：`发票号,PO号,供应商,金额,开票日期`，日期可省略）。

| 文件 | 说明 |
|---|---|
| `invoices.csv` | 示例/手工清单（当前 120 条测试数据） |
| `exchange_invoice_sync.py` | 内网 Exchange（EWS/NTLM）抓取 XML 发票，直读 auto@lechler.com.cn |
| `invoices_<YYYY>.csv` | 脚本产出（按开票年份分文件，自动与既有内容合并去重） |

## 模式说明：转发到内网 Exchange（当前采用）

ap-invoice 是 M365 共享邮箱（应用注册链路复杂，已弃用 Graph 方案）。现在的发票链路：

```
供应商发票邮件 → ap-invoice（M365 共享邮箱）
  →【M365 转发规则，IT 一次配置】→ auto@lechler.com.cn（内网 Exchange）
    → exchange_invoice_sync.py（EWS + NTLM）读取 → 解析 XML → 分年 CSV
```

> M365 侧转发建议用「**重定向**」（邮件流规则/ForwardingSmtpAddress），原邮件原样落地、附件不嵌套。

## exchange_invoice_sync.py 使用指南

### 1. 配置凭据（`/var/www/lnsc-apps/apps/po-closing/invoice/exchange.env`，600 仅 root 可读）

```bash
EXCH_SERVER=10.86.180.134                 # 内网 Exchange 主机；或完整 EWS URL（如 https://10.86.180.134/ews/exchange.asmx）
EXCH_ACCOUNT=auto@lechler.com.cn          # 目标邮箱（默认即此）
EXCH_USER="auto@lechler.com.cn"           # 邮箱本人账号（UPN）；或 'DOMAIN\auto'
EXCH_PASS=实际密码                          # 原样填写、不要加引号；可含引号/括号/$/& 等任意字符（本文件仅 Python 读取）
EXCH_AUTH=ntlm                            # 默认；反复 401 可试 basic
EXCH_TLS_VERIFY=0                         # 按 IP 直连时证书与 IP 不匹配（CERTIFICATE_VERIFY_FAILED）需设 0 关闭校验
EXCH_FOLDER=Inbox                         # 子文件夹写法 Inbox/AP
EXCH_SINCE_DAYS=365                       # 只处理最近 N 天；0=全部
EXCH_SUBJECT_FILTER=发票                   # 主题关键词过滤；置空=不过滤
```

安全要点：该文件**只有 cron 发票任务加载**，Web 服务（poclose.service）不接触；密码只进此文件，不进命令行/git/日志；账号最小权限、定期轮换。

### 2. 验证密码（--check）

```bash
cd /var/www/lnsc-apps/apps/po-closing/invoice
/var/www/lnsc-apps/apps/po-closing/venv/bin/python exchange_invoice_sync.py --check
# 成功：[check] 连接成功：auto@lechler.com.cn / Inbox（共 N 封邮件）——密码验证通过
```

排错对照：`401 Unauthorized`=密码错/无 EWS 权限；`ErrorAccessDenied`=无邮箱访问权限；连接错误=EXCH_SERVER 地址问题。

### 3. 运行

```bash
/var/www/lnsc-apps/apps/po-closing/venv/bin/python exchange_invoice_sync.py --dry-run --limit 10   # 演练：只打印不写文件
/var/www/lnsc-apps/apps/po-closing/venv/bin/python exchange_invoice_sync.py                        # 正式：写 invoices_<YYYY>.csv
```

### 4. 落地注意

- **字段映射**：按 XML 标签 local-name 匹配（忽略命名空间），候选在脚本顶部 `FIELD_CANDIDATES`；新版式在设备上 `--dry-run --limit 5` 验证，识别不到的字段把标签名补进列表即可
- **已适配数电票 EInvoice 版式**（样例实测通过）：

  | CSV 字段 | XML 标签 |
  |---|---|
  | 发票号 | `TaxSupervisionInfo/InvoiceNumber`（备选 `Header/EIid`） |
  | 供应商 | `SellerInformation/SellerName` |
  | 金额 | `BasicInformation/TotalTax-includedAmount`（价税合计，注意带连字符） |
  | 开票日期 | `TaxSupervisionInfo/IssueTime` |
  | PO 号 | **备注**（`AdditionalInformation`/`Remark` 等）：**仅认 `4526` 开头 10 位数字**（如 4526018353，PDF/XML/邮件主题同一口径，无任意数字兜底）；识别链：订单字段标签 → 备注 → 全文 → 邮件主题；**备注含多个 PO 时一票拆多行**（合并键 = 发票号+PO号） |
  | 供应商编号 | **备注**：先认「供应商代码/编号：6016113」标签写法，再按 `60` 开头 7 位数字规则（如 6016113） |
- **多行项目**：金额取抬头合计而非行项目（样例已验证）
- **文字型数电票 PDF**：无 XML 附件时解析 PDF 文字层（pdfminer.six，只读前 2 页、>15MB 跳过）：发票号（`发票号码：` 锚定，兼容 20~24 位）、开票日期、价税合计（`（小写）` 锚定）、销售方名称、备注区 PO/供应商编号（与 XML 同一套 4526/60 规则）；**开票明细尽力还原**（行项目 `*类别*` 锚定聚合、税率 `%` 定界，版式差异允许个别字段不准）。**扫描件/图片 PDF 无文字层 → 明确放弃不 OCR**，记 `[skip]` 日志走人工。同票 XML+PDF 双附件时 XML 优先；PDF 明细为空时合并不覆盖既有 XML 明细
- **去重**：按 发票号+PO号 与既有 CSV 合并，重复运行不产生重复行
- **金额口径**：默认取「价税合计」；如需不含税金额调整候选顺序

## PO 号识别口径（2026-08 定稿）

**唯一规则：`4526` 开头的 10 位数字**（`(?<!\d)(4526\d{6})(?!\d)`），XML / PDF / 邮件主题全链路同一口径。

**识别退回链**：XML 订单字段标签 → 备注栏 → XML 全文 / PDF 文字层 → **邮件主题** → 都无则产出「无 PO 号」行（页面虚线 pill，不参与 SAP 查询，人工补录）。

> 历史教训：早期有「任意 10 位数字」兜底规则，曾把单价 `29702.9702970297` 的小数尾巴 `9702970297` 误判为 PO——兜底已废除（宁缺毋假）。

### 清理错误识别的记录

页面改不了自动解析出的 PO（只有空 PO 单元格才有补录框），到服务器直接改 CSV：

```bash
cd /var/www/lnsc-apps/apps/po-closing/invoice
grep -n "错误PO号" *.csv                                    # 定位文件与行号
sed -i 's/^\(发票号,\)错误PO号,/\1,/' invoices_2026.csv     # A. 清空 PO：保留发票行，显示「无 PO 号」
sed -i '/,错误PO号,/d' invoices_2026.csv                    # B. 整行删除（与关单核对无关的票）
```

改完刷新页面即生效（CSV 每次请求实时读取）；快照里残留的「查无此单」在下一次定时核查（03:33/12:33）全量重建时自动清除，无需处理。
