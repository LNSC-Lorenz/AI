/* ============================================================
 * LNSC 发货全链系统 - 打单模式
 * 左：130 面单预览 | 右上：DN 平铺选择 | 右中：顺丰设置 | 右下：打单列表
 * ============================================================ */
"use strict";

/* ----- 数据加载：API 在线优先，离线回退 mock.js 快照 ----- */
const API_CANDIDATES = ["api", `${location.protocol}//${location.hostname}:8091/api`];
let apiBase = null;   /* 在线时的 API 基址（用于承运商修改写回） */

async function fetchOrders() {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/orders");
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

/* ----- 三方联动：面单 / DN按钮 / 列表行 ----- */
function syncSelect(idx) {
  const chip = dnList.querySelector(`.pw-chip[data-idx="${idx}"]`);
  const row  = printBody.querySelector(`tr[data-idx="${idx}"]`);
  if (!chip || !row) return;
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
}

/* ----- 承运商模板切换（设置区单行自适应；专车/客户自提共用厂内送货单模板） ----- */
const CARRIERS = ["顺丰", "德邦", "跨越", "专车", "客户自提"];
const TPL = { "顺丰": "billSF", "德邦": "billDB", "跨越": "billKY", "专车": "billOT", "客户自提": "billOT" };
/* 各承运商可选产品（对应下单元素） */
const PRODUCTS = {
  "顺丰": ["顺丰标快", "顺丰特快", "顺丰卡航", "同城半日达"],
  "德邦": ["大件快递 3.60", "精准卡航", "精准汽运", "快递标准件"],
  "跨越": ["次日达", "当天达", "隔日达"],
  "专车": ["整车直送", "零担专线", "同城专车"],
  "客户自提": ["客户自提", "自提+代装车"]
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
  /* 专车/客户自提共用 billOT：先全隐藏再显示当前模板 */
  Object.values(TPL).forEach(id => { $(id).hidden = true; });
  $(TPL[c]).hidden = false;
  if (TPL[c] === "billOT") {
    /* 厂内送货单：标题与编号占位随 专车/客户自提 切换 */
    $("billOT").querySelector(".f-ot-title").textContent = c === "客户自提" ? "客户自提单" : "专车直送单";
    const wb = $("billOT").querySelector(".f-waybill");
    wb.textContent = (c === "客户自提" ? "ZT" : "ZC") + " 0000 0000 0000";
    delete wb.dataset.def;                        /* fillBill 重新缓存默认占位 */
  }
  if (changed) {
    /* 产品下拉按承运商重建并写入面单 */
    $("cfgProduct").innerHTML = PRODUCTS[c].map(p => `<option>${p}</option>`).join("");
    applyProduct($("cfgProduct").value);
    /* 德邦专属：重量/体积输入 */
    $("cfgWV").hidden = (c !== "德邦");
  }
}

/* ----- 面单填充（三套模板同名字段一起更新，只显示当前模板） ----- */
function setAll(cls, text) {
  document.querySelectorAll("#pwBill " + cls).forEach(el => { el.textContent = text; });
}
function fillBill(o) {
  setAll(".f-name",  o.name  || "---");
  /* 丰密面单：手机号中间 4 位脱敏显示 */
  const masked = (o.phone || "").replace(/(\d{3})\d{4}(\d{4})/, "$1****$2");
  setAll(".f-phone", masked || "-----------");
  setAll(".f-addr",  o.address || "--");
  setAll(".f-dn",    o.so    || "--------");
  /* 目的市：优先 city 字段（直辖市=city 即省名），否则从地址文本取第二段 */
  setAll(".f-dest",  o.city || (o.address || "").split(" ")[1] || "--");
  setAll(".f-route", "0" + String(100 + (parseInt(o.so, 10) || 0) % 800)); /* 模拟路由代码 */
  /* 运单号：已下单显示真实单号，未下单显示各模板默认占位（SF/DPK/KY） */
  document.querySelectorAll("#pwBill .f-waybill").forEach(el => {
    if (!el.dataset.def) el.dataset.def = el.textContent;
    el.textContent = o.waybill_no || el.dataset.def;
  });
  const t = new Date();
  setAll(".f-date", `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`);
  if (o.carrier && TPL[o.carrier]) setCarrier(o.carrier); /* 承运商从录单带入 */
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

/* ----- DN 平铺 chips（仅待下单：已下单移出队列，防重复下单；按类型过滤） ----- */
let dnFilter = "发货单";   /* 默认显示发货单的 DN */
const senderOf = o => { const m = (o.note || "").match(/发件人：(\S+)/); return m ? m[1] : ""; };
const buyerOf  = o => { const m = (o.note || "").match(/采购员：(\S+)/); return m ? m[1] : ""; };
const poOf     = o => { const m = (o.note || "").match(/PO：(\S+)/); return m ? m[1] : ""; };
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
      b.textContent = o.so || "--------";
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
  const abs = new URL(`Upload/${dn}/${encodeURIComponent(name)}`, location.href).href;
  window.location.href = "ms-excel:ofv|u|" + abs;
}

/* ----- 文件预览弹窗（PDF=iframe 原生；Excel=SheetJS 转表；Word=docx-preview） ----- */
const pvMask = $("pvMask"), pvTitle = $("pvTitle"), pvBody = $("pvBody");
let pvPrintMode = "html";
async function openPreview(dn, name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const url = `Upload/${dn}/${encodeURIComponent(name)}`;
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
  /* Excel / Word：只打印弹窗内容 */
  document.body.classList.add("printing-pv");
  window.print();
  document.body.classList.remove("printing-pv");
});
$("pvClose").addEventListener("click", () => { pvMask.hidden = true; pvBody.innerHTML = ""; });
pvMask.addEventListener("click", e => { if (e.target === pvMask) { pvMask.hidden = true; pvBody.innerHTML = ""; } });

/* ----- 下段打单列表（随类型过滤；前两列含义随类型切换；仅近 7 天录单 + 全部已下单） ----- */
const LIST_HEADS = { "发货单": ["DN", "SO"], "外协单": ["采购员", "PO号"], "其他": ["发件人", "收件城市"] };
const LIST_WINDOW_MS = 7 * 864e5;   /* 待下单只显示近 7 天录单 */
function inListWindow(o) {
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
     o.route_status || "—", (o.returned_at || "").slice(0, 10) || "—"].forEach(v => {
      const td = document.createElement("td");
      td.textContent = v;
      if (v === "紧急") td.classList.add("prio-hot"); /* 紧急加粗 */
      tr.appendChild(td);
    });
    /* 打印列：单行补打面单 */
    const tdP = document.createElement("td");
    const pb = document.createElement("button");
    pb.type = "button";
    pb.className = "pw-pr-btn";
    pb.textContent = "打印";
    pb.addEventListener("click", e => {
      e.stopPropagation();
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
          img.src = `icon/file-type-${kind}.svg`;
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

/* 更新列表行的 单号/下单状态/路由状态（列序：DN SO 优先级 联系人 承运商 单号… 索引 5/6/7） */
function updateRowCells(o, i) {
  const row = printBody.querySelector(`tr[data-idx="${i}"]`);
  if (!row) return;
  row.cells[5].textContent = o.waybill_no || "—";
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
/* 德邦专属：重量 / 体积 */
$("cfgWeight").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/[^\d.]/g, "");
  setAll(".f-weight", e.target.value || "--");
});
$("cfgVolume").addEventListener("input", e => {
  e.target.value = e.target.value.replace(/[^\d.]/g, "");
  setAll(".f-volume", e.target.value || "--");
});

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
});

/* ----- 下单按钮：二次确认 + 防连点 + 按承运商分组（真实 API 待对接，当前模拟回单） ----- */
function mockWaybill(carrier, dn) {
  if (carrier === "德邦") return "DPK" + dn + "06";
  if (carrier === "跨越") return "KY" + dn + "66";
  if (carrier === "专车") return "ZC" + dn + "01";
  if (carrier === "客户自提") return "ZT" + dn + "02";
  return "SF" + dn + "88";
}

let orderBusy = false;
$("btnOrder").addEventListener("click", async () => {
  if (orderBusy) return;                                  /* 防连点 */
  const sel = selectedOrders().filter(o => !o.waybill_no); /* 仅待下单 */
  if (!sel.length) { alert("请先选择待下单 DN"); return; }

  /* 混选按承运商分组：各组套用各自产品（当前承运商用设置区所选，其余用默认） */
  const groups = {};
  sel.forEach(o => {
    const c = (o.carrier && TPL[o.carrier]) ? o.carrier : currentCarrier;
    (groups[c] ||= []).push(o);
  });
  const lines = Object.entries(groups).map(([c, arr]) =>
    `${c} × ${arr.length}（产品：${c === currentCarrier ? $("cfgProduct").value : PRODUCTS[c][0]}）`);
  if (!confirm(`确认下单 ${sel.length} 单？\n\n${lines.join("\n")}\n\n` +
               `付款：${$("cfgPay").value}　保价：${$("cfgInsure").value || "未保价"}`)) return;

  orderBusy = true; $("btnOrder").disabled = true;
  try {
    for (const arr of Object.values(groups)) {
      for (const o of arr) {
        const cc = o.carrier || currentCarrier;
        o.waybill_no = mockWaybill(cc, o.so); /* TODO: 替换为丰桥/德邦/跨越 API 回单 */
        o.route_status = cc === "专车" ? "专车直送" : cc === "客户自提" ? "待自提" : "待揽收";
        const i = orders.indexOf(o);
        if (apiBase && o.id) {
          try {
            await fetch(`${apiBase}/orders/${o.id}`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ waybill_no: o.waybill_no, route_status: o.route_status })
            });
          } catch (e) { /* 离线忽略 */ }
        }
        updateRowCells(o, i);
        const chip = dnList.querySelector(`.pw-chip[data-idx="${i}"]`);
        if (chip) chip.remove();                          /* 已下单移出 DN 队列 */
      }
    }
    fillBill(sel[sel.length - 1]);                        /* 面单显示刚下的单（含单号） */
    const next = dnList.querySelector(".pw-chip");        /* 自动选中下一个待下单 */
    if (next) syncSelect(+next.dataset.idx);
    window.print();                                       /* 下单成功联动打印，无需再点打印 */
  } finally {
    orderBusy = false; $("btnOrder").disabled = false;
  }
});

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
