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
