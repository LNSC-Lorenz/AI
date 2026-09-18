#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰 limitTypeCode 请求强制力实测（傍晚"特快降标快"窗口反向验证）：
   对照（18:33 已测）：expressTypeId=2 不带 limitTypeCode → 玉溪 返回 标快/T6
   V1: expressTypeId=2 + limitTypeCode=T4 → 若返 特快/T4 = 字段可强制产品
   V2: expressTypeId=1 + limitTypeCode=T4 → 若返 特快/T4 = limitTypeCode 主导
   真实运单，测完即取消"""
import json
import os
import re
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

from carriers import base, cancel_order, sf_express  # noqa: E402

cfg = base.get_cfg("SF")


def probe(tag, express_type_id, limit_code):
    sender = dict(sf_express._SENDER, contact="范蓓蓓", tel="15190535163",
                  company="莱克勒喷嘴系统（常州）有限公司")
    body = {
        "language": "zh-CN",
        "orderId": "TESTL" + str(int(time.time() * 1000)),
        "contactInfoList": [sender, {
            "contactType": 2, "country": "CN", "province": "云南省", "city": "玉溪市",
            "county": "峨山彝族自治县", "address": "测试路1号", "contact": "测试",
            "mobile": "15190535163", "company": ""}],
        "cargoDetails": [{"name": "喷嘴", "count": 1, "unit": "个", "sourceArea": "CHN"}],
        "cargoDesc": "喷嘴",
        "expressTypeId": express_type_id,
        "payMethod": 1, "monthlyCard": cfg.get("cust_code", ""),
        "parcelQty": 1, "isDocall": 0, "isReturnRouteLabel": 1,
    }
    if limit_code:
        body["limitTypeCode"] = limit_code
    try:
        data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
    except Exception as e:
        print("%-40s 下单被拒: %s" % (tag, str(e)[:120]))
        return
    wbs = data.get("waybillNoInfoList") or []
    wb = wbs[0].get("waybillNo", "") if wbs else ""
    li = (data.get("routeLabelInfo") or [{}])[0].get("routeLabelData") or {}
    m = re.search(r"'k4':'([^']*)'", str(li.get("twoDimensionCode", "")))
    print("%-40s %s | proCode=%s expressTypeCode=%s limitTypeCode=%s k4=%s" % (
        tag, wb, li.get("proCode"), li.get("expressTypeCode"),
        li.get("limitTypeCode"), m.group(1) if m else "-"))
    try:
        cancel_order("顺丰", data.get("orderId", body["orderId"]), wb)
    except Exception as e:
        print("  取消失败（人工处理 %s）: %s" % (wb, str(e)[:60]))


probe("V1 特快(2)+limitTypeCode=T4", 2, "T4")
probe("V2 标快(1)+limitTypeCode=T4", 1, "T4")
probe("V3 标快(1)不带limitTypeCode-对照", 1, None)
