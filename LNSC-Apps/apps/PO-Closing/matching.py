# -*- coding: utf-8 -*-
"""PO 关单判定核心逻辑（全部业务规则集中于此，前端只做展示）。

判定口径：
  GR_STATUS（Z_OA_GET_POGR_STATUS 提供）优先：0 未收 / 1 部分 / 2 收货完成
  无 GR_STATUS 的旧数据回退：净收货 NET_GR_QTY >= 订单数 x (1 - 交货不足容差 UNTTO%) 判可关单
  建议 SUGGEST 优先级: DELETED > ALREADY_CLOSED > GR_STATUS/容差判定
"""

STATUS_TEXT = {
    "CLOSABLE": "可关单",
    "ALREADY_CLOSED": "已关闭",
    "PARTIAL_GR": "部分收货",
    "NO_GR": "未收货",
    "DELETED": "已删除",
}

VERDICT_TEXT = {"PASS": "核对通过", "FAIL": "核对不通过"}


def _num(value):
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def judge_item(row):
    """单行项目判定：返回新 dict，不修改入参。"""
    item = {k: ("" if v is None else v) for k, v in dict(row).items()}
    order_qty = _num(item.get("ORDER_QTY"))
    net_gr = _num(item.get("NET_GR_QTY"))
    untto = _num(item.get("UNTTO"))
    elikz = str(item.get("ELIKZ") or "").strip().upper()
    loekz = str(item.get("LOEKZ") or "").strip().upper()
    gr_status = str(item.get("GR_STATUS") or "").strip()   # Z_OA_GET_POGR_STATUS 提供时优先

    item["ORDER_QTY"] = round(order_qty, 3)
    item["NET_GR_QTY"] = round(net_gr, 3)
    item["DIFF_QTY"] = round(order_qty - net_gr, 3)
    item["ELIKZ"] = elikz
    item["LOEKZ"] = loekz

    limit = order_qty * (100.0 - untto) / 100.0
    can_close = net_gr >= limit
    item["CAN_CLOSE"] = "X" if can_close else ""

    if loekz:
        suggest = "DELETED"
    elif elikz == "X":
        suggest = "ALREADY_CLOSED"
    elif gr_status in ("0", "1", "2"):
        # Z_OA_GET_POGR_STATUS 口径（SAP 侧已判定）：0未收 / 1部分 / 2收货完成
        suggest = {"0": "NO_GR", "1": "PARTIAL_GR", "2": "CLOSABLE"}[gr_status]
        item["CAN_CLOSE"] = "X" if gr_status == "2" else ""
    elif net_gr <= 0:
        suggest = "NO_GR"
    elif can_close:
        suggest = "CLOSABLE"
    else:
        suggest = "PARTIAL_GR"
    item["SUGGEST"] = suggest
    item["STATUS_TEXT"] = STATUS_TEXT[suggest]
    return item


def judge(rows):
    return [judge_item(r) for r in rows]


def summarize(items):
    counts = {code: 0 for code in STATUS_TEXT}
    for it in items:
        counts[it["SUGGEST"]] = counts.get(it["SUGGEST"], 0) + 1
    return {"total": len(items), "counts": counts, "labels": dict(STATUS_TEXT)}


PO_STATUS_TEXT = {"FULL": "已完全收货", "PARTIAL": "部分收货", "NONE": "未收货"}


def aggregate_po(items):
    """按 PO 号（EBELN）聚合行项目，判定 PO 级收货状态。

    FULL    : 所有行项目均收货足额（CAN_CLOSE）或已关单（ELIKZ）
    PARTIAL : 有收货但未足额
    NONE    : 全无收货
    """
    groups, order_keys = {}, []
    for it in items:
        key = str(it.get("EBELN", ""))
        if key not in groups:
            groups[key] = []
            order_keys.append(key)
        groups[key].append(it)
    out = []
    for key in order_keys:
        its = groups[key]
        order_qty = round(sum(float(i["ORDER_QTY"]) for i in its), 3)
        net_gr = round(sum(float(i["NET_GR_QTY"]) for i in its), 3)
        full = all(i["CAN_CLOSE"] == "X" or i["ELIKZ"] == "X" for i in its)
        status = "FULL" if full else ("PARTIAL" if net_gr > 0 else "NONE")
        rate = round(min(100.0, net_gr / order_qty * 100.0), 1) if order_qty > 0 else 0.0
        out.append({
            "EBELN": key, "ITEM_COUNT": len(its),
            "ORDER_QTY": order_qty, "NET_GR_QTY": net_gr, "RATE": rate,
            "PO_STATUS": status, "STATUS_TEXT": PO_STATUS_TEXT[status],
            "ITEMS": its,
        })
    return out
