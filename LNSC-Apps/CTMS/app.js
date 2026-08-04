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
let dbHasData = false;

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', async () => {
    // Safety: always hide loading after 5 seconds no matter what
    setTimeout(hideLoading, 5000);

    try {
        try { dbHasData = (await dbService.getAllInventoryStates()).length > 0; } catch (e) { }
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
async function loadExcelData() {
    try {
        const response = await fetch('车间工具库存管理-信息表.xlsx');
        if (!response.ok) {
            console.warn('Excel file not found, using empty data');
            return;
        }
        const arrayBuffer = await response.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        excelData = [];
        const sheetNames = workbook.SheetNames;

        for (let sheetIndex = 0; sheetIndex < Math.min(5, sheetNames.length); sheetIndex++) {
            const sheet = workbook.Sheets[sheetNames[sheetIndex]];
            const rows = XLSX.utils.sheet_to_json(sheet);

            rows.forEach(row => {
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
                    curState: null
                };
                if (item.drawerNumber > 0) {
                    excelData.push(item);
                }
            });
        }

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

        // Excel M/N column initialization (matches WPF ReadExcelInfoAsync init logic)
        // Skipped if DB already has data (e.g. imported from toolinventory.db)
        try {
            if (dbHasData) throw { skip: true };
            const initMap = {};
            for (let sheetIndex = 0; sheetIndex < Math.min(5, sheetNames.length); sheetIndex++) {
                const sheet = workbook.Sheets[sheetNames[sheetIndex]];
                const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
                if (!rawRows || rawRows.length < 2) continue;

                // Find column indices containing "M" and "N" headers for new/old stock
                const headerRow = rawRows[0] || [];
                const mColIdx = headerRow.findIndex(h => h && h.toString().includes('M'));
                const nColIdx = headerRow.findIndex(h => h && h.toString().includes('N'));

                if (mColIdx < 0 && nColIdx < 0) continue;

                for (let r = 1; r < rawRows.length; r++) {
                    const row = rawRows[r];
                    if (!row) continue;

                    // Find the uniqueIdentifier in this row
                    let foundId = null;
                    for (let c = 0; c < row.length; c++) {
                        if (row[c] == null) continue;
                        const s = row[c].toString().trim();
                        if (uniqueIds.some(uid => uid.toLowerCase() === s.toLowerCase())) {
                            foundId = s;
                            break;
                        }
                    }
                    if (!foundId || initMap[foundId.toLowerCase()]) continue;

                    let newVal = null, oldVal = null;
                    if (mColIdx >= 0 && row[mColIdx] != null) {
                        const nv = parseInt(row[mColIdx]);
                        if (!isNaN(nv)) newVal = nv;
                    }
                    if (nColIdx >= 0 && row[nColIdx] != null) {
                        const ov = parseInt(row[nColIdx]);
                        if (!isNaN(ov)) oldVal = ov;
                    }

                    if (newVal != null || oldVal != null) {
                        initMap[foundId.toLowerCase()] = { id: foundId, newInit: newVal, oldInit: oldVal };
                    }
                }
            }

            // Reset DB for items with init values from Excel
            for (const key of Object.keys(initMap)) {
                const entry = initMap[key];
                const matName = (excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === key && x.materialName) || {}).materialName || '';
                await dbService.resetInventory(entry.id, entry.newInit || 0, entry.oldInit || 0, '初始化', matName);
                stockLookup[entry.id] = (entry.newInit || 0) + (entry.oldInit || 0);
            }
        } catch (e) {
            if (!e || !e.skip) console.warn('Excel init columns (M/N) processing failed:', e);
        }

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
async function plusClick() {
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

    try {
        const result = await dbService.updateInventory(
            selectedCardItem.uniqueIdentifier, isNewSelected, delta, personName, selectedCardItem.materialName
        );

        stockLookup[selectedCardItem.uniqueIdentifier] = result.newCount + result.oldCount;
        updateModelCurState(selectedCardItem.uniqueIdentifier, result.newCount, result.oldCount);
        refreshAfterUpdate(result.newCount, result.oldCount);
    } catch (ex) {
        showMessage('更新库存失败：' + ex.message);
    }
}

async function minusClick() {
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

    const orderMeta = {
        orderNo: document.getElementById('txtOrderNo').value.trim(),
        orderMaterial: document.getElementById('txtOrderMaterial').value.trim(),
        orderTexture: document.getElementById('txtOrderTexture').value.trim(),
        orderQty: parseFloat(document.getElementById('txtOrderQty').value) || ''
    };

    try {
        const result = await dbService.updateInventory(
            selectedCardItem.uniqueIdentifier, isNewSelected, -delta, personName, selectedCardItem.materialName, orderMeta
        );

        stockLookup[selectedCardItem.uniqueIdentifier] = result.newCount + result.oldCount;
        updateModelCurState(selectedCardItem.uniqueIdentifier, result.newCount, result.oldCount);
        refreshAfterUpdate(result.newCount, result.oldCount);

        document.getElementById('txtOrderNo').value = '';
        document.getElementById('txtOrderMaterial').value = '';
        document.getElementById('txtOrderTexture').value = '';
        document.getElementById('txtOrderQty').value = '';
    } catch (ex) {
        showMessage('更新库存失败：' + ex.message);
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

async function exportHistory() {
    try {
        const histories = await dbService.getAllInventoryHistory();
        const rows = histories.map(h => {
            const type = (h.isNew ? '新品' : '旧品') + (h.delta > 0 ? ' 入库' : ' 出库');
            const sapItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.sapNumber);
            const priceItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.unitPrice != null);
            const brandItem = excelData.find(x => x.uniqueIdentifier && x.uniqueIdentifier.toLowerCase() === (h.uniqueIdentifier || '').toLowerCase() && x.toolBrand);
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
                '人员': h.person || ''
            };
        });

        if (downloadExcel(rows, `出入库记录${formatDate()}.xlsx`)) showMessage('导出成功。');
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

async function exportNewToolInOut() {
    try {
        const histories = await dbService.getAllInventoryHistory();
        const newToolRecords = histories.filter(h => h.isNew);

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

        if (downloadExcel(rows, `新刀具出入记录${formatDate()}.xlsx`)) showMessage('导出成功。');
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
