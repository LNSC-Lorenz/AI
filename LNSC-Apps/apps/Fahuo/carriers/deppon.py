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
# 取消下单（2026-09-16 假单探测：async 网关 cancelOrder/cancelOrderNotify 均存在，
# 本账号报 3002 接口权限不足 → 需德邦开放平台订阅；dpapi sync 路径 404 已排除。
# 默认 cancelOrder，可用环境变量 DB_CANCEL_IF 覆盖为 cancelOrderNotify）
_ENDPOINT_CANCEL = "https://gwapi.deppon.com/dop-interface-async/standard-order/" \
                   + os.environ.get("DB_CANCEL_IF", "cancelOrder") + ".action"
# 新标准轨迹查询（2026-09-17 用户提供官方地址，实测打通；sync 网关协议同下单）：
_ENDPOINT_TRACE = "https://dpapi.deppon.com/dop-interface-sync/standard-query/newTraceQuery.action"
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
    """轨迹查询（新标准轨迹 newTraceQuery，2026-09-17 对接）→ {"route_status", "detail"}"""
    cfg = cfg or _cfg()
    if not _configured(cfg):
        raise base.CarrierError("德邦未配置密钥，无法查询轨迹")
    return _real_query_route(waybill_no, cfg)


def _real_query_route(waybill_no, cfg):
    # 实测（2026-09-17 真单探测）：参数 mailNo + customerCode
    # （waybillNo/waybillNos/缺 customerCode 均报 2006 参数校验失败）；
    # 响应 responseParam.trace_list——待揽收/无记录时为空数组（reason="暂无查询记录"），不算错误
    body = {"mailNo": waybill_no, "customerCode": cfg["cust_code"]}
    resp = _signed_post(_ENDPOINT_TRACE, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
    if str(resp.get("result", "")).lower() not in ("true", "1"):
        raise base.CarrierError("德邦轨迹查询失败 %s：%s" % (
            resp.get("resultCode", ""), resp.get("reason", "")))
    rp = resp.get("responseParam") or {}
    traces = rp.get("trace_list") or rp.get("traceList") or []
    # 归一化为顺丰同构节点（前端步骤弹窗/服务端 route_latest 统一吃 acceptTime/acceptAddress/remark）
    detail = []
    for t in traces:
        if not isinstance(t, dict):
            continue
        detail.append({
            "acceptTime": str(t.get("time") or t.get("acceptTime") or t.get("opTime") or ""),
            "acceptAddress": str(t.get("city") or t.get("acceptAddress") or ""),
            "remark": str(t.get("description") or t.get("remark") or t.get("scanType") or ""),
        })
    # 时间升序（"YYYY-MM-DD HH:mm:ss" 字典序即时间序），与顺丰 detail[-1]=最新 对齐
    detail.sort(key=lambda x: x["acceptTime"])
    txt = (detail[-1].get("remark", "") + detail[-1].get("acceptAddress", "")) if detail else ""
    if not detail:
        status = "待揽收"
    elif "签收" in txt:
        status = "已签收"
    elif "派" in txt:
        status = "派送中"
    elif any(k in txt for k in ("揽收", "收件", "取件")):
        status = "已揽收"
    else:
        status = "运输中"
    return {"route_status": status, "detail": detail[-10:]}


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
    except Exception as e:
        # 计数写不进去 = 下一单必然重号（2026-09-17 实测事故：探针以非 root 运行写失败被静默吞掉，
        # 真单复用 NLHL3391198 → 德邦把它挂成已取消测试单的子件）——宁可下单失败也不放重号出去
        raise base.CarrierError("德邦 logisticID 计数持久化失败（%s）：%s" % (state, e))
    return prefix + str(nxt).zfill(len(digits))


def _real_place_order(order, cfg):
    cargo = order.get("cargo") or ""   # 托寄物原样传递，为空不自动填充
    # 数量（2026-09-17 用户规则）：>1 时随托寄物打印到官方面单（"喷嘴 300pcs"样式，与用户手工习惯一致）
    qty = int(float(order.get("qty") or 1))
    cargo_print = cargo + (" %dpcs" % qty if qty > 1 and cargo else "")
    # 寄件联系人随类型：发货单=范蓓蓓；其他=员工姓名+员工电话（2026-09-17 用户规则）；兜底公司电话
    if (order.get("order_type") or "发货单") == "其他" and order.get("emp_name"):
        s_name, s_mobile = order["emp_name"], order.get("emp_phone") or "051968228088"
    else:
        s_name, s_mobile = _SENDER_CONTACT.get(order.get("order_type") or "发货单",
                                               ("发货部", "051968228088"))
    # custOrderNo = 平台内部订单号（oid）：与 SAP 的 DN 无任何关系，DN 不下发承运商
    body = {
        "companyCode": cfg["app_key"],
        "custOrderNo": order.get("oid") or ("%d" % int(time.time() * 1000)),
        "customerCode": cfg["cust_code"],
        "logisticID": _next_logistic_id(cfg),   # 每单自增，复用报 2006
        "needTraceInfo": 1,
        "orderType": "2",
        "packageInfo": {
            "cargoName": cargo_print,
            "deliveryType": "4",
            # 件数随设置区（2026-09-16 一票多件子母单）：≥2 德邦出母单+子单号
            "totalNumber": int(float(order.get("parcels") or 1)),
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
        # 寄件联系人（上方已按类型选定：发货单=范蓓蓓；其他=员工姓名+员工电话）
        "sender": dict(_SENDER, name=s_name, mobile=s_mobile),
        # 设置区只传常用项（用户规则 2026-09-15：对齐官方下单必填——托寄物/重量/体积随设置区；
        # 签单返还/等通知派送/定时派送/保价等揽收时再核实的选项一律不下发、不猜参数）。
        # transportType=PACKAGE = 快递标准件（471 官方面单实测为"标准快递"；用户指定默认产品）。
        # 前端 product（大件快递3.60/精准卡航/精准汽运）暂未映射——零担产品枚举值待德邦文档/实测
        "transportType": "PACKAGE",
        "gmtCommit": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        # payType 官方枚举（2026-09-17 文档+面单双证）：0=寄付现结(现付·注:大客户模式可能不支持)
        # 1=到付（面单"到付"）2=寄付月结（面单"月结"）；曾写死 1 致寄付月结错显"到付/无月结"（#492 用户反馈）
        "payType": {"到付": "1", "寄付现结": "0"}.get(order.get("pay") or "", "2"),
        "isOut": "N",
    }
    if str(order.get("remark") or "").strip():           # 运单备注（DN+SO / PO；有值才传）
        body["remark"] = str(order["remark"]).strip()
    # 回签单（2026-09-17 官方文档《【新】下单服务接口 德邦.doc》终定）：三个字段是
    # addServices 对象的【子字段】——此前放顶层被静默忽略（12 种形态实测面单均"无需返单"）；
    # backSignBill=1(签收单原件返回) 时 returnRequirement(R1:签名)+returnBillQty(返单张数) 必填
    if "纸质回单" in (order.get("receipt") or []):
        body["addServices"] = {"backSignBill": "1", "returnRequirement": "R1", "returnBillQty": 1}
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
    # 一票多件（2026-09-17 实测）：德邦 mailNo 逗号拼接"母单,子单…"——拆分为列表：
    # 母单为主运单号（显示/查轨迹/取消用它），全部单号存档 waybills（角标件数+逐件取面单合并打印）
    wbs = [w.strip() for w in waybill.split(",") if w.strip()]
    # order_id/logistic_id 随返回值持久化到 order_resp（取消下单要用 custOrderNo/logisticID）
    res = {"waybill_no": wbs[0], "route_status": "待揽收",
           "order_id": body.get("custOrderNo", ""), "logistic_id": body.get("logisticID", ""),
           "parcels": body["packageInfo"]["totalNumber"],   # 实际下发件数存档（追溯用）
           "qty": qty}                                      # 实际下发数量存档（追溯用）
    if len(wbs) > 1:
        res["waybills"] = wbs
    return res


def cancel_order(order_id, waybill_no, logistic_id="", cfg=None):
    """取消下单（cancelOrder；async 网关，协议同下单）。
    params 发送全部已知标识（customerCode/custOrderNo/logisticID/mailNo），多余字段官方忽略。
    仅未揽收可取消——已揽收德邦会拒，错误原样上抛。
    2026-09-17 真单闭环验证通过（接口权限已开通；曾报 3002，用户订阅后解除）"""
    cfg = cfg or _cfg()
    if not _configured(cfg):
        raise base.CarrierError("德邦未配置密钥，无法取消下单")
    body = {"customerCode": cfg["cust_code"]}
    if order_id:
        body["custOrderNo"] = order_id
    if logistic_id:
        body["logisticID"] = logistic_id
    if waybill_no:
        body["mailNo"] = waybill_no
    # 实测（2026-09-17 真单闭环）：createOrderNotify 是 async 接口，订单入账有延迟（约1-2分钟），
    # 下单后立即取消报"不存在订单信息"，稍候重试即成功（resultCode=1000）——
    # 对该错误做短退避重试（5s/15s），其余错误原样上抛
    last = {}
    for d in (0, 5, 15):
        if d:
            time.sleep(d)
        resp = _signed_post(_ENDPOINT_CANCEL, cfg, json.dumps(body, ensure_ascii=False), timeout=30)
        if str(resp.get("result", "")).lower() in ("true", "1"):
            return {"ok": True, "raw": resp}
        last = resp
        if "不存在订单信息" not in str(resp.get("reason", "")):
            break
    raise base.CarrierError("德邦取消下单失败 %s：%s" % (
        last.get("resultCode", ""), last.get("reason", "")))


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
