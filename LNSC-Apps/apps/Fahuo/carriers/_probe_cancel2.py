#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""顺丰取消服务开通后复探（假单号，不产生真实取消）：
  期望：不再报 A1004 无权限，而是"订单不存在"类业务错误 = 服务可用
  变体：① {orderId, waybillNo} ② +dealType:2（用户提供的官方响应样例含 dealType:2）"""
import json
import os
import sys
import time
import uuid

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

cfg = base.get_cfg("SF")


def sf_raw(service, msg):
    msg_data = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
    ts = str(int(time.time() * 1000))
    form = {"partnerID": cfg["app_key"], "requestID": str(uuid.uuid4()),
            "serviceCode": service, "timestamp": ts,
            "msgDigest": base.md5_b64(msg_data + ts + cfg["app_secret"]),
            "msgData": msg_data}
    return base.http_post_form("https://bspgw.sf-express.com/std/service", form, timeout=30)


FAKE = "PROBECANCEL20260916"
print("== ① {orderId, waybillNo} ==")
try:
    print(json.dumps(sf_raw("EXP_RECE_CANCEL_ORDER",
          {"orderId": FAKE, "waybillNo": "SF0000000000000"}), ensure_ascii=False)[:600])
except Exception as e:
    print("EXC:", str(e)[:300])

print("\n== ② {orderId, waybillNo, dealType:2} ==")
try:
    print(json.dumps(sf_raw("EXP_RECE_CANCEL_ORDER",
          {"orderId": FAKE, "waybillNo": "SF0000000000000", "dealType": 2}),
          ensure_ascii=False)[:600])
except Exception as e:
    print("EXC:", str(e)[:300])

print("\n== ③ 仅 {orderId, dealType:2} ==")
try:
    print(json.dumps(sf_raw("EXP_RECE_CANCEL_ORDER",
          {"orderId": FAKE, "dealType": 2}), ensure_ascii=False)[:600])
except Exception as e:
    print("EXC:", str(e)[:300])
