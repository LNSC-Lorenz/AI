#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰"拍照回传"字段批量探针 #2（2026-09-17）
   逐个候选结构尝试真实下单：成功→打印响应+订单查询回显→立即 dealType:2 取消；
   被拒（下单前失败）→ 零成本换下一个。首个成功者即字段终定。"""
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

CANDIDATES = [
    ("A extraInfoList POD=1",      {"extraInfoList": [{"attrCode": "POD", "attrVal": "1"}]}),
    ("B extraInfoList POD=Y",      {"extraInfoList": [{"attrCode": "POD", "attrVal": "Y"}]}),
    ("C extraInfoList POD 无值",    {"extraInfoList": [{"attrCode": "POD"}]}),
    ("D isSignBack=2(电子回单?)",   {"isSignBack": 2}),
    ("E isSignBack=1+POD 组合",    {"isSignBack": 1,
                                    "extraInfoList": [{"attrCode": "POD", "attrVal": "1"}]}),
]

for name, extra in CANDIDATES:
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
    }
    body.update(extra)
    print("====", name, "====")
    try:
        data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
    except Exception as e:
        print("  ✗ 被拒:", str(e)[:150])
        time.sleep(1)
        continue
    wbs = data.get("waybillNoInfoList") or []
    print("  ✓ 下单成功:", [w.get("waybillNo") for w in wbs])
    s = json.dumps(data, ensure_ascii=False)
    print("  响应含 POD/拍照/extraInfo:", [k for k in ("POD", "拍照", "extraInfo") if k in s])
    try:
        q = sf_express._call(cfg, "EXP_RECE_SEARCH_ORDER_RESP",
                             {"searchType": "1", "orderId": oid})
        sq = json.dumps(q, ensure_ascii=False)
        print("  订单查询含 POD/拍照/extraInfo:", [k for k in ("POD", "拍照", "extraInfo") if k in sq])
        # 回显片段
        i = max(sq.find("extraInfo"), sq.find("POD"), sq.find("拍照"))
        if i >= 0:
            print("  回显片段:", sq[max(0, i - 100):i + 200])
    except Exception as e:
        print("  订单查询失败:", str(e)[:100])
    print("  取消:", json.dumps(cancel_order("顺丰", oid, wbs[0].get("waybillNo")),
                              ensure_ascii=False)[:120])
    print("  ★ 候选可用 →", name)
    break
    time.sleep(1)
