#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""expressTypeId 1 vs 2 对照实验（2026-09-18 争议：客服/用户称 1=特快，实测曾见 1→proCode 标快）
   同一时刻四单对照：近线常州 × (1,2) + 远线济南 × (1,2)
   比较响应 proCode/proName/limitTypeCode —— 1 和 2 谁是谁当场现形
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

DESTS = {
    "常州(近线)": {"province": "江苏省", "city": "常州市", "county": "金坛区",
                   "address": "德城路99号"},
    "济南(远线)": {"province": "山东省", "city": "济南市", "county": "历城区",
                   "address": "工业北路100号"},
}

for dname, dest in DESTS.items():
    for etype in (1, 2):
        oid = "TESTT" + str(etype) + str(int(time.time() * 1000))
        body = {
            "language": "zh-CN",
            "orderId": oid,
            "contactInfoList": [
                dict(sf_express._SENDER, contact="范蓓蓓", tel="15190535163",
                     company="莱克勒喷嘴系统（常州）有限公司"),
                dict(dest, contactType=2, country="CN", contact="测试",
                     mobile="15190535163", company=""),
            ],
            "cargoDetails": [{"name": "喷嘴", "count": 1, "unit": "个", "sourceArea": "CHN"}],
            "cargoDesc": "喷嘴",
            "expressTypeId": etype,          # ← 对照变量
            "payMethod": 1,
            "monthlyCard": cfg.get("cust_code", ""),
            "parcelQty": 1,
            "isDocall": 0,
            "isReturnRouteLabel": 1,
        }
        print(f"==== {dname} expressTypeId={etype} ====")
        try:
            data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
        except Exception as e:
            print("  ✗ 被拒:", str(e)[:120])
            continue
        wbs = data.get("waybillNoInfoList") or []
        lbs = data.get("routeLabelInfo") or []
        ld = (lbs[0].get("routeLabelData") if lbs else {}) or {}
        print("  运单:", wbs[0].get("waybillNo") if wbs else "?",
              "| proCode:", ld.get("proCode"),
              "| proName:", ld.get("proName"),
              "| limitTypeCode:", ld.get("limitTypeCode"))
        print("  取消:", json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                                  ensure_ascii=False)[:80])
        time.sleep(1)
