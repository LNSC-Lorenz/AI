#!/usr/bin/env node
/* 发货·可合并清单（每日提示）
 * 只读拉取 Fahuo 生产 API，列出「同承运商 + 同收件地址 + 同收件人 + 同电话」且都还没下单的行，
 * 按 App 下单页「合并」开关的同一严格口径分组（见 assets/js/pages/2-order.js mergeKeyOf），
 * 不写任何数据、不改 App。
 *
 * 用法：node merge-hint.mjs [--date=YYYY-MM-DD] [--base=URL] [--out=文件] [--json] [--quiet]
 */
import fs from "node:fs";
import path from "node:path";

const arg = (k, d) => {
  const a = process.argv.find(s => s.startsWith("--" + k + "="));
  return a ? a.slice(k.length + 3) : d;
};
const has = k => process.argv.includes("--" + k);
const BASE = arg("base", process.env.FAHUO_API || "http://10.86.180.76/apps/fahuo/api");

const pad2 = n => String(n).padStart(2, "0");
const now = new Date();
const dstr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const TODAY = arg("date", dstr(now));
const YDATE = dstr(new Date(now.getTime() - 864e5));

const rows = await (await fetch(`${BASE}/orders`)).json();
if (!Array.isArray(rows)) { console.error("接口返回异常：" + JSON.stringify(rows).slice(0, 200)); process.exit(1); }

const no     = o => o.order_type === "外协单" ? (o.po || "") : o.order_type === "发货单" ? (o.so_no || o.so || "") : "（个人件）";
const tail   = p => String(p || "").replace(/\D/g, "").slice(-4);
const addr   = o => [o.province, o.city, o.district, o.street].filter(Boolean).join("");
const pending = o => !o.waybill_no;                       /* 待下单（与 App 一致：有运单号即已下单） */
/* 严格合并键：类型 + 承运商 + 四级地址 + 收件人 + 电话（App 现在只对外协单开放合并下单） */
const key    = o => [o.order_type || "发货单", o.carrier || "", o.province || "", o.city || "",
                     o.district || "", o.street || "", o.name || "", o.phone || ""].join("\u0001");
const groupBy = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); return m; }, new Map());

const pendToday = rows.filter(o => o.ship_date === TODAY && pending(o));
const overdue   = rows.filter(o => o.ship_date && o.ship_date < TODAY && pending(o));
const noCarrier = [...pendToday, ...overdue].filter(o => !(o.carrier || "").trim());
const cand      = [...pendToday, ...overdue].filter(o => (o.carrier || "").trim());

const L = [];
const log = (...a) => L.push(a.join(" "));
log(`发货·可合并清单  ${TODAY} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`);
log(`数据源 ${BASE}（只读，未做任何写操作）`);
log(`今日(${TODAY}) 待下单 ${pendToday.length} 行；逾期未下单 ${overdue.length} 行` +
    (overdue.length ? `（最早 ${overdue.map(o => o.ship_date).sort()[0]}）` : ""));

/* 逾期单今天要一起补发，所以今日+逾期的待下单一并分组 */
const groups = [...groupBy(cand, key).values()].filter(g => g.length >= 2)
  .sort((a, b) => b.length - a.length || a[0].order_type.localeCompare(b[0].order_type));
log("");
log("■ 可合并组（同承运商 + 同地址 + 同收件人 + 同电话，且全部未下单）");
if (!groups.length) log("  （无）");
let saveAll = 0, saveNow = 0;
groups.forEach((g, i) => {
  const t = g[0].order_type || "发货单";
  const save = g.length - 1;
  saveAll += save;
  const appCan = t === "外协单";
  if (appCan) saveNow += save;
  const dates = [...new Set(g.map(o => o.ship_date))].sort();
  log(`  ${i + 1}) ${t} ×${g.length}　${g[0].carrier}　${g[0].name || "（无姓名）"} 尾号${tail(g[0].phone)}　${addr(g[0])}`);
  log(`     单据：${g.map(o => (o.ship_date !== TODAY ? o.ship_date.slice(5) + " " : "") + no(o)).join(" / ")}`);
  log(`     → 合成 1 张运单，可省 ${save} 张　${appCan ? "【App 可直接合并：外协单页签 → 多选 → 合并】" : "【App 暂未对" + t + "开放合并下单，需分别下单】"}` +
      (dates[0] < TODAY ? `　⚠️含逾期 ${dates.filter(d => d < TODAY).length} 天档` : ""));
});
log("");
log(`  小计：${groups.length} 组 / ${groups.reduce((s, g) => s + g.length, 0)} 行，可省 ${saveAll} 张运单` +
    `（其中 App 现在能直接合并的：省 ${saveNow} 张）`);

if (noCarrier.length) {
  log("");
  log("■ 缺承运商（无法下单，需先在录单里选承运商）");
  const ncByKey = groupBy(noCarrier, o => [o.order_type, o.province, o.city, o.district, o.street, o.name, o.phone].join("\u0001"));
  noCarrier.forEach(o => {
    const n = ncByKey.get([o.order_type, o.province, o.city, o.district, o.street, o.name, o.phone].join("\u0001")).length;
    log(`  - ${o.order_type || "发货单"} ${no(o)}　${o.name} 尾号${tail(o.phone)}　${addr(o)}　${o.ship_date}` +
        (o.ship_date < TODAY ? "（逾期）" : "") +
        (n >= 2 ? `　※ 同收件共 ${n} 张，选好承运商后即可合成 1 张运单` : ""));
  });
}

/* 昨日复盘：同一收件信息实际开出多张运单 → 用真实数据说明合并价值 */
const yd = rows.filter(o => o.ship_date === YDATE && o.waybill_no && o.route_status !== "待揽收");
const ygroups = [...groupBy(yd, key).values()].filter(g => new Set(g.map(o => o.waybill_no)).size >= 2)
  .sort((a, b) => new Set(b.map(o => o.waybill_no)).size - new Set(a.map(o => o.waybill_no)).size);
const ySave = ygroups.reduce((s, g) => s + new Set(g.map(o => o.waybill_no)).size - 1, 0);
log("");
log(`■ 昨日(${YDATE})拆单复盘：${yd.length} 行 / ${new Set(yd.map(o => o.waybill_no)).size} 张运单` +
    (ygroups.length ? `，同类收件被拆开的 ${ygroups.length} 组可省 ${ySave} 张` : "，无同类收件拆单"));
ygroups.forEach(g => {
  const wbs = [...new Set(g.map(o => o.waybill_no))];
  log(`  - ${g[0].order_type || "发货单"} ${g[0].carrier}　${g[0].name} 尾号${tail(g[0].phone)}　${addr(g[0])}`);
  log(`     ${g.map(no).join(" / ")} → ${wbs.length} 张运单（可省 ${wbs.length - 1}）：${wbs.join(" / ")}`);
});

const text = L.join("\n") + "\n";
if (has("json")) {
  process.stdout.write(JSON.stringify({
    date: TODAY, base: BASE,
    pending_today: pendToday.length, overdue: overdue.length,
    groups: groups.map(g => ({ type: g[0].order_type, carrier: g[0].carrier, name: g[0].name,
      address: addr(g[0]), save: g.length - 1,
      rows: g.map(o => ({ id: o.id, no: no(o), ship_date: o.ship_date, waybill: o.waybill_no })) })),
    no_carrier: noCarrier.map(o => ({ id: o.id, no: no(o), ship_date: o.ship_date })),
    yesterday_review: { date: YDATE, shipped_rows: yd.length, waybills: new Set(yd.map(o => o.waybill_no)).size, save: ySave },
  }, null, 2) + "\n");
} else {
  if (!has("quiet")) process.stdout.write(text);
  const out = arg("out", path.join(process.env.USERPROFILE || process.env.HOME || ".", "Documents", "Fahuo",
    `可合并清单-${TODAY}.txt`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, "\ufeff" + text, "utf8");
  if (!has("quiet")) console.log("已保存：" + out);
}
