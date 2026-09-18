#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""核实"选标快到底传了什么"（2026-09-18 顺丰客服称 expressTypeId=1=特快）
   ① 查库：最近真实顺丰单的 实际产品 proCode（SF 线路改派结果）
   ② 真单探针：以 product="顺丰标快" 走 place_order 完整链路，
      打印实际发出的 expressTypeId + 响应 proCode/limitTypeCode → 立即 dealType:2 取消"""
import json
import os
import sqlite3
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

from carriers import base, place_order, cancel_order  # noqa: E402
from carriers import sf_express  # noqa: E402

print("== ① 映射表与最近真实单 ==")
print("_PRODUCT_TYPE =", sf_express._PRODUCT_TYPE)
c = sqlite3.connect(os.path.join(BASE, "fahuo.db"))
rows = c.execute(
    "SELECT id, so, waybill_no, order_resp FROM orders"
    " WHERE waybill_no LIKE 'SF%' ORDER BY id DESC LIMIT 8").fetchall()
for r in rows:
    rd = json.loads(r[3] or "{}")
    li = rd.get("label_info") or {}
    print(f"  #{r[0]} {r[1]} {r[2]} 实际产品proCode={li.get('proCode')}"
          f" limitTypeCode={li.get('limitTypeCode')}")

print("\n== ② 真单探针：选'顺丰标快'完整链路 ==")
order = {
    "so": "TESTPROD", "oid": "TESTPROD" + str(int(time.time() * 1000)),
    "order_type": "发货单",
    "province": "江苏省", "city": "常州市", "district": "金坛区",
    "street": "德城路99号", "name": "测试", "phone": "15190535163",
    "company": "", "cargo": "喷嘴",
    "product": "顺丰标快",          # ← 用户在前端选的就是这个
    "pay": "寄付月结", "parcels": 1, "qty": 1,
}
# 打印链路内实际映射（与 sf_express.order 同一表达式）
print("product =", order["product"],
      "→ expressTypeId =", sf_express._PRODUCT_TYPE.get(order["product"], 1))
res = place_order("顺丰", order)
print("响应: waybill_no =", res.get("waybill_no"))
li = res.get("label_info") or {}
print("实际产品 proCode =", li.get("proCode"),
      "| limitTypeCode =", li.get("limitTypeCode"),
      "| 二维码k4 =", (li.get("twoDimensionCode") or "").split("'k4':'")[-1].split("'")[0]
      if "k4" in (li.get("twoDimensionCode") or "") else "")
print("\n== 取消（dealType:2）==")
print(json.dumps(cancel_order("顺丰", res.get("order_id"), res.get("waybill_no")),
                 ensure_ascii=False)[:150])
