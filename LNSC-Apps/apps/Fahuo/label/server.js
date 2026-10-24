'use strict';
/* ==========================================================================
   Label 应用后端（零依赖，Node ≥22.5 的 node:sqlite；22.13+ 免 flag）
   · 静态托管本目录前端文件（白名单后缀；data/ 与 server.js 不对外）
   · REST API：GET /api/health、GET /api/db、PUT /api/db（整库读写，事务写入）
   · SQLite 单文件：./data/label.db（环境变量 LABEL_DB_DIR 可改数据目录）；
     每天首次写入自动备份到 ./data/backup/label-YYYYMMDD.db（保留最近 7 份）
   用法： node server.js [port]        默认 8092
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = +(process.argv[2] || process.env.PORT || 8092);
const ROOT = __dirname;
const DATA = process.env.LABEL_DB_DIR || path.join(ROOT, 'data');
const BAK = path.join(DATA, 'backup');
fs.mkdirSync(BAK, { recursive: true });

const db = new DatabaseSync(path.join(DATA, 'label.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS templates (code TEXT PRIMARY KEY, name TEXT, version INTEGER, status TEXT,
  width REAL, height REAL, unit TEXT, customer TEXT, updated TEXT, elements TEXT);
CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, cond TEXT, template TEXT, copies TEXT, printer TEXT, active INTEGER);
CREATE TABLE IF NOT EXISTS fields (code TEXT PRIMARY KEY, label TEXT, sap TEXT, type TEXT);
CREATE TABLE IF NOT EXISTS customers (code TEXT PRIMARY KEY, name TEXT, kunnr TEXT, logo TEXT, contact TEXT);
CREATE TABLE IF NOT EXISTS deliveries (dn TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS history (jobid TEXT PRIMARY KEY, dn TEXT, customer TEXT, template TEXT,
  ver INTEGER, printer TEXT, copies INTEGER, user TEXT, time TEXT, status TEXT, manual TEXT);
`);

/* ---------- 整库读取：组装成与前端 loadDB() 同构的 JSON ---------- */
function readDB() {
  const meta = {};
  for (const r of db.prepare('SELECT key, value FROM meta').all()) {
    try { meta[r.key] = JSON.parse(r.value); } catch (e) { meta[r.key] = r.value; }
  }
  const out = {
    meta,
    templates: db.prepare('SELECT * FROM templates').all().map(t => Object.assign({}, t, { elements: JSON.parse(t.elements || '[]') })),
    rules: db.prepare('SELECT * FROM rules').all().map(r => Object.assign({}, r, { active: !!r.active })),
    fields: db.prepare('SELECT * FROM fields').all(),
    customers: db.prepare('SELECT * FROM customers').all(),
    deliveries: {},
    history: db.prepare('SELECT * FROM history').all().map(h => Object.assign({}, h, { manual: JSON.parse(h.manual || '{}') }))
  };
  for (const d of db.prepare('SELECT dn, data FROM deliveries').all()) {
    try { out.deliveries[d.dn] = JSON.parse(d.data); } catch (e) { /* 跳过坏行 */ }
  }
  if (meta.seedVersion == null && out.templates.length === 0) out.__empty = true;   // 空库：等前端播种
  return out;
}

/* ---------- 整库写入：事务内逐表清写（payload 缺省的分表保持不变） ---------- */
function writeDB(data) {
  db.exec('BEGIN');
  try {
    if (data.meta && typeof data.meta === 'object') {
      db.prepare('DELETE FROM meta').run();
      const ins = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
      for (const k of Object.keys(data.meta)) ins.run(k, JSON.stringify(data.meta[k]));
    }
    if (Array.isArray(data.templates)) {
      db.prepare('DELETE FROM templates').run();
      const ins = db.prepare('INSERT INTO templates (code,name,version,status,width,height,unit,customer,updated,elements) VALUES (?,?,?,?,?,?,?,?,?,?)');
      for (const t of data.templates) {
        if (!t || !t.code) continue;
        ins.run(t.code, t.name || '', t.version || 1, t.status || 'draft', t.width || 0, t.height || 0,
          t.unit || 'mm', t.customer || '', t.updated || '', JSON.stringify(t.elements || []));
      }
    }
    if (Array.isArray(data.rules)) {
      db.prepare('DELETE FROM rules').run();
      const ins = db.prepare('INSERT INTO rules (id,cond,template,copies,printer,active) VALUES (?,?,?,?,?,?)');
      for (const r of data.rules) { if (!r || !r.id) continue; ins.run(r.id, r.cond || '', r.template || '', String(r.copies || '1'), r.printer || '', r.active ? 1 : 0); }
    }
    if (Array.isArray(data.fields)) {
      db.prepare('DELETE FROM fields').run();
      const ins = db.prepare('INSERT INTO fields (code,label,sap,type) VALUES (?,?,?,?)');
      for (const f of data.fields) { if (!f || !f.code) continue; ins.run(f.code, f.label || '', f.sap || '', f.type || 'SAP'); }
    }
    if (Array.isArray(data.customers)) {
      db.prepare('DELETE FROM customers').run();
      const ins = db.prepare('INSERT INTO customers (code,name,kunnr,logo,contact) VALUES (?,?,?,?,?)');
      for (const c of data.customers) { if (!c || !c.code) continue; ins.run(c.code, c.name || '', c.kunnr || '', c.logo || '', c.contact || ''); }
    }
    if (data.deliveries && typeof data.deliveries === 'object') {
      db.prepare('DELETE FROM deliveries').run();
      const ins = db.prepare('INSERT INTO deliveries (dn, data) VALUES (?, ?)');
      for (const dn of Object.keys(data.deliveries)) ins.run(dn, JSON.stringify(data.deliveries[dn] || {}));
    }
    if (Array.isArray(data.history)) {
      db.prepare('DELETE FROM history').run();
      const ins = db.prepare('INSERT INTO history (jobid,dn,customer,template,ver,printer,copies,user,time,status,manual) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      for (const h of data.history) {
        if (!h || !h.jobid) continue;
        ins.run(h.jobid, h.dn || '', h.customer || '', h.template || '', h.ver || 1, h.printer || '',
          h.copies || 1, h.user || '', h.time || '', h.status || '', JSON.stringify(h.manual || {}));
      }
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- 每日备份（每天首次写入时复制一份，保留最近 7 份） ---------- */
let _bakDay = '';
function backup() {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  if (_bakDay === day) return;
  _bakDay = day;
  try {
    fs.copyFileSync(path.join(DATA, 'label.db'), path.join(BAK, 'label-' + day + '.db'));
    const all = fs.readdirSync(BAK).filter(f => /^label-\d{8}\.db$/.test(f)).sort();
    while (all.length > 7) fs.unlinkSync(path.join(BAK, all.shift()));
  } catch (e) { /* 备份失败不影响主流程 */ }
}

/* ---------- HTTP：/api/* + 静态托管 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8'
};
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};
function send(res, code, body, headers) {
  res.writeHead(code, Object.assign({}, CORS, headers || {}));
  res.end(body);
}
function sendJSON(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (u.pathname === '/api/health' && req.method === 'GET') {
    const cnt = t => db.prepare('SELECT COUNT(*) AS n FROM ' + t).get().n;
    return sendJSON(res, 200, { ok: true, engine: 'sqlite', port: PORT, templates: cnt('templates'), customers: cnt('customers'), history: cnt('history') });
  }
  if (u.pathname === '/api/db' && req.method === 'GET') return sendJSON(res, 200, readDB());
  if (u.pathname === '/api/db' && req.method === 'PUT') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 20e6) req.destroy(); });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        backup();
        writeDB(data);
        sendJSON(res, 200, { ok: true });
      } catch (e) { sendJSON(res, 400, { ok: false, error: String((e && e.message) || e) }); }
    });
    return;
  }
  if (u.pathname.indexOf('/api/') === 0) return sendJSON(res, 404, { ok: false, error: 'unknown api' });
  if (req.method !== 'GET') return send(res, 405, 'Method Not Allowed');

  /* 静态文件：白名单后缀；禁止 .. / 反斜杠 / 隐藏文件 / data 目录 / server.js 本体 */
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  if (p.indexOf('..') >= 0 || p.indexOf('\\') >= 0) return send(res, 403, 'Forbidden');
  const rel = p.replace(/^\/+/, '');
  if (rel === 'server.js' || rel.indexOf('data/') === 0 || rel.split('/').some(s => s.charAt(0) === '.')) return send(res, 404, 'Not Found');
  const ext = path.extname(rel).toLowerCase();
  if (!MIME[ext]) return send(res, 404, 'Not Found');
  fs.readFile(path.join(ROOT, rel), (err, buf) => {
    if (err) return send(res, 404, 'Not Found');
    send(res, 200, buf, { 'Content-Type': MIME[ext] });
  });
});
server.listen(PORT, () => {
  console.log('[label] SQLite 后端已启动: http://localhost:' + PORT + '  (DB: ' + path.join(DATA, 'label.db') + ')');
});