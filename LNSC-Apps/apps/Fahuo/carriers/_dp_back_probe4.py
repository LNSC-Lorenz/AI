#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦回签单字段实测④：orderType/transportType 维度（字段可能对特定单型才生效）"""
import json
import os
import sys
import time
import urllib.request

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

variants = [
    ("V11 orderType=1", {"orderType": "1", "transportType": "PACKAGE"}),
    ("V12 transportType=EXPRESS", {"orderType": "2", "transportType": "EXPRESS"}),
]


def run(tag, ov):
    body = {
        "companyCode": cfg["app_key"],
        "custOrderNo": "TESTBK" + str(int(time.time() * 1000)),
        "customerCode": cfg["cust_code"],
        "logisticID": deppon._next_logistic_id(cfg),
        "needTraceInfo": 1,
        "orderType": ov["orderType"],
        "packageInfo": {"cargoName": "喷嘴", "deliveryType": "4",
                        "totalNumber": 1, "totalVolume": 0.01, "totalWeight": 1,
                        "packageService": "纸"},
        "receiver": {"province": "江苏省", "city": "常州市", "county": "金坛区",
                     "address": "德城路99号", "name": "测试", "mobile": "15190535163",
                     "companyName": ""},
        "sender": dict(deppon._SENDER, name="范蓓蓓", mobile="15190535163"),
        "transportType": ov["transportType"],
        "gmtCommit": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "payType": "2", "isOut": "N",
        "backSignBill": "1", "returnRequirement": "R1",
    }
    resp = deppon._signed_post(deppon._ENDPOINT, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
    if str(resp.get("result", "")).lower() not in ("true", "1"):
        print(tag, "下单被拒:", json.dumps(resp, ensure_ascii=False)[:180])
        return
    wb = (deppon._extract_waybill(resp) or "").split(",")[0].strip()
    if not wb:
        print(tag, "无运单号:", json.dumps(resp, ensure_ascii=False)[:150])
        return
    line = "(面单未取到)"
    for wait in (10, 20, 30):
        time.sleep(wait)
        try:
            lp = deppon.cloud_print(wb, cfg)
            pdf = urllib.request.urlopen(lp["files"][0]["url"], timeout=30).read()
            open("/tmp/dp_bk4.pdf", "wb").write(pdf)
            from pypdf import PdfReader
            t = PdfReader("/tmp/dp_bk4.pdf").pages[0].extract_text() or ""
            line = next((l.strip() for l in t.splitlines() if "签收单" in l or "返单" in l), "(无签收单行)")
            break
        except Exception as e:
            line = "(重试:%s)" % str(e)[:40]
    print("%-28s %s → %s" % (tag, wb, line))
    try:
        deppon.cancel_order(body["custOrderNo"], wb, body["logisticID"], cfg)
    except Exception as e:
        print("  取消失败（人工处理）:", str(e)[:80])


for tag, ov in variants:
    run(tag, ov)
