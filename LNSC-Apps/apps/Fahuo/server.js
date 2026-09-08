#!/usr/bin/env node
/* LNSC 发货全链系统 - SQLite API 服务（Node 版，零依赖，需 Node >= 22.5 内置 node:sqlite）
 * 接口与 server.py 完全一致，供 Windows 本地开发/测试使用（服务器推荐 server.py）
 *
 * 用法：node server.js        默认端口 8091（PORT 环境变量可改）
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const BASE = __dirname;
const PORT = parseInt(process.env.PORT || "8091", 10);

const db = new DatabaseSync(path.join(BASE, "fahuo.db"));
db.exec("PRAGMA journal_mode=WAL;");
db.exec(`
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
  status      TEXT DEFAULT 'pending',
  ship_date   TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  printed_at  TEXT,
  shipped_at  TEXT,
  returned_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status_date ON orders(status, ship_date);
`);

/* 旧库迁移：补充运单号 / 路由状态列 */
{
  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes("waybill_no")) db.exec("ALTER TABLE orders ADD COLUMN waybill_no TEXT DEFAULT ''");
  if (!cols.includes("route_status")) db.exec("ALTER TABLE orders ADD COLUMN route_status TEXT DEFAULT ''");
  if (!cols.includes("priority")) db.exec("ALTER TABLE orders ADD COLUMN priority TEXT DEFAULT '一般'");
  if (!cols.includes("order_type")) db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT '发货单'");
  if (!cols.includes("so_no")) db.exec("ALTER TABLE orders ADD COLUMN so_no TEXT DEFAULT ''");
}

const STATUS_TS = { printed: "printed_at", shipped: "shipped_at", returned: "returned_at" };
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".wasm": "application/wasm", ".md": "text/plain; charset=utf-8"
};

function rowToJson(r) {
  const parts = [];
  for (const p of [r.province, r.city, r.district, r.street]) {
    if (p && parts[parts.length - 1] !== p) parts.push(p);
  }
  return { ...r, address: parts.join(" ") };
}

function json(res, code, obj) {
  const body = JSON.stringify(obj ?? null);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function readBody(req, cb) {
  let raw = "";
  req.on("data", c => raw += c);
  req.on("end", () => { try { cb(JSON.parse(raw || "{}")); } catch { cb({}); } });
}

function serveStatic(p, res) {
  let file = path.join(BASE, p === "/" ? "index.html" : decodeURIComponent(p));
  if (!file.startsWith(BASE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("Not Found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

/* ---------- 业务 ---------- */
function listOrders(u, res) {
  const day = u.searchParams.get("date") || "";
  const rows = day
    ? db.prepare("SELECT * FROM orders WHERE ship_date=? ORDER BY id DESC").all(day)
    : db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all(); /* 默认全部 */
  json(res, 200, rows.map(rowToJson));
}

function createOrder(d, res) {
  const r = db.prepare(
    "INSERT INTO orders (so,province,city,district,street,name,phone,carrier,note,ship_date,priority,order_type,so_no)" +
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(d.so || "", d.province || "", d.city || "", d.district || "", d.street || "",
        d.name || "", d.phone || "", d.carrier || "", d.note || "", d.ship_date || "",
        d.priority || "一般", d.order_type || "发货单", d.so_no || "");
  json(res, 201, rowToJson(db.prepare("SELECT * FROM orders WHERE id=?").get(r.lastInsertRowid)));
}

function updateOrder(id, d, res) {
  const cols = ["so", "province", "city", "district", "street", "name",
                "phone", "carrier", "note", "ship_date", "status",
                "waybill_no", "route_status", "priority", "order_type", "so_no"];
  const fields = [], vals = [];
  for (const k of cols) if (k in d) { fields.push(`${k}=?`); vals.push(String(d[k])); }
  if (!fields.length) return json(res, 400, { error: "no fields" });
  if (d.status in STATUS_TS) fields.push(`${STATUS_TS[d.status]}=datetime('now','localtime')`);
  db.prepare(`UPDATE orders SET ${fields.join(", ")} WHERE id=?`).run(...vals, id);
  const row = db.prepare("SELECT * FROM orders WHERE id=?").get(id);
  row ? json(res, 200, rowToJson(row)) : json(res, 404, { error: "not found" });
}

function stats(res) {
  const r = db.prepare(
    "SELECT" +
    " (SELECT COUNT(*) FROM orders WHERE status='shipped'" +
    "   AND date(shipped_at)=date('now','localtime','-1 day')) AS yesterday_shipped," +
    " (SELECT COUNT(*) FROM orders WHERE status='pending'" +
    "   AND ship_date=date('now','localtime')) AS today_pending," +
    " (SELECT COUNT(*) FROM orders WHERE status='pending'" +
    "   AND ship_date<>'' AND ship_date<date('now','localtime')) AS overdue," +
    " (SELECT COUNT(*) FROM orders WHERE status='pending'" +
    "   AND ship_date>date('now','localtime')) AS planned," +
    " (SELECT COUNT(*) FROM orders WHERE status='returned'" +
    "   AND date(returned_at)=date('now','localtime')) AS returned"
  ).get();
  json(res, 200, r);
}

/* ---------- 路由 ---------- */
http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    return res.end();
  }
  const m = p.match(/\/api\/orders\/(\d+)$/);
  if (req.method === "GET" && /\/api\/orders$/.test(p)) return listOrders(u, res);
  if (req.method === "GET" && /\/api\/stats$/.test(p)) return stats(res);
  if (req.method === "POST" && /\/api\/orders$/.test(p)) return readBody(req, d => createOrder(d, res));
  if (m && req.method === "PUT") return readBody(req, d => updateOrder(+m[1], d, res));
  if (m && req.method === "DELETE") {
    const r = db.prepare("DELETE FROM orders WHERE id=?").run(+m[1]);
    return json(res, 200, { deleted: r.changes });
  }
  if (req.method === "GET") return serveStatic(p, res);
  json(res, 404, { error: "not found" });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`LNSC 发货全链系统 API 已启动: http://0.0.0.0:${PORT}/`);
});
