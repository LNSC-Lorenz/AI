/* ============================================================
 * LNSC 全链发货平台 - 右侧统计看板（全页面共享）
 * API 在线：实时统计；离线：mock.js 快照；数字两位占位显示
 * ============================================================ */
(function () {
  "use strict";
  const CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];

  function render(s) {
    const els = document.querySelectorAll(".stat-value");
    [s.yesterday_shipped, s.today_pending, s.overdue, s.planned, s.returned]
      .forEach((v, i) => {
        if (els[i] && v != null) els[i].textContent = String(v).padStart(2, "0");
      });
  }

  (async () => {
    for (const base of CANDIDATES) {
      try {
        const r = await fetch(base + "/stats", { signal: AbortSignal.timeout(5000) });   /* 5s 超时：候选地址被防火墙丢包时快速失败，防页面假死 */
        if (r.ok) { render(await r.json()); return; }
      } catch (e) { /* 尝试下一个候选地址 */ }
    }
    if (typeof MOCK_STATS !== "undefined") render(MOCK_STATS);
  })();

  /* ----- 统计卡点击 → 跳转清单模式并按该口径筛选 ----- */
  const FLOWS = ["shipped_yesterday", "pending_today", "overdue", "planned", "returned_today"];
  document.querySelectorAll(".sidebar-right .stat").forEach((el, i) => {
    if (!FLOWS[i]) return;
    el.style.cursor = "pointer";
    el.title = "点击在清单模式中查看：" + el.querySelector(".stat-label").textContent;
    el.addEventListener("click", () => { location.href = "3-list.html?f=" + FLOWS[i]; });
  });
})();
