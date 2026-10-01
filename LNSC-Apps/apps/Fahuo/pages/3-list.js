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
let API_BASE = "";   /* 探测成功的 API 根（发货照片等后续请求复用） */
async function fetchOrders() {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/orders", { signal: AbortSignal.timeout(5000) });   /* 5s 超时防假死 */
      if (r.ok) { API_BASE = base; markApi(true, base); return await r.json(); }
    } catch (e) { /* 尝试下一个 */ }
  }
  markApi(false);
  return (typeof MOCK_ORDERS !== "undefined") ? MOCK_ORDERS : [];
}

/* ----- 统计口径筛选（对应右侧看板四卡） ----- */
const dayOf = s => (s || "").slice(0, 10);
const TODAY = new Date().toLocaleDateString("sv-SE");
const YESTERDAY = new Date(Date.now() - 864e5).toLocaleDateString("sv-SE");
/* 发货判定（2026-09-16 用户规则）：以"揽收"为准——运单存在且路由状态≠待揽收 = 已发货；
   未揽收（含未下单）才算待发货/超时（与 /api/stats 同口径） */
const shippedOf = o => !!(o.waybill_no && (o.route_status || "待揽收") !== "待揽收");
const FILTERS = {
  shipped_yesterday: { label: "昨日发货",
    fn: o => o.ship_date === YESTERDAY && shippedOf(o) },
  pending_today: { label: "今日待发货",
    fn: o => o.ship_date === TODAY && !shippedOf(o) },
  overdue: { label: "超时未发货",
    fn: o => o.ship_date && o.ship_date < TODAY && !shippedOf(o) },
  planned: { label: "计划发货",
    fn: o => o.ship_date > TODAY && !shippedOf(o) },
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

/* ----- 发货照片（2026-09-16）：共享盘 \\\\10.86.180.24\\…\\01_ShippingPhotos_Send（年/月/日递进），
   挂载到应用内 ShippingPhotos/，5_scan_shipphotos.sh 每 5min 扫出 shipphotos.json（{DN:[相对路径]}）。
   有照片的 DN：图标变深可点 → 弹出预览；无照片：灰色占位（无其他附加功能） ----- */
let shipPhotos = {};
async function fetchShipPhotos() {
  try {
    const r = await fetch("../shipphotos.json?t=" + Date.now(), { signal: AbortSignal.timeout(5000) });
    if (r.ok) shipPhotos = await r.json();
  } catch (e) { /* 索引不存在/离线：全部灰图标，不阻塞清单 */ }
}

function fillPhotoCell(td, o) {
  const files = shipPhotos[o.so || ""] || [];
  const s = document.createElement("span");
  s.className = "photo-ic" + (files.length ? " has" : "");
  s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>'
    + '<circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>';
  if (files.length) {
    s.title = `发货照片 ${files.length} 张（点击查看）`;
    s.addEventListener("click", () => openShipPhotos(o.so, files));
  }
  td.appendChild(s);
}

/* 发货照片预览弹窗：整列大图，点图新开页看原图；点遮罩/关闭退出 */
function openShipPhotos(dn, files) {
  const mask = document.createElement("div");
  mask.className = "pm-mask";
  const box = document.createElement("div");
  box.className = "pm-box";
  mask.appendChild(box);
  mask.addEventListener("click", e => { if (e.target === mask) mask.remove(); });
  const head = document.createElement("div");
  head.className = "pm-head";
  const ttl = document.createElement("b");
  ttl.textContent = `发货照片 · ${dn}（${files.length} 张）`;
  const sp = document.createElement("span"); sp.className = "spacer";
  const close = document.createElement("button");
  close.className = "btn"; close.textContent = "关闭";
  close.addEventListener("click", () => mask.remove());
  head.append(ttl, sp, close);
  const list = document.createElement("div");
  list.className = "pm-list";
  const srcs = files.map(rel => "../ShippingPhotos/" + encodeURI(rel));   /* 挂载点静态直出 */
  srcs.forEach((src, i) => {
    const img = document.createElement("img");
    img.src = src;
    img.alt = files[i]; img.loading = "lazy";
    img.title = "点击放大（滚轮缩放，右侧翻页，✕/Esc 关闭）";
    img.addEventListener("click", () => openLightbox(srcs, i));
    list.appendChild(img);
  });
  box.append(head, list);
  document.body.appendChild(mask);
}

/* 灯箱放大预览（2026-09-16 用户规则）：滚轮缩放 0.2×–8×、放大后拖动平移、
   ✕ 按钮 / 点背景 / Esc 关闭、双击复位；
   图片右侧悬浮「上一张/下一张」循环翻页（免关闭再开），← → 键同效，左上角显示序号 */
function openLightbox(srcs, idx) {
  const mask = document.createElement("div");
  mask.className = "lb-mask";
  const img = document.createElement("img");
  img.className = "lb-img";
  img.alt = ""; img.draggable = false;
  const close = document.createElement("button");
  close.className = "lb-close"; close.textContent = "✕"; close.title = "关闭（Esc）";
  const dl = document.createElement("a");          /* 下载当前照片（同源静态直出，download 属性生效） */
  dl.className = "lb-dl"; dl.textContent = "⤓ 下载"; dl.title = "下载当前照片";
  const navs = document.createElement("div");
  navs.className = "lb-navs";
  const prev = document.createElement("button");
  prev.className = "lb-nav"; prev.textContent = "上一张"; prev.title = "上一张（←）";
  const next = document.createElement("button");
  next.className = "lb-nav"; next.textContent = "下一张"; next.title = "下一张（→）";
  navs.append(prev, next);
  const counter = document.createElement("div");
  counter.className = "lb-count";
  mask.append(img, close, dl, navs, counter);
  document.body.appendChild(mask);

  let scale = 1, tx = 0, ty = 0, drag = null;
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const show = i => {
    idx = (i + srcs.length) % srcs.length;   /* 循环翻页 */
    scale = 1; tx = ty = 0; apply();         /* 翻页复位缩放/平移 */
    img.src = srcs[idx];
    dl.href = srcs[idx];                     /* 下载按钮随翻页指向当前照片 */
    dl.download = decodeURIComponent(srcs[idx].split("/").pop() || "photo.jpg");
    counter.textContent = (idx + 1) + " / " + srcs.length;
    navs.style.display = srcs.length > 1 ? "" : "none";
  };
  function off() {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
    mask.remove();
  }
  const onWheel = e => {
    e.preventDefault();
    scale = Math.min(8, Math.max(0.2, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    apply();
  };
  const onDown = e => { drag = { x: e.clientX - tx, y: e.clientY - ty }; e.preventDefault(); };
  const onMove = e => { if (drag) { tx = e.clientX - drag.x; ty = e.clientY - drag.y; apply(); } };
  const onUp = () => { drag = null; };
  const onKey = e => {
    if (e.key === "Escape") off();
    else if (e.key === "ArrowLeft") show(idx - 1);
    else if (e.key === "ArrowRight") show(idx + 1);
  };
  mask.addEventListener("wheel", onWheel, { passive: false });
  img.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  close.addEventListener("click", off);
  prev.addEventListener("click", () => show(idx - 1));
  next.addEventListener("click", () => show(idx + 1));
  mask.addEventListener("click", e => { if (e.target === mask) off(); });
  img.addEventListener("dblclick", () => { scale = 1; tx = ty = 0; apply(); });
  document.addEventListener("keydown", onKey);
  show(idx);
}

/* ----- 渲染（11 列：备注列在最后；2026-09-16 用户规则） ----- */
function renderRows(list) {
  const body = $("listBody");
  body.innerHTML = "";
  list.forEach(o => {
    const tr = document.createElement("tr");
    if (o.priority === "紧急") tr.classList.add("row-urgent");   /* 紧急行加粗红字（2026-09-20 用户规则） */
    /* 类型列（第3列，无列标题）：优先级分类移除（2026-09-20 用户规则），紧急看整行红粗 */
    [o.so || "", o.so_no || "—", null, o.address || "", o.name || "",
     o.waybill_no || "—",
     o.waybill_no ? "已下单" : "待下单", o.route_status || "—",
     null,                                   /* 发货照片列（第9列，无列标题） */
     dayOf(o.returned_at) || "—",
     cleanNote(o.note)                       /* 备注列（最后列；2026-09-16 用户规则） */
    ].forEach((v, i) => {
      const td = document.createElement("td");
      if (i === 2) {                                   /* 类型列（优先级分类移除；2026-09-20 用户规则） */
        td.textContent = o.order_type || "发货单";
      }
      else if (i === 3) fillAddrCell(td, o);   /* 地址列（第4列）：两行 */
      else if (i === 0) td.innerHTML = dnHtml(o.so);   /* DN 列：前缀上标 */
      else if (i === 1) td.innerHTML = soHtml(o.so_no || "—");   /* SO 列：32600 前缀上标 */
      else if (i === 4) fillNameCell(td, o);   /* 姓名列（第5列）：姓名+电话两行 */
      else if (i === 5) {                        /* 单号列（第6列）：运单号 + 最新路由同格第二行
                                                    （与号码同一高度块；宽度 capped 到备注列右缘，
                                                    超出缓慢跑马灯；2026-09-16 用户版式） */
        td.classList.add("rt-over");
        const wb = document.createElement("div");
        if (o.waybill_no) wb.appendChild(wbLink(o));   /* 单号可点击 → 步骤弹窗（与下单页同款；2026-09-16 用户要求） */
        else wb.textContent = v;
        td.appendChild(wb);
        /* 已签收/回单：移除路由信息行（签收后的评价长文无意义；2026-09-16 用户规则） */
        if (o.route_latest && !/签收|回单/.test(o.route_status || "") && o.status !== "returned") {
          const r = document.createElement("div");
          r.className = "rt-line";
          /* 时间前缀固定，其后内容上下翻页（2026-09-16 用户选定：分段停留，替代跑马灯） */
          const mm = o.route_latest.match(/^(\d{2}-\d{2} \d{2}:\d{2})\s+(.*)$/);
          if (mm) {
            const t = document.createElement("span");
            t.className = "rt-time";
            t.textContent = mm[1] + " ";
            r.appendChild(t);
          }
          const clip = document.createElement("span");
          clip.className = "rt-clip";
          const flip = document.createElement("div");
          flip.className = "rt-flip";
          flip.dataset.full = mm ? mm[2] : o.route_latest;   /* 原文存这，切段在 fitRouteLines 按窗宽进行 */
          const seg = document.createElement("div");
          seg.className = "rt-seg";
          seg.textContent = flip.dataset.full;
          flip.appendChild(seg);
          clip.appendChild(flip);
          r.appendChild(clip);
          td.appendChild(r);
        }
      }
      else if (i === 8) fillPhotoCell(td, o);   /* 发货照片列（第9列）：有共享盘照片可点 */
      else td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  $("lmCount").innerHTML = activeFilter
    ? `<span class="lm-tag">${activeFilter.label}</span>：共 ${list.length} 单 <a href="3-list.html">✕ 清除筛选</a>`
    : `共 ${list.length} 单`;
  requestAnimationFrame(fitRouteLines);   /* 路由行限宽 + 超长跑马灯（布局完成后测量） */
}

/* 路由行限宽 + 上下翻页（2026-09-16 用户选定：分段停留，替代跑马灯）：
   窗口限宽到备注列右缘；内容按窗宽切段（canvas 量宽，优先空格/【边界断），
   全表同一节拍每 3s 垂直翻一段（0.45s 滑动 + 2.55s 停留）；末段后接首段克隆实现无缝循环 */
function splitRouteText(text, maxW, font) {
  if (!maxW || maxW < 40) return [text];
  const cv = splitRouteText._cv || (splitRouteText._cv = document.createElement("canvas").getContext("2d"));
  cv.font = font;
  if (cv.measureText(text).width <= maxW) return [text];
  const segs = [];
  let rest = text;
  while (rest && cv.measureText(rest).width > maxW) {
    /* 二分找最长可容纳前缀 */
    let lo = 1, hi = rest.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cv.measureText(rest.slice(0, mid)).width <= maxW) lo = mid; else hi = mid - 1;
    }
    let cut = lo;
    /* 优先在空格后/【前断（在后 60% 范围内找，避免切太碎、避免断词断括号） */
    const pref = rest.slice(0, cut);
    const bp = Math.max(pref.lastIndexOf(" "), pref.lastIndexOf("【"));
    if (bp > cut * 0.4) cut = bp + (rest[bp] === " " ? 1 : 0);
    segs.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) segs.push(rest);
  return segs;
}

function fitRouteLines() {
  const table = document.querySelector(".table-section .order-table");
  if (!table) return;
  const right = table.getBoundingClientRect().right;
  table.querySelectorAll(".rt-clip").forEach(clip => {
    const flip = clip.querySelector(".rt-flip");
    if (!flip) return;
    /* 裁剪窗显式宽度：恒跨列到最后一列（=表格右缘；2026-09-16 用户规则——
       max-width 会随内容收缩，翻页窗口必须吃满全宽） */
    clip.style.width = Math.max(60, right - clip.getBoundingClientRect().left - 8) + "px";
    const w = clip.clientWidth;
    if (clip._w === w) return;                 /* 宽度没变不重切（resize 防抖） */
    clip._w = w;
    const segs = splitRouteText(flip.dataset.full || "", w, getComputedStyle(clip).font);
    flip.innerHTML = "";
    segs.forEach(s => {
      const d = document.createElement("div");
      d.className = "rt-seg"; d.textContent = s;
      flip.appendChild(d);
    });
    if (segs.length > 1) {                     /* 首段克隆接尾：翻到最后无缝回第一屏 */
      const d0 = document.createElement("div");
      d0.className = "rt-seg"; d0.textContent = segs[0];
      flip.appendChild(d0);
    }
    flip._st = null;                           /* 状态重置（段数/段高可能变了） */
    flip.style.transition = "none";
    flip.style.transform = "translateY(0)";
  });
}
window.addEventListener("resize", fitRouteLines);

/* 全表同步翻页：每 3s 统一翻一段；单段行跳过（保持静止） */
setInterval(() => {
  document.querySelectorAll(".rt-flip").forEach(flip => {
    const n = flip.children.length - 1;        /* 末位是首段克隆 → 真实段数 = 子数-1 */
    if (n < 1) return;
    const st = flip._st || (flip._st = { i: 0, h: 0 });
    if (!st.h) st.h = flip.children[0].offsetHeight || 0;
    if (!st.h) return;
    st.i++;
    flip.style.transition = "transform .45s ease";
    flip.style.transform = `translateY(${-st.i * st.h}px)`;
    if (st.i >= n) {                           /* 已翻到克隆屏 → 动画结束后瞬移回 0 */
      st.i = 0;
      setTimeout(() => { flip.style.transition = "none"; flip.style.transform = "translateY(0)"; }, 480);
    }
  });
}, 3000);

/* ----- 视图过滤：类型按钮组（单选） + 搜索（在统计口径基础集合内）；
   优先级筛选组移除（2026-09-20 用户规则：分类只留在录单页，紧急行整行加粗红字） ----- */
let activeType = "";

function applyView() {
  let list = baseList;
  if (activeType) {
    list = list.filter(o => (o.order_type || "发货单") === activeType);
  }
  const q = $("lmSearch").value.trim().toLowerCase();
  if (q) {
    list = list.filter(o =>
      [o.so, o.so_no, o.priority, o.order_type, o.address, o.name, o.phone, o.note, o.carrier,
       o.waybill_no, o.route_status, o.waybill_no ? "已下单" : "待下单",
       dayOf(o.returned_at)]
        .join(" ").toLowerCase().includes(q));
  }
  viewList = list;   /* 分享/导出按当前可见集合（2026-09-16 分享四件套） */
  renderRows(list);
}

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

/* ----- 运单步骤弹窗：点击单号打开（与下单页同款；2026-09-16 用户要求）；
   第一步固定显示下单返回值，其后为承运商轨迹节点 ----- */
const stepsMask = $("stepsMask"), stepsTitle = $("stepsTitle"), stepsBody = $("stepsBody");

function wbLink(o) {   /* 可点击的运单号 */
  const b = document.createElement("button");
  b.type = "button"; b.className = "wb-link";
  let n = 1, pro = "";
  try {   /* 一票多件：右上角小标件数（2026-09-17 用户规则：只显数字，dn-pre 上标样式） */
    const rd = JSON.parse(o.order_resp || "{}");
    if (Array.isArray(rd.waybills) && rd.waybills.length > 1) n = rd.waybills.length;
    else if (+rd.parcels > 1) n = +rd.parcels;   /* 德邦多件无子单号列表：用下单存档件数（2026-09-17） */
    pro = (rd.label_info || {}).proCode || "";   /* 顺丰实际产品：远线路标快被改派特快可见（2026-09-17） */
  } catch (e) { /* 单件 */ }
  b.innerHTML = o.waybill_no + (n > 1 ? '<span class="wb-pieces">' + n + "</span>" : "");
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

function fmtOrderResp(o) {   /* 下单返回值：只保留 运单号+路由状态 两行（原文仍完整存 order_resp 备查） */
  if (!o.order_resp) return "（无返回值记录：该单为功能上线前所下，或离线未写回服务器）";
  try {
    const d = JSON.parse(o.order_resp);
    /* route_status 取当前值（订单表由路由定时器保持新鲜；快照不同步问题 2026-09-16 用户反馈修复） */
    const out = { waybill_no: d.waybill_no || o.waybill_no || "",
                  route_status: o.route_status || d.route_status || "" };
    if (d.sign_back_final) out.sign_back_final = d.sign_back_final;   /* 回单运单终态提示（2026-09-29 起新单不自动置回单，人工核实后手动置） */
    return JSON.stringify(out, null, 2);
  } catch (e) { return o.order_resp; }
}

function signBackNo(o) {   /* 回签单号（顺丰纸质回单 type=3，下单存档 order_resp.sign_back_no） */
  try {
    return ((JSON.parse(o.order_resp || "{}").sign_back_no) || "").trim();
  } catch (e) { return ""; }
}

/* 回单返回"到方地址"（2026-09-29 用户口径终定，平台统一维护；与 2-order.js 同款）：
   唯一权威源=服务端 carriers/sf_express.SIGN_BACK_ADDR，页面加载即拉取 GET /api/signback_addr；
   离线/file:// 打开时用下方兜底同文（与服务端一致，改地址只需改服务端） */
let SB_ADDR_TEXT = "莱克勒喷嘴系统（常州）有限公司 范蓓蓓 15190535163\n" +
                   "江苏常州金坛 德城路99号（邮编 213200）";
(async () => {
  for (const base of API_CANDIDATES) {
    try {
      const r = await fetch(base + "/signback_addr", { signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const d = await r.json();
      if (d && d.text) SB_ADDR_TEXT = d.text;
      return;
    } catch (e) { /* 尝试下一个候选基址 */ }
  }
})();

/* 回单返回信息（2026-09-29 用户指正 + 回单运单轨迹实锤，官方逻辑终定；与 2-order.js 同款）：
   回单运单号=原单回单号（SF106 开头），签收后自动反向、到付返回（历史 4 单轨迹已验证）；
   云打印那张"正向+寄付月结"面单是 POD 签收联，不是返回段运单——无需人工改单（此前结论错误）。
   回单收不到的真正根因 = 回单返回"到方地址"未维护，被派送至错误地址签收。
   → 向 95338/顺丰销售申请维护到方地址=莱克勒德城路99号；此处一键复制维护申请文案 */
function signBackInfoEl(o) {
  const sb = signBackNo(o);
  if (o.carrier !== "顺丰" || !sb) return null;
  const txt = "【顺丰回单返回到方地址维护申请】\n" +
    "莱克勒喷嘴系统（常州）有限公司（月结客户）\n" +
    "请将签单返还服务的“回单返回到方地址”维护/确认为：\n" +
    SB_ADDR_TEXT + "\n" +
    "本单回单号：" + sb + "（原运单 " + (o.waybill_no || "") +
      (o.so ? "，DN " + o.so : "") + "）\n" +
    "说明：收件人签收后回单运单自动反向到付返回；到方地址未维护会派送错误。\n" +
    "另请协查历史误投回单去向并重新派送：SF1064982980091、SF1064982958300、" +
    "SF1064983709198、SF1064997481417";
  const el = stepEl("回单返回：顺丰自动返回（同 SF106 回单号，反向 + 到付）——需维护到方地址", "", txt);
  const b = document.createElement("button");
  b.type = "button"; b.className = "btn";
  b.style.margin = "6px 0 2px";
  b.textContent = "复制到方地址维护申请";
  b.addEventListener("click", () => {
    /* http 非安全上下文无 navigator.clipboard → textarea + execCommand 复制 */
    const ta = document.createElement("textarea");
    ta.value = txt;
    ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* 忽略 */ }
    ta.remove();
    b.textContent = ok ? "已复制 ✓（发给 95338/顺丰销售）" : "复制失败，请手动选中文本复制";
    setTimeout(() => { b.textContent = "复制到方地址维护申请"; }, 3000);
  });
  el.querySelector(".step-main").appendChild(b);
  return el;
}

async function openSteps(o) {
  stepsTitle.textContent = `${o.so || "#" + o.id} · ${o.carrier || "—"} · ${o.waybill_no}`;
  stepsBody.innerHTML = "";
  stepsBody.appendChild(stepEl("第一步：下单返回值", o.created_at || "", fmtOrderResp(o)));
  const sbe = signBackInfoEl(o);   /* 顺丰回单返回：自动反向+到付；到方地址维护申请（2026-09-29 更正） */
  if (sbe) stepsBody.appendChild(sbe);
  stepsMask.hidden = false;
  /* 后续：承运商轨迹（未开通/失败只追加提示步，不影响第一步） */
  if (!API_BASE || !o.carrier || !o.waybill_no) return;
  try {
    const r = await fetch(`${API_BASE}/carrier/route?carrier=${encodeURIComponent(o.carrier)}` +
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

/* ----- 分享四件套（照搬 PO-Closing：复制/邮件/Teams/导出；2026-09-16 用户要求） ----- */
let viewList = [];   /* 当前筛选后的可见行（applyView 写入；分享/导出按此集合） */

function toast(msg) {
  let t = $("lmToast");
  if (!t) { t = document.createElement("div"); t.id = "lmToast"; t.className = "lm-toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("on"), 2200);
}
/* 纯文本表按列对齐：CJK 记 2 宽，空格补齐（PO-Closing 同款 dw/padR） */
function dw(s) { let w = 0; for (const ch of String(s)) w += ch.codePointAt(0) > 0x2E7F ? 2 : 1; return w; }
function padR(s, w) { s = String(s); return s + " ".repeat(Math.max(0, w - dw(s))); }
const SHARE_HEAD = ["DN", "SO", "优先级", "类型", "地址", "姓名", "电话", "单号", "下单状态", "路由状态", "回单日期", "备注"];
const shareRowOf = o => [o.so || "", o.so_no || "", o.priority || "一般", o.order_type || "发货单",
                         o.address || "", o.name || "", o.phone || "", o.waybill_no || "",
                         o.waybill_no ? "已下单" : "待下单", o.route_status || "",
                         dayOf(o.returned_at), cleanNote(o.note)];
function shareLinesF(rows, limit) {
  const data = rows.slice(0, limit).map(shareRowOf);
  const all = [SHARE_HEAD].concat(data);
  const W = SHARE_HEAD.map((_, i) => Math.max.apply(null, all.map(c => dw(c[i]))));
  const fmt = c => c.map((v, i) => padR(v, W[i])).join(" | ");
  const lines = [fmt(SHARE_HEAD), "-".repeat(dw(fmt(SHARE_HEAD)))].concat(data.map(fmt));
  if (rows.length > limit) lines.push("…共 " + rows.length + " 行，仅列前 " + limit + " 行（完整清单请用「导出」）");
  return lines;
}
function fallbackCopyF(t, done) {
  const ta = document.createElement("textarea");
  ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); done(); } catch (e) { toast("复制失败"); }
  document.body.removeChild(ta);
}
function lmCopy() {
  if (!viewList.length) { toast("当前筛选结果为空"); return; }
  const text = shareLinesF(viewList, viewList.length).join("\n");
  const done = () => toast("已复制 " + viewList.length + " 行到剪贴板");
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(done, () => fallbackCopyF(text, done));
  else fallbackCopyF(text, done);
}
function lmMail() {
  if (!viewList.length) { toast("当前筛选结果为空"); return; }
  const subject = "发货清单（" + viewList.length + " 行）" + new Date().toLocaleDateString("zh-CN");
  const body = "\n\n" + shareLinesF(viewList, 60).join("\n");   /* 开头空两行：顶部写留言 */
  location.href = "mailto:?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}
function lmTeams() {
  if (!viewList.length) { toast("当前筛选结果为空"); return; }
  const msg = "发货清单（" + viewList.length + " 行）\n```\n" + shareLinesF(viewList, 20).join("\n") + "\n```";
  /* 无固定收件人配置：消息复制到剪贴板并打开 Teams，粘贴到目标会话发送 */
  const open = () => window.open("https://teams.microsoft.com/", "_blank");
  const ok = () => { toast("消息已复制，粘贴到 Teams 会话发送"); open(); };
  if (navigator.clipboard && navigator.clipboard.writeText)
    navigator.clipboard.writeText(msg).then(ok, open);
  else open();
}

/* ---- 导出 Excel（手写最小 xlsx：ZIP STORE + CRC32 + inlineStr，零依赖；照搬 PO-Closing） ---- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function colLetter(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; }
function escXml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nb = enc.encode(f.name), data = f.data, crc = crc32(data);
    const h = new Uint8Array(30), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint16(12, 0x21, true); dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
    dv.setUint16(26, nb.length, true);
    parts.push(h, nb, data);
    central.push({ nb, crc, size: data.length, offset });
    offset += 30 + nb.length + data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const h = new Uint8Array(46), dv = new DataView(h.buffer);
    dv.setUint32(0, 0x02014b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 20, true);
    dv.setUint16(14, 0x21, true); dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.size, true); dv.setUint32(24, c.size, true);
    dv.setUint16(28, c.nb.length, true); dv.setUint32(42, c.offset, true);
    parts.push(h, c.nb);
    offset += 46 + c.nb.length;
  }
  const eocd = new Uint8Array(22), dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true); dv.setUint16(10, central.length, true);
  dv.setUint32(12, offset - cdStart, true); dv.setUint32(16, cdStart, true);
  parts.push(eocd);
  return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
function buildXlsx(data) {
  const enc = new TextEncoder();
  let rowsXml = "";
  data.forEach((row, ri) => {
    let cells = "";
    row.forEach((v, ci) => {
      if (v === "" || v === null || v === undefined) return;
      const ref = colLetter(ci) + (ri + 1);
      cells += '<c r="' + ref + '" t="inlineStr"><is><t>' + escXml(v) + "</t></is></c>";
    });
    rowsXml += '<row r="' + (ri + 1) + '">' + cells + "</row>";
  });
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const sheet = H + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rowsXml + "</sheetData></worksheet>";
  const ct = H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>';
  const rels = H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const wb = H + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="发货清单" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const wbrels = H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(ct) },
    { name: "_rels/.rels", data: enc.encode(rels) },
    { name: "xl/workbook.xml", data: enc.encode(wb) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbrels) },
    { name: "xl/worksheets/sheet1.xml", data: enc.encode(sheet) },
  ]);
}
function lmExport() {
  if (!viewList.length) { toast("当前筛选无数据可导出"); return; }
  const blob = buildXlsx([SHARE_HEAD].concat(viewList.map(shareRowOf)));
  const d = new Date();
  const fname = "发货清单_" + d.getFullYear() + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0") + ".xlsx";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fname;
  a.click();
  URL.revokeObjectURL(a.href);
  toast("已导出 " + viewList.length + " 条 → " + fname);
}
$("btnLmCopy").addEventListener("click", lmCopy);
$("btnLmMail").addEventListener("click", lmMail);
$("btnLmTeams").addEventListener("click", lmTeams);
$("btnLmExport").addEventListener("click", lmExport);

/* ----- 初始化 ----- */
(async () => {
  orders = await fetchOrders();
  await fetchShipPhotos();   /* 发货照片索引（共享盘扫描件；无索引不阻塞清单） */
  baseList = activeFilter ? orders.filter(activeFilter.fn) : orders;
  applyView();
})();
