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
# 取消下单（2026-09-16 假单探测：服务存在，本账号报 A1004 无对应服务权限 → 需丰桥控制台开通）
SERVICE_CANCEL = "EXP_RECE_UPDATE_ORDER"
_TEMPLATE = "fm_76130_standard_LKLPZA6VYES4"      # 76×130mm 标准模板（丰桥控制台绑定；2026-09-15 用户指定，原 150mm 弃用）

_ENDPOINT = "https://bspgw.sf-express.com/std/service"   # 生产网关

# 产品类型 → expressTypeId（2026-09-18 A/B 对照终定：**1=特快 / 2=标快** —— 探针 _sf_type12_contrast：
# 济南同时刻唯一变量对照 1→特快T4、2→标快T6；历史映射写反，旧"467 发2→特快"证据系撞单 oid 幂等重放污染；
# ⚠️ 近线无特快产品：1(特快)请求在常州等近线被顺丰降级为标快——勿以近线"1→标快"反推 1=标快，
# 请求产品真迹在面单二维码 k4 字段（k4=T4=特快））
_PRODUCT_TYPE = {"顺丰特快": 1, "顺丰标快": 2, "顺丰卡航": 235, "同城半日达": 232}

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


def cancel_order(order_id, waybill_no, logistic_id="", cfg=None):
    """取消下单（EXP_RECE_CANCEL_ORDER；logistic_id 顺丰用不到，签名与德邦对齐）。
    仅未揽收可取消——已揽收/在途顺丰会拒，业务错误原样上抛给前端。
    ⚠️ 需丰桥控制台为本账号开通该服务权限，否则 A1004 无对应服务权限（2026-09-16 探测确认服务存在）"""
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥，无法取消下单")
    if not order_id:
        raise base.CarrierError("缺少承运商客户单号 order_id，无法在线取消（请人工在丰桥后台取消）")
    # dealType=2（2026-09-16 实测：默认模式对已确认订单报 8252"订单已确认"；
    # 用户提供的官方成功响应样例带 dealType:2 = 强制取消/拦截模式）
    msg = {"orderId": order_id, "dealType": 2}
    if waybill_no:
        msg["waybillNo"] = waybill_no
    return _call(cfg, SERVICE_CANCEL, msg)


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
    # 数量（2026-09-17 用户规则）：>1 时随托寄物打印到官方面单（"喷嘴 300pcs"样式，与用户手工习惯一致）
    qty = int(float(order.get("qty") or 1))
    cargo_print = cargo + (" %dpcs" % qty if qty > 1 and cargo else "")
    # 付款方式随设置区：寄付月结=1(寄方付+月结卡) / 寄付现结=1(寄方付不带卡) / 到付=2(收方付)
    pay_name = order.get("pay") or "寄付月结"
    # orderId = 平台内部订单号（oid）：与 SAP 的 DN 无任何关系，DN 仅是内部标识，不下发承运商
    # 寄件联系人随类型：发货单=范蓓蓓；其他=员工姓名+员工电话（2026-09-17 用户规则）；兜底公司电话
    if (order.get("order_type") or "发货单") == "其他" and order.get("emp_name"):
        contact, tel = order["emp_name"], order.get("emp_phone") or "0519 6822-8088"
    else:
        contact, tel = _SENDER_CONTACT.get(order.get("order_type") or "发货单",
                                           ("发货部", "0519 6822-8088"))
    sender = dict(_SENDER, contact=contact, tel=tel,
                  company="莱克勒喷嘴系统（常州）有限公司")
    body = {
        "language": "zh-CN",
        "orderId": order.get("oid") or ("%d" % int(time.time() * 1000)),
        "contactInfoList": [sender, receiver],
        "cargoDetails": [{"name": cargo_print, "count": qty, "unit": "个", "sourceArea": "CHN"}],
        "cargoDesc": cargo_print,
        "expressTypeId": _PRODUCT_TYPE.get(order.get("product") or "顺丰标快", 2),  # 产品类型随下单请求（兜底=标快 2，2026-09-18 映射修正）
        "payMethod": 2 if pay_name == "到付" else 1,
        # 件数随设置区（2026-09-16 一票多件）：≥2 丰桥自动出子母件
        # （waybillNoInfoList 返回 N 条，waybillType 1=母件/2=子件；母单号查全单轨迹）
        "parcelQty": int(float(order.get("parcels") or 1)),
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
    # 回签单（2026-09-16 官方字段确认）：纸质回单 → isSignBack=1（签单返还，Number 型，默认 0 不要求）
    # 拍照回传（2026-09-17 用户规则，顺丰增值服务）：isSignBack=2 —— 探针 _sf_pod_probe2/4 实测：
    #   extraInfoList attrCode POD 三种结构均被 S0003 拒绝，isSignBack 是唯一通道；
    #   =2 与 =1 同样返 type=3 回单运单（SF1064 号段）→ =2 已含纸质回单流程，
    #   故两项同时勾选（2026-09-18 用户规则允许同选）也发 2；
    #   ⚠️ =3"组合值"探针实测：顺丰接受但不返 type=3 运单（静默无效，_sf_signback3_probe）→ 勿用
    _rc = order.get("receipt") or []
    if "拍照回传" in _rc:
        body["isSignBack"] = 2
    elif "纸质回单" in _rc:
        body["isSignBack"] = 1
    data = _call(cfg, SERVICE_ORDER, body)
    waybills = data.get("waybillNoInfoList") or []
    if not waybills:
        raise base.CarrierError("顺丰下单响应无运单号：" + json.dumps(data, ensure_ascii=False)[:200])
    waybill_no = waybills[0].get("waybillNo", "")
    if not waybill_no:
        raise base.CarrierError("顺丰下单响应运单号为空：" + json.dumps(data, ensure_ascii=False)[:200])
    res = {"waybill_no": waybill_no, "route_status": "待揽收",
           "order_id": data.get("orderId", ""),
           "parcels": body.get("parcelQty", 1),   # 实际下发件数存档 order_resp（追溯"选1发2"用）
           "qty": qty}                            # 实际下发数量存档（追溯用）
    # waybillType：1=母件 2=子件（才算件数）3=签单返还回单运单（不计件数！）
    # 2026-09-17 实锤：isSignBack=1 时顺丰多返一条 type=3 回单运单（SF1064 号段），
    # 此前被误判为子件 → 清单②角标/打印2页，用户报"选1显示2"
    parcel_wbs = [w.get("waybillNo", "") for w in waybills if w.get("waybillType", 1) in (1, 2)]
    sign_backs = [w.get("waybillNo", "") for w in waybills if w.get("waybillType") == 3]
    if len(parcel_wbs) > 1:   # 一票多件：母+子运单号存档 order_resp（母单显示，子单备查/打印）
        res["waybills"] = parcel_wbs
    if sign_backs:
        res["sign_back_no"] = sign_backs[0]   # 回单运单号存档备查（轨迹可单独查，不算件数不打印）
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
