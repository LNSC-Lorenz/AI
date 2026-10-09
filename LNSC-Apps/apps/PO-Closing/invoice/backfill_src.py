#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""backfill_src.py — 一次性回填发票 CSV 第 9 列（来源标记 XML/PDF，页面「版式」角标）。

规则（与抓取侧口径一致，尽量简单）：
  有开票内容（第 7 列非空）=> XML（明细只可能来自 XML 版式文件）
  无开票内容但读到 PO 号（第 2 列非空）=> PDF
  其余留空（无 PO 无明细，无法判断，等全量重抓补标）。
幂等：已有来源标记的行不覆盖；可重复运行。

用法：python3 backfill_src.py [invoice目录]   # 默认 POCLOSE_INVOICE_DIR 或脚本所在目录
"""
import csv
import glob
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
d = sys.argv[1] if len(sys.argv) > 1 else os.getenv("POCLOSE_INVOICE_DIR", BASE)

for path in sorted(glob.glob(os.path.join(d, "*.csv"))):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [list(r) for r in csv.reader(f)]
    cnt = {"XML": 0, "PDF": 0}
    for row in rows[1:]:                     # 跳过表头
        row += [""] * (9 - len(row))         # 旧文件 7~8 列：补齐到 9 列
        if row[8].strip():
            continue                         # 已有标记不覆盖（幂等）
        if row[6].strip():
            row[8] = "XML"                   # 有开票内容 => XML
        elif row[1].strip():
            row[8] = "PDF"                   # 无明细但读到 PO 号 => PDF
        else:
            continue                         # 无 PO 无明细：无法判断，留空
        cnt[row[8]] += 1
    if any(cnt.values()):
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f).writerows(rows)
    print("%s: 回填 XML %d 行 / PDF %d 行" % (os.path.basename(path), cnt["XML"], cnt["PDF"]))
