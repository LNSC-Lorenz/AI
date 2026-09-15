/* ============================================================
 * LNSC 全链发货平台 - 清单模式
 * 整合录单/下单全部列 + 回单日期 + 顶部搜索 + 统计口径筛选(?f=)
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
/* 备注列只显示收件区纯备注：剥离入库时拼接的发件方结构化标签 */
const cleanNote = n => (n || "")
  .replace(/PO：\S+|采购员：\S+|发件人：\S+(?:\s+\d+)?|附件：\S+/g, "").trim();
const API_CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];
let orders = [];
let baseList = [];   /* 统计口径筛选后的基础集合（搜索在其内进行） */

/* ----- 数据加载：API 在线优先，离线显示空（正式模式无模拟数据） ----- */
async function fetchOrders() {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/orders", { signal: AbortSignal.timeout(5000) });   /* 5s 超时防假死 */
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

/* 单号前缀显示：DN=82600 / SO=32600 小号上标加粗，剩余位加粗（2026-09-15 用户规则） */
const preHtml = (s, pre) => {
  s = s || "--------";
  return s.startsWith(pre)
    ? '<span class="dn-pre">' + pre + '</span><b>' + s.slice(pre.length) + "</b>"
    : "<b>" + s + "</b>";
};
const dnHtml = dn => preHtml(dn, "82600");
const soHtml = so => preHtml(so, "32600");

/* 姓名+电话两行（2026-09-15 用户规则：电话换行显示在姓名下） */
function fillNameCell(td, o) {
  const d1 = document.createElement("div"); d1.textContent = o.name || "";
  td.appendChild(d1);
  if (o.phone) { const d2 = document.createElement("div"); d2.textContent = o.phone; td.appendChild(d2); }
}

/* 地址两行显示（2026-09-15 用户规则）：省市区一行（直辖市去重），街道详情一行 */
function addrLines(o) {
  const p = [];
  for (const x of [o.province, o.city, o.district]) if (x && p[p.length - 1] !== x) p.push(x);
  return [p.join(""), o.street || ""];
}
function fillAddrCell(td, o) {
  const [l1, l2] = addrLines(o);
  const d1 = document.createElement("div"); d1.textContent = l1 || (o.address || "");
  td.appendChild(d1);
  if (l2) { const d2 = document.createElement("div"); d2.textContent = l2; td.appendChild(d2); }
}

/* ----- 渲染（10 列，含回单日期） ----- */
function renderRows(list) {
  const body = $("listBody");
  body.innerHTML = "";
  list.forEach(o => {
    const tr = document.createElement("tr");
    /* 优先级+类型合并一列（第3列，无列标题；2026-09-15 用户规则）：行1优先级（紧急加粗）、行2类型 */
    [o.so || "", o.so_no || "—", null, o.address || "", o.name || "", cleanNote(o.note),
     o.waybill_no || "—",
     o.waybill_no ? "已下单" : "待下单", o.route_status || "—",
     dayOf(o.returned_at) || "—"
    ].forEach((v, i) => {
      const td = document.createElement("td");
      if (i === 2) {                                   /* 合并列：优先级/类型 两行 */
        const d1 = document.createElement("div");
        d1.textContent = o.priority || "一般";
        if (d1.textContent === "紧急") d1.classList.add("prio-hot");
        td.appendChild(d1);
        const d2 = document.createElement("div"); d2.textContent = o.order_type || "发货单";
        td.appendChild(d2);
      }
      else if (i === 3) fillAddrCell(td, o);   /* 地址列（第4列）：两行 */
      else if (i === 0) td.innerHTML = dnHtml(o.so);   /* DN 列：前缀上标 */
      else if (i === 1) td.innerHTML = soHtml(o.so_no || "—");   /* SO 列：32600 前缀上标 */
      else if (i === 4) fillNameCell(td, o);   /* 姓名列（第5列）：姓名+电话两行 */
      else if (i === 6) {                        /* 单号列（第7列）：运单号 + 最新路由同格第二行
                                                    （与号码同一高度块，nowrap 跨列延伸不裁剪；2026-09-15 用户版式） */
        td.classList.add("rt-over");
        const wb = document.createElement("div"); wb.textContent = v;
        td.appendChild(wb);
        if (o.route_latest) {
          const r = document.createElement("div");
          r.className = "rt-line";
          r.textContent = o.route_latest;
          td.appendChild(r);
        }
      }
      else td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("lmCount").innerHTML = activeFilter
    ? `<span class="lm-tag">${activeFilter.label}</span>：共 ${list.length} 单 <a href="3-list.html">✕ 清除筛选</a>`
    : `共 ${list.length} 单`;
}

/* ----- 视图过滤：类型/优先级按钮组（单选，可组合） + 搜索（在统计口径基础集合内） ----- */
let activePrio = "";
let activeType = "";

function applyView() {
  let list = baseList;
  if (activeType) {
    list = list.filter(o => (o.order_type || "发货单") === activeType);
  }
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
document.querySelectorAll(".lm-type .otype").forEach(b => {
  b.addEventListener("click", () => {
    const was = b.classList.contains("active");
    document.querySelectorAll(".lm-type .otype").forEach(x => x.classList.remove("active"));
    activeType = was ? "" : b.dataset.t;   /* 单选互斥；再点取消=全部；与优先级组合 */
    if (activeType) b.classList.add("active");
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
