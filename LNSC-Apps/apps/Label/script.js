/* ==========================================================================
   标签应用外壳 (script.js) — 精简为 2 个视图
   · 视图：标签设计 (designer) / 模板管理 (templates)；
   · 本文件只负责「外壳 + 路由 + 模板管理」，标签设计视图直接挂载
     designer.js 暴露的 window.LabelDesigner（同一套三栏设计器）；
   · 依赖 label-core.js（共享 DB / buildLabel）与 designer.js / designer.css。
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

/* ---------- 模板管理视图 ---------- */
  function renderTemplates() {
    var host = q('#view-templates');
    if (!host) return;
    var list = (DB.templates || []).slice().sort(function (a, b) {
      return String(a.company || a.customer || '').localeCompare(String(b.company || b.customer || ''));
    });
    var rows = list.map(function (t) {
      var co = t.company || t.customer || '—';
      return '<tr>'
        + '<td class="mono"><b>' + esc(co) + '</b></td>'
        + '<td>' + esc(t.name || '') + '</td>'
        + '<td class="mono">' + esc(t.code) + '</td>'
        + '<td class="mono">' + t.width + ' × ' + t.height + ' mm</td>'
        + '<td>' + ((t.elements || []).length) + '</td>'
        + '<td class="mono">' + esc(t.updated || '') + '</td>'
        + '<td class="col-actions"><div class="actions">'
        + '<button type="button" class="btn btn-sm" data-edit="' + esc(t.code) + '">设计</button>'
        + '<button type="button" class="btn btn-sm btn-danger" data-del="' + esc(t.code) + '">删除</button>'
        + '</div></td></tr>';
    }).join('');
    if (!rows) rows = '<tr><td colspan="7" class="empty-row">暂无模板，点击右上角「新建模板」以公司代码创建</td></tr>';

    host.innerHTML =
      '<div class="page-head"><div><h2>模板管理</h2>'
      + '<div class="desc">以「公司代码」为唯一索引管理标签模板，与设计器共享同一份本地数据。</div></div>'
      + '<button type="button" class="btn btn-primary" id="tpl-new">＋ 新建模板</button></div>'
      + '<div class="table-wrap"><table><thead><tr>'
      + '<th>公司代码</th><th>模板名称</th><th>索引 code</th><th>尺寸</th><th>元素</th><th>更新时间</th><th></th>'
      + '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    var nw = q('#tpl-new', host);
    if (nw) nw.onclick = function () {
      var d = designer();
      if (d && d.newTemplate) d.newTemplate();
      go('designer');
    };
    qa('#view-templates [data-edit]', host).forEach(function (b) {
      b.onclick = function () {
        var d = designer();
        if (d && d.open) d.open(b.dataset.edit);
        go('designer');
      };
    });
    qa('#view-templates [data-del]', host).forEach(function (b) {
      b.onclick = function () {
        var code = b.dataset.del;
        var t = DB.templates.find(function (x) { return x.code === code; });
        var name = (t && (t.company || t.customer || t.name)) || code;
        if (!window.confirm('确定删除模板「' + name + '」？此操作不可撤销。')) return;
        DB.templates = DB.templates.filter(function (x) { return x.code !== code; });
        if (typeof saveDB === 'function') saveDB();
        var d = designer();
        if (d && d.refresh) d.refresh();
        renderTemplates();
      };
    });
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
    render(hashView() || currentView);
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