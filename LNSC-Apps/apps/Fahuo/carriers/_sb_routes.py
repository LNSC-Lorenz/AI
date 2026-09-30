#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""历史回单单（485/487/494/543）的回单运单完整轨迹流向核查：
   验证 SF 是否自动用同一 SF106 回单号做反向返回段（客户城市揽收→常州签收）。"""
import json
import os
import sqlite3
import sys

BASE = "/var/www/lnsc-apps/apps/fahuo"
sys.path.insert(0, BASE)
ENV_FILE = os.path.join(BASE, "carriers.env")
if os.path.isfile(ENV_FILE):
    for line in open(ENV_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())

from carriers import base, sf_express  # noqa: E402

cfg = base.get_cfg("SF")
con = sqlite3.connect(os.path.join(BASE, "fahuo.db"))
con.row_factory = sqlite3.Row
rows = con.execute(
    "SELECT id,waybill_no,status,returned_at,route_latest,order_resp FROM orders"
    " WHERE id IN (485,487,494,543)").fetchall()
for r in rows:
    resp = json.loads(r["order_resp"] or "{}")
    sb = resp.get("sign_back_no") or ""
    print("=" * 70)
    print("order#%s main=%s sb=%s status=%s returned_at=%s route_latest=%s"
          % (r["id"], r["waybill_no"], sb, r["status"], r["returned_at"],
             (r["route_latest"] or "")[:60]))
    if not sb:
        continue
    try:
        d = sf_express._real_query_route(sb, cfg)
        print("  sb route_status:", d.get("route_status"))
        for n in d.get("detail") or []:
            print("   node: %s | %s | %s | %s" % (
                n.get("acceptTime"), n.get("acceptAddress"),
                n.get("firstStatusName") or n.get("secondaryStatusName"),
                (n.get("remark") or "")[:40]))
    except Exception as e:
        print("  route err:", repr(e)[:160])
