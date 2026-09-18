#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数量测试单分步工具：python3 carriers/_qty_order.py place | cancel ORDER_ID WAYBILL"""
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

if len(sys.argv) > 1 and sys.argv[1] == "cancel":
    print(json.dumps(cancel_order("顺丰", sys.argv[2], sys.argv[3]), ensure_ascii=False)[:150])
    sys.exit(0)

order = {
    "so": "TESTQTY", "oid": "TESTQ" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
    "insured": "", "receipt": [], "parcels": "1", "qty": "300",
}
res = place_order("顺丰", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "parcels", "qty", "order_id")},
                 ensure_ascii=False))
