/* ==========================================================================
   SAP Label Management Platform — 共享内核 (label-core.js)
   常量 / 通用工具 / 演示数据(SEED) / localStorage 存储 / 标签渲染引擎
   由 index.html (script.js) 与 designer.html (designer.js) 共同引入，
   保证「主应用」与「独立设计器」使用同一套数据与渲染结果。
   —— 纯静态、无框架、无构建，可被 nginx 直接托管。
   ========================================================================== */
'use strict';

/* ---------- 常量 ---------- */
const PXPERMM = 3.78;                 // 屏幕比例：1mm -> 3.78px
const STORE_KEY = 'label_db_v1';      // 主应用与独立设计器共享同一份本地数据

/* ---------- 通用工具 ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 8);
const clone = (o) => JSON.parse(JSON.stringify(o));

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function nowStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------- 标签元素解析 ---------- */
function resolveValue(el, data) {
  data = data || {};
  if (el.type === 'text') return el.text || '';
  const src = el.source || 'sap';
  if (src === 'static') return el.value != null ? el.value : '';
  const v = data[el.field];
  if (v !== undefined && v !== null && v !== '') return v;
  return '{{' + (el.field || '') + '}}';
}

/* 创建一个标签元素 DOM（用于设计器 & 预览） */
/* 创建一个标签元素 DOM（用于设计器 & 预览）
   扩展属性：el.src（真实图片，如 Lechler 组合标志）、el.rotate（旋转角度，绕中心）、
   el.borderWidth（rectangle 边框厚度 px） */
function createEl(el, scale, data) {
  const d = document.createElement('div');
  d.className = 'el';
  d.dataset.id = el.id;
  d.style.left = (el.x * scale) + 'px';
  d.style.top = (el.y * scale) + 'px';
  d.style.width = (el.width * scale) + 'px';
  d.style.height = (el.height * scale) + 'px';
  const t = el.type;
  if (t === 'line') { d.classList.add('el-line'); }
  else if (t === 'rectangle') {
    d.classList.add('el-rect');
    if (el.borderWidth) d.style.borderWidth = el.borderWidth + 'px';
  }
  else if (t === 'barcode') { d.classList.add('el-barcode'); }
  else if (t === 'qrcode') { d.classList.add('el-qr'); }
  else if (t === 'image' || t === 'customer_logo') {
    if (el.src) {
      d.classList.add('el-img');
      const img = document.createElement('img');
      img.src = el.src; img.alt = ''; img.draggable = false;
      d.appendChild(img);
    } else {
      d.classList.add('el-image');
      d.textContent = (t === 'customer_logo' || el.source === 'customer') ? '客户 LOGO' : 'LOGO';
    }
  } else {
    d.classList.add('el-text');
    d.textContent = resolveValue(el, data);
    d.style.fontSize = Math.max(6, Math.round((el.fontSize || 4) * scale * 0.35)) + 'px';
    if (el.align) d.style.textAlign = el.align;
  }
  if (el.rotate) d.style.transform = 'rotate(' + el.rotate + 'deg)';
  return d;
}

/* 构建整张标签 */
function buildLabel(tpl, data, scale) {
  const c = document.createElement('div');
  c.className = 'canvas';
  c.style.width = (tpl.width * scale) + 'px';
  c.style.height = (tpl.height * scale) + 'px';
  tpl.elements.forEach(el => c.appendChild(createEl(el, scale, data)));
  return c;
}

/* ---------- 演示数据（localStorage 持久化） ---------- */
const SEED = {
  meta: { currentUser: 'zhangwei', role: 'OPERATOR', env: 'DEMO', seedVersion: 3 },
  templates: [
    {
      code: 'ABC_PRODUCT', name: 'ABC 产品标签', version: 3, status: 'published',
      width: 100, height: 60, unit: 'mm', customer: 'ABC', updated: '2026-09-28 10:12',
      elements: [
        { id: 'frame', type: 'rectangle', x: 1.5, y: 1.5, width: 97, height: 57, borderWidth: 2 },
        { id: 'logo', type: 'image', src: 'lechler-c-logo-combination-mark-black-00.png', x: 70.5, y: 27, width: 45, height: 6, rotate: -90 },
        { id: 'material', type: 'field', source: 'sap', field: 'MATNR', label: '物料编码', x: 5, y: 6, width: 62, height: 7, fontSize: 12 },
        { id: 'desc', type: 'field', source: 'sap', field: 'MAKTX', label: '物料描述', x: 5, y: 15, width: 82, height: 6, fontSize: 10 },
        { id: 'batch', type: 'field', source: 'sap', field: 'CHARG', label: '批次', x: 5, y: 24, width: 45, height: 6, fontSize: 10 },
        { id: 'qty', type: 'field', source: 'sap', field: 'LFIMG', label: '数量', x: 52, y: 24, width: 34, height: 6, fontSize: 10 },
        { id: 'custmat', type: 'field', source: 'manual', field: 'CUST_MATNR', label: '客户料号', required: true, x: 5, y: 33, width: 60, height: 7, fontSize: 11 },
        { id: 'qr', type: 'qrcode', x: 68, y: 36, width: 20, height: 20, value: '{{MATNR}}|{{CHARG}}' }
      ]
    },
    {
      code: 'DEFAULT', name: '通用标签', version: 1, status: 'published',
      width: 100, height: 60, unit: 'mm', customer: '', updated: '2026-09-20 09:00',
      elements: [
        { id: 'frame', type: 'rectangle', x: 1.5, y: 1.5, width: 97, height: 57, borderWidth: 2 },
        { id: 'logo', type: 'image', src: 'lechler-c-logo-combination-mark-black-00.png', x: 70.5, y: 27, width: 45, height: 6, rotate: -90 },
        { id: 'material', type: 'field', source: 'sap', field: 'MATNR', label: '物料编码', x: 5, y: 8, width: 62, height: 7, fontSize: 12 },
        { id: 'batch', type: 'field', source: 'sap', field: 'CHARG', label: '批次', x: 5, y: 20, width: 50, height: 6, fontSize: 10 },
        { id: 'custmat', type: 'field', source: 'manual', field: 'CUST_MATNR', label: '客户料号', required: true, x: 5, y: 32, width: 60, height: 7, fontSize: 11 },
        { id: 'qr', type: 'qrcode', x: 66, y: 34, width: 22, height: 22, value: '{{MATNR}}' }
      ]
    }
  ],
  customers: [
    { code: 'ABC', name: 'ABC GmbH', kunnr: '0001000234', logo: 'abc.png', contact: 'Mr. Weber' },
    { code: 'XYZ', name: 'XYZ AG', kunnr: '0001000567', logo: 'xyz.png', contact: 'Ms. Klein' },
    { code: 'DEF', name: 'DEF GmbH', kunnr: '0001000891', logo: 'def.png', contact: 'Mr. Braun' },
    { code: 'LEC', name: 'Lechler GmbH', kunnr: '0001000001', logo: 'lechler.png', contact: '-——' }
  ],
  printers: [
    { name: 'WH-A-01', model: 'TSC TTP-244 Pro', proto: 'Network', addr: '10.86.180.20', location: '仓库 A / 出货口', status: 'online' },
    { name: 'WH-A-02', model: 'Zebra ZT411', proto: 'RAW TCP', addr: '10.86.180.21', location: '仓库 A / 备机', status: 'online' },
    { name: 'LINE-B-01', model: 'TSC TE200', proto: 'Windows Driver', addr: 'CLIENT-PC-07', location: '产线 B', status: 'offline' }
  ],
  rules: [
    { id: 'R1', cond: 'Customer = ABC', template: 'ABC_PRODUCT', copies: 'CEILING(LFIMG / 50)', printer: 'WH-A-01', active: true },
    { id: 'R2', cond: 'Customer = XYZ', template: 'DEFAULT', copies: '1', printer: 'WH-A-02', active: true },
    { id: 'R3', cond: 'Default', template: 'DEFAULT', copies: 'CEILING(LFIMG / 50)', printer: 'WH-A-01', active: true }
  ],
  fields: [
    { code: 'MATNR', label: '物料编码', sap: 'MARAV-MATNR', type: 'SAP' },
    { code: 'MAKTX', label: '物料描述', sap: 'MAKT-MAKTX', type: 'SAP' },
    { code: 'CHARG', label: '批次', sap: 'LIPS-CHARG', type: 'SAP' },
    { code: 'LFIMG', label: '数量', sap: 'LIPS-LFIMG', type: 'SAP' },
    { code: 'WERKS', label: '工厂', sap: 'LIPS-WERKS', type: 'SAP' },
    { code: 'LGORT', label: '库存地点', sap: 'LIPS-LGORT', type: 'SAP' },
    { code: 'BSTKD', label: '客户 PO', sap: 'VBKD-BSTKD', type: 'SAP' },
    { code: 'CUST_MATNR', label: '客户料号', sap: '-', type: 'MANUAL' }
  ],
  deliveries: {
    '8000123456': { customer: 'ABC', customerName: 'ABC GmbH', MATNR: '10001234', MAKTX: 'PVC RESIN SG-5', CHARG: '26093001', LFIMG: 500, WERKS: '1000', LGORT: '0001', BSTKD: 'PO-99881', unit: 'KG' },
    '8000654321': { customer: '', customerName: '', MATNR: '10009999', MAKTX: '添加剂 A-22', CHARG: '26093120', LFIMG: 250, WERKS: '1000', LGORT: '0002', BSTKD: '', unit: 'KG' },
    '8000777000': { customer: 'XYZ', customerName: 'XYZ AG', MATNR: '10005678', MAKTX: 'PUMP NOZZLE 1/4', CHARG: '26091200', LFIMG: 120, WERKS: '1000', LGORT: '0001', BSTKD: 'PO-55210', unit: 'PCS' }
  },
  history: [
    { jobid: 'J20260930-0007', dn: '8000111000', customer: 'ABC GmbH', template: 'ABC_PRODUCT', ver: 3, printer: 'WH-A-01', copies: 10, user: 'zhangwei', time: '2026-09-30 14:02:11', status: 'SUCCESS', manual: { CUST_MATNR: 'PX-7788' } },
    { jobid: 'J20260930-0006', dn: '8000110998', customer: '-', template: 'DEFAULT', ver: 1, printer: 'WH-A-01', copies: 5, user: 'zhangwei', time: '2026-09-30 13:41:52', status: 'SUCCESS', manual: { CUST_MATNR: 'ZZ-1024' } }
  ]
};

/* ---------- 存储（localStorage 持久化，主应用与设计器共享） ----------
   seedVersion 自动迁移：缓存数据的 seedVersion 低于 SEED 时，
   用 SEED 的内置模板（ABC_PRODUCT / DEFAULT）覆盖同名模板（→ 新默认版式立即生效），
   用户自建模板（SEED 中不存在的 code）与 meta.currentUser / role 原样保留。 */
function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      if (db && db.meta && (db.meta.seedVersion || 0) >= SEED.meta.seedVersion) return db;
      const fresh = clone(SEED);
      const builtin = fresh.templates.map(t => t.code);
      (db.templates || []).forEach(t => { if (t && builtin.indexOf(t.code) < 0) fresh.templates.push(t); });
      if (db.meta) {
        fresh.meta.currentUser = db.meta.currentUser || fresh.meta.currentUser;
        fresh.meta.role = db.meta.role || fresh.meta.role;
      }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(fresh)); } catch (e) { /* ignore */ }
      return fresh;
    }
  } catch (e) { /* ignore */ }
  const d = clone(SEED);
  try { localStorage.setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { /* ignore */ }
  return d;
}
function saveDB() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { /* ignore */ }
}
function resetDB() { DB = clone(SEED); saveDB(); }
let DB = loadDB();

const tplByCode = (code) => DB.templates.find(t => t.code === code);

/* 计算打印份数：CEILING(LFIMG / n) */
function calcCopies(expr, data) {
  const m = /CEILING\(\s*LFIMG\s*\/\s*(\d+)\s*\)/i.exec(expr || '');
  if (m) { const n = +m[1]; return Math.max(1, Math.ceil((data.LFIMG || 0) / n)); }
  const c = parseInt(expr, 10);
  return isNaN(c) ? 1 : c;
}

/* 依据规则匹配模板 / 打印机 */
function matchRule(data) {
  const cust = data.customer || '';
  for (const r of DB.rules) {
    if (r.cond === 'Default') continue;
    const m = /Customer\s*=\s*(\w+)/i.exec(r.cond);
    if (m && m[1] === cust) return r;
  }
  return DB.rules.find(r => r.cond === 'Default') || DB.rules[0];
}

/* 设计器 / 预览用的示例数据 */
function sampleData() {
  return Object.assign(clone(DB.deliveries['8000123456'] || {}), {
    customer: 'ABC', customerName: 'ABC GmbH', CUST_MATNR: 'PX-7788'
  });
}