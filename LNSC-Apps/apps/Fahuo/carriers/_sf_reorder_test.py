#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""场景复现（#484 生命周期）：下2件 → 取消 → 同收件人再下1件 → 看返几单
   若第二单（parcelQty=1）也返2单 → 顺丰"取消后重下继承子母件"实锤
   全部真实运单，每步后立即取消（dealType:2 已可用）"""
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


def mk(parcels, tag):
    return {
        "so": "TESTRE", "oid": "TESTRE" + tag + str(int(time.time() * 1000)),
        "order_type": "发货单",
        "province": "江苏省", "city": "常州市", "district": "金坛区",
        "street": "德城路99号", "name": "测试", "phone": "15190535163",
        "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
        "insured": "", "receipt": [], "weight": "", "volume": "", "parcels": str(parcels),
    }


def brief(res):
    return {"waybill_no": res.get("waybill_no"), "waybills": res.get("waybills"),
            "order_id": res.get("order_id"), "parcels": res.get("parcels")}


print("== ① 下 2 件 ==")
r1 = place_order("顺丰", mk(2, "A"))
print(json.dumps(brief(r1), ensure_ascii=False))
wbs1 = r1.get("waybills") or [r1["waybill_no"]]
print("返单数:", len(wbs1))

print("== ② 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", r1.get("order_id"), r1["waybill_no"]), ensure_ascii=False)[:150])

print("== ③ 同收件人再下 1 件 ==")
r2 = place_order("顺丰", mk(1, "B"))
print(json.dumps(brief(r2), ensure_ascii=False))
wbs2 = r2.get("waybills") or [r2["waybill_no"]]
print("返单数:", len(wbs2), "→", "⚠️ 取消后重下继承子母件！" if len(wbs2) > 1 else "正常单件（顺丰无继承）")

print("== ④ 取消第二单 ==")
print(json.dumps(cancel_order("顺丰", r2.get("order_id"), r2["waybill_no"]), ensure_ascii=False)[:150])
