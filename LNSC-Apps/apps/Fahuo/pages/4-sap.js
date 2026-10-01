/* ============================================================
 * LNSC 全链发货平台 - SAP模式：SAP 交货单（DN）清单
 * 数据：当前为本地订单库模拟（DN=so）；对接 B1 时替换 fetchOrders 为
 *       Service Layer: GET /DeliveryNotes?$filter=DocumentStatus eq 'O'
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
const API_CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];
let orders = [];

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

/* ----- 映射为我方 DN 行（SAP 风格字段） ----- */
function toSapRow(o) {
  const dn = o.so || "";
  /* 客户名称：取地址末段的公司/单位，无则显示联系人 */
  const segs = (o.address || "").split(" ");
  const company = /公司|大厦|园区|中心|广场|工厂|集团/.test(segs[segs.length - 1])
    ? segs[segs.length - 1] : (o.name || "--");
  return {
    dn,
    soNo: o.so_no || "—",                              /* SO 号 */
    cust: "C" + dn.slice(-5),                         /* 模拟客户代码 */
    custName: company,
    date: o.ship_date || "--",                        /* 过账日期≈要求发货日期 */
    open: o.status !== "returned",                    /* 回单签收=已清 */
    total: (500 + (parseInt(dn, 10) || 0) % 9000).toFixed(2), /* 模拟金额 */
    prio: o.priority || "一般",
    otype: o.order_type || "发货单",
    carrier: o.carrier || "—",
    waybill: o.waybill_no || "—",
    exp: o.waybill_no
      ? (o.status === "shipped" ? "已发货" : o.status === "returned" ? "已回单" : "已下单")
      : "未下单"
  };
}

/* 单号前缀显示：DN=82600 / SO=32600 小号上标加粗，剩余位加粗（2026-09-15 用户规则） */
const preHtml = (s, pre) => {
  s = s || "--------";
  return s.startsWith(pre)
    ? '<span class="dn-pre">' + pre + '</span><b>' + s.slice(pre.length) + "</b>"
    : "<b>" + s + "</b>";
};
const dnHtml = dn => preHtml(dn, "82600");
const soHtml = so => preHtml(so, "32600");

function render(list) {
  const body = $("sapBody");
  body.innerHTML = "";
  list.forEach(r => {
    const tr = document.createElement("tr");
    if (r.prio === "紧急") tr.classList.add("row-urgent");   /* 紧急行加粗红字（2026-09-20 用户规则；优先级列已移除） */
    [r.dn, r.soNo, r.cust, r.custName, r.date,
     r.open ? "未清" : "已清", r.total, r.otype, r.carrier, r.waybill, r.exp
    ].forEach((v, i) => {
      const td = document.createElement("td");
      if (i === 0) td.innerHTML = dnHtml(v);        /* DN 列：82600 前缀上标 */
      else if (i === 1) td.innerHTML = soHtml(v);   /* SO 列：32600 前缀上标 */
      else td.textContent = v;
      if (i === 6) td.className = "num";
      if (i === 5 && r.open) td.className = "sap-open-td";
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("sapCount").textContent = `共 ${list.length} 张交货单　|　就绪`;
}

/* ----- 筛选 ----- */
function applyFilter() {
  const st = $("sapStatus").value;
  const q = $("sapCust").value.trim().toLowerCase();
  let list = orders.map(toSapRow);
  if (st === "open") list = list.filter(r => r.open);
  if (st === "closed") list = list.filter(r => !r.open);
  if (q) list = list.filter(r =>
    (r.cust + " " + r.custName).toLowerCase().includes(q));
  render(list);
}
$("sapStatus").addEventListener("change", applyFilter);
$("sapCust").addEventListener("input", applyFilter);
$("sapRefresh").addEventListener("click", init);

/* ----- 初始化 ----- */
async function init() {
  orders = await fetchOrders();
  applyFilter();
}
init();
