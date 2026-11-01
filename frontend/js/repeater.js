// repeater.js —— 中继器（P6.5 / A2）
// 结构：shape.type = "repeater"
//   shape.repeater = {
//     columns: ["标题", "说明"],            // 列名（缺省时从 dataset 的键推导）
//     dataset: [ { 标题: "...", 说明: "..." } ],
//     layout: { mode: "vertical"|"grid", gap, gapX, gapY, cols, rowHeight },
//     pageSize: 0,                          // >0 时分页
//     template: [ shapes... ]               // 模板子形状，坐标相对中继器左上角（0,0）
//   }
// 视图状态（过滤/排序/分页）写在 shape.repeater.view 上，供交互动作运行时改写。
// 渲染与导出都用 items() + instantiate()：前者算每条数据的偏移，后者深拷贝模板并做 {{列名}} 插值。
"use strict";

window.VX = window.VX || {};

(function () {
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 列名：显式 columns 优先，否则按 dataset 里出现过的键顺序去重
  function columns(rep) {
    if (!rep) return [];
    if (Array.isArray(rep.columns) && rep.columns.length) return rep.columns;
    const out = [];
    for (const row of rep.dataset || []) {
      if (!row || typeof row !== "object") continue;
      for (const k of Object.keys(row)) if (out.indexOf(k) < 0) out.push(k);
    }
    return out;
  }

  // 模板包围盒（模板坐标相对中继器左上角）：无形状时回退 1×1，避免除零/负偏移
  function bounds(template) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = (arr) => {
      for (const s of arr || []) {
        if (!s) continue;
        if (s.type === "group" || s.type === "instance") { walk(s.children); continue; }
        if (s.type === "connector") {
          for (const p of [s.begin, s.end]) {
            if (!p) continue;
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
          }
          continue;
        }
        minX = Math.min(minX, s.x || 0); minY = Math.min(minY, s.y || 0);
        maxX = Math.max(maxX, (s.x || 0) + (s.w || 0)); maxY = Math.max(maxY, (s.y || 0) + (s.h || 0));
      }
    };
    walk(template);
    if (minX === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  // 过滤 → 排序 → 分页；返回 [{ row, index }]，index 是 dataset 里的原始下标（删行用）
  function visibleRows(rep) {
    let rows = (rep.dataset || []).map((row, index) => ({ row: row || {}, index }));
    const view = rep.view || {};

    const f = view.filter;
    if (f && f.column) {
      const want = f.value == null ? "" : String(f.value);
      rows = rows.filter(({ row }) => {
        const raw = row[f.column];
        const s = raw == null ? "" : String(raw);
        const n = Number(raw);
        switch (f.op) {
          case "equals": return s === want;
          case "notEquals": return s !== want;
          case "gt": return isFinite(n) && n > Number(want);
          case "lt": return isFinite(n) && n < Number(want);
          case "empty": return s === "";
          case "notEmpty": return s !== "";
          default: return s.toLowerCase().indexOf(want.toLowerCase()) >= 0; // contains
        }
      });
    }

    const so = view.sort;
    if (so && so.column) {
      const dir = so.dir === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        const av = a.row[so.column], bv = b.row[so.column];
        const an = Number(av), bn = Number(bv);
        const numeric = av !== "" && bv !== "" && isFinite(an) && isFinite(bn);
        const d = numeric
          ? an - bn
          : String(av == null ? "" : av).localeCompare(String(bv == null ? "" : bv), "zh-CN");
        return d * dir;
      });
    }

    const size = Number(view.pageSize != null ? view.pageSize : rep.pageSize) || 0;
    let pageCount = 1;
    if (size > 0) {
      pageCount = Math.max(1, Math.ceil(rows.length / size));
      const p = Math.min(Math.max(0, Number(view.page) || 0), pageCount - 1);
      rows = rows.slice(p * size, p * size + size);
    }
    rows.pageCount = pageCount;
    return rows;
  }

  // 每条数据的布局偏移：模板包围盒左上角对齐到 (0,0)，再按竖向/网格排开
  function items(s) {
    const rep = (s && s.repeater) || {};
    const lay = rep.layout || {};
    const list = visibleRows(rep);
    const tb = bounds(rep.template || []);
    const gap = Number(lay.gap != null ? lay.gap : 8);
    const out = [];
    if ((lay.mode || "vertical") === "grid") {
      const cols = Math.max(1, Math.round(Number(lay.cols) || 1));
      const cw = tb.w + Number(lay.gapX != null ? lay.gapX : gap);
      const ch = tb.h + Number(lay.gapY != null ? lay.gapY : gap);
      list.forEach((it, i) => out.push({
        row: it.row, index: it.index,
        dx: -tb.x + (i % cols) * cw,
        dy: -tb.y + Math.floor(i / cols) * ch,
      }));
    } else {
      const rh = Number(lay.rowHeight) > 0 ? Number(lay.rowHeight) : tb.h + gap;
      list.forEach((it, i) => out.push({ row: it.row, index: it.index, dx: -tb.x, dy: -tb.y + i * rh }));
    }
    out.pageCount = list.pageCount;
    out.total = (rep.dataset || []).length;
    return out;
  }

  // {{列名}} 插值：缺列时留空（不是保留 {{...}}，否则导出的原型会露出模板语法）
  function interpolate(text, row) {
    if (typeof text !== "string" || !text) return text;
    if (!text || text.indexOf("{{") < 0) return text;
    return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, name) => {
      const v = row ? row[name] : undefined;
      return v == null ? "" : String(v);
    });
  }

  // 深拷贝模板并整体平移到 (ox,oy)，文本按行插值。
  // 组的子形状/面板子形状/连接线端点都是世界坐标，因此整棵子树一起平移。
  function instantiate(template, row, ox, oy) {
    return (template || []).map((s) => {
      const c = clone(s);
      offsetTree(c, ox, oy);
      applyText(c, row);
      return c;
    });
  }

  function applyText(s, row) {
    if (s.text) s.text = interpolate(s.text, row);
    for (const c of s.children || []) applyText(c, row);
    for (const st of (s.panel && s.panel.states) || []) for (const c of st.shapes || []) applyText(c, row);
    return s;
  }

  function offsetTree(s, dx, dy) {
    s.x = (s.x || 0) + dx;
    s.y = (s.y || 0) + dy;
    if (s.type === "connector") {
      if (s.begin) { s.begin.x += dx; s.begin.y += dy; }
      if (s.end) { s.end.x += dx; s.end.y += dy; }
    }
    if (s.children) for (const c of s.children) offsetTree(c, dx, dy);
    if (s.panel) for (const st of s.panel.states || []) for (const c of st.shapes || []) offsetTree(c, dx, dy);
    if (s.repeater && s.repeater.template) for (const c of s.repeater.template) offsetTree(c, dx, dy);
    return s;
  }

  // 默认模板：白底卡片 + 标题 + 说明，两行文字用 {{列名}} 占位
  function defaultTemplate() {
    const font = (patch) => Object.assign(
      { family: "Segoe UI", size: 14, color: "#22252B", bold: false, align: "left", vAlign: "top" },
      patch || {});
    return [
      { type: "rect", x: 0, y: 0, w: 240, h: 56,
        style: { fill: "#FFFFFF", line: "#E2E5EA", lineWidth: 1, cornerRadius: 8, opacity: 1, font: font({}) } },
      { type: "text", x: 12, y: 8, w: 216, h: 20, text: "{{标题}}", textIsTemplate: true,
        style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font({ bold: true }) } },
      { type: "text", x: 12, y: 29, w: 216, h: 18, text: "{{说明}}", textIsTemplate: true,
        style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font({ size: 12, color: "#6E737D" }) } },
    ];
  }

  // 新建中继器的属性（stencils 与「插入中继器」共用）
  function defaultShape() {
    const dataset = [
      { 标题: "列表项一", 说明: "这里是说明文字" },
      { 标题: "列表项二", 说明: "这里是说明文字" },
      { 标题: "列表项三", 说明: "这里是说明文字" },
    ];
    const rowH = 64;
    return {
      type: "repeater",
      w: 260,
      h: dataset.length * rowH,
      style: { fill: "transparent", line: "transparent", lineWidth: 1, opacity: 1,
               font: { family: "Segoe UI", size: 14, color: "#333333", bold: false, align: "left", vAlign: "top" } },
      repeater: {
        columns: ["标题", "说明"],
        dataset,
        layout: { mode: "vertical", gap: 8, rowHeight: rowH, cols: 2 },
        pageSize: 0,
        template: defaultTemplate(),
      },
    };
  }

  // 模板变化后按行数把容器高度贴合内容（竖向布局）
  function relayout(s) {
    if (!s || !s.repeater) return;
    const lay = s.repeater.layout || {};
    if ((lay.mode || "vertical") !== "vertical") return;
    const n = Math.max(1, (s.repeater.dataset || []).length);
    const rh = Number(lay.rowHeight) > 0 ? Number(lay.rowHeight) : bounds(s.repeater.template).h + 8;
    s.h = n * rh;
  }

  // ---------- 数据集编辑：CSV 文本 ↔ dataset ----------
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rep) {
    const cols = columns(rep);
    const lines = [cols.map(csvCell).join(",")];
    for (const row of rep.dataset || []) lines.push(cols.map((c) => csvCell(row ? row[c] : "")).join(","));
    return lines.join("\n");
  }

  // 第一行是列名，之后每行一条数据；引号内的逗号/换行按 CSV 规则处理
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
        continue;
      }
      if (ch === '"') { quoted = true; continue; }
      if (ch === ",") { row.push(cell); cell = ""; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
        continue;
      }
      cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.length && r.some((c) => c !== ""));
  }

  function setCsv(rep, text) {
    const rows = parseCsv(text || "");
    if (!rows.length) return false;
    const cols = rows[0].map((c) => c.trim()).filter(Boolean);
    if (!cols.length) return false;
    rep.columns = cols;
    rep.dataset = rows.slice(1).map((r) => {
      const o = {};
      cols.forEach((c, i) => { o[c] = r[i] != null ? r[i] : ""; });
      return o;
    });
    return true;
  }

  const Repeater = {
    columns, bounds, visibleRows, items, interpolate, instantiate, offsetTree,
    defaultTemplate, defaultShape, relayout, toCsv, parseCsv, setCsv,
  };

  VX.Repeater = Repeater;
})();
