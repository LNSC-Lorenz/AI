/* ============================================================
 * LNSC 发货全链系统 - 清单模式
 * 整合录单/下单全部列 + 回单日期 + 顶部搜索 + 统计口径筛选(?f=)
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
/* 备注列只显示收件区纯备注：剥离入库时拼接的发件方结构化标签 */
const cleanNote = n => (n || "")
  .replace(/PO：\S+|采购员：\S+|发件人：\S+(?:\s+\d+)?|附件：\S+/g, "").trim();
const API_CANDIDATES = ["api", `${location.protocol}//${location.hostname}:8091/api`];
let orders = [];
let baseList = [];   /* 统计口径筛选后的基础集合（搜索在其内进行） */

/* ----- 数据加载：API 在线优先，离线回退 mock.js 快照 ----- */
async function fetchOrders() {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/orders");
      if (r.ok) { markApi(true, base); return await r.json(); }
    } catch (e) { /* 尝试下一个 */ }
  }
  markApi(false);
  return (typeof MOCK_ORDERS !== "undefined") ? MOCK_ORDERS : [];
}

/* ----- 统计口径筛选（对应右侧看板四卡） ----- */
const dayOf = s => (s || "").slice(0, 10);
const TODAY = new Date().toLocaleDateString("sv-SE");
const YESTERDAY = new Date(Date.now() - 864e5).toLocaleDateString("sv-SE");
const FILTERS = {
  shipped_yesterday: { label: "昨日发货",
    fn: o => o.status === "shipped" && (!o.shipped_at || dayOf(o.shipped_at) === YESTERDAY) },
  pending_today: { label: "今日待发货",
    fn: o => o.status === "pending" && o.ship_date === TODAY },
  overdue: { label: "超时未发货",
    fn: o => o.status === "pending" && o.ship_date && o.ship_date < TODAY },
  planned: { label: "计划发货",
    fn: o => o.status === "pending" && o.ship_date > TODAY },
  returned_today: { label: "今日回单",
    fn: o => o.status === "returned" && (!o.returned_at || dayOf(o.returned_at) === TODAY) }
};
const activeFilter = FILTERS[new URLSearchParams(location.search).get("f")] || null;

/* ----- 渲染（10 列，含回单日期） ----- */
function renderRows(list) {
  const body = $("listBody");
  body.innerHTML = "";
  list.forEach(o => {
    const tr = document.createElement("tr");
    [o.so || "", o.so_no || "—", o.priority || "一般", o.order_type || "发货单", o.address || "", o.name || "", o.phone || "", cleanNote(o.note),
     o.carrier || "", o.waybill_no || "—",
     o.waybill_no ? "已下单" : "待下单", o.route_status || "—",
     dayOf(o.returned_at) || "—"
    ].forEach(v => {
      const td = document.createElement("td");
      td.textContent = v;
      if (v === "紧急") td.classList.add("prio-hot"); /* 紧急加粗 */
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("lmCount").innerHTML = activeFilter
    ? `<span class="lm-tag">${activeFilter.label}</span>：共 ${list.length} 单 <a href="list.html">✕ 清除筛选</a>`
    : `共 ${list.length} 单`;
}

/* ----- 视图过滤：优先级按钮组（单选） + 搜索（在统计口径基础集合内） ----- */
let activePrio = "";

function applyView() {
  let list = baseList;
  if (activePrio) {
    list = list.filter(o => (o.priority || "一般") === activePrio);
  }
  const q = $("lmSearch").value.trim().toLowerCase();
  if (q) {
    list = list.filter(o =>
      [o.so, o.so_no, o.priority, o.order_type, o.address, o.name, o.phone, o.note, o.carrier,
       o.waybill_no, o.route_status, o.waybill_no ? "已下单" : "待下单",
       dayOf(o.returned_at)]
        .join(" ").toLowerCase().includes(q));
  }
  renderRows(list);
}

document.querySelectorAll(".lm-prio .prio").forEach(b => {
  b.addEventListener("click", () => {
    const was = b.classList.contains("active");
    document.querySelectorAll(".lm-prio .prio").forEach(x => x.classList.remove("active"));
    activePrio = was ? "" : b.dataset.p;   /* 单选互斥；再点取消=全部 */
    if (activePrio) b.classList.add("active");
    applyView();
  });
});
$("lmSearch").addEventListener("input", applyView);

/* ----- 初始化 ----- */
(async () => {
  orders = await fetchOrders();
  baseList = activeFilter ? orders.filter(activeFilter.fn) : orders;
  applyView();
})();
