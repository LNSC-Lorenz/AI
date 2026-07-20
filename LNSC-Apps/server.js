const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { execSync } = require('child_process');

const app = express();
const PORT = 3000;
const WEB_ROOT = path.join(__dirname);
const APPS_DIR = path.join(WEB_ROOT, 'apps');

// 确保 apps 目录存在
if (!fs.existsSync(APPS_DIR)) fs.mkdirSync(APPS_DIR, { recursive: true });

// 应用元数据文件
const META_FILE = path.join(WEB_ROOT, 'apps-meta.json');
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(META_FILE, 'utf8')); }
  catch { return []; }
}
function saveMeta(data) {
  fs.writeFileSync(META_FILE, JSON.stringify(data, null, 2));
}

// 静态文件服务
app.use(express.static(WEB_ROOT));
app.use(express.json());

// 文件上传配置（先存到临时目录，再按路径移动）
const upload = multer({
  dest: path.join(__dirname, '.uploads_tmp'),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['.html', '.htm', '.css', '.js', '.json', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.map', '.md', '.txt', '.xlsx', '.xls', '.pdf', '.doc', '.docx', '.csv', '.pptx', '.ppt', '.zip', '.rar', '.7z', '.db', '.sqlite', '.xml', '.yaml', '.yml', '.ini', '.cfg', '.conf', '.log', '.mp4', '.mp3', '.wav', '.webm', '.webp', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed: ' + ext));
    }
  }
});

// 上传接口：接收多个文件，保留文件夹结构
app.post('/api/upload', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) {
      console.error('[Upload] multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const appId = req.body.appId || 'upload_' + Date.now();
  const appDir = path.join(APPS_DIR, appId);
  const saved = [];

  console.log('[Upload] appId:', appId, 'files:', req.files.length);

  req.files.forEach((file) => {
    // 从字段名中解码相对路径：file__test-app%2Fimages%2Flogo.svg
    let relPath = '';
    if (file.fieldname.startsWith('file__')) {
      relPath = decodeURIComponent(file.fieldname.substring(6));
    } else {
      relPath = file.originalname;
    }
    console.log('[Upload] fieldname:', file.fieldname, '-> relPath:', relPath);

    // 去掉第一层文件夹名（webkitRelativePath 格式：folderName/sub/file）
    const parts = relPath.split('/');
    if (parts.length > 1) {
      relPath = parts.slice(1).join('/');
    }

    // 安全检查
    relPath = relPath.replace(/\.\./g, '').replace(/^\/+/, '');
    if (!relPath) relPath = file.originalname;

    const destPath = path.join(appDir, relPath);
    const destDir = path.dirname(destPath);

    console.log('[Upload] saving to:', destPath);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true, mode: 0o755 });
    fs.renameSync(file.path, destPath);
    fs.chmodSync(destPath, 0o644);
    saved.push(relPath);
  });

  const appPath = '/apps/' + appId + '/';
  res.json({
    success: true,
    appId: appId,
    url: appPath,
    files: saved,
    message: 'Uploaded ' + saved.length + ' file(s) to ' + appPath
  });
});

// 获取用户添加的应用列表（元数据）
app.get('/api/apps', (req, res) => {
  res.json(loadMeta());
});

// 保存应用元数据
app.post('/api/apps/meta', (req, res) => {
  const appInfo = req.body;
  if (!appInfo || !appInfo.id) return res.status(400).json({ error: 'Missing app info' });
  const meta = loadMeta();
  // 去重
  const idx = meta.findIndex(m => m.id === appInfo.id);
  if (idx >= 0) {
    meta[idx] = appInfo;
  } else {
    meta.push(appInfo);
  }
  saveMeta(meta);
  res.json({ success: true });
});

// 删除子应用（文件 + 元数据，需验证所有者）
app.delete('/api/apps/:id', (req, res) => {
  const id = req.params.id;
  const uid = req.query.uid || '';
  const meta = loadMeta();
  const appMeta = meta.find(m => m.id === id);

  // 验证所有者
  if (appMeta && appMeta.owner && appMeta.owner !== uid) {
    return res.status(403).json({ error: '只有上传者本人可以删除此应用' });
  }

  // 删除文件
  const appDir = path.join(APPS_DIR, id);
  if (fs.existsSync(appDir)) {
    fs.rmSync(appDir, { recursive: true, force: true });
  }
  // 删除元数据
  saveMeta(meta.filter(m => m.id !== id));
  res.json({ success: true, message: 'Deleted ' + id });
});

// 活跃用户追踪（内存，5分钟内有心跳算活跃）
const activeUsers = new Map(); // uid -> lastSeen timestamp
const ACTIVE_TTL = 2 * 60 * 60 * 1000; // 2 hours

app.post('/api/heartbeat', (req, res) => {
  const uid = req.body.uid;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  activeUsers.set(uid, Date.now());
  // 清理过期
  const now = Date.now();
  for (const [k, v] of activeUsers) {
    if (now - v > ACTIVE_TTL) activeUsers.delete(k);
  }
  res.json({ count: activeUsers.size });
});

app.get('/api/active-users', (req, res) => {
  const now = Date.now();
  for (const [k, v] of activeUsers) {
    if (now - v > ACTIVE_TTL) activeUsers.delete(k);
  }
  res.json({ count: activeUsers.size });
});

// 系统消息
const MSG_FILE = path.join(WEB_ROOT, 'messages.json');
function loadMessages() {
  try { return JSON.parse(fs.readFileSync(MSG_FILE, 'utf8')); }
  catch { return []; }
}
function saveMessages(data) {
  fs.writeFileSync(MSG_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/messages', (req, res) => {
  const msgs = loadMessages().slice(-50); // 最近50条
  res.json(msgs);
});

app.post('/api/messages', (req, res) => {
  const { action, appName, cat, uid } = req.body;
  if (!action || !appName) return res.status(400).json({ error: 'Missing fields' });
  const msgs = loadMessages();
  msgs.push({
    action,
    appName,
    cat: cat || '',
    uid: uid || 'unknown',
    time: new Date(Date.now() + 8 * 3600000).toISOString()
  });
  // 只保留最近200条
  if (msgs.length > 200) msgs.splice(0, msgs.length - 200);
  saveMessages(msgs);
  res.json({ success: true });
});

// 天气缓存（10分钟刷新一次）
let weatherCache = { data: null, ts: 0 };
const WEATHER_TTL = 10 * 60 * 1000;

function httpGet(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'curl/7.0' }, timeout: 5000 }, (r) => {
      let data = '';
      r.on('data', chunk => data += chunk);
      r.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve('--'));
    req.on('timeout', () => { req.destroy(); resolve('--'); });
  });
}

app.get('/api/weather', async (req, res) => {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.ts < WEATHER_TTL) {
    return res.json(weatherCache.data);
  }
  const cities = ['Beijing', 'Shanghai', 'Changzhou'];
  try {
    const results = await Promise.all(cities.map(async (en) => {
      const raw = await httpGet('https://wttr.in/' + en + '?format=%t+%C');
      return { en, weather: raw };
    }));
    weatherCache = { data: results, ts: now };
    res.json(results);
  } catch (e) {
    res.json([]);
  }
});

// 系统状态 API
app.get('/api/status', (req, res) => {
  const uptimeSec = os.uptime();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const loadAvg = os.loadavg();
  const cpus = os.cpus().length;

  // 可用率 = 基于负载的健康度（负载 < CPU核数 = 100%，超出则按比例降低）
  const loadRatio = loadAvg[0] / cpus;
  const healthPct = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, loadRatio - 1)) * 100)));

  res.json({
    uptime: uptimeSec,
    uptimeHours: Math.floor(uptimeSec / 3600),
    uptimeDays: Math.floor(uptimeSec / 86400),
    loadAvg: loadAvg.map(l => Math.round(l * 100) / 100),
    cpus: cpus,
    memTotal: Math.round(totalMem / 1024 / 1024),
    memFree: Math.round(freeMem / 1024 / 1024),
    memUsedPct: Math.round((1 - freeMem / totalMem) * 100),
    health: healthPct
  });
});

// 实时 top 输出（批处理模式，完整快照）
app.get('/api/top', (req, res) => {
  try {
    const output = execSync('top -bn1 -w 200', {
      encoding: 'utf8',
      timeout: 5000
    });
    res.type('text/plain').send(output);
  } catch (e) {
    res.type('text/plain').send('Error: ' + e.message);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[LNSC-Apps Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[LNSC-Apps Server] Web root: ${WEB_ROOT}`);
  console.log(`[LNSC-Apps Server] Apps dir: ${APPS_DIR}`);
});
