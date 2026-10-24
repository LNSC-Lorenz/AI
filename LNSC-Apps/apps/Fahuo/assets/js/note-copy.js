/* 列表备注单元格：完整纯备注 + 尾部复制按钮（录单/下单/清单共用） */
(function () {
  "use strict";

  const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>'
    + '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  function fill(td, text, options) {
    const opts = options || {};
    const note = String(text == null ? "" : text);
    td.classList.add("note-cell");
    td.title = note;

    const wrap = document.createElement("div");
    wrap.className = "note-cell-wrap";
    const content = document.createElement("div");
    content.className = opts.singleLine ? "note-text note-single" : "note-text clamp3";
    content.textContent = note || (opts.placeholder || "");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "note-copy";
    button.innerHTML = COPY_SVG;
    button.dataset.note = note;
    button.disabled = !note;
    button.title = note ? "复制备注" : "无备注可复制";
    button.setAttribute("aria-label", button.title);

    wrap.appendChild(content);
    wrap.appendChild(button);
    td.replaceChildren(wrap);
  }

  function toast(message) {
    let el = document.getElementById("lmToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "lmToast";
      el.className = "lm-toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("on");
    clearTimeout(el._tm);
    el._tm = setTimeout(() => el.classList.remove("on"), 1800);
  }

  function fallbackCopy(text) {
    const active = document.activeElement;
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e) { /* 下方统一报错 */ }
    ta.remove();
    if (active && active.focus) {
      try { active.focus({ preventScroll: true }); } catch (e) { active.focus(); }
    }
    if (!ok) throw new Error("copy command failed");
  }

  async function writeText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch (e) { /* HTTP 或权限限制时回退 */ }
    }
    fallbackCopy(text);
  }

  document.addEventListener("click", async event => {
    const button = event.target.closest(".note-copy");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();                 /* 不触发录单编辑或下单行选择 */
    if (button.disabled) return;
    button.disabled = true;
    try {
      await writeText(button.dataset.note || "");
      button.classList.add("copied");
      button.title = "备注已复制";
      toast("备注已复制");
      setTimeout(() => {
        button.classList.remove("copied");
        button.title = "复制备注";
      }, 1500);
    } catch (e) {
      toast("复制失败，请手动复制");
    } finally {
      button.disabled = false;
    }
  }, true);                                      /* 捕获阶段拦截，先于行/表体点击处理器 */

  window.NoteCopy = { fill };
})();
