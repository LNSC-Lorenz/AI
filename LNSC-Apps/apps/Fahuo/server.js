#!/usr/bin/env node
/* LNSC 全链发货平台 - SQLite API 服务（Node 版，零依赖，需 Node >= 22.5 内置 node:sqlite）
 * 接口与 server.py 完全一致，供 Windows 本地开发/测试使用（服务器推荐 server.py）
 *
 * 用法：node server.js        默认端口 8091（PORT 环境变量可改）
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const BASE = __dirname;                              // Fahuo/（server.js 位置不变）
const WEB_ROOT = BASE;                               // 静态页面根（pages/ shared/ index.html 同目录）
const UPLOAD_DIR = path.join(BASE, "Upload");   // 上传文件根目录（按 DN 建子文件夹）
const PORT = parseInt(process.env.PORT || "8091", 10);

const OID_SEQ = path.join(BASE, "oid.seq");
/* 承运商客户单号：文件持久自增（DB 清空/重建也不复用——
   数据库自增 id 会在清库后重复，撞顺丰 orderId 幂等返回旧运单） */
function nextOid() {
  let n = 0;
  try { n = parseInt(fs.readFileSync(OID_SEQ, "ascii").trim() || "0", 10) || 0; } catch (_) { /* 首次 */ }
  n += 1;
  try { fs.writeFileSync(OID_SEQ, String(n)); } catch (_) { /* 写失败不阻断 */ }
  return String(n);
}

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
`);

/* 旧库迁移：补充运单号 / 路由状态列 */
{
  const cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
  if (!cols.includes("waybill_no")) db.exec("ALTER TABLE orders ADD COLUMN waybill_no TEXT DEFAULT ''");
  if (!cols.includes("route_status")) db.exec("ALTER TABLE orders ADD COLUMN route_status TEXT DEFAULT ''");
  if (!cols.includes("priority")) db.exec("ALTER TABLE orders ADD COLUMN priority TEXT DEFAULT '一般'");
  if (!cols.includes("order_type")) db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT '发货单'");
  if (!cols.includes("so_no")) db.exec("ALTER TABLE orders ADD COLUMN so_no TEXT DEFAULT ''");
  if (!cols.includes("order_resp")) db.exec("ALTER TABLE orders ADD COLUMN order_resp TEXT DEFAULT ''");  /* 下单返回值原文（追溯第一步展示） */
  /* PO/采购员/发件人：独立列（原塞在 note 标签里；备注列只存手写备注） */
  for (const col of ["po", "buyer", "emp_name", "emp_phone"]) {
    if (!cols.includes(col)) db.exec(`ALTER TABLE orders ADD COLUMN ${col} TEXT DEFAULT ''`);
  }
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
  let file = path.join(WEB_ROOT, p === "/" ? "index.html" : decodeURIComponent(p));
  if (!file.startsWith(WEB_ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end("Not Found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}

/* ---------- 业务 ---------- */
/* 共享地址池：GET 列表（最新在前） / POST 入池（addr_key 去重） */
function addrpoolList(res) {
  const rows = db.prepare(
    "SELECT province,city,district,street,name,phone FROM addr_pool ORDER BY id DESC LIMIT 500").all();
  json(res, 200, rows);
}
function addrpoolAdd(d, res) {
  const key = [d.province, d.city, d.district, d.street].filter(Boolean).join(" ");
  if (!key) return json(res, 400, { error: "地址为空" });
  const r = db.prepare(
    "INSERT OR IGNORE INTO addr_pool (province,city,district,street,name,phone,addr_key)" +
    " VALUES (?,?,?,?,?,?,?)"
  ).run(d.province || "", d.city || "", d.district || "", d.street || "",
        d.name || "", d.phone || "", key);
  json(res, 201, { added: r.changes });
}

/* 承运商下单/轨迹：正式模式——经 python 子进程调 carriers/ 包（与生产 server.py 内嵌同一套代码）
   专车/自提为厂内单号（非模拟，业务流程即如此）；无任何 mock 数据 */
function carrierOrder(d, res) {
  const carrier = (d.carrier || "").trim();
  const dn = String(d.so || "").replace(/[^\w-]/g, "").slice(0, 32);
  if (carrier === "专车" || carrier === "自提") {
    return json(res, 200, {
      waybill_no: (carrier === "专车" ? "ZC" : "ZT") + dn + (carrier === "专车" ? "01" : "02"),
      route_status: carrier === "专车" ? "专车直送" : "待自提", mock: true
    });
  }
  if (!carrier) return json(res, 400, { error: "carrier 必填" });
  const script = path.join(BASE, "carriers", "cli.py");
  const payload = JSON.stringify({ ...d, carrier, so: dn, oid: nextOid() });   /* oid 服务端统一分配（持久自增） */
  /* python3 → python → uv run --no-project 依次探测运行环境 */
  const tries = [["python3", [script, "order", payload]],
                 ["python", [script, "order", payload]],
                 ["uv", ["run", "--no-project", script, "order", payload]]];
  const attempt = idx => {
    if (idx >= tries.length) {
      return json(res, 500, { error: "无法调用承运商接口：服务器未找到 python3/uv 运行环境" });
    }
    const [cmd, args] = tries[idx];
    const cp = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", c => out += c);
    cp.stderr.on("data", c => err += c);
    cp.on("error", () => attempt(idx + 1));
    cp.on("close", code => {
      let j = null;
      try { j = JSON.parse(out.trim()); } catch (_) { /* 非 JSON = 运行环境异常，换下一个 */ }
      if (!j) return attempt(idx + 1);
      if (code !== 0 || j.error) return json(res, 400, { error: j.error || ("下单失败 exit " + code) });
      if (!j.waybill_no) return json(res, 502, { error: "承运商下单成功判定失败：响应中无运单号" });
      json(res, 200, j);
    });
  };
  attempt(0);
}
/* 官方面单：GET /api/carrier/label?carrier=&waybill_no= → 子进程取 PDF base64 */
function carrierLabel(u, res) {
  const carrier = (u.searchParams.get("carrier") || "").trim();
  const waybill = (u.searchParams.get("waybill_no") || "").replace(/[^\w-]/g, "").slice(0, 40);
  if (!carrier || !waybill) return json(res, 400, { error: "carrier 和 waybill_no 必填" });
  const script = path.join(BASE, "carriers", "cli.py");
  const tries = [["python3", [script, "label", carrier, waybill]],
                 ["python", [script, "label", carrier, waybill]],
                 ["uv", ["run", "--no-project", script, "label", carrier, waybill]]];
  const attempt = idx => {
    if (idx >= tries.length) {
      return json(res, 500, { error: "无法调用官方面单：服务器未找到 python3/uv 运行环境" });
    }
    const [cmd, args] = tries[idx];
    const cp = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", c => out += c);
    cp.stderr.on("data", c => err += c);
    cp.on("error", () => attempt(idx + 1));
    cp.on("close", code => {
      let j = null;
      try { j = JSON.parse(out.trim()); } catch (_) { /* 非 JSON = 运行环境异常，换下一个 */ }
      if (!j) return attempt(idx + 1);
      if (code !== 0 || j.error) return json(res, 400, { error: j.error || ("面单获取失败 exit " + code) });
      if (u.searchParams.get("raw") === "1") {   /* 原始 PDF 输出（iframe 同源直显，避开 blob 拦截） */
        if (!j.pdf) return json(res, 404, { error: "无 PDF" });
        const buf = Buffer.from(j.pdf, "base64");
        res.writeHead(200, { "Content-Type": "application/pdf", "Content-Length": buf.length });
        return res.end(buf);
      }
      json(res, 200, j);
    });
  };
  attempt(0);
}

function carrierRoute(u, res) {
  const carrier = (u.searchParams.get("carrier") || "").trim();
  const waybill = (u.searchParams.get("waybill_no") || "").replace(/[^\w-]/g, "").slice(0, 40);
  if (!carrier || !waybill) return json(res, 400, { error: "carrier 和 waybill_no 必填" });
  const script = path.join(BASE, "carriers", "cli.py");
  const tries = [["python3", [script, "route", carrier, waybill]],
                 ["python", [script, "route", carrier, waybill]],
                 ["uv", ["run", "--no-project", script, "route", carrier, waybill]]];
  const attempt = idx => {
    if (idx >= tries.length) {
      return json(res, 500, { error: "无法调用轨迹查询：服务器未找到 python3/uv 运行环境" });
    }
    const [cmd, args] = tries[idx];
    const cp = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    cp.stdout.on("data", c => out += c);
    cp.stderr.on("data", c => err += c);
    cp.on("error", () => attempt(idx + 1));
    cp.on("close", code => {
      let j = null;
      try { j = JSON.parse(out.trim()); } catch (_) { /* 非 JSON = 运行环境异常，换下一个 */ }
      if (!j) return attempt(idx + 1);
      if (code !== 0 || j.error) return json(res, 400, { error: j.error || ("查询失败 exit " + code) });
      json(res, 200, j);
    });
  };
  attempt(0);
}

/* GET /api/upload?dn=<DN> → { dn, files:[...] }（无目录时 files=[]） */
function listUpload(u, res) {
  const dn = (u.searchParams.get("dn") || "").replace(/[^\w-]/g, "").slice(0, 32);
  const folder = path.join(UPLOAD_DIR, dn);
  const files = (dn && fs.existsSync(folder)) ? fs.readdirSync(folder).sort() : [];
  json(res, 200, { dn, files });
}

/* DELETE /api/upload?dn=<DN>&name=<文件名> → 删除文件；目录空了顺带移除 */
function deleteUpload(u, res) {
  const dn = (u.searchParams.get("dn") || "").replace(/[^\w-]/g, "").slice(0, 32);
  const name = path.basename((u.searchParams.get("name") || "").replace(/\\/g, "/")).trim();
  if (!dn || !name) return json(res, 400, { error: "dn 和 name 必填" });
  const fp = path.join(UPLOAD_DIR, dn, name);
  if (!fs.existsSync(fp)) return json(res, 404, { error: "文件不存在" });
  fs.unlinkSync(fp);
  const folder = path.join(UPLOAD_DIR, dn);
  if (fs.existsSync(folder) && !fs.readdirSync(folder).length) fs.rmdirSync(folder);
  json(res, 200, { ok: true, deleted: name });
}

/* POST /api/upload?dn=<DN>&name=<文件名>（body=原始文件字节）→ Upload/<DN>/<文件名> */
function uploadFile(u, req, res) {
  const dn = (u.searchParams.get("dn") || "").replace(/[^\w-]/g, "").slice(0, 32);
  const name = path.basename((u.searchParams.get("name") || "").replace(/\\/g, "/")).trim();
  if (!dn || !name) return json(res, 400, { error: "dn 和 name 必填" });
  const len = parseInt(req.headers["content-length"] || "0", 10);
  if (!len) return json(res, 400, { error: "空文件" });
  if (len > 50 * 1024 * 1024) return json(res, 413, { error: "文件过大（>50MB）" });
  const folder = path.join(UPLOAD_DIR, dn);
  fs.mkdirSync(folder, { recursive: true });
  const ws = fs.createWriteStream(path.join(folder, name));
  req.pipe(ws);
  ws.on("finish", () => json(res, 201, { ok: true, path: `Upload/${dn}/${name}`, size: len }));
  ws.on("error", e => json(res, 500, { error: String(e) }));
}

function listOrders(u, res) {
  const day = u.searchParams.get("date") || "";
  const rows = day
    ? db.prepare("SELECT * FROM orders WHERE ship_date=? ORDER BY id DESC").all(day)
    : db.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all(); /* 默认全部 */
  json(res, 200, rows.map(rowToJson));
}

function createOrder(d, res) {
  const r = db.prepare(
    "INSERT INTO orders (so,province,city,district,street,name,phone,carrier,note,ship_date,priority,order_type,so_no,po,buyer,emp_name,emp_phone)" +
    " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(d.so || "", d.province || "", d.city || "", d.district || "", d.street || "",
        d.name || "", d.phone || "", d.carrier || "", d.note || "", d.ship_date || "",
        d.priority || "一般", d.order_type || "发货单", d.so_no || "",
        d.po || "", d.buyer || "", d.emp_name || "", d.emp_phone || "");
  json(res, 201, rowToJson(db.prepare("SELECT * FROM orders WHERE id=?").get(r.lastInsertRowid)));
}

function updateOrder(id, d, res) {
  const cols = ["so", "province", "city", "district", "street", "name",
                "phone", "carrier", "note", "ship_date", "status",
                "waybill_no", "route_status", "priority", "order_type", "so_no",
                "order_resp", "po", "buyer", "emp_name", "emp_phone"];
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
  if (req.method === "GET" && /\/api\/upload$/.test(p)) return listUpload(u, res);
  if (req.method === "GET" && /\/api\/carrier\/route$/.test(p)) return carrierRoute(u, res);
  if (req.method === "GET" && /\/api\/carrier\/label$/.test(p)) return carrierLabel(u, res);
  if (req.method === "GET" && /\/api\/addrpool$/.test(p)) return addrpoolList(res);
  if (req.method === "POST" && /\/api\/orders$/.test(p)) return readBody(req, d => createOrder(d, res));
  if (req.method === "POST" && /\/api\/upload$/.test(p)) return uploadFile(u, req, res);
  if (req.method === "POST" && /\/api\/carrier\/order$/.test(p)) return readBody(req, d => carrierOrder(d, res));
  if (req.method === "POST" && /\/api\/admin\/clear-orders$/.test(p)) {
    const r = db.prepare("DELETE FROM orders").run();   /* 设置页「清除模拟数据」 */
    return json(res, 200, { deleted: r.changes });
  }
  if (req.method === "POST" && /\/api\/addrpool$/.test(p)) return readBody(req, d => addrpoolAdd(d, res));
  if (m && req.method === "PUT") return readBody(req, d => updateOrder(+m[1], d, res));
  if (m && req.method === "DELETE") {
    const r = db.prepare("DELETE FROM orders WHERE id=?").run(+m[1]);
    return json(res, 200, { deleted: r.changes });
  }
  if (req.method === "DELETE" && /\/api\/upload$/.test(p)) return deleteUpload(u, res);
  if (req.method === "GET") return serveStatic(p, res);
  json(res, 404, { error: "not found" });
}).listen(PORT, "0.0.0.0", () => {
  console.log(`LNSC 全链发货平台 API 已启动: http://0.0.0.0:${PORT}/`);
});
