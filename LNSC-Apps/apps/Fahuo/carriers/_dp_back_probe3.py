#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦回签单字段实测③：取值形式候选（Y/N、数字枚举、needBackSignBill）"""
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
    ("V8 backSignBill=Y", {"backSignBill": "Y"}),
    ("V9 backSignBill=1+returnRequirement=1", {"backSignBill": "1", "returnRequirement": "1"}),
    ("V10 needBackSignBill=1", {"needBackSignBill": "1"}),
]


def run(tag, extra):
    body = {
        "companyCode": cfg["app_key"],
        "custOrderNo": "TESTBK" + str(int(time.time() * 1000)),
        "customerCode": cfg["cust_code"],
        "logisticID": deppon._next_logistic_id(cfg),
        "needTraceInfo": 1, "orderType": "2",
        "packageInfo": {"cargoName": "喷嘴", "deliveryType": "4",
                        "totalNumber": 1, "totalVolume": 0.01, "totalWeight": 1,
                        "packageService": "纸"},
        "receiver": {"province": "江苏省", "city": "常州市", "county": "金坛区",
                     "address": "德城路99号", "name": "测试", "mobile": "15190535163",
                     "companyName": ""},
        "sender": dict(deppon._SENDER, name="范蓓蓓", mobile="15190535163"),
        "transportType": "PACKAGE",
        "gmtCommit": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "payType": "2", "isOut": "N",
    }
    body.update(extra)
    resp = deppon._signed_post(deppon._ENDPOINT, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
    wb = deppon._extract_waybill(resp)
    if not wb:
        print(tag, "下单失败:", json.dumps(resp, ensure_ascii=False)[:150])
        return
    wb = wb.split(",")[0].strip()
    line = "(面单未取到)"
    for wait in (10, 20, 30):
        time.sleep(wait)
        try:
            lp = deppon.cloud_print(wb, cfg)
            pdf = urllib.request.urlopen(lp["files"][0]["url"], timeout=30).read()
            from pypdf import PdfReader
            open("/tmp/dp_bk3.pdf", "wb").write(pdf)
            t = PdfReader("/tmp/dp_bk3.pdf").pages[0].extract_text() or ""
            line = next((l.strip() for l in t.splitlines() if "签收单" in l or "返单" in l), "(无签收单行)")
            break
        except Exception as e:
            line = "(重试:%s)" % str(e)[:40]
    print("%-36s %s → %s" % (tag, wb, line))
    try:
        deppon.cancel_order(body["custOrderNo"], wb, body["logisticID"], cfg)
    except Exception as e:
        print("  取消失败（人工处理）:", str(e)[:80])


for tag, extra in variants:
    run(tag, extra)
