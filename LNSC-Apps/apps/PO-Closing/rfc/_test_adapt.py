# -*- coding: utf-8 -*-
"""适配层离线自测（无 SAP 依赖）：Z_OA_GET_POGR_STATUS 样例数据 → map_rows → judge → aggregate。"""
import json
import os
import sys
import types

# pyrfc 桩：无 SAP 环境也能跑纯映射逻辑自测
_pyrfc = types.ModuleType("pyrfc")
_pyrfc.Connection = object
sys.modules.setdefault("pyrfc", _pyrfc)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "rfc"))
sys.path.insert(0, os.path.dirname(__file__))
from po_gr_check import extract_result, map_rows  # noqa: E402
from matching import aggregate_po, judge  # noqa: E402

# —— 接口规格里的样例形态：行项目 00010 两条凭证（头部字段重复），00020 部分收货，00030 未收货
raw = [
    {"EBELN": "4526018353", "EBELP": "00010", "MATNR": "945120", "PO_MENGE": 100, "MEINS": "PC",
     "GR_MENGE": 100, "GR_STATUS": "2", "GR_STATUS_TEXT": "收货完成",
     "MBLNR": "5000001234", "MJAHR": "2025", "ZEILE": "0001", "DOC_MENGE": 60, "BLDAT": "20250410", "BUDAT": "20250411"},
    {"EBELN": "4526018353", "EBELP": "00010", "MATNR": "945120", "PO_MENGE": 100, "MEINS": "PC",
     "GR_MENGE": 100, "GR_STATUS": "2", "GR_STATUS_TEXT": "收货完成",
     "MBLNR": "5000001299", "MJAHR": "2025", "ZEILE": "0001", "DOC_MENGE": 40, "BLDAT": "20250420", "BUDAT": "20250420"},
    {"EBELN": "4526018353", "EBELP": "00020", "MATNR": "945121", "PO_MENGE": 10, "MEINS": "PC",
     "GR_MENGE": 6, "GR_STATUS": "1", "GR_STATUS_TEXT": "部分收货",
     "MBLNR": "5000001300", "MJAHR": "2025", "ZEILE": "0001", "DOC_MENGE": 6, "BLDAT": "20250501", "BUDAT": "20250501"},
    {"EBELN": "4526018353", "EBELP": "00030", "MATNR": "945122", "PO_MENGE": 5, "MEINS": "PC",
     "GR_MENGE": 0, "GR_STATUS": "0", "GR_STATUS_TEXT": "未收货",
     "MBLNR": "", "MJAHR": "", "ZEILE": "", "DOC_MENGE": 0, "BLDAT": "", "BUDAT": ""},
]

# 1) 按行去重：4 条凭证行 → 3 个行项目，数量绝不翻倍
rows = map_rows(raw)
assert len(rows) == 3, f"去重失败: {len(rows)}"
r10 = rows[0]
assert r10["EBELN"] == "4526018353" and r10["EBELP"] == "00010"
assert r10["ORDER_QTY"] == 100 and r10["NET_GR_QTY"] == 100, "头部字段被重复累加！"
assert r10["GR_STATUS"] == "2" and r10["SUGGEST"] == "CLOSABLE"
docs = json.loads(r10["GR_DOCS"])
assert len(docs) == 2 and docs[0]["DOC_MENGE"] == 60 and docs[1]["MBLNR"] == "5000001299"
assert json.loads(rows[2]["GR_DOCS"]) == [], "无凭证行应为空数组"

# 2) 判定走 SAP 口径
judged = judge(rows)
assert [j["SUGGEST"] for j in judged] == ["CLOSABLE", "PARTIAL_GR", "NO_GR"], judged
assert judged[0]["CAN_CLOSE"] == "X" and judged[1]["CAN_CLOSE"] == ""
assert judged[2]["STATUS_TEXT"] == "未收货"

# 3) PO 级聚合：混合 → PARTIAL，总量 115 / 已收 106
pos = aggregate_po(judged)
p = pos[0]
assert p["PO_STATUS"] == "PARTIAL" and p["ORDER_QTY"] == 115.0 and p["NET_GR_QTY"] == 106.0
assert p["RATE"] == round(106 / 115 * 100, 1)

# 4) 返回结构识别：EV_STATUS + 任意命名的明细表
st, msg, tab = extract_result({"EV_STATUS": "S", "EV_MESSAGE": "ok", "ET_ANY_NAME": raw})
assert st == "S" and len(tab) == 4
st, msg, tab = extract_result({"EV_STATUS": "W", "EV_MESSAGE": "未查询到相关数据", "ET_ANY_NAME": []})
assert st == "W" and tab == []

# 5) 无 GR_STATUS 的旧数据走原有容差逻辑（向后兼容）
legacy = judge([{"EBELN": "1", "EBELP": "00010", "ORDER_QTY": 100, "NET_GR_QTY": 96, "UNTTO": 5}])
assert legacy[0]["SUGGEST"] == "CLOSABLE", legacy

print("ALL PASS")
