#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""关键实验：parcelQty=1 + 纸质回单(isSignBack=1) → 看 waybillNoInfoList 返回几条
   假设：isSignBack=1 会让顺丰多返一条"签单返还回单"运单 → 被前端误判为子件（显示②）
   真实运单，测完立即取消"""
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
from carriers import sf_express  # noqa: E402

# 直接构造完整请求以拿到 waybillNoInfoList 原始结构（含 waybillType）
cfg = base.get_cfg("SF")
body = {
    "language": "zh-CN",
    "orderId": "TESTSB" + str(int(time.time() * 1000)),
    "contactInfoList": [
        dict(sf_express._SENDER, contact="范蓓蓓", tel="15190535163",
             company="莱克勒喷嘴系统（常州）有限公司"),
        {"contactType": 2, "country": "CN", "province": "江苏省", "city": "常州市",
         "county": "金坛区", "address": "德城路99号", "contact": "测试",
         "mobile": "15190535163", "company": ""},
    ],
    "cargoDetails": [{"name": "喷嘴", "count": 1, "unit": "个", "sourceArea": "CHN"}],
    "cargoDesc": "喷嘴",
    "expressTypeId": 1,
    "payMethod": 1,
    "monthlyCard": cfg.get("cust_code", ""),
    "parcelQty": 1,          # ← 只下 1 件
    "isSignBack": 1,         # ← 纸质回单（假设的"第2单"来源）
    "isDocall": 0,
    "isReturnRouteLabel": 1,
}
data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
wbs = data.get("waybillNoInfoList") or []
print("orderId:", data.get("orderId"))
print("waybillNoInfoList 条数:", len(wbs))
for w in wbs:
    print("  waybillType:", w.get("waybillType"), "| waybillNo:", w.get("waybillNo"))
print("→", "⚠️ 实锤：纸质回单导致多返运单！" if len(wbs) > 1 else "正常单条（回单理论不成立）")

print("\n== 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", data.get("orderId"), wbs[0].get("waybillNo")),
                 ensure_ascii=False)[:150])
