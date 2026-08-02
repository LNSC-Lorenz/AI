/* 打印机清单 - 前端逻辑（纯展示） */
'use strict';

const state = {
  printers: [],
  filtered: [],
  search: '',
  server: '',
  location: '',
  sortKey: 'name',
  sortAsc: true,
};

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------- 加载数据 ---------- */
async function loadData() {
  const statusEl = $('status');
  try {
    const res = await fetch('printers.json?_=' + Date.now());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    state.printers = Array.isArray(data.printers) ? data.printers : [];
    $('gen-time').textContent = data.generated || '未知';
    statusEl.textContent = '已加载 ' + state.printers.length + ' 台打印机';
    statusEl.className = 'status ok';
    buildFilters();
    renderSummary();
    applyFilters();
  } catch (err) {
    statusEl.textContent = 'PRINTERS.JSON NOT FOUND 或解析失败（' + err.message + '）';
    statusEl.className = 'status err';
    $('gen-time').textContent = '-';
    $('empty').hidden = false;
    $('empty').querySelector('p').textContent =
      '打印机清单未生成，请先运行 1_export-printers.ps1 导出并上传 printers.json。';
  }
}

/* ---------- 汇总卡片 ---------- */
function renderSummary() {
  const byServer = {};
  for (const p of state.printers) byServer[p.server] = (byServer[p.server] || 0) + 1;
  const cards = [{ label: '打印机总数', value: state.printers.length }];
  for (const srv of Object.keys(byServer).sort()) {
    cards.push({ label: srv, value: byServer[srv] });
  }
  $('summary-cards').innerHTML = cards.map((c) =>
    '<div class="sum-card"><span class="sum-num">' + c.value +
    '</span><span class="sum-label">' + esc(c.label) + '</span></div>'
  ).join('');
}

/* ---------- 筛选器 ---------- */
function buildFilters() {
  const servers = [...new Set(state.printers.map((p) => p.server))].sort();
  const locations = [...new Set(state.printers.map((p) => p.location).filter(Boolean))].sort();
  $('filter-server').innerHTML = '<option value="">全部服务器</option>' +
    servers.map((s) => '<option>' + esc(s) + '</option>').join('');
  $('filter-location').innerHTML = '<option value="">全部位置</option>' +
    locations.map((s) => '<option>' + esc(s) + '</option>').join('');
}

function applyFilters() {
  const q = state.search.trim().toLowerCase();
  state.filtered = state.printers.filter((p) => {
    if (state.server && p.server !== state.server) return false;
    if (state.location && p.location !== state.location) return false;
    if (!q) return true;
    return [p.name, p.share, p.server, p.location, p.driver, p.comment]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });
  sortFiltered();
  renderTable();
}

function sortFiltered() {
  const k = state.sortKey;
  state.filtered.sort((a, b) => {
    const va = (a[k] || '').toString().toLowerCase();
    const vb = (b[k] || '').toString().toLowerCase();
    return state.sortAsc ? va.localeCompare(vb, 'zh-Hans-CN') : vb.localeCompare(va, 'zh-Hans-CN');
  });
}

/* ---------- 表格渲染 ---------- */
function renderTable() {
  const rows = state.filtered.map((p) => {
    const idx = state.printers.indexOf(p);
    return '<tr>' +
      '<td><b>' + esc(p.name) + '</b></td>' +
      '<td><code>\\\\' + esc(p.server) + '\\' + esc(p.share || p.name) + '</code></td>' +
      '<td><span class="srv-badge">' + esc(p.server) + '</span></td>' +
      '<td>' + esc(p.location || '-') + '</td>' +
      '<td class="td-driver">' + esc(p.driver || '-') + '</td>' +
      '<td>' + esc(p.comment || '-') + '</td>' +
      '<td><button class="btn-add" data-idx="' + idx + '">添加打印机</button></td>' +
    '</tr>';
  }).join('');
  $('printers-body').innerHTML = rows;
  $('count').textContent = '显示 ' + state.filtered.length + ' / ' + state.printers.length + ' 台打印机';
  $('empty').hidden = state.filtered.length > 0;
}

/* ---------- 添加打印机（下载 .bat，双击自动连接安装） ---------- */
function showToast(msg) {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), 4000);
}

function downloadBat(p) {
  const unc = '\\\\' + p.server + '\\' + (p.share || p.name);
  const bat = '@echo off\r\n' +
    'title Add Printer ' + unc + '\r\n' +
    'echo Connecting printer ' + unc + ' ...\r\n' +
    'rundll32 printui.dll,PrintUIEntry /in /n "' + unc + '"\r\n' +
    'if %errorlevel%==0 (echo Done. Printer installed.) else (echo FAILED. Please contact IT.)\r\n' +
    'pause\r\n';
  const blob = new Blob(['﻿' + bat], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'add-printer-' + (p.share || p.name).replace(/[\\/:*?"<>|]/g, '_') + '.bat';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  showToast('安装脚本已下载，请在浏览器下载栏或「下载」文件夹中双击运行 ' + a.download);
}

/* ---------- 事件绑定 ---------- */
function bindEvents() {
  $('search').addEventListener('input', (e) => { state.search = e.target.value; applyFilters(); });
  $('filter-server').addEventListener('change', (e) => { state.server = e.target.value; applyFilters(); });
  $('filter-location').addEventListener('change', (e) => { state.location = e.target.value; applyFilters(); });

  document.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if (state.sortKey === k) state.sortAsc = !state.sortAsc;
      else { state.sortKey = k; state.sortAsc = true; }
      document.querySelectorAll('th.sortable').forEach((t) => t.classList.remove('asc', 'desc'));
      th.classList.add(state.sortAsc ? 'asc' : 'desc');
      sortFiltered();
      renderTable();
    });
  });

  $('printers-body').addEventListener('click', (e) => {
    const btn = e.target.closest('button.btn-add');
    if (!btn) return;
    const p = state.printers[Number(btn.dataset.idx)];
    if (p) downloadBat(p);
  });
}

bindEvents();
loadData();
