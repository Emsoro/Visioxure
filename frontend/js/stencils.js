// stencils.js —— 形状库（P2）
// 分类：基本形状 / 流程图 / 交互原型；点击条目在当前视口中心创建
// path 子路径为局部坐标（原点=形状中心），与 renderer/hit/geometry 约定一致
// 组合条目的 children 使用「左上角 = 0,0」的局部坐标，插入时整体平移
"use strict";

(function () {
  function polyDef(pts, w, h) {
    return { type: "path", w, h, path: { subpaths: [pts], fillRule: "evenodd" } };
  }

  // ---------- 形状库视觉规范 ----------
  // 缩略图与插入后的形状共用这一套色板，保证“所见即所得”且整库风格一致：
  // 统一主描边 ink / 次要描边 inkSoft / 中性浅底 surface，语义色（热区）单独保留。
  const SK = {
    ink: "#39434F",
    inkSoft: "#8B96A5",
    blob: "#C2CBD8",
    surface: "#EEF1F6",
    paper: "#FFFFFF",
    text: "#4A5462",
    textDim: "#8B96A5",
    warnFill: "#FFF3D1",
    warnLine: "#D9A62E",
    warnText: "#A87B0F",
    lineWidth: 1.4,
  };

  // ---------- 交互原型：组合构件的局部坐标小工具 ----------
  const FONT = { family: "Segoe UI", size: 13, color: SK.text, bold: false, align: "center", vAlign: "middle" };
  function font(patch) { return Object.assign({}, FONT, patch || {}); }
  function box(x, y, w, h, style) { return { type: "rect", x, y, w, h, style }; }
  function ellipse(x, y, w, h, style) { return { type: "ellipse", x, y, w, h, style }; }
  function poly(pts, x, y, w, h, style) {
    return { type: "path", x, y, w, h, path: { subpaths: [pts], fillRule: "evenodd" }, style };
  }
  function label(text, x, y, w, h, fontPatch) {
    return {
      type: "text", x, y, w, h, text,
      style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font(Object.assign({ align: "left" }, fontPatch || {})) },
    };
  }

  const categories = [
    {
      name: "基本形状",
      items: [
        { id: "rect", name: "矩形", def: { type: "rect", w: 120, h: 80 } },
        { id: "roundrect", name: "圆角矩形", def: { type: "rect", w: 120, h: 80, style: { cornerRadius: 12 } } },
        { id: "circle", name: "圆形", def: { type: "ellipse", w: 100, h: 100 } },
        { id: "triangle", name: "三角形", def: polyDef([{ x: -60, y: 45 }, { x: 0, y: -45 }, { x: 60, y: 45 }], 120, 90) },
        { id: "trapezoid", name: "梯形", def: polyDef([{ x: -45, y: -35 }, { x: 45, y: -35 }, { x: 60, y: 35 }, { x: -60, y: 35 }], 120, 70) },
      ],
    },
    {
      name: "流程图",
      items: [
        // 连接线：带箭头的正交折线（两端可在画布上拖动吸附到形状连接点）
        {
          id: "flow-connector", name: "连接线",
          def: { type: "connector", w: 160, h: 0, begin: { x: 0, y: 0 }, end: { x: 160, y: 0 }, route: "ortho" },
        },
        // 箭头：块状箭头（可缩放，常用于流程指向）
        {
          id: "flow-arrow", name: "箭头",
          def: polyDef([{ x: -60, y: -10 }, { x: 10, y: -10 }, { x: 10, y: -25 },
            { x: 60, y: 0 }, { x: 10, y: 25 }, { x: 10, y: 10 }, { x: -60, y: 10 }], 120, 50),
        },
      ],
    },
    {
      name: "交互原型",
      items: [
        {
          id: "proto-button", name: "按钮",
          def: {
            type: "rect", w: 100, h: 32, text: "按钮",
            style: { cornerRadius: 6, fill: SK.surface, line: SK.inkSoft, lineWidth: 1, font: font() },
          },
        },
        {
          id: "proto-textlabel", name: "文本标签",
          def: {
            type: "text", w: 120, h: 24, text: "文本标签",
            style: { fill: "transparent", line: "transparent", lineWidth: 0, font: font({ align: "left" }) },
          },
        },
        {
          id: "proto-textbox", name: "文本框",
          def: {
            type: "rect", w: 160, h: 32, text: "请输入…",
            style: { cornerRadius: 3, fill: SK.paper, line: SK.inkSoft, lineWidth: 1, font: font({ align: "left", color: SK.textDim }) },
          },
        },
        {
          id: "proto-select", name: "下拉列表",
          def: {
            type: "group", w: 160, h: 32,
            children: [
              box(0, 0, 160, 32, { fill: SK.paper, line: SK.inkSoft, lineWidth: 1, cornerRadius: 3 }),
              label("请选择", 8, 0, 110, 32),
              poly([{ x: -7, y: -4 }, { x: 7, y: -4 }, { x: 0, y: 4 }], 136, 12, 14, 8,
                { fill: SK.inkSoft, line: "transparent", lineWidth: 0 }),
            ],
          },
        },
        {
          id: "proto-checkbox", name: "复选框",
          def: {
            type: "group", w: 140, h: 24,
            children: [
              box(0, 4, 16, 16, { fill: SK.paper, line: SK.inkSoft, lineWidth: 1, cornerRadius: 2 }),
              label("复选框", 24, 0, 116, 24),
            ],
          },
        },
        {
          id: "proto-radio", name: "单选按钮",
          def: {
            type: "group", w: 140, h: 24,
            children: [
              ellipse(0, 4, 16, 16, { fill: SK.paper, line: SK.inkSoft, lineWidth: 1 }),
              label("单选按钮", 24, 0, 116, 24),
            ],
          },
        },
        {
          id: "proto-image", name: "图片占位",
          def: {
            type: "group", w: 120, h: 90,
            children: [
              box(0, 0, 120, 90, { fill: SK.surface, line: SK.inkSoft, lineWidth: 1 }),
              ellipse(76, 14, 14, 14, { fill: SK.blob, line: "transparent", lineWidth: 0 }),
              poly([{ x: -30, y: 17 }, { x: 0, y: -17 }, { x: 30, y: 17 }], 28, 42, 60, 34,
                { fill: SK.blob, line: "transparent", lineWidth: 0 }),
            ],
          },
        },
        {
          id: "proto-avatar", name: "人像占位",
          def: {
            type: "group", w: 90, h: 110,
            children: [
              box(0, 0, 90, 110, { fill: SK.surface, line: SK.inkSoft, lineWidth: 1 }),
              ellipse(32, 18, 26, 26, { fill: SK.blob, line: "transparent", lineWidth: 0 }),
              poly([{ x: -29, y: 19 }, { x: -19, y: -6 }, { x: 0, y: -15 }, { x: 19, y: -6 }, { x: 29, y: 19 }],
                16, 56, 58, 38, { fill: SK.blob, line: "transparent", lineWidth: 0 }),
            ],
          },
        },
        {
          id: "proto-placeholder", name: "通用占位",
          def: {
            type: "rect", w: 120, h: 90, text: "占位符",
            style: { fill: SK.surface, line: SK.inkSoft, lineWidth: 1, font: font({ color: SK.textDim }) },
          },
        },
        {
          id: "proto-panel", name: "动态面板",
          def: { type: "panel", w: 240, h: 160, panel: { states: [{ id: "st1", name: "状态 1", shapes: [] }] } },
        },
        {
          id: "proto-repeater", name: "中继器",
          def: {
            type: "rect", w: 200, h: 120, text: "中继器",
            style: { cornerRadius: 3, fill: SK.surface, line: SK.inkSoft, lineWidth: 1, font: font({ color: SK.textDim }) },
          },
        },
        {
          id: "proto-hotspot", name: "热区",
          def: {
            type: "rect", w: 160, h: 90, text: "热区",
            style: { cornerRadius: 3, fill: SK.warnFill, line: SK.warnLine, lineWidth: 1, font: font({ color: SK.warnText }) },
          },
        },
      ],
    },
  ];

  // ---------- 创建：深拷贝模板 + 补齐默认字段 ----------
  function offsetChildren(list, dx, dy) {
    for (const s of list || []) {
      s.x += dx; s.y += dy;
      if (s.type === "group") offsetChildren(s.children, dx, dy);
    }
  }

  function assignIds(list) {
    for (const s of list || []) {
      s.id = VX.Model.nextId();
      if (s.type === "group") assignIds(s.children);
    }
  }

  // 条目实际样式：默认「无填充 + 深灰描边」，条目 def.style 覆盖；
  // 无填充时字色落成深色（否则默认白字在白纸上不可见）
  function stencilStyle(def) {
    const base = VX.Model.defaultStyleFor ? VX.Model.defaultStyleFor(def.type) : {};
    const defStyle = def.style || {};
    const out = Object.assign(base, { fill: "transparent", line: SK.ink, lineWidth: SK.lineWidth }, defStyle);
    if (!defStyle.font && out.fill === "transparent") {
      out.font = Object.assign({}, base.font || {}, { color: SK.text });
    }
    return out;
  }

  // item.def 是共享模板——创建时深拷贝并补默认字段
  // 默认样式：黑色边框 + 无填充；条目 def.style 可覆盖（原型控件的浅底/灰字等）
  function makeShapeProps(item, x, y) {
    const props = JSON.parse(JSON.stringify(item.def));
    props.x = x; props.y = y;
    props.style = stencilStyle(props);

    if (props.type === "connector") {
      const b = props.begin || { x: 0, y: 0 };
      const e = props.end || { x: props.w || 160, y: 0 };
      props.begin = { x: x + b.x, y: y + b.y };
      props.end = { x: x + e.x, y: y + e.y };
      props.route = props.route || "ortho";
    }
    if (props.children) {
      offsetChildren(props.children, x, y);
      assignIds(props.children);
    }
    return props;
  }

  // 左面板渲染：分类标题 + 缩略图网格
  function renderPanel(rootEl) {
    rootEl.innerHTML = "";
    for (const cat of categories) {
      const head = document.createElement("div");
      head.className = "stencil-cat";
      head.textContent = cat.name;
      rootEl.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "stencil-grid";
      for (const item of cat.items) {
        const cell = document.createElement("div");
        cell.className = "stencil-item";
        cell.title = item.name;
        const cv = document.createElement("canvas");
        // 单条缩略图出错不能拖垮整个面板（否则后面的条目会整批消失）
        try {
          drawThumb(cv, item.def);
        } catch (e) {
          console.warn("stencil thumb failed:", item.id, e);
        }
        const labelEl = document.createElement("div");
        labelEl.className = "stencil-name";
        labelEl.textContent = item.name;
        cell.appendChild(cv);
        cell.appendChild(labelEl);
        cell.addEventListener("click", () => {
          // 在当前视口中心创建（网格吸附）
          const c = document.getElementById("canvas");
          const cx = c.clientWidth / 2, cy = c.clientHeight / 2;
          const wpt = VX.Viewport.s2w(cx, cy);
          const def = item.def;
          const x = Math.round((wpt.x - def.w / 2) / VX.state.gridSize) * VX.state.gridSize;
          const y = Math.round((wpt.y - def.h / 2) / VX.state.gridSize) * VX.state.gridSize;
          let id;
          VX.History.run("插入" + item.name, () => {
            id = VX.Model.addShape(def.type, makeShapeProps(item, x, y)).id;
          });
          VX.state.selection = [id];
          VX.state.enterGroup = null;
          VX.Events.emit("selection");
          VX.Renderer.invalidate();
        });
        grid.appendChild(cell);
      }
      rootEl.appendChild(grid);
    }
  }

  // ---------- 缩略图：按包围盒等比缩放，与插入后的样式一致 ----------
  // 缩略图画布逻辑尺寸（CSS px）；实际像素按 devicePixelRatio 放大，保证高分屏下线条不模糊
  const THUMB_W = 72, THUMB_H = 48;

  function drawThumb(cv, def) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(THUMB_W * dpr);
    cv.height = Math.round(THUMB_H * dpr);
    cv.style.aspectRatio = THUMB_W + " / " + THUMB_H;

    const c = cv.getContext("2d");
    if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineJoin = "round";
    c.lineCap = "round";

    // 统一的内边距：所有条目在单元格里留白一致，视觉重心才会齐
    const pad = 7;
    const w = Math.max(def.w || 1, 1), h = Math.max(def.h || 1, 1);
    const k = Math.min((THUMB_W - pad * 2) / w, (THUMB_H - pad * 2) / h);
    const ox = (THUMB_W - w * k) / 2, oy = (THUMB_H - h * k) / 2;
    c.save();
    c.translate(ox, oy);
    c.scale(k, k);
    drawThumbNode(c, def, k);
    c.restore();
  }

  // 节点绘制：坐标为条目局部坐标（左上角 = 0,0）
  // 圆角矩形：老版本 WebView2 没有 ctx.roundRect，退化为手写路径
  function thumbRoundRect(c, x, y, w, h, r) {
    if (typeof c.roundRect === "function") { c.roundRect(x, y, w, h, r || 0); return; }
    const rad = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    c.moveTo(x + rad, y);
    c.lineTo(x + w - rad, y);
    c.arcTo(x + w, y, x + w, y + rad, rad);
    c.lineTo(x + w, y + h - rad);
    c.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    c.lineTo(x + rad, y + h);
    c.arcTo(x, y + h, x, y + h - rad, rad);
    c.lineTo(x, y + rad);
    c.arcTo(x, y, x + rad, y, rad);
    c.closePath();
  }

  function drawThumbNode(c, s, k) {
    // 缩略图与插入后的效果一致：模板没写 style 的条目也套用统一色板的主描边
    const st = Object.assign(stencilStyle(s), s.style || {});
    if (s.type === "group") {
      for (const ch of s.children || []) drawThumbNode(c, ch, k);
      return;
    }
    if (s.type === "connector") {
      const y = (s.h || 0) / 2;
      const x1 = 4, x2 = Math.max((s.w || 120) - 4, x1 + 4);
      c.strokeStyle = SK.ink;
      c.lineWidth = SK.lineWidth / k;
      c.beginPath();
      c.moveTo(x1, y); c.lineTo(x2, y);
      c.stroke();
      const ah = 10;
      c.beginPath();
      c.moveTo(x2, y);
      c.lineTo(x2 - ah, y - ah * 0.55);
      c.lineTo(x2 - ah, y + ah * 0.55);
      c.closePath();
      c.fillStyle = SK.ink;
      c.fill();
      return;
    }
    if (s.type === "text") {
      drawThumbText(c, s, k, st, "left");
      return;
    }

    // rect / ellipse / path / panel
    const sx = s.x || 0, sy = s.y || 0;
    const cx = sx + (s.w || 0) / 2, cy = sy + (s.h || 0) / 2;
    c.save();
    c.translate(cx, cy);
    c.beginPath();
    if (s.type === "ellipse") {
      c.ellipse(0, 0, (s.w || 1) / 2, (s.h || 1) / 2, 0, 0, Math.PI * 2);
    } else if (s.type === "path") {
      for (const ring of (s.path && s.path.subpaths) || []) {
        ring.forEach((p, i) => { if (i) c.lineTo(p.x, p.y); else c.moveTo(p.x, p.y); });
        c.closePath();
      }
    } else {
      const r = Math.min(st.cornerRadius || 0, (s.w || 0) / 2, (s.h || 0) / 2);
      thumbRoundRect(c, -(s.w || 0) / 2, -(s.h || 0) / 2, s.w || 1, s.h || 1, r);
    }
    const hasFill = st.fill && st.fill !== "transparent";
    const hasLine = st.line && st.line !== "transparent" && (st.lineWidth == null || st.lineWidth > 0);
    if (hasFill) {
      c.fillStyle = st.fill;
      c.fill(s.type === "path" && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd");
    }
    if (hasLine) {
      c.strokeStyle = st.line;
      c.lineWidth = Math.max(st.lineWidth || 1, 0.5) / k;
      c.stroke();
    } else if (s.type === "panel") {
      c.strokeStyle = SK.inkSoft;
      c.lineWidth = SK.lineWidth / k;
      c.setLineDash([4 / k, 3 / k]);
      c.stroke();
      c.setLineDash([]);
    }
    c.restore();

    if (s.text) drawThumbText(c, s, k, st, st.font && st.font.align === "left" ? "left" : "center");
  }

  function drawThumbText(c, s, k, st, align) {
    const f = st.font || {};
    const size = f.size || 13;
    if (size * k < 4.2) return; // 太小，省略文字避免糊成一团
    // 小尺寸下略放大字号，保证缩略图里的标签依然可读
    const drawSize = Math.max(size, Math.min(9 / k, size * 1.6));
    const sx = s.x || 0, sy = s.y || 0;
    c.save();
    c.fillStyle = f.color || SK.text;
    c.font = `${f.bold ? "bold " : ""}${drawSize}px 'Segoe UI'`;
    c.textAlign = align === "center" ? "center" : "left";
    c.textBaseline = "middle";
    const tx = align === "center" ? sx + (s.w || 0) / 2 : sx + 3;
    c.fillText(s.text || "", tx, sy + (s.h || 0) / 2, Math.max((s.w || 0) - 6, 10));
    c.restore();
  }

  VX.Stencils = { categories, renderPanel };
})();
