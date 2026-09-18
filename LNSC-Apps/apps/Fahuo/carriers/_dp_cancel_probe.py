#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦取消参数/接口形态探测：对真实测试单 DPK365090335534 依次试
   ①cancelOrder 原样重试（async 入账延迟）②cancelOrderNotify ③仅 mailNo ④仅 logisticID"""
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

from carriers import deppon  # noqa: E402

cfg = deppon._cfg()
WB, OID, LID = "DPK365090335534", "TESTDPC1789622672195", "NLHL3391198"
CC = cfg["cust_code"]

attempts = [
    ("cancelOrder", "cancelOrder", {"customerCode": CC, "custOrderNo": OID,
                                    "logisticID": LID, "mailNo": WB}),
    ("cancelOrderNotify", "cancelOrderNotify", {"customerCode": CC, "custOrderNo": OID,
                                                "logisticID": LID, "mailNo": WB}),
    ("cancelOrder 仅mailNo", "cancelOrder", {"customerCode": CC, "mailNo": WB}),
    ("cancelOrder 仅logisticID", "cancelOrder", {"customerCode": CC, "logisticID": LID}),
]

for name, iface, body in attempts:
    url = "https://gwapi.deppon.com/dop-interface-async/standard-order/%s.action" % iface
    print("== %s ==" % name)
    try:
        resp = deppon._signed_post(url, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
        print(json.dumps(resp, ensure_ascii=False)[:300])
        if str(resp.get("result", "")).lower() in ("true", "1"):
            print("★★★ 取消成功！形态 =", name)
            break
    except Exception as e:
        print("ERROR:", e)
    print()
    time.sleep(20)   # 每次间隔 20s，兼顾 async 入账延迟
