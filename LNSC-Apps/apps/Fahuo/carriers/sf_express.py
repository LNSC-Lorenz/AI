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
# 取消下单（2026-09-24 四单实测终定：EXP_RECE_UPDATE_ORDER 本账号【有权限】，真实测试单取消成功 resStatus=2。
# ⚠️ A1004"无对应服务权限"的双重根因（09-16/09-24 两次误诊教训）：
#   ① 密钥被污染——carriers.env(CRLF) 经 bash source 注入使 partnerID 尾带 \r → 网关不识别 → A1004
#      （base.get_cfg 已加 strip 防御 + 服务器 env 已转 LF；systemd 注入本就干净，生产不受影响）
#   ② 服务确实未订阅——EXP_RECE_CANCEL_ORDER（老取消接口）/ EXP_RECE_SEARCH_ORDER_RESP 净密钥下仍 A1004，需申请开通。
# 报文形态不敏感：{orderId,dealType:2(整数/字符串均可),waybillNo 可选} 干净密钥下都到业务层）
# ⚠️ 改单边界（2026-09-29 _sb_update_probe.py 探针终定；同日回单结论经用户指正+轨迹实锤更正）：
#   本接口不能修改寄收方/付款方式——月结单下单即确认：无 dealType/=1 → 8252"订单已确认"；
#   dealType=3 → 返 resStatus=2 但字段不落地（云打印面单改后 15s/35s 三提原样）；缺 orderId → 6118。
#   但回单返回【无需改单】：官方逻辑=收件人签收后顺丰自动用同一回单号（SF106）反向、运费到付返回
#   （4 张历史回单运单轨迹实锤：上海/湖州/苏州→常州金坛"已签收"，_sb_routes.py）；云打印那张
#   "正向+寄付月结"面单是 POD 签收联（"POD标快"抬头，随货给客户签收用），不是返回段运单——
#   此前"需顺丰人工改单"判断错误。回单收不到的根因=回单返回"到方地址"未维护（历史回单被误投他址
#   签收）；行动：95338/顺丰销售维护到方地址=莱克勒德城路99号——✅ 2026-10-08 用户确认：该地址为**固定值**、
#   顺丰账号侧已设定完成 ⇒ 平台侧无任何维护动作/提示（原维护申请文案与 GET /api/signback_addr 已于同日撤除）。
#   2026-09-29 速打实测：反向回签单面单官方模板可出纸——主运单+回签单（SF106）两联同一任务出纸、
#   收寄地址互反、回签单到付+「签回单原单号」回链。
#   ⚠️ 2026-09-30 中间结论（**已被 10-08 终定推翻，保留作复盘**）：当时只在 masterWaybillNo 处试过 SF106，
#   故恒得 1 页正向"POD标快"签收联（寄=莱克勒/收=客户/寄付月结；_sb_pages.py 存档），据此误判"丰桥取不到、
#   仅速打可出纸、待顺丰答复"（速打那组单不属本丰桥客户编码，API 拒取"单号与顾客编码不匹配"无法对照）。
#   ✅ 2026-10-08 终定（官方文档 + 顺丰客服核实 + 真单实锤——上一版"待顺丰答复"已有答案）：
#   `documents[]` 的单号字段按单据类型**择一**——masterWaybillNo(母) / branchWaybillNo(子) /
#   **backWaybillNo(签回单)**；文档原话「打印签回单时，masterWaybillNo 和 branchWaybillNo 为空」。
#   此前把 SF106 回单号塞进 masterWaybillNo → 恒得 1 页正向"POD标快"签收联（寄=莱克勒/收=客户/
#   寄付月结），正是 09-30 被撤回的那张错误第 2 页；改传 backWaybillNo 即得**反向回签单**：实测
#   （探针 carriers/_sb_back_probe.py，order#557 主单 SF5148042784954 / 回单 SF1065010577207）
#   =1 页「1/1  回: SF1065010577207」+「关联主运单: SF5148042784954」+ 收=范蓓蓓/莱克勒 德城路99号
#   + **到付** + 寄=客户地址 —— 收寄互反、票面回链原主单号，与速打出纸两联一致 → 见 cloud_print_back()。
#   （2026-09-30 用户决策"默认主面单 + 速打补打反向回签单"已被本官方参数取代；自绘方案仍不启用）
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

# ---------- 签单返还"回单返回到方地址"（**固定值**；2026-10-08 用户口径终定） ----------
# 回单返回段（SF106 反向+到付）派送到方地址恒为莱克勒本部（与寄件人 _SENDER 同源：金坛区德城路99号），
# **顺丰账号侧已设定完成、地址固定不变、无需任何维护**；平台侧因此不保留任何机制：
#   ① 丰桥下单接口本无到方地址下发字段（extraInfoList POD 实测 S0003 拒，见文件头）；
#   ② 前端自 2026-10-08 起不再显示"需维护到方地址"提示（2-order/3-list 回单块只留回单返回信息）；
#   ③ 原 SIGN_BACK_ADDR 常量与 GET /api/signback_addr 接口同日撤除（全盘 grep 无调用方，属死代码）。


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
    """取消下单（EXP_RECE_UPDATE_ORDER dealType=2 强制取消；签名与德邦对齐）。
    仅未揽收可取消——已揽收/在途顺丰会拒，业务错误原样上抛给前端。
    ✅ 2026-09-24 四张真实测试单取消成功（resStatus=2），权限确认可用。
    报文只发 {orderId, dealType:"2"} 即可定位（waybillNo 非必需，参数仅保持签名兼容不下发）；
    若遇 A1004：先查密钥是否被 \r 等污染（见 SERVICE_CANCEL 注释），再考虑权限问题"""
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥，无法取消下单")
    if not order_id:
        raise base.CarrierError("缺少承运商客户单号 order_id，无法在线取消（请人工在丰桥后台取消）")
    return _call(cfg, SERVICE_CANCEL, {"orderId": order_id, "dealType": "2"})


# ---------- 真实接口 ----------
def _real_place_order(order, cfg):
    receiver = {
        "contactType": 2, "country": "CN",
        "province": order.get("province", ""), "city": order.get("city", ""),
        "county": order.get("district", ""), "address": order.get("street", ""),
        "contact": order.get("name", ""), "mobile": order.get("phone", ""),
        "company": order.get("company", ""),
    }
    # 托寄物原样传递、不加回单后缀（2026-10-08 用户原话「移除备注加的 的回单 3个字」：
    # 同日撤销「勾了回单则托寄物末尾加『的回单』」；回单渠道仍走增值服务 isSignBack=1 / IN91
    # + remark「需拍照回传」，见下）
    _rc = order.get("receipt") or []
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
    # 运单备注（DN+SO / PO）+ 回单标识（2026-09-24 方案A → 2026-10-08 用户改口径）：
    #   仅「拍照回传」追加「需拍照回传」；**「需纸质回单」不再打印**，托寄物亦不加
    #   「的回单」后缀（2026-10-08 同日用户撤销），增值服务本身不受影响
    #   （仍走 isSignBack=1 / serviceList IN91）；顺丰标准模板 fm_76130 备注区是否实际打印以真实面单实证为准
    remark = str(order.get("remark") or "").strip()
    _marks = "需拍照回传" if "拍照回传" in _rc else ""
    if _marks:
        remark = (remark + " " + _marks).strip()
    if remark:
        body["remark"] = remark
    # 回签单（2026-09-24 官方《增值服务产品表》终定）：纸质回单=isSignBack=1；拍照回传=增值服务IN91(serviceList)
    # 事故链：09-17 探针在 API 表面判定"=2 与 =1 同样返 type=3 回单运单 → =2 已含纸质流程"，
    #   于是"纸质+拍照"双勾发 2；09-23 用户报障——面单印了回签单号，收方快递员终端却无回单任务。
    #   服务器实测（_sf_signback_route_probe）：主运单轨迹完整已签收，而全部回单运单（type=3，
    #   SF1064 号段）恒"待揽收"0 节点 → =2 网关照收照返号，但运营端不启动签单返还流程（静默无效）；
    #   extraInfoList attrCode POD 亦被 S0003 拒 → isSignBack/extraInfo 均非拍照回传有效通道（真通道=IN91）。
    # 修复（2026-09-24 官方《增值服务产品表》终定）：纸质回单 → isSignBack=1（签单返还唯一有效字段值）；
    #   拍照回传 → 增值服务 IN91（serviceList，value 固定 13=签回单拍照），不再借用 isSignBack=2/3。
    #   ⚠️ =3"组合值"同样静默无效（_sf_signback3_probe：接受但不返 type=3 运单）→ 勿用
    if "纸质回单" in _rc:   # _rc 已于 cargo_print 处取（回单标识与服务下发同源）
        body["isSignBack"] = 1    # 签单返还（纸质回单）；增值服务 IN03 下单时无需下发，纸质回单仅认此字段
    if "拍照回传" in _rc:
        body["serviceList"] = [{"name": "IN91", "value": "13"}]   # 拍照回传增值服务：13=签回单拍照（固定传值）
    data = _call(cfg, SERVICE_ORDER, body)
    waybills = data.get("waybillNoInfoList") or []
    if not waybills:
        raise base.CarrierError("顺丰下单响应无运单号：" + json.dumps(data, ensure_ascii=False)[:200])
    waybill_no = waybills[0].get("waybillNo", "")
    if not waybill_no:
        raise base.CarrierError("顺丰下单响应运单号为空：" + json.dumps(data, ensure_ascii=False)[:200])
    res = {"waybill_no": waybill_no, "route_status": "待揽收",
           "order_id": data.get("orderId", ""),
           "isSignBack": body.get("isSignBack", 0),   # 实际下发回签单值存档（2026-09-23 事故追溯：发 1 还是 2）
           "parcels": body.get("parcelQty", 1),   # 实际下发件数存档 order_resp（追溯"选1发2"用）
           "qty": qty,                            # 实际下发数量存档（追溯用）
           "remark": body.get("remark", "")}      # 实际下发备注存档（2026-09-24 方案A：回单标识核验）
    if "serviceList" in body:
        res["serviceList"] = body["serviceList"]  # 实际下发增值服务存档 order_resp（追溯 IN91 拍照回传等）
    # waybillType：1=母件 2=子件（才算件数）3=签单返还回单运单（不计件数！）
    # 2026-09-17 实锤：isSignBack=1 时顺丰多返一条 type=3 回单运单（SF1064 号段），
    # 此前被误判为子件 → 清单②角标/打印2页，用户报"选1显示2"
    parcel_wbs = [w.get("waybillNo", "") for w in waybills if w.get("waybillType", 1) in (1, 2)]
    sign_backs = [w.get("waybillNo", "") for w in waybills if w.get("waybillType") == 3]
    if len(parcel_wbs) > 1:   # 一票多件：母+子运单号存档 order_resp（母单显示，子单备查/打印）
        res["waybills"] = parcel_wbs
    if sign_backs:
        res["sign_back_no"] = sign_backs[0]   # 回单运单号存档：轨迹可单独查；不计件数，但打印面单时经 optional_no 追加出纸（2026-09-25 用户规则）
    # 面单：下单返回 routeLabelInfo（结构化面单数据，非 PDF 链接），原样附带供后续自研打印
    labels = data.get("routeLabelInfo") or []
    if labels:
        res["label_info"] = labels[0].get("routeLabelData") or {}
    return res


def _cloud_print_docs(documents, cfg=None, timeout=30):
    """云打印 2.0 公共体（COM_RECE_CLOUD_PRINT_WAYBILLS）：documents 数组由调用方给。
    documents[] 的单号字段按单据类型**择一**（2026-10-08 官方文档 + 客服确认）：
      masterWaybillNo=母运单面单 / branchWaybillNo=子运单面单 / backWaybillNo=签回单
    —— 打印签回单时 master/branch 必须为空（见 cloud_print_back）。"""
    cfg = cfg or base.get_cfg(_PREFIX)
    if not base.configured(cfg):
        raise base.CarrierError("顺丰未配置密钥，无法云打印面单")
    return _call(cfg, SERVICE_PRINT, {
        "templateCode": _TEMPLATE,          # SF.txt: TEMPLATE_CODE = fm_76130_standard_LKLPZA6VYES4
        "version": "2.0",                   # SF.txt: version = "2.0"
        "fileType": "pdf",                  # SF.txt: fileType = "pdf"
        "sync": True,                       # SF.txt: sync = True
        "documents": documents,
    }, timeout=timeout)


def cloud_print(waybill_no, cfg=None):
    """顺丰云打印**母运单面单** 2.0（一票多件由 server 逐件调用后合并为一个多页 PDF）

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
    return _cloud_print_docs([{"masterWaybillNo": waybill_no}], cfg)


def cloud_print_back(back_waybill_no, cfg=None):
    """顺丰云打印**签回单（回单联）** 2.0 —— 2026-10-08 官方文档 + 客服核实 + 真单实锤。

    文档口径（《打印》backWaybillNo 条）：打印签回单时 **masterWaybillNo 和 branchWaybillNo
    为空**，回单号只传 `backWaybillNo`。此前把回单号塞进 masterWaybillNo → 恒得 1 页**正向**
    "POD标快"签收联（寄=莱克勒/收=客户/寄付月结），即 2026-09-30 被撤回的错误第 2 页；
    改传 backWaybillNo 后同单实锤（探针 carriers/_sb_back_probe.py，order#557 主单
    SF5148042784954 / 回单 SF1065010577207）得到**反向回签单**：
        「1/1  回: SF1065010577207」+「关联主运单: SF5148042784954」
        + 收=范蓓蓓/莱克勒喷嘴系统（常州）德城路99号 + **到付** + 寄=客户地址
    —— 收寄互反、票面回链原主单号，与速打（SF Suba）同一任务出纸的两联一致。
    """
    return _cloud_print_docs([{"backWaybillNo": back_waybill_no}], cfg)


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
