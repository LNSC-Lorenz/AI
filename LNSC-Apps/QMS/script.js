/* ============================================================
 * QMS 受控文件门户
 * 数据来源：catalog.json（由服务器定时扫描生成）
 * 本脚本不内置任何文件列表，全部从 catalog.json 读取并按命名规则解析。
 * ============================================================ */

const FILES_BASE = '/qms/';

const CATEGORY_MAP = { MM:'质量手册', PR:'程序文件', WI:'作业指导书', FM:'表单' };

const DEPARTMENT_MAP = { QA:'质量部', EN:'工程部', ENG:'工程部', HR:'人力资源部', IS:'销售运营部', SO:'销售运营部', LOG:'物流部', PM:'生产制造部', PUR:'采购部', PL:'采购部' };

const FOLDER_CATEGORY = { '000':'证书', '001':'质量手册', '002':'程序文件', '003':'作业指导书', '004':'表单', '005':'外来文件' };

const CAT_CLASS = { '质量手册':'cat-mm', '程序文件':'cat-pr', '作业指导书':'cat-wi', '表单':'cat-fm', '外来文件':'cat-ext', '证书':'cat-cert' };

let ALL = [];
let VIEW = [];
let sortKey = 'code';
let sortAsc = true;

const $ = (s) => document.querySelector(s);

function getExt(filename){
  const m = /\.([A-Za-z0-9]+)$/.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
}
function extClass(ext){
  if(ext === 'pdf') return 'pdf';
  if(['doc','docx'].includes(ext)) return 'word';
  if(['xls','xlsx','xlsm','csv'].includes(ext)) return 'excel';
  return 'other';
}
function extLabel(ext){
  if(ext === 'pdf') return 'PDF';
  if(['doc','docx'].includes(ext)) return 'Word';
  if(['xls','xlsx','xlsm','csv'].includes(ext)) return 'Excel';
  return (ext || '—').toUpperCase();
}

function parseEntry(item){
  const filename = item.filename || item.name || '';
  const folder = String(item.folder || '');
  const ext = getExt(filename);
  const base = filename.replace(/\.[A-Za-z0-9]+$/, '').trim();
  const url = item.url || (folder
    ? FILES_BASE + folder.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(filename)
    : FILES_BASE + encodeURIComponent(filename));
  const prefix = (folder.split('/')[0] || '').slice(0, 3);
  const rec = { filename, folder, ext, url, code:'', name:base, category:FOLDER_CATEGORY[prefix] || '其他', department:'', deptCode:'', seq:'', version:'', thirdParty:'', factory:'', foreign:prefix === '005', cert:prefix === '000' };

  if(rec.foreign){ rec.category='外来文件'; rec.department='—'; return rec; }

  if(rec.cert){
    rec.category = '证书';
    rec.department = '—';
    const parts = base.split('-');
    if(parts.length >= 3){
      rec.factory = parts[parts.length - 1].trim();
      rec.thirdParty = parts[parts.length - 2].trim();
      rec.name = parts.slice(0, parts.length - 2).join('-').trim();
    } else {
      rec.name = base;
    }
    rec.seq = rec.thirdParty;
    rec.version = rec.factory;
    rec.code = base;
    return rec;
  }

  const m = /^([A-Za-z]{2})-([A-Za-z]{2,3})-(\d{2,4})([A-Za-z])?\s*(.*)$/.exec(base);
  if(m){
    const cat=m[1].toUpperCase(), dept=m[2].toUpperCase(), seq=m[3], ver=m[4], nm=m[5];
    rec.code = cat + '-' + dept + '-' + seq + (ver ? ver.toUpperCase() : '');
    rec.category = CATEGORY_MAP[cat] || rec.category;
    rec.deptCode = dept;
    rec.department = DEPARTMENT_MAP[dept] || dept;
    rec.seq = seq;
    rec.version = ver ? ver.toUpperCase() : '';
    rec.name = (nm || '').trim() || base;
  } else {
    rec.code = base;
    rec.department = '—';
  }
  return rec;
}

async function loadCatalog(){
  const status = $('#status');
  try{
    const res = await fetch('catalog.json?_=' + Date.now(), {cache:'no-store'});
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.files || []);
    ALL = items.map(parseEntry);
    if(data.generated){ $('#gen-time').textContent = data.generated; }
    status.textContent = '已加载 ' + ALL.length + ' 个文件';
    status.className = 'status ok';
    buildFilters(); buildSummary(); apply();
  }catch(err){
    status.textContent = '无法加载目录（catalog.json）：' + err.message;
    status.className = 'status err';
    $('#empty').hidden = false;
    $('#empty').textContent = '无法读取 catalog.json。请确认服务器定时扫描脚本已生成该文件，且与 index.html 同目录。';
  }
}

function buildFilters(){
  const cats = [...new Set(ALL.map(r => r.category))].sort();
  const depts = [...new Set(ALL.map(r => r.department).filter(d => d && d !== '—'))].sort();
  const exts = [...new Set(ALL.map(r => extLabel(r.ext)))].sort();
  fill($('#filter-category'), cats, '全部类别');
  fill($('#filter-department'), depts, '全部部门');
  fill($('#filter-type'), exts, '全部格式');
}
function fill(sel, arr, allLabel){
  sel.innerHTML = '<option value="">' + allLabel + '</option>' + arr.map(v => '<option value="' + v + '">' + v + '</option>').join('');
}

function buildSummary(){
  const order = ['质量手册','程序文件','作业指导书','表单','外来文件','证书'];
  const counts = {};
  ALL.forEach(r => counts[r.category] = (counts[r.category]||0)+1);
  const cards = order.filter(c => counts[c]).map(c => '<div class="card ' + (CAT_CLASS[c]||'') + '" data-cat="' + c + '"><div class="num">' + counts[c] + '</div><div class="lbl">' + c + '</div></div>');
  cards.unshift('<div class="card cat-all active" data-cat=""><div class="num">' + ALL.length + '</div><div class="lbl">全部文件</div></div>');
  $('#summary-cards').innerHTML = cards.join('');
  document.querySelectorAll('#summary-cards .card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('#summary-cards .card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      $('#filter-category').value = card.dataset.cat;
      apply();
    });
  });
}

function apply(){
  const q = $('#search').value.trim().toLowerCase();
  const fc = $('#filter-category').value;
  const fd = $('#filter-department').value;
  const ft = $('#filter-type').value;
  VIEW = ALL.filter(r => {
    if(fc && r.category !== fc) return false;
    if(fd && r.department !== fd) return false;
    if(ft && extLabel(r.ext) !== ft) return false;
    if(q){
      const hay = (r.code + ' ' + r.name + ' ' + r.department + ' ' + r.category + ' ' + r.thirdParty + ' ' + r.factory + ' ' + r.filename).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
  sortView(); render();
}

function sortView(){
  VIEW.sort((a,b) => {
    const x = (a[sortKey] == null ? '' : a[sortKey]).toString();
    const y = (b[sortKey] == null ? '' : b[sortKey]).toString();
    const cmp = x.localeCompare(y, 'zh-Hans-CN', {numeric:true});
    return sortAsc ? cmp : -cmp;
  });
}

function render(){
  const body = $('#docs-body');
  $('#empty').hidden = VIEW.length > 0;
  body.innerHTML = VIEW.map(r => {
    const ec = extClass(r.ext);
    const canPreview = r.ext === 'pdf';
    const safeUrl = r.url || '';
    const previewBtn = canPreview ? '<button class="btn btn-preview" data-url="' + safeUrl + '" data-title="' + esc(r.filename) + '">预览</button>' : '<button class="btn disabled" title="Office 文件不支持在线预览，请下载">预览</button>';
    const dlBtn = safeUrl ? '<a class="btn btn-primary" href="' + safeUrl + '" download>下载</a>' : '<span class="btn disabled">下载</span>';
    return '<tr>' +
      '<td class="code">' + esc(r.code) + '</td>' +
      '<td>' + esc(r.name) + '</td>' +
      '<td><span class="badge cat">' + esc(r.category) + '</span></td>' +
      '<td>' + esc(r.department) + '</td>' +
      '<td>' + esc(r.seq) + '</td>' +
      '<td>' + esc(r.version) + '</td>' +
      '<td><span class="badge ext-' + ec + '">' + extLabel(r.ext) + '</span></td>' +
      '<td class="col-actions"><div class="actions">' + previewBtn + dlBtn + '</div></td>' +
      '</tr>';
  }).join('');
  $('#count').textContent = '显示 ' + VIEW.length + ' / ' + ALL.length + ' 个文件';
  document.querySelectorAll('.btn-preview').forEach(b => { b.addEventListener('click', () => openPreview(b.dataset.url, b.dataset.title)); });
}

function esc(s){
  const map = {};
  map['&'] = '&amp;';
  map['<'] = '&lt;';
  map['>'] = '&gt;';
  map['\u0022'] = '&quot;';
  return (s == null ? '' : s).toString().replace(/[&<>\u0022]/g, c => map[c]);
}

function openPreview(url, title){
  $('#preview-title').textContent = title;
  $('#preview-frame').src = url;
  $('#preview-download').href = url;
  $('#preview-overlay').hidden = false;
}
function closePreview(){
  $('#preview-overlay').hidden = true;
  $('#preview-frame').src = 'about:blank';
}

function init(){
  $('#search').addEventListener('input', apply);
  $('#filter-category').addEventListener('change', apply);
  $('#filter-department').addEventListener('change', apply);
  $('#filter-type').addEventListener('change', apply);
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const k = th.dataset.sort;
      if(sortKey === k){ sortAsc = !sortAsc; } else { sortKey = k; sortAsc = true; }
      sortView(); render();
    });
  });
  $('#preview-close').addEventListener('click', closePreview);
  $('#preview-overlay').addEventListener('click', (e) => { if(e.target.id === 'preview-overlay') closePreview(); });
  document.addEventListener('keydown', (e) => { if(e.key === 'Escape') closePreview(); });
  loadCatalog();
}
init();