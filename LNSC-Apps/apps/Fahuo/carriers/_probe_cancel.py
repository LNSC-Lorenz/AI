#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""取消下单接口探测（全部用假单号，不产生真实取消）：
  顺丰 EXP_RECE_CANCEL_ORDER：假 orderId → "订单不存在"=接口通；"服务不存在"=服务名错
  德邦：候选 endpoint × params 组合 → JSON 业务错误=接口存在；404/HTML/异常=路径错
判定后把正确形态固化进 sf_express.py / deppon.py 的 cancel_order。"""
import base64
import hashlib
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

FAKE = "PROBECANCEL20260916"

# ---------- 顺丰 ----------
cfg = base.get_cfg("SF")


def sf_raw(service, msg):
    msg_data = json.dumps(msg, ensure_ascii=False, separators=(",", ":"))
    ts = str(int(time.time() * 1000))
    form = {"partnerID": cfg["app_key"], "requestID": str(uuid.uuid4()),
            "serviceCode": service, "timestamp": ts,
            "msgDigest": base.md5_b64(msg_data + ts + cfg["app_secret"]),
            "msgData": msg_data}
    return base.http_post_form("https://bspgw.sf-express.com/std/service", form, timeout=30)


print("== SF EXP_RECE_CANCEL_ORDER {orderId,waybillNo} ==")
try:
    r = sf_raw("EXP_RECE_CANCEL_ORDER", {"orderId": FAKE, "waybillNo": "SF0000000000000"})
    print(json.dumps(r, ensure_ascii=False)[:800])
except Exception as e:
    print("EXC:", str(e)[:400])

print("\n== SF EXP_RECE_CANCEL_ORDER 仅 {orderId} ==")
try:
    r = sf_raw("EXP_RECE_CANCEL_ORDER", {"orderId": FAKE})
    print(json.dumps(r, ensure_ascii=False)[:800])
except Exception as e:
    print("EXC:", str(e)[:400])

# ---------- 德邦 ----------
db = base.get_cfg("DB")


def db_raw(url, params_dict):
    params = json.dumps(params_dict, ensure_ascii=False)
    ts = base.ts_ms()
    digest = base64.b64encode(
        hashlib.md5((params + db["app_secret"] + ts).encode("utf-8")).hexdigest()
        .encode("ascii")).decode("ascii")
    try:
        r = base.http_post_form(url, {"companyCode": db["app_key"], "timestamp": ts,
                                      "digest": digest, "params": params}, timeout=30)
        return json.dumps(r, ensure_ascii=False)[:500]
    except Exception as e:
        return "EXC: " + str(e)[:300]


DB_CANDS = [
    "https://gwapi.deppon.com/dop-interface-async/standard-order/cancelOrder.action",
    "https://gwapi.deppon.com/dop-interface-async/standard-order/cancelOrderNotify.action",
    "https://dpapi.deppon.com/dop-interface-sync/standard-order/cancelOrder.action",
    "https://dpapi.deppon.com/dop-interface-sync/standard-order/cancelOrderNotify.action",
]
DB_PARAMS = [
    {"custOrderNo": FAKE},
    {"logisticID": FAKE},
    {"customerCode": db.get("cust_code", ""), "custOrderNo": FAKE},
    {"customerCode": db.get("cust_code", ""), "logisticID": FAKE},
]
for u in DB_CANDS:
    for pv in DB_PARAMS:
        print("\n== DB %s %s ==" % (u.split("/")[-1], sorted(pv)))
        print(db_raw(u, pv))
