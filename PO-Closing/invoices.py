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
    """发票号,PO号,供应商,金额,开票日期,供应商编号,开票内容JSON,人工标记（后三列可选；PO号可空。
    人工标记列：PO/VC/PO,VC —— 表示对应列的值来自页面手工补录，前端据以显示铅笔图标）"""
    if len(parts) >= 2 and parts[1].isdigit() and 6 <= len(parts[1]) <= 12:
        return (parts[0], parts[1],
                parts[2] if len(parts) > 2 else "",
                parts[3] if len(parts) > 3 else "",
                parts[4] if len(parts) > 4 else "",
                parts[5] if len(parts) > 5 else "",
                parts[6] if len(parts) > 6 else "",
                parts[7] if len(parts) > 7 else "",
                parts[8] if len(parts) > 8 else "")
    if len(parts) == 1 and parts[0].isdigit() and 6 <= len(parts[0]) <= 12:
        return ("", parts[0], "", "", "", "", "", "", "")        # 纯 PO 号行
    if parts and parts[0].isdigit() and len(parts[0]) >= 6:
        return (parts[0], "",                            # 数电票无 PO 号：仍载入展示
                parts[2] if len(parts) > 2 else "",
                parts[3] if len(parts) > 3 else "",
                parts[4] if len(parts) > 4 else "",
                parts[5] if len(parts) > 5 else "",
                parts[6] if len(parts) > 6 else "",
                parts[7] if len(parts) > 7 else "",
                parts[8] if len(parts) > 8 else "")
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
                inv, po, vendor, amount, inv_date, vcode, items_raw, marks, src = parsed
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
                             "VENDOR_CODE": vcode, "INV_ITEMS": _parse_items(items_raw),
                             "MANUAL_PO": 1 if "PO" in marks.split(",") else 0,
                             "MANUAL_VC": 1 if "VC" in marks.split(",") else 0,
                             "SRC": src.strip().upper() if src.strip().upper() in ("XML", "PDF") else ""})
    # 供应商编号按公司名称 1:1 回填：仅当全库中该公司只对应一个编号时补缺；
    # 编号来源行带人工标记（VC）时，回填行同样标记（铅笔 = 值的人工来源）
    vc_map, vc_conflict, vc_manual = {}, set(), set()
    for r in rows:
        n, c = r["VENDOR"].strip(), r["VENDOR_CODE"].strip()
        if not n or not c:
            continue
        if n in vc_map and vc_map[n] != c:
            vc_conflict.add(n)
        else:
            vc_map[n] = c
        if r["MANUAL_VC"]:
            vc_manual.add(n)
    for r in rows:
        n = r["VENDOR"].strip()
        if not r["VENDOR_CODE"].strip() and n in vc_map and n not in vc_conflict:
            r["VENDOR_CODE"] = vc_map[n]
            if n in vc_manual:
                r["MANUAL_VC"] = 1
    return rows, [os.path.basename(p) for p in files]


# 手工补录列位置（CSV：发票号,PO号,供应商,金额,开票日期,供应商编号,开票内容）
PATCH_COL = {"EBELN": 1, "VENDOR_CODE": 5}


def patch_row(inv_no, old_po, field, value, directory=None):
    """手工补录：按 发票号+原PO号 定位行，更新 PO号/供应商编号 列并写回原 CSV，
    同时在第 8 列打上人工标记（PO/VC，前端铅笔图标依据）。找到并写回返回 True。"""
    d = directory or config.INVOICE_DIR
    col = PATCH_COL[field]
    tag = "PO" if field == "EBELN" else "VC"
    for path in sorted(glob.glob(os.path.join(d, "*.csv"))):
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = [list(r) for r in csv.reader(f)]
        if not rows:
            continue
        changed = False
        for row in rows[1:]:
            row += [""] * (8 - len(row))
            if row[0].strip() == inv_no and row[1].strip() == old_po:
                row[col] = value
                marks = [m for m in row[7].split(",") if m]
                if value:
                    if tag not in marks:
                        marks.append(tag)
                elif tag in marks:
                    marks.remove(tag)   # 清空值 = 撤回人工标记（铅笔消失、回到空状态）
                row[7] = ",".join(marks)
                changed = True
        if changed:
            with open(path, "w", newline="", encoding="utf-8-sig") as f:
                csv.writer(f).writerows(rows)
            return True
    return False