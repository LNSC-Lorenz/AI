#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰 isSignBack=2 响应全文探针 #3（2026-09-17）：确认 =2 是否即"拍照回传"
   真实下单 → 打印完整 JSON 响应（定位 POD 上下文）→ 立即 dealType:2 取消"""
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
oid = "TESTPOD" + str(int(time.time() * 1000))
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
    "expressTypeId": 1,
    "payMethod": 1,
    "monthlyCard": cfg.get("cust_code", ""),
    "parcelQty": 1,
    "isSignBack": 2,          # ← 候选：拍照回传/电子回单
    "isDocall": 0,
    "isReturnRouteLabel": 1,
}
data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
wbs = data.get("waybillNoInfoList") or []
print("waybillNoInfoList:")
print(json.dumps(wbs, ensure_ascii=False, indent=1))
# 非面单部分全量打印（routeLabelInfo 太长只看键）
top = {k: v for k, v in data.items() if k != "routeLabelInfo"}
print("\n其余字段:")
print(json.dumps(top, ensure_ascii=False, indent=1)[:2000])
# POD 上下文定位
s = json.dumps(data, ensure_ascii=False)
i = s.find("POD")
while i >= 0:
    print("\nPOD 上下文:", s[max(0, i - 120):i + 160])
    i = s.find("POD", i + 1)
    if i > 6000:
        break
# 面单 label 里的服务标记
for lb in (data.get("routeLabelInfo") or [])[:1]:
    ld = lb.get("routeLabelData") or {}
    print("\n面单 keys:", sorted(ld.keys()))
    for k in ("destRouteLabel", "printIcon", "proCode", "abFlag", "xbFlag",
              "signBackIcon", "codingMapping", "twoDimensionCode"):
        if k in ld:
            print(" ", k, "=", str(ld[k])[:120])

print("\n== 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                 ensure_ascii=False)[:200])
