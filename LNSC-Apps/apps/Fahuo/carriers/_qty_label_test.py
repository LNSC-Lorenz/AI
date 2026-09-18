#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数量上面单端到端验证（顺丰）：下 1件/数量300 测试单 → 云打印面单 → 提取文本找"300pcs" → 取消
   注意：产生真实运单（随即取消）"""
import base64
import json
import os
import sys
import time
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import place_order, cancel_order, print_label  # noqa: E402

order = {
    "so": "TESTQTY", "oid": "TESTQ" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
    "insured": "", "receipt": [], "parcels": "1", "qty": "300",
}

print("== ① 下单 1件/数量300 ==")
res = place_order("顺丰", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "parcels", "qty", "order_id")},
                 ensure_ascii=False))

print("== ② 云打印面单 ==")
pdf_bytes = None
for wait in (1, 2, 4, 8):
    time.sleep(wait)
    try:
        lp = print_label("顺丰", res["waybill_no"])
        f = (lp.get("files") or [{}])[0]
        req = urllib.request.Request(f["url"], headers={"X-Auth-Token": f.get("token", "")})
        pdf_bytes = urllib.request.urlopen(req, timeout=30).read()
        break
    except Exception as e:
        print("  重试…", str(e)[:80])
if not pdf_bytes:
    print("❌ 面单获取失败")
else:
    open("/tmp/qty_label.pdf", "wb").write(pdf_bytes)
    from pypdf import PdfReader
    t = PdfReader("/tmp/qty_label.pdf").pages[0].extract_text() or ""
    hit = "300pcs" in t
    print("面单文本含'300pcs':", "✅ 是" if hit else "❌ 否")
    if not hit:
        print("--- 面单文本 ---")
        print(t[:500])

print("== ③ 取消 ==")
print(json.dumps(cancel_order("顺丰", res.get("order_id"), res["waybill_no"]),
                 ensure_ascii=False)[:120])
