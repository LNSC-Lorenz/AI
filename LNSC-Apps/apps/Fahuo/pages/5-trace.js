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

/* 在途进度（2026-09-16 用户规则：根据在途点模拟——阶段定档 + 下单后时长/48h 目标时效内插；
   旧版依赖 shipped_at（恒为空）导致在途单恒停 10%）：待揽收 8% → 在途 15%~85% → 派送/到达 90% → 签收/回单 100% */
function routeProgress(o) {
  if (o.status === "returned") return 1;
  const rs = o.route_status || "";
  if (/签收|回单/.test(rs)) return 1;
  if (/派送|到达/.test(rs)) return 0.9;
  let p = 0.08;                                    /* 待揽收 8% */
  if (/揽收|发出|运输|运送/.test(rs)) {
    p = 0.15;
    const t0 = new Date(String(o.created_at || "").replace(" ", "T"));
    if (!isNaN(t0)) {
      const hrs = (Date.now() - t0) / 36e5;
      p = Math.max(p, Math.min(0.85, 0.15 + (hrs / ROUTE_TARGET_H) * 0.7));   /* 48h 走到 85% */
    }
  }
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

/* ----- 左上：在途完成度同心环（图2：很多细环，每环一单，弧呼吸+扫掠弧旋转，动态） -----
   （优先级占比圆环面板移除：2026-09-20 用户规则，优先级分类只留在录单页） ----- */
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

/* 运单链路进度：待下单 8% / 已下单≥35%（在途按节点模拟推进；status 无自动 shipped，2026-09-16 修正） / 回单 100% */
function pathProgress(o) {
  if (o.status === "returned") return 1;
  if (o.waybill_no) return Math.max(0.35, routeProgress(o));   /* 已下单：保底 35%，在途随节点模拟增长到 90%+ */
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
  return `<div class="vd-path${o.priority === "紧急" ? " row-urgent" : ""}">` +   /* 紧急行加粗红字（2026-09-20 用户规则） */
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
  const base = kind === "route" ? DATA.shipped : DATA.special;   /* prio 维度移除（2026-09-20） */
  const list = base.slice().sort(byState);   /* 有状态的排前 */
  box.classList.remove("play");
  box.innerHTML =
    `<div class="vd-head"><span>共 ${pad2(list.length)} 单</span></div>` +
    `<div class="vd-rows">` +
    (list.map(pathRow).join("") || `<div class="vd-hint">当前无相关运单</div>`) +
    `</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("play")));
}

/* ----- 主流程：加载 → 分区渲染 → 60s 自动刷新 ----- */
let selViz = "route";    /* 默认在途完成度（优先级面板移除；2026-09-20） */
const DATA = { active: [], shipped: [], special: [] };

async function refresh() {
  const orders = await fetchOrders();
  DATA.active  = orders.filter(o => o.status !== "returned");              /* 在办 */
  DATA.shipped = orders.filter(o => o.status === "shipped");               /* 在途 */
  DATA.special = DATA.active.filter(o => o.carrier === "专车" || o.carrier === "自提"); /* 专车/自提 */
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

refresh();
setInterval(refresh, 60000);
