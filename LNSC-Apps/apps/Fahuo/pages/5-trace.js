/* ============================================================
 * LNSC 全链发货平台 - 可视化模式
 * 左 1/3：优先级占比(环形) / 在途完成度(同心环) / 专车情况
 * 右 2/3：点击左侧模块 → 点阵动态明细；每 60s 自动刷新
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
const API_CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];
const TODAY = new Date().toLocaleDateString("sv-SE");
const pad2 = n => String(n).padStart(2, "0");

/* 语义色（与全局口径一致：超时红 / 运输绿 / 已下单蓝 / 待下单灰） */
const C_RED = "#d32f2f", C_AMBER = "#f0a13a", C_GREEN = "#2e7d32", C_BLUE = "#1D459F", C_GRAY = "#999999";
const PRIO_COLOR = { "紧急": C_RED, "重要": C_AMBER, "一般": "var(--black)" };
const ROUTE_TARGET_H = 48;                 /* 在途目标时效：48 小时 */

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

/* 目的地城市：优先 city 字段，否则取地址第二段 */
const destCity = o => o.city || (o.address || "").split(" ").filter(Boolean)[1] || "--";
/* 单号前缀显示：DN=82600 / SO=32600 小号上标加粗，剩余位加粗（2026-09-15 用户规则） */
const preHtml = (s, pre) => {
  s = s || "--------";
  return s.startsWith(pre)
    ? '<span class="dn-pre">' + pre + '</span><b>' + s.slice(pre.length) + "</b>"
    : "<b>" + s + "</b>";
};
const dnHtml = dn => preHtml(dn, "82600");
const soHtml = so => preHtml(so, "32600");

/* 在途进度：已发运时长 / 48h，节点状态修正，6%~97% 之间 */
function routeProgress(o) {
  if (o.status === "returned") return 1;
  const rs = o.route_status || "";
  if (/签收|回单/.test(rs)) return 1;
  let p = 0.1;
  if (o.shipped_at) {
    const hrs = (Date.now() - new Date(String(o.shipped_at).replace(" ", "T"))) / 36e5;
    p = hrs / ROUTE_TARGET_H;
  }
  if (/派送|到达/.test(rs)) p = Math.max(p, 0.88);
  else if (/揽收|发出|运输/.test(rs)) p = Math.max(p, 0.15);
  return Math.min(0.97, Math.max(0.06, p));
}

/* 订单链路状态 → 颜色与文字（专车面板 / 明细共用） */
function chainState(o) {
  if (o.status === "returned") return { c: C_GREEN, t: "已回单" };
  if (o.status === "shipped")   return { c: C_GREEN, t: o.route_status || "运输中" };
  if (o.waybill_no)             return { c: C_BLUE,  t: "已下单" };
  if (o.ship_date && o.ship_date < TODAY) return { c: C_RED, t: "超时未发" };
  return { c: C_GRAY, t: "待下单" };
}

/* 有状态的优先显示：在途 0 > 超时 1 > 已下单 2 > 待下单 3；同档按进度降序 */
function stateRank(o) {
  if (o.status === "shipped" || o.status === "returned") return 0;
  if (o.status === "pending" && o.ship_date && o.ship_date < TODAY) return 1;
  if (o.waybill_no) return 2;
  return 3;
}
const byState = (a, b) => stateRank(a) - stateRank(b) || pathProgress(b) - pathProgress(a);

/* SVG 圆弧生长动画：元素初始 stroke-dasharray="0 C"，data-grow 存目标值 */
function growSvg(wrap) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    wrap.querySelectorAll("[data-grow]").forEach(el =>
      el.setAttribute("stroke-dasharray", el.getAttribute("data-grow")));
  }));
}

/* ----- 左上：优先级占比（图1：每个优先级一条独立圆环，弧长=占总量比例） ----- */
function renderDonut(list) {
  const box = $("vizDonut");
  const counts = { "紧急": 0, "重要": 0, "一般": 0 };
  list.forEach(o => counts[o.priority || "一般"]++);
  const total = list.length;
  if (!total) { box.innerHTML = `<div class="viz-empty">暂无在办任务</div>`; return; }
  const W = 12, RADII = { "紧急": 60, "重要": 45, "一般": 30 };  /* 外→内：紧急/重要/一般 */
  let rings = "", i = 0;
  Object.keys(counts).forEach(k => {
    const r = RADII[k], C = 2 * Math.PI * r;
    const frac = counts[k] / total;
    const pct = Math.round(frac * 100);
    rings += `<circle r="${r}" cx="80" cy="80" fill="none" style="stroke:var(--line-light)" stroke-width="${W}" opacity=".4"/>`;
    if (frac > 0) {
      const dim = selPrio && selPrio !== k;   /* 筛选中：非选中环压暗 */
      rings += `<circle class="grow seg${dim ? "" : " pulse"}" data-prio="${k}" r="${r}" cx="80" cy="80" fill="none"` +
        ` stroke-width="${selPrio === k ? W + 3 : W}" stroke-linecap="round"` +
        ` style="stroke:${PRIO_COLOR[k]};${dim ? "opacity:.25" : `animation-delay:${(i * 0.5).toFixed(2)}s`}"` +
        ` stroke-dasharray="0 ${C.toFixed(1)}" data-grow="${(frac * C).toFixed(1)} ${C.toFixed(1)}"` +
        ` transform="rotate(-90 80 80)">` +
        `<title>${k} ${counts[k]} 单 · ${pct}%（点击筛选右侧运单）</title></circle>`;
      /* 弧中点标注：文字沿色环弧度旋转（左侧翻转防倒置），白字压弧 */
      const aDeg = -90 + frac * 180, a = aDeg * Math.PI / 180;
      let rot = aDeg + 90;                            /* 切线方向 */
      if (rot > 90 && rot < 270) rot += 180;          /* 左半圈翻转，避免倒字 */
      const tx = 80 + r * Math.cos(a), ty = 80 + r * Math.sin(a);
      rings += `<text class="seg-label" x="${tx.toFixed(1)}" y="${ty.toFixed(1)}"` +
        ` transform="rotate(${rot.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)})"` +
        ` style="${dim ? "opacity:.25" : ""}" text-anchor="middle" dominant-baseline="central">${k}</text>`;
    }
    i++;
  });
  box.innerHTML =
    `<div class="donut-wrap anim">` +
    `<svg viewBox="0 0 160 160">` +
    `<circle class="spin" r="68" cx="80" cy="80" fill="none" style="stroke:var(--line-light)" stroke-width="1" stroke-dasharray="2 5"/>` +
    rings + `</svg>` +
    `<div class="donut-c"><b>${pad2(total)}</b></div></div>`;
  growSvg(box);
}

/* ----- 左中：在途完成度同心环（图2：很多细环，每环一单，弧呼吸+扫掠弧旋转，动态） ----- */
function renderRings(list) {
  const box = $("vizRings");
  if (!list.length) {
    box.innerHTML = `<div class="viz-empty">暂无在途运单</div>`;
    return;
  }
  const shown = list.slice(0, 7);          /* 很多环：最多 7 环 */
  const avg = list.reduce((s, o) => s + routeProgress(o), 0) / list.length;
  let rings = "";
  shown.forEach((o, i) => {
    const r = 80 - i * 10, C = 2 * Math.PI * r, p = routeProgress(o);
    rings +=
      `<circle r="${r}" cx="90" cy="90" fill="none" style="stroke:var(--line-light)" stroke-width="4.5" opacity=".45"/>` +
      `<circle class="grow pulse" r="${r}" cx="90" cy="90" fill="none" stroke-width="4.5" stroke-linecap="round"` +
      ` style="stroke:var(--black);animation-delay:${(i * 0.3).toFixed(2)}s"` +
      ` stroke-dasharray="0 ${C.toFixed(1)}" data-grow="${(p * C).toFixed(1)} ${C.toFixed(1)}"` +
      ` transform="rotate(-90 90 90)"/>`;
  });
  box.innerHTML =
    `<div class="rings-wrap anim">` +
    `<svg viewBox="0 0 180 180">${rings}</svg>` +
    `<i class="needle"></i>` +
    `<div class="rings-c"><b>${Math.round(avg * 100)}<small>%</small></b></div></div>`;
  growSvg(box);
}

/* ----- 左下：专车情况（承运商=专车/自提，简单列表） ----- */
function renderTrucks(list) {
  const box = $("vizTrucks");
  if (!list.length) {
    box.innerHTML = `<div class="viz-empty">暂无专车任务</div>`;
    return;
  }
  box.innerHTML = `<div class="tk-list anim">` + [...list].sort(byState).slice(0, 5).map(o => {
    const s = chainState(o);
    return `<div class="tk-row"><i style="background:${s.c}"></i>${dnHtml(o.so)}` +
      `<span>${destCity(o)}</span>` +
      (s.t === "待下单" ? "" : `<em>${s.t}</em>`) + `</div>`;
  }).join("") + `</div>`;
}

/* ----- 右 3/4：运单路径明细（点击左侧类别 → 该类别全部运单，逐单显示路径进度） ----- */
const PATH_COLS = 64;    /* 4 行 × 64 列点网：按列同步点亮 */

/* 运单链路进度：待下单 8% / 已下单 35% / 在途按发运时长 / 回单 100% */
function pathProgress(o) {
  if (o.status === "returned") return 1;
  if (o.status === "shipped") return routeProgress(o);
  if (o.waybill_no) return 0.35;
  return 0.08;
}

/* 单一运单路径行：4行点网 --> 目的市；4 行按列同步点亮到当前进度，当前列脉动 */
function pathRow(o) {
  const s = chainState(o);
  const p = pathProgress(o);
  const onCols = Math.max(1, Math.round(p * PATH_COLS));   /* 点亮列数 */
  let dots = "";
  for (let i = 0; i < PATH_COLS * 4; i++) {
    const col = i % PATH_COLS;                             /* 同行连续排列 → 取列号 */
    dots += col < onCols
      ? `<i class="on${col === onCols - 1 && p < 1 ? " cur" : ""}" style="--c:${s.c};transition-delay:${col * 12}ms"></i>`
      : `<i style="transition-delay:${col * 12}ms"></i>`;
  }
  return `<div class="vd-path">` +
    `<div class="vd-phead">${dnHtml(o.so)}` +
    `<span>${o.order_type && o.order_type !== "发货单" ? o.order_type + " · " : ""}` +
    `${o.so_no ? "SO " + soHtml(o.so_no) + " · " : ""}${o.carrier || "—"} · ${o.name || "--"} · ${o.waybill_no || "未下单"}</span>` +
    (s.t === "待下单" ? "" : `<em style="color:${s.c}">${s.t}</em>`) + `</div>` +
    `<div class="vd-ptrack">` +
    `<div class="vd-pdots">${dots}</div>` +
    `<span class="vd-pd">${destCity(o)}</span></div></div>`;
}

function renderDetail(kind) {
  const box = $("vizDetail");
  const base = kind === "prio"
    ? (selPrio ? DATA.active.filter(o => (o.priority || "一般") === selPrio) : DATA.active)
    : kind === "route" ? DATA.shipped
    : DATA.special;
  const list = base.slice().sort(byState);   /* 有状态的排前 */
  box.classList.remove("play");
  box.innerHTML =
    `<div class="vd-head"><span>${kind === "prio" && selPrio ? selPrio + " · " : ""}共 ${pad2(list.length)} 单</span></div>` +
    `<div class="vd-rows">` +
    (list.map(pathRow).join("") || `<div class="vd-hint">当前无相关运单</div>`) +
    `</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("play")));
}

/* ----- 主流程：加载 → 分区渲染 → 60s 自动刷新 ----- */
let selViz = "prio";
let selPrio = "";        /* 图1 色环点选优先级（""=全部） */
const DATA = { active: [], shipped: [], special: [] };

async function refresh() {
  const orders = await fetchOrders();
  DATA.active  = orders.filter(o => o.status !== "returned");              /* 在办 */
  DATA.shipped = orders.filter(o => o.status === "shipped");               /* 在途 */
  DATA.special = DATA.active.filter(o => o.carrier === "专车" || o.carrier === "自提"); /* 专车/自提 */
  renderDonut(DATA.active);
  renderRings(DATA.shipped);
  renderTrucks(DATA.special);
  renderDetail(selViz);
}

document.querySelectorAll(".viz-panel").forEach(p => {
  p.addEventListener("click", () => {
    selViz = p.dataset.viz;
    document.querySelectorAll(".viz-panel").forEach(x => x.classList.toggle("sel", x === p));
    renderDetail(selViz);
  });
});

/* 图1 色环点击：按该优先级筛选右侧运单；再点同一色环取消筛选 */
$("vizDonut").addEventListener("click", e => {
  const seg = e.target.closest("[data-prio]");
  if (!seg) return;
  e.stopPropagation();
  selPrio = selPrio === seg.dataset.prio ? "" : seg.dataset.prio;
  selViz = "prio";
  document.querySelectorAll(".viz-panel").forEach(x => x.classList.toggle("sel", x.dataset.viz === "prio"));
  renderDonut(DATA.active);
  renderDetail("prio");
});

refresh();
setInterval(refresh, 60000);
