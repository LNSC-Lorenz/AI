#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰 expressTypeCode/limitTypeCode 探测：请求特快(expressTypeId=2) 看响应字段 → 取消
   对照既有数据：请求标快(B1) 近线=T6/远线被改派=T4"""
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
    "so": "TESTEXP", "oid": "TESTE" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "云南省", "city": "玉溪市", "district": "峨山彝族自治县",
    "street": "测试路1号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "顺丰特快", "pay": "寄付月结",
    "insured": "", "receipt": [], "parcels": "1", "qty": "1",
}
res = place_order("顺丰", order)
li = res.get("label_info") or {}
k4 = ""
import re  # noqa: E402
m = re.search(r"'k4':'([^']*)'", str(li.get("twoDimensionCode", "")))
k4 = m.group(1) if m else "-"
print("请求: 顺丰特快(expressTypeId=2) → 云南玉溪")
print(json.dumps({
    "waybill_no": res.get("waybill_no"),
    "proCode": li.get("proCode"),
    "expressTypeCode": li.get("expressTypeCode"),
    "limitTypeCode": li.get("limitTypeCode"),
    "cargoTypeCode": li.get("cargoTypeCode"),
    "k4": k4,
}, ensure_ascii=False))
print("== 取消 ==")
print(json.dumps(cancel_order("顺丰", res.get("order_id"), res["waybill_no"]), ensure_ascii=False)[:120])
