#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰"拍照回传"增值服务字段探针（2026-09-17 用户新需求）
   候选：extraInfoList [{"attrCode":"POD","attrVal":"1"}]（老顺丰接口 AddedService POD=拍照回传）
   流程：真实下单 → 打印完整响应 → 订单结果查询看增值服务回显 → 立即 dealType:2 取消"""
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
    "isDocall": 0,
    "isReturnRouteLabel": 1,
    # ← 探针目标：拍照回传增值服务
    "extraInfoList": [{"attrCode": "POD", "attrVal": "1"}],
}
try:
    data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
except Exception as e:
    print("下单被拒（字段/代码不被接受）:", e)
    sys.exit(0)
wbs = data.get("waybillNoInfoList") or []
print("下单成功 orderId:", data.get("orderId"))
for w in wbs:
    print("  waybillType:", w.get("waybillType"), "| waybillNo:", w.get("waybillNo"))
# 完整响应里找增值服务回显
s = json.dumps(data, ensure_ascii=False)
print("响应含 POD/拍照/增值 关键字:", [k for k in ("POD", "拍照", "extraInfo", "增值") if k in s])

print("\n== 订单结果查询（看增值服务是否回显）==")
try:
    q = sf_express._call(cfg, "EXP_RECE_SEARCH_ORDER_RESP",
                         {"searchType": "1", "orderId": oid})
    sq = json.dumps(q, ensure_ascii=False)
    print(sq[:1500])
    print("查询含 POD/拍照 关键字:", [k for k in ("POD", "拍照") if k in sq])
except Exception as e:
    print("查询失败:", e)

print("\n== 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                 ensure_ascii=False)[:200])
