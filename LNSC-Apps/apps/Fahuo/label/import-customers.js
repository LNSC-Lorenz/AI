'use strict';
/* ==========================================================================
   客户基本数据库导入（2026-10-10）
   从 data/Customer Chinese.xlsx 读取「Customer No.（公司代码，7 位数字）+ CustomerName
   （中文名称）」重建 SQLite customers 表（2026-10-10 起不再映射 Ufida Cust. No.）。
   用法： node import-customers.js [xlsx路径] [db目录]
     默认： xlsx = ./data/Customer Chinese.xlsx   db = ./data/label.db（LABEL_DB_DIR 可改）
   说明： 整表替换（DELETE + INSERT 事务）；SheetJS 依次尝试
     ../BinVision/lib/xlsx.full.min.js（仓库内自带）→ npm 包 xlsx。
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let XLSX = null;
for (const p of [path.join(__dirname, '..', 'BinVision', 'lib', 'xlsx.full.min.js'), 'xlsx']) {
  try { XLSX = require(p); break; } catch (e) { /* 尝试下一个 */ }
}
if (!XLSX) { console.error('找不到 SheetJS（需要 ../BinVision/lib/xlsx.full.min.js 或 npm 包 xlsx）'); process.exit(1); }

const XLSX_PATH = process.argv[2] || path.join(__dirname, 'data', 'Customer Chinese.xlsx');
const DATA = process.argv[3] || process.env.LABEL_DB_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA, 'label.db');
if (!fs.existsSync(XLSX_PATH)) { console.error('xlsx 不存在: ' + XLSX_PATH); process.exit(1); }

const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
const head = rows[0].map(h => String(h).trim().toLowerCase());
const ciNo = head.findIndex(h => h === 'customer no.');
const ciName = head.findIndex(h => h === 'customername');
if (ciNo < 0 || ciName < 0) { console.error('表头缺少 Customer No. / CustomerName: ' + JSON.stringify(rows[0])); process.exit(1); }

/* 代码 → 记录（去重，后出现者覆盖；跳过空代码/空名称） */
const map = new Map();
let skipped = 0;
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const code = String(r[ciNo]).trim();
  const name = String(r[ciName]).trim();
  if (!code || !name) { skipped++; continue; }
  map.set(code, { code, name, kunnr: '', logo: '', contact: '' });
}
const list = Array.from(map.values());

fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS customers (code TEXT PRIMARY KEY, name TEXT, kunnr TEXT, logo TEXT, contact TEXT)`);
db.exec('BEGIN');
try {
  db.prepare('DELETE FROM customers').run();
  const ins = db.prepare('INSERT INTO customers (code, name, kunnr, logo, contact) VALUES (?, ?, ?, ?, ?)');
  for (const c of list) ins.run(c.code, c.name, c.kunnr, c.logo, c.contact);
  db.exec('COMMIT');
} catch (e) { db.exec('ROLLBACK'); throw e; }
const cnt = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
console.log(JSON.stringify({
  xlsx: XLSX_PATH, db: DB_PATH,
  rows: rows.length - 1, imported: list.length, skipped, inDb: cnt,
  has4101901: map.has('4101901'),
  sample: list.slice(0, 5).map(c => c.code + ' = ' + c.name)
}, null, 2));
db.close();