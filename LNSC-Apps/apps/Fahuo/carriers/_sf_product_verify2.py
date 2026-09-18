#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""映射修正后全链路验证（2026-09-18）：_PRODUCT_TYPE 已改 1=特快/2=标快
   选"顺丰标快"→济南 应发 2 → proCode 标快；选"顺丰特快"→济南 应发 1 → proCode 特快
   真实下单 → 打印映射与响应 → 立即 dealType:2 取消"""
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
from carriers import sf_express  # noqa: E402

print("映射表 =", sf_express._PRODUCT_TYPE)
for prod, expect in [("顺丰标快", "标快"), ("顺丰特快", "特快")]:
    order = {
        "so": "TESTFIX", "oid": "TESTFIX" + str(int(time.time() * 1000)),
        "order_type": "发货单",
        "province": "山东省", "city": "济南市", "district": "历城区",
        "street": "工业北路100号", "name": "测试", "phone": "15190535163",
        "company": "", "cargo": "喷嘴",
        "product": prod, "pay": "寄付月结", "parcels": 1, "qty": 1,
    }
    sent = sf_express._PRODUCT_TYPE.get(order["product"], 2)
    res = place_order("顺丰", order)
    li = res.get("label_info") or {}
    got = li.get("proCode")
    print(f"选[{prod}] → 发 expressTypeId={sent} → 实际 proCode={got}"
          f"({li.get('limitTypeCode')})",
          "✓ 符合预期" if got == expect else "✗ 不符!")
    print("  取消:", json.dumps(cancel_order("顺丰", res.get("order_id"),
                                          res.get("waybill_no")),
                              ensure_ascii=False)[:80])
    time.sleep(1)
