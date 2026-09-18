#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复验证：走 place_order（含 waybillType 过滤）下 1件+纸质回单
   期望：res 无 waybills（单件）、有 sign_back_no（回单运单存档）、parcels=1；测完取消"""
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
    "so": "TESTV", "oid": "TESTV" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
    "insured": "", "receipt": ["纸质回单"], "weight": "", "volume": "", "parcels": "1",
}
res = place_order("顺丰", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "waybills", "sign_back_no", "parcels", "order_id")},
                 ensure_ascii=False))
ok = ("waybills" not in res) and res.get("sign_back_no") and res.get("parcels") == 1
print("→", "✅ 修复生效：1件+回单 = 单运单 + 回单存档" if ok else "❌ 仍异常")
print("== 取消 ==")
print(json.dumps(cancel_order("顺丰", res.get("order_id"), res["waybill_no"]), ensure_ascii=False)[:120])
