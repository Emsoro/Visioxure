// table.js —— 表格组件（P7）
// 表格用「组合 + 单元格矩形」承载：单元格就是普通的 rect（文字直接挂在 rect 上），
// 因此画布渲染、命中测试、PNG/SVG/PDF/HTML 导出、组合缩放都沿用既有管线，导出侧无需新增分支。
// 行列数写在 group.table 上，改动时按 (行,列) 保留已输入的单元格文字后重建 children。
"use strict";

(function () {
  const MIN = 1, MAX = 30;      // 行列数范围：够用且不会把小表格拖成几百个子形状
  const MIN_W = 40, MIN_H = 30; // 包围盒下限，避免拖成 0 宽后重建出不可见的网格
  // 单元格下限：行高再压就放不下一行 12px 文字（文字不会跟着缩放，只会溢出），列宽同理。
  // 整体缩放必须停在这条线以上，否则网格会挤成一团（见 tools.js resizeShape）
  const MIN_COL_W = 48, MIN_ROW_H = 24;

  function clampInt(v, lo, hi, fallback) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return fallback;
    return Math.max(lo, Math.min(hi, n));
  }

  // 与形状库共用同一套色板（stencils.js 导出 tokens），表格不另起 hex 字面量
  function palette() {
    const PR = (VX.Stencils && VX.Stencils.tokens && VX.Stencils.tokens.PR) || {};
    return {
      line: PR.line || "#E2E5EA",
      headerFill: PR.surface || "#F3F4F7",
      bodyFill: PR.white || "#FFFFFF",
      text: PR.text || "#22252B",
    };
  }

  function isTable(s) {
    return !!(s && s.type === "group" && s.table &&
      s.table.rows > 0 && s.table.cols > 0);
  }

  // 旧单元格快照：key = "行,列"。重建时保留 id 与用户改过的文字。
  // id 必须稳定：拖拽缩放每一帧都会重建，每次重新发 id 会白白消耗一大截 id 序列
  function prevCells(g) {
    const map = new Map();
    for (const ch of g.children || []) {
      if (ch.cell) map.set(ch.cell.r + "," + ch.cell.c, ch);
    }
    return map;
  }

  // 表格允许的最小包围盒：随行列数增长（压高度时先卡住，不让行高缩到看不清）
  function minSize(g) {
    if (!isTable(g)) return { w: MIN_W, h: MIN_H };
    const rows = clampInt(g.table.rows, MIN, MAX, 1);
    const cols = clampInt(g.table.cols, MIN, MAX, 1);
    return {
      w: Math.max(MIN_W, cols * MIN_COL_W),
      h: Math.max(MIN_H, rows * MIN_ROW_H),
    };
  }

  function cellShape(g, r, c, x, y, w, h, header, text, id) {
    const P = palette();
    return {
      id: id || null,
      type: "rect",
      x, y, w, h, angle: 0, z: 1,
      layer: g.layer || "l1",
      lock: false,
      text,
      cell: { r, c },
      style: {
        fill: header ? P.headerFill : P.bodyFill,
        line: P.line,
        lineWidth: 1,
        cornerRadius: 0,
        opacity: 1,
        // 单元格文字内缩 8px：4px 的默认内边距贴在网格线上太挤
        font: {
          family: "Segoe UI", size: 12, color: P.text,
          bold: header, align: "left", vAlign: "middle", padding: 8,
        },
      },
    };
  }

  // 依据 g.x/y/w/h + g.table 重建单元格；opts.ids=false 用于缩略图（不占用形状 id）
  function build(g, opts) {
    if (!isTable(g)) return g;
    const ids = !(opts && opts.ids === false);
    const rows = clampInt(g.table.rows, MIN, MAX, 1);
    const cols = clampInt(g.table.cols, MIN, MAX, 1);
    const withHeader = !!g.table.header;
    // 旧文档里可能存着修复前拖出来的被压扁的包围盒，构建时抬回下限（缩略图用 320×160 的临时组，不受影响）
    const mn = minSize(g);
    g.w = Math.max(mn.w, g.w || 0);
    g.h = Math.max(mn.h, g.h || 0);
    const cw = g.w / cols, ch = g.h / rows;
    const prev = prevCells(g);
    const cells = [];

    for (let r = 0; r < rows; r++) {
      const head = withHeader && r === 0;
      for (let c = 0; c < cols; c++) {
        const old = prev.get(r + "," + c);
        // 表头没被改过时给「列 1/列 2…」，正文默认留空；已有单元格一律沿用其文字（含清空）
        const text = old ? (old.text == null ? "" : old.text) : (head ? "列 " + (c + 1) : "");
        const id = ids ? ((old && old.id) || VX.Model.nextId()) : null;
        cells.push(cellShape(g, r, c, g.x + c * cw, g.y + r * ch, cw, ch, head, text, id));
      }
    }
    g.children = cells;
    g.table = Object.assign({}, g.table, { rows, cols });
    return g;
  }

  // 行列数变化：以当前单元格宽高为基准，加行/列向外扩张（不压扁已有单元格）
  function setGrid(g, rows, cols) {
    if (!isTable(g)) return g;
    const r = clampInt(rows, MIN, MAX, g.table.rows);
    const c = clampInt(cols, MIN, MAX, g.table.cols);
    if (r === g.table.rows && c === g.table.cols) return g;
    const cw = g.w / g.table.cols, ch = g.h / g.table.rows;
    g.table = Object.assign({}, g.table, { rows: r, cols: c });
    const mn = minSize(g);
    // 取整存包围盒：属性面板的宽/高是整数步进，留下 533.299… 会被浏览器标成非法值
    g.w = Math.max(Math.round(cw * c), mn.w);
    g.h = Math.max(Math.round(ch * r), mn.h);
    return build(g);
  }

  function setHeader(g, on) {
    if (!isTable(g) || !!g.table.header === !!on) return g;
    g.table = Object.assign({}, g.table, { header: !!on });
    return build(g);
  }

  // 位置/尺寸写入后重建（组的子形状是世界坐标，单独改 g.x/g.w 不会带动单元格）
  function resize(g, box) {
    if (!isTable(g)) return g;
    const mn = minSize(g);
    if (box.x != null) g.x = box.x;
    if (box.y != null) g.y = box.y;
    if (box.w != null) g.w = Math.max(mn.w, box.w);
    if (box.h != null) g.h = Math.max(mn.h, box.h);
    return build(g);
  }

  VX.Table = { MIN, MAX, MIN_W, MIN_H, MIN_COL_W, MIN_ROW_H, isTable, minSize, build, setGrid, setHeader, resize };
})();
