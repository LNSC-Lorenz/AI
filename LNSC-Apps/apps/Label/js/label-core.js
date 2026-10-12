/* ==========================================================================
   SAP Label Management Platform — 共享内核 (label-core.js)
   常量 / 通用工具 / 演示数据(SEED) / localStorage 存储 / 标签渲染引擎
   由 index.html (script.js) 与 designer.html (designer.js) 共同引入，
   保证「主应用」与「独立设计器」使用同一套数据与渲染结果。
   —— 纯静态、无框架、无构建，可被 nginx 直接托管。
   ========================================================================== */
'use strict';

/* ==========================================================================
   测试期访问口令（index.html 与 designer.html 共用；正式上线时删除本段即可）
   · 口令 1879：纯前端拦截，防误闯不防破解（:8092 API 本身未鉴权）
   · 验证通过写入 sessionStorage，当前标签页会话内免输；file:// 本地预览不拦
   ========================================================================== */
(function accessGate() {
  if (typeof location === 'undefined' || location.protocol.indexOf('http') !== 0) return;
  var FLAG = 'label_gate_v1';
  try { if (sessionStorage.getItem(FLAG) === 'ok') return; } catch (e) { /* 隐私模式读不到则继续弹窗 */ }
  var PASS = '1879';

  var st = document.createElement('style');
  st.textContent =
    '#label-gate{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
    'background:linear-gradient(160deg,#23272f 0%,#3a4048 100%);opacity:1;transition:opacity .25s;font-family:"Microsoft YaHei","Segoe UI",sans-serif}' +
    '#label-gate .lg-card{background:#fff;border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:34px 36px 28px;width:300px;text-align:center}' +
    '#label-gate .lg-logo{height:44px;max-width:100%;object-fit:contain;margin-bottom:14px}' +
    '#label-gate .lg-title{font-size:17px;font-weight:600;color:#23272f;letter-spacing:.5px}' +
    '#label-gate .lg-sub{font-size:12px;color:#8a919b;margin:6px 0 18px}' +
    '#label-gate input{box-sizing:border-box;width:100%;height:38px;padding:0 12px;font-size:15px;text-align:center;letter-spacing:3px;' +
    'border:1px solid #d5dae0;border-radius:6px;outline:none}' +
    '#label-gate input:focus{border-color:#c8102e;box-shadow:0 0 0 3px rgba(200,16,46,.12)}' +
    '#label-gate button{width:100%;height:38px;margin-top:12px;border:0;border-radius:6px;background:#c8102e;color:#fff;font-size:14px;cursor:pointer}' +
    '#label-gate button:hover{background:#a80d27}' +
    '#label-gate .lg-err{margin-top:10px;font-size:12px;color:#c8102e}' +
    '#label-gate .lg-shake{animation:lgshake .3s}' +
    '@keyframes lgshake{0%,100%{transform:translateX(0)}25%{transform:translateX(-7px)}75%{transform:translateX(7px)}}';
  document.head.appendChild(st);

  var box = document.createElement('div');
  box.id = 'label-gate';
  box.innerHTML =
    '<div class="lg-card">' +
    '<img class="lg-logo" src="assets/lechler-c-logo-combination-mark-black-00.png" alt="Lechler">' +
    '<div class="lg-title">SAP 标签管理平台</div>' +
    '<div class="lg-sub">测试环境 · 请输入访问口令</div>' +
    '<input id="lg-input" type="password" inputmode="numeric" autocomplete="off" placeholder="访问口令" maxlength="16">' +
    '<button id="lg-btn" type="button">进 入</button>' +
    '<div class="lg-err" id="lg-err" hidden>口令错误，请重试</div>' +
    '</div>';
  (document.body || document.documentElement).appendChild(box);

  var input = document.getElementById('lg-input');
  var err = document.getElementById('lg-err');
  function fail() {
    err.hidden = false;
    input.value = '';
    input.focus();
    var card = box.firstChild;
    card.classList.remove('lg-shake');
    void card.offsetWidth;               // 重启动画
    card.classList.add('lg-shake');
  }
  function ok() {
    try { sessionStorage.setItem(FLAG, 'ok'); } catch (e) { /* 写不进也只拦本次 */ }
    box.style.opacity = '0';
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 260);
  }
  function submit() { if (input.value === PASS) ok(); else fail(); }
  document.getElementById('lg-btn').onclick = submit;
  input.onkeydown = function (e) { if (e.key === 'Enter') submit(); };
  input.focus();
})();

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
  if (t === 'line') {
    d.classList.add('el-line');
    if (el.color) d.style.background = el.color;
    if ((el.height || 0) > 2) d.style.setProperty('height', (el.height * scale) + 'px', 'important'); // 竖线按真实高度（CSS 默认把线钉成 2px 细横线）
  }
  else if (t === 'rectangle') {
    d.classList.add('el-rect');
    if (el.borderWidth != null) d.style.borderWidth = el.borderWidth + 'px';
    if (el.color) d.style.borderColor = el.color;
    if (el.fill) d.style.background = el.fill;   // 实心色块（工业风标签 chip / 标题带）
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
    d.style.lineHeight = String(el.lineHeight || 1.15);   // 多行表头（中英双语）需在有限行高内容纳 2~3 行
    if (el.align) d.style.textAlign = el.align;
    if (el.color) d.style.color = el.color;
    if (el.bold) d.style.fontWeight = '700';
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
  meta: { currentUser: 'zhangwei', role: 'OPERATOR', env: 'DEMO', seedVersion: 7 },
  templates: [
    {
      code: 'ABC_PRODUCT', name: 'ABC 产品标签', version: 3, status: 'published',
      width: 100, height: 60, unit: 'mm', customer: '4101901', updated: '2026-09-28 10:12',
      elements: [
        { id: 'frame', type: 'rectangle', x: 1.5, y: 1.5, width: 97, height: 57, borderWidth: 2 },
        { id: 'logo', type: 'image', src: 'assets/lechler-c-logo-combination-mark-black-00.png', x: 70.5, y: 27, width: 45, height: 6, rotate: -90 },
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
        { id: 'logo', type: 'image', src: 'assets/lechler-c-logo-combination-mark-black-00.png', x: 70.5, y: 27, width: 45, height: 6, rotate: -90 },
        { id: 'material', type: 'field', source: 'sap', field: 'MATNR', label: '物料编码', x: 5, y: 8, width: 62, height: 7, fontSize: 12 },
        { id: 'batch', type: 'field', source: 'sap', field: 'CHARG', label: '批次', x: 5, y: 20, width: 50, height: 6, fontSize: 10 },
        { id: 'custmat', type: 'field', source: 'manual', field: 'CUST_MATNR', label: '客户料号', required: true, x: 5, y: 32, width: 60, height: 7, fontSize: 11 },
        { id: 'qr', type: 'qrcode', x: 66, y: 34, width: 22, height: 22, value: '{{MATNR}}' }
      ]
    }
  ],
  customers: [
    { code: '4101901', name: 'ABC GmbH', kunnr: '0001000234', logo: 'abc.png', contact: 'Mr. Weber' },
    { code: '4101902', name: 'XYZ AG', kunnr: '0001000567', logo: 'xyz.png', contact: 'Ms. Klein' },
    { code: 'DEF', name: 'DEF GmbH', kunnr: '0001000891', logo: 'def.png', contact: 'Mr. Braun' },
    { code: 'LEC', name: 'Lechler GmbH', kunnr: '0001000001', logo: 'lechler.png', contact: '-——' }
  ],
  printers: [
    { name: 'WH-A-01', model: 'TSC TTP-244 Pro', proto: 'Network', addr: '10.86.180.20', location: '仓库 A / 出货口', status: 'online' },
    { name: 'WH-A-02', model: 'Zebra ZT411', proto: 'RAW TCP', addr: '10.86.180.21', location: '仓库 A / 备机', status: 'online' },
    { name: 'LINE-B-01', model: 'TSC TE200', proto: 'Windows Driver', addr: 'CLIENT-PC-07', location: '产线 B', status: 'offline' }
  ],
  rules: [
    { id: 'R1', cond: 'Customer = 4101901', template: 'ABC_PRODUCT', copies: 'CEILING(LFIMG / 50)', printer: 'WH-A-01', active: true },
    { id: 'R2', cond: 'Customer = 4101902', template: 'DEFAULT', copies: '1', printer: 'WH-A-02', active: true },
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
    { code: 'KDMAT', label: '客户物料编码', sap: 'VBAP-KDMAT', type: 'SAP' },
    { code: 'VGBEL', label: '客户订单号', sap: 'LIPS-VGBEL', type: 'SAP' },
    { code: 'CUST_MATNR', label: '客户料号', sap: '-', type: 'MANUAL' }
  ],
  deliveries: {
    '8000123456': { customer: '4101901', customerName: 'ABC GmbH', MATNR: '10001234', MAKTX: 'PVC RESIN SG-5', CHARG: '26093001', LFIMG: 500, WERKS: '1000', LGORT: '0001', BSTKD: 'PO-99881', KDMAT: 'ABC-8842', VGBEL: '4500012345', unit: 'KG' },
    '8000654321': { customer: '', customerName: '', MATNR: '10009999', MAKTX: '添加剂 A-22', CHARG: '26093120', LFIMG: 250, WERKS: '1000', LGORT: '0002', BSTKD: '', unit: 'KG' },
    '8000777000': { customer: '4101902', customerName: 'XYZ AG', MATNR: '10005678', MAKTX: 'PUMP NOZZLE 1/4', CHARG: '26091200', LFIMG: 120, WERKS: '1000', LGORT: '0001', BSTKD: 'PO-55210', unit: 'PCS' }
  },
  history: [
    { jobid: 'J20260930-0007', dn: '8000111000', customer: 'ABC GmbH', template: 'ABC_PRODUCT', ver: 3, printer: 'WH-A-01', copies: 10, user: 'zhangwei', time: '2026-09-30 14:02:11', status: 'SUCCESS', manual: { CUST_MATNR: 'PX-7788' } },
    { jobid: 'J20260930-0006', dn: '8000110998', customer: '-', template: 'DEFAULT', ver: 1, printer: 'WH-A-01', copies: 5, user: 'zhangwei', time: '2026-09-30 13:41:52', status: 'SUCCESS', manual: { CUST_MATNR: 'ZZ-1024' } }
  ]
};

/* ---------- 存储（双模：SQLite 后端 API 优先，localStorage 兜底/缓存） ----------
   seedVersion 自动迁移：缓存数据的 seedVersion 低于 SEED 时，
   用 SEED 的内置模板（ABC_PRODUCT / DEFAULT）覆盖同名模板（→ 新默认版式立即生效），
   用户自建模板（SEED 中不存在的 code）与 meta.currentUser / role 原样保留。
   页面由 server.js 托管（或 API 可达 :8092）时 SQLite 为数据源、localStorage 作离线缓存；
   API 离线（file:// 直接打开 / 纯静态预览）时自动回退 localStorage，行为与之前一致。 */
function migrateDB(db) {
  const fresh = clone(SEED);
  const builtin = fresh.templates.map(t => t.code);
  (db.templates || []).forEach(t => { if (t && builtin.indexOf(t.code) < 0) fresh.templates.push(t); });
  if (db.meta) {
    fresh.meta.currentUser = db.meta.currentUser || fresh.meta.currentUser;
    fresh.meta.role = db.meta.role || fresh.meta.role;
  }
  /* 已有主数据/业务数据保留（不被 SEED 演示数据覆盖）：客户清单、字段、规则、历史、交货单 */
  ['rules', 'fields', 'customers', 'history'].forEach(k => { if (Array.isArray(db[k]) && db[k].length) fresh[k] = db[k]; });
  if (db.deliveries && Object.keys(db.deliveries).length) fresh.deliveries = db.deliveries;
  return fresh;
}
function loadDB() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      if (db && db.meta && (db.meta.seedVersion || 0) >= SEED.meta.seedVersion) return db;
      const fresh = migrateDB(db || {});
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
  _pushDB();
}
function resetDB() { DB = clone(SEED); saveDB(); }
let DB = loadDB();

/* ---------- 后端同步（SQLite API，可选；离线时静默回退 localStorage） ---------- */
const API_PORT = 8092;
let _apiBase = null;      // 探测成功的 API 基址；null = 未探测/离线
function _apiCandidates() {
  const list = [];
  try {
    if (location.protocol.indexOf('http') === 0) {
      const m = location.pathname.match(/^\/apps\/[^/]+/);
      if (m) list.push(m[0] + '/api');   // 门户 nginx 统一入口反代（80 端口，各网段可达；/apps/label/api → 127.0.0.1:8092）
      list.push('/api');   // 由 server.js 托管时同源即 API
      list.push(location.protocol + '//' + location.hostname + ':' + API_PORT + '/api');   // 其他静态托管时直连后端端口
    }
  } catch (e) { /* 无 location（jsdom/Node） */ }
  return list;
}
function _apiFetch(p, opts, timeoutMs) {
  if (typeof fetch !== 'function') return Promise.resolve(null);
  const cands = _apiBase ? [_apiBase].concat(_apiCandidates().filter(c => c !== _apiBase)) : _apiCandidates();
  if (!cands.length) return Promise.resolve(null);
  let i = 0;
  const attempt = () => {
    if (i >= cands.length) { _apiBase = null; return Promise.resolve(null); }
    const base = cands[i++];
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => { try { ctl.abort(); } catch (e) { /* ignore */ } }, timeoutMs || 2500) : null;
    return fetch(base + p, Object.assign({}, opts, { signal: ctl ? ctl.signal : undefined }))
      .then(r => {
        if (timer) clearTimeout(timer);
        if (!r || !r.ok) throw new Error('HTTP');
        _apiBase = base;
        return r;
      })
      .catch(() => { if (timer) clearTimeout(timer); return attempt(); });
  };
  return attempt();
}
let _pushT = null;
/* 保存后异步推送到后端（防抖 400ms；离线时 _apiFetch 返回 null，静默跳过） */
function _pushDB(delay) {
  clearTimeout(_pushT);
  _pushT = setTimeout(() => {
    _apiFetch('/db', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DB) }, 4000)
      .catch(() => { /* 离线时静默 */ });
  }, delay == null ? 400 : delay);
}
/* 启动对账：服务端有数据 → 迁移合并后采用；服务端为空 → 把本地库（SEED/缓存）推上去完成首次播种。
   两种结局都回调 onchange(online)（前端据此重渲染 / 显示离线提示），并置 window.LABEL_API_ONLINE。 */
function _setOnline(v) { try { window.LABEL_API_ONLINE = v; } catch (e) { /* jsdom/Node 无 window */ } }
function syncDB(onchange) {
  return _apiFetch('/db', {}, 2500).then(r => {
    if (!r) { _setOnline(false); if (typeof onchange === 'function') onchange(false); return false; }
    return r.json().then(data => {
      _setOnline(true);
      if (data && data.meta && !data.__empty) {
        DB = (data.meta.seedVersion || 0) >= SEED.meta.seedVersion ? data : migrateDB(data);
        try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); } catch (e) { /* ignore */ }
      } else {
        _pushDB(0);
      }
      if (typeof onchange === 'function') onchange(true);
      return true;
    });
  }).catch(() => { _setOnline(false); if (typeof onchange === 'function') onchange(false); return false; });
}

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
    customer: '4101901', customerName: 'ABC GmbH', CUST_MATNR: 'PX-7788'
  });
}