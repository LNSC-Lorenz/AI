# -*- coding: utf-8 -*-
"""承运商注册表与统一分发：server.py / cli.py 只调这里，不关心各家差异。
专车 / 自提 不走外部 API（在 server 内直接出 ZC/ZT 厂内单号）。

  承运商          模块            下单            轨迹        官方面单
  顺丰           sf_express.py   生产 ✅        待开权限    云打印 ✅（按 SF.txt）
  德邦           deppon.py       生产 ✅        TODO        queryBillPrint ✅（协议已通，待真实运单验证）
  跨越           kye.py          待报文样例      TODO        —
"""
from . import base, sf_express, deppon, kye

CARRIERS = {"顺丰": sf_express, "德邦": deppon, "跨越": kye}


def place_order(carrier, order):
    """按承运商名分发下单；未知名 → CarrierError"""
    mod = CARRIERS.get(carrier)
    if not mod:
        raise base.CarrierError("该承运商不支持在线下单：" + str(carrier))
    return mod.place_order(order)


def query_route(carrier, waybill_no):
    """按承运商名分发轨迹查询"""
    mod = CARRIERS.get(carrier)
    if not mod:
        raise base.CarrierError("该承运商不支持轨迹查询：" + str(carrier))
    return mod.query_route(waybill_no)


def print_label(carrier, waybill_no):
    """按承运商名分发官方面单获取（目前仅顺丰云打印）"""
    mod = CARRIERS.get(carrier)
    if not mod or not hasattr(mod, "cloud_print"):
        raise base.CarrierError("该承运商暂无官方面单：" + str(carrier))
    return mod.cloud_print(waybill_no)


def find_pdf_b64(o):
    """递归在响应里找 base64 PDF（JVBERi 开头 = %PDF 魔数），找不到返回 None"""
    if isinstance(o, str):
        return o if o.startswith("JVBERi") else None
    if isinstance(o, dict):
        for v in o.values():
            r = find_pdf_b64(v)
            if r:
                return r
    if isinstance(o, list):
        for v in o:
            r = find_pdf_b64(v)
            if r:
                return r
    return None


def find_label_files(o):
    """递归收集云打印 url+token 形态的面单文件项（顺丰 v2.0 实测结构 files[]）"""
    found = []

    def walk(x):
        if isinstance(x, dict):
            if isinstance(x.get("url"), str) and x["url"].startswith("http"):
                found.append({"url": x["url"], "token": x.get("token", ""),
                              "waybillNo": x.get("waybillNo", "")})
            else:
                for v in x.values():
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)

    walk(o)
    return found
