/* ============================================================
 * LNSC 发货全链系统 - SAP模式：SAP 交货单（DN）清单
 * 数据：当前为本地订单库模拟（DN=so）；对接 B1 时替换 fetchOrders 为
 *       Service Layer: GET /DeliveryNotes?$filter=DocumentStatus eq 'O'
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
const API_CANDIDATES = ["api", `${location.protocol}//${location.hostname}:8091/api`];
let orders = [];

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

function render(list) {
  const body = $("sapBody");
  body.innerHTML = "";
  list.forEach(r => {
    const tr = document.createElement("tr");
    [r.dn, r.soNo, r.cust, r.custName, r.date,
     r.open ? "未清" : "已清", r.total, r.prio, r.otype, r.carrier, r.waybill, r.exp
    ].forEach((v, i) => {
      const td = document.createElement("td");
      td.textContent = v;
      if (i === 6) td.className = "num";
      if (i === 5 && r.open) td.className = "sap-open-td";
      if (v === "紧急") td.classList.add("prio-hot"); /* 紧急加粗 */
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
