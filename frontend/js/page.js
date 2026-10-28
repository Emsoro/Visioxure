// page.js —— 右侧「页面」属性页：页面尺寸（宽 / 高）与背景色
// 页面级改动同样走 History 事务，可撤销；控件只构建一次，之后按需同步数值
"use strict";

(function () {
  const MIN = 100, MAX = 10000;
  const FALLBACK = { w: 800, h: 1100, orientation: "portrait" };

  let host = null;
  let ui = null;      // 已构建的控件引用
  let builtId = null; // 控件对应的页面 id

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function clamp(v) { return Math.max(MIN, Math.min(MAX, Math.round(v))); }

  // 页面改动统一入口：快照 → 改模型 → 重绘（模型自身的 pagechange 负责刷新面板）
  function apply(label, fn) {
    VX.History.run(label, () => fn(VX.Model.page()));
    VX.Renderer.invalidate();
  }

  // 宽 / 高：数值输入（px），回车或失焦生效
  function sizeRow(labelText, key) {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", labelText));

    const wrap = el("span", "sp-num-wrap");
    const input = document.createElement("input");
    input.type = "number";
    input.className = "sp-num";
    input.min = String(MIN);
    input.max = String(MAX);
    input.step = "10";
    input.title = "页面" + labelText + "（px）";
    input.addEventListener("keydown", (e) => e.stopPropagation());
    input.addEventListener("change", () => {
      const size = (VX.Model.page() || {}).size || FALLBACK;
      const v = parseFloat(input.value);
      if (!isFinite(v)) { input.value = String(Math.round(size[key] || 0)); return; }
      const n = clamp(v);
      if (n === Math.round(size[key] || 0)) { input.value = String(n); return; }
      apply("修改页面" + labelText, () => {
        VX.Model.setPageSize(key === "w" ? n : size.w, key === "h" ? n : size.h);
      });
    });

    wrap.appendChild(input);
    wrap.appendChild(el("span", "sp-unit", "px"));
    row.appendChild(wrap);
    return { row, input };
  }

  // 背景色：色块 + 十六进制，点击弹出调色板
  function bgRow() {
    const row = el("div", "sp-row");
    row.appendChild(el("span", "sp-label", "背景色"));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sp-color";
    const chip = el("span", "sp-chip");
    const text = el("span", "sp-color-text");
    btn.appendChild(chip);
    btn.appendChild(text);
    btn.addEventListener("click", () => {
      VX.ColorPicker.open(btn, {
        title: "页面背景色",
        value: (VX.Model.page() || {}).background || "#FFFFFF",
        onPick: (c) => apply("修改页面背景色", () => VX.Model.setPageBackground(c)),
      });
    });

    row.appendChild(btn);
    return { row, btn, chip, text };
  }

  function build() {
    host.innerHTML = "";
    const title = el("div", "sp-head");
    const w = sizeRow("宽度", "w");
    const h = sizeRow("高度", "h");
    const bg = bgRow();
    const summary = el("div", "pp-summary");

    host.appendChild(title);
    host.appendChild(el("div", "prop-section", "页面尺寸"));
    host.appendChild(w.row);
    host.appendChild(h.row);
    host.appendChild(el("div", "panel-hint", "单位 px；回车或失焦生效，画布内容不会随之缩放。"));
    host.appendChild(el("div", "prop-section", "背景"));
    host.appendChild(bg.row);
    host.appendChild(summary);

    ui = { title, w, h, bg, summary };
  }

  // 就地刷新数值，避开正在编辑的输入框（否则会打断连续输入）
  function sync() {
    const page = VX.Model.page();
    if (!ui || !page) return;
    const size = page.size || FALLBACK;
    const w = Math.round(size.w || FALLBACK.w);
    const h = Math.round(size.h || FALLBACK.h);
    const color = page.background || "#FFFFFF";

    ui.title.textContent = page.name || "页面";
    if (document.activeElement !== ui.w.input) ui.w.input.value = String(w);
    if (document.activeElement !== ui.h.input) ui.h.input.value = String(h);
    ui.bg.chip.style.background = color;
    ui.bg.text.textContent = color.toUpperCase();
    ui.summary.textContent = w + " × " + h + " px · " + (w > h ? "横向" : "纵向");
  }

  function render() {
    if (!host) return;
    const page = VX.Model.page();
    if (!page) { host.innerHTML = ""; ui = null; builtId = null; return; }
    // 切页或首次进入才重建控件，改数值只做 sync
    if (!ui || builtId !== page.id) { build(); builtId = page.id; }
    sync();
  }

  const PagePanel = {
    init(el0) {
      host = el0 || document.getElementById("page-panel");
      if (!host) return;
      VX.Model.on("pagechange", render);
      render();
    },
    render,
  };

  VX.PagePanel = PagePanel;
})();
