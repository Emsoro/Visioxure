// colorpicker.js —— Office 风格调色板
// 主题颜色（10 个色系 × 5 档明度）+ 标准色 + 自定义颜色 + 最近自定义颜色
// 用法：VX.ColorPicker.open(anchorEl, { value, title, onPick(hex), onClear() })
"use strict";

(function () {
  // 主题颜色：每列一个色系，行序 = 基色 / 浅色 / 更浅 / 极浅 / 深色
  const THEME = [
    ["#FFFFFF", "#F2F2F2", "#D9D9D9", "#BFBFBF", "#A5A5A5"],
    ["#000000", "#7F7F7F", "#595959", "#404040", "#262626"],
    ["#E7E6E6", "#D0CECE", "#AEAAAA", "#757070", "#3A3838"],
    ["#44546A", "#D6DCE4", "#ADB9CA", "#8496B0", "#333F4F"],
    ["#4472C4", "#D9E2F3", "#B4C6E7", "#8EAADB", "#2F5597"],
    ["#ED7D31", "#FBE4D5", "#F8CBAD", "#F4B084", "#C55A11"],
    ["#A5A5A5", "#EDEDED", "#DBDBDB", "#C9C9C9", "#7B7B7B"],
    ["#FFC000", "#FFF2CC", "#FFE699", "#FFD966", "#BF9000"],
    ["#5B9BD5", "#DEEBF6", "#BDD7EE", "#9DC3E6", "#2E75B6"],
    ["#70AD47", "#E2EFD9", "#C5E0B3", "#A9D18E", "#548235"],
  ];
  // 标准色（Office 标准色行）
  const STANDARD = [
    "#C00000", "#FF0000", "#FFC000", "#FFFF00", "#92D050",
    "#00B050", "#00B0F0", "#0070C0", "#002060", "#7030A0",
  ];
  const RECENT_KEY = "visioxure.recentColors";
  const RECENT_MAX = 10;

  let pop = null;   // 弹层 DOM（单例）
  let cur = null;   // { anchor, value, title, onPick, onClear }

  // ---------- 最近自定义颜色 ----------
  function readRecent() {
    try {
      const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.filter((c) => typeof c === "string" && /^#[0-9A-Fa-f]{6}$/.test(c))
        .map((c) => c.toUpperCase())
        .slice(0, RECENT_MAX);
    } catch (e) { return []; }
  }

  function addRecent(color) {
    const c = normalize(color);
    if (!c) return;
    const list = readRecent().filter((x) => x !== c);
    list.unshift(c);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) { /* 隐私模式忽略 */ }
  }

  // #abc / abc123 / #AABBCC → #AABBCC；非法返回 null
  function normalize(v) {
    let s = String(v || "").trim();
    if (!s) return null;
    if (s[0] !== "#") s = "#" + s;
    if (/^#[0-9A-Fa-f]{3}$/.test(s)) s = "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    if (!/^#[0-9A-Fa-f]{6}$/.test(s)) return null;
    return s.toUpperCase();
  }

  function same(a, b) {
    const x = normalize(a), y = normalize(b);
    return !!x && x === y;
  }

  // ---------- DOM ----------
  function sectionTitle(text) {
    const d = document.createElement("div");
    d.className = "cp-title";
    d.textContent = text;
    return d;
  }

  function swatch(color, cls) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cp-swatch" + (cls ? " " + cls : "") + (same(color, cur.value) ? " active" : "");
    b.style.background = color;
    b.dataset.color = color;
    b.title = color;
    return b;
  }

  function buildThemeGrid() {
    const grid = document.createElement("div");
    grid.className = "cp-grid";
    grid.style.gridTemplateColumns = `repeat(${THEME.length}, 1fr)`;
    // 行优先填充：行 = 明度档位，列 = 色系
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < THEME.length; c++) grid.appendChild(swatch(THEME[c][r]));
    }
    return grid;
  }

  function buildStandardRow() {
    const row = document.createElement("div");
    row.className = "cp-row";
    row.style.gridTemplateColumns = `repeat(${STANDARD.length}, 1fr)`;
    for (const c of STANDARD) row.appendChild(swatch(c));
    return row;
  }

  function buildRecentRow() {
    const recent = readRecent();
    const wrap = document.createElement("div");
    wrap.className = "cp-recent";
    if (!recent.length) {
      const hint = document.createElement("span");
      hint.className = "cp-hint";
      hint.textContent = "暂无自定义颜色";
      wrap.appendChild(hint);
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "cp-row";
    row.style.gridTemplateColumns = `repeat(${RECENT_MAX}, 1fr)`;
    for (let i = 0; i < RECENT_MAX; i++) {
      if (recent[i]) {
        row.appendChild(swatch(recent[i]));
      } else {
        const ph = document.createElement("span");
        ph.className = "cp-swatch cp-swatch-empty";
        row.appendChild(ph);
      }
    }
    wrap.appendChild(row);
    return wrap;
  }

  function buildCustomRow() {
    const box = document.createElement("div");
    box.className = "cp-custom";

    const native = document.createElement("input");
    native.type = "color";
    native.className = "cp-native";
    native.value = normalize(cur.value) || "#4A90D9";
    native.title = "自定义颜色";

    const hex = document.createElement("input");
    hex.type = "text";
    hex.className = "cp-hex";
    hex.maxLength = 7;
    hex.placeholder = "#RRGGBB";
    hex.value = same(cur.value, native.value) ? normalize(cur.value) : "";

    native.addEventListener("input", () => { hex.value = native.value.toUpperCase(); });
    hex.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") applyCustom();
    });
    hex.addEventListener("input", () => {
      const v = normalize(hex.value);
      if (v) native.value = v;
    });

    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "cp-apply";
    apply.textContent = "应用";

    box.appendChild(native);
    box.appendChild(hex);
    box.appendChild(apply);
    return box;
  }

  function render() {
    pop.innerHTML = "";
    if (cur.title) {
      const h = document.createElement("div");
      h.className = "cp-caption";
      h.textContent = cur.title;
      pop.appendChild(h);
    }
    pop.appendChild(sectionTitle("主题颜色"));
    pop.appendChild(buildThemeGrid());
    pop.appendChild(sectionTitle("标准色"));
    pop.appendChild(buildStandardRow());
    pop.appendChild(sectionTitle("最近自定义颜色"));
    pop.appendChild(buildRecentRow());
    pop.appendChild(sectionTitle("自定义颜色"));
    pop.appendChild(buildCustomRow());
    if (cur.onClear && cur.clearLabel) {
      const n = document.createElement("button");
      n.type = "button";
      n.className = "cp-none";
      n.textContent = cur.clearLabel;
      pop.appendChild(n);
    }
  }

  function ensurePop() {
    if (pop) return pop;
    pop = document.createElement("div");
    pop.className = "cp-pop hidden";
    document.body.appendChild(pop);
    pop.addEventListener("mousedown", (e) => e.stopPropagation());
    pop.addEventListener("click", (e) => {
      const sw = e.target.closest(".cp-swatch");
      if (sw && sw.dataset.color) { choose(sw.dataset.color); return; }
      if (e.target.closest(".cp-none")) {
        const fn = cur && cur.onClear;
        close();
        if (fn) fn();
        return;
      }
      if (e.target.closest(".cp-apply")) { applyCustom(); return; }
    });
    return pop;
  }

  function place(anchor) {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + pw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pw - 8);
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function choose(color) {
    const fn = cur && cur.onPick;
    close();
    if (fn) fn(normalize(color) || color);
  }

  function applyCustom() {
    const native = pop.querySelector(".cp-native");
    const hex = pop.querySelector(".cp-hex");
    const v = normalize(hex.value) || normalize(native.value);
    if (!v) return;
    addRecent(v);
    const fn = cur && cur.onPick;
    close();
    if (fn) fn(v);
  }

  function close() {
    if (pop) pop.classList.add("hidden");
    cur = null;
  }

  // ---------- 全局关闭 ----------
  document.addEventListener("mousedown", (e) => {
    if (!pop || pop.classList.contains("hidden")) return;
    if (pop.contains(e.target) || (cur && cur.anchor && cur.anchor.contains(e.target))) return;
    close();
  });
  document.addEventListener("keydown", (e) => {
    if (!pop || pop.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.stopPropagation(); close(); }
  }, true);
  window.addEventListener("resize", close);

  const ColorPicker = {
    open(anchor, opts) {
      opts = opts || {};
      const p = ensurePop();
      cur = {
        anchor,
        value: opts.value,
        title: opts.title || "颜色",
        clearLabel: opts.clearLabel || "",
        onPick: opts.onPick,
        onClear: opts.onClear,
      };
      render();
      p.classList.remove("hidden");
      place(anchor);
    },
    close,
    recent: readRecent,
    normalize,
  };

  VX.ColorPicker = ColorPicker;
})();
