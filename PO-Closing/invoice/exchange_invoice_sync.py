#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""exchange_invoice_sync.py — 内网 Exchange 邮箱 XML 发票抓取 → 分年 CSV。

背景：ap-invoice 为 M365 共享邮箱（应用注册链路复杂），发票邮件统一**转发**到
内网 Exchange 邮箱 auto@lechler.com.cn，本脚本用 EWS + NTLM 直接读取。

依赖：pip install exchangelib pdfminer.six（install/bach_POClosing 已含）
解析与保存逻辑内联（数电票 EInvoice XML 版式 + 文字型数电票 PDF 已适配；
扫描件/图片 PDF 无文字层，明确放弃不 OCR，记 [skip] 日志走人工）。

配置（环境变量；缺失时自动加载同目录 exchange.env，600 权限）：
  EXCH_SERVER      内网 Exchange 主机（10.86.180.134）或完整 EWS URL
  EXCH_ACCOUNT     目标邮箱，默认 auto@lechler.com.cn
  EXCH_USER        登录账号：UPN（auto@lechler.com.cn）或 DOMAIN\\user
  EXCH_PASS        登录密码（NTLM 质询-响应由服务器侧 AD 校验）
  EXCH_AUTH        ntlm（默认）/ basic / digest
  EXCH_FOLDER      邮件文件夹，默认 Inbox；子文件夹写法 Inbox/AP
  EXCH_SINCE_DAYS  只处理最近 N 天，默认 365；0 = 全部
  EXCH_SUBJECT_FILTER  主题关键词过滤，默认「发票」；置空 = 不过滤

用法：
  python3 exchange_invoice_sync.py --check     # 验证连接与密码后退出
  python3 exchange_invoice_sync.py --dry-run   # 只打印解析结果，不写文件
  python3 exchange_invoice_sync.py --limit 20  # 最多处理 20 封邮件（调试用）
  python3 exchange_invoice_sync.py             # 正常抓取并写 CSV

排错对照：401 Unauthorized = 密码错/无 EWS 权限；ErrorAccessDenied = 无邮箱代理权限；
连接错误 = EXCH_SERVER 地址问题；NTLM 反复 401 可试 EXCH_AUTH=basic。
"""
import argparse
import csv
import json
import os
import re
from datetime import datetime, timedelta

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.getenv("POCLOSE_INVOICE_DIR", BASE_DIR)

CSV_HEADER = ["发票号", "PO号", "供应商", "金额", "开票日期", "供应商编号", "开票内容"]
CSV_KEYS = ["INV_NO", "EBELN", "VENDOR", "AMOUNT", "INV_DATE", "VENDOR_CODE", "ITEMS_JSON"]

# 字段候选标签（按小写 local-name 匹配；已适配数电票 EInvoice 版式）
FIELD_CANDIDATES = {
    "INV_NO":   ["invoicenumber", "eiid", "invoiceno", "invoice_num", "fphm", "发票号码"],
    "VENDOR":   ["sellername", "seller", "payee", "payeename", "xsfmc", "销售方名称", "销售方"],
    "AMOUNT":   ["totaltax-includedamount", "totalamountwithtax", "totaltaxincludedamount",
                 "payableamount", "jshj", "价税合计", "totalamount", "amount"],
    "INV_DATE": ["issuetime", "issuedate", "invoicedate", "billingdate", "kprq", "开票日期"],
    "EBELN":    ["purchaseorder", "purchaseordernumber", "ponumber", "ordernumber",
                 "orderid", "采购订单号", "订单号"],
    "VCODE":    ["lifnr", "vendorcode", "suppliercode", "supplierid", "供应商代码", "供应商编号"],
}

# 备注类标签（PO 号正常写在备注里）
REMARK_TAGS = {"remark", "remarks", "beizhu", "bz", "备注", "additionalinformation"}


def _local_name(tag):
    return tag.rsplit("}", 1)[-1].split(":")[-1].lower()


def norm_amount(s):
    t = re.sub(r"[^\d.]", "", (s or "").replace(",", ""))
    try:
        return "%.2f" % float(t)
    except ValueError:
        return ""


def norm_date(s):
    """兼容 'YYYY-MM-DD'、'YYYY/MM/DD'、'YYYYMMDD'、'YYYY年M月D日' 及尾部带时间。"""
    s = (s or "").strip()
    m = re.match(r"^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(\s+\d{1,2}:\d{2}(:\d{2})?)?$", s)
    if m and 1 <= int(m.group(2)) <= 12 and 1 <= int(m.group(3)) <= 31:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    if re.match(r"^\d{8}$", s):
        return s[:4] + "-" + s[4:6] + "-" + s[6:8]
    return ""


# 备注区域识别规则（数电票备注栏习惯写法）：
#   PO 号      = 4526 开头的 10 位数字，如 4526018353
#   供应商编号 = 60 开头的 7 位数字，如 6016113
PO_RULE = r"(?<!\d)(4526\d{6})(?!\d)"
VCODE_RULE = r"(?<!\d)(60\d{5})(?!\d)"


def extract_po_all(*texts):
    """提取全部 PO 号（一票多单场景：备注栏可能写多个 PO）。
    优先 4526 规则集合；一个都没有时回退任意 10 位数字集合。去重保序。"""
    seen, out = set(), []
    for t in texts:
        for m in re.finditer(PO_RULE, t or ""):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(m.group(1))
    if out:
        return out
    for t in texts:
        for m in re.finditer(r"(?<!\d)(\d{10})(?!\d)", t or ""):
            if m.group(1) not in seen:
                seen.add(m.group(1))
                out.append(m.group(1))
    return out


def extract_po(*texts):
    """单个 PO（取第一个识别结果）。"""
    lst = extract_po_all(*texts)
    return lst[0] if lst else ""


def extract_vcode(*texts):
    """从备注文本提取供应商编号：先认 '供应商代码：6016113' 标签写法，再按 60 开头 7 位数字规则。"""
    for t in texts:
        m = re.search(r"供应商(?:代码|编号)\s*[:：]?\s*([A-Za-z0-9]{4,12})", t or "")
        if m:
            return m.group(1)
    for t in texts:
        m = re.search(VCODE_RULE, t or "")
        if m:
            return m.group(1)
    return ""
def parse_invoice_xml(data):
    """解析一张 XML 发票；缺发票号视为无效返回 None。
    PO 提取：订单字段标签 -> 备注类标签 -> XML 全文 10 位数字 -> 调用方退回邮件主题。"""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return None
    vals = {}
    remark_texts = []
    for elem in root.iter():
        text = (elem.text or "").strip()
        if not text:
            continue
        name = _local_name(elem.tag)
        if name in REMARK_TAGS:
            remark_texts.append(text)
        for field, cands in FIELD_CANDIDATES.items():
            if field not in vals and name in cands:
                vals[field] = text
    if not vals.get("INV_NO"):
        return None
    # 开票行项目（IssuItemInformation 可多个）
    items = []
    for elem in root.iter():
        if _local_name(elem.tag) != "issuiteminformation":
            continue
        rec = {}
        for ch in elem.iter():
            nm = _local_name(ch.tag)
            tx = (ch.text or "").strip()
            if not tx:
                continue
            if nm == "itemname":
                rec["name"] = tx
            elif nm == "quantity":
                rec["qty"] = tx
            elif nm == "totaltaxincludedamount":
                rec["total"] = tx
            elif nm == "amount":
                rec["amount"] = tx
            elif nm == "meaunits":
                rec["unit"] = tx
        if rec.get("name"):
            items.append(rec)
    po_list = extract_po_all(vals.get("EBELN", "")) or extract_po_all(*remark_texts)
    if not po_list:
        po_list = extract_po_all(data.decode("utf-8", "ignore"))
    return {
        "INV_NO": vals.get("INV_NO", "").strip(),
        "EBELN": po_list[0] if po_list else "",
        "PO_LIST": po_list,   # 一票多单：备注含多个 PO 时全量保留（调用方拆多行）
        "VENDOR": vals.get("VENDOR", "").strip(),
        "AMOUNT": norm_amount(vals.get("AMOUNT", "")),
        "INV_DATE": norm_date(vals.get("INV_DATE", "")),
        "VENDOR_CODE": vals.get("VCODE", "").strip() or extract_vcode(*remark_texts),
        "ITEMS_JSON": json.dumps(items, ensure_ascii=False, separators=(",", ":")) if items else "",
    }


# ---------- PDF 发票解析（文字型数电票；扫描件明确放弃，不做 OCR） ----------

PDF_MAX_BYTES = 15 * 1024 * 1024   # 超过视为扫描件/异常文件，跳过
PDF_MAX_PAGES = 2                  # 发票字段都在前两页，多页只可能是附件附图

# 明细区终止关键字（出现即说明行项目表格已结束）
ITEM_STOP_KEYS = ("价税合计", "备注", "发票号码", "开票日期", "销售方", "购买方",
                  "合 计", "合计", "收款人", "开票人", "复核")


def _pdf_items(text):
    """尽力从数电票 PDF 文本流还原开票明细行。

    数电票行项目名称恒以 *类别* 开头；pdfminer 可能把每个单元格拆成独立行，
    故先按行聚合 token（遇到 % 税率视为本行字段齐了），再按
    「名称… 单位? 数量 单价 金额 税率% 税额」的尾序切字段。失败容忍：宁缺毋滥。"""
    groups, cur = [], None
    for line in (l.strip() for l in text.splitlines()):
        if not line:
            continue
        if line.startswith("*") and line.count("*") >= 2:
            if cur:
                groups.append(cur)
            cur = line.split()
        elif cur is not None:
            if any(k in line for k in ITEM_STOP_KEYS):
                groups.append(cur)
                cur = None
                break
            cur.extend(line.split())
            if any(re.fullmatch(r"\d+%", t) for t in cur):
                groups.append(cur)
                cur = None
    if cur:
        groups.append(cur)

    def _num(s):
        try:
            return float((s or "").replace(",", ""))
        except ValueError:
            return 0

    items = []
    for toks in groups[:50]:
        if not re.match(r"^\*[^*]+\*", toks[0]):
            continue
        pi = next((k for k, t in enumerate(toks) if re.fullmatch(r"\d+%", t)), -1)
        if pi >= 3:                      # …数量 单价 金额 税率% 税额
            qty_s, total_s = toks[pi - 3], toks[pi - 1]
            mid = toks[1:pi - 3]         # 名称余部（+ 可能的单位）
        else:
            qty_s, total_s = "", ""
            mid = toks[1:]
        unit = ""
        if mid and not re.search(r"[\d*]", mid[-1]) and len(mid[-1]) <= 4:
            unit = mid.pop()             # 末尾非数字短 token 视为单位（片/件/台/项…）
        name = (toks[0] + " " + " ".join(mid)).strip()
        if name:
            items.append({"name": name[:80], "unit": unit, "qty": qty_s or "1",
                          "amount": _num(total_s), "total": _num(total_s)})
    return items


def parse_invoice_pdf(data):
    """解析文字型数电票 PDF；扫描件（无文字层）或找不到发票号返回 None。

    版式假设：数电票 PDF 为税务系统数字生成、内嵌文字层，pdfminer 直接抽取；
    字段用关键词锚定 + 正则，与 XML 路径共用 extract_po_all / extract_vcode /
    norm_date / norm_amount。开票明细由 _pdf_items 尽力还原（文本流版式差异大，
    允许个别字段不准；保存合并时若 XML 版已存明细则以明细更全者为准）。"""
    if len(data) > PDF_MAX_BYTES:
        _log("[skip] PDF 过大（%.1f MB），按扫描件放弃" % (len(data) / 1048576))
        return None
    try:
        from io import BytesIO
        from pdfminer.high_level import extract_text
        text = extract_text(BytesIO(data), page_numbers=set(range(PDF_MAX_PAGES))) or ""
    except ImportError:
        _log("[skip] 未安装 pdfminer.six（venv 执行: pip install pdfminer.six），PDF 全部跳过")
        return None
    except Exception as exc:
        _log("[skip] PDF 解析失败: %s" % exc)
        return None
    text = re.sub(r"[ \t　]+", " ", text)
    if len(text.strip()) < 50:        # 无文字层 = 扫描件/图片 PDF，明确放弃（不做 OCR）
        _log("[skip] PDF 无文字层（扫描件），放弃")
        return None
    m = re.search(r"发票号码\s*[:：]?\s*(\d{8,24})", text) or re.search(r"(?<!\d)(\d{20,24})(?!\d)", text)
    if not m:
        return None                   # 找不到发票号 → 不是数电票版式
    inv_no = m.group(1)
    m = re.search(r"开票日期\s*[:：]?\s*([0-9年月日\-/. ]{8,14})", text)
    inv_date = norm_date(m.group(1).strip()) if m else ""
    m = (re.search(r"[（(]\s*小写\s*[)）]\s*[¥￥]?\s*([\d,]+\.?\d*)", text)
         or re.search(r"价税合计[^\d]{0,20}([\d,]+\.\d{2})", text))
    amount = norm_amount(m.group(1)) if m else ""
    vendor = ""
    m = re.search(r"销售方[\s\S]{0,80}?名\s*称\s*[:：]\s*([^\n]+)", text)   # 「销售方信息」块内的名称
    if m:
        vendor = m.group(1).strip()
    else:
        names = re.findall(r"名\s*称\s*[:：]\s*([^\n]+)", text)
        if len(names) >= 2:
            vendor = names[1].strip()  # 数电票版式固定先购买方后销售方
        elif names:
            vendor = names[0].strip()
    m = re.search(r"备注\s*[:：]?\s*([\s\S]+)", text)
    remark = (m.group(1)[:500] if m else "")
    po_list = extract_po_all(remark) or extract_po_all(text)
    items = _pdf_items(text)
    return {
        "INV_NO": inv_no,
        "EBELN": po_list[0] if po_list else "",
        "PO_LIST": po_list,
        "VENDOR": vendor,
        "AMOUNT": amount,
        "INV_DATE": inv_date,
        "VENDOR_CODE": extract_vcode(remark) or extract_vcode(text),
        "ITEMS_JSON": json.dumps(items, ensure_ascii=False, separators=(",", ":")) if items else "",
    }


def save_by_year(records_by_year):
    """每个年份一个 CSV：与既有文件合并，按 发票号+PO号 去重（一票多单同号多行），按日期排序写回。
    PDF 版发票不含开票明细：新记录 ITEMS_JSON 为空而旧记录有值时，保留旧明细不覆盖。"""
    for year, recs in sorted(records_by_year.items()):
        path = os.path.join(OUT_DIR, "invoices_%s.csv" % year)
        merged = {}
        if os.path.isfile(path):
            with open(path, newline="", encoding="utf-8-sig") as f:
                for row in csv.reader(f):
                    if len(row) >= 5 and row[0] and row[0] != "发票号":
                        merged[(row[0], row[1])] = (row + [""] * 7)[:7]
        for r in recs:
            key = (r["INV_NO"], r["EBELN"])
            old = merged.get(key)
            if old and not r["ITEMS_JSON"] and old[6]:
                r = dict(r, ITEMS_JSON=old[6])   # PDF 版无明细：保留 XML 版已存的开票内容
            merged[key] = [r[k] for k in CSV_KEYS]
        rows = sorted(merged.values(), key=lambda r: (r[4], r[0], r[1]))
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f)
            w.writerow(CSV_HEADER)
            w.writerows(rows)
        print("[save] %s -> %d 条（本次新增/更新 %d）" % (path, len(rows), len(recs)))


STATUS_FILE = os.path.join(OUT_DIR, "last_sync.json")

_LOG = []


def _log(msg):
    _LOG.append(str(msg))
    print(msg)


def write_status(ok, **kw):
    """把本次抓取结果写入 last_sync.json（供 web 页头展示）。"""
    payload = {"ran_at": datetime.now().isoformat(timespec="seconds"), "ok": ok}
    payload.update(kw)
    payload["log"] = "\n".join(_LOG[-60:])
    try:
        with open(STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
    except OSError:
        pass


def _load_env_file():
    """关键环境变量缺失时，自动加载同目录 exchange.env（KEY=VALUE 行）。"""
    if os.getenv("EXCH_SERVER"):
        return
    p = os.path.join(BASE_DIR, "exchange.env")
    if not os.path.isfile(p):
        return
    with open(p, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip()
            # EXCH_PASS 原样保留：密码可含任意字符（引号/括号/$/& 等），不要加引号；
            # 其余键允许成对的单/双引号（兼容手写习惯）
            if k != "EXCH_PASS" and len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
                v = v[1:-1]
            os.environ.setdefault(k, v)
# ---------- Exchange (EWS) ----------

def connect():
    """连接内网 Exchange（默认 NTLM；可用 EXCH_AUTH 切换）。"""
    try:
        from exchangelib import (Account, Configuration, Credentials,
                                 DELEGATE, NTLM, BASIC, DIGEST)
    except ImportError:
        raise SystemExit("缺少依赖：pip install exchangelib")
    server = os.getenv("EXCH_SERVER", "")
    account_email = os.getenv("EXCH_ACCOUNT", "auto@lechler.com.cn")
    user = os.getenv("EXCH_USER", "")
    passwd = os.getenv("EXCH_PASS", "")
    auth_name = os.getenv("EXCH_AUTH", "ntlm").lower()
    auth_map = {"ntlm": NTLM, "basic": BASIC, "digest": DIGEST}
    if not (server and user and passwd):
        raise SystemExit("缺少环境变量 EXCH_SERVER / EXCH_USER / EXCH_PASS")
    if auth_name not in auth_map:
        raise SystemExit("EXCH_AUTH 仅支持 ntlm / basic / digest")
    creds = Credentials(user, passwd)
    # 内网按 IP 直连时证书通常只绑定主机名 → CERTIFICATE_VERIFY_FAILED；
    # 设 EXCH_TLS_VERIFY=0 关闭校验（仅内网场景使用）
    if os.getenv("EXCH_TLS_VERIFY", "1") == "0":
        from exchangelib.protocol import BaseProtocol, NoVerifyHTTPAdapter
        BaseProtocol.HTTP_ADAPTER_CLS = NoVerifyHTTPAdapter
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    if server.startswith("http"):
        cfg = Configuration(service_endpoint=server, credentials=creds,
                            auth_type=auth_map[auth_name])
    else:
        cfg = Configuration(server=server, credentials=creds,
                            auth_type=auth_map[auth_name])
    return Account(account_email, config=cfg, autodiscover=False, access_type=DELEGATE)


def get_folder(account, path):
    """按 'Inbox/AP' 形式逐级进入子文件夹。"""
    folder = account.inbox
    for part in (path or "Inbox").split("/"):
        if part.lower() == "inbox":
            continue
        folder = folder / part
    return folder


def iter_messages(folder, since_days, limit=0, subject_kw=""):
    """按时间倒序遍历邮件；since_days=0 不限时间；subject_kw 为主题关键词过滤
    （先尝试服务端过滤，本地再复核一次，双保险）。"""
    qs = folder.all().order_by("-datetime_received")
    if since_days > 0:
        try:
            from exchangelib import EWSDateTime, EWSTimeZone
            cutoff = EWSDateTime.now(EWSTimeZone.localzone()) - timedelta(days=since_days)
            qs = qs.filter(datetime_received__gte=cutoff)
        except Exception as exc:   # 过滤失败则退回全量，打印提示
            _log("[warn] 时间过滤不可用，改全量遍历: %s" % exc)
    if subject_kw:
        try:
            qs = qs.filter(subject__contains=subject_kw)
        except Exception as exc:
            _log("[warn] 主题服务端过滤失败，仅用本地过滤: %s" % exc)
    count = 0
    for item in qs:
        if subject_kw and subject_kw not in (item.subject or ""):   # 本地复核
            continue
        yield item
        count += 1
        if limit and count >= limit:
            break


def invoice_attachments(item):
    """产出 (文件名, 内容, 类型)：XML 与 PDF 发票附件都收。"""
    from exchangelib import FileAttachment
    for att in item.attachments:
        name = getattr(att, "name", "") or ""
        if not isinstance(att, FileAttachment):
            continue
        low = name.lower()
        if low.endswith(".xml"):
            yield name, att.content, "xml"
        elif low.endswith(".pdf"):
            yield name, att.content, "pdf"


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(description="内网 Exchange 邮箱 XML 发票抓取（分年存 CSV）")
    ap.add_argument("--check", action="store_true", help="验证连接与密码后退出")
    ap.add_argument("--dry-run", action="store_true", help="只打印解析结果，不写文件")
    ap.add_argument("--limit", type=int, default=0, help="最多处理 N 封邮件（0=不限）")
    args = ap.parse_args()

    _load_env_file()
    since = int(os.getenv("EXCH_SINCE_DAYS", "365"))
    subject_kw = os.getenv("EXCH_SUBJECT_FILTER", "发票")
    n_msg = n_att = 0
    by_year = {}
    try:
        account = connect()
        folder = get_folder(account, os.getenv("EXCH_FOLDER", "Inbox"))

        if args.check:   # 触发一次真实请求即可验证密码：错误密码会在此抛 401
            _log("[check] 连接成功：%s / %s（共 %d 封邮件）——密码验证通过"
                 % (account.primary_smtp_address, folder.name, folder.total_count))
            return

        _log("[conn] %s / %s（最近 %s 天，主题含「%s」）" % (
            account.primary_smtp_address, folder.name, since or "不限", subject_kw or "不限"))
        xml_seen = set()   # 本批次 XML 已解析的发票号：同票 PDF 版跳过（XML 数据更全）
        for item in iter_messages(folder, since, args.limit, subject_kw):
            n_msg += 1
            # 同一封邮件内优先处理 XML（一票双附件时 XML 先入库，PDF 版随后被 xml_seen 跳过）
            atts = sorted(invoice_attachments(item), key=lambda a: 0 if a[2] == "xml" else 1)
            for name, content, kind in atts:
                n_att += 1
                try:
                    rec = parse_invoice_xml(content) if kind == "xml" else parse_invoice_pdf(content)
                except Exception as exc:
                    _log("[skip] %s（%s）：解析异常 %s" % (name, item.subject, exc))
                    continue
                if not rec:
                    _log("[skip] %s（%s）：无法识别为发票" % (name, item.subject))
                    continue
                if kind == "xml":
                    xml_seen.add(rec["INV_NO"])
                elif rec["INV_NO"] in xml_seen:
                    _log("[skip] %s：发票 %s 的 XML 版已解析，PDF 版忽略" % (name, rec["INV_NO"]))
                    continue
                po_list = list(rec.pop("PO_LIST", []))
                if not po_list:
                    po_list = extract_po_all(item.subject or "")
                if not po_list:
                    po_list = [""]   # 无 PO 号行仍保留（页面标「无 PO 号」，人工补录）
                year = rec["INV_DATE"][:4] if rec["INV_DATE"] else "unknown"
                for p in po_list:   # 一票多单：同一发票号按 PO 拆多行
                    r2 = dict(rec)
                    r2["EBELN"] = p
                    by_year.setdefault(year, []).append(r2)
                if len(po_list) > 1:
                    _log("[multi] %s | 发票 %s 含 %d 个 PO，已拆多行"
                         % (name, rec["INV_NO"], len(po_list)))
                _log("[ok] %s | 发票 %s | %s | %s | %s"
                     % (name, rec["INV_NO"], rec["VENDOR"], rec["AMOUNT"], rec["INV_DATE"]))
    except SystemExit:
        write_status(False, error="认证或连接失败（详见控制台输出）")
        raise
    except Exception as exc:
        write_status(False, error=str(exc)[:300])
        raise

    _log("[done] 邮件 %d 封，XML 附件 %d 个，有效发票 %d 张"
         % (n_msg, n_att, sum(len(v) for v in by_year.values())))
    write_status(True, messages=n_msg, attachments=n_att,
                 invoices=sum(len(v) for v in by_year.values()))
    if args.dry_run:
        _log("[dry-run] 不写文件")
        return
    if by_year:
        save_by_year(by_year)


if __name__ == "__main__":
    main()
