#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰 isSignBack 0/1/2 对照探针 #4（2026-09-17）
   三单对照：无回单 / =1 纸质 / =2 候选拍照回传
   比较 waybillIconList、printIcon、returnExtraInfoList、type3 运单 —— 判定 =2 是否为独立增值服务
   每单：真实下单 → 打印对照字段 → 立即 dealType:2 取消"""
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

for tag, val in [("无(基线)", None), ("=1 纸质回单", 1), ("=2 候选拍照回传", 2)]:
    oid = "TESTSB" + str(int(time.time() * 1000))
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
    }
    if val is not None:
        body["isSignBack"] = val
    print("==== isSignBack", tag, "====")
    try:
        data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
    except Exception as e:
        print("  ✗ 被拒:", str(e)[:120])
        continue
    wbs = data.get("waybillNoInfoList") or []
    print("  运单:", [(w.get("waybillType"), w.get("waybillNo")) for w in wbs])
    print("  returnExtraInfoList:", json.dumps(data.get("returnExtraInfoList"), ensure_ascii=False))
    lbs = data.get("routeLabelInfo") or []
    if lbs:
        ld = lbs[0].get("routeLabelData") or {}
        print("  waybillIconList:", json.dumps(ld.get("waybillIconList"), ensure_ascii=False))
        print("  printIcon:", ld.get("printIcon"), "| proIcon:", ld.get("proIcon"),
              "| newIcon:", ld.get("newIcon"))
    print("  取消:", json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                              ensure_ascii=False)[:100])
    time.sleep(1)
