#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IN91 拍照回传增值服务探针（2026-09-24）：真单验证 serviceList IN91 value=13 通道
   A 仅拍照回传（IN91，不带 isSignBack）  B 纸质+拍照（isSignBack=1 + IN91）
   观察：网关/业务层是否接受、waybillNoInfoList 是否返 type=3 回单运单；真实运单，测完立即取消
   远程：Get-Content 本文件 -Raw | ssh <host> "sudo bash -c 'set -a; . <app>/carriers.env; cd <app>/carriers; python3 -'\""""
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

from carriers import place_order, cancel_order  # noqa: E402


def mk(receipt, tag):
    return {
        "so": "TESTV", "oid": "TESTV%s%d" % (tag, int(time.time() * 1000)),
        "order_type": "发货单",
        "province": "江苏省", "city": "常州市", "district": "金坛区",
        "street": "德城路99号", "name": "测试", "phone": "15190535163",
        "company": "", "cargo": "喷嘴", "product": "顺丰标快", "pay": "寄付月结",
        "insured": "", "receipt": receipt, "weight": "", "volume": "", "parcels": "1",
    }


for tag, receipt in (("A", ["拍照回传"]), ("B", ["纸质回单", "拍照回传"])):
    print("== %s receipt=%s ==" % (tag, receipt))
    try:
        res = place_order("顺丰", mk(receipt, tag))
        print(json.dumps({k: res.get(k) for k in
                          ("waybill_no", "waybills", "sign_back_no", "parcels",
                           "order_id", "isSignBack", "serviceList")}, ensure_ascii=False))
        print("== 取消 ==")
        print(json.dumps(cancel_order("顺丰", res.get("order_id"), res["waybill_no"]),
                         ensure_ascii=False)[:120])
    except Exception as e:
        print("❌ %s: %s" % (tag, e))
