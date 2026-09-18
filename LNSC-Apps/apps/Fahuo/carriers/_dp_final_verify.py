#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦回签单+月结终极验证（官方文档 addServices 修复后）：
   place_order(纸质回单+寄付月结) → 面单"签收单"行应为 原件返回+月结 → 取消"""
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

from carriers import place_order, cancel_order, deppon  # noqa: E402

order = {
    "so": "TESTFIN", "oid": "TESTF" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "大件快递3.60", "pay": "寄付月结",
    "insured": "", "receipt": ["纸质回单"], "parcels": "1", "qty": "1",
}

print("== 下单（纸质回单+寄付月结）==")
res = place_order("德邦", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "order_id", "logistic_id")},
                 ensure_ascii=False))
wb = res["waybill_no"]

print("== 取面单 ==")
line = "(未取到)"
for wait in (10, 20, 30, 30):
    time.sleep(wait)
    try:
        lp = deppon.cloud_print(wb)
        pdf = urllib.request.urlopen(lp["files"][0]["url"], timeout=30).read()
        open("/tmp/dp_fin.pdf", "wb").write(pdf)
        from pypdf import PdfReader
        t = PdfReader("/tmp/dp_fin.pdf").pages[0].extract_text() or ""
        line = next((l.strip() for l in t.splitlines() if "签收单" in l or "返单" in l), "(无签收单行)")
        break
    except Exception as e:
        line = "(重试:%s)" % str(e)[:50]
print("面单签收单行:", line)
ok = ("无需返单" not in line) and ("月结" in line)
print("→", "✅✅ 回签单+月结 双修复生效！" if ok else "❌ 仍异常")

print("== 取消 ==")
try:
    print(json.dumps(cancel_order("德邦", res.get("order_id"), wb,
                                  res.get("logistic_id", "")), ensure_ascii=False)[:150])
except Exception as e:
    print("取消失败（人工处理 %s）: %s" % (wb, e))
