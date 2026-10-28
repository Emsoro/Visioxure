// stencils.js —— 形状库（P2）
// 分类定义 + 缩略图绘制；点击形状项在页面中心创建
// path 子路径为局部坐标（原点=形状中心），与 renderer/hit/geometry 约定一致
"use strict";

(function () {
  function polyDef(pts, w, h) {
    return { type: "path", w, h, path: { subpaths: [pts], fillRule: "evenodd" } };
  }

  const categories = [
    {
      name: "基本形状",
      items: [
        { id: "rect", name: "矩形", def: { type: "rect", w: 120, h: 80 } },
        { id: "roundrect", name: "圆角矩形", def: { type: "rect", w: 120, h: 80, style: { cornerRadius: 12 } } },
        { id: "ellipse", name: "椭圆", def: { type: "ellipse", w: 120, h: 90 } },
        { id: "circle", name: "圆形", def: { type: "ellipse", w: 90, h: 90 } },
        { id: "diamond", name: "菱形", def: polyDef([{ x: -60, y: 0 }, { x: 0, y: -45 }, { x: 60, y: 0 }, { x: 0, y: 45 }], 120, 90) },
        { id: "triangle", name: "三角形", def: polyDef([{ x: -60, y: 45 }, { x: 0, y: -45 }, { x: 60, y: 45 }], 120, 90) },
        { id: "parallelogram", name: "平行四边形", def: polyDef([{ x: -50, y: -35 }, { x: 60, y: -35 }, { x: 50, y: 35 }, { x: -60, y: 35 }], 120, 70) },
        { id: "trapezoid", name: "梯形", def: polyDef([{ x: -45, y: -35 }, { x: 45, y: -35 }, { x: 60, y: 35 }, { x: -60, y: 35 }], 120, 70) },
        { id: "arrowright", name: "右箭头", def: polyDef([{ x: -60, y: -15 }, { x: 10, y: -15 }, { x: 10, y: -35 }, { x: 60, y: 0 }, { x: 10, y: 35 }, { x: 10, y: 15 }, { x: -60, y: 15 }], 120, 70) },
        { id: "hexagon", name: "六边形", def: polyDef([{ x: -30, y: -45 }, { x: 30, y: -45 }, { x: 60, y: 0 }, { x: 30, y: 45 }, { x: -30, y: 45 }, { x: -60, y: 0 }], 120, 90) },
      ],
    },
    {
      name: "流程图",
      items: [
        { id: "fl-process", name: "过程", def: { type: "rect", w: 140, h: 60 } },
        { id: "fl-decision", name: "判定", def: polyDef([{ x: -70, y: 0 }, { x: 0, y: -40 }, { x: 70, y: 0 }, { x: 0, y: 40 }], 140, 80) },
        { id: "fl-terminator", name: "开始/结束", def: { type: "rect", w: 120, h: 50, style: { cornerRadius: 25 } } },
        { id: "fl-data", name: "数据", def: polyDef([{ x: -60, y: -30 }, { x: 70, y: -30 }, { x: 60, y: 30 }, { x: -70, y: 30 }], 140, 60) },
        { id: "fl-prep", name: "准备", def: polyDef([{ x: -70, y: -30 }, { x: 70, y: -30 }, { x: 60, y: 30 }, { x: -60, y: 30 }].map((p) => ({ x: p.x * 0.9, y: p.y })), 140, 60) },
        { id: "fl-connector", name: "连接符", def: { type: "ellipse", w: 60, h: 60 } },
        { id: "fl-document", name: "文档", def: polyDef([{ x: -70, y: -30 }, { x: 70, y: -30 }, { x: 70, y: 20 }, { x: 50, y: 32 }, { x: 30, y: 22 }, { x: 10, y: 34 }, { x: -10, y: 24 }, { x: -30, y: 36 }, { x: -50, y: 26 }, { x: -70, y: 34 }], 140, 70) },
        { id: "fl-database", name: "数据库", def: polyDef([{ x: -60, y: -30 }, { x: 60, y: -30 }, { x: 60, y: 25 }, { x: 45, y: 38 }, { x: -45, y: 38 }, { x: -60, y: 25 }, { x: -60, y: -30 }], 120, 70) },
      ],
    },
    {
      name: "Axure",
      items: [
        { id: "panel", name: "动态面板",
          def: { type: "panel", w: 240, h: 160, panel: { states: [{ id: "st1", name: "状态 1", shapes: [] }] } } },
      ],
    },
  ];

  // item.def 是共享模板——创建时深拷贝并补默认字段
  // 形状库图形统一：黑色边框 + 无填充
  function makeShapeProps(item, x, y) {
    const props = JSON.parse(JSON.stringify(item.def));
    props.x = x; props.y = y;
    const base = VX.Model.defaultStyleFor ? VX.Model.defaultStyleFor(props.type) : {};
    props.style = Object.assign(base, props.style || {}, { fill: "transparent", line: "#000000", lineWidth: 1.5 });
    return props;
  }

  // 左面板渲染：分类折叠 + 缩略图
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
        cv.width = 72; cv.height = 48;
        drawThumb(cv, item.def);
        const label = document.createElement("div");
        label.className = "stencil-name";
        label.textContent = item.name;
        cell.appendChild(cv);
        cell.appendChild(label);
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

  // 缩略图：按包围盒等比缩放绘制（黑色边框、无填充，与插入后的样式一致）
  function drawThumb(cv, def) {
    const c = cv.getContext("2d");
    const st = def.style || {};
    const pad = 6;
    const k = Math.min((cv.width - pad * 2) / def.w, (cv.height - pad * 2) / def.h);
    const ox = (cv.width - def.w * k) / 2, oy = (cv.height - def.h * k) / 2;
    c.save();
    c.translate(ox, oy);
    c.scale(k, k);
    c.beginPath();
    if (def.type === "ellipse") {
      c.ellipse(def.w / 2, def.h / 2, def.w / 2, def.h / 2, 0, 0, Math.PI * 2);
    } else if (def.type === "rect") {
      const r = Math.min(st.cornerRadius || 0, def.w / 2, def.h / 2);
      c.roundRect(0, 0, def.w, def.h, r);
    } else if (def.type === "panel") {
      c.rect(0, 0, def.w, def.h);
    } else if (def.type === "path") {
      for (const ring of def.path.subpaths) {
        ring.forEach((p, i) => {
          const px = p.x + def.w / 2, py = p.y + def.h / 2;
          if (i) c.lineTo(px, py); else c.moveTo(px, py);
        });
        c.closePath();
      }
    }
    c.strokeStyle = "#000000";
    if (def.type === "panel") c.setLineDash([4, 3]);
    c.lineWidth = 1.5 / k;
    c.stroke();
    c.setLineDash([]);
    c.restore();
  }

  VX.Stencils = { categories, renderPanel };
})();
