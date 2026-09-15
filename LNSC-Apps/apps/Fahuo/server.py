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
try:
    from carriers import place_order as carrier_place_order, query_route as carrier_query_route
except Exception:
    carrier_place_order = carrier_query_route = None

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


def _refresh_routes():
    if carrier_query_route is None or not _route_lock.acquire(blocking=False):
        return
    try:
        now = time.time()
        with db() as c:
            rows = c.execute(
                "SELECT id, carrier, waybill_no, route_status, route_checked_at"
                " FROM orders WHERE waybill_no != ''").fetchall()
            for r in rows:
                if _route_is_final(r["route_status"]):
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
                except Exception:
                    pass    # 未开通轨迹/网络失败：保持旧值，照常写检查时间节流
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
        # PO/采购员/发件人：独立列（原塞在 note 标签里；备注列只存手写备注）
        for col in ("po", "buyer", "emp_name", "emp_phone"):
            if col not in cols:
                c.execute(f"ALTER TABLE orders ADD COLUMN {col} TEXT DEFAULT ''")


def row_to_json(r):
    """拼接展示用地址（直辖市去重：省=市）"""
    parts = []
    for p in (r["province"], r["city"], r["district"], r["street"]):
        if p and (not parts or parts[-1] != p):
            parts.append(p)
    return {
        "id": r["id"], "so": r["so"],
        "province": r["province"], "city": r["city"], "district": r["district"],
        "street": r["street"], "address": " ".join(parts),
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
        if re.search(r"/api/addrpool$", path):
            return self._addrpool_list()
        return super().do_GET()  # 静态文件

    def do_POST(self):
        p = urlparse(self.path).path
        if re.search(r"/api/orders$", p):
            return self._create_order()
        if re.search(r"/api/upload$", p):
            return self._upload()
        if re.search(r"/api/carrier/order$", p):
            return self._carrier_order()
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
            with db() as c:
                cur = c.execute("DELETE FROM orders WHERE id=?", (int(m.group(1)),))
            return self._json(200, {"deleted": cur.rowcount})
        self._json(404, {"error": "not found"})

    # ---------- 业务 ----------
    def _addrpool_list(self):
        """GET /api/addrpool → 共享地址池列表（最新在前）"""
        with db() as c:
            rows = c.execute(
                "SELECT province,city,district,street,name,phone FROM addr_pool"
                " ORDER BY id DESC LIMIT 500").fetchall()
        self._json(200, [dict(r) for r in rows])

    def _addrpool_add(self):
        """POST /api/addrpool → 勾选入池（addr_key 去重：同地址跳过）"""
        d = self._body()
        key = " ".join(x for x in (d.get("province", ""), d.get("city", ""),
                                   d.get("district", ""), d.get("street", "")) if x)
        if not key:
            return self._json(400, {"error": "地址为空"})
        with db() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO addr_pool"
                " (province,city,district,street,name,phone,addr_key)"
                " VALUES (?,?,?,?,?,?,?)",
                (d.get("province", ""), d.get("city", ""), d.get("district", ""),
                 d.get("street", ""), d.get("name", ""), d.get("phone", ""), key))
        self._json(201, {"added": cur.rowcount})

    def _clear_orders(self):
        """POST /api/admin/clear-orders → 清空订单表（设置页「清除模拟数据」用）"""
        with db() as c:
            cur = c.execute("DELETE FROM orders")
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
                res = {"waybill_no": ("ZC" if carrier == "专车" else "ZT") + dn + ("01" if carrier == "专车" else "02"),
                       "route_status": "专车直送" if carrier == "专车" else "待自提", "mock": True}
            else:
                order = dict(d)          # 完整订单字段（省市区/街道/姓名/电话/托寄物…）
                order["so"] = dn
                order["oid"] = next_oid()  # 承运商客户单号：持久自增（服务端统一分配，永不复用）
                res = carrier_place_order(carrier, order)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        # 兜底：任何路径不得返回"成功但无运单号"（前端据 waybill_no 判成败）
        if not res.get("waybill_no"):
            return self._json(502, {"error": "承运商下单成功判定失败：响应中无运单号"})
        self._json(200, res)

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

    def _carrier_label(self, qs):
        """GET /api/carrier/label?carrier=顺丰&waybill_no=xxx → 官方面单 PDF（base64）"""
        carrier = (qs.get("carrier", [""])[0]).strip()
        waybill = re.sub(r"[^\w-]", "", qs.get("waybill_no", [""])[0])[:40]
        if not carrier or not waybill:
            return self._json(400, {"error": "carrier 和 waybill_no 必填"})
        try:
            from carriers import print_label, find_pdf_b64, find_label_files
            from carriers.base import fetch_url_pdf_b64
            data = print_label(carrier, waybill)
        except Exception as e:
            return self._json(400, {"error": str(e)})
        pdf = find_pdf_b64(data)                      # 形态1：响应内嵌 base64
        if not pdf:
            files = find_label_files(data)            # 形态2：url+token（顺丰 v2.0）
            if files:
                try:
                    pdf = fetch_url_pdf_b64(files[0]["url"], files[0]["token"])
                except Exception as e:
                    return self._json(400, {"error": str(e)})
        if qs.get("raw", [""])[0] == "1":             # 原始 PDF 输出（iframe 同源直显，避开 blob 拦截）
            if not pdf:
                return self._json(404, {"error": "无 PDF"})
            body = base64.b64decode(pdf)
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._json(200, {"pdf": pdf, "raw": None if pdf else data})

    def _upload_list(self, qs):
        """GET /api/upload?dn=<DN> → {"dn":..., "files":[文件名...]}（无目录时 files=[]）"""
        dn = re.sub(r"[^\w-]", "", qs.get("dn", [""])[0])[:32]
        folder = os.path.join(UPLOAD_DIR, dn) if dn else None
        files = sorted(os.listdir(folder)) if folder and os.path.isdir(folder) else []
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
                "INSERT INTO orders (so,province,city,district,street,name,phone,carrier,note,ship_date,priority,order_type,so_no,po,buyer,emp_name,emp_phone)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d.get("so", ""), d.get("province", ""), d.get("city", ""),
                 d.get("district", ""), d.get("street", ""), d.get("name", ""),
                 d.get("phone", ""), d.get("carrier", ""), d.get("note", ""),
                 d.get("ship_date", ""), d.get("priority", "一般"),
                 d.get("order_type", "发货单"), d.get("so_no", ""),
                 d.get("po", ""), d.get("buyer", ""),
                 d.get("emp_name", ""), d.get("emp_phone", "")))
            r = c.execute("SELECT * FROM orders WHERE id=?", (cur.lastrowid,)).fetchone()
        self._json(201, row_to_json(r))

    def _update_order(self, oid):
        d = self._body()
        fields, vals = [], []
        for k in ("so", "province", "city", "district", "street", "name",
                  "phone", "carrier", "note", "ship_date", "status",
                  "waybill_no", "route_status", "priority", "order_type", "so_no",
                  "order_resp", "po", "buyer", "emp_name", "emp_phone"):
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
        with db() as c:
            r = c.execute(
                "SELECT"
                " (SELECT COUNT(*) FROM orders WHERE status='shipped'"
                "   AND date(shipped_at)=date('now','localtime','-1 day')) AS yesterday_shipped,"
                " (SELECT COUNT(*) FROM orders WHERE status='pending'"
                "   AND ship_date=date('now','localtime')) AS today_pending,"
                " (SELECT COUNT(*) FROM orders WHERE status='pending'"
                "   AND ship_date<>'' AND ship_date<date('now','localtime')) AS overdue,"
                " (SELECT COUNT(*) FROM orders WHERE status='pending'"
                "   AND ship_date>date('now','localtime')) AS planned,"
                " (SELECT COUNT(*) FROM orders WHERE status='returned'"
                "   AND date(returned_at)=date('now','localtime')) AS returned"
            ).fetchone()
        self._json(200, dict(r))


if __name__ == "__main__":
    init_db()
    threading.Thread(target=_route_timer, daemon=True).start()   # 路由状态定时刷新（白天26min/夜里停）
    print(f"LNSC 全链发货平台 API 已启动: http://0.0.0.0:{PORT}/  (数据库: {DB})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
