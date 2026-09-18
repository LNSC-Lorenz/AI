#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦对接验证：①真单轨迹（newTraceQuery）②取消假单探测（看 3002 是否已开通）"""
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

print("== ① 真单轨迹 #489 母单 ==")
try:
    r = deppon.query_route("DPK365090306876")
    print(json.dumps(r, ensure_ascii=False)[:400])
except Exception as e:
    print("ERROR:", e)

print("\n== ② 取消假单探测（假单号，不碰真单）==")
try:
    r = deppon.cancel_order("TESTFAKE123", "DPK000000000000", "NLHL0000000")
    print("意外成功？！", json.dumps(r, ensure_ascii=False)[:200])
except Exception as e:
    msg = str(e)
    print("返回:", msg[:200])
    if "3002" in msg:
        print("→ 仍是 3002 接口权限不足：需德邦开放平台订阅 cancelOrder")
    else:
        print("→ 非 3002：取消接口权限已通（假单报业务错误属正常）")
