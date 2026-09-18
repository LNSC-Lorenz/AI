#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰订单结果查询（EXP_RECE_SEARCH_ORDER_RESP）：查 orderId 的创建时间/件数/运单
   目的：验证 #484 第4单 orderId=2026 返回2单是否为旧单幂等重放（oid 撞单）"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import base  # noqa: E402
from carriers import sf_express  # noqa: E402

cfg = base.get_cfg("SF")

for oid in sys.argv[1:] or ["2026", "2025"]:
    print("== orderId", oid, "==")
    try:
        r = sf_express._call(cfg, "EXP_RECE_SEARCH_ORDER_RESP",
                             {"searchType": "1", "orderId": oid})
        print(json.dumps(r, ensure_ascii=False)[:1200])
    except Exception as e:
        print("ERROR:", e)
    print()
