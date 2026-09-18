/* ============================================================
 * LNSC 全链发货平台 - 顶部栏共享脚本（全页面）
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

/* ----- 设置弹窗（全页面统一注入：承运商启用开关 + 数据维护） ----- */
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
    '    <div class="set-sec" style="margin-top:16px">数据维护</div>' +
    '    <div class="set-row"><span>清空订单表（功能已停用，防误清真实数据）</span>' +
    '<button class="btn set-clear" type="button" disabled>立即清空</button></div>' +   /* 2026-09-16 用户规则：灰色禁用不可点 */
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
  /* 清除模拟数据：调服务端清空订单表 */
  mask.querySelector(".set-clear").addEventListener("click", async () => {
    if (!confirm("确定清除全部订单数据？\n（清空数据库 orders 表，不可恢复）")) return;
    let lastStatus = 0, offline = 0;
    for (const base of ["../api", `${location.protocol}//${location.hostname}:8091/api`]) {
      try {
        const r = await fetch(base + "/admin/clear-orders", { method: "POST", signal: AbortSignal.timeout(5000) });   /* 5s 超时防假死 */
        if (r.ok) {
          const d = await r.json();
          alert("已清除 " + d.deleted + " 条数据");
          location.reload();
          return;
        }
        lastStatus = r.status;   /* 接口可达但拒绝（如 404 未部署） */
      } catch (e) { offline++; /* 网络不可达，尝试下一个 */ }
    }
    alert(lastStatus
      ? `清除失败（${lastStatus}）：服务器接口未部署或版本过旧\n请更新 server.py 并重启 fahuo-api`
      : "清除失败：API 离线（本地预览模式无数据库可清）");
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
    '      <span class="ah-sub">录单 → 下单 → 清单 → SAP → 可视化，发货全链路过程管理</span></div>' +
    '    <div class="rel-head"><span class="rel-ver">v1.0</span><span class="rel-date">2026-09 · 当前版本</span></div>' +
    '    <ul>' +
    '      <li><b>录单</b>　地址粘贴 / 截图 OCR 识别 → 省市区三级联动确认；发货单 DN 必填（SO 选填）、外协单 PO+采购员、其他发件员工分类型必填；行内编辑回填；常用地址池（通讯录弹窗一键回填）；附件按 DN 归档到 <code>Upload/&lt;DN&gt;/</code>，可多文件上传、× 删除</li>' +
    '      <li><b>下单</b>　DN 区类型过滤（DN发货单 / PO外协单 / 个人其他）+ 两行 chip 显示收发件双方；四套面单模板（顺丰 / 德邦 / 跨越 / 专车·自提）；多选批量下单 + 扫码枪定位；「查看」列格式图标：PDF 直接预览打印、Excel 本地程序打开</li>' +
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
