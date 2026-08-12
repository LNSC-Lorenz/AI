# -*- coding: utf-8 -*-
"""发票清单读取：从 invoice 目录（POCLOSE_INVOICE_DIR）读取全部 *.csv 并合并去重。

格式：发票号,PO号,供应商,金额,开票日期（每行一条；首行表头自动跳过；PO号可空——数电票通常无 PO 字段；也允许纯 PO 号行）
注意：字段按位置解析，中间字段不可留空（可省略尾部字段）；日期支持 2024-01-05 / 2024/1/5 等写法，统一规范为 ISO。
"""
import csv
import glob
import json
import os
import re

import config


def _norm_date(s):
    """日期归一化为 YYYY-MM-DD；无法识别返回空串。"""
    m = re.match(r"^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$", (s or "").strip())
    if not m:
        return ""
    y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1 <= mo <= 12 and 1 <= d <= 31):
        return ""
    return "%04d-%02d-%02d" % (y, mo, d)


def _parse(parts):
    """发票号,PO号,供应商,金额,开票日期,供应商编号,开票内容JSON（后两列可选；PO号可空）"""
    if len(parts) >= 2 and parts[1].isdigit() and 6 <= len(parts[1]) <= 12:
        return (parts[0], parts[1],
                parts[2] if len(parts) > 2 else "",
                parts[3] if len(parts) > 3 else "",
                parts[4] if len(parts) > 4 else "",
                parts[5] if len(parts) > 5 else "",
                parts[6] if len(parts) > 6 else "")
    if len(parts) == 1 and parts[0].isdigit() and 6 <= len(parts[0]) <= 12:
        return ("", parts[0], "", "", "", "", "")        # 纯 PO 号行
    if parts and parts[0].isdigit() and len(parts[0]) >= 6:
        return (parts[0], "",                            # 数电票无 PO 号：仍载入展示
                parts[2] if len(parts) > 2 else "",
                parts[3] if len(parts) > 3 else "",
                parts[4] if len(parts) > 4 else "",
                parts[5] if len(parts) > 5 else "",
                parts[6] if len(parts) > 6 else "")
    return None


def _parse_items(s):
    """开票内容 JSON 字符串 -> list；非法/空返回 []。"""
    try:
        v = json.loads(s)
        return v if isinstance(v, list) else []
    except Exception:
        return []


def load_invoices(directory=None):
    """返回 (rows, 文件名列表)。rows: [{INV_NO, EBELN, VENDOR, AMOUNT}]"""
    d = directory or config.INVOICE_DIR
    rows, seen = [], set()
    files = sorted(glob.glob(os.path.join(d, "*.csv")))
    for path in files:
        with open(path, newline="", encoding="utf-8-sig") as f:
            for raw in csv.reader(f):
                parts = [p.strip() for p in raw]   # 保留空字段：列位置不可错位（PO号可空）
                parsed = _parse(parts)
                if not parsed:
                    continue   # 表头/非法行跳过
                inv, po, vendor, amount, inv_date, vcode, items_raw = parsed
                key = inv + "|" + po
                if key in seen:
                    continue
                seen.add(key)
                try:
                    amt = float(amount)
                except ValueError:
                    amt = 0.0
                rows.append({"INV_NO": inv, "EBELN": po, "VENDOR": vendor,
                             "AMOUNT": amt, "INV_DATE": _norm_date(inv_date),
                             "VENDOR_CODE": vcode, "INV_ITEMS": _parse_items(items_raw)})
    return rows, [os.path.basename(p) for p in files]
