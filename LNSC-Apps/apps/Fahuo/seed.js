#!/usr/bin/env node
/* 种子脚本：向 fahuo.db 写入 8 条模拟发货数据（可重复运行，自动清空单表后重插）
 * 用法：node seed.js   （服务器上也可用 node 跑；或直接上传本机生成的 fahuo.db） */
"use strict";
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "fahuo.db"));
db.exec("PRAGMA journal_mode=WAL;");
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  so TEXT DEFAULT '', province TEXT DEFAULT '', city TEXT DEFAULT '',
  district TEXT DEFAULT '', street TEXT DEFAULT '',
  name TEXT DEFAULT '', phone TEXT DEFAULT '', carrier TEXT DEFAULT '',
  note TEXT DEFAULT '', status TEXT DEFAULT 'pending', ship_date TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  printed_at TEXT, shipped_at TEXT, returned_at TEXT
);`);
/* 旧库迁移：补充新增列 */
const _cols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);
if (!_cols.includes("waybill_no")) db.exec("ALTER TABLE orders ADD COLUMN waybill_no TEXT DEFAULT ''");
if (!_cols.includes("route_status")) db.exec("ALTER TABLE orders ADD COLUMN route_status TEXT DEFAULT ''");
if (!_cols.includes("priority")) db.exec("ALTER TABLE orders ADD COLUMN priority TEXT DEFAULT '一般'");
if (!_cols.includes("order_type")) db.exec("ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT '发货单'");
if (!_cols.includes("so_no")) db.exec("ALTER TABLE orders ADD COLUMN so_no TEXT DEFAULT ''");

const d = (offset) => new Date(Date.now() + offset * 864e5).toLocaleDateString("sv-SE");
const Y = d(-1), T = d(0), T1 = d(1), T2 = d(2);   // 昨天/今天/明天/后天

const ROWS = [
  // 昨日发货 ×2（shipped，shipped_at=昨天）
  { so: "81001401", province: "上海市", city: "上海市", district: "浦东新区",
    street: "张江高科技园区博云路2号", name: "王建军", phone: "13801652347",
    carrier: "顺丰", status: "shipped", ship_date: Y, shipped_at: Y + " 16:32:00",
    waybill_no: "SF8100140188", route_status: "运输中" },
  { so: "81001402", province: "浙江省", city: "杭州市", district: "滨江区",
    street: "网商路599号 网易大厦", name: "李晓梅", phone: "13706518832",
    carrier: "德邦", status: "shipped", ship_date: Y, shipped_at: Y + " 17:05:00",
    waybill_no: "DPK8100140206", route_status: "运输中" },
  // 在途追加 ×4（不同节点/时效，共 6 条在途，供可视化多环演示）
  { so: "81001403", province: "北京市", city: "北京市", district: "海淀区",
    street: "中关村大街27号 中关村大厦", name: "赵国庆", phone: "13911002345",
    carrier: "跨越", status: "shipped", ship_date: Y, shipped_at: Y + " 09:12:00",
    waybill_no: "KYE8100140321", route_status: "派送中", priority: "重要" },
  { so: "81001404", province: "重庆市", city: "重庆市", district: "渝北区",
    street: "金开大道1008号 两江星汇", name: "周敏", phone: "13594226677",
    carrier: "顺丰", status: "shipped", ship_date: T, shipped_at: T + " 08:40:00",
    waybill_no: "SF8100140466", route_status: "已揽收", priority: "紧急" },
  { so: "81001405", province: "湖北省", city: "武汉市", district: "江夏区",
    street: "藏龙岛科技园杨桥湖大道15号", name: "吴建军", phone: "13871235544",
    carrier: "德邦", status: "shipped", ship_date: Y, shipped_at: Y + " 20:15:00",
    waybill_no: "DPK8100140512", route_status: "运输中" },
  { so: "81001406", province: "江苏省", city: "南京市", district: "雨花台区",
    street: "软件大道109号 雨花客厅", name: "郑晓峰", phone: "13951776655",
    carrier: "跨越", status: "shipped", ship_date: T, shipped_at: T + " 06:50:00",
    waybill_no: "KYE8100140645", route_status: "运输中", priority: "重要" },
  // 今日待发货 ×3（pending，ship_date=今天）
  { so: "81001001", province: "江苏省", city: "苏州市", district: "吴中区",
    street: "胥口镇东欣路1号 苏州某某电子有限公司", name: "张三", phone: "13812345678",
    carrier: "顺丰", status: "pending", ship_date: T, priority: "重要" },
  { so: "81001002", province: "广东省", city: "深圳市", district: "南山区",
    street: "科技园南路100号", name: "李四", phone: "13987654321",
    carrier: "专车", status: "pending", ship_date: T, priority: "紧急" },
  { so: "", so_no: "", province: "北京市", city: "北京市", district: "朝阳区",
    street: "建国路88号 现代城A座", name: "王五", phone: "13711112222",
    carrier: "德邦", status: "pending", ship_date: T, order_type: "外协单",
    note: "PO：4530000001 采购员：周采源" },
  // 超时未发货 ×2（pending，要求发货日期=昨天，已超期）
  { so: "81003001", province: "江苏省", city: "无锡市", district: "新吴区",
    street: "旺庄路180号 宝龙广场", name: "钱峰", phone: "13655189900",
    carrier: "客户自提", status: "pending", ship_date: Y, priority: "紧急" },
  { so: "81003002", province: "浙江省", city: "嘉兴市", district: "南湖区",
    street: "中环南路2608号 科创中心", name: "孙倩", phone: "13757332266",
    carrier: "德邦", status: "pending", ship_date: Y, priority: "重要" },
  // 计划发货 ×2（pending，未来日期）
  { so: "", so_no: "", province: "四川省", city: "成都市", district: "武侯区",
    street: "天府大道北段966号", name: "赵六", phone: "13566667777",
    carrier: "顺丰", status: "pending", ship_date: T1, order_type: "其他",
    note: "发件人：赵启明 13905198877" },
  { so: "81001005", province: "湖北省", city: "武汉市", district: "洪山区",
    street: "光谷大道77号 光谷软件园", name: "陈思远", phone: "15952774488",
    carrier: "跨越", status: "pending", ship_date: T2 },
  // 回货 ×1（returned，returned_at=今天）
  { so: "81001501", province: "山东省", city: "青岛市", district: "黄岛区",
    street: "长江中路218号 海信信息产业园3号楼", name: "刘芳", phone: "13785226699",
    carrier: "德邦", status: "returned", ship_date: T, returned_at: T + " 10:20:00",
    waybill_no: "DPK8100150106", route_status: "已签收" },
];

/* 追加 18 条今日待发货，凑满 26 行用于滚动效果测试 */
const EXTRA_CITIES = [
  ["江苏省", "南京市", "江宁区", "双龙大道1698号 景枫中心"],
  ["浙江省", "宁波市", "鄞州区", "首南街道学士路655号"],
  ["安徽省", "合肥市", "蜀山区", "望江西路800号 创新产业园"],
  ["福建省", "厦门市", "湖里区", "火炬高新区火炬路56号"],
  ["广东省", "广州市", "天河区", "珠江新城华夏路32号"],
  ["湖南省", "长沙市", "岳麓区", "麓谷大道658号 麓谷信息港"],
  ["河南省", "郑州市", "金水区", "花园路122号 建业凯旋广场"],
  ["山东省", "济南市", "历下区", "经十路9777号 鲁商国奥城"],
  ["陕西省", "西安市", "雁塔区", "高新路25号 西安软件园"]
];
const EXTRA_NAMES = ["王伟", "李强", "张敏", "刘洋", "陈静", "杨帆", "黄丽", "周涛", "吴霞",
                     "徐明", "孙红", "胡军", "郭鹏", "何燕", "高飞", "林芳", "罗成", "郑爽"];
const CARRIERS = ["顺丰", "德邦", "跨越"];
/* 外协单采购员 / 其他单发件员工 模拟名单 */
const BUYERS = ["周采源", "吴协作", "郑外联", "冯采购", "蒋外协", "沈购办"];
const SENDERS = [
  ["马晓东", "13912340101"], ["朱建军", "13912340102"], ["秦岚", "13912340103"],
  ["许志远", "13912340104"], ["何丽华", "13912340105"], ["吕强", "13912340106"]
];
for (let i = 0; i < 18; i++) {
  const c = EXTRA_CITIES[i % EXTRA_CITIES.length];
  /* 类型分配：约 1/3 外协单、1/3 其他；备注携带完整发件方信息（PO+采购员 / 发件人+电话） */
  const ot = i % 6 === 1 ? "外协单" : (i % 6 === 2 || i % 6 === 5) ? "其他" : "发货单";
  let note = "";
  if (ot === "外协单") {
    note = `PO：45${String(30001001 + i * 137)} 采购员：${BUYERS[i % BUYERS.length]}`;
  } else if (ot === "其他") {
    const s = SENDERS[i % SENDERS.length];
    note = `发件人：${s[0]} ${s[1]}`;
  }
  /* 外协单/其他 没有 DN 和 SO 号（仅发货单有） */
  const isShip = ot === "发货单";
  ROWS.push({
    so: isShip ? String(81002001 + i) : "",
    so_no: isShip ? "45" + String(81002001 + i) : "",
    province: c[0], city: c[1], district: c[2], street: c[3],
    name: EXTRA_NAMES[i], phone: "138" + String(20000000 + i * 137913).slice(0, 8),
    carrier: CARRIERS[i % 3], status: "pending", ship_date: T,
    priority: i % 6 === 0 ? "紧急" : i % 4 === 0 ? "重要" : "一般",
    order_type: ot, note: note
  });
}

db.exec("DELETE FROM orders;");
const ins = db.prepare(
  "INSERT INTO orders (so,province,city,district,street,name,phone,carrier,note,status,ship_date,shipped_at,returned_at,waybill_no,route_status,priority,order_type,so_no)" +
  " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
for (const r of ROWS) {
  ins.run(r.so, r.province, r.city, r.district, r.street, r.name, r.phone,
          r.carrier, r.note || "", r.status, r.ship_date,
          r.shipped_at || null, r.returned_at || null,
          r.waybill_no || "", r.route_status || "", r.priority || "一般",
          r.order_type || "发货单",
          r.so_no !== undefined ? r.so_no : (r.so ? "45" + r.so : ""));  /* 模拟 SO 号：仅发货单 45+DN */
}

const s = db.prepare(
  "SELECT" +
  " (SELECT COUNT(*) FROM orders WHERE status='shipped' AND date(shipped_at)=date('now','localtime','-1 day')) AS yesterday_shipped," +
  " (SELECT COUNT(*) FROM orders WHERE status='pending' AND ship_date=date('now','localtime')) AS today_pending," +
  " (SELECT COUNT(*) FROM orders WHERE status='pending' AND ship_date>date('now','localtime')) AS planned," +
  " (SELECT COUNT(*) FROM orders WHERE status='returned' AND date(returned_at)=date('now','localtime')) AS returned"
).get();
console.log(`已写入 ${ROWS.length} 条模拟数据，统计:`, JSON.stringify(s));
db.close();
