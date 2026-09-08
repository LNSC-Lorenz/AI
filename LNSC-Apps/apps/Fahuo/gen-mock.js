#!/usr/bin/env node
/* 由 fahuo.db 重新生成 mock.js 离线快照（跑完 seed.js 后执行：node gen-mock.js） */
"use strict";
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "fahuo.db"));
const rows = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
const out = rows.map(r => ({
  id: r.id, so: r.so, so_no: r.so_no, priority: r.priority, order_type: r.order_type,
  address: [r.province, r.city, r.district, r.street].filter(Boolean).join(" "),
  name: r.name, phone: r.phone, note: r.note, carrier: r.carrier,
  ship_date: r.ship_date, status: r.status,
  waybill_no: r.waybill_no, route_status: r.route_status,
  shipped_at: r.shipped_at || "", returned_at: r.returned_at || "",
  province: r.province, city: r.city, district: r.district, street: r.street
}));
const today = new Date().toLocaleDateString("sv-SE");
fs.writeFileSync(path.join(__dirname, "mock.js"),
  "/* 离线演示数据快照（由 seed.js 数据生成；API 离线时前端自动加载显示）\n" +
  " * 注意：统计数字基于生成日 " + today + "，仅用于本地预览 */\n" +
  "const MOCK_ORDERS = " + JSON.stringify(out, null, 1) + ";\n");
console.log("mock.js 已重新生成：", out.length, "条");
db.close();
