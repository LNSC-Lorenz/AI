/* ============================================================
 * LNSC 发货全链系统 - 顶部栏共享脚本（全页面）
 * 实时时钟：时间每秒刷新 + 日期
 * 主题颜色选择：黑白 / 蓝色（localStorage 记忆）
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
    tr.insertBefore(mk("blue", "#1D459F", "蓝色模式"), anchor);
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
    '    <div class="about-hero"><span class="ah-name">LNSC 发货全链系统</span><span class="ah-ver">v1.0</span>' +
    '      <span class="ah-sub">录单 → 下单 → 清单 → SAP → 可视化，发货全链路过程管理</span></div>' +
    '    <div class="rel-head"><span class="rel-ver">v1.0</span><span class="rel-date">2026-09 · 当前版本</span></div>' +
    '    <ul>' +
    '      <li><b>录单</b>　地址粘贴 / 截图 OCR 识别 → 省市区三级联动确认；发货单 SO+DN、外协单 PO+采购员、其他发件员工分类型必填；行内编辑回填；常用地址池（通讯录弹窗一键回填）；附件按 DN 归档到 <code>Upload/&lt;DN&gt;/</code>，可多文件上传、× 删除</li>' +
    '      <li><b>下单</b>　DN 区类型过滤（DN发货单 / PO外协单 / 个人其他）+ 两行 chip 显示收发件双方；四套面单模板（顺丰 / 德邦 / 跨越 / 专车·客户自提）；多选批量下单 + 扫码枪定位；「查看」列格式图标：PDF 直接预览打印、Excel 本地程序打开</li>' +
    '      <li><b>清单 / SAP / 可视化</b>　清单全列模糊搜索；SAP B1「交货-清单」视图（待接 Service Layer）；可视化点阵看板（优先级环 / 在途环 / 专车），60s 自动刷新</li>' +
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
