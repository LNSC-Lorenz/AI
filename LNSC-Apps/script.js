/* 粒子背景 */
(function() {
  const canvas = document.getElementById('particle-canvas');
  const ctx = canvas.getContext('2d');
  let W, H, particles = [];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(true); }
    reset(init) {
      this.x = Math.random() * W;
      this.y = init ? Math.random() * H : H + 10;
      this.r = Math.random() * 1.5 + 0.5;
      this.vy = -(Math.random() * 0.4 + 0.1);
      this.vx = (Math.random() - 0.5) * 0.2;
      this.alpha = Math.random() * 0.5 + 0.1;
    }
    update() {
      this.x += this.vx; this.y += this.vy;
      if (this.y < -10) this.reset(false);
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,142,247,' + this.alpha + ')';
      ctx.fill();
    }
  }

  for (let i = 0; i < 240; i++) particles.push(new Particle());

  function loop() {
    ctx.clearRect(0, 0, W, H);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(loop);
  }
  loop();
})();

/* 本地存储 */
const LS_CUSTOM = 'lnsc_custom_apps';
const LS_HIDDEN = 'lnsc_hidden_apps';
const LS_USAGE  = 'lnsc_usage';

function loadLS(key, def) {
  try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; }
}
function saveLS(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// 用户唯一标识（持久化到 localStorage）
function getUID() {
  let uid = localStorage.getItem('lnsc_uid');
  if (!uid) {
    uid = 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
    localStorage.setItem('lnsc_uid', uid);
  }
  return uid;
}
const MY_UID = getUID();

/* 状态 */
let baseApps = [];
let apps = [];
let currentView = 'all';
let currentCat = 'all';
let searchQuery = '';

const grid = document.getElementById('apps-grid');

/* 内置回退清单（无预置应用，全部由用户上传） */
const DEFAULT_APPS = [];

/* 加载应用清单 */
async function loadApps() {
  try {
    const res = await fetch('apps.json', { cache: 'no-store' });
    if (res.ok) baseApps = await res.json();
  } catch (e) {
    console.warn('apps.json 加载失败（file:// 下属正常，部署后由 Nginx 提供）', e);
  }
  if (!baseApps.length) baseApps = DEFAULT_APPS;
  // 从服务器加载用户添加的应用（服务器为唯一数据源）
  try {
    const res = await fetch('/api/apps', { cache: 'no-store' });
    if (res.ok) {
      const serverApps = await res.json();
      // 直接替换 localStorage，以服务器为准
      saveLS(LS_CUSTOM, serverApps);
    }
  } catch (e) { /* file:// 模式忽略，使用本地缓存 */ }
  rebuildApps();
  animateStat(document.getElementById('stat-apps'), apps.length);
  render();
  // 获取服务器真实状态
  try {
    const sRes = await fetch('/api/status', { cache: 'no-store' });
    if (sRes.ok) {
      const status = await sRes.json();
      animateStat(document.getElementById('stat-uptime'), status.health);
    }
  } catch (e) { animateStat(document.getElementById('stat-uptime'), 99); }
}

/* 终端实况 */
const termEl = document.querySelector('.hero-terminal');
if (termEl) {
  termEl.addEventListener('mouseenter', () => termEl.classList.add('scrolling'));
  termEl.addEventListener('mouseleave', () => termEl.classList.remove('scrolling'));
}
async function refreshTerminal() {
  const el = document.getElementById('term-output');
  if (!el) return;
  try {
    const res = await fetch('/api/top', { cache: 'no-store' });
    if (res.ok) el.textContent = await res.text();
  } catch (e) { el.textContent = 'Connection lost...'; }
}
refreshTerminal();
setInterval(refreshTerminal, 3000);

/* 天气滚动 */
let weatherData = [];
function renderWeather() {
  const track = document.getElementById('weather-track');
  if (!track || !weatherData.length) return;
  track.innerHTML = weatherData.map(c => {
    return '<div class="weather-item">' + c.en + ' ' + (c.weather || '--') + '</div>';
  }).join('');
}
(async function loadWeather() {
  try {
    const res = await fetch('/api/weather', { cache: 'no-store' });
    if (!res.ok) return;
    weatherData = await res.json();
    renderWeather();
  } catch (e) { console.warn('Weather load error:', e); }
})();

/* 系统消息 */
async function loadMessages() {
  const list = document.getElementById('msg-list');
  if (!list) return;
  try {
    const res = await fetch('/api/messages', { cache: 'no-store' });
    if (!res.ok) return;
    const msgs = await res.json();
    list.innerHTML = '';
    if (!msgs.length) {
      list.innerHTML = '<div class="notice-item"><span class="notice-dot info"></span><span class="notice-text">暂无消息</span></div>';
      return;
    }
    msgs.slice().reverse().forEach(m => {
      const dot = m.action === 'add' ? 'success' : 'urgent';
      const icon = m.action === 'add' ? '＋' : '✕';
      const text = icon + ' ' + m.appName;
      const date = m.time ? m.time.slice(0, 16).replace('T', ' ') : '';
      const item = document.createElement('div');
      item.className = 'notice-item';
      item.innerHTML = '<span class="notice-dot ' + dot + '"></span><span class="notice-text">' + text + '</span><span class="notice-date">' + date + '</span>';
      list.appendChild(item);
    });
  } catch (e) { console.warn('Messages load error:', e); }
}
function postMessage(action, appName) {
  fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, appName, uid: MY_UID })
  }).then(() => loadMessages()).catch(() => {});
}
loadMessages();

function rebuildApps() {
  const hidden = loadLS(LS_HIDDEN, []);
  const custom = loadLS(LS_CUSTOM, []);
  apps = baseApps.concat(custom).filter(a => !hidden.includes(a.id));
  updateCatCounts();
}

function updateCatCounts() {
  document.querySelectorAll('[data-count]').forEach(el => {
    const cat = el.dataset.count;
    el.textContent = cat === 'all' ? apps.length : apps.filter(a => a.cat === cat).length;
  });
  updateCatAppLists();
}

/* 分类卡片内的应用清单 */
function updateCatAppLists() {
  document.querySelectorAll('.cat-chip').forEach(chip => {
    const cat = chip.dataset.cat;
    let panel = chip.querySelector('.cat-apps');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'cat-apps';
      chip.appendChild(panel);
    }
    panel.innerHTML = '';
    const list = cat === 'all' ? apps : apps.filter(a => a.cat === cat);
    list.forEach((app, idx) => {
      const item = document.createElement('a');
      item.className = 'cat-apps-item';
      item.href = app.url || '#';
      if (app.url && /^https?:/.test(app.url)) item.target = '_blank';
      item.style.transitionDelay = (0.4 + idx * 0.8) + 's';
      item.addEventListener('transitionend', function handler() {
        item.classList.add('typed');
        item.removeEventListener('transitionend', handler);
      });
      const nameSpan = document.createElement('span');
      nameSpan.textContent = app.name;
      item.appendChild(nameSpan);
      if (app.owner && app.owner === MY_UID) {
        const del = document.createElement('span');
        del.className = 'cat-app-del';
        del.textContent = '×';
        del.title = '删除';
        del.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          removeApp(app, item);
        });
        item.appendChild(del);
      }
      item.addEventListener('click', e => {
        if (e.target.classList.contains('cat-app-del')) return;
        e.stopPropagation();
        recordUsage(app.id);
      });
      panel.appendChild(item);
    });
  });
}

/* 数字滚动计数 */
function animateStat(el, target) {
  el.dataset.target = target;
  const duration = 1800;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(ease * target);
    if (t < 1) requestAnimationFrame(tick);
  }
  setTimeout(() => requestAnimationFrame(tick), 400);
}

/* 活跃用户（服务器心跳，每60秒一次） */
(function trackActiveUsers() {
  function heartbeat() {
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: MY_UID })
    })
      .then(r => r.json())
      .then(d => { if (d.count) animateStat(document.getElementById('stat-users'), d.count); })
      .catch(() => {});
  }
  heartbeat();
  setInterval(heartbeat, 60000);
})();

document.querySelectorAll('.stat-num:not(#stat-apps):not(#stat-users)').forEach(el => animateStat(el, +el.dataset.target));

/* 渲染 */
function visibleApps() {
  const usage = loadLS(LS_USAGE, {});
  let list = apps.slice();

  if (currentView === 'fav') {
    list = list.filter(a => (usage[a.id] || {}).count > 0)
               .sort((a, b) => usage[b.id].count - usage[a.id].count);
  } else if (currentView === 'recent') {
    list = list.filter(a => (usage[a.id] || {}).last)
               .sort((a, b) => usage[b.id].last - usage[a.id].last);
  }
  if (currentCat !== 'all') list = list.filter(a => a.cat === currentCat);
  if (searchQuery) {
    list = list.filter(a =>
      a.name.toLowerCase().includes(searchQuery) ||
      (a.desc || '').toLowerCase().includes(searchQuery));
  }
  return list;
}

function createCard(app, i) {
  const card = document.createElement('a');
  card.className = 'app-card';
  card.dataset.cat = app.cat || 'it';
  card.dataset.id = app.id;
  card.href = app.url || '#';
  if (app.url && /^https?:/.test(app.url)) card.target = '_blank';
  card.style.setProperty('--delay', (i * 0.05) + 's');
  card.innerHTML =
    '<button class="app-del" title="删除">×</button>' +
    '<div class="app-icon"></div>' +
    '<div class="app-info"><div class="app-name"></div><div class="app-desc"></div></div>' +
    '<div class="app-badge"></div><div class="app-arrow">→</div>';
  var CAT_ICONS = { hr: 'users', finance: 'trending', it: 'monitor', project: 'clipboard', sales: 'chart', operations: 'settings', market: 'cart', logistics: 'truck', engineering: 'wrench', quality: 'shield', business: 'briefcase', workshop: 'factory' };
  card.querySelector('.app-icon').innerHTML = '<svg class="icon"><use href="#i-' + (CAT_ICONS[app.cat] || 'folder') + '"/></svg>';
  card.querySelector('.app-icon').style.setProperty('--icon-color', app.color || '#4f8ef7');
  card.querySelector('.app-name').textContent = app.name;
  card.querySelector('.app-desc').textContent = app.desc || '';
  const badge = card.querySelector('.app-badge');
  badge.textContent = app.badge || 'APP';
  if ((app.badge || '').toUpperCase() === 'NEW') badge.classList.add('new');

  card.addEventListener('click', e => {
    if (e.target.classList.contains('app-del')) { e.preventDefault(); return; }
    if (!app.url) e.preventDefault();
    recordUsage(app.id);
    spawnRipple(card, e);
  });
  const delBtn = card.querySelector('.app-del');
  if (app.owner && app.owner !== MY_UID) {
    delBtn.style.display = 'none';
  }
  delBtn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    removeApp(app, card);
  });
  return card;
}

function render() {
  grid.querySelectorAll('.app-card').forEach(el => el.remove());
  updateCatAppLists();
}

/* 使用记录（常用 / 最近） */
function recordUsage(id) {
  const usage = loadLS(LS_USAGE, {});
  const u = usage[id] || { count: 0, last: 0 };
  u.count += 1;
  u.last = Date.now();
  usage[id] = u;
  saveLS(LS_USAGE, usage);
}

/* 删除应用 */
function removeApp(app, card) {
  if (!confirm('确定删除「' + app.name + '」？\n（将同时删除服务器上的文件）')) return;
  const custom = loadLS(LS_CUSTOM, []);
  if (custom.some(c => c.id === app.id)) {
    saveLS(LS_CUSTOM, custom.filter(c => c.id !== app.id));
    // 删除服务器文件（附带用户 ID 验证）
    fetch('/api/apps/' + encodeURIComponent(app.id) + '?uid=' + encodeURIComponent(MY_UID), { method: 'DELETE' })
      .then(r => r.json())
      .then(d => {
        if (!d.success) { alert(d.error || '删除失败'); return; }
        postMessage('delete', app.name);
      })
      .catch(e => console.warn('Server delete error:', e));
  } else {
    const hidden = loadLS(LS_HIDDEN, []);
    hidden.push(app.id);
    saveLS(LS_HIDDEN, hidden);
  }
  rebuildApps();
  card.style.transition = 'opacity 0.25s, transform 0.25s';
  card.style.opacity = '0';
  card.style.transform = 'scale(0.9)';
  setTimeout(() => { card.remove(); render(); }, 250);
}

/* 涟漪效果 */
function spawnRipple(card, e) {
  const ripple = document.createElement('span');
  const rect = card.getBoundingClientRect();
  ripple.style.cssText = 'position:absolute;border-radius:50%;pointer-events:none;background:rgba(79,142,247,0.3);width:0;height:0;left:' + (e.clientX - rect.left) + 'px;top:' + (e.clientY - rect.top) + 'px;transform:translate(-50%,-50%);animation:ripple-anim 0.5s ease forwards;';
  card.appendChild(ripple);
  setTimeout(() => ripple.remove(), 500);
}

/* 分类过滤 */
const chips = document.querySelectorAll('.cat-chip');
chips.forEach(chip => {
  chip.addEventListener('click', () => {
    if (chip.dataset.cat === 'all') {
      const allActive = [...chips].every(c => c.classList.contains('active'));
      chips.forEach(c => c.classList.toggle('active', !allActive));
    } else if (chip.classList.contains('active')) {
      chip.classList.remove('active');
    } else {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    }
    currentCat = chip.dataset.cat;
    render();
  });
});

/* 搜索过滤 */
document.getElementById('search-input').addEventListener('input', function() {
  searchQuery = this.value.trim().toLowerCase();
  render();
});

/* 添加应用（内联表单） */
const palette = ['#4f8ef7', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#f97316', '#84cc16'];
const icons = ['📁', '📈', '🔧', '💬', '📅', '🔐', '📌', '⚙️'];
const form = document.getElementById('app-form');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const uploadInput = document.getElementById('upload-input');
  const allFiles = uploadInput ? Array.from(uploadInput.files) : [];
  const hint = document.getElementById('upload-hint');
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn.textContent;

  // 有文件则上传到服务器
  if (allFiles.length > 0) {
    const appId = form.elements.name.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') || ('app_' + Date.now());
    const fd = new FormData();
    fd.append('appId', appId);
    allFiles.forEach(f => {
      // 将相对路径编码到字段名中，确保服务端能还原目录结构
      const relPath = f.webkitRelativePath || f.name;
      fd.append('file__' + encodeURIComponent(relPath), f);
    });

    // 显示上传状态
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ 上传中... (' + allFiles.length + ' 个文件)';
    hint.classList.remove('hidden');
    hint.textContent = '正在上传 ' + allFiles.length + ' 个文件，请稍候...';
    hint.style.color = 'var(--accent)';

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error('服务器返回异常 (' + res.status + '): ' + text.substring(0, 100));
      }
      const data = await res.json();
      if (data.success) {
        hint.textContent = '✅ 上传成功！共 ' + data.files.length + ' 个文件 → ' + data.url;
        hint.style.color = '#22c55e';
        submitBtn.textContent = '✅ 添加成功';
        const app = {
          id: appId,
          name: form.elements.name.value.trim(),
          url: data.url,
          desc: form.elements.desc.value.trim(),
          cat: form.elements.cat.value,
          badge: 'APP',
          icon: icons[Math.floor(Math.random() * icons.length)],
          color: palette[Math.floor(Math.random() * palette.length)],
          owner: MY_UID
        };
        const custom = loadLS(LS_CUSTOM, []);
        custom.push(app);
        saveLS(LS_CUSTOM, custom);
        // 同步元数据到服务器（所有用户可见）
        try {
          const metaRes = await fetch('/api/apps/meta', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(app)
          });
          const metaData = await metaRes.json();
          console.log('[Meta] saved:', metaData);
        } catch (e) {
          console.error('[Meta] save failed:', e);
        }
        postMessage('add', app.name);
        rebuildApps();
        render();
        setTimeout(() => { form.reset(); hint.classList.add('hidden'); submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }, 3000);
      } else {
        hint.textContent = '❌ 上传失败: ' + (data.error || 'Unknown error');
        hint.style.color = '#ef4444';
        submitBtn.textContent = '❌ 失败';
        setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }, 2000);
      }
    } catch (err) {
      hint.textContent = '❌ 网络错误: ' + err.message;
      hint.style.color = '#ef4444';
      submitBtn.textContent = '❌ 失败';
      setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }, 2000);
    }
    return;
  }

  // 无文件 — 提示需要上传
  hint.classList.remove('hidden');
  hint.textContent = '⚠️ 请选择要上传的应用程序文件夹';
  hint.style.color = '#f59e0b';
  setTimeout(() => hint.classList.add('hidden'), 3000);
});

/* 主题切换 */
const themeBtn = document.getElementById('theme-toggle');

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeBtn.innerHTML = '<svg class="icon"><use href="#i-' + (theme === 'dark' ? 'sun' : 'moon') + '"/></svg>';
  localStorage.setItem('lnsc_theme', theme);
}

applyTheme(localStorage.getItem('lnsc_theme') || 'dark');

themeBtn.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

/* 中英文切换 */
const I18N = {
  zh: {
    logoSub: 'LNSC自开发Web应用中心',
    searchPh: '搜索应用...',
    heroTitle: '欢迎使用企业应用中心',
    heroSub: '统一入口 · 高效协作 · 安全可靠',
    statApps: '已上线应用', statUsers: '活跃用户', statUptime: '服务可用率 %',
    secCats: '应用分类', secApps: '添加新应用', secShortcuts: '常用系统', secNotices: '系统消息',
    cat_all: '全部', cat_hr: '人力资源', cat_finance: '财务管理', cat_it: 'IT 工具',
    cat_project: '项目管理', cat_sales: '销售运营', cat_market: '市场',
    cat_logistics: '物流', cat_engineering: '工程', cat_quality: '质量', cat_operations: '运营', cat_business: '业务', cat_workshop: '车间',
    addApp: '添加应用', emptyHint: '暂无应用记录',
    fName: '名称 *', fNamePh: '应用名称', fUrl: '链接 *', fDesc: '描述',
    fDescPh: '简短描述（可选）', fCat: '分类', fBadge: '角标', fUpload: '上传应用程序文件',
    btnCancel: '取消', btnAdd: '添加',
    footer: '© 2026 莱克勒喷嘴系统（常州）有限公司 \u00a0\u00a0|\u00a0 v1.0.0'
  },
  en: {
    logoSub: 'LNSC Web Application',
    searchPh: 'Search apps...',
    heroTitle: 'Welcome to the App Center',
    heroSub: 'One Portal · Efficient · Secure',
    statApps: 'Apps Online', statUsers: 'Active Users', statUptime: 'Uptime %',
    secCats: 'Categories', secApps: 'Add New App', secShortcuts: 'Links', secNotices: 'System Messages',
    cat_all: 'All', cat_hr: 'HR', cat_finance: 'Finance', cat_it: 'IT Tools',
    cat_project: 'Projects', cat_sales: 'Sales', cat_market: 'Marketing',
    cat_logistics: 'Logistics', cat_engineering: 'Engineering', cat_quality: 'Quality', cat_operations: 'Operations', cat_business: 'Business', cat_workshop: 'Workshop',
    addApp: 'Add App', emptyHint: 'No apps found',
    fName: 'Name *', fNamePh: 'App name', fUrl: 'URL *', fDesc: 'Description',
    fDescPh: 'Short description (optional)', fCat: 'Category', fBadge: 'Badge', fUpload: 'Upload Application Files',
    btnCancel: 'Cancel', btnAdd: 'Add',
    footer: '© 2026 Lechler Nozzle System (Changzhou) Co., LTD. \u00a0\u00a0|\u00a0 v1.0.0'
  }
};

const langBtn = document.getElementById('lang-toggle');

function applyLang(lang) {
  const dict = I18N[lang] || I18N.zh;
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const t = dict[el.dataset.i18n];
    if (t) el.textContent = t;
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const t = dict[el.dataset.i18nPh];
    if (t) el.placeholder = t;
  });
  langBtn.textContent = lang === 'en' ? '中' : 'EN';
  localStorage.setItem('lnsc_lang', lang);
  renderWeather();
}

applyLang(localStorage.getItem('lnsc_lang') || 'zh');

langBtn.addEventListener('click', () => {
  applyLang(document.documentElement.dataset.lang === 'en' ? 'zh' : 'en');
});

loadApps();