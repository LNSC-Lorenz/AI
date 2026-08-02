// ===== ToolM 库存后端服务（零依赖，需要 Node.js 22+）=====
// 用法: node server.js [端口]
// 数据库: toolinventory-server.db (SQLite，自动创建)
// 首次启动时若数据库为空，自动从 initial_inventory.js 导入初始数据
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.argv[2]) || process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'toolinventory-server.db');

// ===== 数据库初始化 =====
const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS InventoryState (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    UniqueIdentifier TEXT UNIQUE NOT NULL,
    MaterialName TEXT DEFAULT '',
    NewCount INTEGER DEFAULT 0,
    OldCount INTEGER DEFAULT 0,
    LastUpdated TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS InventoryHistory (
    Id INTEGER PRIMARY KEY AUTOINCREMENT,
    UniqueIdentifier TEXT NOT NULL,
    MaterialName TEXT DEFAULT '',
    IsNew INTEGER DEFAULT 1,
    Delta INTEGER DEFAULT 0,
    Person TEXT DEFAULT '',
    Timestamp TEXT DEFAULT '',
    PrevNew INTEGER DEFAULT 0,
    PrevOld INTEGER DEFAULT 0,
    AfterNew INTEGER DEFAULT 0,
    AfterOld INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hist_uid ON InventoryHistory(UniqueIdentifier);
`);

// 为已存在的旧数据库补充工单字段
['OrderNo', 'OrderMaterial', 'OrderTexture', 'OrderQty'].forEach(col => {
    try { db.exec(`ALTER TABLE InventoryHistory ADD COLUMN ${col} TEXT DEFAULT ''`); } catch (_) { }
});

// 本地时间格式（与WPF导入的历史数据一致：yyyy-MM-dd HH:mm:ss）
function localNow() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ===== 首次启动：从 initial_inventory.js 导入 =====
function seedFromInitialFile() {
    const count = db.prepare('SELECT COUNT(*) AS c FROM InventoryState').get();
    if (count.c > 0) return;

    const seedFile = path.join(__dirname, 'initial_inventory.js');
    if (!fs.existsSync(seedFile)) {
        console.log('initial_inventory.js not found, starting with empty database');
        return;
    }

    try {
        const text = fs.readFileSync(seedFile, 'utf8');
        const mStates = text.match(/window\.INITIAL_INVENTORY_STATES\s*=\s*(\[.*?\]);/s);
        const mHist = text.match(/window\.INITIAL_INVENTORY_HISTORY\s*=\s*(\[.*?\]);/s);
        const states = mStates ? JSON.parse(mStates[1]) : [];
        const history = mHist ? JSON.parse(mHist[1]) : [];

        const insState = db.prepare('INSERT OR IGNORE INTO InventoryState (UniqueIdentifier, MaterialName, NewCount, OldCount, LastUpdated) VALUES (?, ?, ?, ?, ?)');
        const insHist = db.prepare('INSERT INTO InventoryHistory (UniqueIdentifier, MaterialName, IsNew, Delta, Person, Timestamp) VALUES (?, ?, ?, ?, ?, ?)');

        db.exec('BEGIN');
        states.forEach(s => insState.run(s.uniqueIdentifier, s.materialName || '', s.newCount || 0, s.oldCount || 0, s.lastUpdated || ''));
        history.forEach(h => insHist.run(h.uniqueIdentifier, h.materialName || '', h.isNew ? 1 : 0, h.delta || 0, h.person || '', h.timestamp || ''));
        db.exec('COMMIT');

        console.log(`Seeded database: ${states.length} states, ${history.length} history records`);

        // 导入成功后归档，避免将来误删数据库后静默用旧数据重建
        try {
            fs.renameSync(seedFile, seedFile + '.bak');
            console.log('initial_inventory.js renamed to initial_inventory.js.bak');
        } catch (_) { }
    } catch (e) {
        try { db.exec('ROLLBACK'); } catch (_) { }
        console.error('Seed failed:', e.message);
    }
}
seedFromInitialFile();

// ===== 用户映射（user_info.txt）=====
let userMap = {};
function loadUserMap() {
    const newMap = {};
    const f = path.join(__dirname, 'user_info.txt');
    if (!fs.existsSync(f)) {
        console.warn('user_info.txt not found');
        userMap = newMap;
        return;
    }
    fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach(line => {
        const l = (line || '').trim();
        if (!l || l.startsWith('#')) return;
        const parts = l.split(/\s+/);
        if (parts.length >= 3) {
            const key = parts[0].trim().toLowerCase();
            const uid = parts[1].trim();
            const name = parts.slice(2).join(' ').trim();
            if (key && !newMap[key]) {
                newMap[key] = { personId: uid, personName: name };
            }
        }
    });
    userMap = newMap;
    console.log(`User mappings loaded: ${Object.keys(userMap).length}`);
}
loadUserMap();
// user_info.txt 修改后自动重新加载（无需重启服务）
fs.watchFile(path.join(__dirname, 'user_info.txt'), { interval: 5000 }, () => {
    console.log('user_info.txt changed, reloading...');
    loadUserMap();
});

// ===== API 处理 =====
function stateToJson(s) {
    return {
        uniqueIdentifier: s.UniqueIdentifier,
        materialName: s.MaterialName || '',
        newCount: Number(s.NewCount) || 0,
        oldCount: Number(s.OldCount) || 0,
        lastUpdated: s.LastUpdated || ''
    };
}

function histToJson(h) {
    return {
        uniqueIdentifier: h.UniqueIdentifier,
        materialName: h.MaterialName || '',
        isNew: !!Number(h.IsNew),
        delta: Number(h.Delta) || 0,
        person: h.Person || '',
        timestamp: h.Timestamp || '',
        orderNo: h.OrderNo || '',
        orderMaterial: h.OrderMaterial || '',
        orderTexture: h.OrderTexture || '',
        orderQty: h.OrderQty != null ? h.OrderQty : ''
    };
}

const api = {
    'GET /api/health': () => ({ ok: true }),

    // 用户验证：支持扫码ID或用户ID查询
    'GET /api/user': (q) => {
        const id = (q.get('id') || '').trim();
        if (!id) return { found: false };

        // 先按扫码ID匹配
        let person = userMap[id.toLowerCase()];
        // 再按用户ID匹配
        if (!person) {
            person = Object.values(userMap).find(p => p.personId.toLowerCase() === id.toLowerCase());
        }

        if (person) return { found: true, personId: person.personId, personName: person.personName };
        return { found: false };
    },

    'GET /api/states': () => {
        return db.prepare('SELECT * FROM InventoryState').all().map(stateToJson);
    },

    'GET /api/history': () => {
        return db.prepare('SELECT * FROM InventoryHistory ORDER BY UniqueIdentifier, Timestamp').all().map(histToJson);
    },

    'GET /api/stock': (q) => {
        const id = q.get('id') || '';
        const s = db.prepare('SELECT * FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE').get(id);
        if (!s) return { newCount: 0, oldCount: 0 };
        return { newCount: Number(s.NewCount) || 0, oldCount: Number(s.OldCount) || 0 };
    },

    'POST /api/ensure-bulk': (q, body) => {
        const items = (body && body.items) || [];
        const sel = db.prepare('SELECT Id, MaterialName FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE');
        const ins = db.prepare('INSERT INTO InventoryState (UniqueIdentifier, MaterialName, NewCount, OldCount, LastUpdated) VALUES (?, ?, 0, 0, ?)');
        const updName = db.prepare('UPDATE InventoryState SET MaterialName = ? WHERE Id = ?');
        db.exec('BEGIN');
        try {
            items.forEach(it => {
                if (!it || !it.uniqueIdentifier) return;
                const existing = sel.get(it.uniqueIdentifier);
                if (!existing) {
                    ins.run(it.uniqueIdentifier, it.materialName || '', localNow());
                } else if (it.materialName && !existing.MaterialName) {
                    updName.run(it.materialName, existing.Id);
                }
            });
            db.exec('COMMIT');
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
        return { ok: true };
    },

    'POST /api/update': (q, body) => {
        const { uniqueIdentifier, isNew, delta, person, materialName, orderNo, orderMaterial, orderTexture, orderQty } = body || {};
        if (!uniqueIdentifier || !delta) {
            const s = db.prepare('SELECT * FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE').get(uniqueIdentifier || '');
            return { newCount: s ? Number(s.NewCount) : 0, oldCount: s ? Number(s.OldCount) : 0 };
        }

        db.exec('BEGIN');
        try {
            let s = db.prepare('SELECT * FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE').get(uniqueIdentifier);
            if (!s) {
                db.prepare('INSERT INTO InventoryState (UniqueIdentifier, MaterialName, NewCount, OldCount, LastUpdated) VALUES (?, ?, 0, 0, ?)')
                    .run(uniqueIdentifier, materialName || '', localNow());
                s = db.prepare('SELECT * FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE').get(uniqueIdentifier);
            }

            const prevNew = Number(s.NewCount) || 0;
            const prevOld = Number(s.OldCount) || 0;

            // 出库时服务器端校验库存是否足够（避免多台电脑并发操作导致账实不符）
            if (delta < 0) {
                const available = isNew ? prevNew : prevOld;
                if (available + delta < 0) {
                    throw new Error(`${isNew ? '新品' : '旧品'}库存不足：当前 ${available}，无法出库 ${-delta}。`);
                }
            }

            let newCount = prevNew, oldCount = prevOld;
            if (isNew) newCount = prevNew + delta;
            else oldCount = prevOld + delta;

            db.prepare('UPDATE InventoryState SET NewCount = ?, OldCount = ?, MaterialName = CASE WHEN MaterialName = \'\' THEN ? ELSE MaterialName END, LastUpdated = ? WHERE Id = ?')
                .run(newCount, oldCount, materialName || '', localNow(), s.Id);

            db.prepare('INSERT INTO InventoryHistory (UniqueIdentifier, MaterialName, IsNew, Delta, Person, Timestamp, PrevNew, PrevOld, AfterNew, AfterOld, OrderNo, OrderMaterial, OrderTexture, OrderQty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
                .run(uniqueIdentifier, materialName || s.MaterialName || '', isNew ? 1 : 0, delta, person || '', localNow(), prevNew, prevOld, newCount, oldCount, orderNo || '', orderMaterial || '', orderTexture || '', orderQty != null && orderQty !== '' ? String(orderQty) : '');

            db.exec('COMMIT');
            return { newCount, oldCount };
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    },

    'POST /api/launch-oa': () => {
        const exePath = path.join(__dirname, 'rpi', 'a.exe');
        if (!fs.existsSync(exePath)) {
            return { ok: false, message: '未找到 rpi/a.exe' };
        }
        try {
            const { exec } = require('node:child_process');
            exec(`"${exePath}"`, (err) => {
                if (err) console.error('launch-oa error:', err.message);
            });
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message };
        }
    },

    'POST /api/reset': (q, body) => {
        const { uniqueIdentifier, newCount, oldCount, person, materialName } = body || {};
        if (!uniqueIdentifier) return { ok: false };

        db.exec('BEGIN');
        try {
            const s = db.prepare('SELECT Id FROM InventoryState WHERE UniqueIdentifier = ? COLLATE NOCASE').get(uniqueIdentifier);
            if (!s) {
                db.prepare('INSERT INTO InventoryState (UniqueIdentifier, MaterialName, NewCount, OldCount, LastUpdated) VALUES (?, ?, ?, ?, ?)')
                    .run(uniqueIdentifier, materialName || '', newCount || 0, oldCount || 0, localNow());
            } else {
                db.prepare('UPDATE InventoryState SET NewCount = ?, OldCount = ?, MaterialName = CASE WHEN ? != \'\' THEN ? ELSE MaterialName END, LastUpdated = ? WHERE Id = ?')
                    .run(newCount || 0, oldCount || 0, materialName || '', materialName || '', localNow(), s.Id);
            }

            db.prepare('DELETE FROM InventoryHistory WHERE UniqueIdentifier = ? COLLATE NOCASE').run(uniqueIdentifier);

            const now = localNow();
            if (newCount != null) {
                db.prepare('INSERT INTO InventoryHistory (UniqueIdentifier, MaterialName, IsNew, Delta, Person, Timestamp, PrevNew, PrevOld, AfterNew, AfterOld) VALUES (?, ?, 1, ?, ?, ?, 0, 0, ?, ?)')
                    .run(uniqueIdentifier, materialName || '', newCount || 0, person || '初始化', now, newCount || 0, oldCount || 0);
            }
            if (oldCount != null) {
                db.prepare('INSERT INTO InventoryHistory (UniqueIdentifier, MaterialName, IsNew, Delta, Person, Timestamp, PrevNew, PrevOld, AfterNew, AfterOld) VALUES (?, ?, 0, ?, ?, ?, ?, 0, ?, ?)')
                    .run(uniqueIdentifier, materialName || '', oldCount || 0, person || '初始化', now, newCount || 0, newCount || 0, oldCount || 0);
            }

            db.exec('COMMIT');
            return { ok: true };
        } catch (e) {
            db.exec('ROLLBACK');
            throw e;
        }
    }
};

// ===== 静态文件服务 =====
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.svg': 'image/svg+xml'
};

// 禁止通过HTTP访问的敏感文件
const BLOCKED_FILES = ['user_info.txt', 'server.js', 'toolinventory-server.db', 'initial_inventory.js', 'initial_inventory.js.bak'];

function serveStatic(req, res, urlPath) {
    let filePath = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
    filePath = path.normalize(filePath).replace(/^([.][.][\/\\])+/, '');
    const fullPath = path.join(__dirname, filePath);

    if (BLOCKED_FILES.includes(path.basename(fullPath).toLowerCase())) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
    }

    if (!fullPath.startsWith(__dirname) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache'
    });
    fs.createReadStream(fullPath).pipe(res);
}

// ===== HTTP 服务器 =====
const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // CORS（本地开发跨端口访问）
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const key = `${req.method} ${url.pathname}`;
    const handler = api[key];

    if (handler) {
        let bodyStr = '';
        req.on('data', chunk => bodyStr += chunk);
        req.on('end', () => {
            try {
                const body = bodyStr ? JSON.parse(bodyStr) : null;
                const result = handler(url.searchParams, body);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(result));
            } catch (e) {
                console.error(`Error ${key}:`, e.message);
                res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e.message }));
            }
        });
    } else if (url.pathname.startsWith('/api/')) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Not Found' }));
    } else {
        serveStatic(req, res, url.pathname);
    }
});

server.listen(PORT, () => {
    console.log(`ToolM server running at http://0.0.0.0:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
});
