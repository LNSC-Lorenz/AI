/* ============================================================
 * LNSC 全链发货平台 - 打单模式
 * 左：130 面单预览 | 右上：DN 平铺选择 | 右中：顺丰设置 | 右下：打单列表
 * ============================================================ */
"use strict";

/* ----- 数据加载：API 在线优先，离线显示空（正式模式无模拟数据） ----- */
const API_CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];
let apiBase = null;   /* 在线时的 API 基址（用于承运商修改写回） */

async function fetchOrders() {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/orders", { signal: AbortSignal.timeout(5000) });   /* 5s 超时防假死 */
      if (r.ok) { apiBase = base; return await r.json(); }
    } catch (e) { /* 尝试下一个 */ }
  }
  return (typeof MOCK_ORDERS !== "undefined") ? MOCK_ORDERS : [];
}

/* ----- 面单元素 ----- */
const $ = id => document.getElementById(id);
const dnList = $("dnList"), printBody = $("printBody");
let orders = [];
let multiMode = false;   /* 多选模式（批量修改/批量下单） */

/* 当前选中的订单（多选=全部，单选=1 条） */
function selectedOrders() {
  return [...dnList.querySelectorAll(".pw-chip.active")]
    .map(c => orders[+c.dataset.idx])
    .filter(Boolean);
}

/* ----- 取消下单模式（2026-09-16 用户规则）：当前激活列表行 = 已下单且未揽收
   （路由状态=待揽收，或专车/自提厂内单）时，下单按钮变为"取消下单"；
   取消后单回待下单：可在录单页改数据，或在此改承运参数后重新下单 ----- */
function cancelTargetOf() {
  const row = printBody.querySelector("tr.row-active");
  if (!row) return null;
  const o = orders[+row.dataset.idx];
  if (!o || !o.waybill_no) return null;
  const rs = o.route_status || "待揽收";
  if (rs === "待揽收" || ["专车", "自提"].includes(o.carrier || "")) return o;
  return null;
}
function refreshOrderBtn() {
  const b = $("btnOrder");
  const cancel = !!cancelTargetOf();
  /* 取消模式显式两行「取消/下单」（方钮宽度 3 字会折成 取消下/单；2026-09-16 用户规则） */
  b.innerHTML = cancel ? "取消<br>下单" : "下单";
  b.classList.toggle("cancel", cancel);
  /* 选中行已下单且不可取消（运送中/已揽收/派送中/已签收）：下单按钮置灰禁用，防重复下单
     （2026-09-18 用户规则）；待揽收行=取消下单模式可点、待下单行=正常下单可点 */
  const row = printBody.querySelector("tr.row-active");
  const o = row ? orders[+row.dataset.idx] : null;
  b.disabled = !!(o && o.waybill_no && !cancel);
}

/* ----- 三方联动：面单 / DN按钮 / 列表行 ----- */
function syncSelect(idx) {
  const chip = dnList.querySelector(`.pw-chip[data-idx="${idx}"]`);
  const row  = printBody.querySelector(`tr[data-idx="${idx}"]`);
  if (!row || !orders[idx]) return;
  if (!chip) {
    /* 已下单（已移出 DN 队列，无 chip）：联动左侧面单/时间线查看；
       多选状态下保留已选 chips（查看不清空批量选择） */
    if (!multiMode) dnList.querySelectorAll(".pw-chip").forEach(c => c.classList.remove("active"));
    printBody.querySelectorAll("tr").forEach(r => r.classList.remove("row-active"));
    row.classList.add("row-active");
    fillBill(orders[idx]);
    row.scrollIntoView({ block: "nearest" });
    refreshOrderBtn();   /* 已下单未揽收行 → 按钮变"取消下单" */
    return;
  }
  if (multiMode) {
    chip.classList.toggle("active");
    row.classList.toggle("row-active", chip.classList.contains("active"));
  } else {
    dnList.querySelectorAll(".pw-chip").forEach(c => c.classList.remove("active"));
    printBody.querySelectorAll("tr").forEach(r => r.classList.remove("row-active"));
    chip.classList.add("active");
    row.classList.add("row-active");
  }
  if (chip.classList.contains("active")) {
    fillBill(orders[idx]);
  } else {
    /* 多选取消：面单改随剩余选中项的最后一单，避免残留已取消的单 */
    const actives = dnList.querySelectorAll(".pw-chip.active");
    if (actives.length) fillBill(orders[+actives[actives.length - 1].dataset.idx]);
  }
  chip.scrollIntoView({ block: "nearest" });
  row.scrollIntoView({ block: "nearest" });
  refreshOrderBtn();   /* 选择变化 → 下单/取消下单 按钮状态刷新 */
}

/* ----- 承运商模板切换（设置区单行自适应；专车/自提共用厂内送货单模板） ----- */
const CARRIERS = ["顺丰", "德邦", "跨越", "专车", "自提"];
const TPL = { "顺丰": "billSF", "德邦": "billDB", "跨越": "billKY", "专车": "billOT", "自提": "billOT" };
/* 各承运商可选产品（对应下单元素） */
const PRODUCTS = {
  "顺丰": ["顺丰标快", "顺丰特快", "顺丰卡航", "同城半日达"],
  "德邦": ["快递标准件", "大件快递 3.60", "精准卡航", "精准汽运"],   /* 默认快递标准件（用户指定；对应后端 transportType=PACKAGE） */
  "跨越": ["次日达", "当天达", "隔日达"],
  "专车": ["整车直送", "零担专线", "同城专车"],
  "自提": ["自提", "自提+代装车"]
};
let currentCarrier = "顺丰";

/* 产品写入当前承运商面单的下单元素 */
function applyProduct(p) {
  document.querySelectorAll(`#${TPL[currentCarrier]} .f-product`)
    .forEach(el => el.textContent = p);
}

function setCarrier(c) {
  if (!TPL[c]) return;
  const changed = (currentCarrier !== c);   /* 仅切换承运商时才重置设置，避免覆盖用户选择 */
  currentCarrier = c;
  document.querySelectorAll(".pw-cb").forEach(b =>
    b.classList.toggle("active", b.dataset.c === c));
  /* 专车/自提共用 billOT：先全隐藏再显示当前模板 */
  Object.values(TPL).forEach(id => { $(id).hidden = true; });
  $(TPL[c]).hidden = false;
  /* 专车/自提：面单框切 76×130 原生比例（预览与打印同尺寸；2026-09-16 用户规则） */
  $("pwBill").classList.toggle("ot76130", TPL[c] === "billOT");
  /* 拍照回传：顺丰增值服务（isSignBack=2，2026-09-17 探针实测），仅顺丰可勾选；
     其他承运商禁用并强制取消勾选（用户规则：其他情况不可选）；已下单锁定时同样禁用 */
  const photoOk = c === "顺丰";
  $("cfgReceiptPhoto").disabled = !photoOk || settingsLocked;
  if (!photoOk) $("cfgReceiptPhoto").checked = false;
  if (TPL[c] === "billOT") {
    /* 厂内送货单：标题与编号占位随 专车/自提 切换 */
    $("billOT").querySelector(".f-ot-title").textContent = c === "自提" ? "自提单" : "专车直送单";
    const wb = $("billOT").querySelector(".f-waybill");
    wb.textContent = (c === "自提" ? "ZT" : "ZC") + " 0000 0000 0000";
    delete wb.dataset.def;                        /* fillBill 重新缓存默认占位 */
  }
  if (changed) {
    /* 产品下拉按承运商重建并写入面单 */
    $("cfgProduct").innerHTML = PRODUCTS[c].map(p => `<option>${p}</option>`).join("");
    applyProduct($("cfgProduct").value);
    /* 重量/体积输入已随 cfgWV 移除（2026-09-17 数量替代）；残留引用会 null 崩溃——
       曾致点行后 refreshOrderBtn 不执行、"取消下单"按钮不显示（用户反馈） */
  }
}

/* 回签单两个选项可同时勾选（2026-09-18 用户规则，取消互斥）：
   顺丰侧都勾 → isSignBack=2（=2 与 =1 同样返 type=3 回单运单，纸质流程已含；
   =3 组合值实测被静默忽略——探针 _sf_signback3_probe，勿用） */

/* ----- 面单填充（三套模板同名字段一起更新，只显示当前模板） ----- */
function setAll(cls, text) {
  document.querySelectorAll("#pwBill " + cls).forEach(el => { el.textContent = text; });
}
function fillBill(o) {
  /* 回签单联动：发货单默认勾选纸质回单（2026-09-16 用户规则），其他类型不勾；拍照回传默认不勾 */
  $("cfgReceiptPaper").checked = (o.order_type || "发货单") === "发货单";
  $("cfgReceiptPhoto").checked = false;
  setAll(".f-name",  o.name  || "---");
  /* 丰密面单：手机号中间 4 位脱敏显示 */
  const masked = (o.phone || "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
  setAll(".f-phone", masked || "-----------");
  setAll(".f-addr",  o.address || "--");
  setAll(".f-dn",    o.so    || "--------");
  /* 运单备注位：发货单补 SO，外协单补 PO（仅面单打印显示） */
  setAll(".f-so",    o.so_no ? "　SO：" + o.so_no : (poOf(o) ? "　PO：" + poOf(o) : ""));
  /* 目的市：优先 city 字段（直辖市=city 即省名），否则从地址文本取第二段 */
  setAll(".f-dest",  o.city || (o.address || "").split(" ")[1] || "--");
  /* 路由代码（面单大字号位 = 承运商目的地分拣码）：取顺丰下单返回的真实路由码
     （order_resp.label_info.destRouteLabel/codingMapping，如 359/WU）；取不到显示 "--"——
     零模拟原则：不再用 DN 生成假路由码（原"模拟路由代码"0100 残留，2026-09-15 清除） */
  let routeCode = "--";
  try {
    const rd = JSON.parse(o.order_resp || "{}");
    routeCode = (rd.label_info && (rd.label_info.destRouteLabel || rd.label_info.codingMapping)) || "--";
  } catch (e) { /* 无下单返回值记录 */ }
  setAll(".f-route", routeCode);
  /* 运单号：已下单显示真实单号，未下单显示各模板默认占位（SF/DPK/KY） */
  document.querySelectorAll("#pwBill .f-waybill").forEach(el => {
    if (!el.dataset.def) el.dataset.def = el.textContent;
    el.textContent = o.waybill_no || el.dataset.def;
  });
  const t = new Date();
  setAll(".f-date", `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`);
  if (o.carrier && TPL[o.carrier]) setCarrier(o.carrier); /* 承运商从录单带入 */
  lockOrderSettings(false);            /* 先解锁：计数器 set() 走按钮 click，锁定态会被吞（2026-09-18） */
  syncOrderSettings(o);   /* 承运商设置随行同步（2026-09-18 用户规则） */
  lockOrderSettings(!!o.waybill_no);   /* 已下单行：回显但锁定不可编辑（2026-09-18 用户规则） */
  renderTrack(o);   /* 已下单：左下面单下方显示真实路由时间线（最新节点） */
}

/* 设置区锁定（2026-09-18 用户规则：选中已下单运单 → 设置回显但不可编辑；
   选中待下单行/下完新单切下一票 → 自动解锁）。锁定仅防误改——已下单单的设置改了对它无效 */
let settingsLocked = false;
function lockOrderSettings(locked) {
  settingsLocked = locked;
  ["cfgProduct", "cfgPay", "cfgInsure", "cfgCargo",
   "cfgReceiptPaper", "cfgParcelsN", "cfgQtyN"]
    .forEach(id => { $(id).disabled = locked; });
  /* 件数方框/步进箭头/数量方框（按钮无 id，按类批量） */
  document.querySelectorAll(".pc-num, .pc-step-btn, .qc-num")
    .forEach(b => { b.disabled = locked; });
  /* 拍照回传：顺丰门控与锁定联合（顺丰 且 未锁定 才可勾） */
  $("cfgReceiptPhoto").disabled = locked || currentCarrier !== "顺丰";
}

/* 选中已下单行：承运商设置回显（2026-09-18 用户规则：列表选中某个已下单运单，承运商设置同步到设置区）——
   优先 order_resp.settings 快照（2026-09-18 起下单时存档：产品/付款/保价/托寄物/回签单/件数/数量）；
   老单（无快照）回退：件数/数量取承运商响应存档 rd.parcels/qty；产品按 label_info.proCode 尽力匹配选项 */
function syncOrderSettings(o) {
  let rd = {};
  try { rd = JSON.parse(o.order_resp || "{}"); } catch (e) { /* 无下单返回记录 */ }
  const s = rd.settings || {};
  const cc = o.carrier || currentCarrier;
  const opts = PRODUCTS[cc] || [];
  /* 产品：快照优先；老单按 proCode（标快/特快…）匹配现有选项 */
  let prod = s.product || "";
  if (!prod) {
    const pro = (rd.label_info || {}).proCode || "";
    if (pro && opts.includes(pro)) prod = pro;
    else if (pro && opts.includes(cc + pro)) prod = cc + pro;   /* 顺丰 proCode"标快" → 选项"顺丰标快" */
  }
  if (prod && opts.includes(prod)) {
    $("cfgProduct").value = prod;
    applyProduct(prod);
  }
  if (s.pay) $("cfgPay").value = s.pay;
  if (s.insured !== undefined) $("cfgInsure").value = s.insured || "";
  if (s.cargo) $("cfgCargo").value = s.cargo;
  /* 回签单回显（覆盖 fillBill 开头的类型默认联动；仅快照单——老单无记录保持默认） */
  if (s.receipt) {
    $("cfgReceiptPaper").checked = s.receipt.includes("纸质回单");
    $("cfgReceiptPhoto").checked = s.receipt.includes("拍照回传") && !$("cfgReceiptPhoto").disabled;
  }
  /* 件数/数量：快照或下单存档（rd.parcels/qty 自 2026-09-17 随承运商响应存档 order_resp） */
  const pc = s.parcels || rd.parcels;
  if (pc) parcelsCounter.set(pc);
  const qt = s.qty || rd.qty;
  if (qt) qtyCounter.set(qt);
}

/* ----- 路由卡片：只显示 2 行（2026-09-15 用户规则） -----
   行1=运单号 · 当前状态；行2=最新路由节点（route_latest="MM-dd HH:mm 文本"，服务端自动刷新写入，
   如"快件到达【常州龙城转运中心】"）；无节点则只显示行1 */
function renderTrack(o) {
  const box = $("pwTrack");
  if (!box) return;
  if (!o.waybill_no) { box.hidden = true; box.innerHTML = ""; return; }
  const cur = o.route_status || "待揽收";
  const rows = [];
  if (o.route_latest) {
    const m = o.route_latest.match(/^(\d{2}-\d{2} \d{2}:\d{2})\s+(.*)$/);
    rows.push([m ? m[2] : o.route_latest, m ? m[1] : ""]);   /* 最新节点文本 + 其时间 */
  }
  box.innerHTML =
    `<div class="pt-head">${o.waybill_no} · ${cur}</div>` +
    rows.map(([t, tm]) =>
      `<div class="pt-row cur"><i></i><b>${t}</b><span>${tm}</span></div>`
    ).join("");
  box.hidden = false;
}

/* ----- 承运商按钮：本页可改（写回数据，API 在线时同步入库） ----- */
document.querySelectorAll(".pw-cb").forEach(b => {
  b.addEventListener("click", async () => {
    setCarrier(b.dataset.c);
    for (const o of selectedOrders()) {
      o.carrier = b.dataset.c;
      if (apiBase && o.id) {
        try {
          await fetch(`${apiBase}/orders/${o.id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ carrier: o.carrier })
          });
        } catch (e) { /* 离线忽略 */ }
      }
    }
  });
});
/* 承运商启用开关（设置页 localStorage lnsc-carriers）：关闭的隐藏；当前项被关则切到首个启用项 */
(function applyCarrierGate() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem("lnsc-carriers") || "{}"); } catch (e) {}
  document.querySelectorAll(".pw-cb").forEach(b => {
    if (cfg[b.dataset.c] === false) b.style.display = "none";
  });
  const cur = document.querySelector(`.pw-cb[data-c="${currentCarrier}"]`);
  if (cur && cur.style.display === "none") {
    const first = [...document.querySelectorAll(".pw-cb")].find(b => b.style.display !== "none");
    if (first) setCarrier(first.dataset.c);
  }
})();

/* ----- DN 平铺 chips（仅待下单：已下单移出队列，防重复下单；按类型过滤） ----- */
let dnFilter = "发货单";   /* 默认显示发货单的 DN */
/* PO/采购员/发件人：优先独立字段，旧数据回退 note 标签解析 */
/* 单号前缀显示：DN=82600 / SO=32600 小号上标加粗，剩余位加粗（2026-09-15 用户规则） */
const preHtml = (s, pre) => {
  s = s || "--------";
  return s.startsWith(pre)
    ? '<span class="dn-pre">' + pre + '</span><b>' + s.slice(pre.length) + "</b>"
    : "<b>" + s + "</b>";
};
const dnHtml = dn => preHtml(dn, "82600");
const soHtml = so => preHtml(so, "32600");
const senderOf = o => o.emp_name || ((o.note || "").match(/发件人：(\S+)/) || [])[1] || "";
const buyerOf  = o => o.buyer    || ((o.note || "").match(/采购员：(\S+)/) || [])[1] || "";
const poOf     = o => o.po       || ((o.note || "").match(/PO：(\S+)/) || [])[1] || "";
const companyOf = o => {   /* 对方公司：地址末段含公司类后缀，否则用联系人（与 SAP 页同规则） */
  const segs = (o.address || "").split(" ");
  return /公司|大厦|园区|中心|广场|工厂|集团/.test(segs[segs.length - 1])
    ? segs[segs.length - 1] : (o.name || "--");
};
function renderDnList() {
  dnList.innerHTML = "";
  orders.forEach((o, i) => {
    if (o.waybill_no) return;                 /* 已下单不出现在 DN 区 */
    if ((o.order_type || "发货单") !== dnFilter) return;   /* 类型过滤 */
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.idx = i;
    if (dnFilter === "发货单") {
      b.className = "pw-chip";
      b.innerHTML = dnHtml(o.so);              /* DN：82600 前缀上标 */
    } else {
      /* 两行 chip：第一行收件方，第二行靠右发件方 */
      b.className = "pw-chip two";
      const l1 = document.createElement("span"), l2 = document.createElement("span");
      l1.className = "pc-l1"; l2.className = "pc-l2";
      if (dnFilter === "其他") {
        l1.textContent = (o.name || "--") + (o.phone ? " " + o.phone : "");
        l2.textContent = senderOf(o);
      } else {
        /* 外协单：第一行对方公司；第二行 PO号加粗靠左 + 采购员靠右 */
        l1.textContent = companyOf(o);
        l2.classList.add("pc-flex");
        const po = document.createElement("b"), by = document.createElement("span");
        po.className = "pc-po";
        po.textContent = poOf(o);
        by.textContent = buyerOf(o);
        l2.append(po, by);
      }
      b.append(l1, l2);
    }
    b.addEventListener("click", () => syncSelect(i));   /* DN按钮 → 联动 */
    dnList.appendChild(b);
  });
}
/* 类型过滤按钮（发货单/外协单/其他）；标题随类型切换 */
const DN_TITLE = { "发货单": "DN发货单", "外协单": "PO外协单", "其他": "个人其他" };
document.querySelectorAll(".dn-ft").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll(".dn-ft").forEach(x => x.classList.toggle("active", x === b));
    dnFilter = b.dataset.t;
    $("dnTitle").textContent = "录单 " + DN_TITLE[dnFilter] + "（点击选择，平铺滚动）";
    /* 回签单联动：发货单页签默认勾纸质回单，外协单/其他页签默认不勾（2026-09-16 用户规则） */
    $("cfgReceiptPaper").checked = dnFilter === "发货单";
    renderDnList();
    renderPrintList();          /* 打单列表同步过滤 */
  });
});

/* ----- 查看列：按 DN 拉取已上传文件（缓存），点击预览/打印 ----- */
const uploadCache = {};   /* dn -> Promise<files[]> */
function loadUploadFiles(dn) {
  if (!uploadCache[dn]) {
    uploadCache[dn] = fetch(`${apiBase}/upload?dn=${encodeURIComponent(dn)}`)
      .then(r => r.ok ? r.json() : { files: [] })
      .then(d => d.files || [])
      .catch(() => []);
  }
  return uploadCache[dn];
}

/* Excel：用本地 Excel 程序打开（Office 协议 ms-excel:ofv=只读视图，需本机安装 Office） */
function openLocalExcel(dn, name) {
  /* Upload/ 在应用根（pages/ 的上一级），相对路径须 ../Upload（曾误写 Upload/ 拼出 pages/Upload → 404） */
  const abs = new URL(`../Upload/${dn}/${encodeURIComponent(name)}`, location.href).href;
  window.location.href = "ms-excel:ofv|u|" + abs;
}

/* ----- 文件预览弹窗（PDF=iframe 原生；Excel=SheetJS 转表；Word=docx-preview） ----- */
const pvMask = $("pvMask"), pvTitle = $("pvTitle"), pvBody = $("pvBody");
let pvPrintMode = "html";
async function openPreview(dn, name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const url = `../Upload/${dn}/${encodeURIComponent(name)}`;   /* Upload/ 在应用根（pages/ 上一级） */
  const dl = $("pvDl");                          /* 下载按钮指向当前文件（同源静态直出，download 生效） */
  dl.href = url; dl.download = name;
  pvTitle.textContent = name;
  pvBody.innerHTML = "";
  pvPrintMode = "html";
  pvMask.hidden = false;
  try {
    if (ext === "pdf") {
      const f = document.createElement("iframe");
      f.className = "pv-frame";
      f.src = url;
      pvBody.appendChild(f);
      pvPrintMode = "pdf";
    } else if (["xlsx", "xls", "csv"].includes(ext)) {
      const buf = await (await fetch(url)).arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const div = document.createElement("div");
      div.className = "pv-doc";
      div.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
      pvBody.appendChild(div);
    } else if (ext === "docx") {
      const buf = await (await fetch(url)).arrayBuffer();
      const div = document.createElement("div");
      div.className = "pv-doc";
      pvBody.appendChild(div);
      await docx.renderAsync(buf, div);
    } else {
      pvBody.innerHTML = '<div class="pv-err">该格式暂不支持预览（支持 PDF / Excel / Word）</div>';
    }
  } catch (e) {
    pvBody.innerHTML = '<div class="pv-err">预览失败：' + e.message + "</div>";
  }
}
$("pvPrint").addEventListener("click", () => {
  if (pvPrintMode === "pdf") {
    const f = pvBody.querySelector("iframe");
    if (f && f.contentWindow) { f.contentWindow.focus(); f.contentWindow.print(); return; }
  }
  /* Excel / Word：只打印弹窗内容。
     ⚠️ printing-pv 类必须保留到打印快照生成之后——window.print() 在新版 Chrome 可能异步返回
     （打印预览在回调结束后才快照页面），立即移除类会导致打印空白（2026-09-17 用户反馈 Word 打印空白）；
     改用 afterprint 事件移除 + 超时兜底 */
  document.body.classList.add("printing-pv");
  const cleanup = () => {
    document.body.classList.remove("printing-pv");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 8000);   /* 兜底：afterprint 未触发也恢复页面（快照早已完成） */
});
$("pvClose").addEventListener("click", () => { pvMask.hidden = true; pvBody.innerHTML = ""; });
pvMask.addEventListener("click", e => { if (e.target === pvMask) { pvMask.hidden = true; pvBody.innerHTML = ""; } });

/* ----- 下段打单列表（随类型过滤；前两列含义随类型切换；仅近 7 天录单 + 全部已下单） ----- */
const LIST_HEADS = { "发货单": ["DN", "SO"], "外协单": ["采购员", "PO号"], "其他": ["发件人", "收件城市"] };
const LIST_WINDOW_MS = 7 * 864e5;   /* 待下单只显示近 7 天录单 */
function inListWindow(o) {
  /* 已签收/回单：只在签收当天显示，隔天从下单列表移除（2026-09-17 用户规则。
     签收日期取 route_latest 节点时间 "MM-dd HH:mm …"（签收节点即最新节点） */
  if (/签收|回单/.test(o.route_status || "") || o.status === "returned") {
    const m = String(o.route_latest || "").match(/^(\d{2})-(\d{2})/);
    if (m) {
      const now = new Date();
      const signDay = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return signDay >= today;   /* 签收日=今天才显示；早于今天移除 */
    }
    return true;                 /* 无节点时间：保守显示 */
  }
  if (o.waybill_no) return true;                                  /* 已下单：全部显示 */
  const t = Date.parse((o.created_at || "").replace(" ", "T"));   /* 录单时间 */
  return isNaN(t) ? true : (Date.now() - t) <= LIST_WINDOW_MS;    /* 无创建时间不滤 */
}
function renderPrintList() {
  printBody.innerHTML = "";
  /* 表头前两列随过滤切换：发货单=DN/SO，外协单=采购员/PO号，其他=发件人/收件城市 */
  const heads = LIST_HEADS[dnFilter] || LIST_HEADS["发货单"];
  const ths = document.querySelectorAll(".pw-list thead th");
  if (ths.length >= 2) { ths[0].textContent = heads[0]; ths[1].textContent = heads[1]; }
  orders.forEach((o, i) => {
    const ot = o.order_type || "发货单";
    if (ot !== dnFilter) return;   /* 类型过滤（与 DN 区一致） */
    if (!inListWindow(o)) return;  /* 近 7 天录单 + 已下单 */
    const c1 = ot === "外协单" ? (buyerOf(o) || "—")
             : ot === "其他"   ? (senderOf(o) || "—")
             : (o.so || "");
    const c2 = ot === "外协单" ? (poOf(o) || "—")
             : ot === "其他"   ? (o.city || "—")
             : (o.so_no || "—");
    const tr = document.createElement("tr");
    tr.dataset.idx = i;
    [c1, c2, o.priority || "一般", o.name || "", o.carrier || "—",
     o.waybill_no || "—", o.waybill_no ? "已下单" : "待下单",
     o.route_status || "—"].forEach((v, ci) => {
      const td = document.createElement("td");
      if (ci === 5 && o.waybill_no) {
        td.appendChild(wbLink(o));          /* 单号可点击 → 步骤弹窗（第一步=下单返回值） */
      } else if (ci === 0 && ot === "发货单") {
        td.innerHTML = dnHtml(o.so);        /* DN 列：前缀上标 */
      } else if (ci === 1 && ot === "发货单") {
        td.innerHTML = soHtml(o.so_no || "—");   /* SO 列：32600 前缀上标 */
      } else {
        td.textContent = v;                      /* 联系人列只显示姓名（2026-09-15 用户规则：下单列表不要电话） */
        if (v === "紧急") td.classList.add("prio-hot"); /* 紧急加粗 */
      }
      tr.appendChild(td);
    });
    /* 打印列：单行补打面单 */
    const tdP = document.createElement("td");
    const pb = document.createElement("button");
    pb.type = "button";
    pb.className = "pw-pr-btn f-ico";
    pb.title = "打印面单";
    const pbImg = document.createElement("img");
    pbImg.src = "../shared/icon/printer.svg";
    pbImg.alt = "打印";
    pb.appendChild(pbImg);
    pb.addEventListener("click", async e => {
      e.stopPropagation();
      /* 补打：顺丰/德邦等有官方面单的优先 PDF 弹窗显示，失败回退 HTML；
         德邦生成中（PENDING）只提示不打 HTML */
      const r = await printOfficialOrHtml(o, false);
      if (typeof r === "string" && r.startsWith("PENDING:")) { alert(r.slice(8)); return; }
      if (typeof r === "string") alert(r + "（已改用HTML面单）");
      if (r === true) return;
      fillBill(o);                 /* 面单填充该单（含承运商模板） */
      window.print();
    });
    tdP.appendChild(pb);
    tr.appendChild(tdP);
    /* 查看列：该发货单已上传的文件，格式图标（PDF=预览 / Excel=本地程序打开） */
    const tdV = document.createElement("td");
    tdV.className = "view-cell";
    if (o.so && apiBase) {
      loadUploadFiles(o.so).then(files => {
        if (!files.length) { tdV.textContent = "—"; return; }
        files.forEach(fn => {
          const ext = (fn.split(".").pop() || "").toLowerCase();
          /* 格式图标：PDF/Excel/Word 用专属图标，其它格式统一 File */
          const kind = ext === "pdf" ? "pdf"
            : ["xlsx", "xls"].includes(ext) ? "xls"
            : ext === "csv" ? "csv"
            : ["docx", "doc"].includes(ext) ? "doc" : "file";
          const b = document.createElement("button");
          b.type = "button";
          b.className = "f-ico";
          const img = document.createElement("img");
          img.src = `../shared/icon/file-type-${kind}.svg`;
          img.alt = ext;
          b.appendChild(img);
          if (kind === "xls" || kind === "csv") {
            b.title = fn + "（用本地 Excel 打开）";
            b.addEventListener("click", e => { e.stopPropagation(); openLocalExcel(o.so, fn); });
          } else {
            b.title = fn + "（点击预览）";
            b.addEventListener("click", e => { e.stopPropagation(); openPreview(o.so, fn); });
          }
          tdV.appendChild(b);
        });
      });
    } else {
      tdV.textContent = "—";
    }
    tr.appendChild(tdV);
    tr.addEventListener("click", () => syncSelect(i)); /* 列表行 → 联动 */
    printBody.appendChild(tr);
  });
}

/* 更新列表行的 承运商/单号/下单状态/路由状态（列序：DN SO 优先级 联系人 承运商 单号… 索引 4/5/6/7） */
function updateRowCells(o, i) {
  const row = printBody.querySelector(`tr[data-idx="${i}"]`);
  if (!row) return;
  row.cells[4].textContent = o.carrier || "—";
  row.cells[5].textContent = "";
  if (o.waybill_no) row.cells[5].appendChild(wbLink(o));   /* 单号可点击 → 步骤弹窗 */
  else row.cells[5].textContent = "—";
  row.cells[6].textContent = o.waybill_no ? "已下单" : "待下单";
  row.cells[7].textContent = o.route_status || "—";
}

/* ----- 承运商设置联动：所有输入传入对应承运商下单元素 ----- */
$("cfgProduct").addEventListener("change", e => applyProduct(e.target.value));
$("cfgPay").addEventListener("change", e => setAll(".f-pay", e.target.value));
$("cfgInsure").addEventListener("input", e => {
  const v = e.target.value.replace(/\D/g, "");
  e.target.value = v;
  setAll(".f-insure", v ? v + " 元" : "未保价");
});
$("cfgCargo").addEventListener("input", e => setAll(".f-cargo", e.target.value || "--"));
setAll(".f-cargo", $("cfgCargo").value || "--");   /* 默认托寄物=喷嘴（全承运商）：初始化同步到面单 */
/* 计数选择器工厂（2026-09-17 数量选项引入时抽象，件数/数量共用同一套交互）：
   1-6 方框单选（选中实心白字）；≥min 数字框输入时方框失效、以数字框为准、清空回 1；
   ▼▲ 步进 / 聚焦起 min / 键盘 ←→（焦点在各自 wrap 内时生效，方框与数字框无缝穿行） */
function makeCounter(opts) {
  const inp = $(opts.inputId);
  const nums = () => document.querySelectorAll(opts.numSel);
  const cur = () => {   /* 以界面当前选中为准（所见即所发，防变量残留；2026-09-17） */
    if (inp && +inp.value >= opts.min) return inp.value;
    const a = document.querySelector(opts.numSel + ".active");
    return (a && a.dataset.v) || "1";
  };
  nums().forEach(b => b.addEventListener("click", () => {
    nums().forEach(x => x.classList.toggle("active", x === b));
    inp.value = ""; inp.classList.remove("active");   /* 回方框选择：数字框去实心 */
    opts.onChange(b.dataset.v);
  }));
  inp.addEventListener("input", () => {
    inp.value = inp.value.replace(/[^\d]/g, "").slice(0, opts.digits);
    if (+inp.value >= opts.min) {
      nums().forEach(x => x.classList.remove("active"));
      inp.classList.add("active");              /* ≥min 生效：数字框同样实心白字 */
      opts.onChange(inp.value);
    } else if (inp.value === "") {
      inp.classList.remove("active");
      document.querySelector(opts.numSel + '[data-v="1"]').classList.add("active");
      opts.onChange("1");
    }
  });
  /* ▼▲ 步进：空值（方框选择中）时点击从 min 起步并切入数字框模式 */
  document.querySelectorAll(opts.stepSel).forEach(b => b.addEventListener("click", () => {
    inp.value = inp.value === "" ? opts.min
      : Math.min(opts.max, Math.max(opts.min, (+inp.value || opts.min) + (+b.dataset.d)));
    inp.dispatchEvent(new Event("input"));
  }));
  /* 点到数字框（聚焦）：空值即从 min 起并实心白字；填充值全选高亮——
     直接打字【替换】而非追加（防"想输 300 变 7300"；2026-09-17 用户规则：数量框也要点即填充） */
  if (opts.focusFill !== false) {
    inp.addEventListener("focus", () => {
      if (inp.value === "") {
        inp.value = opts.min;
        inp.dispatchEvent(new Event("input"));
        inp.select();   /* 预填值高亮选中，打字直接覆盖 */
      }
    });
  }
  /* 键盘 ← → 增减（焦点在各自 wrap 内时生效；6→min 切入数字框，min→min-1 切回方框） */
  function step(d) {
    const c = +cur() || 1;
    if (c < opts.min) {
      const next = c + d;
      if (next >= opts.min) { inp.value = opts.min; inp.dispatchEvent(new Event("input")); }
      else if (next >= 1) document.querySelector(`${opts.numSel}[data-v="${next}"]`).click();
    } else {
      const next = c + d;
      if (next < opts.min) document.querySelector(`${opts.numSel}[data-v="${opts.min - 1}"]`).click();
      else { inp.value = Math.min(opts.max, next); inp.dispatchEvent(new Event("input")); }
    }
  }
  document.querySelector(opts.wrapSel).addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  });
  function reset() {   /* 复位默认 1（2026-09-17 用户规则：上一票的选择不得带到下一票） */
    nums().forEach(x => x.classList.toggle("active", x.dataset.v === "1"));
    inp.value = ""; inp.classList.remove("active");
    opts.onChange("1");
  }
  /* 程序化设值（2026-09-18 用户规则：选中已下单行时，件数/数量回显下单存档） */
  function set(v) {
    const n = String(v || "1");
    if (+n >= opts.min) {
      inp.value = n;
      inp.dispatchEvent(new Event("input"));
    } else {
      const b = document.querySelector(`${opts.numSel}[data-v="${n}"]`) ||
                document.querySelector(`${opts.numSel}[data-v="1"]`);
      if (b) b.click();
    }
  }
  return { current: cur, reset, set };
}

/* 件数（2026-09-16 用户版式） */
const parcelsCounter = makeCounter({
  wrapSel: ".parcels-wrap", numSel: ".pc-num", stepSel: ".pc-step-btn",
  inputId: "cfgParcelsN", min: 7, max: 99, digits: 2, onChange: () => {},
});
function resetParcels() { parcelsCounter.reset(); }
function currentParcels() { return parcelsCounter.current(); }

/* 数量（2026-09-17 用户规则：替换重量/体积，形式与件数一致但去 ▼▲ 步进箭头；
   聚焦即填充并实心白字——与件数一致（填充值全选，打字直接替换）；下单后随件数一起复位） */
const qtyCounter = makeCounter({
  wrapSel: ".qty-wrap", numSel: ".qc-num", stepSel: ".qc-step-btn-none",
  inputId: "cfgQtyN", min: 7, max: 99999, digits: 5,
  onChange: v => setAll(".f-qty", v),   /* 预览面单"数量"实时同步 */
});
function currentQty() { return qtyCounter.current(); }

/* ----- 多选开关 ----- */
$("msToggle").addEventListener("change", e => {
  multiMode = e.target.checked;
  if (!multiMode) {
    /* 退出多选：只保留第一个选中项（按钮+列表行同步），面单跟随 */
    const actives = [...dnList.querySelectorAll(".pw-chip.active")];
    actives.slice(1).forEach(c => {
      c.classList.remove("active");
      const r = printBody.querySelector(`tr[data-idx="${c.dataset.idx}"]`);
      if (r) r.classList.remove("row-active");
    });
    const first = actives[0];
    if (first) fillBill(orders[+first.dataset.idx]);
  }
  refreshOrderBtn();
});

/* ----- 下单按钮：二次确认 + 防连点 + 按承运商分组 + 逐单成败汇总（真实 /api/carrier/order） ----- */

/* ----- 下单前表单检查：收件信息完整性 + 类型必填项（不合格拦截并逐单列出原因） ----- */
function validateOrder(o) {
  const errs = [];
  const label = (o.so || "") + (o.name ? " " + o.name : "") || ("#" + o.id);
  if (!(o.name || "").trim()) errs.push("收件人姓名为空");
  const phone = (o.phone || "").trim();
  if (!phone) errs.push("联系方式为空");
  else if (!/^1[3-9]\d{9}$/.test(phone) && !/^0\d{2,3}-?\d{7,8}$/.test(phone)) errs.push("联系方式格式异常");
  if (!(o.province && o.city)) errs.push("省市区不完整");
  const street = (o.street || "").trim();
  if (!street) errs.push("街道与公司的为空");
  else if (/^\d+$/.test(street)) errs.push("街道不能为纯数字");
  const ot = o.order_type || "发货单";
  if (ot === "发货单") {
    if (!/^\d{10}$/.test(o.so || "")) errs.push("DN 缺失或非 10 位数字");
    /* SO 号选填（用户规则 2026-09-15，与录单页一致），不校验 */
  }
  return errs.length ? label.trim() + "：" + errs.join("、") : "";
}

/* ----- 真实下单：调 /api/carrier/order（顺丰/德邦/专车自提厂内单，全生产环境）
   成败判定：必须拿到 waybill_no 才算成功；失败抛出承运商原始报错（原样展示） ----- */
async function placeOrder(o) {
  const cc = o.carrier || currentCarrier;
  /* 正式模式：离线不下单（不产生任何模拟单号），直接报错让用户重连 */
  if (!apiBase) throw new Error("当前离线，无法下单：请连接服务器后重试");
  const req = {
      carrier: cc, so: o.so || "",               /* DN 仅内部标识，承运商 orderId 用 oid */
      oid: String(o.id || ""),                   /* 平台内部订单号（承运商客户单号） */
      order_type: o.order_type || "发货单",       /* 寄件人随类型（发货单=范蓓蓓，见 carriers） */
      province: o.province || "", city: o.city || "", district: o.district || "",
      street: o.street || "", name: o.name || "", phone: o.phone || "",
      company: o.company || "", cargo: o.cargo || $("cfgCargo").value.trim(),   /* 托寄物取设置区输入，不自动填充 */
      product: (cc === currentCarrier) ? $("cfgProduct").value : (PRODUCTS[cc] || [""])[0],   /* 产品类型随设置区 */
      pay: $("cfgPay").value,                          /* 付款方式随设置区（月结/现结/到付） */
      insured: $("cfgInsure").value.trim(),            /* 保价：不写=不保价，写了=声明价值(元) */
      /* 回签单：纸质回单（德邦 backSignBill=1/R1；顺丰 isSignBack=1）；
         拍照回传（顺丰 isSignBack=2，仅顺丰可勾——禁用态不送；2026-09-17 用户规则） */
      receipt: [$("cfgReceiptPaper").checked && "纸质回单",
                ($("cfgReceiptPhoto").checked && !$("cfgReceiptPhoto").disabled) && "拍照回传"
               ].filter(Boolean),
      parcels: currentParcels(),                       /* 件数：以界面当前选中为准（所见即所发，防变量残留；2026-09-17） */
      qty: currentQty(),                               /* 数量：>1 时随托寄物打印到官方面单（2026-09-17 用户规则） */
      /* 其他类型：寄件人=员工姓名+员工电话（2026-09-17 用户规则；旧数据回退 note 标签解析） */
      emp_name: senderOf(o),
      emp_phone: o.emp_phone || ((o.note || "").match(/发件人：\S+\s+(\d+)/) || [])[1] || "",
      /* 运单备注（仅运单打印用，与录单手写备注无关）：发货单=DN+SO，外协单=PO */
      remark: (o.order_type || "发货单") === "外协单"
        ? (poOf(o) ? "PO：" + poOf(o) : "")
        : ["DN：" + (o.so || ""), o.so_no ? "SO：" + o.so_no : ""].filter(x => !x.endsWith("：")).join(" ")
  };
  const r = await fetch(`${apiBase}/carrier/order`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.waybill_no) throw new Error(d.error || ("下单接口异常 HTTP " + r.status));
  return { carrier: cc, waybill_no: d.waybill_no, req,   /* req 随行：下单设置快照存档用（2026-09-18） */
           route_status: d.route_status || "待揽收", mock: !!d.mock, raw: d };
}

/* 下单/取消下单 固定密码门（2026-09-16 用户规则：密码 18879，防误触软闸；
   应用主题弹窗（替代原生 prompt）：Enter 确定 / Esc 取消 / 错误抖动重试；
   说明：前端固定口令仅防误操作，非安全边界——源码可见，知悉即可） */
function orderPassOk() {
  return new Promise(resolve => {
    const mask = $("passMask"), input = $("passInput"), err = $("passErr");
    const done = ok => {
      mask.hidden = true;
      $("passOk").onclick = $("passCancel").onclick = input.onkeydown = mask.onclick = null;
      resolve(ok);
    };
    mask.hidden = false;
    input.value = ""; err.hidden = true;
    setTimeout(() => input.focus(), 30);
    $("passOk").onclick = () => {
      if (input.value === "18879") return done(true);
      err.hidden = false;                                   /* 错误：提示+抖动，留窗重试 */
      input.value = "";
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 350);
      input.focus();
    };
    $("passCancel").onclick = () => done(false);
    input.onkeydown = e => {
      if (e.key === "Enter") $("passOk").click();
      else if (e.key === "Escape") done(false);
    };
    mask.onclick = e => { if (e.target === mask) done(false); };
  });
}

let orderBusy = false;
$("btnOrder").addEventListener("click", async () => {
  if (orderBusy) return;                                  /* 防连点 */

  /* 取消下单模式：当前激活行是"已下单且未揽收"单（按钮已变为"取消下单"） */
  const cancelT = cancelTargetOf();
  if (cancelT) {
    if (!apiBase) { alert("当前离线，无法取消下单"); return; }
    if (!(await orderPassOk())) return;                   /* 取消下单：固定密码门（主题弹窗） */
    if (!confirm("取消下单：" + (cancelT.so || ("#" + cancelT.id)) +
                 "\n运单号 " + cancelT.waybill_no +
                 "\n\n取消后该单回到待下单：可在录单页改数据，或在此改承运参数后重新下单。\n确认取消？")) return;
    orderBusy = true;
    const btn = $("btnOrder");
    btn.disabled = true; btn.textContent = "取消中…";
    try {
      const r = await fetch(`${apiBase}/carrier/cancel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cancelT.id })
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || ("取消接口异常 HTTP " + r.status));
      cancelT.waybill_no = ""; cancelT.route_status = ""; cancelT.route_latest = "";
      /* order_resp 保留作审计追溯 */
      updateRowCells(cancelT, orders.indexOf(cancelT));
      renderDnList();                                   /* 该单回到 DN 队列（可重新下单） */
      fillBill(cancelT);
      alert((d.note ? d.note + "\n" : "") +
            "已取消下单，运单号 " + (d.cleared || "") + " 已清除\n该单已回到 DN 队列，可修改后重新下单");
    } catch (err) {
      alert("取消下单失败：" + err.message);
    } finally {
      orderBusy = false; btn.disabled = false; refreshOrderBtn();
    }
    return;
  }

  const sel = selectedOrders().filter(o => !o.waybill_no); /* 仅待下单 */
  if (!sel.length) { alert("请先选择待下单 DN"); return; }
  if (!(await orderPassOk())) return;                     /* 下单：固定密码门（主题弹窗） */

  /* 下单前表单检查：任一单不合格则整批拦截（防假数据流入承运商） */
  const bad = sel.map(validateOrder).filter(Boolean);
  if (bad.length) {
    alert("以下 " + bad.length + " 单内容不完整，请先在录单模式修正：\n\n" + bad.join("\n"));
    return;
  }

  /* 混选按承运商分组：各组套用各自产品（当前承运商用设置区所选，其余用默认） */
  const groups = {};
  sel.forEach(o => {
    const c = (o.carrier && TPL[o.carrier]) ? o.carrier : currentCarrier;
    (groups[c] ||= []).push(o);
  });
  const lines = Object.entries(groups).map(([c, arr]) =>
    `${c} × ${arr.length}（产品：${c === currentCarrier ? $("cfgProduct").value : PRODUCTS[c][0]}）`);
  /* 确认弹窗含件数（2026-09-17 用户反馈"选1显示2"：发几件必须一目了然） */
  if (!confirm(`确认下单 ${sel.length} 单？\n\n${lines.join("\n")}\n\n` +
               `付款：${$("cfgPay").value}　保价：${$("cfgInsure").value || "未保价"}` +
               `　件数：${currentParcels()}　数量：${currentQty()}`)) return;

  orderBusy = true; $("btnOrder").disabled = true;
  $("btnOrder").textContent = "下单中…";
  const done = [], failed = [];   /* done=成功（回填+打印）；failed=失败（留队列+报原因） */
  const okNotes = [];
  try {
    for (const arr of Object.values(groups)) {
      for (const o of arr) {
        const cc = o.carrier || currentCarrier;
        if (!o.carrier) o.carrier = cc;              /* 承运商回写本地（录单未选承运商时） */
        const tag = (o.so || ("#" + o.id)) + " " + cc;
        try {
          const res = await placeOrder(o);           /* 真实下单：拿不到运单号即抛错 */
          o.waybill_no = res.waybill_no;
          o.route_status = res.route_status;
          /* 下单返回值原文 + 下单设置快照（2026-09-18 用户规则：选中该行时设置区回显用） */
          o.order_resp = JSON.stringify(Object.assign(res.raw || {}, {
            settings: { product: res.req.product, pay: res.req.pay, insured: res.req.insured,
                        receipt: res.req.receipt, cargo: res.req.cargo,
                        parcels: res.req.parcels, qty: res.req.qty }
          }));
          const i = orders.indexOf(o);
          if (apiBase && o.id) {
            try {
              await fetch(`${apiBase}/orders/${o.id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ carrier: cc, waybill_no: o.waybill_no,
                                       route_status: o.route_status, order_resp: o.order_resp })
              });
            } catch (e) { /* 写回失败不阻断（单已成） */ }
          }
          updateRowCells(o, i);
          const chip = dnList.querySelector(`.pw-chip[data-idx="${i}"]`);
          if (chip) chip.remove();                        /* 已下单移出 DN 队列 */
          done.push(o);
          okNotes.push("✓ " + tag + "　运单号 " + o.waybill_no);
        } catch (err) {
          failed.push("✗ " + tag + "　" + err.message);   /* 承运商原始报错原样展示 */
        }
      }
    }
    /* 打印面单：顺丰/德邦=官方 PDF；德邦生成中=不打 HTML 等重打；失败/其他=HTML 面单回退 */
    const labelErrs = [], htmlList = [], pendingNotes = [];
    for (const o of done) {
      const r = await printOfficialOrHtml(o, true);   /* 下单后：直接打印 */
      if (r === true) continue;
      if (typeof r === "string" && r.startsWith("PENDING:")) {   /* 德邦生成中：不补 HTML */
        pendingNotes.push((o.so || ("#" + o.id)) + "：" + r.slice(8));
        continue;
      }
      if (typeof r === "string") labelErrs.push((o.so || ("#" + o.id)) + "：" + r);
      htmlList.push(o);
    }
    if (htmlList.length) printBills(htmlList);

    /* 结果汇总弹窗：成功几单/失败几单 + 逐单运单号或失败原因 */
    alert("下单完成：成功 " + done.length + " 单" +
          (failed.length ? "，失败 " + failed.length + " 单" : "") +
          (okNotes.length ? "\n\n" + okNotes.join("\n") : "") +
          (failed.length ? "\n\n" + failed.join("\n") : "") +
          (labelErrs.length ? "\n\n面单问题（已用HTML面单补打）：\n" + labelErrs.join("\n") : "") +
          (pendingNotes.length ? "\n\n面单生成中：\n" + pendingNotes.join("\n") : ""));
    if (done.length) {
      resetParcels();                                     /* 下单完成：件数复位默认 1（防带到下一票） */
      qtyCounter.reset();                                 /* 数量同复位（2026-09-17） */
      fillBill(done[done.length - 1]);                    /* 面单显示刚下的单（含真实单号） */
      const next = dnList.querySelector(".pw-chip");      /* 自动选中下一个待下单 */
      if (next) syncSelect(+next.dataset.idx);
      /* 下单后直接打印即可，不再自动弹步骤明细（查看返回值：点列表单号随时可看） */
    }
  } finally {
    orderBusy = false; $("btnOrder").disabled = false;
    refreshOrderBtn();   /* 按当前选中恢复：已下单未揽收行 → "取消下单"，否则"下单" */
  }
});

/* ----- 批量面单打印：每单克隆当前模板填充数据 → 逐页 100×150，一次打印任务全部输出 ----- */
function printBills(list) {
  if (!list.length) return;
  const q = $("printQueue");
  q.innerHTML = "";
  for (const o of list) {
    fillBill(o);                                          /* 切到该单承运商模板并填充（含真实单号） */
    const tpl = document.querySelector("#pwBill .bill-tpl:not([hidden])");
    if (!tpl) continue;
    const page = document.createElement("div");
    page.className = "qp";
    const clone = tpl.cloneNode(true);
    clone.removeAttribute("id");
    clone.hidden = false;
    clone.classList.add("qp-bill");
    if (tpl.id === "billOT") clone.classList.add("ot76130");   /* 专车/自提：原生 76×130 出纸（不缩放） */
    page.appendChild(clone);
    q.appendChild(page);
  }
  if (!q.children.length) return;
  document.body.classList.add("qmode");                   /* 打印时只输出队列（屏幕面单隐藏） */
  window.print();
  document.body.classList.remove("qmode");
  q.innerHTML = "";
  fillBill(list[list.length - 1]);                        /* 屏幕恢复显示最后一单 */
}

/* ----- 官方面单（顺丰云打印 / 德邦 queryBillPrint PDF）：样式与承运商官方完全一致，弃用自绘 HTML 面单 ----- */
async function fetchLabelPdf(o) {
  const r = await fetch(`${apiBase}/carrier/label?carrier=${encodeURIComponent(o.carrier)}` +
                        `&waybill_no=${encodeURIComponent(o.waybill_no)}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || ("面单接口异常 HTTP " + r.status));
  if (!d.pdf) throw new Error("官方面单返回中未找到 PDF 数据");
  return d.pdf;
}

/* 直接打印（不弹面单页）：隐藏 iframe 加载服务端同源 PDF → 加载完成即调系统打印。
   iframe 常驻复用不销毁——打印预览期间文档必须在场（定时移除会把预览抽崩） */
let _printFrame = null;
function autoPrintPdf(url) {
  return new Promise(resolve => {
    if (!_printFrame) {
      _printFrame = document.createElement("iframe");
      _printFrame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(_printFrame);
    }
    _printFrame.onload = () => {
      try { _printFrame.contentWindow.focus(); _printFrame.contentWindow.print(); } catch (e) { /* 忽略 */ }
      resolve();
    };
    _printFrame.src = url;
  });
}

/* 官方面单弹窗：iframe 直接加载服务端同源 PDF（/api/carrier/label?raw=1），
   避开 Chrome 对 blob:/data: iframe 的拦截；批量时逐单展示，关闭才到下一张 */
function showLabelPdf(url, title) {
  return new Promise(resolve => {
    const mask = $("labelMask"), frame = $("labelFrame");
    $("labelTitle").textContent = title || "官方面单";
    const dl = $("btnLabelDl");   /* 面单 PDF 下载（同源 API，download 生效；多件文件名逗号转横线） */
    dl.href = url;
    try {
      const q = new URL(url, location.href).searchParams;
      dl.download = (q.get("carrier") || "面单") + "_" +
                    (q.get("waybill_no") || "label").replace(/,/g, "-") + ".pdf";
    } catch (e) { dl.download = "label.pdf"; }
    frame.src = url;
    mask.hidden = false;
    const done = () => { mask.hidden = true; frame.src = "about:blank"; resolve(); };
    $("labelClose").onclick = done;
    mask.onclick = e => { if (e.target === mask) done(); };
  });
}
$("btnLabelPrint").addEventListener("click", () => {   /* 用户手势直触，必出打印对话框 */
  const w = $("labelFrame").contentWindow;
  if (w) { w.focus(); w.print(); }
});

/* 有官方面单的承运商（顺丰=云打印，德邦=queryBillPrint）：取 PDF；
   direct=true 下单后直接打印，false 弹窗显示标签（补打）
   重试机制：顺丰下单→云打印同步延迟，按 1/2/4/8s 退避；
   德邦面单 PDF 下单后异步生成（实测延迟可达几分钟），按 5/10/20s 退避覆盖短延迟；
   德邦仍在生成时返回 "PENDING:" 前缀提示——调用方不得回退 HTML（用户要求只用官方模板） */
/* 一票多件：order_resp.waybills（下单时存档）→ 每件各一张官方面单
   （2026-09-17 用户反馈：2 件单只出了母件面单——实测母单云打印只含母件，子单须各自取） */
function waybillList(o) {
  try {
    const rd = JSON.parse(o.order_resp || "{}");
    if (Array.isArray(rd.waybills) && rd.waybills.length > 1) return rd.waybills;
  } catch (e) { /* 单件 */ }
  return o.waybill_no ? [o.waybill_no] : [];
}

/* 件数（角标/标题用）：顺丰取 waybills 列表长度；德邦多件无子单号列表 → 用下单存档 parcels（2026-09-17） */
function piecesCount(o) {
  try {
    const rd = JSON.parse(o.order_resp || "{}");
    if (Array.isArray(rd.waybills) && rd.waybills.length > 1) return rd.waybills.length;
    if (+rd.parcels > 1) return +rd.parcels;
  } catch (e) { /* 单件 */ }
  return 1;
}

async function printOfficialOrHtml(o, direct) {
  const OFFICIAL = { "顺丰": [1000, 2000, 4000, 8000], "德邦": [5000, 10000, 20000] };
  const delays = OFFICIAL[o.carrier];
  if (!delays || !o.waybill_no || !apiBase) return false;   /* 无官方面单：走 HTML */
  let lastErr = "";
  for (let i = 0; i <= delays.length; i++) {
    try {
      await fetchLabelPdf(o);          /* 先校验可取（错误进重试） */
      /* 一票多件：逗号拼接全部运单 → 服务端逐件取面单合并为一个多页 PDF，
         一次预览一次打印（减少点击；2026-09-17 用户规则） */
      const wbs = waybillList(o);
      const url = `${apiBase}/carrier/label?carrier=${encodeURIComponent(o.carrier)}` +
                  `&waybill_no=${encodeURIComponent(wbs.join(","))}&raw=1`;
      if (direct) await autoPrintPdf(url);
      else await showLabelPdf(url, `${o.so || ("#" + o.id)} · ${o.carrier} · ${o.waybill_no}` +
                  (piecesCount(o) > 1 ? `（共${piecesCount(o)}件）` : ""));
      return true;
    } catch (e) {
      lastErr = e.message;
      if (i < delays.length) await new Promise(r => setTimeout(r, delays[i]));
    }
  }
  if (o.carrier === "德邦" && /未查询到可以打印的订单/.test(lastErr))
    return "PENDING:德邦官方面单生成中（下单后异步生成，约需几分钟），请稍后点 🖨️ 重打";
  return "官方面单获取失败（已重试" + delays.length + "次）：" + lastErr;
}

/* ----- 运单步骤弹窗：点击单号打开；第一步固定显示下单返回值，其后为承运商轨迹 ----- */
const stepsMask = $("stepsMask"), stepsTitle = $("stepsTitle"), stepsBody = $("stepsBody");

function wbLink(o) {   /* 可点击的运单号（列表渲染/行更新共用） */
  const b = document.createElement("button");
  b.type = "button"; b.className = "wb-link";
  const n = piecesCount(o);   /* 德邦多件无子单号列表，用存档件数（2026-09-17） */
  /* 一票多件：右上角小标件数（加粗+圆圈；2026-09-17 用户规则） */
  b.innerHTML = o.waybill_no + (n > 1 ? '<span class="wb-pieces">' + n + "</span>" : "");
  /* 顺丰实际产品（label_info.proCode）：远线路选标快会被顺丰自动改派特快——悬浮可见（2026-09-17 用户反馈） */
  let pro = "";
  try { pro = (JSON.parse(o.order_resp || "{}").label_info || {}).proCode || ""; } catch (e) { /* 无 */ }
  b.title = (n > 1 ? `一票 ${n} 件　` : "") + (pro ? `实际产品：${pro}　` : "") +
            "查看运单每一步（第一步=下单返回值）";
  b.addEventListener("click", e => { e.stopPropagation(); openSteps(o); });
  return b;
}

function stepEl(title, time, respText) {
  const d = document.createElement("div");
  d.className = "step";
  d.innerHTML = `<div class="step-rail"><i class="step-dot"></i><i class="step-line"></i></div>
                 <div class="step-main"><div class="step-title"></div></div>`;
  const tEl = d.querySelector(".step-title");
  tEl.textContent = title;
  if (time) {
    const t = document.createElement("span");
    t.className = "step-time"; t.textContent = time;
    tEl.appendChild(t);
  }
  if (respText) {
    const r = document.createElement("div");
    r.className = "step-resp"; r.textContent = respText;
    d.querySelector(".step-main").appendChild(r);
  }
  return d;
}

function fmtOrderResp(o) {   /* 下单返回值：只保留 运单号+路由状态 两行（2026-09-15 用户要求；原文仍完整存 order_resp 备查） */
  if (!o.order_resp) return "（无返回值记录：该单为功能上线前所下，或离线未写回服务器）";
  try {
    const d = JSON.parse(o.order_resp);
    /* route_status 取当前值（订单表由路由定时器保持新鲜；快照不同步问题 2026-09-16 用户反馈修复） */
    return JSON.stringify({ waybill_no: d.waybill_no || o.waybill_no || "",
                            route_status: o.route_status || d.route_status || "" }, null, 2);
  } catch (e) { return o.order_resp; }
}

async function openSteps(o) {
  const n = waybillList(o).length;
  stepsTitle.textContent = `${o.so || "#" + o.id} · ${o.carrier || "—"} · ${o.waybill_no}` +
                           (n > 1 ? `（共${n}件）` : "");
  stepsBody.innerHTML = "";
  /* 第一步：下单返回值（所有下单必有，先渲染再查轨迹） */
  stepsBody.appendChild(stepEl("第一步：下单返回值", o.created_at || "", fmtOrderResp(o)));
  stepsMask.hidden = false;
  /* 后续：承运商轨迹（未开通/失败只追加提示步，不影响第一步） */
  if (!apiBase || !o.carrier || !o.waybill_no) return;
  try {
    const r = await fetch(`${apiBase}/carrier/route?carrier=${encodeURIComponent(o.carrier)}` +
                          `&waybill_no=${encodeURIComponent(o.waybill_no)}`);
    const d = await r.json().catch(() => ({}));
    if (r.ok && d.route_status) o.route_status = d.route_status;   /* 实时状态同步回订单对象 */
    if (r.ok && Array.isArray(d.detail) && d.detail.length) {
      d.detail.forEach(x => stepsBody.appendChild(
        stepEl(x.acceptAddress || x.opcode || "轨迹节点", x.acceptTime || "", x.remark || "")));
    } else if (r.ok) {
      stepsBody.appendChild(stepEl("轨迹", "",
        "暂无轨迹节点（当前状态：" + (d.route_status || "待揽收") + "）"));
    } else {
      stepsBody.appendChild(stepEl("轨迹", "",
        "轨迹查询暂不可用：" + (d.error || ("HTTP " + r.status))));
    }
  } catch (e) {
    stepsBody.appendChild(stepEl("轨迹", "", "轨迹查询失败：" + e.message));
  }
}

$("stepsClose").addEventListener("click", () => { stepsMask.hidden = true; });
stepsMask.addEventListener("click", e => { if (e.target === stepsMask) stepsMask.hidden = true; });

/* ----- 扫码枪：缓冲数字键，Enter 定位 DN（输入框聚焦时不拦截） ----- */
let scanBuf = "";
document.addEventListener("keydown", e => {
  const tag = (document.activeElement || {}).tagName || "";
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
  if (e.key === "Enter") {
    const dn = scanBuf; scanBuf = "";
    const chip = [...dnList.querySelectorAll(".pw-chip")].find(c => c.textContent === dn);
    if (chip) syncSelect(+chip.dataset.idx);
  } else if (/^\d$/.test(e.key)) {
    scanBuf = (scanBuf + e.key).slice(-8);
  }
});

/* ----- 初始化 ----- */
(async () => {
  orders = await fetchOrders();
  renderPrintList();
  renderDnList();
  /* API 状态点：在线=黑实心，离线=灰（统一 topbar.js markApi） */
  markApi(!!apiBase, apiBase);
  /* 初始选中第一个待下单 DN */
  const first = dnList.querySelector(".pw-chip");
  if (first) syncSelect(+first.dataset.idx);
})();
