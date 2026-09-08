// ===== HTTP Database Service（服务器模式：多台电脑共享同一 SQLite 数据库）=====
// 前端所有操作通过 HTTP API 与 server.js 交互。
// API 地址自动探测，按顺序尝试候选地址：
//   1) 标准部署：<页面目录>api/（由 nginx/门户反代到 CTMS 后端）
//      独立部署 /            -> /api/
//      门户集成 /apps/ctms/  -> /apps/ctms/api/
//   2) 免 nginx 配置：浏览器直连 CTMS 后端 3001 端口
//      （server.js 已带 CORS 允许跨域；服务器只需启动后端并放行 3001 端口，
//        nginx 配置完全不用改。仅限 HTTP 内网场景，HTTPS 站点请用方式 1）
// 也可以在 db.js 加载前定义 window.CTMS_API_BASE 显式指定（优先级最高）。
const API_BASE_CANDIDATES = (() => {
    const list = [];
    if (window.CTMS_API_BASE) list.push(window.CTMS_API_BASE);
    if (/^https?:$/.test(location.protocol)) {
        list.push((location.pathname.endsWith('/')
            ? location.pathname
            : location.pathname.replace(/[^/]*$/, '')) + 'api/');
        list.push(`${location.protocol}//${location.hostname}:3001/api/`);
    } else {
        // file:// 直接双击打开页面的场景
        list.push('http://localhost:3001/api/');
    }
    return [...new Set(list)];
})();

class DatabaseService {
    constructor(dbName) {
        this.dbName = dbName;
        this._basePromise = null;
    }

    // 探测可用的 API 基础地址（整个会话只探测一次，结果缓存）
    _base() {
        if (!this._basePromise) this._basePromise = this._probe();
        return this._basePromise;
    }

    async _probe() {
        for (const base of API_BASE_CANDIDATES) {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 4000);
            try {
                const resp = await fetch(base + 'health', { signal: ctrl.signal });
                if (resp.ok) {
                    if (base !== API_BASE_CANDIDATES[0]) {
                        console.warn(`API 反代不可用，已切换为直连后端：${base}`);
                    }
                    return base;
                }
            } catch (_) { /* 该地址不通，尝试下一个候选 */ } finally {
                clearTimeout(timer);
            }
        }
        console.warn('CTMS 服务器不可达，请确认后端已启动（node server.js 3001）或 /api/ 代理配置正确');
        return API_BASE_CANDIDATES[0]; // 保底，让后续报错信息指向标准路径
    }

    async _request(method, url, body) {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `请求失败 (${response.status})：${url}`);
        }
        return data;
    }

    async init() {
        // 提前触发 API 地址探测（不调用时也会在首次数据请求时自动探测）
        await this._base();
    }

    async getNewOldStock(uniqueIdentifier) {
        if (!uniqueIdentifier) return { newCount: 0, oldCount: 0 };
        const data = await this._request('GET', `${await this._base()}stock?id=${encodeURIComponent(uniqueIdentifier)}`);
        return { newCount: Number(data.newCount) || 0, oldCount: Number(data.oldCount) || 0 };
    }

    async ensureStateExists(uniqueIdentifier, materialName) {
        if (!uniqueIdentifier) return;
        await this.ensureStatesBulk([{ uniqueIdentifier, materialName }]);
    }

    async ensureStatesBulk(items) {
        if (!items || !items.length) return;
        await this._request('POST', await this._base() + 'ensure-bulk', { items });
    }

    async updateInventory(uniqueIdentifier, isNew, delta, person, materialName, orderMeta) {
        const body = { uniqueIdentifier, isNew, delta, person, materialName };
        if (orderMeta) {
            body.orderNo = orderMeta.orderNo || '';
            body.orderMaterial = orderMeta.orderMaterial || '';
            body.orderTexture = orderMeta.orderTexture || '';
            body.orderQty = orderMeta.orderQty != null ? orderMeta.orderQty : '';
        }
        const data = await this._request('POST', await this._base() + 'update', body);
        return { newCount: Number(data.newCount) || 0, oldCount: Number(data.oldCount) || 0 };
    }

    async resetInventory(uniqueIdentifier, newCount, oldCount, person, materialName) {
        await this._request('POST', await this._base() + 'reset', { uniqueIdentifier, newCount, oldCount, person, materialName });
        return { ok: true };
    }

    async getAllInventoryStates() {
        const data = await this._request('GET', await this._base() + 'states');
        return (data || []).map(s => ({
            uniqueIdentifier: s.uniqueIdentifier,
            materialName: s.materialName || '',
            newCount: Number(s.newCount) || 0,
            oldCount: Number(s.oldCount) || 0,
            lastUpdated: s.lastUpdated || ''
        }));
    }

    async getAllInventoryHistory() {
        const data = await this._request('GET', await this._base() + 'history');
        return (data || []).map(h => ({
            uniqueIdentifier: h.uniqueIdentifier,
            materialName: h.materialName || '',
            isNew: !!h.isNew,
            delta: Number(h.delta) || 0,
            person: h.person || '',
            timestamp: h.timestamp || '',
            orderNo: h.orderNo || '',
            orderMaterial: h.orderMaterial || '',
            orderTexture: h.orderTexture || '',
            orderQty: h.orderQty != null ? h.orderQty : ''
        }));
    }
}
