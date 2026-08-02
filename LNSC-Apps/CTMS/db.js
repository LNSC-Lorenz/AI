// ===== HTTP Database Service（服务器模式：多台电脑共享同一 SQLite 数据库）=====
// 前端所有操作通过 HTTP API 与 server.js 交互。
// API 基础路径相对于当前页面目录：
//   独立部署 /            -> /api/
//   门户集成 /apps/ctms/  -> /apps/ctms/api/（由门户 server.js 反代到本服务）
const API_BASE = (location.pathname.endsWith('/')
    ? location.pathname
    : location.pathname.replace(/[^/]*$/, '')) + 'api/';

class DatabaseService {
    constructor(dbName) {
        this.dbName = dbName;
    }

    async _request(method, url, body) {
        const options = { method, headers: { 'Content-Type': 'application/json' } };
        if (body) options.body = JSON.stringify(body);
        const response = await fetch(url, options);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `请求失败 (${response.status})`);
        }
        return data;
    }

    async init() {
        // 健康检查：确认服务器可达
        try {
            await this._request('GET', API_BASE + 'health');
        } catch (e) {
            console.warn('服务器不可达，请确认 CTMS 后端已启动且 /api/ 代理配置正确');
        }
    }

    async getNewOldStock(uniqueIdentifier) {
        if (!uniqueIdentifier) return { newCount: 0, oldCount: 0 };
        const data = await this._request('GET', `${API_BASE}stock?id=${encodeURIComponent(uniqueIdentifier)}`);
        return { newCount: Number(data.newCount) || 0, oldCount: Number(data.oldCount) || 0 };
    }

    async ensureStateExists(uniqueIdentifier, materialName) {
        if (!uniqueIdentifier) return;
        await this.ensureStatesBulk([{ uniqueIdentifier, materialName }]);
    }

    async ensureStatesBulk(items) {
        if (!items || !items.length) return;
        await this._request('POST', API_BASE + 'ensure-bulk', { items });
    }

    async updateInventory(uniqueIdentifier, isNew, delta, person, materialName, orderMeta) {
        const body = { uniqueIdentifier, isNew, delta, person, materialName };
        if (orderMeta) {
            body.orderNo = orderMeta.orderNo || '';
            body.orderMaterial = orderMeta.orderMaterial || '';
            body.orderTexture = orderMeta.orderTexture || '';
            body.orderQty = orderMeta.orderQty != null ? orderMeta.orderQty : '';
        }
        const data = await this._request('POST', API_BASE + 'update', body);
        return { newCount: Number(data.newCount) || 0, oldCount: Number(data.oldCount) || 0 };
    }

    async resetInventory(uniqueIdentifier, newCount, oldCount, person, materialName) {
        await this._request('POST', API_BASE + 'reset', { uniqueIdentifier, newCount, oldCount, person, materialName });
        return { ok: true };
    }

    async getAllInventoryStates() {
        const data = await this._request('GET', API_BASE + 'states');
        return (data || []).map(s => ({
            uniqueIdentifier: s.uniqueIdentifier,
            materialName: s.materialName || '',
            newCount: Number(s.newCount) || 0,
            oldCount: Number(s.oldCount) || 0,
            lastUpdated: s.lastUpdated || ''
        }));
    }

    async getAllInventoryHistory() {
        const data = await this._request('GET', API_BASE + 'history');
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
