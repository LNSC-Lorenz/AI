// ===== Application State =====
let dbService = new DatabaseService('toolinventory');
let cabinets = [];
let excelData = [];
let stockLookup = {};
let currentCabinetIndex = 0;
let selectedCard = null;
let selectedCardItem = null;
let isNewSelected = true;
let currentInput = '';
let personIdInput = '';
let personName = '';
let currentCurState = null;
let fallbackInventory = 0;
let personIdTimerHandle = null;
// Excel “新品库存/旧品库存”列扫描结果（供上传后的差异确认提示使用）
let excelStockScan = { rows: 0, withQty: 0, newColFound: false, oldColFound: false, sheets: [] };

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    // Safety: always hide loading after 5 seconds no matter what
    setTimeout(hideLoading, 5000);

    try {
        initializeData();
        renderMainView();
        try {
            await loadExcelData();
        } catch (e) {
            console.warn('Excel load failed:', e);
            showMessage('加载Excel初始化信息失败：' + e.message);
        }
    } catch (e) {
        console.error('Init error:', e);
    } finally {
        hideLoading();
    }

    // Barcode scanner support (matches WPF PreviewTextInput + PreviewKeyDown)
    let scanBuilder = '';
    let scanTimer = null;
    document.addEventListener('keypress', (e) => {
        if (document.activeElement && document.activeElement.tagName === 'INPUT' && !document.activeElement.readOnly) return;
        if (e.key === 'Enter') {
            if (scanBuilder) {
                processScannedId(scanBuilder);
                scanBuilder = '';
                clearTimeout(scanTimer);
            }
        } else {
            scanBuilder += e.key;
            clearTimeout(scanTimer);
            scanTimer = setTimeout(() => { scanBuilder = ''; }, 1200000); // 20 min
        }
    });

    // 库位搜索框：输入即搜、回车跳第一个结果、点击其它位置收起
    const searchInput = document.getElementById('txtSearch');
    if (searchInput) {
        searchInput.addEventListener('input', onSearchInput);
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const first = document.querySelector('#searchResults .search-item:not(.search-empty)');
                if (first) first.click();
            }
        });
    }
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-box')) hideSearchResults();
    });
});

// 用户验证：从本地 user_info.js 数据验证（支持扫码ID或用户ID）
async function verifyUser(id) {
    if (!id) return null;
    const users = window.USER_INFO || [];
    const found = users.find(u => u.scanId === id || u.personId === id);
    return found ? { found: true, personId: found.personId, personName: found.personName } : null;
}

async function processScannedId(id) {
    if (!id) return;
    const person = await verifyUser(id);
    if (person) {
        personName = `${person.personName}@${person.personId}`;
        document.getElementById('txtPerson').value = personName;
        resetPersonIdTimer();
    }
}

function resetPersonIdTimer() {
    if (personIdTimerHandle) clearTimeout(personIdTimerHandle);
    personIdTimerHandle = setTimeout(() => {
        personName = '';
        document.getElementById('txtPerson').value = '';
    }, 1200000); // 20 minutes
}

function initializeData() {
    cabinets = [];
    const cabinetNames = {
        1: '钻头、其它刀具柜',
        2: '钻头柜',
        3: '刀片柜',
        4: '刀轩柜',
        5: '铣刀柜'
    };

    for (let i = 1; i <= 5; i++) {
        const cabinet = {
            code: `NO${String(i).padStart(2, '0')}`,
            name: cabinetNames[i] || `刀具柜${i}`,
            number: i,
            drawers: []
        };

        const drawerCount = (i === 1 || i === 2) ? 10 : 14;

        for (let j = 1; j <= drawerCount; j++) {
            const drawer = {
                code: `${cabinet.code}${String(j).padStart(2, '0')}`,
                lightStates: [null, null, null, null],
                height: getDrawerHeight(i, j),
                index: j,
                displayName: '',
                isSelected: false
            };
            cabinet.drawers.push(drawer);
        }
        cabinets.push(cabinet);
    }
}

function getDrawerHeight(cabIndex, drawIndex) {
    if (cabIndex <= 2) {
        return drawIndex > 6 ? 2 : 1;
    } else {
        return 1;
    }
}

// ===== Excel Data Loading =====
// Excel 库存数量单元格 → 非负整数；空/非数字 → null（注意：0 是有效值，不能用 || null）
function toStockNum(v) {
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return isNaN(n) ? null : Math.max(0, Math.round(n));
}

// 在“表头行”里按关键字定位列索引（忽略空白字符）；找不到返回 -1。
// 注意：不能用 Object.keys(sheet_to_json(sheet)[0]) —— SheetJS 默认省略空单元格，
// 若第一行数据的该列为空，就会误判“整张表没有这一列”（2026-10 库存不上报故障根因）。
function findHeaderCol(headerRow, keyword) {
    if (!headerRow) return -1;
    for (let i = 0; i < headerRow.length; i++) {
        const h = headerRow[i] == null ? '' : String(headerRow[i]).replace(/\s/g, '');
        if (h && h.includes(keyword)) return i;
    }
    return -1;
}

// 按表头定位到的列索引，逐行取“新品/旧品库存”单元格，按唯一识别号建索引。
// 单元格为空 → null（语义：该列不动）；0 是有效值。
function buildStockCellMap(rawRows, uidColIdx, newColIdx, oldColIdx) {
    const map = {};
    if (uidColIdx < 0) return map;
    for (let r = 1; r < rawRows.length; r++) {
        const row = rawRows[r];
        if (!row) continue;
        const uid = row[uidColIdx] == null ? '' : String(row[uidColIdx]).trim();
        if (!uid) continue;
        const key = uid.toLowerCase();
        if (map[key]) continue;
        map[key] = {
            newStock: newColIdx >= 0 ? toStockNum(row[newColIdx]) : null,
            oldStock: oldColIdx >= 0 ? toStockNum(row[oldColIdx]) : null
        };
    }
    return map;
}

async function loadExcelData() {
    try {
        const response = await fetch('data/车间工具库存管理-信息表.xlsx', { cache: 'no-store' });
        if (!response.ok) {
            console.warn('Excel file not found, using empty data');
            return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        excelData = [];
        excelStockScan = { rows: 0, withQty: 0, newColFound: false, oldColFound: false, sheets: [] };
        const sheetNames = workbook.SheetNames;

        for (let sheetIndex = 0; sheetIndex < Math.min(5, sheetNames.length); sheetIndex++) {
            const sheet = workbook.Sheets[sheetNames[sheetIndex]];
            const rows = XLSX.utils.sheet_to_json(sheet);

            // 新品库存/旧品库存：先用“表头行”定位列索引，再按索引逐行读数。
            // 既不依赖列顺序，也不会因为“第一行数据该列为空”就把整列判成不存在。
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: null });
            const headerRow = rawRows[0] || [];
            const newColIdx = findHeaderCol(headerRow, '新品库存');
            const oldColIdx = findHeaderCol(headerRow, '旧品库存');
            const uidColIdx = findHeaderCol(headerRow, '唯一识别号');
            const stockCells = buildStockCellMap(rawRows, uidColIdx, newColIdx, oldColIdx);
            const sheetQtyRows = Object.keys(stockCells)
                .filter(k => stockCells[k].newStock != null || stockCells[k].oldStock != null).length;
            excelStockScan.sheets.push({
                sheet: sheetNames[sheetIndex],
                newCol: newColIdx >= 0 ? String(headerRow[newColIdx] || '').trim() : '',
                oldCol: oldColIdx >= 0 ? String(headerRow[oldColIdx] || '').trim() : '',
                rowsWithQty: sheetQtyRows
            });
            if (newColIdx >= 0) excelStockScan.newColFound = true;
            if (oldColIdx >= 0) excelStockScan.oldColFound = true;
            excelStockScan.withQty += sheetQtyRows;

            rows.forEach(row => {
                const rowId = (row['唯一识别号'] || '').toString().trim();
                const cell = rowId ? stockCells[rowId.toLowerCase()] : null;
                const item = {
                    cabinetNumber: sheetIndex + 1,
                    drawerNumber: parseInt(row['抽屉号']) || 0,
                    rowNumber: parseInt(row['行（排）号']) || 0,
                    sequenceNumber: parseInt(row['序号']) || 0,
                    uniqueIdentifier: (row['唯一识别号'] || '').toString().trim(),
                    cabinetCode: row['（代称）柜号'] || '',
                    drawerCode: row['（代称）抽屉号'] || '',
                    rowCode: row['（代称）行（排）号'] || '',
                    sequenceCode: row['（代称）序号'] || '',
                    materialName: row['物料名称'] || '',
                    safetyStock: parseFloat(row['安全库存']) || null,
                    nextPurchaseQuantity: parseFloat(row['下次采购量']) || null,
                    sapNumber: (row['SAP号'] || '').toString().trim(),
                    unitPrice: parseFloat(row['单价']) || null,
                    toolBrand: row['刀具品牌'] || '',
                    excelNewStock: cell && cell.newStock != null ? cell.newStock : null,
                    excelOldStock: cell && cell.oldStock != null ? cell.oldStock : null,
                    curState: null
                };
                if (item.drawerNumber > 0) {
                    excelData.push(item);
                }
            });
        }
        excelStockScan.rows = excelData.length;

        // Read SAP号, 单价, 刀具品牌 from raw header rows (matches WPF logic)
        for (let sheetIndex = 0; sheetIndex < Math.min(5, sheetNames.length); sheetIndex++) {
            try {
                const sheet = workbook.Sheets[sheetNames[sheetIndex]];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
                if (!rawRows || !rawRows.length) continue;

                const headers = Object.keys(rawRows[0]);
                const sapKey = headers.find(k => k && k.includes('SAP'));
                const priceKey = headers.find(k => k && k.includes('单价'));
                const brandKey = headers.find(k => k && k.includes('品牌'));
                const idKey = headers.find(k => k && (k.includes('唯一识别') || k.includes('唯一ID')));

                if (!sapKey && !priceKey && !brandKey) continue;

                rawRows.forEach(row => {
                    let rowId = idKey && row[idKey] ? row[idKey].toString().trim() : '';
                    if (!rowId) return;

                    const matchItems = excelData.filter(x =>
                        x.cabinetNumber === (sheetIndex + 1) &&
                        x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === rowId.toLowerCase()
                    );

                    matchItems.forEach(mi => {
                        if (sapKey && row[sapKey]) {
                            const sv = row[sapKey].toString().trim();
                            if (sv) mi.sapNumber = sv;
                        }
                        if (priceKey && row[priceKey]) {
                            const pv = parseFloat(row[priceKey]);
                            if (!isNaN(pv)) mi.unitPrice = pv;
                        }
                        if (brandKey && row[brandKey]) {
                            const bv = row[brandKey].toString().trim();
                            if (bv) mi.toolBrand = bv;
                        }
                    });
                });
            } catch (e) { /* ignore per-sheet errors */ }
        }

        // Apply names to model
        applyExcelNamesToModel();

        // Ensure states exist in DB (bulk, single request); 失败不影响Excel布局展示
        const uniqueIds = [...new Set(excelData.filter(x => x.uniqueIdentifier).map(x => x.uniqueIdentifier))];

        try {
            await dbService.ensureStatesBulk(uniqueIds.map(id => ({
                uniqueIdentifier: id,
                materialName: (excelData.find(x => x.uniqueIdentifier === id && x.materialName) || {}).materialName || ''
            })));
        } catch (e) {
            console.warn('ensureStatesBulk failed:', e);
        }

        // 说明（2026-10-26 移除“自动初始化”）：这里原有一段逻辑——当 dbHasData 判定失败（一次
        // /api/states 请求异常即可）时，用 Excel 的 M/N 列直接覆盖库存，并调用 /api/reset，
        // 而 /api/reset 会删除该物料的全部出入库历史。2026-09-09 14:07 就因此把 484 项
        // 一次性写成 0/0，并清空了它们的流水。库存初始化/校正现在只走
        // 【上传Excel】→ 差异清单 → 确认更新 这条显式路径（见 syncCountsFromExcel）。

        // Prefetch all stocks with a single request; 失败时库存显示为0但布局正常
        let allStates = [];
        try {
            allStates = await dbService.getAllInventoryStates();
        } catch (e) {
            console.warn('getAllInventoryStates failed:', e);
        }
        const stateMap = {};
        allStates.forEach(s => {
            if (s.uniqueIdentifier) stateMap[s.uniqueIdentifier.toLowerCase()] = s;
        });

        uniqueIds.forEach(id => {
            const s = stateMap[id.toLowerCase()];
            stockLookup[id] = s ? (s.newCount + s.oldCount) : 0;
        });

        // Update curState for all items
        excelData.forEach(item => {
            if (!item.uniqueIdentifier) return;
            const s = stateMap[item.uniqueIdentifier.toLowerCase()];
            item.curState = {
                uniqueIdentifier: item.uniqueIdentifier,
                newCount: s ? s.newCount : 0,
                oldCount: s ? s.oldCount : 0
            };
        });

        updateAllDrawerLightStates();
        renderMainView();

    } catch (err) {
        console.error('Error loading Excel:', err);
        throw err;
    }
}

function applyExcelNamesToModel() {
    if (!excelData.length) return;

    cabinets.forEach(cab => {
        const firstCabAlias = excelData.find(x => x.cabinetNumber === cab.number && x.cabinetCode);
        if (firstCabAlias) {
            cab.name = cab.code + '-' + firstCabAlias.cabinetCode;
        }

        cab.drawers.forEach(dr => {
            const drAlias = excelData.find(x => x.cabinetNumber === cab.number && x.drawerNumber === dr.index && x.drawerCode);
            dr.displayName = drAlias ? `${dr.code}-${drAlias.drawerCode}` : '';
        });
    });
}

function updateAllDrawerLightStates() {
    if (!excelData.length || !cabinets.length) return;

    cabinets.forEach(cab => {
        cab.drawers.forEach(dr => {
            dr.lightStates = [null, null, null, null];
            for (let row = 1; row <= 4; row++) {
                const rowItems = excelData.filter(x =>
                    x.cabinetNumber === cab.number && x.drawerNumber === dr.index && x.rowNumber === row
                );
                if (!rowItems.length) { dr.lightStates[row - 1] = null; continue; }

                const rowItemsWithId = rowItems.filter(i => i.uniqueIdentifier);
                if (!rowItemsWithId.length) { dr.lightStates[row - 1] = null; continue; }

                const anyAlarm = rowItemsWithId.some(item => isItemAlarm(item));
                dr.lightStates[row - 1] = !anyAlarm;
            }
        });
    });
}

function isItemAlarm(item) {
    if (!item) return false;
    const curStock = getStockFromCache(item.uniqueIdentifier);
    if (item.safetyStock != null) {
        return curStock <= item.safetyStock;
    }
    return false;
}

function getStockFromCache(uniqueIdentifier) {
    if (!uniqueIdentifier) return 0;
    return stockLookup[uniqueIdentifier] || 0;
}

// ===== Rendering =====
function renderMainView() {
    const container = document.getElementById('cabinetContainer');
    container.innerHTML = '';

    cabinets.forEach((cabinet, idx) => {
        container.appendChild(createCabinetElement(cabinet, false));
    });
}

function createCabinetElement(cabinet, isPreview) {
    const cabEl = document.createElement('div');
    cabEl.className = 'cabinet';

    const title = document.createElement('div');
    title.className = 'cabinet-title';
    if (!isPreview) {
        title.onclick = () => cabinetClick(cabinet);
    }

    const code = document.createElement('span');
    code.className = 'cabinet-code';
    code.textContent = cabinet.code;

    const name = document.createElement('span');
    name.className = 'cabinet-name';
    name.textContent = cabinet.name;

    title.appendChild(code);
    title.appendChild(name);
    cabEl.appendChild(title);

    const drawerList = document.createElement('div');
    drawerList.className = 'drawer-list';

    cabinet.drawers.forEach(drawer => {
        const drEl = document.createElement('div');
        drEl.className = 'drawer' + (drawer.isSelected ? ' selected' : '');
        drEl.style.flexGrow = drawer.height;
        drEl.style.position = 'relative';

        // In main view: single-click drawer to enter detail view with that drawer selected
        if (!isPreview) {
            drEl.onclick = (e) => {
                e.stopPropagation();
                drEl.classList.add('drawer-pullout');
                setTimeout(() => {
                    cabinet.drawers.forEach(d => d.isSelected = false);
                    drawer.isSelected = true;
                    cabinetClick(cabinet);
                }, 230);
            };
        }

        if (isPreview) {
            drEl.onclick = () => {
                drEl.classList.add('drawer-pullout');
                setTimeout(() => {
                    // Deselect all drawers in this cabinet
                    cabinet.drawers.forEach(d => d.isSelected = false);
                    drawer.isSelected = true;
                    renderDetailView(cabinet);
                    loadToolDetails(cabinet, drawer);
                    loadToolStocks(cabinet, drawer);
                }, 230);
            };
        }

        const handle = document.createElement('div');
        handle.className = 'drawer-handle';
        drEl.appendChild(handle);

        const nameSpan = document.createElement('span');
        nameSpan.className = 'drawer-name';
        const dispName = drawer.displayName || '';
        const dashIdx = dispName.indexOf('-');
        if (dashIdx > 0) {
            const prefix = dispName.substring(0, dashIdx);
            const rest = dispName.substring(dashIdx);
            const prefixSpan = document.createElement('span');
            prefixSpan.className = 'drawer-prefix';
            prefixSpan.textContent = prefix.slice(0, -2);
            const numSpan = document.createElement('span');
            numSpan.className = 'drawer-prefix-num';
            numSpan.textContent = prefix.slice(-2);
            prefixSpan.appendChild(numSpan);
            nameSpan.appendChild(prefixSpan);
            nameSpan.appendChild(document.createTextNode(rest));
        } else {
            nameSpan.textContent = dispName;
        }
        drEl.appendChild(nameSpan);

        const lights = document.createElement('div');
        lights.className = 'drawer-lights';
        drawer.lightStates.forEach(state => {
            const light = document.createElement('div');
            light.className = 'light ' + (state === null ? 'gray' : (state ? 'green' : 'red'));
            lights.appendChild(light);
        });
        drEl.appendChild(lights);

        drawerList.appendChild(drEl);
    });

    cabEl.appendChild(drawerList);
    return cabEl;
}

// ===== Navigation =====
function cabinetClick(cabinet) {
    currentCabinetIndex = cabinets.indexOf(cabinet);
    showDetailView(cabinet);
}

function showDetailView(cabinet) {
    document.getElementById('mainView').style.display = 'none';
    document.getElementById('detailView').style.display = 'flex';
    document.getElementById('borderMain').style.display = 'none';
    document.getElementById('borDetail').style.display = 'flex';

    // Highlight current cabinet's NO button
    document.querySelectorAll('.no-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === currentCabinetIndex);
    });

    // Select first drawer if none selected
    if (!cabinet.drawers.some(d => d.isSelected)) {
        if (cabinet.drawers.length > 0) {
            cabinet.drawers[0].isSelected = true;
        }
    }

    renderDetailView(cabinet);

    const initDrawer = cabinet.drawers.find(d => d.isSelected) || cabinet.drawers[0];
    if (initDrawer) {
        loadToolDetails(cabinet, initDrawer);
        loadToolStocks(cabinet, initDrawer);
    }
}

function renderDetailView(cabinet) {
    const preview = document.getElementById('detailCabinetPreview');
    preview.innerHTML = '';
    preview.appendChild(createCabinetElement(cabinet, true));
}

function backToMain() {
    document.getElementById('detailView').style.display = 'none';
    document.getElementById('mainView').style.display = '';
    document.getElementById('borderMain').style.display = 'flex';
    document.getElementById('borDetail').style.display = 'none';

    // Deselect all drawers
    cabinets.forEach(c => c.drawers.forEach(d => d.isSelected = false));
    selectedCard = null;
    selectedCardItem = null;

    updateAllDrawerLightStates();
    renderMainView();
}

function noButtonClick(num) {
    if (num >= 1 && num <= 5) {
        currentCabinetIndex = num - 1;
        cabinets[currentCabinetIndex].drawers.forEach(d => d.isSelected = false);
        showDetailView(cabinets[currentCabinetIndex]);
    }
}

// ===== 型号搜索：按 名称/型号/SAP号/唯一ID/品牌 查找并定位库位 =====
function formatLocation(item) {
    const cab = cabinets[item.cabinetNumber - 1];
    const cabCode = cab ? cab.code : `NO${String(item.cabinetNumber).padStart(2, '0')}`;
    return `${cabCode}柜 抽屉${item.drawerNumber} 行${item.rowNumber} 位${item.sequenceNumber}`;
}

// 模糊搜索归一化：全角转半角、忽略大小写、去掉空格和常见分隔符（- _ / \ . · , 、 * Φ Ø 括号 # 等），
// "×" 按 "x" 处理。这样型号 "D10.5-45"、"d10 5 45"、"10.5×45" 都能互相搜到。
function normalizeSearchText(s) {
    let t = (s == null ? '' : String(s));
    t = t.replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)); // 全角→半角
    t = t.toLowerCase().replace(/×/g, 'x');
    t = t.replace(/[\s\-_/\\.·,，、*ΦφØø()（）\[\]【】#＃]+/g, '');
    return t;
}

function onSearchInput() {
    const kwRaw = document.getElementById('txtSearch').value.trim().toLowerCase();
    const kw = normalizeSearchText(kwRaw);
    const box = document.getElementById('searchResults');
    if (!kw) { hideSearchResults(); return; }

    // 原始子串匹配 + 归一化模糊匹配，任一命中即算匹配
    const matches = excelData.filter(x =>
        [x.materialName, x.sapNumber, x.uniqueIdentifier, x.toolBrand].some(f => {
            const raw = (f || '').toString().toLowerCase();
            return raw.includes(kwRaw) || normalizeSearchText(f).includes(kw);
        })
    );

    // 相关度排序：名称以关键词开头的排最前，其余按库位顺序
    matches.sort((a, b) => {
        const ap = normalizeSearchText(a.materialName).startsWith(kw) ? 0 : 1;
        const bp = normalizeSearchText(b.materialName).startsWith(kw) ? 0 : 1;
        return ap - bp || a.cabinetNumber - b.cabinetNumber || a.drawerNumber - b.drawerNumber || a.sequenceNumber - b.sequenceNumber;
    });
    const top = matches.slice(0, 20);

    box.innerHTML = '';
    if (!top.length) {
        box.innerHTML = '<div class="search-item search-empty">未找到匹配的刀具</div>';
    } else {
        top.forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `<span class="si-name">${item.materialName || item.uniqueIdentifier || ''}</span>` +
                `<span class="si-loc">${formatLocation(item)}</span>` +
                `<span class="si-stock">库存 ${getStockFromCache(item.uniqueIdentifier)}</span>`;
            div.onclick = () => { clearSearch(); goToItem(item); };
            box.appendChild(div);
        });
    }
    box.style.display = 'block';
}

function hideSearchResults() {
    const box = document.getElementById('searchResults');
    if (box) { box.style.display = 'none'; box.innerHTML = ''; }
}

function clearSearch() {
    const input = document.getElementById('txtSearch');
    if (input) input.value = '';
    hideSearchResults();
}

// 跳转到目标刀具所在 柜/抽屉，并选中高亮对应卡片
function goToItem(item) {
    const cabinet = cabinets[item.cabinetNumber - 1];
    if (!cabinet) { showMessage('未找到对应柜子。'); return; }

    cabinet.drawers.forEach(d => d.isSelected = false);
    const drawer = cabinet.drawers[item.drawerNumber - 1];
    if (drawer) drawer.isSelected = true;
    showDetailView(cabinet);

    setTimeout(() => {
        const esc = (window.CSS && CSS.escape) ? CSS.escape : (s => String(s).replace(/"/g, '\\"'));
        const card = document.querySelector(
            `.tool-card[data-uid="${esc(item.uniqueIdentifier)}"][data-row="${item.rowNumber}"][data-seq="${item.sequenceNumber}"]`
        );
        if (card) {
            cardSelected(card, item);
            card.scrollIntoView({ block: 'center', behavior: 'smooth' });
            card.classList.add('search-hit');
            setTimeout(() => card.classList.remove('search-hit'), 2600);
        }
    }, 60);
}

// ===== 上传新版库存信息表（xlsx），上传成功后用新表刷新界面 =====
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 确认对话框（与 showMessage 同风格，确定/取消 两按钮），resolve true=确认
// opts.wide=true 加宽（用于差异清单表格）；opts.yesText/noText 自定义按钮文案
function showConfirm(msg, opts) {
    const o = opts || {};
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'msg-overlay';
        const boxStyle = o.wide ? ' style="width:min(920px,92vw);min-width:0;max-width:92vw;text-align:left;padding:22px 24px"' : '';
        const bodyStyle = o.wide
            ? 'margin-bottom:16px;font-size:15px;text-align:left;white-space:normal'
            : 'margin-bottom:20px;font-size:16px;white-space:pre-line;text-align:left;max-height:50vh;overflow:auto';
        overlay.innerHTML = `
        <div class="msg-box"${boxStyle}>
            <div style="${bodyStyle}">${msg}</div>
            <div style="display:flex;gap:12px;justify-content:center">
                <button data-act="yes">${o.yesText || '以Excel为准更新'}</button>
                <button data-act="no">${o.noText || '不更新'}</button>
            </div>
        </div>`;
        overlay.querySelector('[data-act="yes"]').onclick = () => { overlay.remove(); resolve(true); };
        overlay.querySelector('[data-act="no"]').onclick = () => { overlay.remove(); resolve(false); };
        document.body.appendChild(overlay);
    });
}

// 上传新表后：把 Excel 的“新品库存/旧品库存”列与软件实时数量比对，
// 列出全部差异，确认后以 Excel 为准更新（逐条写入出入库历史，人员记为"Excel同步"）。
// 仅在上传这一主动动作时执行；日常打开页面不同步，避免旧 Excel 覆盖实时出入库结果。
// 语义：某列留空 = 该列不动；填 0 = 清零（清零项在确认框里标红并排在最前）。
async function syncCountsFromExcel() {
    const scan = excelStockScan;
    const candidates = excelData.filter(x => x.uniqueIdentifier && (x.excelNewStock != null || x.excelOldStock != null));
    if (!candidates.length) return { changed: 0, applied: false, scan, zeroCount: 0 };

    const stockMap = await fetchAllStockMap();
    const diffs = [];
    const seen = new Set();
    candidates.forEach(x => {
        const key = x.uniqueIdentifier.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const cur = stockMap[key] || { newCount: 0, oldCount: 0 };
        // 某列 Excel 留空 = 该列不动，保持软件现值
        const newTarget = x.excelNewStock != null ? x.excelNewStock : cur.newCount;
        const oldTarget = x.excelOldStock != null ? x.excelOldStock : cur.oldCount;
        if (newTarget !== cur.newCount || oldTarget !== cur.oldCount) {
            diffs.push({
                uid: x.uniqueIdentifier, name: x.materialName || '',
                curNew: cur.newCount, curOld: cur.oldCount, newTarget, oldTarget,
                toZero: (newTarget === 0 && cur.newCount > 0) || (oldTarget === 0 && cur.oldCount > 0)
            });
        }
    });
    if (!diffs.length) return { changed: 0, applied: false, scan, zeroCount: 0 };

    // 清零项排在最前，便于操作人先看清风险
    diffs.sort((a, b) => (b.toZero ? 1 : 0) - (a.toZero ? 1 : 0) || a.uid.localeCompare(b.uid));
    const zeroCount = diffs.filter(d => d.toZero).length;

    const ok = await showConfirm(buildDiffHtml(diffs, scan, zeroCount), {
        wide: true,
        yesText: `以Excel为准更新（${diffs.length} 项）`,
        noText: '取消'
    });
    if (!ok) return { changed: diffs.length, applied: false, scan, zeroCount };

    let done = 0, failed = 0;
    for (const d of diffs) {
        try {
            if (d.newTarget !== d.curNew) {
                await dbService.updateInventory(d.uid, true, d.newTarget - d.curNew, 'Excel同步', d.name);
            }
            if (d.oldTarget !== d.curOld) {
                await dbService.updateInventory(d.uid, false, d.oldTarget - d.curOld, 'Excel同步', d.name);
            }
            done++;
        } catch (e) {
            failed++;
            console.error('库存同步失败:', d.uid, e);
        }
    }
    return { changed: diffs.length, applied: true, done, failed, scan, zeroCount };
}

// 组装差异清单 HTML：全部差异逐行列出（可滚动），清零项标红并置顶
function buildDiffHtml(diffs, scan, zeroCount) {
    const skipped = Math.max(0, (scan && scan.rows ? scan.rows : 0) - (scan && scan.withQty ? scan.withQty : 0));
    const th = 'padding:6px 8px;text-align:left;font-weight:600;color:#333;border-bottom:1px solid #e0e0e0';
    const cell = (cur, target) => {
        if (cur === target) return `<td style="padding:6px 8px;color:#666">${cur}</td>`;
        const zero = target === 0 && cur > 0;
        const color = zero ? '#c62828' : '#1565c0';
        return `<td style="padding:6px 8px;color:${color};font-weight:600">${cur} → ${target}${zero ? '（清零）' : ''}</td>`;
    };
    const rows = diffs.map(d => `
                <tr style="background:${d.toZero ? '#fdecea' : '#fff'}">
                    <td style="padding:6px 8px;font-family:Consolas,monospace">${escapeHtml(d.uid)}</td>
                    <td style="padding:6px 8px;color:#333">${escapeHtml(d.name)}</td>
                    ${cell(d.curNew, d.newTarget)}
                    ${cell(d.curOld, d.oldTarget)}
                </tr>`).join('');
    return `
        <div style="line-height:1.6;margin-bottom:10px">
            新表共扫描 <b>${scan && scan.rows ? scan.rows : 0}</b> 行库位，其中
            <b>${scan && scan.withQty ? scan.withQty : 0}</b> 行填了新品/旧品数量；
            与软件实时库存比对出 <b>${diffs.length}</b> 项差异${zeroCount ? `，其中 <b style="color:#c62828">${zeroCount} 项会清零</b>` : ''}。
        </div>
        ${zeroCount ? `<div style="background:#fdecea;border:1px solid #f5c6cb;color:#c62828;padding:8px 10px;border-radius:6px;font-size:13px;margin-bottom:10px;line-height:1.5">
            ⚠ 标红行的数量在 Excel 里是 0，确认后软件库存会被清零。请先确认这些库位确实已盘为 0，再点“以Excel为准更新”。
        </div>` : ''}
        <div style="max-height:42vh;overflow:auto;border:1px solid #e0e0e0;border-radius:6px">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="position:sticky;top:0;background:#f5f7fa">
                        <th style="${th}">唯一识别号</th>
                        <th style="${th}">物料名称</th>
                        <th style="${th}">新品 现值→新值</th>
                        <th style="${th}">旧品 现值→新值</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <div style="font-size:12px;color:#666;margin-top:10px;line-height:1.6">
            Excel 中该列为空 = 不动（本次有 ${skipped} 行未填数量，按不动处理）。<br>
            确认后逐条写入出入库历史（人员记为“Excel同步”）；点“取消”不修改任何数量。
        </div>`;
}

async function uploadExcelFile(input) {
    const file = input.files && input.files[0];
    input.value = ''; // 重置，允许重复选择同一个文件
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
        showMessage('请选择 .xlsx 格式的文件。');
        return;
    }

    const textEl = document.querySelector('.upload-excel-text');
    const btn = document.querySelector('.upload-excel-btn');
    if (btn) btn.classList.add('uploading');
    if (textEl) textEl.textContent = '上传中…';
    try {
        const r = await dbService.uploadExcel(file);
        await loadExcelData(); // 用新表重新加载 库位/名称/安全库存/采购量 并刷新界面
        // M/N 库存列同步（差异确认后以Excel为准，见 syncCountsFromExcel）
        let syncMsg;
        try {
            const s = await syncCountsFromExcel();
            const scanned = s.scan && s.scan.rows ? s.scan.rows : 0;
            const withQty = s.scan && s.scan.withQty ? s.scan.withQty : 0;
            if (s.applied) {
                await loadExcelData(); // 数量已变，重新拉取库存刷新界面
                syncMsg = `库存同步：已按新表更新 ${s.done} 项${s.zeroCount ? `（含清零 ${s.zeroCount} 项）` : ''}${s.failed ? `，${s.failed} 项失败（详见控制台）` : ''}。`;
            } else if (s.changed > 0) {
                syncMsg = `库存同步：已取消，${s.changed} 项差异未应用，数量保持软件现值。`;
            } else if (!s.scan || (!s.scan.newColFound && !s.scan.oldColFound)) {
                syncMsg = `库存同步：新表里没找到“新品库存”/“旧品库存”列（已扫描 ${scanned} 行），未比对数量。请检查表头名称（需包含这 6 个字）。`;
            } else if (!withQty) {
                syncMsg = `库存同步：新表 ${scanned} 行中没有任何新品/旧品数量（全空），按“不动”处理，库存未变。`;
            } else {
                syncMsg = `库存同步：已扫描 ${scanned} 行（其中 ${withQty} 行填了数量），与软件一致，无需更新。`;
            }
        } catch (e) {
            console.error('库存同步失败:', e);
            syncMsg = '库存同步失败：' + e.message;
        }
        showMessage(`上传成功（${(r.size / 1024).toFixed(0)} KB）。${syncMsg}`);
    } catch (e) {
        showMessage('上传失败：' + e.message);
    } finally {
        if (btn) btn.classList.remove('uploading');
        if (textEl) textEl.textContent = '上传Excel';
    }
}

// ===== Tool Details Loading =====
function loadToolDetails(cabinet, selectedDrawer) {
    const CARDS_PER_ROW = 8;
    const TOTAL_ROWS = 4;

    selectedCard = null;
    selectedCardItem = null;

    const container = document.getElementById('cardContainer');
    container.innerHTML = '';

    const slots = new Array(CARDS_PER_ROW * TOTAL_ROWS).fill(null);

    let itemsForDrawer = [];
    if (selectedDrawer && excelData.length) {
        itemsForDrawer = excelData.filter(x =>
            x.cabinetNumber === cabinet.number && x.drawerNumber === selectedDrawer.index
        );
    }

    itemsForDrawer.forEach(item => {
        if (!item) return;
        const rowNum = item.rowNumber;
        const seqNum = item.sequenceNumber;
        const rowValid = rowNum >= 1 && rowNum <= TOTAL_ROWS;
        const seqValid = seqNum >= 1 && seqNum <= CARDS_PER_ROW;

        if (rowValid && seqValid) {
            const slotIndex = (rowNum - 1) * CARDS_PER_ROW + (seqNum - 1);
            if (slots[slotIndex] === null) {
                slots[slotIndex] = item;
                return;
            }
        }
        // Fallback
        const fallbackIndex = slots.findIndex(s => s === null);
        if (fallbackIndex >= 0) slots[fallbackIndex] = item;
    });

    for (let row = 0; row < TOTAL_ROWS; row++) {
        const rowDiv = document.createElement('div');
        rowDiv.className = 'card-row';

        for (let col = 0; col < CARDS_PER_ROW; col++) {
            const slotIndex = row * CARDS_PER_ROW + col;
            const item = slots[slotIndex];
            const card = createToolCard(item);
            rowDiv.appendChild(card);
        }
        container.appendChild(rowDiv);
    }
}

function createToolCard(item) {
    const card = document.createElement('div');
    card.className = 'tool-card';

    if (item) {
        // 供搜索跳转后精确定位卡片
        card.dataset.uid = item.uniqueIdentifier || '';
        card.dataset.row = item.rowNumber || '';
        card.dataset.seq = item.sequenceNumber || '';

        const total = getStockFromCache(item.uniqueIdentifier);
        const curState = item.curState || { newCount: 0, oldCount: 0 };
        const alarm = isItemAlarm(item);

        if (alarm) card.classList.add('alarm');

        card.innerHTML = `
            <div class="card-top">
                <span class="card-code">${item.uniqueIdentifier || ''}</span>
                <span class="card-count">| ${item.sequenceNumber} |</span>
            </div>
            <div class="card-name-border">
                <span class="card-name">${item.materialName || ''}</span>
            </div>
            <div class="card-main">
                <span class="card-main-number" title="当前总库存">${total}</span>
            </div>
            <div class="card-sub-row">
                <span class="card-sub1" title="安全库存">安全 | ${item.safetyStock != null ? item.safetyStock : ''}</span>
                <span class="card-sub2" title="下一次采购量">采购 | ${item.nextPurchaseQuantity != null ? item.nextPurchaseQuantity : ''}</span>
            </div>
            <div class="card-bottom-row">
                <span class="card-old">旧 | ${curState.oldCount || 0}</span>
                <span class="card-new">新 | ${curState.newCount || 0}</span>
            </div>
        `;

        card.onclick = () => cardSelected(card, item);
    } else {
        card.innerHTML = `
            <div class="card-top"><span class="card-code"></span><span class="card-count"></span></div>
            <div class="card-name-border"><span class="card-name"></span></div>
            <div class="card-main"><span class="card-main-number"></span></div>
            <div class="card-sub-row"><span class="card-sub1"></span><span class="card-sub2"></span></div>
            <div class="card-bottom-row"><span class="card-old"></span><span class="card-new"></span></div>
        `;
        card.style.borderColor = '#C0C0C0';
    }

    return card;
}

function cardSelected(cardEl, item) {
    // Deselect previous (matches WPF Card_CardSelected)
    if (selectedCard && selectedCard !== cardEl) {
        selectedCard.classList.remove('selected');
    }

    selectedCard = cardEl;
    selectedCardItem = item;
    cardEl.classList.add('selected');

    // Update right panel (matches WPF SetCardCurInfo + SetInventory)
    document.getElementById('txtToolName').value = item.materialName || '';

    const curState = item.curState || { newCount: 0, oldCount: 0 };
    currentCurState = curState;
    fallbackInventory = curState.newCount + curState.oldCount;

    isNewSelected = true;
    updateNewOldUI();
    updateDisplayedInventory();

    document.getElementById('txtChangedInventory').textContent = '0';
    currentInput = '';
}

function loadToolStocks(cabinet, selectedDrawer) {
    if (!selectedDrawer || !excelData.length) {
        document.getElementById('txtToolName').value = '刀具名称';
        document.getElementById('txtInventory').textContent = '0';
        document.getElementById('txtChangedInventory').textContent = '0';
        document.getElementById('txtOldInventory').textContent = '0';
        return;
    }

    updateAllDrawerLightStates();

    // Auto-select first tool in drawer (matches WPF LoadToolStocks behavior)
    const firstItem = excelData
        .filter(x => x.cabinetNumber === cabinet.number && x.drawerNumber === selectedDrawer.index)
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber)[0];

    if (firstItem) {
        document.getElementById('txtToolName').value = firstItem.materialName || '';
        isNewSelected = true;
        updateNewOldUI();

        const curState = firstItem.curState || { newCount: 0, oldCount: 0 };
        document.getElementById('txtInventory').textContent = curState.newCount.toString();
        document.getElementById('txtOldInventory').textContent = curState.oldCount.toString();
        document.getElementById('txtChangedInventory').textContent = '0';
        currentInput = '';
        currentCurState = curState;
    } else {
        document.getElementById('txtToolName').value = '刀具名称';
        document.getElementById('txtInventory').textContent = '0';
        document.getElementById('txtOldInventory').textContent = '0';
        document.getElementById('txtChangedInventory').textContent = '0';
        currentInput = '';
        currentCurState = null;
    }
}

// ===== Inventory Operations =====
// 操作进行中禁止重复触发：双击/连点会导致同一笔被提交两次（偶发多扣账的根因）
let inventoryOpBusy = false;

async function plusClick() {
    if (inventoryOpBusy) return;
    if (!personName) {
        showMessage('无人员信息，不能操作！');
        return;
    }
    if (!selectedCard || !selectedCardItem) return;
    if (!selectedCardItem.uniqueIdentifier) {
        showMessage('当前卡片没有唯一识别号，无法变更库存。');
        return;
    }

    const delta = parseInt(currentInput) || 0;
    if (delta <= 0) {
        showMessage('请输入大于0的变更数量。');
        return;
    }

    inventoryOpBusy = true;
    try {
        const result = await dbService.updateInventory(
            selectedCardItem.uniqueIdentifier, isNewSelected, delta, personName, selectedCardItem.materialName
        );

        stockLookup[selectedCardItem.uniqueIdentifier] = result.newCount + result.oldCount;
        updateModelCurState(selectedCardItem.uniqueIdentifier, result.newCount, result.oldCount);
        refreshAfterUpdate(result.newCount, result.oldCount);
    } catch (ex) {
        showMessage('更新库存失败：' + ex.message);
    } finally {
        inventoryOpBusy = false;
    }
}

async function minusClick() {
    if (inventoryOpBusy) return;
    if (!personName) {
        showMessage('无人员信息，不能操作！');
        return;
    }
    if (!selectedCard || !selectedCardItem) return;
    if (!selectedCardItem.uniqueIdentifier) {
        showMessage('当前卡片没有唯一识别号，无法变更库存。');
        return;
    }

    // 扣账数量（数字键盘）与工单信息（含工单数量）相互独立、互不影响：
    //   只填扣账数量        -> 仅扣账出库
    //   只填工单信息        -> 仅登记工单（库存不变，写入一条 变化数量=0 的记录）
    //   两者都填            -> 扣账 + 绑定工单，存入同一条记录，导出在同一表格
    const delta = parseInt(currentInput) || 0;
    const orderMeta = {
        orderNo: document.getElementById('txtOrderNo').value.trim(),
        orderMaterial: document.getElementById('txtOrderMaterial').value.trim(),
        orderTexture: document.getElementById('txtOrderTexture').value.trim(),
        orderQty: parseFloat(document.getElementById('txtOrderQty').value) || ''
    };
    const hasOrderInfo = !!(orderMeta.orderNo || orderMeta.orderMaterial || orderMeta.orderTexture || orderMeta.orderQty !== '');

    if (delta <= 0 && !hasOrderInfo) {
        showMessage('请输入大于0的扣账数量；只登记工单时，请填写工单信息。');
        return;
    }

    inventoryOpBusy = true;
    try {
        if (delta > 0) {
            const stock = await dbService.getNewOldStock(selectedCardItem.uniqueIdentifier);
            if (isNewSelected) {
                if (stock.newCount < delta) {
                    showMessage(`新品库存不足：当前新品 ${stock.newCount}，无法出库 ${delta}。`);
                    return;
                }
            } else {
                if (stock.oldCount < delta) {
                    showMessage(`旧品库存不足：当前旧品 ${stock.oldCount}，无法出库 ${delta}。`);
                    return;
                }
            }
        }

        const result = await dbService.updateInventory(
            selectedCardItem.uniqueIdentifier, isNewSelected, -delta, personName, selectedCardItem.materialName, orderMeta
        );

        stockLookup[selectedCardItem.uniqueIdentifier] = result.newCount + result.oldCount;
        updateModelCurState(selectedCardItem.uniqueIdentifier, result.newCount, result.oldCount);
        refreshAfterUpdate(result.newCount, result.oldCount);

        if (delta === 0) showMessage('工单信息已登记（未扣减库存）。');
        // 工单号/物料号等信息提交后保留不清空：同一工单常需重复领用，不需要时手工删除
    } catch (ex) {
        showMessage('更新库存失败：' + ex.message);
    } finally {
        inventoryOpBusy = false;
    }
}

function updateModelCurState(uniqueIdentifier, newCount, oldCount) {
    excelData.forEach(item => {
        if (item.uniqueIdentifier && item.uniqueIdentifier.toLowerCase() === uniqueIdentifier.toLowerCase()) {
            if (!item.curState) item.curState = {};
            item.curState.newCount = newCount;
            item.curState.oldCount = oldCount;
        }
    });
}

function refreshAfterUpdate(afterNew, afterOld) {
    // Update state and right panel (matches WPF RefreshCardAndRightPanel)
    currentCurState = { newCount: afterNew, oldCount: afterOld };
    fallbackInventory = afterNew + afterOld;
    currentInput = '';
    document.getElementById('txtChangedInventory').textContent = '0';
    updateDisplayedInventory();

    // Refresh card display
    if (selectedCard && selectedCardItem) {
        const total = afterNew + afterOld;
        const mainNum = selectedCard.querySelector('.card-main-number');
        if (mainNum) mainNum.textContent = total;
        const oldVal = selectedCard.querySelector('.card-old');
        if (oldVal) oldVal.textContent = `旧 | ${afterOld}`;
        const newVal = selectedCard.querySelector('.card-new');
        if (newVal) newVal.textContent = `新 | ${afterNew}`;

        // Update alarm state
        stockLookup[selectedCardItem.uniqueIdentifier] = total;
        const alarm = isItemAlarm(selectedCardItem);
        if (alarm) {
            selectedCard.classList.add('alarm');
        } else {
            selectedCard.classList.remove('alarm');
        }
    }

    updateAllDrawerLightStates();

    // Re-render detail cabinet preview
    const cabinet = cabinets[currentCabinetIndex];
    if (cabinet) {
        renderDetailView(cabinet);
    }

    // Re-render main view (for when we go back)
    renderMainView();
}

// ===== Number Pad =====
function numClick(val) {
    if (currentInput.length < 5) {
        currentInput += val;
        document.getElementById('txtChangedInventory').textContent = currentInput || '0';
    }
}

function backspaceClick() {
    if (currentInput.length > 0) {
        currentInput = currentInput.slice(0, -1);
        document.getElementById('txtChangedInventory').textContent = currentInput || '0';
    }
}

// ===== New/Old Selection =====
function selectNewOld(isNew) {
    isNewSelected = isNew;
    updateNewOldUI();
    updateDisplayedInventory();
}

function updateDisplayedInventory() {
    // Matches WPF InventoryInputControl.UpdateDisplayedInventory
    if (currentCurState) {
        document.getElementById('txtInventory').textContent = currentCurState.newCount.toString();
        document.getElementById('txtOldInventory').textContent = currentCurState.oldCount.toString();
    } else {
        document.getElementById('txtInventory').textContent = fallbackInventory.toString();
        document.getElementById('txtOldInventory').textContent = '0';
    }
}

function updateNewOldUI() {
    const rbNew = document.getElementById('rbNew');
    const rbOld = document.getElementById('rbOld');
    if (isNewSelected) {
        rbNew.classList.add('selected');
        rbOld.classList.remove('selected');
    } else {
        rbNew.classList.remove('selected');
        rbOld.classList.add('selected');
    }
}

// ===== Person ID Input =====
function personIdNumClick(num) {
    if (personIdInput.length < 10) {
        personIdInput += num;
        personName = personIdInput;
        document.getElementById('txtPerson').value = personName;
    }
}

function personIdDeleteClick() {
    if (personIdInput.length > 0) {
        personIdInput = personIdInput.slice(0, -1);
        personName = personIdInput;
        document.getElementById('txtPerson').value = personName;
    } else if (personName) {
        personName = '';
        document.getElementById('txtPerson').value = '';
    }
}

async function personIdConfirmClick() {
    if (!personIdInput) return;
    const inputId = personIdInput;
    personIdInput = '';

    const person = await verifyUser(inputId);
    if (person) {
        personName = `${person.personName}@${person.personId}`;
        document.getElementById('txtPerson').value = personName;
        resetPersonIdTimer();
    } else {
        showMessage(`未找到ID为 ${inputId} 的人员。`);
    }
}

// ===== SAP 查询进度遮罩（RFC 逐条查询耗时较长，导出时给用户反馈）=====
function showSapLoading(text) {
    let el = document.getElementById('sapLoadingOverlay');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sapLoadingOverlay';
        el.className = 'msg-overlay';
        el.innerHTML = '<div class="msg-box"><p id="sapLoadingText"></p></div>';
        document.body.appendChild(el);
    }
    el.querySelector('#sapLoadingText').textContent = text || '正在查询SAP，请稍候…';
    el.style.display = 'flex';
}

function hideSapLoading() {
    const el = document.getElementById('sapLoadingOverlay');
    if (el) el.style.display = 'none';
}

// ===== Export Functions =====
// 一次请求拉取全部库存，返回小写ID索引的映射
async function fetchAllStockMap() {
    const allStates = await dbService.getAllInventoryStates();
    const map = {};
    allStates.forEach(s => {
        if (s.uniqueIdentifier) map[s.uniqueIdentifier.toLowerCase()] = s;
    });
    return map;
}

async function exportCurrentStock() {
    try {
        const uniqueIds = [...new Set(excelData.filter(x => x.uniqueIdentifier).map(x => x.uniqueIdentifier))];
        const stockMap = await fetchAllStockMap();
        const rows = [];

        for (const id of uniqueIds) {
            const stock = stockMap[id.toLowerCase()] || { newCount: 0, oldCount: 0 };
            const total = stock.newCount + stock.oldCount;
            const firstRow = excelData.find(x => x.uniqueIdentifier === id && (x.materialName || x.safetyStock != null));
            const materialName = firstRow ? firstRow.materialName : '';
            const safetyItem = excelData.find(x => x.uniqueIdentifier === id && x.safetyStock != null);
            const sapItem = excelData.find(x => x.uniqueIdentifier === id && x.sapNumber);
            const priceItem = excelData.find(x => x.uniqueIdentifier === id && x.unitPrice != null);
            const brandItem = excelData.find(x => x.uniqueIdentifier === id && x.toolBrand);

            rows.push({
                '唯一ID': id,
                '物料名称': materialName || '',
                'SAP号': sapItem ? sapItem.sapNumber : '',
                '单价': priceItem ? priceItem.unitPrice : '',
                '刀具品牌': brandItem ? brandItem.toolBrand : '',
                '当前库存总数量': total,
                '新库存数量': stock.newCount,
                '旧库存数量': stock.oldCount,
                '安全库存数量': safetyItem ? safetyItem.safetyStock : ''
            });
        }

        if (downloadExcel(rows, `当前库存${formatDate()}.xlsx`)) showMessage('导出成功。');
    } catch (ex) {
        showMessage('导出失败：' + ex.message);
    }
}

// ===== 导出日期范围选择（起留空=不限，止默认当天）=====
let pendingExportType = null;

function localToday() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function openDateDialog(type) {
    pendingExportType = type;
    document.getElementById('dateTitle').textContent =
        type === 'history' ? '生成出入库记录：选择日期范围' : '新刀具出入记录：选择日期范围';
    document.getElementById('dateStart').value = '';
    document.getElementById('dateEnd').value = localToday(); // 止日期默认当天
    document.getElementById('dateOverlay').style.display = 'flex';
}

function dateDialogCancel() {
    pendingExportType = null;
    document.getElementById('dateOverlay').style.display = 'none';
}

async function dateDialogConfirm() {
    const start = document.getElementById('dateStart').value;
    const end = document.getElementById('dateEnd').value;
    if (start && end && start > end) {
        showMessage('起始日期不能晚于截止日期。');
        return;
    }
    const type = pendingExportType;
    dateDialogCancel();
    if (type === 'history') await doExportHistory(start, end);
    else if (type === 'newtool') await doExportNewToolInOut(start, end);
}

// 历史时间格式 'yyyy-MM-dd HH:mm:ss'，取前10位按日期比较
function inDateRange(ts, start, end) {
    const d = (ts || '').substring(0, 10);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
}

function rangeSuffix(start, end) {
    if (!start && !end) return formatDate();
    return `_${start || '最早'}至${end || '今天'}`;
}

function exportHistory() { openDateDialog('history'); }

async function doExportHistory(start, end) {
    try {
        // 读取工单4参数作为筛选条件（都为空则导出全部，保持原行为）
        const fNo = document.getElementById('txtOrderNo').value.trim();
        const fMat = document.getElementById('txtOrderMaterial').value.trim();
        const fTex = document.getElementById('txtOrderTexture').value.trim();
        const fQtyRaw = document.getElementById('txtOrderQty').value.trim();
        const fQty = (fQtyRaw !== '' && !isNaN(parseFloat(fQtyRaw))) ? parseFloat(fQtyRaw) : null;
        const hasFilter = !!(fNo || fMat || fTex || fQty !== null);

        let histories = await dbService.getAllInventoryHistory();
        histories = histories.filter(h => inDateRange(h.timestamp, start, end));
        if (!histories.length) {
            showMessage('所选日期范围内没有出入库记录。');
            return;
        }
        if (hasFilter) {
            histories = histories.filter(h => {
                // 工单号、数量：精确匹配；物料名称、材质：包含匹配（不区分大小写）
                if (fNo && (h.orderNo || '').toLowerCase() !== fNo.toLowerCase()) return false;
                if (fMat && !(h.orderMaterial || '').toLowerCase().includes(fMat.toLowerCase())) return false;
                if (fTex && !(h.orderTexture || '').toLowerCase().includes(fTex.toLowerCase())) return false;
                if (fQty !== null) {
                    const hq = parseFloat(h.orderQty);
                    if (isNaN(hq) || hq !== fQty) return false;
                }
                return true;
            });
            if (!histories.length) {
                showMessage('没有符合工单条件的出入库记录。');
                return;
            }
        }
        // SAP 工单信息（RFC → Z_OA_GET_ORDERMAT_ORDERNR）：GAMNG=工单数量、MAKTX=产品图号
        // 接口为单工单逐条查询（约0.3~0.5s/条），分批 50 个/次并显示进度；
        // RFC 不可用时不阻塞导出（对应两列留空，提示中带说明）
        let orderInfoMap = {};
        let rfcFailed = false;
        const orderNos = [...new Set(histories.map(h => (h.orderNo || '').trim()).filter(no => /^\d{1,12}$/.test(no)))];
        if (orderNos.length) {
            const SAP_BATCH = 50;
            showSapLoading(`正在查询SAP工单信息（0/${orderNos.length}），请稍候…`);
            try {
                for (let i = 0; i < orderNos.length; i += SAP_BATCH) {
                    const sapRows = await dbService.queryOrderMaterial(orderNos.slice(i, i + SAP_BATCH));
                    sapRows.forEach(r => {
                        if (r && r.FOUND === 'X') orderInfoMap[String(parseInt(r.AUFNR, 10))] = r;
                    });
                    showSapLoading(`正在查询SAP工单信息（${Math.min(i + SAP_BATCH, orderNos.length)}/${orderNos.length}），请稍候…`);
                }
            } catch (e) {
                rfcFailed = true;
                console.warn('SAP 工单信息获取失败（导出继续，工单数量/产品图号为空）:', e);
            } finally {
                hideSapLoading();
            }
        }

        const rows = histories.map(h => {
            const type = (h.isNew ? '新品' : '旧品') + (h.delta > 0 ? ' 入库' : (h.delta < 0 ? ' 出库' : ' 工单登记'));
            const sapItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.sapNumber);
            const priceItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.unitPrice != null);
            const brandItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.toolBrand);
            const orderNoTrim = (h.orderNo || '').trim();
            const sapOrder = /^\d{1,12}$/.test(orderNoTrim) ? orderInfoMap[String(parseInt(orderNoTrim, 10))] : null;
            const orderQtyNum = parseFloat(h.orderQty);
            const unitPriceNum = priceItem ? parseFloat(priceItem.unitPrice) : NaN;
            return {
                '唯一ID': h.uniqueIdentifier || '',
                '物料名称': h.materialName || '',
                'SAP号': sapItem ? sapItem.sapNumber : '',
                '单价': priceItem ? priceItem.unitPrice : '',
                '刀具品牌': brandItem ? brandItem.toolBrand : '',
                '出入库类型': type,
                '变化数量': h.delta,
                '工单号': h.orderNo || '',
                '工单物料名称': h.orderMaterial || '',
                '材质': h.orderTexture || '',
                '数量': h.orderQty != null ? h.orderQty : '',
                '时间': h.timestamp,
                '人员': h.person || '',
                '工单数量': sapOrder ? sapOrder.GAMNG : '',
                '产品图号': sapOrder ? (sapOrder.MAKTX || '') : '',
                '单价汇总': (!isNaN(orderQtyNum) && !isNaN(unitPriceNum)) ? Math.round(orderQtyNum * unitPriceNum * 100) / 100 : ''
            };
        });

        const fileSuffix = fNo ? `_工单${fNo}` : '';
        if (downloadExcel(rows, `出入库记录${fileSuffix}${rangeSuffix(start, end)}.xlsx`)) {
            let msg = hasFilter ? `导出成功，共 ${rows.length} 条符合工单条件的记录。` : '导出成功。';
            if (rfcFailed) msg += '（SAP工单信息获取失败，工单数量/产品图号两列为空）';
            showMessage(msg);
        }
    } catch (ex) {
        showMessage('导出失败：' + ex.message);
    }
}

async function exportBelowSafety() {
    try {
        const itemsWithSafety = [];
        const seen = new Set();
        excelData.forEach(x => {
            if (x.uniqueIdentifier && x.safetyStock != null && !seen.has(x.uniqueIdentifier.toLowerCase())) {
                seen.add(x.uniqueIdentifier.toLowerCase());
                itemsWithSafety.push(x);
            }
        });

        const stockMap = await fetchAllStockMap();
        const rows = [];
        for (const item of itemsWithSafety) {
            const stock = stockMap[item.uniqueIdentifier.toLowerCase()] || { newCount: 0, oldCount: 0 };
            const total = stock.newCount + stock.oldCount;
            if (total <= item.safetyStock) {
                const sapItem = excelData.find(x => x.uniqueIdentifier === item.uniqueIdentifier && x.sapNumber);
                const priceItem = excelData.find(x => x.uniqueIdentifier === item.uniqueIdentifier && x.unitPrice != null);
                const brandItem = excelData.find(x => x.uniqueIdentifier === item.uniqueIdentifier && x.toolBrand);
                rows.push({
                    '唯一ID': item.uniqueIdentifier,
                    '物料名称': item.materialName || '',
                    'SAP号': sapItem ? sapItem.sapNumber : '',
                    '单价': priceItem ? priceItem.unitPrice : '',
                    '刀具品牌': brandItem ? brandItem.toolBrand : '',
                    '当前库存总数量': total,
                    '新库存数量': stock.newCount,
                    '旧库存数量': stock.oldCount,
                    '安全库存数量': item.safetyStock,
                    '下次采购量': item.nextPurchaseQuantity || ''
                });
            }
        }

        if (downloadExcel(rows, `低于安全库存记录${formatDate()}.xlsx`)) showMessage('导出成功。');
    } catch (ex) {
        showMessage('导出失败：' + ex.message);
    }
}

function exportNewToolInOut() { openDateDialog('newtool'); }

async function doExportNewToolInOut(start, end) {
    try {
        const histories = await dbService.getAllInventoryHistory();
        const newToolRecords = histories.filter(h => h.isNew && inDateRange(h.timestamp, start, end));
        if (!newToolRecords.length) {
            showMessage('所选日期范围内没有新刀具出入记录。');
            return;
        }

        // Group by date + uniqueIdentifier
        const groups = {};
        newToolRecords.forEach(h => {
            const date = h.timestamp ? h.timestamp.substring(0, 10) : '';
            const key = `${date}|${h.uniqueIdentifier}`;
            if (!groups[key]) {
                groups[key] = { date, uniqueIdentifier: h.uniqueIdentifier, records: [] };
            }
            groups[key].records.push(h);
        });

        const rows = [];
        Object.values(groups).sort((a, b) => a.date.localeCompare(b.date) || a.uniqueIdentifier.localeCompare(b.uniqueIdentifier))
            .forEach(g => {
                const inQty = g.records.filter(h => h.delta > 0).reduce((s, h) => s + h.delta, 0);
                const outQty = g.records.filter(h => h.delta < 0).reduce((s, h) => s + Math.abs(h.delta), 0);
                const matName = (g.records.find(h => h.materialName) || {}).materialName || '';
                const sapItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (g.uniqueIdentifier || '').toLowerCase() && x.sapNumber);
                const priceItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (g.uniqueIdentifier || '').toLowerCase() && x.unitPrice != null);
                const brandItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (g.uniqueIdentifier || '').toLowerCase() && x.toolBrand);
                rows.push({
                    '日期': g.date,
                    '唯一ID': g.uniqueIdentifier || '',
                    '物料名称': matName,
                    'SAP号': sapItem ? sapItem.sapNumber : '',
                    '单价': priceItem ? priceItem.unitPrice : '',
                    '刀具品牌': brandItem ? brandItem.toolBrand : '',
                    '新刀具入库数量': inQty,
                    '新刀具出库数量': outQty
                });
            });

        if (downloadExcel(rows, `新刀具出入记录${rangeSuffix(start, end)}.xlsx`)) showMessage('导出成功。');
    } catch (ex) {
        showMessage('导出失败：' + ex.message);
    }
}

function generateOAPurchase() {
    showMessage('OA采购请求功能暂未实现。');
}

// ===== Utility Functions =====
function downloadExcel(data, filename) {
    if (typeof XLSX === 'undefined') {
        throw new Error('XLSX 库未加载（xlsx.full.min.js 未部署或加载失败）');
    }
    if (!data || !data.length) {
        showMessage('没有数据可导出。');
        return false;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename);
    return true;
}

function formatDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
}

function showMessage(msg) {
    const overlay = document.createElement('div');
    overlay.className = 'msg-overlay';
    overlay.innerHTML = `
        <div class="msg-box">
            <p>${msg}</p>
            <button onclick="this.closest('.msg-overlay').remove()">确定</button>
        </div>
    `;
    document.body.appendChild(overlay);
}
