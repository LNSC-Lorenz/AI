#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""回签单改单探针（2026-09-29）——前提结论已作废，仅存档改单接口边界数据：
   当时据回单面单 PDF"寄收同向+寄付月结"误判"SF 不自动互换、需改单"。用户指正+轨迹实锤：
   那张面单是 POD 签收联（随货给客户签收），返回段由顺丰自动用同一 SF106 回单号反向+到付
   （4 张历史回单运单轨迹：上海/湖州/苏州→常州金坛已签收，见 _sb_routes.py 与 0_README.md
   "回单逻辑终定"）。回单收不到根因=到方地址未维护，与本改单探针无关。
   仍成立的接口边界：月结单下单即确认（8252）；dealType=3 返 resStatus=2 但字段不落地；缺 orderId → 6118。
   流程：真实下单 isSignBack=1 → 取 type=3 回单号 → EXP_RECE_UPDATE_ORDER 改单变体 →
   云打印+pypdf 验证 → 取消自清理。"""
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

from carriers import base, cancel_order  # noqa: E402
from carriers import sf_express  # noqa: E402

cfg = base.get_cfg("SF")
SF = u"\u987a\u4e30"   # 顺丰

# 收件人（测试同城单，沿用历史探针收件信息）
RCV = {"contactType": 2, "country": "CN",
       "province": u"\u6c5f\u82cf\u7701", "city": u"\u5e38\u5dde\u5e02",
       "county": u"\u91d1\u575b\u533a",
       "address": u"\u5fb7\u57ce\u8def99\u53f7",
       "contact": u"\u6d4b\u8bd5", "mobile": "15190535163", "company": ""}
SND = dict(sf_express._SENDER,
           contact=u"\u8303\u84d3\u84d3", tel="15190535163",
           company=u"\u83b1\u514b\u52d2\u55b7\u5634\u7cfb\u7edf\uff08\u5e38\u5dde\uff09\u6709\u9650\u516c\u53f8")

oid = "TESTSBUPD" + str(int(time.time() * 1000))
body = {
    "language": "zh-CN", "orderId": oid,
    "contactInfoList": [SND, RCV],
    "cargoDetails": [{"name": u"\u55b7\u5634", "count": 1,
                      "unit": u"\u4e2a", "sourceArea": "CHN"}],
    "cargoDesc": u"\u55b7\u5634",
    "expressTypeId": 2, "payMethod": 1,
    "monthlyCard": cfg.get("cust_code", ""),
    "parcelQty": 1, "isSignBack": 1, "isDocall": 0, "isReturnRouteLabel": 1,
}
data = sf_express._call(cfg, sf_express.SERVICE_ORDER, body)
wbs = data.get("waybillNoInfoList") or []
print("placed:", [(w.get("waybillType"), w.get("waybillNo")) for w in wbs])
main_wb = next((w["waybillNo"] for w in wbs if w.get("waybillType", 1) in (1, 2)), "")
sb = next((w["waybillNo"] for w in wbs if w.get("waybillType") == 3), "")
print("main:", main_wb, "signback:", sb)
if not sb:
    print("NO SIGNBACK WAYBILL; cancel & exit")
    print(json.dumps(cancel_order(SF, oid, main_wb), ensure_ascii=False)[:120])
    sys.exit(0)


def label_text(wb):
    """云打印取面单 PDF → pypdf 提取文本（验证改单是否生效）"""
    try:
        d = sf_express.cloud_print(wb)
        files = (d.get("obj") or {}).get("files") or []
        if not files:
            return "(no files)"
        import urllib.request
        import base64 as b64
        req = urllib.request.Request(files[0]["url"],
                                     headers={"X-Auth-Token": files[0]["token"]})
        raw = urllib.request.urlopen(req, timeout=30).read()
        open("/tmp/_sb_label.pdf", "wb").write(raw)
        from pypdf import PdfReader
        return "\n".join((p.extract_text() or "") for p in PdfReader("/tmp/_sb_label.pdf").pages)
    except Exception as e:
        return "(label fetch err: %r)" % e


print("\n== BEFORE label ==")
print(label_text(sb)[:600])

# 改单变体：全部打向回单运单；逐个试，记录顺丰业务层真实响应
SWAP = [{"contactType": 1, "country": "CN",
         "province": RCV["province"], "city": RCV["city"], "county": RCV["county"],
         "address": RCV["address"], "contact": RCV["contact"], "mobile": RCV["mobile"]},
        dict(sf_express._SENDER, contactType=2,
             contact=SND["contact"], tel=SND["tel"], company=SND["company"])]
variants = [
    ("W2 dealType3+sb+swap+pay2", {"orderId": oid, "waybillNo": sb, "dealType": 3,
                                   "payMethod": 2, "contactInfoList": SWAP}),
]
ok_any = False
for name, payload in variants:
    try:
        r = sf_express._call(cfg, sf_express.SERVICE_CANCEL, payload)
        print(name, "-> OK, full resp:")
        print(json.dumps(r, ensure_ascii=False)[:2500])
        ok_any = True
    except Exception as e:
        print(name, "-> ERR:", str(e)[:220])

if ok_any:
    for wait in (15, 20):
        time.sleep(wait)
        print("\n== AFTER label (+%ds cumulative) ==" % wait)
        print(label_text(sb)[:600])

print("\n== cleanup: cancel main order ==")
try:
    print(json.dumps(cancel_order(SF, oid, main_wb), ensure_ascii=False)[:150])
except Exception as e:
    print("cancel err:", str(e)[:150])
