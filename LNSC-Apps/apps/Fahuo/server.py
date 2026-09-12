#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LNSC 发货全链系统 - SQLite API 服务
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
import json
import os
import re
import sqlite3
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "fahuo.db")
UPLOAD_DIR = os.path.join(BASE, "Upload")   # 上传文件根目录（按 DN 建子文件夹）
PORT = int(os.environ.get("PORT", "8091"))

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
        "shipped_at": r["shipped_at"], "returned_at": r["returned_at"],
        "priority": r["priority"] if "priority" in r.keys() else "一般",
        "order_type": r["order_type"] if "order_type" in r.keys() else "发货单",
        "so_no": r["so_no"] if "so_no" in r.keys() else "",
        "created_at": r["created_at"],
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=BASE, **kw)

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
        return super().do_GET()  # 静态文件

    def do_POST(self):
        p = urlparse(self.path).path
        if re.search(r"/api/orders$", p):
            return self._create_order()
        if re.search(r"/api/upload$", p):
            return self._upload()
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
                "INSERT INTO orders (so,province,city,district,street,name,phone,carrier,note,ship_date,priority,order_type,so_no)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (d.get("so", ""), d.get("province", ""), d.get("city", ""),
                 d.get("district", ""), d.get("street", ""), d.get("name", ""),
                 d.get("phone", ""), d.get("carrier", ""), d.get("note", ""),
                 d.get("ship_date", ""), d.get("priority", "一般"),
                 d.get("order_type", "发货单"), d.get("so_no", "")))
            r = c.execute("SELECT * FROM orders WHERE id=?", (cur.lastrowid,)).fetchone()
        self._json(201, row_to_json(r))

    def _update_order(self, oid):
        d = self._body()
        fields, vals = [], []
        for k in ("so", "province", "city", "district", "street", "name",
                  "phone", "carrier", "note", "ship_date", "status",
                  "waybill_no", "route_status", "priority", "order_type", "so_no"):
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
    print(f"LNSC 发货全链系统 API 已启动: http://0.0.0.0:{PORT}/  (数据库: {DB})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
