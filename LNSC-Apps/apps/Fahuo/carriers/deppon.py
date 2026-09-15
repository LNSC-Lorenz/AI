# -*- coding: utf-8 -*-
"""德邦快递开放平台生产（createOrderNotify，协议已实测验证）
协议：form POST（x-www-form-urlencoded;charset=UTF-8），四字段：
  companyCode = 公司编码（顶层表单字段，不在 params JSON 里）
  timestamp   = 毫秒时间戳
  digest      = Base64( MD5(params原文 + appkey + timestamp) 的 hex 串 )
  params      = 订单 JSON（仅此字段为 JSON）
配置（carriers.env）：
  DB_APP_KEY     = 公司代码 companyCode
  DB_APP_SECRET  = appkey（签名密钥，账号信息页获取）
  DB_CUST_CODE   = 客户编码 customerCode
  DB_LOGISTIC_ID = 物流 ID 起始值（每单自增 1，复用报 2006 运单号重复）
未配置密钥直接报错（绝不生成模拟单号）。"""
import base64
import hashlib
import json
import os
import re
import time
from . import base

NAME = "德邦"
_PREFIX = "DPK"
# 生产网关（官方提供）：下单 createOrderNotify
_ENDPOINT = "https://gwapi.deppon.com/dop-interface-async/standard-order/createOrderNotify.action"
# 官方面单打印（签单 100×150，用户指定尺寸）：queryBillPrint（协议同下单，已实测鉴权通过）
_ENDPOINT_PRINT = "https://dpapi.deppon.com/dop-interface-sync/standard-query/queryBillPrint.action"
# 标准轨迹订阅（官方提供，轨迹功能接入时用）：
# https://dpapi.deppon.com/dop-interface-sync/dop-nonstandard-extension/standTraceSubscribe.action

# 寄件人固定信息（莱克勒）
_SENDER = {
    "province": "江苏省", "city": "常州市", "county": "金坛区",
    "address": "德城路99号",
    "companyName": "莱克勒喷嘴系统（常州）有限公司",
    "name": "发货部", "mobile": "051968228088",
}
# 寄件联系人随下单类型（用户规则 2026-09-15）：发货单=范蓓蓓；其他类型暂用公司电话
_SENDER_CONTACT = {"发货单": ("范蓓蓓", "15190535163")}


def _cfg():
    cfg = base.get_cfg("DB")
    cfg["logistic_id"] = os.environ.get("DB_LOGISTIC_ID", "")
    return cfg


def _configured(cfg):
    """公司编码 + 客户编码 + appkey（签名必需）齐备才走真实接口"""
    return bool(cfg.get("app_key") and cfg.get("cust_code") and cfg.get("app_secret"))


def place_order(order, cfg=None):
    """下单 → {"waybill_no", "route_status"}（正式模式：未配密钥直接报错，绝不生成模拟单号）"""
    cfg = cfg or _cfg()
    if not _configured(cfg):
        raise base.CarrierError("德邦未配置密钥：请在 carriers.env 配置 DB_APP_KEY/DB_APP_SECRET/DB_CUST_CODE")
    return _real_place_order(order, cfg)


def query_route(waybill_no, cfg=None):
    """轨迹查询（德邦轨迹接口暂无报文样例，暂留 TODO）"""
    cfg = cfg or _cfg()
    if not _configured(cfg):
        raise base.CarrierError("德邦未配置密钥，无法查询轨迹")
    raise base.CarrierError("德邦轨迹查询未启用：待德邦轨迹接口报文样例")


def cloud_print(waybill_no, cfg=None):
    """德邦官方面单（queryBillPrint，签单 100×150）
    params = {"customerCode": 客户编码(cust_code，非公司编码！), "waybillNos": 运单号}
    ⚠️ 实测（真实运单 DPK365088772140）：customerCode 填公司编码恒报
       "未查询到可以打印的订单"，必须填客户编码 DB_CUST_CODE。
    成功响应（实测）：{"result":true, "data":[{"fileName":"DPK….pdf",
       "fileUrl":"https://…obs…/DPK….pdf?AccessKeyId=…&Signature=…",   # 华为 OBS 预签名 URL，免 token
       "waybillNumber":"DPK…"}]}
    返回前归一化为通用 files[] 形态（url+token），供 find_label_files 提取"""
    cfg = cfg or _cfg()
    if not _configured(cfg):
        raise base.CarrierError("德邦未配置密钥，无法打印面单")
    params = json.dumps({"customerCode": cfg["cust_code"], "waybillNos": waybill_no},
                        ensure_ascii=False)
    resp = _signed_post(_ENDPOINT_PRINT, cfg, params, timeout=60)
    if str(resp.get("result", "")).lower() not in ("true", "1"):
        raise base.CarrierError("德邦面单打印失败：%s" % (
            resp.get("message") or resp.get("reason") or
            json.dumps(resp, ensure_ascii=False)[:200]))
    files = []
    for it in resp.get("data") or []:
        if isinstance(it, dict) and str(it.get("fileUrl", "")).startswith("http"):
            files.append({"url": it["fileUrl"], "token": "",
                          "waybillNo": it.get("waybillNumber", "")})
    if not files:
        raise base.CarrierError("德邦面单响应无 fileUrl：" +
                                json.dumps(resp, ensure_ascii=False)[:200])
    return {"files": files, "raw": resp}


# ---------- 真实接口 ----------
def _signed_post(url, cfg, params, timeout=30):
    """官方协议（实测破解）：companyCode/timestamp/digest 为顶层表单字段，
    仅 params 是 JSON 字符串；digest = Base64(MD5(params+appkey+timestamp) 的 hex 串)"""
    ts = base.ts_ms()
    digest = base64.b64encode(
        hashlib.md5((params + cfg["app_secret"] + ts).encode("utf-8")).hexdigest()
        .encode("ascii")).decode("ascii")
    return base.http_post_form(url, {
        "companyCode": cfg["app_key"],
        "timestamp": ts,
        "digest": digest,
        "params": params,
    }, timeout=timeout)


def _next_logistic_id(cfg):
    """logisticID 每单唯一（实测：同一号第二次下单即报 2006）。
    以 env 的 DB_LOGISTIC_ID 为起始值逐单 +1；计数持久化到包内 .db_logistic_seq，
    取 max(env数字, 上次+1) 防 env 回退后重复。
    若分配的是固定物流ID：设 DB_LOGISTIC_INCR=0 关闭自增。"""
    raw = cfg.get("logistic_id") or ""
    if os.environ.get("DB_LOGISTIC_INCR", "1").strip() == "0":
        return raw
    m = re.match(r"^(.*?)(\d+)$", raw)
    if not m:
        return raw
    prefix, digits = m.group(1), m.group(2)
    state = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".db_logistic_seq")
    last = None
    try:
        with open(state, encoding="ascii") as f:
            last = int(f.read().strip())
    except Exception:
        pass
    nxt = max(int(digits), last + 1 if last is not None else int(digits))
    try:
        with open(state, "w", encoding="ascii") as f:
            f.write(str(nxt))
    except Exception:
        pass  # 写失败不阻断下单（下次可能重号再调）
    return prefix + str(nxt).zfill(len(digits))


def _real_place_order(order, cfg):
    cargo = order.get("cargo") or ""   # 托寄物原样传递，为空不自动填充
    # custOrderNo = 平台内部订单号（oid）：与 SAP 的 DN 无任何关系，DN 不下发承运商
    body = {
        "companyCode": cfg["app_key"],
        "custOrderNo": order.get("oid") or ("%d" % int(time.time() * 1000)),
        "customerCode": cfg["cust_code"],
        "logisticID": _next_logistic_id(cfg),   # 每单自增，复用报 2006
        "needTraceInfo": 1,
        "orderType": "2",
        "packageInfo": {
            "cargoName": cargo,
            "deliveryType": "4",
            "totalNumber": 1,
            "totalVolume": float(order.get("volume") or 0.01),   # 体积随设置区，未填默认 0.01
            "totalWeight": float(order.get("weight") or 1),
            "packageService": "纸",
        },
        "receiver": {
            "province": order.get("province", ""), "city": order.get("city", ""),
            "county": order.get("district", ""), "address": order.get("street", ""),
            "name": order.get("name", ""), "mobile": order.get("phone", ""),
            "companyName": order.get("company", ""),
        },
        # 寄件联系人随类型：发货单=范蓓蓓 15190535163（公司名保留在 companyName）
        "sender": dict(_SENDER, **dict(zip(("name", "mobile"),
                       _SENDER_CONTACT.get(order.get("order_type") or "发货单",
                                           ("发货部", "051968228088"))))),
        # 设置区只传常用项（用户规则 2026-09-15：对齐官方下单必填——托寄物/重量/体积随设置区；
        # 签单返还/等通知派送/定时派送/保价等揽收时再核实的选项一律不下发、不猜参数）。
        # transportType=PACKAGE = 快递标准件（471 官方面单实测为"标准快递"；用户指定默认产品）。
        # 前端 product（大件快递3.60/精准卡航/精准汽运）暂未映射——零担产品枚举值待德邦文档/实测
        "transportType": "PACKAGE",
        "gmtCommit": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "payType": "1",
        "isOut": "N",
    }
    if str(order.get("remark") or "").strip():           # 运单备注（DN+SO / PO；有值才传）
        body["remark"] = str(order["remark"]).strip()
    params = json.dumps(body, ensure_ascii=False)
    resp = _signed_post(_ENDPOINT, cfg, params, timeout=30)
    # 成功判定（严格按返回值）：result=true 且 resultCode=1000 且取到运单号，缺一不可
    if str(resp.get("result", "")).lower() not in ("true", "1"):
        raise base.CarrierError("德邦下单失败 %s：%s" % (
            resp.get("resultCode", ""), resp.get("reason", "")))
    code = str(resp.get("resultCode", ""))
    if code and code != "1000":
        raise base.CarrierError("德邦下单业务失败 %s：%s" % (code, resp.get("reason", "")))
    waybill = _extract_waybill(resp)
    if not waybill:
        raise base.CarrierError("德邦下单响应未取到运单号：" + json.dumps(resp, ensure_ascii=False)[:200])
    return {"waybill_no": waybill, "route_status": "待揽收"}


def _extract_waybill(resp):
    """德邦响应结构以联调为准：优先 mailNo > waybillNo > orderNo
    （防响应中 orderNo 回声排在 mailNo 之前时取错单号）"""
    found = {"mailno": "", "waybillno": "", "orderno": ""}

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                kl = k.lower()
                if kl in found and isinstance(v, str) and v and not found[kl]:
                    found[kl] = v
                else:
                    walk(v)
        elif isinstance(o, list):
            for it in o:
                walk(it)

    walk(resp)
    return found["mailno"] or found["waybillno"] or found["orderno"]
