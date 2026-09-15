# -*- coding: utf-8 -*-
"""顺丰丰桥生产（EXP_RECE_CREATE_ORDER / COM_RECE_CLOUD_PRINT_WAYBILLS）
协议：application/x-www-form-urlencoded 表单 POST
签名：msgDigest = Base64( MD5( msgData + timestamp + checkword ) )
配置（carriers.env）：
  SF_APP_KEY    = 顾客代码 partnerID
  SF_APP_SECRET = 生产校验码 checkword
  SF_CUST_CODE  = 月结卡号
未配置密钥直接报错（绝不生成模拟单号）。"""
import json
import time
import uuid
from . import base

NAME = "顺丰"
_PREFIX = "SF"
SERVICE_ORDER = "EXP_RECE_CREATE_ORDER"
SERVICE_ROUTE = "EXP_RECE_SEARCH_ROUTES"
SERVICE_PRINT = "COM_RECE_CLOUD_PRINT_WAYBILLS"   # 云打印面单 2.0
_TEMPLATE = "fm_76130_standard_LKLPZA6VYES4"      # 76×130mm 标准模板（丰桥控制台绑定；2026-09-15 用户指定，原 150mm 弃用）

_ENDPOINT = "https://bspgw.sf-express.com/std/service"   # 生产网关

# 产品类型 → expressTypeId（实测修正：首张"特快"面单是撞单的他方订单，不能作为依据；
# 我方 467 单发 2 → 面单显示"特快"，证明 2=特快、1=标快（原始值正确））
_PRODUCT_TYPE = {"顺丰标快": 1, "顺丰特快": 2, "顺丰卡航": 235, "同城半日达": 232}

# 寄件人固定信息（莱克勒，contactType=1）
_SENDER = {
    "contactType": 1, "country": "CN",
    "province": "江苏省", "city": "常州市", "county": "金坛区",
    "address": "德城路99号",
    "contact": "莱克勒喷嘴系统（常州）有限公司",
    "tel": "0519 6822-8088", "postCode": "213200",
}
# 寄件联系人随下单类型（用户规则 2026-09-15）：发货单=范蓓蓓；其他类型暂用公司电话
_SENDER_CONTACT = {"发货单": ("范蓓蓓", "15190535163")}


def _call(cfg, service_code, msg_dict, timeout=30):
    """组表单 + 签名 + 提交 + 解包 apiResultData"""
    msg_data = json.dumps(msg_dict, ensure_ascii=False, separators=(",", ":"))
    timestamp = str(int(time.time() * 1000))
    form = {
        "partnerID": cfg["app_key"],
        "requestID": str(uuid.uuid4()),
        "serviceCode": service_code,
        "timestamp": timestamp,
        "msgDigest": base.md5_b64(msg_data + timestamp + cfg["app_secret"]),
        "msgData": msg_data,
    }
    resp = base.http_post_form(_ENDPOINT, form, timeout=timeout)
    if resp.get("apiResultCode") != "A1000":
        raise base.CarrierError("顺丰接口失败 %s：%s" % (
            resp.get("apiResultCode"), resp.get("apiErrorMsg") or resp.get("errorMessage") or ""))
    outer = json.loads(resp.get("apiResultData") or "{}")
    if outer.get("success") is False:   # 业务层失败（外层网关 A1000 但内层 success=false）
        raise base.CarrierError("顺丰业务失败 %s：%s" % (
            outer.get("errorCode") or "",
            outer.get("errorMsg") or outer.get("errorMessage") or ""))  # 云打印等接口错误字段为 errorMessage
    # 关键：真实业务数据在 apiResultData.msgData 里（双层嵌套，实测确认）
    inner = outer.get("msgData")
    return inner if isinstance(inner, dict) else outer


def place_order(order, cfg=None):
    """下单 → {"waybill_no", "route_status", "label_url"?}（正式模式：未配密钥直接报错，绝不生成模拟单号）"""
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥：请在 carriers.env 配置 SF_APP_KEY/SF_APP_SECRET")
    return _real_place_order(order, cfg)


def query_route(waybill_no, cfg=None):
    """轨迹查询 → {"route_status", "detail"}（未配密钥直接报错）"""
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥，无法查询轨迹")
    return _real_query_route(waybill_no, cfg)


# ---------- 真实接口 ----------
def _real_place_order(order, cfg):
    receiver = {
        "contactType": 2, "country": "CN",
        "province": order.get("province", ""), "city": order.get("city", ""),
        "county": order.get("district", ""), "address": order.get("street", ""),
        "contact": order.get("name", ""), "mobile": order.get("phone", ""),
        "company": order.get("company", ""),
    }
    cargo = order.get("cargo") or ""   # 托寄物原样传递，为空不自动填充（顺丰校验会原样报错）
    # 付款方式随设置区：寄付月结=1(寄方付+月结卡) / 寄付现结=1(寄方付不带卡) / 到付=2(收方付)
    pay_name = order.get("pay") or "寄付月结"
    # orderId = 平台内部订单号（oid）：与 SAP 的 DN 无任何关系，DN 仅是内部标识，不下发承运商
    # 寄件联系人随类型：发货单=范蓓蓓 15190535163（公司名保留在 company 字段）
    contact, tel = _SENDER_CONTACT.get(order.get("order_type") or "发货单",
                                       ("发货部", "0519 6822-8088"))
    sender = dict(_SENDER, contact=contact, tel=tel,
                  company="莱克勒喷嘴系统（常州）有限公司")
    body = {
        "language": "zh-CN",
        "orderId": order.get("oid") or ("%d" % int(time.time() * 1000)),
        "contactInfoList": [sender, receiver],
        "cargoDetails": [{"name": cargo, "count": 1, "unit": "个", "sourceArea": "CHN"}],
        "cargoDesc": cargo,
        "expressTypeId": _PRODUCT_TYPE.get(order.get("product") or "顺丰标快", 1),  # 产品类型随下单请求
        "payMethod": 2 if pay_name == "到付" else 1,
        "parcelQty": 1,
        "isDocall": 0,
        "isReturnRouteLabel": 1,     # 同时返回面单
    }
    if pay_name == "寄付月结":
        body["monthlyCard"] = cfg.get("cust_code", "")   # 仅寄付月结带月结卡
    insured = str(order.get("insured") or "").strip()    # 保价：填写才传（声明价值/元）
    if insured:
        body["declaredValue"] = float(insured)
    remark = str(order.get("remark") or "").strip()      # 运单备注（DN+SO / PO；是否上面单以实测为准）
    if remark:
        body["remark"] = remark
    data = _call(cfg, SERVICE_ORDER, body)
    waybills = data.get("waybillNoInfoList") or []
    if not waybills:
        raise base.CarrierError("顺丰下单响应无运单号：" + json.dumps(data, ensure_ascii=False)[:200])
    waybill_no = waybills[0].get("waybillNo", "")
    if not waybill_no:
        raise base.CarrierError("顺丰下单响应运单号为空：" + json.dumps(data, ensure_ascii=False)[:200])
    res = {"waybill_no": waybill_no, "route_status": "待揽收",
           "order_id": data.get("orderId", "")}
    # 面单：下单返回 routeLabelInfo（结构化面单数据，非 PDF 链接），原样附带供后续自研打印
    labels = data.get("routeLabelInfo") or []
    if labels:
        res["label_info"] = labels[0].get("routeLabelData") or {}
    return res


def cloud_print(waybill_no, cfg=None):
    """顺丰云打印面单 2.0（严格按 SF.txt 标准流程，COM_RECE_CLOUD_PRINT_WAYBILLS）

    流程（与 SF.txt 逐步对应）：
      1. 组装 msgData = {templateCode, version:"2.0", fileType:"pdf", sync:True,
                         documents:[{masterWaybillNo: 运单号}]}
      2. 毫秒时间戳
      3. requestID = uuid4 hex
      4. msgDigest = Base64(MD5(msgData + timestamp + checkWord))
      5. 组装表单 params = {partnerID, requestID, serviceCode, timestamp, msgData, msgDigest}
      6. POST 生产网关（表单，签名 msgData 与实际发送逐字节一致）
      7~8. apiResultCode != "A1000" → 报错
      9. apiResultData（JSON 字符串 → 解析）
    返回：apiResultData.msgData（v2.0 实测为 {obj:{files:[{url, token, waybillNo}]}}；
    PDF 需凭 url + 请求头 X-Auth-Token: token 另行下载，见 base.fetch_url_pdf_b64）
    """
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥，无法云打印面单")
    return _call(cfg, SERVICE_PRINT, {
        "templateCode": _TEMPLATE,          # SF.txt: TEMPLATE_CODE = fm_76130_standard_LKLPZA6VYES4
        "version": "2.0",                   # SF.txt: version = "2.0"
        "fileType": "pdf",                  # SF.txt: fileType = "pdf"
        "sync": True,                       # SF.txt: sync = True
        "documents": [{"masterWaybillNo": waybill_no}],   # SF.txt: documents[0].masterWaybillNo
    }, timeout=30)


def _real_query_route(waybill_no, cfg):
    data = _call(cfg, SERVICE_ROUTE, {
        "language": "zh-CN",
        "trackingType": 1,
        "trackingNumber": [waybill_no],
    })
    resps = data.get("routeResps") or []
    routes = (resps[0].get("routes") if resps else []) or []
    latest = routes[-1] if routes else {}
    # 状态取值（2026-09-15 真实轨迹实测）：顺丰自带 firstStatusName（已揽收/运送中/派送中/已签收），
    # 优先于 acceptAddress（地点非状态，曾误显示"常州市"）；无轨迹节点 = 待揽收
    return {
        "route_status": latest.get("firstStatusName") or latest.get("secondaryStatusName")
                        or latest.get("acceptAddress") or latest.get("remark")
                        or ("待揽收" if not routes else "运输中"),
        "detail": routes[-10:],
    }
