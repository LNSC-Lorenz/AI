#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦取消真单闭环：真实下 1 件测试单 → 立即用 cancelOrder 取消 → 验证权限+代码全通
   注意：产生一张真实运单（随即取消作废）"""
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

from carriers import place_order, cancel_order  # noqa: E402

order = {
    "so": "TESTDPC", "oid": "TESTDPC" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "大件快递3.60", "pay": "寄付月结",
    "insured": "", "receipt": [], "weight": "", "volume": "", "parcels": "1",
}

print("== ① 下 1 件 ==")
res = place_order("德邦", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "waybills", "order_id", "logistic_id", "parcels")},
                 ensure_ascii=False))

print("\n== ② 立即取消 ==")
try:
    r = cancel_order("德邦", res.get("order_id"), res["waybill_no"], res.get("logistic_id", ""))
    print(json.dumps(r, ensure_ascii=False)[:300])
    print("→ ✅ 德邦取消全链路打通")
except Exception as e:
    print("❌ 取消失败（运单 %s 请人工处理）：%s" % (res["waybill_no"], e))
