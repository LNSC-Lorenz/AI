#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""isSignBack=3 探针（2026-09-18 用户规则：纸质回单+拍照回传可同时勾选）
   假设：3=纸质+拍照组合（物流 API 常见 3=both）
   真实下单 → 看是否被接受/响应结构 → 立即 dealType:2 取消"""
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

from carriers import base, cancel_order  # noqa: E402
from carriers import sf_express  # noqa: E402

cfg = base.get_cfg("SF")
oid = "TESTSB3" + str(int(time.time() * 1000))
body = {
    "language": "zh-CN",
    "orderId": oid,
    "contactInfoList": [
        dict(sf_express._SENDER, contact="范蓓蓓", tel="15190535163",
             company="莱克勒喷嘴系统（常州）有限公司"),
        {"contactType": 2, "country": "CN", "province": "江苏省", "city": "常州市",
         "county": "金坛区", "address": "德城路99号", "contact": "测试",
         "mobile": "15190535163", "company": ""},
    ],
    "cargoDetails": [{"name": "喷嘴", "count": 1, "unit": "个", "sourceArea": "CHN"}],
    "cargoDesc": "喷嘴",
    "expressTypeId": 2,          # 标快（2026-09-18 终定：1=特快 2=标快）
    "payMethod": 1,
    "monthlyCard": cfg.get("cust_code", ""),
    "parcelQty": 1,
    "isSignBack": 3,             # ← 探针目标：纸质+拍照组合？
    "isDocall": 0,
    "isReturnRouteLabel": 1,
}
try:
    data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
except Exception as e:
    print("isSignBack=3 被拒:", e)
    sys.exit(0)
wbs = data.get("waybillNoInfoList") or []
print("isSignBack=3 被接受 ✓")
print("运单:", [(w.get("waybillType"), w.get("waybillNo")) for w in wbs])
print("returnExtraInfoList:", json.dumps(data.get("returnExtraInfoList"), ensure_ascii=False))
lbs = data.get("routeLabelInfo") or []
if lbs:
    ld = lbs[0].get("routeLabelData") or {}
    print("proCode:", ld.get("proCode"), "| waybillIconList:",
          json.dumps(ld.get("waybillIconList"), ensure_ascii=False))
print("\n== 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                 ensure_ascii=False)[:150])
