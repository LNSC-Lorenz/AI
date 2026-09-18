#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""德邦 payType/回签单实测：payType=2 + backSignBill=1/R1 下单 → 面单文本 → 取消
   对照：现行 payType=1 面单显示"到付/无需返单"（#492 实测）"""
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
body = {
    "companyCode": cfg["app_key"],
    "custOrderNo": "TESTPAY" + str(int(time.time() * 1000)),
    "customerCode": cfg["cust_code"],
    "logisticID": deppon._next_logistic_id(cfg),
    "needTraceInfo": 1,
    "orderType": "2",
    "packageInfo": {
        "cargoName": "喷嘴",
        "deliveryType": "4",
        "totalNumber": 1, "totalVolume": 0.01, "totalWeight": 1,
        "packageService": "纸",
    },
    "receiver": {"province": "江苏省", "city": "常州市", "county": "金坛区",
                 "address": "德城路99号", "name": "测试", "mobile": "15190535163",
                 "companyName": ""},
    "sender": dict(deppon._SENDER, name="范蓓蓓", mobile="15190535163"),
    "transportType": "PACKAGE",
    "gmtCommit": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
    "payType": "2",              # ← 实验：现行=1 显示"到付"
    "isOut": "N",
    "backSignBill": "1",         # ← 现行回签单字段（验证是否生效）
    "returnRequirement": "R1",
}
print("logisticID:", body["logisticID"])
resp = deppon._signed_post(deppon._ENDPOINT, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
print("下单响应:", json.dumps(resp, ensure_ascii=False)[:300])
wb = deppon._extract_waybill(resp)
if not wb:
    sys.exit("未取到运单号")
wb = wb.split(",")[0].strip()
print("waybill:", wb)

print("\n== 取面单（德邦异步生成，退避重试）==")
text = ""
for wait in (8, 15, 30, 30):
    time.sleep(wait)
    try:
        lp = deppon.cloud_print(wb, cfg)
        url = lp["files"][0]["url"]
        pdf = urllib.request.urlopen(url, timeout=30).read()
        open("/tmp/dp_pay.pdf", "wb").write(pdf)
        from pypdf import PdfReader
        text = PdfReader("/tmp/dp_pay.pdf").pages[0].extract_text() or ""
        break
    except Exception as e:
        print("  重试…", str(e)[:80])
if text:
    for line in text.splitlines():
        if any(k in line for k in ("签收单", "返单", "到付", "寄付", "月结", "付")):
            print("  关键行:", line.strip())
else:
    print("❌ 面单未取到")

print("\n== 取消 ==")
try:
    r = deppon.cancel_order(body["custOrderNo"], wb, body["logisticID"], cfg)
    print(json.dumps(r, ensure_ascii=False)[:150])
except Exception as e:
    print("取消失败（人工处理 %s）: %s" % (wb, e))
