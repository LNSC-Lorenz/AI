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

print("== ⑥ 顺丰：纸质回单 + 盖章（签回单盖章，attr015=2）==")
b = sf_body(["纸质回单", "盖章"])
check("isSignBack（盖章同样按签单返还下发）", b.get("isSignBack"), 1)
check("extraInfoList（attr014=singBackInfo + attr015=2）", b.get("extraInfoList"),
      [{"attrName": "attr014", "attrVal": "singBackInfo"},
       {"attrName": "attr015", "attrVal": "2"}])
check("盖章不改变备注", b.get("remark"), "DN：8260034693 SO：3260027425")
check("盖章不改托寄物", b.get("cargoDesc"), "喷嘴 25pcs")
check("盖章不混入 IN03（费用代码下单不下发）",
      [s for s in (b.get("serviceList") or []) if s.get("name") == "IN03"], [])

print("== ⑥b 顺丰：纸质回单 + 签名（签回单签名，attr015=1）==")
b = sf_body(["纸质回单", "签名"])
check("isSignBack（签名同样按签单返还下发）", b.get("isSignBack"), 1)
check("extraInfoList（attr014=singBackInfo + attr015=1）", b.get("extraInfoList"),
      [{"attrName": "attr014", "attrVal": "singBackInfo"},
       {"attrName": "attr015", "attrVal": "1"}])
check("签名不改托寄物", b.get("cargoDesc"), "喷嘴 25pcs")

print("== ⑥c 顺丰：签名 + 盖章 同勾（attr015=1,2 英文逗号分隔）==")
b = sf_body(["纸质回单", "签名", "盖章"])
check("isSignBack", b.get("isSignBack"), 1)
check("extraInfoList（attr015=1,2）", b.get("extraInfoList"),
      [{"attrName": "attr014", "attrVal": "singBackInfo"},
       {"attrName": "attr015", "attrVal": "1,2"}])
check("备注不变", b.get("remark"), "DN：8260034693 SO：3260027425")

print("== ⑦ 顺丰：仅签名 / 仅盖章（兜底仍按签单返还下发）==")
b = sf_body(["签名"])
check("仅签名：isSignBack 补 1", b.get("isSignBack"), 1)
check("仅签名：attr015=1", b["extraInfoList"][1]["attrVal"], "1")
b = sf_body(["盖章"])
check("仅盖章：isSignBack 补 1", b.get("isSignBack"), 1)
check("仅盖章：attr015=2", b["extraInfoList"][1]["attrVal"], "2")

print("== ⑧ 顺丰：未勾签名/盖章 → 不下发扩展字段 ==")
b = sf_body(["纸质回单"])
check("未下发 extraInfoList", "extraInfoList" in b, False)
b = sf_body(["纸质回单", "拍照回传"])
check("纸质+拍照：仍无 extraInfoList", "extraInfoList" in b, False)
check("纸质+拍照：isSignBack 仍为 1", b.get("isSignBack"), 1)
check("纸质+拍照：serviceList 仍为 IN91",
      b.get("serviceList"), [{"name": "IN91", "value": "13"}])

print("== ⑤ 德邦：纸质回单 / 未勾回单 ==")
b = dp_body(["纸质回单"])
check("packageInfo.cargoName（原样，不加「的回单」）", b["packageInfo"]["cargoName"], "喷嘴 25pcs")
check("addServices（纸质回单三字段）", b.get("addServices"),
      {"backSignBill": "1", "returnRequirement": "R1", "returnBillQty": 1})
b = dp_body([])
check("packageInfo.cargoName", b["packageInfo"]["cargoName"], "喷嘴 25pcs")

print("PROBE_LABEL_MARKS_" + ("OK" if not FAILED else "FAILED " + ", ".join(FAILED)))
sys.exit(0 if not FAILED else 1)