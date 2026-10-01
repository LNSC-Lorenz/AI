/* ============================================================
 * LNSC 全链发货平台 - 录单模式：地址智能识别
 * 纯前端实现：粘贴地址 -> 识别解析 -> 确认写入发货清单
 * ============================================================ */
"use strict";

/* ===== 省/市数据：由 region.js 的 REGION_DATA（含区县）派生 ===== */
const CITY_MAP = {};
for (const _p of Object.keys(REGION_DATA)) CITY_MAP[_p] = Object.keys(REGION_DATA[_p]);

const PROVINCES = Object.keys(CITY_MAP);

/* ===== 名称别名：去掉民族/行政后缀，用于模糊匹配（如 "苏州市"->"苏州"，"阿坝藏族羌族自治州"->"阿坝"） ===== */
function aliasOf(name) {
  return name
    .replace(/(柯尔克孜|达斡尔|鄂伦春|鄂温克|哈萨克|塔吉克|土家|傈僳|维吾尔|蒙古|藏|羌|彝|苗|布依|侗|傣|哈尼|壮|回|朝鲜|白|景颇|土|满|瑶|裕固|保安|东乡|撒拉|锡伯|独龙|怒|仫佬|毛南|仡佬|黎|佤|畲|拉祜|水|纳西)族/g, "")
    .replace(/(特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|自治州|自治县|自治旗|省|市|地区|盟)$/, "");
}

/* ===== 区县列表：按省市取区县；直辖市（市辖区/县）自动合并 ===== */
function districtList(prov, city) {
  const pd = REGION_DATA[prov];
  if (!pd) return [];
  if (pd[city]) return pd[city];
  const keys = Object.keys(pd);
  if (keys.length && keys.every(k => k === "市辖区" || k === "县")) {
    return keys.flatMap(k => pd[k]);
  }
  return [];
}

/* ===== 地址解析引擎（纯函数，可独立测试） ===== */
function parseAddress(raw) {
  const res = { province: "", city: "", district: "", street: "", name: "", phone: "" };
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return res;

  /* 1. 手机号 */
  const mPhone = text.match(/1[3-9]\d{9}/);
  if (mPhone) res.phone = mPhone[0];

  /* 2. 姓名：优先取手机号前面的中文姓名，否则取首个独立中文短词 */
  const NAME_BAD = /(省|市|区|县|镇|乡|路|街|道|号|村|公司|有限|大厦|园区)/;
  if (res.phone) {
    const before = text.slice(0, text.indexOf(res.phone)).trim();
    const mName = before.match(/([\u4e00-\u9fa5]{2,4})[，,、\s]*$/);
    if (mName && !NAME_BAD.test(mName[1])) res.name = mName[1];
  }
  if (!res.name) {
    for (const t of text.split(/[\s,，、;；:：]+/)) {
      if (/^[\u4e00-\u9fa5]{2,4}$/.test(t) && !NAME_BAD.test(t)) { res.name = t; break; }
    }
  }

  /* 工作文本：剔除电话与姓名后逐级剥离省/市/区 */
  let work = text;
  if (res.phone) work = work.replace(res.phone, " ");
  if (res.name) work = work.replace(res.name, " ");

  /* 3. 省：取最长命中（避免 "海南" 抢先于 "青海省" 等误判） */
  let prov = "", provHit = "", provLen = 0;
  for (const p of PROVINCES) {
    for (const cand of [p, aliasOf(p)]) {
      if (cand && work.includes(cand) && cand.length > provLen) {
        prov = p; provHit = cand; provLen = cand.length;
      }
    }
  }
  if (prov) { res.province = prov; work = work.replace(provHit, " "); }

  /* 4. 市：在已识别的省内找；未识别到省时全国反查（取最长命中） */
  function findCity(scope) {
    let hit = null;
    for (const pv of scope) {
      for (const c of CITY_MAP[pv]) {
        for (const cand of [c, aliasOf(c)]) {
          if (cand && cand.length >= 2 && work.includes(cand) &&
              (!hit || cand.length > hit.str.length)) {
            hit = { city: c, prov: pv, str: cand };
          }
        }
      }
    }
    return hit;
  }
  const cityHit = prov ? findCity([prov]) : findCity(PROVINCES);
  if (cityHit) {
    res.city = cityHit.city;
    if (!res.province) res.province = cityHit.prov;
    work = work.replace(cityHit.str, " ");
  }
  /* 直辖市：市即省（数据集中城市名为"市辖区"/"县"） */
  if (!res.city && ["北京市", "天津市", "上海市", "重庆市"].includes(res.province)) {
    res.city = res.province;
  }

  /* 5. 区/县：优先按真实区县库最长匹配，未命中回退后缀正则 */
  const distList = districtList(res.province, res.city);
  let dHit = "", dName = "";
  for (const d of distList) {
    for (const cand of [d, aliasOf(d)]) {
      if (cand && cand.length >= 2 && work.includes(cand) && cand.length > dHit.length) {
        dHit = cand; dName = d;
      }
    }
  }
  if (dHit) {
    res.district = dName;
    work = work.replace(dHit, " ");
  } else {
    const mDist = work.match(/([\u4e00-\u9fa5]{2,9}?(?:市辖区|新区|林区|区|县|旗|市))/);
    if (mDist) { res.district = mDist[1]; work = work.replace(mDist[1], " "); }
  }

  /* 6. 街道与公司：剩余部分 */
  res.street = work.replace(/[\s,，、;；]+/g, " ").trim();
  return res;
}

/* ============================================================
 * 页面交互（仅在浏览器环境执行）
 * ============================================================ */
if (typeof document !== "undefined") {
  const pasteInput  = document.getElementById("pasteInput");
  const btnRecognize = document.getElementById("btnRecognize");
  const btnConfirm  = document.getElementById("btnConfirm");
  const selProvince = document.getElementById("selProvince");
  const selCity     = document.getElementById("selCity");
  const selDistrict = document.getElementById("selDistrict");
  const streetInput = document.getElementById("streetInput");
  const companyInput = document.getElementById("companyInput");   /* 公司独立字段（2026-09-17 拆分） */
  const noteInput   = document.getElementById("noteInput");
  const nameInput   = document.getElementById("nameInput");
  const phoneInput  = document.getElementById("phoneInput");
  const soInput     = document.getElementById("soInput");
  const dateInput   = document.getElementById("dateInput");
  const orderBody   = document.getElementById("orderBody");

  let parsed = { name: "", phone: "" }; /* 最近一次识别出的姓名/电话 */
  let priority = "一般";                 /* 优先级：紧急/一般 两态（2026-09-20 单按钮开关），默认一般 */

  /* 优先级：单个「紧急」开关（2026-09-20 用户规则）：按下=紧急，弹起=一般 */
  document.querySelectorAll(".prio").forEach(b => {
    b.addEventListener("click", () => {
      b.classList.toggle("active");
      priority = b.classList.contains("active") ? "紧急" : "一般";
    });
  });

  /* 下单类型单选 + 右侧盒内容切换（发货单=SO/DN / 外协单=采购员 / 其他=员工快递提示） */
  let orderType = "发货单";
  const MODE = { "发货单": "modeShip", "外协单": "modeOut", "其他": "modeOther" };
  function setType(t) {
    orderType = t;
    document.querySelectorAll(".otype").forEach(x =>
      x.classList.toggle("active", x.dataset.t === t));
    Object.entries(MODE).forEach(([k, id]) => {
      document.getElementById(id).hidden = (k !== t);
    });
    /* 上传文件：仅发货单可见；外协/其他 visibility 隐藏但保留占位 → 三视图高度一致 */
    const vis = (t === "发货单") ? "visible" : "hidden";
    document.getElementById("btnUpload").style.visibility = vis;
    upFileName.style.visibility = vis;
  }
  document.querySelectorAll(".otype").forEach(b => {
    b.addEventListener("click", () => setType(b.dataset.t));
  });

  /* 上传文件（仅发货单可见）：在线时上传到服务器 Upload/<DN>/ 目录；
   * 已传文件的行被选中时，虚线框显示「已上传 + 文件名」（文件名不入备注） */
  const upFileInput = document.getElementById("upFileInput");
  const upFileName = document.getElementById("upFileName");
  const btnUpload = document.getElementById("btnUpload");
  /* 删除服务器上该 DN 的某个上传文件，完成后刷新按钮状态（失败弹窗提示） */
  function removeUpload(fn) {
    const dn = soInput.value.trim();
    if (!dn || !apiOnline) return;
    fetch(`${API}/upload?dn=${encodeURIComponent(dn)}&name=${encodeURIComponent(fn)}`, { method: "DELETE" })
      .then(async r => {
        if (!r.ok) alert(`移除失败（${r.status}）：${fn}\n${(await r.text()).slice(0, 80)}\n\n提示：服务器 server.py 可能不是最新版`);
      })
      .catch(e => alert("移除接口不可达：" + e.message))
      .finally(() => refreshUploadState(dn));
  }
  /* 文件名后的 × 移除按钮（阻止冒泡，不触发再次上传） */
  function mkRemoveX(fn) {
    const x = document.createElement("b");
    x.className = "up-x";
    x.textContent = "×";
    x.title = "移除该文件";
    x.addEventListener("click", e => { e.stopPropagation(); removeUpload(fn); });
    return x;
  }
  function setUploadState(fileName, count, files) {
    btnUpload.classList.remove("done");
    btnUpload.textContent = "";
    clearInterval(btnUpload._rollT); btnUpload._rollT = null;   /* 清旧翻滚定时器 */
    if (!fileName) { btnUpload.textContent = "上传文件"; upFileName.textContent = ""; return; }
    btnUpload.classList.add("done");
    const s = document.createElement("span");
    s.textContent = count > 1 ? `已上传 ${count}个` : "已上传";   /* 多文件显示数量 */
    btnUpload.append(s);
    if (count > 1 && files && files.length) {
      /* 多文件：框高不变，文件名每 2.4s 上滚一行循环翻滚，当前行带 × 可删 */
      const roll = document.createElement("div"); roll.className = "up-roll";
      const inner = document.createElement("div"); inner.className = "up-roll-in";
      files.forEach(fn => {
        const d = document.createElement("div");
        const t = document.createElement("span");
        t.className = "up-fn";
        t.textContent = fn;
        d.append(t, mkRemoveX(fn));
        inner.appendChild(d);
      });
      roll.appendChild(inner);
      btnUpload.append(roll);
      let idx = 0;
      btnUpload._rollT = setInterval(() => {
        idx = (idx + 1) % files.length;
        inner.style.transform = `translateY(-${idx * 1.5}em)`;
      }, 2400);
    } else {
      const n = document.createElement("span"); n.className = "up-name"; n.textContent = fileName;
      btnUpload.append(n, mkRemoveX(fileName));   /* 单文件也带 × */
    }
    upFileName.textContent = "";
  }
  /* 按 DN 查询服务器已传文件并刷新按钮状态（仅在线且有 DN 时） */
  function refreshUploadState(dn) {
    setUploadState("");
    if (!dn || !apiOnline) return;
    fetch(`${API}/upload?dn=${encodeURIComponent(dn)}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.files && d.files.length && soInput.value.trim() === dn) {
          setUploadState(d.files[d.files.length - 1], d.files.length, d.files);   /* 最新 + 数量 + 全部文件名 */
        }
      })
      .catch(() => { /* 查询失败保持默认状态 */ });
  }
  /* 顶部搜索框：输入自动匹配共享地址池并下拉显示，点选一键回填
     （池子存服务端 SQLite，全用户共享；离线回退本地 localStorage 池） */
  const poolSearch = document.getElementById("poolSearch");
  const poolListEl = document.getElementById("poolSearchList");
  let poolCache = [];
  async function refreshPool() {
    if (apiOnline) {
      try {
        const r = await fetch(`${API}/addrpool`);
        if (r.ok) { poolCache = await r.json(); return; }   /* 服务端已按最新在前排序 */
      } catch (e) { /* 回退本地 */ }
    }
    try { poolCache = JSON.parse(localStorage.getItem("lnsc-addr-pool") || "[]").reverse(); }
    catch (e) { poolCache = []; }
  }
  poolSearch.addEventListener("focus", refreshPool);
  poolSearch.addEventListener("input", () => {
    const k = poolSearch.value.trim().toLowerCase();
    poolListEl.innerHTML = "";
    if (!k) { poolListEl.hidden = true; return; }
    const list = poolCache.filter(a =>
      [a.name, a.phone, a.province, a.city, a.district, a.street]
        .filter(Boolean).join(" ").toLowerCase().includes(k));
    if (!list.length) { poolListEl.hidden = true; return; }
    list.slice(0, 8).forEach(a => {   /* 最多显示 8 条，最新在顶 */
      const it = document.createElement("div");
      it.className = "ps-item";
      const b = document.createElement("b");
      b.textContent = (a.name || "--") + (a.phone ? "  " + a.phone : "");
      const s = document.createElement("span");
      s.textContent = [a.province, a.city, a.district, a.company, a.street].filter(Boolean).join(" ");
      it.append(b, s);
      it.addEventListener("mousedown", e => {   /* mousedown 先于 input blur */
        e.preventDefault();
        selProvince.value = a.province || "";
        fillCity(a.province || "", a.city || "");
        fillDistrict(a.province || "", a.city || "", a.district || "");
        streetInput.value = a.street || "";
        companyInput.value = a.company || "";   /* 公司独立字段回填（2026-09-17） */
        nameInput.value = a.name || "";
        phoneInput.value = a.phone || "";
        poolListEl.hidden = true;
        poolSearch.value = "";
      });
      poolListEl.appendChild(it);
    });
    poolListEl.hidden = false;
  });
  poolSearch.addEventListener("blur", () => { poolListEl.hidden = true; });

  btnUpload.addEventListener("click", () => {
    if (orderType === "发货单") {
      const dnsUp = soInput.value.match(/82600\d{5}/g) || [];
      if (!dnsUp.length) { alert("请先填写 DN，上传文件将存到 Upload/<DN>/ 目录"); soInput.focus(); return; }
      /* 防半截 DN 上传归错目录（2026-09-15 真实事故）；多 DN 时文件归到首个 DN 目录（2026-09-20） */
    }
    upFileInput.click();
  });
  /* 多文件同时上传：逐个 POST 到同一 DN 目录，全部完成后按服务器实际文件刷新按钮 */
  upFileInput.addEventListener("change", async () => {
    const files = [...upFileInput.files];
    upFileInput.value = "";                    /* 允许再次选择同一批文件 */
    if (!files.length) { upFileName.textContent = ""; return; }
    const dn = (soInput.value.match(/82600\d{5}/g) || [soInput.value.trim()])[0];   /* 多 DN 归首个（2026-09-20） */
    if (dn && apiOnline) {
      let ok = 0; const fail = [];
      for (const f of files) {
        try {
          const r = await fetch(`${API}/upload?dn=${encodeURIComponent(dn)}&name=${encodeURIComponent(f.name)}`,
            { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: f });
          if (r.ok) ok++;
          else { fail.push(f.name); console.warn("上传失败", f.name, await r.text()); }
        } catch (e) { fail.push(f.name); console.warn("上传接口不可达", f.name, e); }
      }
      if (fail.length) alert(`上传完成 ${ok} 个，失败 ${fail.length} 个：\n${fail.join("、")}`);
      refreshUploadState(dn);
      return;
    }
    upFileName.textContent = files.map(f => f.name).join("、");   /* 离线：仅提示文件名，不落盘、不入备注 */
  });

  /* ----- 下拉填充 ----- */
  function fillProvince() {
    selProvince.innerHTML = '<option value="">省</option>' +
      PROVINCES.map(p => `<option value="${p}">${p}</option>`).join("");
  }
  function fillCity(prov, selected) {
    let cities = prov && CITY_MAP[prov] ? CITY_MAP[prov] : [];
    /* 直辖市：数据集中为"市辖区"/"县"，界面统一显示为省名 */
    if (cities.length && cities.every(c => c === "市辖区" || c === "县")) cities = [prov];
    selCity.innerHTML = '<option value="">市</option>' +
      cities.map(c => `<option value="${c}">${c}</option>`).join("");
    if (selected) {
      if (![...selCity.options].some(o => o.value === selected)) {
        selCity.add(new Option(selected, selected));
      }
      selCity.value = selected;
    }
  }
  function fillDistrict(prov, city, selected) {
    selDistrict.innerHTML = '<option value="">区</option>' +
      districtList(prov, city).map(d => `<option value="${d}">${d}</option>`).join("");
    if (selected) {
      if (![...selDistrict.options].some(o => o.value === selected)) {
        selDistrict.add(new Option(selected, selected));
      }
      selDistrict.value = selected;
    }
  }

  /* 省手动切换 -> 市联动、区清空；市切换 -> 区联动 */
  selProvince.addEventListener("change", () => {
    fillCity(selProvince.value, "");
    fillDistrict("", "", "");
  });
  selCity.addEventListener("change", () => {
    fillDistrict(selProvince.value, selCity.value, "");
  });

  /* ----- 承运商单选 ----- */
  document.querySelectorAll(".carrier").forEach(btn => {
    btn.addEventListener("click", () => {
      const was = btn.classList.contains("active");
      document.querySelectorAll(".carrier").forEach(b => b.classList.remove("active"));
      if (!was) btn.classList.add("active");
    });
  });
  /* 承运商启用开关（设置页 localStorage lnsc-carriers）：关闭的承运商隐藏 */
  (function applyCarrierGate() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem("lnsc-carriers") || "{}"); } catch (e) {}
    document.querySelectorAll(".carrier").forEach(b => {
      if (cfg[b.dataset.carrier] === false) {
        b.style.display = "none";
        b.classList.remove("active");
      }
    });
  })();

  /* ----- DN：仅允许数字，最多 10 位（DN=10 位数字，用户规则 2026-09-15） ----- */
  soInput.addEventListener("input", () => {
    /* 多 DN 合并发货（2026-09-20 用户规则）：取消 10 位上限——
       允许数字+分隔符（空格/逗号/顿号/分号/斜杠），保存时按 82600+5位 逐个拆分 */
    soInput.value = soInput.value.replace(/[^\d\s,，、;；/]/g, "").slice(0, 200);
  });

  /* ----- 识别（文本） ----- */
  function recognizeText() {
    const raw = pasteInput.value.trim();
    if (!raw) { alert("请先粘贴地址文本"); return; }
    parsed = parseAddress(raw);
    if (parsed.province) selProvince.value = parsed.province;
    fillCity(parsed.province || selProvince.value, parsed.city);
    fillDistrict(selProvince.value, selCity.value, parsed.district);
    /* 街道/公司自动拆分（2026-09-17 拆分字段）：识别结果以公司后缀开头（公司/集团/研究院/
       事务所/服务中心）时，前段进公司框、余下进街道框；保守匹配防"厂路"类误拆 */
    const mC = (parsed.street || "").match(/^(.+?(?:公司|集团|研究院|事务所|服务中心))\s*[，,、]?\s*(.*)$/);
    if (mC) { companyInput.value = mC[1]; streetInput.value = mC[2]; }
    else { companyInput.value = ""; streetInput.value = parsed.street; }
    nameInput.value = parsed.name;
    phoneInput.value = parsed.phone;
  }
  btnRecognize.addEventListener("click", recognizeText);

  /* ----- 图片识别（OCR：截图 / 照片 → 文字 → 自动解析） ----- */
  const fileInput = document.getElementById("fileInput");
  const btnImage  = document.getElementById("btnImage");
  const pastePanel = document.querySelector(".paste-panel");
  let ocrBusy = false;

  async function ocrImage(file) {
    if (!file || ocrBusy) return;
    if (typeof Tesseract === "undefined") {
      alert("OCR 组件未加载：请确认 lib/tesseract.min.js 存在"); return;
    }
    /* 图片只识别不显示：大图会撑开页面，放弃缩略图预览（文字识别后直接填入） */
    /* file:// 下浏览器拦截 Worker/WASM/语言包，会静默卡死：直接快速失败并指引 */
    if (location.protocol === "file:") {
      alert("本地预览（file://）不支持图片识别：\n" +
            "浏览器安全限制，OCR 组件必须通过 http 加载。\n\n" +
            "请双击 start-fahuo.bat 在本机测试，\n或部署到 Ubuntu 服务器后使用。");
      return;
    }
    ocrBusy = true;
    btnRecognize.disabled = true; btnImage.disabled = true;
    const oldText = btnRecognize.textContent;
    btnRecognize.textContent = "识别中…";
    try {
      const ocr = Tesseract.recognize(file, "chi_sim+eng", {
        workerPath: "../shared/lib/worker.min.js",
        corePath: "../shared/lib",          /* 目录前缀，自动选择 simd/lstm 变体 */
        langPath: "../shared/lib",          /* chi_sim.traineddata / eng.traineddata */
        gzip: false,
        logger: m => {
          if (m.status === "recognizing text") {
            btnRecognize.textContent = "识别中 " + Math.round(m.progress * 100) + "%";
          }
        }
      });
      /* 90 秒超时兜底，避免异常时永远卡在「识别中」 */
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error("识别超时（90秒），请重试或换更清晰的图片")), 90000));
      const { data } = await Promise.race([ocr, timeout]);
      const text = (data.text || "").replace(/\s+/g, " ").trim();
      if (!text) { alert("未识别到文字，请换更清晰的图片"); return; }
      pasteInput.value = text;
      recognizeText();
    } catch (err) {
      let msg = (err && err.message) ? err.message : String(err);
      if (location.protocol === "file:") {
        msg = "本地 file:// 预览不支持图片识别\n" +
              "（浏览器安全限制：OCR 的 Worker / WASM / 语言包必须通过 http 加载）\n" +
              "解决：部署到 Ubuntu 服务器后访问，或本机双击 start-fahuo.bat 测试";
      }
      alert("图片识别失败\n" + msg);
    } finally {
      ocrBusy = false;
      btnRecognize.disabled = false; btnImage.disabled = false;
      btnRecognize.textContent = oldText;
      fileInput.value = "";
    }
  }

  /* 图片按钮 → 选择文件 */
  btnImage.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => ocrImage(fileInput.files[0]));

  /* 截图 Ctrl+V 直接粘贴 */
  pasteInput.addEventListener("paste", (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.startsWith("image/")) {
        e.preventDefault();
        ocrImage(it.getAsFile());
        return;
      }
    }
  });

  /* 拖拽图片到左面板 */
  pastePanel.addEventListener("dragover", (e) => {
    e.preventDefault();
    pastePanel.classList.add("dragover");
  });
  pastePanel.addEventListener("dragleave", () => pastePanel.classList.remove("dragover"));
  pastePanel.addEventListener("drop", (e) => {
    e.preventDefault();
    pastePanel.classList.remove("dragover");
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) ocrImage(f);
  });

  /* ----- SQLite API 层（离线自动降级为本地模式） ----- */
  /* 候选地址：同源相对路径（nginx 反代）→ 服务器 8091 直连（无需改 nginx） */
  const API_CANDIDATES = ["../api", `${location.protocol}//${location.hostname}:8091/api`];
  let API = API_CANDIDATES[0];
  let apiOnline = false;

  async function api(path, opts) {
    const r = await fetch(API + path, {
      headers: { "Content-Type": "application/json" }, ...opts
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  /* 备注列只显示收件区纯备注：剥离入库时拼接的发件方结构化标签 */
  const cleanNote = n => (n || "")
    .replace(/PO：\S+|采购员：\S+|发件人：\S+(?:\s+\d+)?|附件：\S+/g, "").trim();
  /* 姓名+电话两行（2026-09-15 用户规则：独立电话列已取消，电话换行显示在姓名下） */
  function fillNameCell(td, o) {
    const d1 = document.createElement("div"); d1.textContent = o.name || "";
    td.appendChild(d1);
    if (o.phone) { const d2 = document.createElement("div"); d2.textContent = o.phone; td.appendChild(d2); }
  }
  /* 行显示值（8 列：DN SO (优先级/类型合并列) 地址 姓名(含电话) 备注 承运商 要求发货日期；
     优先级/类型合并一列、换行显示（2026-09-16 用户规则，同清单页） */
  function rowValues(o) {
    return [o.so || "", o.so_no || "", null,
            o.address || "", o.name || "", cleanNote(o.note),
            o.carrier || "", o.ship_date || "", null];   /* 末位=删除列（2026-09-16 用户要求） */
  }
  /* 删除列（最后列）：未下单可删除整单（确认后 DELETE /api/orders/<id>）；
     已下单不出按钮（需先取消下单）；图标=应用统一 Feather 风格（垃圾桶） */
  const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/>'
    + '<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'
    + '<line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
  function fillDelCell(td, tr, o) {
    if (o.waybill_no) return;                       /* 已下单：不提供删除 */
    const b = document.createElement("button");
    b.type = "button"; b.className = "del-btn";
    b.innerHTML = TRASH_SVG;
    b.title = "删除该录单（不可恢复）";
    b.addEventListener("click", async e => {
      e.stopPropagation();                          /* 不触发行选中编辑 */
      if (!apiOnline) { alert("当前离线，无法删除"); return; }
      if (!confirm("删除该录单？\n\nDN：" + (o.so || "—") + "　姓名：" + (o.name || "—") +
                   "\n此操作不可恢复！")) return;
      try {
        await api("/orders/" + o.id, { method: "DELETE" });
        if (editingRow === tr) exitEdit();
        tr.remove();
        refreshStats();
        updateWarn();                                   /* 警告灯联动（删除行后） */
      } catch (err) { alert("删除失败：" + err.message); }
    });
    td.appendChild(b);
  }
  /* 地址两行显示（2026-09-15 用户规则）：省市区一行（直辖市去重），街道详情一行 */
  function addrLines(o) {
    const p = [];
    for (const x of [o.province, o.city, o.district]) if (x && p[p.length - 1] !== x) p.push(x);
    return [p.join(""), o.street || ""];
  }
  function fillAddrCell(td, o) {
    const [l1, l2] = addrLines(o);
    const d1 = document.createElement("div"); d1.textContent = l1 || (o.address || "");
    td.appendChild(d1);
    if (l2) { const d2 = document.createElement("div"); d2.textContent = l2; td.appendChild(d2); }
  }
  /* 单号前缀显示：DN=82600 / SO=32600 小号上标加粗，剩余位加粗（2026-09-15 用户规则） */
  const preHtml = (s, pre) => {
    s = s || "--------";
    return s.startsWith(pre)
      ? '<span class="dn-pre">' + pre + '</span><b>' + s.slice(pre.length) + "</b>"
      : "<b>" + s + "</b>";
  };
  const dnHtml = dn => preHtml(dn, "82600");
  const soHtml = so => preHtml(so, "32600");
  function fillRowCells(tr, v, o) {
    tr.innerHTML = "";
    tr.classList.toggle("row-urgent", !!o && o.priority === "紧急");   /* 紧急行加粗红字（2026-09-20 用户规则） */
    v.forEach((x, i) => {
      const td = document.createElement("td");
      if (i === 2 && o) {                            /* 合并列：紧急标记/类型（2026-09-20 用户规则："一般"不显示，仅紧急标红粗） */
        if (o.priority === "紧急") {
          const d1 = document.createElement("div");
          d1.textContent = "紧急";
          d1.classList.add("prio-hot");
          td.appendChild(d1);
        }
        const d2 = document.createElement("div"); d2.textContent = o.order_type || "发货单";
        td.appendChild(d2);
      }
      else if (i === 3 && o) fillAddrCell(td, o);   /* 地址列（第4列）：两行 */
      else if (i === 0 && o) td.innerHTML = dnHtml(o.so);   /* DN 列：前缀上标 */
      else if (i === 1 && o) td.innerHTML = o.so_no ? soHtml(o.so_no) : "";   /* SO 列：32600 前缀上标 */
      else if (i === 4 && o) fillNameCell(td, o);   /* 姓名列（第5列）：姓名+电话两行 */
      else if (i === 8 && o) fillDelCell(td, tr, o);   /* 删除列（最后列） */
      else td.textContent = x;
      tr.appendChild(td);
    });
    updateWarn();   /* 警告灯联动（编辑保存后优先级可能变更） */
  }
  function addRow(v, o) {
    const tr = document.createElement("tr");
    fillRowCells(tr, v, o);
    if (o) {
      tr._order = o;                      /* 挂载订单数据：行内修改用 */
      if (o.waybill_no) {                 /* 已下单：锁定，禁止行内修改 */
        tr.classList.add("row-locked");
        tr.title = "已下单（" + o.waybill_no + "），不允许修改";
      }
    }
    orderBody.appendChild(tr);
    updateWarn();                         /* 警告灯联动（新增/载入行后） */
  }

  /* 警告灯（2026-09-16 用户规则）：有待下单紧急录单 → 顶栏警告图标红色闪现；
     超过 3 个 → 闪烁频率加大；数量写进图标 title */
  function updateWarn() {
    const btn = document.querySelector('button[title="警告"], button[aria-label="警告"]');
    if (!btn) return;
    const n = [...orderBody.querySelectorAll("tr")].filter(tr => {
      const o = tr._order;
      return o && !o.waybill_no && (o.priority || "一般") === "紧急";
    }).length;
    btn.classList.toggle("warn-on", n > 0);
    btn.classList.toggle("warn-fast", n > 3);
    if (n) btn.title = `警告：${n} 笔紧急录单待处理`;
  }

  /* ----- 行内修改：点选行 → 回填收件信息 → 保存 ----- */
  let editingRow = null, editingId = null;

  function fillForm(o) {
    selProvince.value = o.province || "";
    fillCity(o.province || "", o.city || "");
    fillDistrict(o.province || "", o.city || "", o.district || "");
    streetInput.value = o.street || "";
    companyInput.value = o.company || "";   /* 公司独立字段（2026-09-17） */
    /* PO/采购员/发件人：优先取独立字段；旧数据（标签塞在 note 里的）回退标签反解并还原纯备注 */
    let noteText = o.note || "";
    poInput.value = o.po || ""; buyerInput.value = o.buyer || "";
    empNameInput.value = o.emp_name || ""; empPhoneInput.value = o.emp_phone || "";
    if (!o.po && !o.buyer && !o.emp_name) {   /* 旧数据兼容：从 note 标签反解 */
      const mPO = noteText.match(/PO：(\S+)/);
      if (mPO) { poInput.value = mPO[1]; noteText = noteText.replace(mPO[0], "").trim(); }
      const mB = noteText.match(/采购员：(\S+)/);
      if (mB) { buyerInput.value = mB[1]; noteText = noteText.replace(mB[0], "").trim(); }
      const mE = noteText.match(/发件人：(\S+)\s*(\d*)/);
      if (mE) { empNameInput.value = mE[1]; empPhoneInput.value = mE[2] || ""; noteText = noteText.replace(mE[0], "").trim(); }
    }
    noteInput.value = noteText;
    nameInput.value = o.name || "";
    phoneInput.value = o.phone || "";
    soInput.value = o.so || "";
    soNoInput.value = o.so_no || "";
    refreshUploadState(o.so || "");   /* 有上传过文件的发货单：虚线框显示「已上传 + 文件名」 */
    if (o.ship_date) dateInput.value = o.ship_date;
    document.querySelectorAll(".carrier").forEach(b =>
      b.classList.toggle("active", !!o.carrier && b.dataset.carrier === o.carrier));
    /* 单按钮开关：仅紧急/一般两态；旧数据"重要"归一为一般（2026-09-20 分类移除） */
    priority = o.priority === "紧急" ? "紧急" : "一般";
    document.querySelectorAll(".prio").forEach(x =>
      x.classList.toggle("active", priority === "紧急"));
    setType(o.order_type || "发货单");
  }

  function exitEdit() {
    if (editingRow) editingRow.classList.remove("row-edit");
    editingRow = null; editingId = null;
    btnConfirm.textContent = "确定";
  }

  orderBody.addEventListener("click", e => {
    const tr = e.target.closest("tr");
    if (!tr || !tr._order) return;
    if (tr._order.waybill_no) {                 /* 已下单：禁止行内修改 */
      alert("该单已下单（单号 " + tr._order.waybill_no + "），不允许再修改");
      return;
    }
    if (editingRow === tr) { exitEdit(); resetForm(); return; }  /* 再点同一行：取消 */
    exitEdit();
    editingRow = tr;
    editingId = tr._order.id || null;
    tr.classList.add("row-edit");
    fillForm(tr._order);
    btnConfirm.textContent = "保存";
  });

  function setStats(s) {
    const els = document.querySelectorAll(".stat-value");
    [s.yesterday_shipped, s.today_pending, s.overdue, s.planned, s.returned]
      .forEach((v, i) => {
        if (els[i] && v != null) els[i].textContent = String(v).padStart(2, "0"); /* 两位占位 */
      });
  }

  async function refreshStats() {
    try { setStats(await api("/stats")); } catch (e) { /* 离线忽略 */ }
  }

  function bumpLocalStat() { /* 离线模式：今日待发货本地 +1 */
    const el = document.querySelectorAll(".stat-value")[1];
    if (el) el.textContent = String((parseInt(el.textContent, 10) || 0) + 1).padStart(2, "0");
  }

  async function loadOrders() {
    for (const base of API_CANDIDATES) {
      try {
        API = base;
        const orders = await api("/orders", { signal: AbortSignal.timeout(5000) });   /* 探测 5s 超时防假死 */
        apiOnline = true;
        markApi(true, API);
        /* 已下单：只在单据当天显示，隔天自动出录单列表（工作队列只留待办；2026-09-16 用户规则。
           以 created_at 为单据日期——录入+下单同日常态下准确；下单动作不写库日期，此处为最贴近口径） */
        const todayStr = new Date().toLocaleDateString("sv-SE");
        orders.forEach(o => {
          if (o.waybill_no && String(o.created_at || "").slice(0, 10) < todayStr) return;
          addRow(rowValues(o), o);
        });
        refreshStats();
        return;
      } catch (e) { /* 尝试下一个候选地址 */ }
    }
    apiOnline = false;
    markApi(false);
    /* 离线：正式模式无模拟数据（MOCK_ORDERS 已移除，恒为未定义） */
    if (typeof MOCK_ORDERS !== "undefined") {
      MOCK_ORDERS.forEach(o => addRow(rowValues(o), o));
      if (typeof MOCK_STATS !== "undefined") setStats(MOCK_STATS);
      console.warn("API 离线，已加载内置模拟数据（本地演示模式，入单不持久化）");
    } else {
      console.warn("API 离线，本次使用本地模式（数据不持久化）");
    }
  }

  function resetForm() {
    pasteInput.value = "";
    streetInput.value = ""; companyInput.value = ""; noteInput.value = "";
    nameInput.value = ""; phoneInput.value = "";
    soInput.value = ""; soNoInput.value = "";
    poInput.value = ""; buyerInput.value = ""; empNameInput.value = ""; empPhoneInput.value = "";
    upFileInput.value = ""; setUploadState("");
    poolCheck.checked = true;   /* 默认勾选（2026-09-24）：保存/重置后仍保持入池勾选 */
    selProvince.value = ""; fillCity("", ""); fillDistrict("", "", "");
    document.querySelectorAll(".carrier").forEach(b => b.classList.remove("active"));
    /* 优先级复位（单按钮开关：弹起=一般；2026-09-20） */
    priority = "一般";
    document.querySelectorAll(".prio").forEach(x => x.classList.remove("active"));
    /* 下单类型复位为「发货单」（含右盒内容切换） */
    setType("发货单");
    parsed = { name: "", phone: "" };
    exitEdit();            /* 退出行内修改状态，按钮复位「确定」 */
    pasteInput.focus();
  }

  /* ----- 确认：写入发货清单表（在线入库 / 离线本地） ----- */
  btnConfirm.addEventListener("click", async () => {
    const prov = selProvince.value, city = selCity.value, dist = selDistrict.value;
    const street = streetInput.value.trim();
    const company = companyInput.value.trim();   /* 公司独立字段（2026-09-17 拆分） */
    const addr = [[prov, city, dist].filter(Boolean).join(" "), company, street]
      .filter(Boolean).join(" ");
    if (!addr) { alert("地址为空：请先粘贴地址并点击「识别」"); return; }
    if (!phoneInput.value.trim()) { alert("联系方式为必填项"); phoneInput.focus(); return; }
    const dn = soInput.value.trim(), soNo = soNoInput.value.trim();
    /* 多 DN 合并发货（2026-09-20 用户规则）：按 82600 开头+后 5 位（共 10 位）逐个识别 DN，
       生成多行、下单时同一运单；行内修改仍限单 DN */
    const dns = dn.match(/82600\d{5}/g) || [];
    if (dn && !dns.length) {
      alert("未识别到 DN：需为 82600 开头的 10 位数字（多个可连输或逗号分隔）"); soInput.focus(); return;
    }
    if (editingRow && dns.length > 1) {
      alert("行内修改仅支持单个 DN；多 DN 合并发货请退出修改后重新录入"); soInput.focus(); return;
    }
    /* 发货单：DN 必填、SO 选填（用户规则 2026-09-15）；外协单：采购员必填；其他（员工快递）：员工姓名+电话必填 */
    if (orderType === "发货单") {
      if (!dns.length) { alert("发货单必须填写 DN"); soInput.focus(); return; }
    }
    if (orderType === "外协单") {
      if (!poInput.value.trim()) { alert("外协单必须填写 PO"); poInput.focus(); return; }
      if (!buyerInput.value.trim()) { alert("外协单必须填写采购员"); buyerInput.focus(); return; }
    }
    if (orderType === "其他") {
      if (!empNameInput.value.trim()) { alert("其他（员工快递）必须填写员工姓名"); empNameInput.focus(); return; }
      if (!empPhoneInput.value.trim()) { alert("其他（员工快递）必须填写员工电话"); empPhoneInput.focus(); return; }
    }
    /* 备注纯净化：note 只存手写备注；PO/采购员/发件人走独立字段入库（运单备注在下单时另组） */
    const notePure = noteInput.value.trim();

    /* 勾选：地址信息存到共享地址池（在线写服务端全用户共享，按地址去重；离线写本地池） */
    if (poolCheck.checked) {
      const entry = { province: prov, city, district: dist, street, company,
                      name: nameInput.value.trim(), phone: phoneInput.value.trim() };
      if (apiOnline) {
        try {
          await fetch(`${API}/addrpool`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry)
          });
        } catch (e) { /* 入池失败不阻断入单 */ }
      } else {
        const pool = JSON.parse(localStorage.getItem("lnsc-addr-pool") || "[]");
        const key = [prov, city, dist, company, street].filter(Boolean).join(" ");
        if (key && !pool.some(a => [a.province, a.city, a.district, a.company, a.street].filter(Boolean).join(" ") === key)) {
          pool.push(entry);
          localStorage.setItem("lnsc-addr-pool", JSON.stringify(pool));
        }
      }
      refreshPool();   /* 刷新搜索缓存 */
    }

    const activeCarrier = document.querySelector(".carrier.active");
    const payload = {
      so: orderType === "发货单" ? (dns[0] || "") : "",   /* 外协单/其他 没有 DN 和 SO 号；多 DN 时首号（创建循环逐条覆盖） */
      so_no: orderType === "发货单" ? soNo : "",
      order_type: orderType,
      province: prov, city: city, district: dist, street: street, company: company,
      name: nameInput.value.trim(),
      phone: phoneInput.value.trim(),
      carrier: activeCarrier ? activeCarrier.dataset.carrier : "",
      note: notePure,
      priority: priority,
      ship_date: dateInput.value.trim(),
      po: orderType === "外协单" ? poInput.value.trim() : "",
      buyer: orderType === "外协单" ? buyerInput.value.trim() : "",
      emp_name: orderType === "其他" ? empNameInput.value.trim() : "",
      emp_phone: orderType === "其他" ? empPhoneInput.value.trim() : ""
    };

    /* 行内修改模式：保存修改（在线 PUT / 离线本地改行） */
    if (editingRow) {
      const local = { ...payload, address: addr };
      if (apiOnline && editingId) {
        try {
          const saved = await api(`/orders/${editingId}`, { method: "PUT", body: JSON.stringify(local) });
          fillRowCells(editingRow, rowValues(saved), saved);
          editingRow._order = saved;
        } catch (e) {
          alert("服务器连接失败，修改未保存！");
          return;
        }
      } else {
        fillRowCells(editingRow, rowValues(local), local);
        editingRow._order = local;
      }
      resetForm();
      return;
    }

    /* 多 DN（2026-09-20 用户规则）：逐条入库并打同一 merge_group ——
       下单页同组只下一次承运商单、组内各行共享同一运单号 */
    const mergeGroup = dns.length > 1 ? ("MG" + Date.now()) : "";
    const soList = orderType === "发货单" ? dns : [""];
    if (apiOnline) {
      try {
        for (const one of soList) {
          const saved = await api("/orders", { method: "POST",
            body: JSON.stringify({ ...payload, so: one, merge_group: one ? mergeGroup : "" }) });
          addRow(rowValues(saved), saved);
        }
        refreshStats();
      } catch (e) {
        apiOnline = false;
        alert("服务器连接失败，本单仅本地暂存，刷新后丢失！");
        for (const one of soList) {
          const local = { ...payload, so: one, merge_group: one ? mergeGroup : "", address: addr };
          addRow(rowValues(local), local);
        }
        bumpLocalStat();
      }
    } else {
      for (const one of soList) {
        const local = { ...payload, so: one, merge_group: one ? mergeGroup : "", address: addr };
        addRow(rowValues(local), local);
      }
      bumpLocalStat();
    }
    resetForm();
  });

  /* ----- 初始化 ----- */
  fillProvince();
  const t = new Date();
  dateInput.value = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  loadOrders();

  /* 统计卡点击 → 跳转清单模式并按该口径筛选（与其他页面一致） */
  const FLOWS = ["shipped_yesterday", "pending_today", "overdue", "planned", "returned_today"];
  document.querySelectorAll(".sidebar-right .stat").forEach((el, i) => {
    if (!FLOWS[i]) return;
    el.style.cursor = "pointer";
    el.title = "点击在清单模式中查看：" + el.querySelector(".stat-label").textContent;
    el.addEventListener("click", () => { location.href = "3-list.html?f=" + FLOWS[i]; });
  });
}
