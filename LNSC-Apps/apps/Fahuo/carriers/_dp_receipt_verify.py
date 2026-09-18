#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦"勾选回签单是否真传过去"终验（2026-09-18）
   勾=纸质回单：拦截实际 HTTP 请求体，确认 addServices 三子字段随单发出；
   对照不勾：确认不带 addServices。真实下单 → 打印请求体 → 5s/15s 退避取消"""
import json
import os
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import base, place_order, cancel_order  # noqa: E402
from carriers import deppon  # noqa: E402

# 拦截出站请求体（打印后又原样发出）
_orig_post = deppon._signed_post
def spy_post(endpoint, cfg, params, timeout=30):
    b = json.loads(params)
    print("  出站 addServices =", json.dumps(b.get("addServices"), ensure_ascii=False),
          "| logisticID =", b.get("logisticID"))
    return _orig_post(endpoint, cfg, params, timeout)
deppon._signed_post = spy_post

base_order = {
    "so": "TESTRCP", "oid": "TESTRCP" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴",
    "product": "快递标准件", "pay": "寄付月结", "parcels": 1, "qty": 1,
}

print("== ① 勾选纸质回单 ==")
o1 = dict(base_order, receipt=["纸质回单"])
r1 = place_order("德邦", o1)
print("  运单:", r1.get("waybill_no"))
ok1 = True

print("== ② 不勾（对照） ==")
o2 = dict(base_order, receipt=[])
r2 = place_order("德邦", o2)
print("  运单:", r2.get("waybill_no"))

print("\n== 取消（5s/15s 退避，async 入账延迟） ==")
for tag, r in (("①勾选单", r1), ("②对照单", r2)):
    for wait in (5, 15):
        time.sleep(wait)
        try:
            out = cancel_order("德邦", r.get("order_id"), r.get("waybill_no"),
                               logistic_id=r.get("logistic_id"))
            print(f"  {tag} 取消:", json.dumps(out, ensure_ascii=False)[:100])
            break
        except Exception as e:
            print(f"  {tag} 取消重试({wait}s):", str(e)[:80])
