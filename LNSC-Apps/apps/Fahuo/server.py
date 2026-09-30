#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LNSC 全链发货平台 - SQLite API 服务
仅使用 Python 标准库（http.server + sqlite3），零依赖。

用法：
    python3 server.py            # 默认端口 8091
    PORT=9000 python3 server.py  # 指定端口

接口：
    GET    /api/orders?date=YYYY-MM-DD   发货单列表（默认当天）
    POST   /api/orders                   新建发货单
    PUT    /api/orders/<id>              更新（状态/备注等）
    DELETE /api/orders/<id>              删除
    GET    /api/stats                    右侧看板统计
GET    /api/signback_addr            顺丰回单返回到方地址（平台唯一权威源 sf_express.SIGN_BACK_ADDR）
同时提供当前目录静态文件（index.html 等），可直接 http://host:8091/ 访问。
"""
import base64
import json
import os
import re
import sqlite3
import sys
import threading
import time
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))            # Fahuo/（server.py 位置不变）
WEB_ROOT = BASE                                              # 静态页面根（pages/ shared/ index.html 同目录）
DB = os.path.join(BASE, "fahuo.db")
UPLOAD_DIR = os.path.join(BASE, "Upload")   # 上传文件根目录（按 DN 建子文件夹）
PORT = int(os.environ.get("PORT", "8091"))

OID_SEQ = os.path.join(BASE, "oid.seq")


def next_oid():
    """承运商客户单号：文件持久自增（DB 清空/重建也不复用——
    数据库自增 id 会在清库后重复，撞顺丰 orderId 幂等返回旧运单）"""
    n = 0
    try:
        with open(OID_SEQ, encoding="ascii") as f:
            n = int(f.read().strip() or "0")
    except Exception:
        pass
    n += 1
    try:
        with open(OID_SEQ, "w", encoding="ascii") as f:
            f.write(str(n))
    except Exception:
        pass
    return str(n)

# 承运商对接包（carriers/）：缺失时端点返回明确错误，不影响订单/上传主流程
sys.path.insert(0, BASE)


def _audit(msg):
    """危险操作审计日志（清表/删单/取消下单）→ audit.log（部署不覆盖；2026-09-16 数据丢失复盘新增）"""
    try:
        with open(os.path.join(BASE, "audit.log"), "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


def _merge_pdfs(b64_list):
    """多份单页面单 PDF 合并为一个多页 PDF（一票多件一次预览/打印，减少点击；2026-09-17 用户规则）"""
    import io
    from pypdf import PdfReader, PdfWriter
    w = PdfWriter()
    for b in b64_list:
        w.append(PdfReader(io.BytesIO(base64.b64decode(b))))
    buf = io.BytesIO()
    w.write(buf)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# 面单内容缩放烙进 PDF（2026-09-17 用户反馈：Chrome 对话框缩放完全失效、右缘仍被裁）：
# pypdf 对内容流加变换矩阵——纸面 MediaBox 不变（仍 76×130），内容缩到 93% 并
# 上下左右居中（四边安全边均等，约 2.7mm），打印对话框选"实际大小"即可
LABEL_SHRINK = float(os.environ.get("LABEL_SHRINK", "0.93"))


def _shrink_pdf_b64(pdf_b64, scale=LABEL_SHRINK):
    import io
    from pypdf import PdfReader, PdfWriter, Transformation
    if scale >= 0.999:
        return pdf_b64
    r = PdfReader(io.BytesIO(base64.b64decode(pdf_b64)))
    w = PdfWriter()
    for p in r.pages:
        pw, ph = float(p.mediabox.width), float(p.mediabox.height)
        # 左边距 1.66mm（用户微调 2026-09-17；右侧自然让出 ~3.66mm），上下仍居中
        t = (Transformation().scale(scale, scale)
             .translate(tx=1.66 * 72 / 25.4, ty=ph * (1 - scale) / 2))
        p.add_transformation(t)     # 内容缩放+定位，页面尺寸不变
        w.add_page(p)
    buf = io.BytesIO()
    w.write(buf)
    return base64.b64encode(buf.getvalue()).decode("ascii")
try:
    from carriers import place_order as carrier_place_order, query_route as carrier_query_route
    from carriers import cancel_order as carrier_cancel_order
except Exception:
    carrier_place_order = carrier_query_route = carrier_cancel_order = None

# ---------- 路由状态自动刷新（2026-09-15：列表路由状态不更新问题） ----------
# route_status 下单时写入一次即为旧值；列表加载时后台刷新非终态运单：
# 5 分钟节流防刷接口；终态（签收/回单）停刷；未开通轨迹/调用失败保持旧值并照常节流防连刷
ROUTE_THROTTLE_S = 300
# 定时刷新策略（用户规则 2026-09-15）：白天每 26 分钟一轮；夜里不刷；早 7 点开始
ROUTE_DAY_INTERVAL_S = 26 * 60   # 白天刷新周期 26min
ROUTE_DAY_START = 7              # 白天起点 07:00
ROUTE_DAY_END = 22               # 夜里 22:00–次日 07:00 不刷（可调）
_route_lock = threading.Lock()


def _route_is_final(st):
    return any(k in (st or "") for k in ("签收", "回单"))


# ---------- 回单运单追踪（2026-09-23 顺丰 isSignBack=2 静默无效事故后新增） ----------
# 主运单签收终态后，改查 type=3 回单运单（下单存档 order_resp.sign_back_no）：
# 回单运单出现终态节点（签收/回单返还）→ 订单自动置 returned + returned_at（回单日期自动填）。
# 只发货日起 SIGN_BACK_WINDOW_D 天内追踪，历史单不空转；复用 route_checked_at 节流（主单终态后该字段空闲）。
SIGN_BACK_WINDOW_D = 30
# 口径修正（2026-09-29 用户定夺：对新单生效）：回单运单终态 ≠ 纸质回单已返还
# （485/487/494/543 被自动置"已回单"但实物回单未回）。created_at ≥ 此日期的订单：
# 回单运单终态只写提示标记 order_resp.sign_back_final（步骤弹窗可见）+ 审计，不再自动置
# returned；实物回单返还后人工置回单（PUT /api/orders/<id> status=returned）。
# 此前订单维持原自动置 returned 逻辑（历史不回溯）。
SIGN_BACK_MANUAL_SINCE = "2026-09-29"


def _sign_back_no(r):
    try:
        return (json.loads(r["order_resp"] or "{}") or {}).get("sign_back_no") or ""
    except Exception:
        return ""


def _refresh_sign_back(c, r, now):
    if r["status"] == "returned" or r["carrier"] != "顺丰":
        return
    sb = _sign_back_no(r)
    if not sb:
        return
    try:
        resp0 = json.loads(r["order_resp"] or "{}") or {}
    except Exception:
        resp0 = {}
    # 新单口径（2026-09-29）：created_at ≥ SIGN_BACK_MANUAL_SINCE 只提示不自动置 returned
    manual = (r["created_at"] or "")[:10] >= SIGN_BACK_MANUAL_SINCE
    if manual and resp0.get("sign_back_final"):
        return        # 已提示过终态：停查省接口，等人工核实实物回单后置 returned
    try:                                   # 时间窗：发货日超 30 天不再查
        if r["ship_date"]:
            age = (now - time.mktime(time.strptime(r["ship_date"], "%Y-%m-%d"))) / 86400.0
            if age > SIGN_BACK_WINDOW_D:
                return
    except Exception:
        pass
    try:
        checked = time.mktime(time.strptime(
            r["route_checked_at"] or "1970-01-01 00:00:00", "%Y-%m-%d %H:%M:%S"))
    except Exception:
        checked = 0
    if now - checked < ROUTE_THROTTLE_S:
        return
    st = ""
    try:
        st = (carrier_query_route(r["carrier"], sb) or {}).get("route_status") or ""
    except Exception:
        pass                                 # 查询失败照常写检查时间节流，下一轮再试
    c.execute("UPDATE orders SET route_checked_at=datetime('now','localtime') WHERE id=?",
              (r["id"],))
    if not _route_is_final(st):
        return
    if manual:                               # 新单：只写提示标记 + 审计，不自动置 returned
        resp0["sign_back_final"] = "%s @ %s（回单运单终态；实物回单待人工核实，核实后手动置回单）" % (
            st, time.strftime("%Y-%m-%d %H:%M:%S"))
        c.execute("UPDATE orders SET order_resp=? WHERE id=?",
                  (json.dumps(resp0, ensure_ascii=False), r["id"]))
        _audit("SIGNBACK-FINAL id=%s waybill=%s sign_back=%s st=%s (只提示不自动置回单)"
               % (r["id"], r["waybill_no"], sb, st))
    else:                                    # 历史单（< 2026-09-29）：维持自动回单
        c.execute("UPDATE orders SET status='returned',"
                  " returned_at=datetime('now','localtime') WHERE id=?", (r["id"],))
        _audit("SIGNBACK-RETURNED id=%s waybill=%s sign_back=%s st=%s"
               % (r["id"], r["waybill_no"], sb, st))


def _is_canceled_err(msg):
    """承运商明确反馈"运单已取消/不存在"（区别于网络/未开通等瞬时失败）：
    识别后平台同步回待下单（2026-09-16 用户规则：他方在承运商后台取消的运单不得卡死平台单）"""
    m = str(msg or "")
    return any(k in m for k in ("已取消", "不存在", "已作废", "被取消", "无效",
                                "已撤销", "不允许撤销"))   # 德邦撤销措辞（2026-09-17 #490 实测）


def _refresh_routes():
    if carrier_query_route is None or not _route_lock.acquire(blocking=False):
        return
    try:
        now = time.time()
        with db() as c:
            rows = c.execute(
                "SELECT id, carrier, waybill_no, route_status, route_checked_at,"
                " status, order_resp, ship_date, created_at"
                " FROM orders WHERE waybill_no != ''").fetchall()
            for r in rows:
                if _route_is_final(r["route_status"]):
                    _refresh_sign_back(c, r, now)   # 主单终态 → 回单运单追踪（2026-09-23）
                    continue
                try:
                    checked = time.mktime(time.strptime(
                        r["route_checked_at"] or "1970-01-01 00:00:00", "%Y-%m-%d %H:%M:%S"))
                except Exception:
                    checked = 0
                if now - checked < ROUTE_THROTTLE_S:
                    continue
                st = None
                latest_txt = None
                try:
                    res = carrier_query_route(r["carrier"], r["waybill_no"])
                    st = res.get("route_status") or None
                    det = res.get("detail") or []
                    if det:   # 最新节点 → "MM-dd HH:mm 文本"（时间线卡片显示，替代原模拟时间线）
                        last = det[-1]
                        t = str(last.get("acceptTime") or "")[5:16]
                        latest_txt = (t + " " + str(
                            last.get("remark") or last.get("acceptAddress") or "")).strip()
                except Exception as e:
                    if _is_canceled_err(e):
                        # 他方已在承运商后台取消：同步清空运单字段 → 回待下单（可重新下单）
                        _audit(f"ROUTE-CANCELED-SYNC id={r['id']} waybill={r['waybill_no']} err={e}")
                        c.execute("UPDATE orders SET waybill_no='', route_status='', route_latest='',"
                                  " route_checked_at=datetime('now','localtime') WHERE id=?",
                                  (r["id"],))
                        continue
                    # 其余失败（未开通轨迹/网络）：保持旧值，照常写检查时间节流
                if latest_txt:
                    c.execute("UPDATE orders SET route_status=?, route_latest=?,"
                              " route_checked_at=datetime('now','localtime') WHERE id=?",
                              (st or r["route_status"], latest_txt, r["id"]))
                else:
                    c.execute("UPDATE orders SET route_status=?,"
                              " route_checked_at=datetime('now','localtime') WHERE id=?",
                              (st or r["route_status"], r["id"]))
    finally:
        _route_lock.release()


def _refresh_routes_async():
    threading.Thread(target=_refresh_routes, daemon=True).start()


def _route_timer():
    """常驻定时刷新线程（用户规则 2026-09-15）：白天（07:00–22:00）每 26 分钟刷一轮，
    夜里不刷；复用 _refresh_routes 的每单节流/终态停刷，空跑零成本，无需 cron"""
    while True:
        time.sleep(ROUTE_DAY_INTERVAL_S)
        if not (ROUTE_DAY_START <= time.localtime().tm_hour < ROUTE_DAY_END):
            continue                    # 夜里（22:00–次日 7:00）不刷
        try:
            _refresh_routes()
        except Exception:
            pass

SCHEMA = """
CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  so          TEXT DEFAULT '',
  province    TEXT DEFAULT '',
  city        TEXT DEFAULT '',
  district    TEXT DEFAULT '',
  street      TEXT DEFAULT '',
  company     TEXT DEFAULT '',   -- 公司独立列（2026-09-17 街道/公司拆两字段）
  name        TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  carrier     TEXT DEFAULT '',
  note        TEXT DEFAULT '',
  status      TEXT DEFAULT 'pending',   -- pending/printed/shipped/returned
  ship_date   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  printed_at  TEXT,
  shipped_at  TEXT,
  returned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, ship_date);
/* 常用地址池（全用户共享：任何用户勾选入池，所有人可检索；addr_key 去重） */
CREATE TABLE IF NOT EXISTS addr_pool (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  province    TEXT DEFAULT '',
  city        TEXT DEFAULT '',
  district    TEXT DEFAULT '',
  street      TEXT DEFAULT '',
  company     TEXT DEFAULT '',   -- 公司独立列（2026-09-17）
  name        TEXT DEFAULT '',
  phone       TEXT DEFAULT '',
  addr_key    TEXT UNIQUE,
  created_at  TEXT DEFAULT (datetime('now','localtime'))
);
"""

STATUS_TS = {"printed": "printed_at", "shipped": "shipped_at", "returned": "returned_at"}


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")  # 多读单写不阻塞
    return conn


def init_db():
    with db() as c:
        c.executescript(SCHEMA)
        # 旧库迁移：补充运单号 / 路由状态列
        cols = [r[1] for r in c.execute("PRAGMA table_info(orders)")]
        if "waybill_no" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN waybill_no TEXT DEFAULT ''")
        if "route_status" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN route_status TEXT DEFAULT ''")
        if "priority" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN priority TEXT DEFAULT '一般'")
        if "order_type" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT '发货单'")
        if "so_no" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN so_no TEXT DEFAULT ''")
        if "order_resp" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN order_resp TEXT DEFAULT ''")  # 下单返回值原文（追溯第一步展示）
        if "route_checked_at" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN route_checked_at TEXT DEFAULT ''")  # 轨迹检查时间（自动刷新节流）
        if "route_latest" not in cols:
            c.execute("ALTER TABLE orders ADD COLUMN route_latest TEXT DEFAULT ''")  # 最新路由节点文本（"MM-dd HH:mm 内容"）
        # PO/采购员/发件人/公司/并单组：独立列（原塞在 note 标签/street 里；备注列只存手写备注）
        # merge_group：多 DN 合并发货同组标记（2026-09-20；同组下单只下一次承运商单、共享运单号）
        for col in ("po", "buyer", "emp_name", "emp_phone", "company", "merge_group"):
            if col not in cols:
                c.execute(f"ALTER TABLE orders ADD COLUMN {col} TEXT DEFAULT ''")
        pcols = [r[1] for r in c.execute("PRAGMA table_info(addr_pool)")]
        if "company" not in pcols:
            c.execute("ALTER TABLE addr_pool ADD COLUMN company TEXT DEFAULT ''")  # 公司独立列（2026-09-17）


def row_to_json(r):
    """拼接展示用地址（直辖市去重：省=市）"""
    parts = []
    for p in (r["province"], r["city"], r["district"],
              r["company"] if "company" in r.keys() else "", r["street"]):
        if p and (not parts or parts[-1] != p):
            parts.append(p)
    return {
        "id": r["id"], "so": r["so"],
        "province": r["province"], "city": r["city"], "district": r["district"],
        "street": r["street"],
        "company": r["company"] if "company" in r.keys() else "",
        "address": " ".join(parts),
        "name": r["name"], "phone": r["phone"],
        "carrier": r["carrier"], "note": r["note"],
        "status": r["status"], "ship_date": r["ship_date"],
        "waybill_no": r["waybill_no"] if "waybill_no" in r.keys() else "",
        "route_status": r["route_status"] if "route_status" in r.keys() else "",
        "route_latest": r["route_latest"] if "route_latest" in r.keys() else "",
        "shipped_at": r["shipped_at"], "returned_at": r["returned_at"],
        "priority": r["priority"] if "priority" in r.keys() else "一般",
        "order_type": r["order_type"] if "order_type" in r.keys() else "发货单",
        "so_no": r["so_no"] if "so_no" in r.keys() else "",
        "order_resp": r["order_resp"] if "order_resp" in r.keys() else "",
        "po": r["po"] if "po" in r.keys() else "",
        "buyer": r["buyer"] if "buyer" in r.keys() else "",
        "emp_name": r["emp_name"] if "emp_name" in r.keys() else "",
        "emp_phone": r["emp_phone"] if "emp_phone" in r.keys() else "",
        "merge_group": r["merge_group"] if "merge_group" in r.keys() else "",   # 并单组（2026-09-20 多 DN 合并发货）
        "created_at": r["created_at"],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB_ROOT, **kw)   # 静态根=Fahuo/（pages/、shared/、index.html）

    # ---------- 工具 ----------
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code, obj):
        body = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    def log_message(self, fmt, *args):  # 精简日志
        pass

    # ---------- 路由 ----------
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        if re.search(r"/api/orders$", path):
            return self._list_orders(qs)
        if re.search(r"/api/stats$", path):
            return self._stats()
        if re.search(r"/api/upload$", path):
            return self._upload_list(qs)
        if re.search(r"/api/carrier/route$", path):
            return self._carrier_route(qs)
        if re.search(r"/api/carrier/label$", path):
            return self._carrier_label(qs)
        if re.search(r"/api/carrier/label_ot$", path):
            return self._carrier_label_ot_get(qs)
        if re.search(r"/api/addrpool$", path):
            return self._addrpool_list()
        if re.search(r"/api/signback_addr$", path):
            return self._signback_addr()
        return super().do_GET()  # 静态文件

    def do_POST(self):
        p = urlparse(self.path).path
        if re.search(r"/api/orders$", p):
            return self._create_order()
        if re.search(r"/api/upload$", p):
            return self._upload()
        if re.search(r"/api/carrier/order$", p):
            return self._carrier_order()
        if re.search(r"/api/carrier/label_ot$", p):
            return self._carrier_label_ot_post()
        if re.search(r"/api/carrier/cancel$", p):
            return self._carrier_cancel()
        if re.search(r"/api/admin/clear-orders$", p):
            return self._clear_orders()
        if re.search(r"/api/addrpool$", p):
            return self._addrpool_add()
        self._json(404, {"error": "not found"})

    def do_PUT(self):
        m = re.search(r"/api/orders/(\d+)$", urlparse(self.path).path)
        if m:
            return self._update_order(int(m.group(1)))
        self._json(404, {"error": "not found"})

    def do_DELETE(self):
        if re.search(r"/api/upload$", urlparse(self.path).path):
            return self._upload_delete()
        m = re.search(r"/api/orders/(\d+)$", urlparse(self.path).path)
        if m:
            _audit(f"DELETE-ORDER id={m.group(1)}")   # 危险操作留痕
            with db() as c:
                cur = c.execute("DELETE FROM orders WHERE id=?", (int(m.group(1)),))
            return self._json(200, {"deleted": cur.rowcount})
        self._json(404, {"error": "not found"})

    # ---------- 业务 ----------
    def _signback_addr(self):
        """GET /api/signback_addr → 顺丰回单返回到方地址（2026-09-29 平台统一维护；
        唯一权威源 carriers/sf_express.SIGN_BACK_ADDR，前端维护申请文案引用）"""
        try:
            from carriers import sf_express
            self._json(200, sf_express.SIGN_BACK_ADDR)
        except Exception as e:                              # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _addrpool_list(self):
        """GET /api/addrpool → 共享地址池列表（最新在前）"""
        with db() as c:
            rows = c.execute(
                "SELECT province,city,district,company,street,name,phone FROM addr_pool"
                " ORDER BY id DESC LIMIT 5000").fetchall()   # 500→5000（2026-09-24 DN 地址回填后防挤出）
        self._json(200, [dict(r) for r in rows])

    def _addrpool_add(self):
        """POST /api/addrpool → 勾选入池（addr_key 去重：同地址跳过）"""
        d = self._body()
        key = " ".join(x for x in (d.get("province", ""), d.get("city", ""),
                                   d.get("district", ""), d.get("company", ""),
                                   d.get("street", "")) if x)
        if not key:
            return self._json(400, {"error": "地址为空"})
        with db() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO addr_pool"
                " (province,city,district,company,street,name,phone,addr_key)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (d.get("province", ""), d.get("city", ""), d.get("district", ""),
                 d.get("company", ""), d.get("street", ""),
                 d.get("name", ""), d.get("phone", ""), key))
        self._json(201, {"added": cur.rowcount})

    def _clear_orders(self):
        """POST /api/admin/clear-orders → 清空订单表（设置页「清除模拟数据」用）"""
        with db() as c:
            cur = c.execute("DELETE FROM orders")
        _audit(f"CLEAR-ORDERS deleted={cur.rowcount}")   # 危险操作留痕（2026-09-16 数据丢失复盘）
        self._json(200, {"deleted": cur.rowcount})

    def _carrier_order(self):
        """POST /api/carrier/order  {carrier, so}
        顺丰/德邦/跨越 → carriers 包（未配密钥返回演示单号）；专车/自提 → 厂内 ZC/ZT 单号"""
        if carrier_place_order is None:
            return self._json(500, {"error": "carriers 包缺失，请部署 carriers/ 目录"})
        d = self._body()
        carrier = (d.get("carrier") or "").strip()
        dn = re.sub(r"[^\w-]", "", str(d.get("so") or ""))[:32]
        try:
            if carrier in ("专车", "自提"):
                # 厂内自编号：ZC/ZT + 年月日 + 2位当日流水（2026-09-21 用户规则；原 ZC+DN+01/02 弃用）
                # 持久计数器表 ot_seq：取消/删单也不复用流水号（与 next_oid 同一"永不复用"原则）
                prefix = "ZC" if carrier == "专车" else "ZT"
                day = time.strftime("%Y%m%d")
                with db() as c:
                    c.execute("CREATE TABLE IF NOT EXISTS ot_seq (day TEXT NOT NULL, prefix TEXT NOT NULL,"
                              " n INTEGER NOT NULL, PRIMARY KEY (day, prefix))")
                    c.execute("INSERT INTO ot_seq(day, prefix, n) VALUES(?,?,1)"
                              " ON CONFLICT(day, prefix) DO UPDATE SET n = n + 1", (day, prefix))
                    n = c.execute("SELECT n FROM ot_seq WHERE day=? AND prefix=?",
                                  (day, prefix)).fetchone()[0]
                res = {"waybill_no": f"{prefix}{day}{n:02d}",
                       "route_status": "专车直送" if carrier == "专车" else "待自提", "mock": True}
            else:
                order = dict(d)          # 完整订单字段（省市区/街道/姓名/电话/托寄物…）
                order["so"] = dn
                order["oid"] = next_oid()  # 承运商客户单号：持久自增（服务端统一分配，永不复用）
                res = carrier_place_order(carrier, order)
                res.setdefault("order_id", order["oid"])   # oid 随返回值持久化到 order_resp（取消下单要用）
        except Exception as e:
            return self._json(400, {"error": str(e)})
        # 兜底：任何路径不得返回"成功但无运单号"（前端据 waybill_no 判成败）
        if not res.get("waybill_no"):
            return self._json(502, {"error": "承运商下单成功判定失败：响应中无运单号"})
        self._json(200, res)

    def _carrier_cancel(self):
        """POST /api/carrier/cancel  {id}
        仅未揽收可取消（路由状态=待揽收；专车/自提=厂内单无外部承运商，直接本地清除）。
        承运商取消成功 → 清空 waybill_no/route_status/route_latest，单回到待下单：
        录单页可改数据、下单页可改承运参数后重新下单（重新下单走 next_oid，永不复用）。
        order_resp 保留作审计追溯。"""
        if carrier_cancel_order is None:
            return self._json(500, {"error": "carriers 包缺失，请部署 carriers/ 目录"})
        d = self._body()
        try:
            row_id = int(d.get("id") or 0)
        except Exception:
            row_id = 0
        with db() as c:
            row = c.execute("SELECT * FROM orders WHERE id=?", (row_id,)).fetchone()
        if not row:
            return self._json(404, {"error": "订单不存在"})
        o = row_to_json(row)
        wb = o.get("waybill_no") or ""
        if not wb:
            return self._json(400, {"error": "该单尚未下单，无需取消"})
        carrier = (o.get("carrier") or "").strip()
        rs = o.get("route_status") or ""
        if carrier not in ("专车", "自提"):
            if rs != "待揽收":
                return self._json(400, {"error": "仅未揽收（路由状态=待揽收）可取消下单；当前路由状态：%s"
                                        % (rs or "—")})
            order_id, logistic_id = "", ""
            try:
                rd = json.loads(o.get("order_resp") or "{}")
                order_id = str(rd.get("order_id") or "")
                logistic_id = str(rd.get("logistic_id") or "")
            except Exception:
                pass
            if carrier == "顺丰" and not order_id:
                return self._json(400, {"error": "该单无承运商客户单号（order_resp 无 order_id），"
                                        "无法在线取消；请到丰桥后台人工取消"})
            try:
                carrier_cancel_order(carrier, order_id, wb, logistic_id)
            except Exception as e:
                if _is_canceled_err(e):
                    # 承运商侧早已取消：目标状态一致，直接同步回待下单（2026-09-16 用户规则）
                    _audit(f"CANCEL-ALREADY id={row_id} waybill={wb} err={e}")
                    with db() as c:
                        c.execute("UPDATE orders SET waybill_no='', route_status='', route_latest='' WHERE id=?",
                                  (row_id,))
                    return self._json(200, {"ok": True, "cleared": wb,
                                            "note": "承运商侧已是取消状态，已同步回待下单"})
                return self._json(400, {"error": str(e)})
        with db() as c:
            c.execute("UPDATE orders SET waybill_no='', route_status='', route_latest='' WHERE id=?",
                      (row_id,))
        self._json(200, {"ok": True, "cleared": wb})

    def _carrier_route(self, qs):
        """GET /api/carrier/route?carrier=顺丰&waybill_no=xxx → 轨迹/最新状态"""
        if carrier_query_route is None:
            return self._json(500, {"error": "carriers 包缺失，请部署 carriers/ 目录"})
        carrier = (qs.get("carrier", [""])[0]).strip()
        waybill = re.sub(r"[^\w-]", "", qs.get("waybill_no", [""])[0])[:40]
        if not carrier or not waybill:
            return self._json(400, {"error": "carrier 和 waybill_no 必填"})
        try:
            res = carrier_query_route(carrier, waybill)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        self._json(200, res)

    def _label_pdf_b64(self, carrier, waybill):
        """单运单取官方面单 PDF base64（内嵌 base64 / url+token 两形态；失败抛承运商原始错误）"""
        from carriers import print_label, find_pdf_b64, find_label_files
        from carriers.base import fetch_url_pdf_b64
        data = print_label(carrier, waybill)
        pdf = find_pdf_b64(data)                      # 形态1：响应内嵌 base64
        if not pdf:
            files = find_label_files(data)            # 形态2：url+token（顺丰 v2.0）
            if files:
                pdf = fetch_url_pdf_b64(files[0]["url"], files[0]["token"])
        if pdf:
            pdf = _shrink_pdf_b64(pdf)                # 90% 安全边烙进文件（对话框缩放不可靠）
        return pdf, data

    def _carrier_label_ot_post(self):
        """POST /api/carrier/label_ot {waybill_no, bar_png, qr_png}
        专车/自提厂内面单（2026-09-21 用户反馈 HTML 打印屡次乱版/乱码，改服务端渲染 PDF）：
        浏览器用前端库画好条码/二维码 PNG 上传（服务端无 symbology 库），
        ot_label 模块 PIL 渲染 100×150mm PDF 并缓存，GET raw 供 iframe 显示/打印。"""
        d = self._body()
        wb = re.sub(r"[^\w-]", "", str(d.get("waybill_no") or ""))[:40]
        if not wb:
            return self._json(400, {"error": "waybill_no 必填"})
        with db() as c:
            row = c.execute("SELECT * FROM orders WHERE waybill_no=? ORDER BY id DESC LIMIT 1",
                            (wb,)).fetchone()
        if not row:
            return self._json(404, {"error": "运单 %s 无对应订单" % wb})
        try:
            import ot_label
            pdf = ot_label.render_pdf(row_to_json(row),
                                      d.get("bar_png") or "", d.get("qr_png") or "")
            ot_label.cache_put(wb, pdf)
        except Exception as e:
            return self._json(500, {"error": "厂内面单渲染失败：%s" % e})
        self._json(200, {"ok": 1, "bytes": len(pdf)})

    def _carrier_label_ot_get(self, qs):
        """GET /api/carrier/label_ot?waybill_no=&raw=1 → 已渲染缓存的厂内面单 PDF（iframe 同源直显）"""
        wb = re.sub(r"[^\w-]", "", qs.get("waybill_no", [""])[0])[:40]
        if not wb:
            return self._json(400, {"error": "waybill_no 必填"})
        try:
            import ot_label
            pdf = ot_label.cache_get(wb)
        except Exception as e:
            return self._json(500, {"error": "厂内面单模块异常：%s" % e})
        if not pdf:
            return self._json(404, {"error": "面单未渲染，请重新点击打印（先 POST 渲染）"})
        if qs.get("raw", [""])[0] == "1":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(pdf)))
            self.end_headers()
            self.wfile.write(pdf)
            return
        self._json(200, {"pdf": base64.b64encode(pdf).decode()})

    def _carrier_label(self, qs):
        """GET /api/carrier/label?carrier=顺丰&waybill_no=xxx → 官方面单 PDF（base64）。
        一票多件：waybill_no 逗号分隔多运单 → 逐件取面单合并为一个多页 PDF（2026-09-17 用户规则）
        optional_no：附加面单——**2026-09-30 用户指令撤回追加（二次终定）**：SF106 回单号云打印
        实测（新单+已签收单一致，_sb_pages.py/_probe_reverse.py 存档）=1 页正向"POD标快"签收联
        （寄=莱克勒/收=客户/寄付月结），**不是**用户要的反向返回运单（收寄互反/到付/签回单原单号
        回链——该联目前仅速打可在签收前出纸，丰桥取法待顺丰官方答复）。默认出纸=仅官方主面单；
        仅显式 with_optional=1 才合并（探针核验用，失败静默跳过、绝不阻塞主面单）"""
        carrier = (qs.get("carrier", [""])[0]).strip()
        waybills = [w for w in (re.sub(r"[^\w-]", "", x)[:40]
                                for x in qs.get("waybill_no", [""])[0].split(",")) if w]
        optional = [w for w in (re.sub(r"[^\w-]", "", x)[:40]
                                for x in qs.get("optional_no", [""])[0].split(","))
                    if w and w not in waybills]
        if not carrier or not waybills:
            return self._json(400, {"error": "carrier 和 waybill_no 必填"})
        pdfs, last_data = [], None
        try:
            for w in waybills:
                pdf, last_data = self._label_pdf_b64(carrier, w)
                if not pdf:
                    return self._json(400, {"error": "运单 %s 无面单 PDF" % w})
                pdfs.append(pdf)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        # 2026-09-30 用户指令撤回：SF106 云打印=正向 POD 签收联，非反向返回运单（见 docstring）——
        # 默认出纸=仅官方主面单；with_optional=1 仅保留供探针核验
        if qs.get("with_optional", [""])[0] == "1":
            for w in optional:      # 探针附加页：失败跳过，不阻塞主面单
                try:
                    pdf_opt, _ = self._label_pdf_b64(carrier, w)
                    if pdf_opt:
                        pdfs.append(pdf_opt)
                except Exception:
                    pass
        pdf = pdfs[0] if len(pdfs) == 1 else _merge_pdfs(pdfs)   # 多件合并为一个文件
        if qs.get("raw", [""])[0] == "1":             # 原始 PDF 输出（iframe 同源直显，避开 blob 拦截）
            body = base64.b64decode(pdf)
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json(200, {"pdf": pdf, "raw": None if pdf else last_data})

    def _upload_list(self, qs):
        """GET /api/upload?dn=<DN> → {"dn":..., "files":[文件名...]}（无目录时 files=[]）；
        无 dn → {"counts": {dn: n}} 全量照片计数（清单"发货照片"列一次取数；2026-09-15）"""
        dn = re.sub(r"[^\w-]", "", qs.get("dn", [""])[0])[:32]
        if not dn:
            counts = {}
            if os.path.isdir(UPLOAD_DIR):
                for d in os.listdir(UPLOAD_DIR):
                    f = os.path.join(UPLOAD_DIR, d)
                    if os.path.isdir(f):
                        counts[d] = len(os.listdir(f))
            return self._json(200, {"counts": counts})
        folder = os.path.join(UPLOAD_DIR, dn)
        files = sorted(os.listdir(folder)) if os.path.isdir(folder) else []
        self._json(200, {"dn": dn, "files": files})

    def _upload_delete(self):
        """DELETE /api/upload?dn=<DN>&name=<文件名> → 删除文件；目录空了顺带移除"""
        qs = parse_qs(urlparse(self.path).query)
        dn = re.sub(r"[^\w-]", "", qs.get("dn", [""])[0])[:32]
        name = os.path.basename(qs.get("name", [""])[0].replace("\\", "/")).strip()
        if not dn or not name:
            return self._json(400, {"error": "dn 和 name 必填"})
        fp = os.path.join(UPLOAD_DIR, dn, name)
        if not os.path.isfile(fp):
            return self._json(404, {"error": "文件不存在"})
        os.remove(fp)
        folder = os.path.join(UPLOAD_DIR, dn)
        if os.path.isdir(folder) and not os.listdir(folder):
            os.rmdir(folder)
        self._json(200, {"ok": True, "deleted": name})

    def _upload(self):
        """POST /api/upload?dn=<DN>&name=<文件名>（body=原始文件字节）
        保存到 Upload/<DN>/<文件名>，目录自动创建。"""
        qs = parse_qs(urlparse(self.path).query)
        dn = re.sub(r"[^\w-]", "", qs.get("dn", [""])[0])[:32]
        name = os.path.basename(qs.get("name", [""])[0].replace("\\", "/")).strip()
        if not dn or not name:
            return self._json(400, {"error": "dn 和 name 必填"})
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return self._json(400, {"error": "空文件"})
        if n > 50 * 1024 * 1024:
            return self._json(413, {"error": "文件过大（>50MB）"})
        folder = os.path.join(UPLOAD_DIR, dn)
        os.makedirs(folder, exist_ok=True)
        data = self.rfile.read(n)
        with open(os.path.join(folder, name), "wb") as f:
            f.write(data)
        self._json(201, {"ok": True, "path": "Upload/%s/%s" % (dn, name), "size": len(data)})

    def _list_orders(self, qs):
        _refresh_routes_async()   # 后台刷新非终态运单的路由状态（5min 节流，不阻塞本次返回）
        day = qs.get("date", [""])[0]
        with db() as c:
            if day:
                rows = c.execute(
                    "SELECT * FROM orders WHERE ship_date=? ORDER BY id DESC", (day,)).fetchall()
            else:
                rows = c.execute(
                    "SELECT * FROM orders ORDER BY id DESC LIMIT 500").fetchall()  # 默认全部
        self._json(200, [row_to_json(r) for r in rows])

    def _create_order(self):
        d = self._body()
        with db() as c:
            cur = c.execute(
                "INSERT INTO orders (so,province,city,district,street,company,name,phone,carrier,note,ship_date,priority,order_type,so_no,po,buyer,emp_name,emp_phone,merge_group)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d.get("so", ""), d.get("province", ""), d.get("city", ""),
                 d.get("district", ""), d.get("street", ""), d.get("company", ""),
                 d.get("name", ""),
                 d.get("phone", ""), d.get("carrier", ""), d.get("note", ""),
                 d.get("ship_date", ""), d.get("priority", "一般"),
                 d.get("order_type", "发货单"), d.get("so_no", ""),
                 d.get("po", ""), d.get("buyer", ""),
                 d.get("emp_name", ""), d.get("emp_phone", ""), d.get("merge_group", "")))
            # DN 发货单收件地址自动入池（2026-09-24）：addr_key 去重 OR IGNORE 零副作用，
            # 地址簿恒覆盖全部 DN 收件地址（历史单已一次性回填）；外协/其他单仍走录入页勾选
            if d.get("order_type", "发货单") == "发货单":
                _key = " ".join(x for x in (d.get("province", ""), d.get("city", ""),
                                            d.get("district", ""), d.get("company", ""),
                                            d.get("street", "")) if x)
                if _key:
                    c.execute("INSERT OR IGNORE INTO addr_pool"
                              " (province,city,district,company,street,name,phone,addr_key)"
                              " VALUES (?,?,?,?,?,?,?,?)",
                              (d.get("province", ""), d.get("city", ""), d.get("district", ""),
                               d.get("company", ""), d.get("street", ""), d.get("name", ""),
                               d.get("phone", ""), _key))
            r = c.execute("SELECT * FROM orders WHERE id=?", (cur.lastrowid,)).fetchone()
        self._json(201, row_to_json(r))

    def _update_order(self, oid):
        d = self._body()
        fields, vals = [], []
        for k in ("so", "province", "city", "district", "street", "company", "name",
                  "phone", "carrier", "note", "ship_date", "status",
                  "waybill_no", "route_status", "priority", "order_type", "so_no",
                  "order_resp", "po", "buyer", "emp_name", "emp_phone", "merge_group"):
            if k in d:
                fields.append(f"{k}=?")
                vals.append(str(d[k]))
        if not fields:
            return self._json(400, {"error": "no fields"})
        if "status" in d and d["status"] in STATUS_TS:
            fields.append(f"{STATUS_TS[d['status']]}=datetime('now','localtime')")
        vals.append(oid)
        with db() as c:
            c.execute(f"UPDATE orders SET {', '.join(fields)} WHERE id=?", vals)
            r = c.execute("SELECT * FROM orders WHERE id=?", (oid,)).fetchone()
        if not r:
            return self._json(404, {"error": "not found"})
        self._json(200, row_to_json(r))

    def _stats(self):
        """看板统计（2026-09-16 用户规则修正：以"揽收"为发货判定——
        已发货 = 运单存在且路由状态≠待揽收；未揽收（含未下单）才算待发货/超时。
        旧口径用 status/shipped_at，下单揽收后 status 仍 pending，超时/昨日发货全错）"""
        shipped = "waybill_no<>'' AND COALESCE(route_status,'')<>'待揽收'"
        unshipped = "(waybill_no='' OR COALESCE(route_status,'')='待揽收')"
        with db() as c:
            r = c.execute(
                "SELECT"
                f" (SELECT COUNT(*) FROM orders WHERE ship_date=date('now','localtime','-1 day')"
                f"   AND {shipped}) AS yesterday_shipped,"
                f" (SELECT COUNT(*) FROM orders WHERE ship_date=date('now','localtime')"
                f"   AND {unshipped}) AS today_pending,"
                f" (SELECT COUNT(*) FROM orders WHERE ship_date<>'' AND ship_date<date('now','localtime')"
                f"   AND {unshipped}) AS overdue,"
                f" (SELECT COUNT(*) FROM orders WHERE ship_date>date('now','localtime')"
                f"   AND {unshipped}) AS planned,"
                " (SELECT COUNT(*) FROM orders WHERE status='returned'"
                "   AND date(returned_at)=date('now','localtime')) AS returned"
            ).fetchone()
        self._json(200, dict(r))


if __name__ == "__main__":
    init_db()
    threading.Thread(target=_route_timer, daemon=True).start()   # 路由状态定时刷新（白天26min/夜里停）
    print(f"LNSC 全链发货平台 API 已启动: http://0.0.0.0:{PORT}/  (数据库: {DB})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
