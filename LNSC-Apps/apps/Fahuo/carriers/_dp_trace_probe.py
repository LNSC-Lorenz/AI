#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦新标准轨迹查询（newTraceQuery）报文探测：多参数形态试真单，打印原始响应
   用法：python3 carriers/_dp_trace_probe.py [运单号]"""
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

from carriers import deppon  # noqa: E402

URL = "https://dpapi.deppon.com/dop-interface-sync/standard-query/newTraceQuery.action"
WB = sys.argv[1] if len(sys.argv) > 1 else "DPK365090306876"

cfg = deppon._cfg()
print("configured:", deppon._configured(cfg))

variants = [
    {"waybillNo": WB, "customerCode": cfg["cust_code"]},
    {"waybillNos": WB, "customerCode": cfg["cust_code"]},
    {"waybillNo": WB},
    {"mailNo": WB, "customerCode": cfg["cust_code"]},
]
for i, body in enumerate(variants, 1):
    print("\n== 形态%d %s ==" % (i, list(body.keys())))
    try:
        resp = deppon._signed_post(URL, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
        print(json.dumps(resp, ensure_ascii=False)[:1500])
        if str(resp.get("result", "")).lower() in ("true", "1"):
            print("★ 成功形态 =", list(body.keys()))
            break
    except Exception as e:
        print("ERROR:", e)
