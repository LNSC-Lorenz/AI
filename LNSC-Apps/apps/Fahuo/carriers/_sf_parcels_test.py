#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰 parcelQty=1 对照实验：真实下一单（parcelQty=1）→ 看返回几个运单号 → 立即取消
   目的：定位"发1出2"是前端问题还是顺丰账号侧问题（2026-09-17）
   注意：会产生一张真实运单（随即用 dealType:2 取消，待揽收可取消）"""
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
    "so": "TESTPARC", "oid": "TESTP" + str(int(time.time() * 1000)),   # 独立前缀防撞 oid.seq
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
    "insured": "", "receipt": [], "weight": "", "volume": "", "parcels": "1",
}

print("== 下单 parcelQty=1 ==")
res = place_order("顺丰", order)
print(json.dumps({k: res.get(k) for k in ("waybill_no", "waybills", "order_id", "parcels")},
                 ensure_ascii=False))
n = len(res.get("waybills") or [res["waybill_no"]])
print("返回运单数:", n, "→", "顺丰强制出子母件!" if n > 1 else "正常单件")

print("\n== 立即取消（dealType:2）==")
try:
    print(json.dumps(cancel_order("顺丰", res.get("order_id"), res["waybill_no"]),
                     ensure_ascii=False)[:300])
except Exception as e:
    print("取消失败（请人工取消 %s / orderId %s）：%s" % (res["waybill_no"], res.get("order_id"), e))
