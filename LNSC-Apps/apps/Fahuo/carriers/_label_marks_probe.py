#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""离线核验（2026-10-08 用户规则，回单标识改口径；同日撤销托寄物后缀）：

  面单「托寄物」**原样传递、不加「的回单」后缀**（同日用户原话「移除备注加的 的回单 3个字」）
  + 备注不再打印「需纸质回单」（只留「需拍照回传」）

不触网、不下真单：只 monkeypatch 承运商 HTTP 出口，拦截**下单报文**逐字段断言。
用法（服务器/本地均可）：python3 carriers/_label_marks_probe.py
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from carriers import deppon, sf_express

CFG = {"app_key": "k", "app_secret": "s", "cust_code": "c"}


def _order(receipt):
    """实证单（用户 2026-10-08 截图）：DN 8260034693 / SO 3260027425 / 订单号(oid) 2106 / 喷嘴 25pcs"""
    return {
        "so": "8260034693", "oid": "2106", "order_type": "发货单",
        "province": "江苏省", "city": "常州市", "district": "金坛区", "street": "德城路99号",
        "name": "张三", "phone": "13800000000", "company": "某公司",
        "cargo": "喷嘴", "qty": 25, "parcels": 1, "product": "顺丰标快",
        "pay": "寄付月结", "insured": "",
        "remark": "DN：8260034693 SO：3260027425", "receipt": receipt,
    }


def sf_body(receipt):
    """→ 顺丰下单报文 body（拦 _call，不触网）"""
    got = {}

    def fake_call(cfg, service_code, msg_dict, timeout=30):
        got["code"], got["body"] = service_code, msg_dict
        return {"orderId": "2106",
                "waybillNoInfoList": [{"waybillNo": "SF0000000000001", "waybillType": 1}]}

    orig = sf_express._call
    sf_express._call = fake_call
    try:
        sf_express._real_place_order(_order(receipt), CFG)
    finally:
        sf_express._call = orig
    return got["body"]


def dp_body(receipt):
    """→ 德邦下单报文 body（拦 _signed_post / _next_logistic_id，绝不写计数文件）"""
    got = {}

    def fake_post(url, cfg, params, timeout=30):
        got["body"] = json.loads(params)
        return {"result": "true", "resultCode": "1000", "responseParam": {"mailNo": "DPK0000000001"}}

    orig_post, orig_lid = deppon._signed_post, deppon._next_logistic_id
    deppon._signed_post = fake_post
    deppon._next_logistic_id = lambda cfg: "NLP0000000"
    try:
        deppon._real_place_order(_order(receipt), CFG)
    finally:
        deppon._signed_post, deppon._next_logistic_id = orig_post, orig_lid
    return got["body"]


FAILED = []


def check(name, got, want):
    ok = got == want
    if not ok:
        FAILED.append(name)
    print("  [%s] %s\n        实得 = %r\n        期望 = %r" % ("PASS" if ok else "FAIL", name, got, want))


print("== ① 顺丰：纸质回单 + 拍照回传（用户截图那张单的口径）==")
b = sf_body(["纸质回单", "拍照回传"])
check("cargoDesc（面单托寄物，原样不加「的回单」）", b.get("cargoDesc"), "喷嘴 25pcs")
check("cargoDetails[0].name", b["cargoDetails"][0]["name"], "喷嘴 25pcs")
check("remark（已无「需纸质回单」）", b.get("remark"), "DN：8260034693 SO：3260027425 需拍照回传")
check("isSignBack（纸质回单）", b.get("isSignBack"), 1)
check("serviceList（拍照回传 IN91）", b.get("serviceList"), [{"name": "IN91", "value": "13"}])

print("== ② 顺丰：仅纸质回单 ==")
b = sf_body(["纸质回单"])
check("cargoDesc（原样，不加「的回单」）", b.get("cargoDesc"), "喷嘴 25pcs")
check("remark（无标识后缀）", b.get("remark"), "DN：8260034693 SO：3260027425")

print("== ③ 顺丰：仅拍照回传 ==")
b = sf_body(["拍照回传"])
check("cargoDesc（原样，不加「的回单」）", b.get("cargoDesc"), "喷嘴 25pcs")
check("remark", b.get("remark"), "DN：8260034693 SO：3260027425 需拍照回传")

print("== ④ 顺丰：未勾回单（托寄物原样、无标识）==")
b = sf_body([])
check("cargoDesc", b.get("cargoDesc"), "喷嘴 25pcs")
check("remark", b.get("remark"), "DN：8260034693 SO：3260027425")
check("未下发 isSignBack", "isSignBack" in b, False)

print("== ⑤ 德邦：纸质回单 / 未勾回单 ==")
b = dp_body(["纸质回单"])
check("packageInfo.cargoName（原样，不加「的回单」）", b["packageInfo"]["cargoName"], "喷嘴 25pcs")
check("addServices（纸质回单三字段）", b.get("addServices"),
      {"backSignBill": "1", "returnRequirement": "R1", "returnBillQty": 1})
b = dp_body([])
check("packageInfo.cargoName", b["packageInfo"]["cargoName"], "喷嘴 25pcs")

print("PROBE_LABEL_MARKS_" + ("OK" if not FAILED else "FAILED " + ", ".join(FAILED)))
sys.exit(0 if not FAILED else 1)