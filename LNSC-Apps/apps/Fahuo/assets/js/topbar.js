/* ============================================================
 * LNSC 全链发货平台 - 顶部栏共享脚本（全页面）
 * 实时时钟：时间每秒刷新 + 日期
 * 主题颜色选择：黑白 #000000 / 蓝色 #006878（2026-10-08 用户指定 RGB 0,104,120；localStorage 记忆）
 * ============================================================ */
(function () {
  "use strict";

  /* ----- 主题（默认蓝色，localStorage 记忆优先） ----- */
  const saved = localStorage.getItem("lnsc-theme") || "blue";
  document.documentElement.dataset.theme = saved;

  /* ----- 实时时钟 ----- */
  const t = document.getElementById("tbTime");
  const d = document.getElementById("tbDate");
  if (t && d) {
    const p2 = n => String(n).padStart(2, "0");
    function tick() {
      const n = new Date();
      t.textContent = `${p2(n.getHours())}:${p2(n.getMinutes())}:${p2(n.getSeconds())}`;
      d.textContent = `${n.getFullYear()}/${p2(n.getMonth() + 1)}/${p2(n.getDate())}`;
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ----- 主题色块（平铺注入标题栏右段：黑色块 / 蓝色块） ----- */
  const tr = document.querySelector(".title-right");
  if (tr) {
    function apply(t) {
      document.documentElement.dataset.theme = t;
      localStorage.setItem("lnsc-theme", t);
      tr.querySelectorAll(".theme-sw").forEach(x =>
        x.classList.toggle("on", x.dataset.t === t));
    }
    const mk = (t, color, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "theme-sw";
      b.dataset.t = t;
      b.title = label;
      b.style.background = color;
      b.addEventListener("click", () => apply(t));
      return b;
    };
    /* 色条插在 Logistics 段之后 */
    const brand = tr.querySelector(".tb-brand");
    const anchor = brand ? brand.nextSibling : null;
    tr.insertBefore(mk("bw", "#000000", "黑白模式"), anchor);
    tr.insertBefore(mk("blue", "#006878", "蓝色模式"), anchor);   /* 蓝色块：2026-10-08 用户指定 RGB 0,104,120 */
    apply(saved);   /* 标记当前主题色块 */
  }
})();

/* API 状态点（全页面统一，各页 fetch 后调用）：在线=黑实心，离线=灰 */
function markApi(online, base) {
  const dot = document.getElementById("apiDot");
  if (!dot) return;
  dot.classList.toggle("on", !!online);
  dot.title = online ? "API 在线：" + (base || "") : "API 离线（演示数据）";
}

/* 警告按钮：紧急单未下单时红色背景（2026-10-20 用户规则「紧急单 只要未下单， 那警告符号一直红色背景显示」） */
function updateWarnBtn(orders) {
  const btn = document.querySelector('button[title="警告"]');
  if (!btn) return;
  const hasUrgentPending = (orders || []).some(o => o.priority === "紧急" && !o.waybill_no);
  btn.classList.toggle("warn-active", hasUrgentPending);
}

/* ----- 设置弹窗（全页面统一注入：承运商启用开关） ----- */
(function () {
  const btn = document.querySelector('button[title="设置"]');
  if (!btn) return;
  const CARRIERS = ["顺丰", "德邦", "跨越"];
  const KEY = "lnsc-carriers";
  const loadCfg = () => {
    try {
      return Object.assign({ "顺丰": true, "德邦": true, "跨越": true },
        JSON.parse(localStorage.getItem(KEY) || "{}"));
    } catch (e) { return { "顺丰": true, "德邦": true, "跨越": true }; }
  };
  const mask = document.createElement("div");
  mask.className = "about-mask";
  mask.hidden = true;
  mask.innerHTML =
    '<div class="about-box set-box">' +
    '  <div class="about-head"><b>设置</b><button class="about-x" title="关闭">×</button></div>' +
    '  <div class="about-body">' +
    '    <div class="set-sec">承运商启用（关闭后录单 / 下单页不再显示该承运商）</div>' +
    CARRIERS.map(c =>
      '<label class="set-row"><span>' + c + '</span>' +
      '<span class="ms-switch"><input type="checkbox" data-c="' + c + '"><i></i></span></label>'
    ).join("") +
    '  </div>' +
    '</div>';
  document.body.appendChild(mask);
  /* 承运商开关：初始载入 + 变更即存 */
  const cfg = loadCfg();
  mask.querySelectorAll("input[data-c]").forEach(i => {
    i.checked = cfg[i.dataset.c] !== false;
    i.addEventListener("change", () => {
      const c = loadCfg();
      c[i.dataset.c] = i.checked;
      localStorage.setItem(KEY, JSON.stringify(c));
    });
  });
  btn.addEventListener("click", () => { mask.hidden = false; });
  mask.addEventListener("click", e => { if (e.target === mask) mask.hidden = true; });
  mask.querySelector(".about-x").addEventListener("click", () => { mask.hidden = true; });
})();

/* ----- 关于弹窗（全页面统一注入；软件版本迭代风，参考 PO-Closing） ----- */
(function () {
  const btn = document.querySelector('button[title="关于"]');
  if (!btn) return;
  const mask = document.createElement("div");
  mask.className = "about-mask";
  mask.hidden = true;
  mask.innerHTML =
    '<div class="about-box">' +
    '  <div class="about-head"><b>关于</b><button class="about-x" title="关闭">×</button></div>' +
    '  <div class="about-body">' +
    '    <div class="about-hero"><span class="ah-name">LNSC 全链发货平台</span><span class="ah-ver">v1.0</span>' +
    '      <span class="ah-sub">录单 → 下单 → 清单 → SAP → 标签，发货全链路过程管理</span></div>' +
    '    <div class="rel-head"><span class="rel-ver">v1.0</span><span class="rel-date">2026-09 · 当前版本</span></div>' +
    '    <ul>' +
    '      <li><b>录单</b>　地址粘贴 / 截图 OCR 识别 → 省市区三级联动确认；发货单 DN 必填（SO 选填）、外协单 PO+采购员、其他发件员工分类型必填；行内编辑回填；常用地址池（通讯录弹窗一键回填）；附件按 DN 归档到 <code>Upload/&lt;DN&gt;/</code>，可多文件上传、× 删除</li>' +
    '      <li><b>下单</b>　DN 区类型过滤（DN发货单 / PO外协单 / 个人其他）+ 两行 chip 显示收发件双方；四套面单模板（顺丰 / 德邦 / 跨越 / 专车·自提）；多选批量下单 + 扫码枪定位；「查看」列格式图标：PDF 直接预览打印、Excel 本地程序打开、图片（PNG/JPG）弹窗预览</li>' +
    '      <li><b>清单 / SAP / 标签</b>　清单全列模糊搜索；SAP B1「交货-清单」视图（待接 Service Layer）；标签平台（SAP 标签管理平台并入：模板/规则/客户/打印历史，左侧导航进入；2026-10-12 追溯页已移除）</li>' +
    '      <li><b>数据</b>　SQLite 单文件持久化（server.py :8091，每日备份），API 离线自动回退内置 mock 演示；五页顶部栏统一（时钟 / 主题 / API 状态点）</li>' +
    '    </ul>' +
    '    <div class="about-principle"><b>技术原则</b>　前端纯静态（无框架无构建），后端 Python 标准库零依赖；内网运行，数据不出厂；承运商 API（丰桥 / 德邦 / 跨越）预留 carriers.env 密钥接入</div>' +
    '    <div class="about-support">支持：<a href="mailto:lorenz.zhang@lechler.com.cn">lorenz.zhang@lechler.com.cn</a>' +
    '      <a href="https://teams.microsoft.com/l/chat/0/0?users=lorenz.zhang@lechler.com.cn" target="_blank" rel="noopener">Teams 对话</a>' +
    '      <span class="chip">分机 8021</span></div>' +
    '  </div>' +
    '</div>';
  document.body.appendChild(mask);
  btn.addEventListener("click", () => { mask.hidden = false; });
  mask.addEventListener("click", e => { if (e.target === mask) mask.hidden = true; });
  mask.querySelector(".about-x").addEventListener("click", () => { mask.hidden = true; });
})();
/* ----- 提示弹窗（全页面统一注入；替代浏览器原生 alert；2026-10-26 用户要求） -----
   用法：themeAlert("文本") / themeAlert("文本", { title: "提示", ok: "知道了" })
        带图标的多条提示：themeAlert(msg, { rows: [ { icon: "lock", tone: "warn", text: "…" }, … ] })，有 rows 时按行渲染图标，msg 仅作纯文本兜底
        icon 取内置集 lock / ban / warn / bulb / info / truck / check；tone 取 warn（红）/ hint（淡）/ ok（绿）
   主题边框同运单弹窗；× / 知道了 / 点遮罩 / Enter / Esc 关闭，关闭后焦点回到原处；
   同一时刻只保留一个（重复调用先收掉旧窗并 resolve 其 Promise），返回 Promise */
(function () {
  const mask = document.createElement("div");
  mask.className = "steps-mask";
  mask.id = "taMask";
  mask.hidden = true;
  mask.innerHTML =
    '<div class="steps-modal ta-modal">' +
    '  <div class="steps-head"><b id="taTitle">提示</b>' +
    '    <button class="steps-close" id="taX" type="button" title="关闭">×</button></div>' +
    '  <div class="ta-body" id="taBody"></div>' +
    '  <div class="ta-btns"><button class="btn pass-ok" id="taOk" type="button">知道了</button></div>' +
    '</div>';
  document.body.appendChild(mask);
  const titleEl = mask.querySelector("#taTitle");
  const bodyEl = mask.querySelector("#taBody");
  const okBtn = mask.querySelector("#taOk");
  const xBtn = mask.querySelector("#taX");
  let done = null;              /* 当前弹窗的 resolve（null = 未打开） */
  let lastFocus = null;         /* 关闭后焦点回落（键盘 / 扫码枪流程不丢位置） */

  function close() {
    if (!done) return;
    const fn = done;
    done = null;
    mask.hidden = true;
    document.removeEventListener("keydown", onKey, true);
    okBtn.onclick = xBtn.onclick = mask.onclick = null;
    if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus();
    fn();
  }

  function onKey(e) {           /* 捕获阶段拦截：弹窗打开时页面快捷键不响应 */
    if (mask.hidden) return;
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault(); e.stopPropagation(); close();
    }
  }

  /* 内置图标集（feather 风格线性图标，与顶栏按钮一致；仅此处常量参与 innerHTML） */
  const ICONS = {
    lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    ban: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    check: '<circle cx="12" cy="12" r="10"/><polyline points="16 8 11 14 8 11"/>'
  };
  function iconSvg(name) {
    const p = ICONS[name];
    if (!p) return "";
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* 多条提示：每条一行「图标 + 文本」，图标随语气着色（warn=红、hint=主题淡色、ok=绿） */
  function renderRows(rows) {
    bodyEl.textContent = "";
    const wrap = document.createElement("div");
    wrap.className = "ta-rows";
    rows.forEach(r => {
      r = r || {};
      const row = document.createElement("div");
      row.className = "ta-row" + (r.tone ? " ta-" + r.tone : "");
      const ico = document.createElement("span");
      ico.className = "ta-ico";
      ico.innerHTML = iconSvg(r.icon);          /* 只拼内置常量，用户文本一律 textContent */
      const tx = document.createElement("div");
      tx.className = "ta-tx";
      tx.textContent = String(r.text == null ? "" : r.text);
      row.appendChild(ico);
      row.appendChild(tx);
      wrap.appendChild(row);
    });
    bodyEl.appendChild(wrap);
  }

  function themeAlert(msg, opt) {
    opt = opt || {};
    close();                    /* 已有弹窗：先收掉，避免叠窗与悬空 Promise */
    titleEl.textContent = opt.title || "提示";
    const rows = Array.isArray(opt.rows) ? opt.rows : null;
    if (rows && rows.length) renderRows(rows);              /* 带图标的多条提示（图标集内置，文本仍走 textContent） */
    else bodyEl.textContent = String(msg == null ? "" : msg);   /* 纯文本：消息含 DN/单号不解析 HTML */
    okBtn.textContent = opt.ok || "知道了";
    lastFocus = document.activeElement;
    mask.hidden = false;
    document.addEventListener("keydown", onKey, true);
    okBtn.onclick = close;
    xBtn.onclick = close;
    mask.onclick = e => { if (e.target === mask) close(); };
    setTimeout(() => { if (!mask.hidden) okBtn.focus(); }, 30);   /* 可直接回车关闭 */
    return new Promise(res => { done = res; });
  }

  window.themeAlert = themeAlert;
})();
