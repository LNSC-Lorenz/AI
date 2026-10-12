/* ==========================================================================
   标签设计器 (designer.js) — 工业简洁 · 公司代码索引 · 网格对齐
   · 可单独打开（designer.html），也可由主应用 / 宿主页面用 mount() 挂载；
   · 依赖 label-core.js：共享同一份 localStorage 数据（label_db_v1）与
     同一套渲染引擎（buildLabel / createEl）。
   · 以「公司代码」为索引创建模板：新建后填写公司代码，保存时由公司代码派生
     模板 code 作为唯一索引；下拉选择 / 属性栏 / 模板管理均以公司代码标识模板。
   · 整体以 IIFE 封装，所有内部符号不外泄，可安全与主应用 script.js 同页加载。
   · 对外接口：window.LabelDesigner = { mount, load, open, save, get, refresh,
     exportJSON, importJSON, newTemplate, db }
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- 设计器状态 ---------- */
  let DE = null;              // 正在编辑的模板（DB.templates 的深拷贝）
  let _pendingCode = null;    // 待打开的模板编码
  let _loadedCode = null;     // 当前编辑模板在 DB 中的（原）编码，用于公司代码改名保存
  const D_SCALE = 3.4;        // 画布缩放：1mm -> 3.4px
  const SNAP_TOL = 1.2;       // 对齐参考线吸附容差（mm）
  let ZOOM = 1;               // 视图缩放（1 = 100%，只影响显示，不改变标签数据）
  let _fitPending = true;     // 首次可见时自动 Fit（2026-10-10 用户要求：默认适配窗口而非 100%）
  const dScale = () => D_SCALE * ZOOM;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const roundT = (v) => Math.round(v);            // 位置/尺寸吸附到整 mm
  const round2 = (v) => Math.round((+v || 0) * 100) / 100;
  const sanitizeCode = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const DEMO_CTX = (typeof sampleData === 'function') ? sampleData() : {};  // 预览示例数据

  /* ---------- 外壳（挂载到任意容器时自动注入） ---------- */
  const SHELL = `
  <div class="ld-toolbar">
    <span class="ld-lbl">公司代码</span>
    <span class="ld-company" id="ld-company-badge">—</span>
    <span class="ld-lbl">模板</span>
    <select id="ld-tpl" class="ld-ctl"></select>
    <button class="btn btn-sm" id="ld-new">＋ 新建模板</button>
    <span class="spacer"></span>
    <label class="ld-snap"><input type="checkbox" id="ld-snap" checked> 对齐</label>
    <button class="btn btn-sm" id="ld-preview">预览</button>
    <button class="btn btn-sm" id="ld-export">导出</button>
    <button class="btn btn-sm" id="ld-import">导入</button>
    <button class="btn btn-sm btn-primary" id="ld-save">保存</button>
  </div>
  <div class="ld-grid">
    <div class="panel"><div class="panel-body" id="ld-palette"></div></div>
    <div class="ld-mid">
      <div class="ld-stage">
        <div class="ld-ruler-corner"></div>
        <div class="ld-ruler-h" id="ld-ruler-h"></div>
        <div class="ld-ruler-v" id="ld-ruler-v"></div>
        <div class="canvas-wrap" id="ld-wrap"></div>
        <div class="ld-zoom" id="ld-zoom">
          <button type="button" id="ld-zoom-out" title="缩小">−</button>
          <span id="ld-zoom-pct">100%</span>
          <button type="button" id="ld-zoom-in" title="放大">＋</button>
          <button type="button" id="ld-zoom-fit" title="适配窗口">Fit</button>
        </div>
      </div>
      <div class="ld-preview">
        <div class="ld-preview-stage" id="ld-prev-inline"></div>
      </div>
      <div class="ld-status" id="ld-status">
        <span id="ld-st-count">0 个元素</span><span>·</span><span id="ld-st-size">100 × 60 mm</span>
        <span class="spacer"></span>
        <span class="ld-status-hint">拖动吸附对齐 · Delete 删除选中 · Esc 关闭弹窗</span>
      </div>
    </div>
    <div class="ld-right">
      <div class="panel ld-cocard">
        <span class="ld-cocard-lbl">公司代码</span>
        <input type="text" id="ld-co" class="ld-cocard-code" maxlength="7" inputmode="numeric" pattern="\d{7}"
               title="公司代码恒为 7 位数字" placeholder="7 位数字，如 4101901">
        <div class="ld-cocard-name" id="ld-co-name">—</div>
      </div>
      <div class="panel ld-props-panel"><div class="panel-body" id="ld-props"></div></div>
    </div>
  </div>`;

  /* ---------- 提示 / 弹窗 ---------- */
  let _toastH = null;
  function ldToast(msg, type) {
    const t = $('#ld-toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'ld-toast' + (type ? ' ' + type : '');
    t.hidden = false;
    clearTimeout(_toastH);
    _toastH = setTimeout(() => { t.hidden = true; }, 2400);
  }
  let _modalAction = null;
  function ldOpenModal(title, bodyHTML, actionLabel, actionFn) {
    $('#ld-modal-title').textContent = title;
    $('#ld-modal-body').innerHTML = bodyHTML;
    const btn = $('#ld-modal-action');
    _modalAction = actionFn || null;
    if (actionLabel && actionFn) { btn.hidden = false; btn.textContent = actionLabel; }
    else btn.hidden = true;
    $('#ld-modal').hidden = false;
  }
  function ldCloseModal() { $('#ld-modal').hidden = true; $('#ld-modal-body').innerHTML = ''; _modalAction = null; }

  /* 宿主页面若缺少覆盖层，则按需创建（designer.html 已内置，会跳过） */
  function ensureOverlays() {
    if (!$('#ld-toast')) {
      const t = document.createElement('div');
      t.id = 'ld-toast'; t.className = 'ld-toast'; t.hidden = true;
      document.body.appendChild(t);
    }
    if (!$('#ld-modal')) {
      const m = document.createElement('div');
      m.id = 'ld-modal'; m.className = 'ld-modal'; m.hidden = true;
      m.innerHTML = '<div class="ld-modal-box">'
        + '<div class="ld-modal-head"><span id="ld-modal-title">预览</span>'
        + '<div class="ld-modal-head-actions"><button id="ld-modal-action" class="btn-sm" hidden></button>'
        + '<button id="ld-modal-close" class="ld-close" title="关闭">✕</button></div></div>'
        + '<div class="ld-modal-body" id="ld-modal-body"></div></div>';
      document.body.appendChild(m);
    }
  }

  /* ---------- 挂载（可注入任意容器） ---------- */
  function mount(root) {
    const el = typeof root === 'string' ? $(root) : root;
    if (!el) return api;
    el.classList.add('label-designer');
    ensureOverlays();
    if (!el.querySelector('#ld-wrap')) el.innerHTML = SHELL;
    bindShell();
    palette();
    const start = (_pendingCode && tplByCode(_pendingCode)) ? _pendingCode
      : (DB.templates[0] && DB.templates[0].code);
    _pendingCode = null;
    if (start) {
      loadTemplate(start);
    } else {
      DE = { code: '', company: '', name: '', version: 1, status: 'draft', width: 100, height: 60, unit: 'mm', customer: '', elements: [], sel: null };
      refreshMeta(); refreshTplSelect(); canvas(); props();
    }
    tryFit();   // 首次打开默认 Fit（此刻隐藏则跳过，待 refresh 补）
    // SQLite 后端在线时与其对账（离线自动回退 localStorage，见 label-core.js syncDB）
    if (typeof syncDB === 'function') syncDB(() => { api.refresh(); });
    return api;
  }

  function bindShell() {
    $('#ld-tpl').onchange = e => loadTemplate(e.target.value);
    $('#ld-new').onclick = newTemplate;
    $('#ld-preview').onclick = preview;
    $('#ld-export').onclick = exportJSON;
    $('#ld-import').onclick = importJSON;
    $('#ld-save').onclick = save;
    $('#ld-modal-close').onclick = ldCloseModal;
    $('#ld-modal-action').onclick = () => { if (_modalAction) _modalAction(); };
    $('#ld-modal').addEventListener('click', e => { if (e.target.id === 'ld-modal') ldCloseModal(); });

    // 模板级属性：公司代码 = 右栏顶部卡片大号可编辑代码（唯一索引，恒为 7 位数字：仅数字、最长 7 位）
    $('#ld-co').addEventListener('input', e => {
      if (!DE) return;
      const v = e.target.value.replace(/\D/g, '').slice(0, 7);
      if (v !== e.target.value) e.target.value = v;
      DE.company = v;
      const nm = $('#ld-co-name');
      if (nm) { const c = (DB.customers || []).find(x => x.code === v); nm.textContent = c ? c.name : '—'; }
    });

    // Esc 关闭弹窗
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#ld-modal').hidden) ldCloseModal(); });
    // Delete / Backspace 删除选中元素（输入框内不触发）
    document.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName) || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && DE && DE.sel) {
        e.preventDefault();
        DE.elements = DE.elements.filter(x => x.id !== DE.sel);
        DE.sel = null; canvas(); props();
      }
    });
    // 刻度尺满边：窗口尺寸变化 / 画布区滚动时重排刻度（保持 0 刻度与标签边缘对齐）
    const wrap0 = $('#ld-wrap');
    if (wrap0) wrap0.addEventListener('scroll', () => rulers());
    if (!window._ldRulerRs) { window._ldRulerRs = 1; window.addEventListener('resize', () => { if (DE) rulers(); }); }
    // 缩放控件（参考 OpenLabelMaker 中栏：− / 百分比 / ＋ / Fit）
    const zin = $('#ld-zoom-in'), zout = $('#ld-zoom-out'), zfit = $('#ld-zoom-fit');
    if (zin) zin.onclick = () => setZoom(ZOOM * 1.25);
    if (zout) zout.onclick = () => setZoom(ZOOM / 1.25);
    if (zfit) zfit.onclick = fitZoom;
  }

  /* ---------- 模板下拉 / 模板级属性 ---------- */
  function tplLabel(t) {
    const co = t.company || t.customer || '';
    return (co ? co + ' · ' : '') + (t.name || t.code);
  }
  function refreshTplSelect() {
    const sel = $('#ld-tpl');
    if (!sel || !DE) return;
    const list = DB.templates.slice().sort((a, b) => tplLabel(a).localeCompare(tplLabel(b)));
    sel.innerHTML = list.map(t =>
      `<option value="${t.code}" ${t.code === DE.code ? 'selected' : ''}>${esc(tplLabel(t))}</option>`).join('');
  }

  function refreshMeta() {
    if (!DE) return;
    const code = DE.company || DE.customer || '';
    const co = $('#ld-co'); if (co) co.value = code;
    const nm = $('#ld-co-name');
    if (nm) { const c = (DB.customers || []).find(x => x.code === code); nm.textContent = c ? c.name : '—'; }
    const badge = $('#ld-company-badge'); if (badge) badge.textContent = DE.code || '—';
  }

  function loadTemplate(code) {
    const t = tplByCode(code);
    if (!t) return;
    DE = clone(t); DE.sel = null; _loadedCode = code;
    refreshMeta(); refreshTplSelect(); canvas(); props();
  }

  /* ---------- 以公司代码为索引新建模板 ---------- */
  /* 基础底版（2026-10-12 用户指定）：新建模板自动带出无外框工业简洁版式——
     左 1mm 粗竖线 + 右 0.5mm LOGO 通道分隔竖线（y 3..57）+ 3 个字段行
     （粗体单行标题 fs8 左对齐 + 行槽底部 0.35mm 书写细线）+ 右缘竖排 LOGO */
  const BASE_ELEMENTS = [   // 100×50mm（2026-10-12 高度 60→50，字体不变）
    { id: 'leftbar', type: 'rectangle', x: 2.5, y: 3, width: 1, height: 44, fill: '#111', borderWidth: 0 },
    { id: 'rsep', type: 'rectangle', x: 88.5, y: 3, width: 0.5, height: 44, fill: '#111', borderWidth: 0 },
    { id: 'cap0', type: 'text', text: '物料号 / Material No.', x: 8, y: 4, width: 76, height: 3.4, fontSize: 8, color: '#111', bold: true, align: 'left' },
    { id: 'line0', type: 'rectangle', x: 8, y: 14.38, width: 77, height: 0.35, fill: '#111', color: '#111', borderWidth: 0 },
    { id: 'cap1', type: 'text', text: '品名 / DESCRIPTION', x: 8, y: 17.88, width: 76, height: 3.4, fontSize: 8, color: '#111', bold: true, align: 'left' },
    { id: 'line1', type: 'rectangle', x: 8, y: 28.27, width: 77, height: 0.35, fill: '#111', color: '#111', borderWidth: 0 },
    { id: 'cap2', type: 'text', text: '数量 / QTY', x: 8, y: 31.77, width: 76, height: 3.4, fontSize: 8, color: '#111', bold: true, align: 'left' },
    { id: 'line2', type: 'rectangle', x: 8, y: 42.15, width: 77, height: 0.35, fill: '#111', color: '#111', borderWidth: 0 },
    { id: 'logo', type: 'image', src: 'assets/lechler-c-logo-combination-mark-black-00.png', x: 71, y: 22, width: 45, height: 6, rotate: -90 }
  ];
  function newTemplate() {
    const n = DB.templates.length + 1;
    let code = 'TMP_' + n;
    while (DB.templates.some(t => t.code === code)) code = 'TMP_' + n + '_' + Math.floor(Math.random() * 900 + 100);
    const t = { code, company: '', name: '新模板 ' + n, version: 1, status: 'draft', width: 100, height: 50, unit: 'mm', customer: '', updated: nowStr(), elements: clone(BASE_ELEMENTS) };
    DB.templates.push(t); saveDB();
    loadTemplate(code);
    const co = $('#ld-co');
    if (co) { co.focus(); if (co.select) co.select(); }
    ldToast('已新建模板 · 请填写「公司代码」作为唯一索引', 'ok');
  }

  /* ---------- 组件面板（精简：仅 4 类元素 + 字段下拉；2026-10-08 移除 Logo 元素入口） ---------- */
  const PALETTE = {
    text: () => ({ type: 'text', text: '文字', fontSize: 12, width: 40, height: 8 }),
    barcode: () => ({ type: 'barcode', width: 45, height: 14, value: '{{MATNR}}' }),
    qrcode: () => ({ type: 'qrcode', width: 20, height: 20, value: '{{MATNR}}' }),
    line: () => ({ type: 'line', width: 40, height: 2 })
  };
  /* 组件图标（inline SVG，currentColor 继承按钮前景色） */
  const ICONS = {
    text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>',
    barcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 5v14M8 5v14M11 5v14M15 5v14M17.5 5v14M20.5 5v14"/></svg>',
    qrcode: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><path d="M13 13h3v3h-3zM18 13h2v2h-2zM13 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" stroke="none"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M4 12h16"/></svg>',
    /* SAP 字段图标（按字段编码索引，_field 为兜底、_manual 为手工输入） */
    MATNR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h7l9 9-7 7-9-9V4z"/><circle cx="8.5" cy="8.5" r="1.4"/></svg>',
    MAKTX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 6h14M5 10h14M5 14h9M5 18h6"/></svg>',
    CHARG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l8 4-8 4-8-4 8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg>',
    LFIMG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4L7 20M17 4l-2 16M4 9h16M4 15h16"/></svg>',
    WERKS: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V10l5 3v-3l5 3V7h4v14"/></svg>',
    LGORT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-6h6v6"/></svg>',
    BSTKD: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/></svg>',
    KDMAT: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7.5" r="3.2"/><path d="M5.5 20c1-3.6 3.5-5.2 6.5-5.2s5.5 1.6 6.5 5.2"/></svg>',
    VGBEL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 12h6"/></svg>',
    _manual: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/></svg>',
    _field: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 10h6M9 14h6" stroke-linecap="round"/></svg>'
  };
  function palette() {
    const sap = DB.fields.filter(f => f.type === 'SAP');
    const host = $('#ld-palette');
    if (!host) return;
    /* 元素 + SAP 字段全部展开为图标按钮（2026-10-08 用户要求：不再用下拉框） */
    const elBtn = (add, icon, label) =>
      '<button type="button" data-add="' + add + '">' + icon + '<span>' + label + '</span></button>';
    const fldBtn = (code, label, manual) =>
      '<button type="button" data-field="' + esc(code) + '" data-flabel="' + esc(label) + '"' + (manual ? ' data-manual="1"' : '') + '>'
      + (ICONS[code] || ICONS._field) + '<span>' + esc(label) + '</span><i>' + esc(code) + '</i></button>';
    host.innerHTML =
      '<div class="pal-row">'
      + elBtn('text', ICONS.text, '文本')
      + elBtn('barcode', ICONS.barcode, '条码')
      + elBtn('qrcode', ICONS.qrcode, '二维码')
      + elBtn('line', ICONS.line, '线条')
      + '<div class="pal-div"></div>'
      + sap.map(f => fldBtn(f.code, f.label, false)).join('')
      + fldBtn('CUST_MATNR', '手工输入', true)
      + '</div>';
    $$('#ld-palette [data-add]').forEach(btn => { btn.onclick = () => addFromPalette(btn.dataset.add); });
    $$('#ld-palette [data-field]').forEach(btn => {
      btn.onclick = () => addField(btn.dataset.field, btn.dataset.flabel, btn.dataset.manual === '1');
    });
  }

  function addFromPalette(t) {
    const make = PALETTE[t];
    if (make) addElement(make());
  }

  /* 点击字段图标即加入字段元素（source: sap / manual） */
  function addField(code, label, manual) {
    addElement({
      type: 'field', source: manual ? 'manual' : 'sap', field: code,
      label: label || code, required: !!manual, fontSize: 11, width: 55, height: 7
    });
  }

  function addElement(partial) {
    if (!DE) return;
    const el = Object.assign({ id: uid('el'), x: 6, y: 6 }, partial);
    DE.elements.push(el);
    DE.sel = el.id;
    canvas(); props();
  }

  /* ---------- 画布绘制 / 标尺 ---------- */
  function canvas() {
    const wrap = $('#ld-wrap');
    if (!wrap || !DE) return;
    wrap.innerHTML = '';
    const c = buildLabel(DE, {}, dScale());
    const guides = document.createElement('div');
    guides.className = 'guides';
    c.appendChild(guides);
    DE._guides = guides;
    c.querySelectorAll('.el').forEach(node => {
      const el = DE.elements.find(e => e.id === node.dataset.id);
      if (!el) return;
      if (el.id === DE.sel) node.classList.add('sel');
      const rz = document.createElement('div');
      rz.className = 'rz';
      node.appendChild(rz);
      node.addEventListener('mousedown', ev => startDrag(ev, el, node, 'move'));
      rz.addEventListener('mousedown', ev => startDrag(ev, el, node, 'resize'));
    });
    c.addEventListener('mousedown', ev => {
      if (ev.target === c) { DE.sel = null; canvas(); props(); }
    });
    wrap.appendChild(c);
    rulers();
    const zp = $('#ld-zoom-pct'); if (zp) zp.textContent = Math.round(ZOOM * 100) + '%';
    const sc = $('#ld-st-count'); if (sc) sc.textContent = DE.elements.length + ' 个元素';
    const ss = $('#ld-st-size'); if (ss) ss.textContent = DE.width + ' × ' + DE.height + ' mm';
    inlinePreview();
  }

  /* 视图缩放（参考 OpenLabelMaker 中栏：− / % / ＋ / Fit） */
  function setZoom(z) {
    ZOOM = Math.min(4, Math.max(0.25, z));
    canvas();
  }
  function fitZoom() {
    const wrap = $('#ld-wrap');
    if (!wrap || !DE || !wrap.clientWidth) return;   // 隐藏时量不到尺寸，保持现状（避免被钳到 25%）
    const zx = (wrap.clientWidth - 28) / (DE.width * D_SCALE);
    const zy = (wrap.clientHeight - 28) / (DE.height * D_SCALE);
    setZoom(Math.min(3, Math.min(zx, zy)));
  }
  /* 首次打开默认 Fit：挂载/刷新后若已可见则应用一次；仍隐藏（如在模板管理页签）则等下次可见时补 */
  function tryFit() {
    if (!_fitPending) return;
    const wrap = $('#ld-wrap');
    if (!wrap || !wrap.clientWidth) return;
    _fitPending = false;
    fitZoom();
  }

  /* ---------- 中下：打印预览（只读，用示例数据渲染整张标签） ---------- */
  function inlinePreview() {
    const stage = $('#ld-prev-inline');
    if (!stage || !DE) return;
    stage.innerHTML = '';
    const node = buildLabel(DE, DEMO_CTX, D_SCALE);
    stage.appendChild(node);
    fitPreview(stage, node);
  }
  // 空间不足时等比缩小（保持居中，不裁剪内容）
  function fitPreview(stage, node) {
    const sw = stage.clientWidth - 16, sh = stage.clientHeight - 16;   // 扣除 padding: 8px
    const w = node.offsetWidth, h = node.offsetHeight;
    if (!sw || !sh || !w || !h) return;
    const k = Math.min(1, sw / w, sh / h);
    if (k < 1) { node.style.transformOrigin = 'center center'; node.style.transform = 'scale(' + k + ')'; }
  }

  function rulers() {
    const h = $('#ld-ruler-h'), v = $('#ld-ruler-v');
    if (!h || !v || !DE) return;
    /* 刻度尺满边：轨道铺满画布区整条边（不再按标签宽/高截断）；
       0 刻度与标签左/上边缘对齐（按画布实际位置取偏移），5mm 刻度向两侧延满。 */
    let offX = 14, offY = 14;
    const wrap = $('#ld-wrap'), c = wrap && wrap.querySelector('.canvas');
    if (wrap && c) {
      const wr = wrap.getBoundingClientRect(), cr = c.getBoundingClientRect();
      offX = cr.left - wr.left; offY = cr.top - wr.top;
    }
    const step = 5 * dScale();
    let hh = '', vv = '';
    for (let k = Math.ceil(-offX / step), x = offX + k * step; x <= h.clientWidth; k++, x += step) {
      const mm = k * 5, maj = ((mm % 10) + 10) % 10 === 0;
      hh += `<span class="tk${maj ? ' maj' : ''}" style="left:${round2(x)}px">${maj && mm >= 0 ? mm : ''}</span>`;
    }
    for (let k = Math.ceil(-offY / step), y = offY + k * step; y <= v.clientHeight; k++, y += step) {
      const mm = k * 5, maj = ((mm % 10) + 10) % 10 === 0;
      vv += `<span class="tk${maj ? ' maj' : ''}" style="top:${round2(y)}px">${maj && mm >= 0 ? mm : ''}</span>`;
    }
    h.innerHTML = hh; v.innerHTML = vv;
  }

  function markSel(node) {
    $$('#ld-wrap .el').forEach(n => n.classList.remove('sel'));
    if (node) node.classList.add('sel');
  }

  /* ---------- 对齐：参考线目标 / 吸附 / 绘制 ---------- */
  function guideTargets(axis) {
    const max = axis === 'x' ? DE.width : DE.height;
    const t = [0, max, max / 2];
    (DE.elements || []).forEach(e => {
      if (e.id === DE.sel) return;
      if (axis === 'x') { t.push(e.x, e.x + e.width / 2, e.x + e.width); }
      else { t.push(e.y, e.y + e.height / 2, e.y + e.height); }
    });
    return t;
  }
  // 移动：将元素左/中/右（上/中/下）对齐到最近参考线
  function resolveSnap(x, w, targets) {
    const edges = [['l', x], ['c', x + w / 2], ['r', x + w]];
    let best = null;
    targets.forEach(t => edges.forEach(([k, val]) => {
      const d = Math.abs(val - t);
      if (d <= SNAP_TOL && (!best || d < best.d)) {
        const pos = k === 'l' ? t : k === 'c' ? t - w / 2 : t - w;
        best = { d, pos, guide: t };
      }
    }));
    return best || { pos: x, guide: null };
  }
  // 缩放：将移动边（右/下）对齐到最近参考线
  function resolveSnapSize(start, size, targets) {
    let best = null;
    targets.forEach(t => {
      const d = Math.abs(start + size - t);
      if (d <= SNAP_TOL && (!best || d < best.d)) best = { d, size: t - start, guide: t };
    });
    return best || { size, guide: null };
  }
  function drawGuides(gx, gy) {
    const g = DE && DE._guides;
    if (!g) return;
    let h = '';
    if (gx != null) h += `<div class="gline v" style="left:${gx * dScale()}px"></div>`;
    if (gy != null) h += `<div class="gline h" style="top:${gy * dScale()}px"></div>`;
    g.innerHTML = h;
  }

  /* ---------- 拖拽 / 缩放（含网格吸附与参考线） ---------- */
  function startDrag(ev, el, node, mode) {
    ev.preventDefault(); ev.stopPropagation();
    DE.sel = el.id; markSel(node); props();
    const snapOn = $('#ld-snap') ? $('#ld-snap').checked : true;
    const sx = ev.clientX, sy = ev.clientY;
    const ox = el.x, oy = el.y, ow = el.width, oh = el.height;
    const vx = guideTargets('x'), vy = guideTargets('y');
    function onMove(e) {
      const dx = (e.clientX - sx) / dScale(), dy = (e.clientY - sy) / dScale();
      let gx = null, gy = null;
      if (mode === 'move') {
        let nx = ox + dx, ny = oy + dy;
        if (snapOn) {
          const rx = resolveSnap(nx, el.width, vx); nx = rx.pos; gx = rx.guide;
          const ry = resolveSnap(ny, el.height, vy); ny = ry.pos; gy = ry.guide;
        }
        el.x = clamp(roundT(nx), 0, Math.max(0, DE.width - el.width));
        el.y = clamp(roundT(ny), 0, Math.max(0, DE.height - el.height));
      } else {
        let nw = ow + dx, nh = oh + dy;
        if (snapOn) {
          const rw = resolveSnapSize(el.x, nw, vx); nw = rw.size; gx = rw.guide;
          const rh = resolveSnapSize(el.y, nh, vy); nh = rh.size; gy = rh.guide;
        }
        el.width = clamp(roundT(nw), 2, DE.width - el.x);
        el.height = clamp(roundT(nh), 2, DE.height - el.y);
      }
      node.style.left = (el.x * D_SCALE) + 'px';
      node.style.top = (el.y * D_SCALE) + 'px';
      node.style.width = (el.width * D_SCALE) + 'px';
      node.style.height = (el.height * D_SCALE) + 'px';
      drawGuides(gx, gy);
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      drawGuides(null, null);
      props();
      inlinePreview();      // 拖拽/缩放结束：打印预览同步
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ---------- 元素属性面板 ---------- */
  function props() {
    const host = $('#ld-props');
    if (!host) return;
    const el = DE && DE.elements.find(e => e.id === DE.sel);
    if (!el) {
      /* 新设计稿：右栏在未选中元素时展示「模板」属性（名称 / 宽 / 高），
         取代旧版横跨全宽的模板级属性行；公司代码在画布上方居中输入框。 */
      if (!DE) { host.innerHTML = '<div class="prop-empty">未选中元素</div>'; return; }
      host.innerHTML =
        '<div class="props-head"><span class="tag">模板</span></div>'
        + '<div class="props-grid">'
        + '<div class="field" style="grid-column: 1 / -1"><label>模板名称</label><input type="text" data-t="name" value="' + esc(DE.name || '') + '" placeholder="模板名称"></div>'
        + '<div class="field"><label>宽度 (mm)</label><input type="number" step="1" min="10" data-t="width" value="' + DE.width + '"></div>'
        + '<div class="field"><label>高度 (mm)</label><input type="number" step="1" min="10" data-t="height" value="' + DE.height + '"></div>'
        + '</div>'
        + '<div class="prop-empty">选中画布元素可编辑其属性</div>';
      $$('#ld-props [data-t]').forEach(inp => {
        inp.addEventListener('input', () => {
          if (inp.dataset.t === 'name') { DE.name = inp.value; refreshTplSelect(); }
        });
        inp.addEventListener('change', () => {
          const k = inp.dataset.t, v = parseFloat(inp.value);
          if ((k === 'width' || k === 'height') && !isNaN(v) && v > 0) { DE[k] = v; canvas(); }
        });
      });
      return;
    }
    let fields = '';
    fields += numField('X (mm)', 'x', el.x) + numField('Y (mm)', 'y', el.y);
    fields += numField('宽 W (mm)', 'width', el.width) + numField('高 H (mm)', 'height', el.height);
    if (el.type === 'text') fields += textField('文本', 'text', el.text || '');
    if (el.type === 'barcode' || el.type === 'qrcode') fields += textField('内容', 'value', el.value || '');
    if (el.type === 'field') {
      fields += textField('字段编码', 'field', el.field || '');
      fields += textField('显示名称', 'label', el.label || '');
      fields += `<div class="field"><label>数据来源</label><select data-p="source">
        <option value="sap" ${el.source === 'sap' ? 'selected' : ''}>SAP 字段</option>
        <option value="manual" ${el.source === 'manual' ? 'selected' : ''}>运行时录入</option>
        <option value="static" ${el.source === 'static' ? 'selected' : ''}>固定值</option>
      </select></div>`;
      fields += `<label class="chk"><input type="checkbox" data-p="required" ${el.required ? 'checked' : ''}> 必填（运行时录入）</label>`;
    }
    if (el.type === 'text' || el.type === 'field') fields += numField('字号', 'fontSize', el.fontSize || 11);
    host.innerHTML =
      `<div class="props-head"><span class="tag">${esc(el.type)}</span>
         <div class="props-acts">
           <button type="button" class="btn-sm" id="ld-dup">复制</button>
           <button type="button" class="btn-sm btn-danger" id="ld-del">删除</button>
         </div></div>`
      + '<div class="props-grid">' + fields + '</div>';
    $$('#ld-props [data-p]').forEach(inp => {
      inp.addEventListener('input', () => applyProp(el, inp));
      inp.addEventListener('change', () => applyProp(el, inp));
    });
    $('#ld-dup').onclick = () => duplicateElement(el);
    $('#ld-del').onclick = () => deleteElement(el);
  }
  function numField(label, key, val) {
    return `<div class="field"><label>${label}</label><input type="number" step="0.5" data-p="${key}" value="${round2(val)}"></div>`;
  }
  function textField(label, key, val) {
    return `<div class="field"><label>${label}</label><input type="text" data-p="${key}" value="${esc(val)}"></div>`;
  }
  function applyProp(el, inp) {
    const key = inp.dataset.p;
    if (inp.type === 'checkbox') el[key] = inp.checked;
    else if (inp.type === 'number') { const v = parseFloat(inp.value); if (!isNaN(v)) el[key] = v; }
    else el[key] = inp.value;
    if (key === 'width' || key === 'height') {
      el.width = clamp(el.width, 2, DE.width - el.x);
      el.height = clamp(el.height, 2, DE.height - el.y);
    }
    canvas();
  }
  function duplicateElement(el) {
    const copy = clone(el);
    copy.id = uid('el');
    copy.x = clamp(el.x + 3, 0, Math.max(0, DE.width - el.width));
    copy.y = clamp(el.y + 3, 0, Math.max(0, DE.height - el.height));
    DE.elements.push(copy); DE.sel = copy.id; canvas(); props();
  }
  function deleteElement(el) {
    DE.elements = DE.elements.filter(x => x.id !== el.id);
    DE.sel = null; canvas(); props();
  }

  /* ---------- 保存 / 预览 / 导入导出 ---------- */
  function save() {
    if (!DE) return;
    const company = (DE.company || '').trim();
    let newCode = _loadedCode || DE.code || '';
    if (company) {
      const derived = sanitizeCode(company);
      if (!derived) { ldToast('公司代码无效（仅 A-Z 0-9 _ -）', 'err'); return; }
      const clash = DB.templates.some(t => t.code === derived && t.code !== (_loadedCode || DE.code));
      if (clash) { ldToast('公司代码已被占用：' + derived, 'err'); return; }
      newCode = derived;
    }
    if (!newCode) newCode = sanitizeCode(DE.name) || ('TMP_' + (DB.templates.length + 1));
    DE.code = newCode;
    if (company && !DE.customer) DE.customer = company;
    if (company) DE.company = company;
    DE.updated = nowStr();
    if (_loadedCode && _loadedCode !== newCode) DB.templates = DB.templates.filter(t => t.code !== _loadedCode);
    const i = DB.templates.findIndex(t => t.code === newCode);
    if (i >= 0) DB.templates[i] = clone(DE); else DB.templates.push(clone(DE));
    _loadedCode = newCode;
    saveDB();
    canvas(); refreshMeta(); refreshTplSelect();
    ldToast('已保存模板：' + newCode, 'ok');
  }

  function preview() {
    if (!DE) return;
    const html = buildLabel(DE, DEMO_CTX, D_SCALE);
    ldOpenModal('标签预览 · ' + (DE.code || '未保存'),
      '<div id="ld-prev-stage" class="modal-stage">' + html.outerHTML + '</div>', null, null);
  }

  function exportJSON() {
    if (!DE) return;
    const json = JSON.stringify(DE, null, 2);
    ldOpenModal('导出 Label JSON · ' + (DE.code || ''),
      '<div class="field"><label>复制以下 JSON 保存为模板文件（导入时 code 冲突则覆盖）</label>'
      + '<textarea id="ld-export-text" rows="16" spellcheck="false" readonly>' + esc(json) + '</textarea></div>',
      '复制', () => {
        const ta = $('#ld-export-text');
        if (ta) { ta.focus(); if (ta.select) ta.select(); try { document.execCommand('copy'); } catch (e) { /* ignore */ } }
        ldToast('已复制到剪贴板', 'ok');
      });
  }

  function importJSON() {
    ldOpenModal('导入 Label JSON',
      '<div class="field"><label>粘贴 Label JSON（需包含 elements 数组）</label>'
      + '<textarea id="ld-import-text" rows="14" spellcheck="false" placeholder=\'{"code":"ABC","width":100,"height":60,"elements":[]}\'></textarea></div>',
      '导入并载入', () => {
        const ta = $('#ld-import-text');
        if (!ta) return;
        let obj;
        try { obj = JSON.parse(ta.value); } catch (e) { ldToast('JSON 解析失败：' + e.message, 'err'); return; }
        if (!obj || !Array.isArray(obj.elements)) { ldToast('JSON 无效：缺少 elements 数组', 'err'); return; }
        obj.code = sanitizeCode(obj.code || obj.company || 'IMPORTED') || 'IMPORTED';
        obj.width = +obj.width || 100; obj.height = +obj.height || 60; obj.unit = obj.unit || 'mm';
        DE = obj; DE.sel = null; _loadedCode = obj.code;
        const i = DB.templates.findIndex(t => t.code === DE.code);
        if (i >= 0) DB.templates[i] = clone(DE); else DB.templates.push(clone(DE));
        saveDB();
        ldCloseModal();
        refreshMeta(); refreshTplSelect(); canvas(); props();
        ldToast('已导入模板：' + DE.code, 'ok');
      });
  }

  /* ---------- 对外 API ---------- */
  const api = {
    mount, load: loadTemplate, open: loadTemplate, save, preview, newTemplate,
    get: () => DE ? clone(DE) : null,
    refresh: () => { refreshMeta(); refreshTplSelect(); palette(); canvas(); props(); tryFit(); },
    exportJSON, importJSON,
    setPendingCode: c => { _pendingCode = c; },
    db: () => DB
  };
  window.LabelDesigner = api;

  /* ---------- 自动初始化（独立 designer.html 用） ---------- */
  document.addEventListener('DOMContentLoaded', () => {
    const host = document.getElementById('label-designer') || document.getElementById('designer-root');
    if (host && !host.querySelector('#ld-wrap')) mount(host);
  });

  return api;
})();