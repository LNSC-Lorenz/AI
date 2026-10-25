/* ============================================================
 * LNSC 全链发货平台 - 清单模式
 * 整合录单/下单全部列 + 回单日期 + 顶部搜索 + 统计口径筛选(?f=)
 * ============================================================ */
"use strict";

const $ = id => document.getElementById(id);
/* HTML 转义（2026-10-22：DN 列姓名 badge 用 innerHTML 渲染需转义） */
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
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
const poHtml = po => preHtml(po, "98260");   /* PO：98260 前缀上标（与录单/下单页一致） */
/* DN 列第二行 badge 组：▼ 要求发货日期 + ▶ 承运商下单日期 + 姓名（黑底白字同款；最多跨 3 列；
   2026-10-23 用户规则「下单与清单里的 DN列 的第二行 的姓名…调为跨3列， 添加2个显示块， 第一个是要求发货日期，第二个是实际承运商的下单日期」） */
const ymdShort = s => { const m = String(s || "").match(/(\d{4})-(\d{2})-(\d{2})/); return m ? m[1].slice(2) + "-" + m[2] + "-" + m[3] : ""; };
function dnSecondRow(o, owner) {
  const b = [];
  const sd = ymdShort(o.ship_date);
  if (sd) b.push('<span class="dn-badge" title="要求发货日期">▼ ' + sd + "</span>");
  const pd = ymdShort(o.printed_at);
  if (pd) b.push('<span class="dn-badge" title="承运商下单日期">▶ ' + pd + "</span>");
  if (owner) b.push('<span class="dn-owner">' + esc(owner) + "</span>");
  return b.length ? '<div class="dn-badges">' + b.join("") + "</div>" : "";
}
/* 外协单 PO/采购员：优先独立字段，旧数据（标签塞在 note 里的）回退标签反解（同 2-order.js） */
const poOf    = o => o.po    || ((o.note || "").match(/PO：(\S+)/) || [])[1] || "";
const buyerOf = o => o.buyer || ((o.note || "").match(/采购员：(\S+)/) || [])[1] || "";
const senderOf = o => o.emp_name || ((o.note || "").match(/发件人：(\S+)/) || [])[1] || "";   /* 其他（员工快递）发件人 */

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
/* 地址列（2026-10-22 用户规则「清单页面里的街道， 如果超过13个汉字， 那在地址列， 与省市区显示在一行。且公司显示在第二行；
   如果超出13个字，那就换行显示，且公司显示在第三行」）：
   街道≤13字 → 省市区+街道 第一行、公司第二行；街道>13字 → 省市区第一行、街道第二行、公司第三行（同录单页 18 字规则版式） */
function fillAddrCell(td, o) {
  const [region, street] = addrLines(o);
  const company = o.company || "";
  const d1 = document.createElement("div");
  if (street && street.length > 13) {
    d1.textContent = region || (o.address || "");
    td.appendChild(d1);
    const d2 = document.createElement("div"); d2.textContent = street; td.appendChild(d2);
  } else {
    d1.textContent = (region + street) || (o.address || "");
    td.appendChild(d1);
  }
  if (company) { const dc = document.createElement("div"); dc.textContent = company; td.appendChild(dc); }
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
  /* 上传文件图标（同一行并排；2026-10-15 用户规则系列 v=aw/ax/ay/br/cc，2026-10-22 用户规则
     「清单里查看上传文件的图标和功能没有了」重建——JS 曾在旧版覆盖中丢失，CSS 类 .file-ic/.pm-file-* 保留）：
     显示该 DN 在 Upload/<DN>/ 的附件数量，>0 变深可点 → 预览弹窗（内含「+ 上传」） */
  const n = uploadCounts[o.so || ""] || 0;
  const f = document.createElement("span");
  f.className = "photo-ic file-ic" + (n ? " has" : "");
  f.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>'
    + '<polyline points="14 2 14 8 20 8"/></svg>'
    + (n ? '<b class="file-n">' + n + "</b>" : "");
  if (n) {
    f.title = `上传文件 ${n} 个（点击查看）`;
    f.addEventListener("click", () => openUploadFiles(o.so));
  } else {
    f.title = "上传文件（无；点击照片图标旁的图标查看）";
  }
  td.appendChild(f);
}

/* ----- 录单上传文件（Upload/<DN>/）：计数一次全取（GET /api/upload 不带 dn → {counts:{dn:n}}） ----- */
let uploadCounts = {};
async function fetchUploadCounts() {
  if (!API_BASE) return;   /* 离线模式无上传服务，全部灰图标 */
  try {
    const r = await fetch(API_BASE + "/upload?t=" + Date.now(), { signal: AbortSignal.timeout(5000) });
    if (r.ok) uploadCounts = (await r.json()).counts || {};
  } catch (e) { /* 不阻塞清单 */ }
}

/* 上传文件预览弹窗：文件卡片列表（图片直显 / PDF iframe / Excel SheetJS / Word docx-preview），
   文件名=下载链接（2026-10-20 v=cc）；头部「+ 上传」上传到 Upload/<DN>/ 后刷新列表与图标（v=ax） */
const UP_IMG_EXTS = ["png", "jpg", "jpeg", "gif", "bmp", "webp"];
async function openUploadFiles(dn) {
  const mask = document.createElement("div");
  mask.className = "pm-mask";
  const box = document.createElement("div");
  box.className = "pm-box pm-upload-box";
  mask.appendChild(box);
  mask.addEventListener("click", e => { if (e.target === mask) mask.remove(); });
  const head = document.createElement("div");
  head.className = "pm-head";
  const ttl = document.createElement("b");
  ttl.textContent = "上传文件：" + dn;
  const sp = document.createElement("span"); sp.className = "spacer";
  const upBtn = document.createElement("button");
  upBtn.className = "btn"; upBtn.type = "button"; upBtn.textContent = "+ 上传";
  const cls = document.createElement("button");
  cls.className = "btn"; cls.type = "button"; cls.textContent = "✕";
  cls.addEventListener("click", () => mask.remove());
  head.append(ttl, sp, upBtn, cls);
  const body = document.createElement("div");
  box.append(head, body);
  document.body.appendChild(mask);
  upBtn.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.multiple = true;
    inp.addEventListener("change", async () => {
      for (const file of inp.files) {
        try {
          await fetch(`${API_BASE}/upload?dn=${encodeURIComponent(dn)}&name=${encodeURIComponent(file.name)}`,
            { method: "POST", body: await file.arrayBuffer() });
        } catch (e) { /* 单文件失败不阻塞其余 */ }
      }
      await fetchUploadCounts();          /* 刷新计数 */
      renderRows(viewList);               /* 刷新清单行图标 */
      await loadFiles();                  /* 刷新弹窗列表（v=ax：上传后自动刷新） */
    });
    inp.click();
  });
  async function loadFiles() {
    body.innerHTML = "";
    let files = [];
    try {
      const r = await fetch(`${API_BASE}/upload?dn=${encodeURIComponent(dn)}`);
      if (r.ok) files = (await r.json()).files || [];
    } catch (e) { /* 空列表兜底 */ }
    if (!files.length) { body.innerHTML = '<div class="pm-empty">暂无上传文件</div>'; return; }
    files.forEach(fn => body.appendChild(upFileCard(dn, fn)));
  }
  await loadFiles();
}

/* 单个文件卡片：文件名下载链接 + 按格式预览 */
function upFileCard(dn, fn) {
  const ext = (fn.split(".").pop() || "").toLowerCase();
  const url = `../Upload/${dn}/${encodeURIComponent(fn)}`;   /* Upload/ 在应用根（pages/ 上一级） */
  const card = document.createElement("div");
  card.className = "pm-file-card";
  const name = document.createElement("a");
  name.className = "pm-file-link pm-file-name";
  name.textContent = fn; name.href = url; name.download = fn;
  card.appendChild(name);
  if (UP_IMG_EXTS.includes(ext)) {
    const im = document.createElement("img");
    im.src = url; im.alt = fn;
    card.appendChild(im);
  } else if (ext === "pdf") {
    const fr = document.createElement("iframe");
    fr.className = "pm-frame"; fr.src = url;
    card.appendChild(fr);
  } else if (["xlsx", "xls", "csv"].includes(ext) || ext === "docx") {
    const doc = document.createElement("div");
    doc.className = "pm-doc";
    const inner = document.createElement("div");
    inner.className = "pm-doc-inner";
    doc.appendChild(inner);
    card.appendChild(doc);
    fetch(url).then(r => r.arrayBuffer()).then(buf => {
      if (ext === "docx") return docx.renderAsync(buf, inner);
      const wb = XLSX.read(buf, { type: "array" });
      inner.innerHTML = XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]]);
    }).catch(() => { inner.textContent = "预览失败：" + fn; });
    addDocPreviewInteractions(doc, inner);
  }
  return card;
}
/* Excel/Word 预览：滚轮缩放 0.2×–3×，按住鼠标左键拖动滚动位置 */
function addDocPreviewInteractions(doc, inner) {
  let scale = 1, drag = null;
  doc.title = "按住鼠标左键拖动，滚轮缩放";
  doc.style.cursor = "grab";
  doc.style.userSelect = "none";
  doc.addEventListener("wheel", e => {
    e.preventDefault();
    scale = Math.min(3, Math.max(0.2, scale + (e.deltaY < 0 ? 0.1 : -0.1)));
    inner.style.transform = `scale(${scale})`;
  }, { passive: false });
  doc.addEventListener("pointerdown", e => {
    if (e.button !== 0 || e.pointerType !== "mouse" || e.target.closest("a, button")) return;
    e.preventDefault();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: doc.scrollLeft, top: doc.scrollTop };
    doc.setPointerCapture(e.pointerId);
    doc.style.cursor = "grabbing";
  });
  doc.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    doc.scrollLeft = drag.left - (e.clientX - drag.x);
    doc.scrollTop = drag.top - (e.clientY - drag.y);
  });
  const stopDrag = e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (doc.hasPointerCapture(drag.id)) doc.releasePointerCapture(drag.id);
    drag = null;
    doc.style.cursor = "grab";
  };
  doc.addEventListener("pointerup", stopDrag);
  doc.addEventListener("pointercancel", stopDrag);
  doc.addEventListener("lostpointercapture", stopDrag);
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

/* ----- 渲染（10 列：备注列在最后；2026-09-16 用户规则；
   回单日期列 2026-10-15 已并入下单状态列、从数组移除——残留单元格会撑出第 11 格导致整表列不对齐；
   姓名跨列用视觉溢出（nm-span），不用 colspan，避免格子数与 colgroup 不一致） ----- */
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
     cleanNote(o.note)                       /* 备注列（最后列；2026-09-16 用户规则） */
    ].forEach((v, i) => {
      const td = document.createElement("td");
      if (i === 2) {                                   /* 类型列（优先级分类移除；2026-09-20 用户规则） */
        td.textContent = o.order_type || "发货单";
      }
      else if (i === 3) fillAddrCell(td, o);   /* 地址列（第4列）：两行 */
      else if (i === 0) {                            /* DN 列：第一行号码（.dn-num 限宽省略），第二行 IS负责人/采购员 badge
                                                        （回单格式，与录单/下单页同款；2026-10-22 用户规则
                                                        「DN/PO的第二行的姓名格式同步到清单页面里的 DN / PO 列」）；
                                                        外协单显示 PO 号（98260 上标；2026-10-22 用户规则「清单页面里的 外协单 没有显示DN」）；
                                                        其他类型显示发件人姓名（2026-10-22 用户规则「清单页面里，如果是其它类型的发货， DN列显示发件人姓名」） */
        const ot0 = o.order_type || "发货单";
        const num = ot0 === "外协单" ? poHtml(poOf(o) || "—") : dnHtml(o.so);
        /* 第二行 badge 组：▼ 要求发货日期 / ▶ 下单日期 / 姓名（发货单=IS负责人、外协单=采购员、其他=发件人），最多跨 3 列 */
        const owner = ot0 === "外协单" ? buyerOf(o)
                    : ot0 === "其他"   ? senderOf(o)
                    : (o.is_owner || "");
        td.innerHTML = '<span class="dn-num">' + num + "</span>" + dnSecondRow(o, owner);
      }
      else if (i === 1) td.innerHTML = soHtml(o.so_no || "—");   /* SO 列：32600 前缀上标 */
      else if (i === 4) {                        /* 姓名列（第5列）：姓名+电话两行；未下单（单号空）时允许跨列显示
                                                    （2026-10-22 用户规则「姓名没有跨列显示」——视觉溢出到单号空位；
                                                    有单号保持省略，避免与运单号相撞） */
        fillNameCell(td, o);
        if (!o.waybill_no) td.classList.add("nm-span");
      }
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
      else if (i === 6) {                          /* 下单状态列（第7列）：已下单/待下单；下方回单日期徽章
                                                        （「回单 ₂₆ 10-19」格式，黑底白字加粗微圆角；
                                                        2026-10-23 用户规则「回单日期逻辑不对， 要显示回单签收的日期， 顺丰是有的， 德邦我不确定」——
                                                        回单签收日期=回单返回运单（顺丰 type=3）轨迹签收节点，存档 order_resp.sign_back_date；
                                                        人工置回单日 returned_at 优先；回单运单未签收有节点显示「回单 > <状态>」灰徽章（可点查路由，2026-10-24 规则，原「在途」二字弃用）；
                                                        德邦无回单运单追踪，仅人工置回单后显示） */
        td.textContent = v;
        let sbr = {};
        try { sbr = JSON.parse(o.order_resp || "{}") || {}; } catch (e) { /* 存档异常按无回单处理 */ }
        const retDay = dayOf(o.returned_at) || (sbr.sign_back_date || "").slice(0, 10);
        const rm = retDay.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (rm) {
          const rb = document.createElement("div");
          rb.className = "ret-badge";
          rb.innerHTML = '回单 <sup>' + rm[1].slice(2) + "</sup> " + rm[2] + "-" + rm[3];
          rb.title = (o.returned_at ? "人工置回单：" : "回单签收：") + retDay + "；点击查看回单路由";
          rb.style.cursor = "pointer";   /* 可点：查看回单运单路由（2026-10-23 用户规则「当点击 回单 26 10-23 可以显示路由信息」） */
          rb.addEventListener("click", e => { e.stopPropagation(); openSignBackRoute(o); });
          td.appendChild(rb);
        } else if (sbr.sign_back_status) {
          const rb = document.createElement("div");
          rb.className = "ret-badge ret-transit";
          /* 显示回单运单真实状态（2026-10-24 用户规则「回单 显示 在途 二字 不合适， 可以改为 回单 > 运送中 ，同时可以点击查看路由信息」） */
          rb.textContent = "回单 > " + sbr.sign_back_status;
          rb.title = "回单运单：" + sbr.sign_back_status + "；点击查看回单路由";
          rb.style.cursor = "pointer";
          rb.addEventListener("click", e => { e.stopPropagation(); openSignBackRoute(o); });
          td.appendChild(rb);
        }
      }
      else if (i === 8) fillPhotoCell(td, o);   /* 发货照片列（第9列）：有共享盘照片可点 */
      else if (i === 9) {                          /* 备注列：单行悬浮查看 + 尾部复制完整纯备注 */
        NoteCopy.fill(td, v, { singleLine: true });
        td.classList.add("lm-note");
      }
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

/* ----- 视图过滤：类型与自提四个按钮统一单选 + 搜索（在统计口径基础集合内）；
   优先级筛选组移除（2026-09-20 用户规则：分类只留在录单页，紧急行整行加粗红字） ----- */
let activeType = "";
let pickupOnly = false;
let pickedNameQuery = "";

/* 只取我方人员，不把对方联系人/接收方 name 作为快捷筛选候选。 */
function ownNameOf(o) {
  const type = o.order_type || "发货单";
  if (type === "外协单") return buyerOf(o);
  if (type === "其他") return senderOf(o);   /* 员工 emp_name，兼容旧备注发件人 */
  return o.is_owner || "";                 /* 发货单 SO 负责人 */
}

/* 四类筛选显示去重的我方姓名；每页只容纳完整标签，左右箭头切换剩余姓名。
   选中姓名与手工关键词是两个独立条件，可继续输入进行 AND 筛选。 */
let nameChipPage = 0;
let nameChipPages = [];
let nameChipExpanded = false;

function setNameChipExpanded(expanded) {
  const box = $("lmNameChips");
  const panel = $("lmNameChipPopover");
  const toggle = box.querySelector(".lm-name-chip-expand");
  nameChipExpanded = Boolean(expanded && !box.hidden);
  if (panel) panel.hidden = !nameChipExpanded;
  if (toggle) {
    toggle.textContent = "▾";
    toggle.title = nameChipExpanded ? "收起全部姓名" : "展开全部姓名";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(nameChipExpanded));
  }
}

function renderNameChipPage() {
  const box = $("lmNameChips");
  nameChipPage = Math.max(0, Math.min(nameChipPage, nameChipPages.length - 1));
  const visible = new Set(nameChipPages[nameChipPage] || []);
  box.querySelectorAll(".lm-name-chip").forEach(b => { b.hidden = !visible.has(b.dataset.name); });
  box.dataset.page = String(nameChipPage + 1);
}

function updateNameChips(force = false) {
  const box = $("lmNameChips");
  const kind = activeType || (pickupOnly ? "自提" : "");
  const sourceLabel = ({ "发货单": "SO负责人", "外协单": "采购员", "其他": "员工" })[kind] || "我方人员";
  const names = kind
    ? [...new Set(baseList
        .filter(o => activeType
          ? (o.order_type || "发货单") === activeType
          : o.carrier === "自提")
        .map(o => String(ownNameOf(o) || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"))
    : [];
  const signature = JSON.stringify([names, pickedNameQuery, kind]);
  if (!force && box.dataset.signature === signature) return;
  const sameKind = box.dataset.kind === kind;
  const anchor = sameKind
    ? pickedNameQuery || box.querySelector(".lm-name-chip:not([hidden])")?.dataset.name || ""
    : "";
  box.dataset.signature = signature;
  box.dataset.kind = kind;
  box.hidden = !names.length;
  if (!sameKind || !names.length) nameChipExpanded = false;
  box.setAttribute("aria-label", `${kind || "当前类型"}${sourceLabel}快捷筛选`);

  const makeChip = name => {
    const selected = pickedNameQuery === name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lm-name-chip" + (selected ? " active" : "");
    button.dataset.name = name;
    button.setAttribute("aria-pressed", String(selected));
    button.title = selected ? `取消${sourceLabel} ${name} 筛选` : `按${sourceLabel} ${name} 筛选`;
    const label = document.createElement("span");
    label.textContent = name;
    const remove = document.createElement("span");
    remove.className = "lm-name-chip-remove";
    remove.textContent = "×";
    remove.hidden = !selected;
    remove.setAttribute("aria-hidden", "true");
    button.append(label, remove);
    button.addEventListener("click", () => {
      pickedNameQuery = selected ? "" : name;
      nameChipExpanded = false;
      applyView();
    });
    return button;
  };
  const expand = document.createElement("button");
  expand.type = "button";
  expand.className = "lm-name-chip-nav lm-name-chip-expand";
  expand.setAttribute("aria-controls", "lmNameChipPopover");
  expand.addEventListener("click", () => setNameChipExpanded(!nameChipExpanded));
  const frag = document.createDocumentFragment();
  names.forEach(name => frag.appendChild(makeChip(name)));
  frag.appendChild(expand);
  box.replaceChildren(frag);

  let panel = $("lmNameChipPopover");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "lmNameChipPopover";
    panel.className = "lm-name-chip-popover";
    panel.hidden = true;
    box.parentElement.appendChild(panel);
  }
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", `全部${kind || "当前类型"}${sourceLabel}姓名`);
  const panelFrag = document.createDocumentFragment();
  names.forEach(name => panelFrag.appendChild(makeChip(name)));
  panel.replaceChildren(panelFrag);

  const chips = [...box.querySelectorAll(".lm-name-chip")];
  const widths = chips.map(b => Math.ceil(b.getBoundingClientRect().width));
  const gap = parseFloat(getComputedStyle(box).gap) || 0;
  const available = box.clientWidth;
  const expandSpace = Math.ceil(expand.getBoundingClientRect().width + gap);
  const paginate = limit => {
    const pages = [];
    let page = [], used = 0;
    names.forEach((name, i) => {
      let addition = (page.length ? gap : 0) + widths[i];
      if (page.length && used + addition > limit) {
        pages.push(page);
        page = [];
        used = 0;
        addition = widths[i];
      }
      page.push(name);
      used += addition;
    });
    if (page.length) pages.push(page);
    return pages;
  };
  nameChipPages = paginate(Math.max(1, available - expandSpace));
  const anchoredPage = nameChipPages.findIndex(page => page.includes(anchor));
  nameChipPage = anchoredPage >= 0 ? anchoredPage : Math.min(nameChipPage, Math.max(0, nameChipPages.length - 1));
  if (!sameKind) nameChipPage = 0;
  renderNameChipPage();
  setNameChipExpanded(nameChipExpanded);
}

/* 工具栏宽度或字体变化后重新按完整标签分页。 */
let nameChipResizeFrame = 0;
const scheduleNameChipLayout = () => {
  cancelAnimationFrame(nameChipResizeFrame);
  nameChipResizeFrame = requestAnimationFrame(() => {
    if (!$("lmNameChips").hidden) updateNameChips(true);
  });
};
const nameChipResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(scheduleNameChipLayout) : null;
if (nameChipResizeObserver) nameChipResizeObserver.observe($("lmNameChips").parentElement);
else window.addEventListener("resize", scheduleNameChipLayout);
if (document.fonts?.ready) document.fonts.ready.then(scheduleNameChipLayout);
const nameChipSearchField = $("lmNameChips").parentElement;
document.addEventListener("click", e => {
  if (nameChipExpanded && !nameChipSearchField.contains(e.target)) setNameChipExpanded(false);
});
nameChipSearchField.addEventListener("keydown", e => {
  if (e.key === "Escape" && nameChipExpanded) {
    e.preventDefault();
    setNameChipExpanded(false);
    nameChipSearchField.querySelector(".lm-name-chip-expand")?.focus();
  }
});

function clearPickedNameQuery() {
  const input = $("lmSearch");
  if (pickedNameQuery && input.value === pickedNameQuery) input.value = "";
  pickedNameQuery = "";
}

function applyView() {
  updateNameChips();
  let list = baseList;
  if (activeType) {
    list = list.filter(o => (o.order_type || "发货单") === activeType);
  }
  if (pickupOnly) list = list.filter(o => o.carrier === "自提");
  const queries = [pickedNameQuery, $("lmSearch").value]
    .map(q => q.trim().toLowerCase()).filter(Boolean);
  if (queries.length) {
    list = list.filter(o => {
      const text = [o.so, o.so_no, o.priority, o.order_type, o.address, o.name, o.phone, o.note, o.carrier,
        o.is_owner, buyerOf(o), senderOf(o),   /* IS负责人/采购员/员工发件人均入搜索，标签点选与普通搜索同口径 */
        o.waybill_no, o.route_status, o.waybill_no ? "已下单" : "待下单",
        dayOf(o.returned_at)].join(" ").toLowerCase();
      return queries.every(q => text.includes(q));   /* 姓名标签与继续输入的关键词叠加筛选 */
    });
  }
  viewList = list;   /* 分享/导出按当前可见集合（2026-09-16 分享四件套） */
  renderRows(list);
}

const typeFilterButtons = document.querySelectorAll(".lm-type .otype");
typeFilterButtons.forEach(b => {
  b.addEventListener("click", () => {
    clearPickedNameQuery();
    const was = b.classList.contains("active");
    typeFilterButtons.forEach(x => x.classList.remove("active"));
    activeType = was ? "" : b.dataset.t;   /* 再点当前项取消，恢复全部 */
    if (activeType) b.classList.add("active");
    pickupOnly = false;                    /* 类型与自提互斥，不叠加 */
    $("btnLmPickupFilter").classList.remove("active");
    $("btnLmPickupFilter").setAttribute("aria-pressed", "false");
    applyView();
  });
});
$("btnLmPickupFilter").addEventListener("click", () => {
  clearPickedNameQuery();
  pickupOnly = !pickupOnly;
  if (pickupOnly) {
    activeType = "";
    typeFilterButtons.forEach(x => x.classList.remove("active"));
  }
  $("btnLmPickupFilter").classList.toggle("active", pickupOnly);
  $("btnLmPickupFilter").setAttribute("aria-pressed", String(pickupOnly));
  applyView();
});
$("lmSearch").addEventListener("input", applyView);   /* 输入只增加关键词，不清除已选姓名 */

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
    if (d.manual_entry) out.manual_entry = d.manual_entry;   /* 系统外手工补录来源（2026-10-24） */
    return JSON.stringify(out, null, 2);
  } catch (e) { return o.order_resp; }
}

function signBackNo(o) {   /* 回签单号（顺丰纸质回单 type=3，下单存档 order_resp.sign_back_no） */
  try {
    return ((JSON.parse(o.order_resp || "{}").sign_back_no) || "").trim();
  } catch (e) { return ""; }
}

/* 回单返回信息（2026-09-29 官方逻辑终定；2026-10-08 用户定案：顺丰账号侧到方地址已维护、
   4 张历史误投回单已结案 → 撤掉「维护申请」文案/复制按钮/硬编码历史单号，此处只留回单返回信息）：
   选择回单后顺丰自动带一张回单返回运单：单号=原回单号（SF106 开头 waybillType=3），
   收件人签收后自动**反向、到付**返回（历史单轨迹实锤），无需人工改单、无需再申请维护地址。
   到方地址为顺丰侧固定值（2026-10-08 用户口径：地址固定、无需维护）——平台侧不配置、不下发、不提示。 */
function signBackInfoEl(o) {
  const sb = signBackNo(o);
  if (o.carrier !== "顺丰" || !sb) return null;
  const txt = "回单运单号：" + sb + "（原运单 " + (o.waybill_no || "") +
      (o.so ? "，DN " + o.so : "") + "）\n" +
    "返回方式：收件人签收后顺丰自动反向、运费到付返回莱克勒（金坛区德城路99号）\n" +
    "平台打印：主面单 + 反向回签单同一 PDF 随货走；实物回单到达后人工置「已回单」（2026-09-29 起新单不自动置）";
  return stepEl("回单返回：顺丰自动反向 + 到付（同 SF106 回单号）", "", txt);
}

async function openSteps(o) {
  stepsTitle.textContent = `${o.so || "#" + o.id} · ${o.carrier || "—"} · ${o.waybill_no}`;
  stepsBody.innerHTML = "";
  stepsBody.appendChild(stepEl("第一步：下单返回值", o.created_at || "", fmtOrderResp(o)));
  const sbe = signBackInfoEl(o);   /* 顺丰回单返回：自动反向+到付（2026-10-08 撤维护申请块，只留信息） */
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

/* 点击回单日期徽章：显示回单运单路由（顺丰 type=3 回签单 SF106；2026-10-23 用户规则「当点击 回单 26 10-23 可以显示路由信息」）。
   无回单运单（德邦无回单追踪/专车自提人工置回单）→ 回退显示主运单路由并提示 */
async function openSignBackRoute(o) {
  const sb = signBackNo(o);
  const wb = sb || o.waybill_no || "";
  stepsTitle.textContent = `${o.so || "#" + o.id} · ${o.carrier || "—"} · 回单路由 ${wb || "—"}`;
  stepsBody.innerHTML = "";
  if (sb) {
    stepsBody.appendChild(stepEl("回单运单：顺丰自动反向 + 到付", "",
      "回单运单号：" + sb + "（原运单 " + (o.waybill_no || "") + (o.so ? "，DN " + o.so : "") + "）"));
  } else {
    stepsBody.appendChild(stepEl("无回单运单追踪", "",
      (o.returned_at ? "人工置回单：" + dayOf(o.returned_at) + "；" : "") +
      "该单无回单运单（德邦无回单追踪/专车自提），以下为主运单路由"));
  }
  stepsMask.hidden = false;
  if (!API_BASE || !o.carrier || !wb) return;
  try {
    /* 回单 SF106 不存在于 orders.waybill_no，后端无法据它反查主订单电话；
       与自动回单刷新一致，显式带原订单收/寄件电话后四位，避免顺丰到付回单误报 20028。 */
    const phone4 = String(o.phone || o.emp_phone || "").replace(/\D/g, "").slice(-4);
    const r = await fetch(`${API_BASE}/carrier/route?carrier=${encodeURIComponent(o.carrier)}` +
                          `&waybill_no=${encodeURIComponent(wb)}&phone4=${encodeURIComponent(phone4)}`);
    const d = await r.json().catch(() => ({}));
    /* 注意：不回写 o.route_status——查的是回单运单，其状态不得污染主单路由状态 */
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

/* ----- 系统外运单手工补录：只新增独立记录，不搜索、关联或更新已录订单 ----- */
const manualMask = $("manualWaybillMask");
const manualEntries = new Map();   /* 本地草稿序号 -> 新记录；序号不是订单 ID，也不会发送给后端 */
const MW_ROUTE_STATUSES = ["待揽收", "已揽收", "运送中", "派送中", "已签收"];
let manualSaving = false;
let manualSeq = 0;

function mwInput(item, key, labelText, className, placeholder, maxLength) {
  const label = document.createElement("label"); label.className = "mw-input " + className;
  const caption = document.createElement("span"); caption.textContent = labelText;
  const input = document.createElement("input");
  input.value = item[key]; input.placeholder = placeholder || ""; input.maxLength = maxLength;
  input.autocomplete = "off"; input.setAttribute("aria-label", labelText);
  input.addEventListener("input", () => {
    item[key] = input.value; input.classList.remove("invalid"); $("mwMessage").textContent = "";
  });
  label.append(caption, input);
  return label;
}
const MW_CUSTOM_CARRIER = "__custom__";
function mwDefaultCarrierValue() {
  const select = $("mwDefaultCarrier");
  return (select.value === MW_CUSTOM_CARRIER ? $("mwDefaultCarrierCustom").value : select.value).trim();
}
function mwCarrierInput(item) {
  const label = mwInput(item, "carrier", "承运商（必填）", "mw-carrier", "请输入其他承运商", 30);
  const input = label.querySelector("input");
  const select = document.createElement("select"); select.setAttribute("aria-label", "承运商（必填）");
  Array.from($("mwDefaultCarrier").options).forEach(option => select.add(new Option(option.text, option.value)));
  select.value = Array.from(select.options).some(option => option.value === item.carrier) ? item.carrier : MW_CUSTOM_CARRIER;
  input.hidden = select.value !== MW_CUSTOM_CARRIER;
  input.setAttribute("aria-label", "其他承运商（手动输入）");
  label.insertBefore(select, input);
  select.addEventListener("change", () => {
    const custom = select.value === MW_CUSTOM_CARRIER;
    select.classList.remove("invalid"); input.classList.remove("invalid"); input.hidden = !custom;
    item.carrier = custom ? "" : select.value; input.value = custom ? "" : item.carrier;
    $("mwMessage").textContent = "";
    if (custom) input.focus();
  });
  return label;
}
function mwAddEntry() {
  if (manualSaving) return;
  if (manualEntries.size >= 100) {
    $("mwMessage").textContent = "每批最多补录 100 条，请先保存本批。";
    return;
  }
  const key = ++manualSeq;
  manualEntries.set(key, { so: "", so_no: "", company: "", name: "", phone: "", address: "", note: "",
    carrier: mwDefaultCarrierValue() || "顺丰", waybill_no: "",
    route_status: $("mwDefaultRouteStatus").value });
  $("mwMessage").textContent = ""; mwRenderEntries();
  const row = $("mwEntries").querySelector(`[data-key="${key}"]`);
  if (row) { row.scrollIntoView({ block: "nearest" }); row.querySelector(".mw-so input").focus(); }
}
function mwRenderEntries() {
  const box = $("mwEntries"); box.innerHTML = "";
  $("mwEntryTitle").textContent = `待补录 ${manualEntries.size} 条（均为独立新增，不关联已录订单）`;
  $("mwSave").textContent = manualEntries.size ? `批量保存 (${manualEntries.size})` : "批量保存";
  $("mwSave").disabled = !manualEntries.size || !API_BASE || manualSaving;
  $("mwAdd").disabled = manualSaving || manualEntries.size >= 100;
  if (!manualEntries.size) {
    box.innerHTML = '<div class="mw-empty">点击上方“＋ 添加外部运单”开始<br>可连续添加多条后统一批量保存</div>';
    return;
  }
  manualEntries.forEach((item, key) => {
    const row = document.createElement("div"); row.className = "mw-entry"; row.dataset.key = key;
    const main = document.createElement("div"); main.className = "mw-entry-main";
    main.append(
      mwInput(item, "so", "DN", "mw-so", "DN", 100),
      mwInput(item, "so_no", "SO", "mw-so-no", "SO", 100),
      mwInput(item, "company", "公司", "mw-company", "收件公司（可选）", 200),
      mwInput(item, "name", "姓名", "mw-name", "收件人姓名", 100),
      mwInput(item, "phone", "电话", "mw-phone", "收件人电话", 50),
      mwInput(item, "note", "备注", "mw-note", "备注（可选）", 1000));

    const transport = document.createElement("div"); transport.className = "mw-entry-transport";
    transport.append(
      mwInput(item, "address", "地址", "mw-address", "收件地址", 500),
      mwCarrierInput(item),
      mwInput(item, "waybill_no", "运单号（必填）", "mw-waybill", "运单号", 100));
    const statusLabel = document.createElement("label"); statusLabel.className = "mw-input mw-route";
    const statusCaption = document.createElement("span"); statusCaption.textContent = "路由状态";
    const status = document.createElement("select"); status.setAttribute("aria-label", "路由状态");
    MW_ROUTE_STATUSES.forEach(s => status.add(new Option(s, s)));
    status.value = item.route_status;
    status.addEventListener("change", () => { item.route_status = status.value; });
    statusLabel.append(statusCaption, status);
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "mw-remove"; remove.textContent = "×";
    remove.title = "移出本批"; remove.setAttribute("aria-label", "移出本批");
    remove.disabled = manualSaving;
    remove.addEventListener("click", () => { manualEntries.delete(key); mwRenderEntries(); });
    transport.append(statusLabel, remove);
    row.append(main, transport); box.appendChild(row);
  });
}
function openManualWaybill() {
  if (manualSaving) return;
  manualEntries.clear(); $("mwMessage").textContent = "";
  $("mwDefaultRouteStatus").value = "已签收";
  if (!API_BASE) $("mwMessage").textContent = "API 当前离线，无法保存；请恢复服务后重试。";
  manualMask.hidden = false; mwAddEntry();
}
function closeManualWaybill() { if (!manualSaving) manualMask.hidden = true; }

async function saveManualWaybills() {
  if (manualSaving || !manualEntries.size || !API_BASE) return;
  const items = [];
  for (const [key, item] of manualEntries) {
    const carrier = item.carrier.trim(), waybill = item.waybill_no.trim();
    const row = $("mwEntries").querySelector(`[data-key="${key}"]`);
    const carrierInput = row && (row.querySelector(".mw-carrier input:not([hidden])") || row.querySelector(".mw-carrier select"));
    const waybillInput = row && row.querySelector(".mw-waybill input");
    if (!carrier || !waybill) {
      if (carrierInput) carrierInput.classList.toggle("invalid", !carrier);
      if (waybillInput) waybillInput.classList.toggle("invalid", !waybill);
      const firstMissing = !carrier ? carrierInput : waybillInput;
      if (firstMissing) firstMissing.focus();
      $("mwMessage").textContent = `第 ${items.length + 1} 条：承运商和运单号均为必填项。`;
      return;
    }
    items.push({ so: item.so.trim(), so_no: item.so_no.trim(), company: item.company.trim(),
      name: item.name.trim(), phone: item.phone.trim(), address: item.address.trim(), note: item.note.trim(),
      carrier, waybill_no: waybill, route_status: item.route_status });
  }
  manualSaving = true; manualMask.setAttribute("aria-busy", "true");
  $("mwMessage").textContent = ""; mwRenderEntries();
  $("mwSave").textContent = `正在保存 ${items.length} 条…`;
  try {
    const r = await fetch(API_BASE + "/orders/manual-waybills", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || ("HTTP " + r.status));
    if (!Array.isArray(d.orders) || d.orders.length !== items.length) {
      throw new Error("服务端返回的新记录数量不一致，请刷新清单核对");
    }
    orders = d.orders.concat(orders);   /* 返回的都是新 ID；只追加，绝不替换已有订单 */
    baseList = activeFilter ? orders.filter(activeFilter.fn) : orders;
    applyView();
    manualSaving = false; manualMask.removeAttribute("aria-busy");
    closeManualWaybill();
    toast(`已新增 ${d.count || items.length} 条独立系统外运单`);
  } catch (e) {
    $("mwMessage").textContent = "保存失败：" + e.message + "；服务端采用整批事务，请刷新核对后重试。";
  } finally {
    manualSaving = false; manualMask.removeAttribute("aria-busy");
    mwRenderEntries();
  }
}
$("btnManualWaybill").addEventListener("click", openManualWaybill);
$("manualWaybillClose").addEventListener("click", closeManualWaybill);
$("mwCancel").addEventListener("click", closeManualWaybill);
$("mwAdd").addEventListener("click", mwAddEntry);
$("mwSave").addEventListener("click", saveManualWaybills);
$("mwDefaultCarrier").addEventListener("change", () => {
  const custom = $("mwDefaultCarrier").value === MW_CUSTOM_CARRIER;
  $("mwDefaultCarrierCustom").hidden = !custom;
  if (custom) { $("mwDefaultCarrierCustom").value = ""; $("mwDefaultCarrierCustom").focus(); }
});
$("mwApplyDefaults").addEventListener("click", () => {
  const carrier = mwDefaultCarrierValue();
  if (!carrier) { $("mwMessage").textContent = "请先填写默认承运商。"; return; }
  if (!manualEntries.size) { $("mwMessage").textContent = "请先添加外部运单明细。"; return; }
  manualEntries.forEach(item => {
    item.carrier = carrier; item.route_status = $("mwDefaultRouteStatus").value;
  });
  $("mwMessage").textContent = ""; mwRenderEntries();
});
manualMask.addEventListener("click", e => { if (e.target === manualMask) closeManualWaybill(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !manualMask.hidden) closeManualWaybill();
});

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
const SHARE_HEAD = ["DN", "SO", "优先级", "类型", "地址", "姓名", "电话", "单号", "下单时间", "签收时间", "下单状态", "路由状态", "回单日期", "备注"];
const shareRowOf = o => [o.so || "", o.so_no || "", o.priority || "一般", o.order_type || "发货单",
                         o.address || "", o.name || "", o.phone || "", o.waybill_no || "",
                         o.printed_at || "", o.signed_at || "",   /* 下单时间/签收时间（2026-10-22 用户规则「清单页面 在导出时候， 需要把快递的下单时间， 签收时间都导出」） */
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
  await fetchUploadCounts();   /* 上传文件计数（Upload/<DN>/ 附件数；无服务不阻塞清单） */
  baseList = activeFilter ? orders.filter(activeFilter.fn) : orders;
  applyView();
})();
