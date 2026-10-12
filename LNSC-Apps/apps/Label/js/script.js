/* ==========================================================================
   标签应用外壳 (script.js) — 精简为 2 个视图
   · 视图：标签设计 (designer) / 模板管理 (templates)；
   · 本文件只负责「外壳 + 路由 + 模板管理」，标签设计视图直接挂载
     designer.js 暴露的 window.LabelDesigner（同一套三栏设计器）；
   · 依赖 js/label-core.js（共享 DB / buildLabel）与 js/designer.js / css/designer.css。
   · 对外接口：window.LabelApp = { mount(root), go(view), refresh(), views, DB }
   ========================================================================== */
(function () {
  'use strict';

  var VIEWS = [
    { id: 'designer', label: '标签设计' },
    { id: 'templates', label: '模板管理' }
  ];
  var currentView = 'designer';
  var _root = null;

  /* ---------- 工具 ---------- */
  function q(s, r) { return (r || document).querySelector(s); }
  function qa(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function designer() { return window.LabelDesigner || null; }

  /* ---------- 外壳 ---------- */
  function tabsHTML() {
    return VIEWS.map(function (v) { return '<button type="button" class="tab" data-view="' + v.id + '">' + v.label + '</button>'; }).join('');
  }

  function buildShell(root) {
    /* 顶栏（新设计稿）：.app-bar = #tabs（左） + #app-acts（右，操作按钮由 ensureViews 移入） */
    var bar = q('.app-bar', root);
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'app-bar';
      root.insertBefore(bar, root.firstChild);
    }
    var tabs = q('#tabs', bar);
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.id = 'tabs'; tabs.className = 'tabs'; tabs.setAttribute('role', 'tablist');
      tabs.setAttribute('aria-label', '功能导航');
      bar.insertBefore(tabs, bar.firstChild);
    }
    if (!tabs.children.length) tabs.innerHTML = tabsHTML();
    if (!q('#app-acts', bar)) {
      var acts = document.createElement('div');
      acts.id = 'app-acts'; acts.className = 'app-acts';
      bar.appendChild(acts);
    }
    if (!q('#main', root)) {
      var main = document.createElement('main');
      main.id = 'main';
      root.appendChild(main);
    }
  }

  function ensureViews() {
    var main = q('#main', _root) || q('#main', document);
    if (!main) return;
    if (main.querySelector('#designer-host')) return;   // 已构建
    main.innerHTML =
      '<section class="view" id="view-designer"><div id="designer-host"></div></section>'
      + '<section class="view" id="view-templates"></section>';
    var d = designer();
    if (d && d.mount) {
      d.mount('#designer-host');
      /* 新设计稿：预览/导出/导入/保存 上移到外壳顶栏右侧（移动的是同一批元素，
         id 与 designer.js 的绑定原样保留）；工具栏其余控件（模板下拉/新建/对齐/徽标）
         由 .ld-embedded 隐藏——模板切换/新建走「模板管理」页签，对齐保持默认开启。
         独立页 designer.html 不加载本脚本，按钮与工具栏保持完整。 */
      var host = q('#designer-host');
      if (host) host.classList.add('ld-embedded');
      var acts = q('#app-acts');
      if (acts) ['ld-preview', 'ld-export', 'ld-import', 'ld-save'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) acts.appendChild(b);
      });
    }
  }

  /* ---------- 路由 ---------- */
  function hashView() {
    var v = (location.hash || '').replace(/^#\/?/, '');
    return VIEWS.some(function (x) { return x.id === v; }) ? v : null;
  }

  function render(view) {
    if (view) currentView = view;
    ensureViews();
    qa('#tabs .tab', _root || document).forEach(function (t) {
      t.classList.toggle('active', t.dataset.view === currentView);
    });
    var dv = q('#view-designer'), tv = q('#view-templates');
    if (dv) dv.hidden = currentView !== 'designer';
    if (tv) tv.hidden = currentView !== 'templates';
    var acts = q('#app-acts');
    if (acts) acts.hidden = currentView !== 'designer';   // 操作按钮只对设计视图有意义
    if (currentView === 'templates') renderTemplates();
    else { var d = designer(); if (d && d.refresh) d.refresh(); }
  }

  function go(view) {
    var v = VIEWS.some(function (x) { return x.id === view; }) ? view : 'designer';
    currentView = v;
    render(v);
    if (('#/' + v) !== location.hash) location.hash = '#/' + v;
  }

/* ---------- 模板管理视图：全部客户逐行 + 模板状态（2026-10-10 用户要求） ----------
   行 = 客户主数据全部客户（9100 条，过滤框检索，最多显示 200 条）；
   无归属客户的模板（如 DEFAULT 通用模板）排在最前。
   列 = 公司代码 / 中文名称 / 尺寸 / 元素 / 更新时间 + 行末操作：
   有模板 → 设计（打开）+ 删除；无模板 → 设计（新建并预填公司代码）。 */
  function renderTemplates() {
    var host = q('#view-templates');
    if (!host) return;
    var customers = DB.customers || [];
    var tplByCo = {};
    (DB.templates || []).forEach(function (t) { tplByCo[String(t.company || t.customer || '')] = t; });
    var coSet = {};
    customers.forEach(function (c) { coSet[String(c.code)] = 1; });
    var orphans = (DB.templates || []).filter(function (t) {
      var co = String(t.company || t.customer || '');
      return !co || !coSet[co];
    });

    host.innerHTML =
      '<div class="page-head"><div><h2>模板管理</h2>'
      + '<div class="desc">全部 ' + customers.length + ' 个客户逐行列出（公司代码 = 7 位数字，数据来源 <span class="mono">data/Customer Chinese.xlsx</span>），每个客户一张标签模板，点「设计」进入设计器。'
      + (typeof window !== 'undefined' && window.LABEL_API_ONLINE === false
          ? '<br><b class="api-off">后端离线：当前为 localStorage 演示数据（' + customers.length + ' 条）——启动 <span class="mono">node server.js</span> 并经 <span class="mono">http://&lt;主机&gt;:8092/</span> 访问，即可载入 SQLite 基本数据库。</b>'
          : '')
      + '</div></div>'
      + '<div class="page-acts"><input type="text" id="cust-q" class="cust-q" placeholder="按代码或中文名称过滤…">'
      + '<button type="button" class="btn btn-primary" id="tpl-new">＋ 新建模板</button></div></div>'
      + '<div class="table-wrap"><table><thead><tr>'
      + '<th style="width:120px">公司代码</th><th>中文名称</th><th style="width:120px">尺寸</th>'
      + '<th style="width:64px">元素</th><th style="width:160px">更新时间</th><th style="width:130px"></th>'
      + '</tr></thead><tbody id="cust-body"></tbody></table></div>';

    var nw = q('#tpl-new', host);
    if (nw) nw.onclick = function () {
      var d = designer();
      if (d && d.newTemplate) d.newTemplate();
      go('designer');
    };

    var cq = q('#cust-q', host), cbody = q('#cust-body', host);
    function rowHtml(it) {
      var t = it.t;
      var act = '<div class="actions">'
        + (t ? '<button type="button" class="btn btn-sm" data-open="' + esc(t.code) + '">设计</button>'
             + '<button type="button" class="btn btn-sm btn-danger" data-del="' + esc(t.code) + '">删除</button>'
             : '<button type="button" class="btn btn-sm" data-new="' + esc(it.co) + '">设计</button>')
        + '</div>';
      return '<tr><td class="mono"><b>' + esc(it.co) + '</b></td><td>' + esc(it.name || '—') + '</td>'
        + '<td class="mono">' + (t ? t.width + ' × ' + t.height + ' mm' : '—') + '</td>'
        + '<td>' + (t ? (t.elements || []).length : '—') + '</td>'
        + '<td class="mono">' + (t ? esc(t.updated || '—') : '—') + '</td>'
        + '<td class="col-actions">' + act + '</td></tr>';
    }
    function renderRows() {
      if (!cbody) return;
      var kw = ((cq && cq.value) || '').trim().toLowerCase();
      var items = orphans.map(function (t) {
        return { co: String(t.company || t.customer || '') || '—', name: t.name || t.code, t: t };
      });
      customers.forEach(function (c) { items.push({ co: String(c.code), name: c.name, t: tplByCo[String(c.code)] }); });
      var hit = kw ? items.filter(function (it) {
        return it.co.toLowerCase().indexOf(kw) >= 0
          || String(it.name || '').toLowerCase().indexOf(kw) >= 0
          || (it.t && String(it.t.code).toLowerCase().indexOf(kw) >= 0);
      }) : items;
      var show = hit.slice(0, 200);
      var html = show.map(rowHtml).join('');
      if (!html) html = '<tr><td colspan="6" class="empty-row">无匹配客户</td></tr>';
      else if (hit.length > show.length) html += '<tr><td colspan="6" class="empty-row">共 ' + hit.length + ' 条匹配，仅显示前 200 条——请继续输入以缩小范围</td></tr>';
      cbody.innerHTML = html;
    }
    if (cq) cq.oninput = renderRows;
    /* 行内按钮（事件委托：过滤重渲染后无需重绑） */
    if (cbody) cbody.onclick = function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      var d = designer();
      if (b.dataset.open) { if (d && d.open) d.open(b.dataset.open); go('designer'); return; }
      if (b.dataset.new) {   // 无模板客户：新建模板并预填公司代码（走输入框监听，掩码与公司名联动生效）
        if (d && d.newTemplate) d.newTemplate();
        go('designer');
        var coEl = document.getElementById('ld-co');
        if (coEl) { coEl.value = b.dataset.new; coEl.dispatchEvent(new Event('input')); coEl.focus(); }
        return;
      }
      if (b.dataset.del) {
        var t = (DB.templates || []).find(function (x) { return x.code === b.dataset.del; });
        if (!t) return;
        var name = t.company || t.customer || t.name || t.code;
        if (!window.confirm('确定删除模板「' + name + '」？此操作不可撤销。')) return;
        DB.templates = DB.templates.filter(function (x) { return x.code !== t.code; });
        if (typeof saveDB === 'function') saveDB();
        if (d && d.refresh) d.refresh();
        renderTemplates();
      }
    };
    renderRows();
  }

  /* ---------- 挂载 / 初始化 ---------- */
  function bindTabs() {
    qa('#tabs .tab', _root || document).forEach(function (t) {
      t.onclick = function () { go(t.dataset.view); };
    });
  }

  function mount(root) {
    var el = typeof root === 'string' ? q(root) : root;
    if (!el) return api;
    _root = el;
    el.classList.add('label-app');
    buildShell(el);
    bindTabs();
    ensureViews();
    /* 2026-10-10 用户要求：首次打开固定落在「标签设计」——忽略 URL hash 里残留的历史页签；
       会话内点页签切换仍走 hash（hashchange 路由不受影响） */
    if (hashView() && hashView() !== 'designer' && window.history && history.replaceState) {
      history.replaceState(null, '', location.pathname + location.search + '#/designer');
    }
    render('designer');
    // SQLite 后端在线时与其对账（离线自动回退 localStorage，见 label-core.js syncDB）
    if (typeof syncDB === 'function') syncDB(function () { render(currentView); });
    return api;
  }

  function refresh() { render(currentView); }

  var api = { mount: mount, go: go, refresh: refresh, views: VIEWS, DB: DB };
  window.LabelApp = api;

  function autoInit() {
    var host = document.getElementById('label-app');
    if (host) mount(host);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoInit);
  else autoInit();

  window.addEventListener('hashchange', function () {
    var v = hashView();
    if (v && v !== currentView) render(v);
  });

  return api;
})();