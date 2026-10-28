// renderer.js —— Canvas 2D 渲染器（P1）
// 脏标记 + rAF：仅在 dirty 时重绘（对齐 CODEPLAN.md §6 按需重绘策略）
"use strict";

(function () {
  let canvas = null, ctx = null, host = null; // host = #canvas-scroll，用于取容器尺寸

  function fontString(f) {
    return `${f.bold ? "bold " : ""}${f.size}px '${f.family}', 'Microsoft YaHei', sans-serif`;
  }

  // 圆角矩形路径：老版本 WebView2 没有 ctx.roundRect，退化为手写路径
  // （直接调用不存在的方法会抛异常，导致整帧渲染中断——后面的形状全部画不出来）
  function roundRectPath(c, x, y, w, h, r) {
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

  // 屏幕最小描边宽度：缩小视图时 1.5px 线条会淡到看不见
  function strokeWidth(w, zoom) {
    return Math.max(w || 0, 1 / (zoom || 1));
  }

  // 文本按宽度断行（逐字符，CJK 友好；P1 先支持单段落）
  function wrapText(text, maxWidth, measure) {
    const lines = [];
    for (const raw of String(text).split("\n")) {
      let line = "";
      for (const ch of raw) {
        if (measure(line + ch) > maxWidth && line) { lines.push(line); line = ch; }
        else line += ch;
      }
      lines.push(line);
    }
    return lines;
  }

  // 连接线：实时布线折线/曲线 + 两端箭头（世界坐标绘制）
  function drawConnector(c, s, label) {
    const st = s.style || {};
    const lw = strokeWidth(st.lineWidth || 1.5, VX.state.zoom);
    const color = st.line || "#37474f";
    const pts = VX.Routing.pointsOf(s);
    if (!pts || pts.length < 2) return;

    c.globalAlpha = st.opacity != null ? st.opacity : 1;
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.lineJoin = "round";
    c.lineCap = "round";

    // 箭头方向取端部切线：折线用相邻点，曲线用控制点
    let beginFrom = pts[1], endFrom = pts[pts.length - 2];
    if (s.route === "curve") {
      const cv = VX.Routing.curveOf(s);
      if (!cv) return;
      c.beginPath();
      c.moveTo(cv.A.x, cv.A.y);
      c.bezierCurveTo(cv.c1.x, cv.c1.y, cv.c2.x, cv.c2.y, cv.B.x, cv.B.y);
      c.stroke();
      beginFrom = cv.c1;
      endFrom = cv.c2;
    } else {
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i) c.lineTo(pts[i].x, pts[i].y); else c.moveTo(pts[i].x, pts[i].y);
      }
      c.stroke();
    }

    drawArrow(c, endFrom, pts[pts.length - 1], arrowKind(st.arrowEndKind, st.arrowEnd !== false), lw);
    drawArrow(c, beginFrom, pts[0], arrowKind(st.arrowBeginKind, !!st.arrowBegin), lw);

    c.globalAlpha = 1;
    if (label) drawConnectorLabel(c, s, pts, label);
  }

  // 连接线标注：放在最长线段中点
  function drawConnectorLabel(c, s, pts, label) {
    const f = (s.style && s.style.font) || {};
    let best = 0, bi = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
      if (len > best) { best = len; bi = i; }
    }
    const mx = (pts[bi].x + pts[bi + 1].x) / 2;
    const my = (pts[bi].y + pts[bi + 1].y) / 2;
    c.save();
    c.fillStyle = f.color || "#333333";
    c.font = fontString(f);
    c.textAlign = "center";
    c.textBaseline = "middle";
    const lines = wrapText(label, 240, (t) => c.measureText(t).width);
    const lh = (f.size || 12) * 1.25;
    let ty = my - (lines.length - 1) * lh / 2;
    for (const line of lines) { c.fillText(line, mx, ty); ty += lh; }
    c.restore();
  }

  // 箭头形状：旧布尔值（true/false）与新 kind 字符统一归一
  // kind：none / arrow（实心）/ open（开口）/ triangle（空心三角）/ dot（圆点）/ diamond（菱形）/ bar（竖线）
  function arrowKind(kind, flag) {
    if (typeof kind === "string" && kind) return kind;
    return flag ? "arrow" : "none";
  }

  // 在 tip 处按 from→tip 方向画箭头
  function drawArrow(c, from, tip, kind, lw) {
    if (!kind || kind === "none") return;
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const ang = Math.atan2(dy, dx);
    const size = 7 + Math.max(1, lw) * 2.2;
    const color = c.strokeStyle;
    c.save();
    c.lineWidth = Math.max(1.2, lw);
    c.lineJoin = "miter";
    if (kind === "open") {
      const a1 = ang + Math.PI * 0.8, a2 = ang - Math.PI * 0.8;
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(tip.x + Math.cos(a1) * size, tip.y + Math.sin(a1) * size);
      c.lineTo(tip.x, tip.y);
      c.lineTo(tip.x + Math.cos(a2) * size, tip.y + Math.sin(a2) * size);
      c.stroke();
    } else if (kind === "dot") {
      c.beginPath();
      c.arc(tip.x, tip.y, size * 0.45, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    } else if (kind === "diamond") {
      const half = size * 0.95, wing = size * 0.34;
      const nx = -Math.sin(ang) * wing, ny = Math.cos(ang) * wing;
      const mx = tip.x - Math.cos(ang) * half, my = tip.y - Math.sin(ang) * half;
      const bx = tip.x - Math.cos(ang) * half * 2, by = tip.y - Math.sin(ang) * half * 2;
      c.beginPath();
      c.moveTo(tip.x, tip.y);
      c.lineTo(mx + nx, my + ny);
      c.lineTo(bx, by);
      c.lineTo(mx - nx, my - ny);
      c.closePath();
      c.fillStyle = color;
      c.fill();
    } else if (kind === "bar") {
      const nx = -Math.sin(ang) * size * 0.72, ny = Math.cos(ang) * size * 0.72;
      c.strokeStyle = color;
      c.beginPath();
      c.moveTo(tip.x - nx, tip.y - ny);
      c.lineTo(tip.x + nx, tip.y + ny);
      c.stroke();
    } else {
      const a1 = ang + Math.PI * 0.86, a2 = ang - Math.PI * 0.86;
      c.beginPath();
      c.moveTo(tip.x, tip.y);
      c.lineTo(tip.x + Math.cos(a1) * size, tip.y + Math.sin(a1) * size);
      c.lineTo(tip.x + Math.cos(a2) * size, tip.y + Math.sin(a2) * size);
      c.closePath();
      c.strokeStyle = color;
      c.stroke();
      if (kind !== "triangle") { c.fillStyle = color; c.fill(); }
    }
    c.restore();
  }

  // opts: { editor:true, over(shape) → { visible, text, state, dx, dy, opacity } }（预览用）
  function drawShape(c, s, vp, opts) {
    const ov = (opts && opts.over) ? opts.over(s) : null;
    if (ov && ov.visible === false) return;
    const offX = (ov && ov.dx) || 0, offY = (ov && ov.dy) || 0;
    const extraAlpha = (ov && ov.opacity != null) ? ov.opacity : 1;
    const text = (ov && ov.text != null) ? ov.text : s.text;

    c.save();
    if (offX || offY) c.translate(offX, offY);

    // 连接线：不走"中心平移+旋转"管线，按实时布线折线绘制
    if (s.type === "connector") { drawConnector(c, s, text); c.restore(); return; }

    // 组合：递归绘制子形状（子形状为世界坐标；组不旋转——旋转在解组语义上作用于各子形状）
    if (s.type === "group") {
      for (const ch of s.children || []) drawShape(c, ch, vp, opts);
      c.restore();
      return;
    }

    // 动态面板：只画当前状态的子形状；编辑器里额外画虚线示意边界
    if (s.type === "panel") {
      if (opts && opts.editor) {
        c.strokeStyle = "#b9c2d0";
        c.lineWidth = 1 / (vp.zoom || 1);
        c.setLineDash([6 / (vp.zoom || 1), 4 / (vp.zoom || 1)]);
        c.strokeRect(s.x + 0.5 / (vp.zoom || 1), s.y + 0.5 / (vp.zoom || 1), Math.max(1, s.w), Math.max(1, s.h));
        c.setLineDash([]);
      }
      let stObj = null;
      if (ov && ov.state) stObj = VX.Model.panelStateById(s, ov.state) || VX.Model.panelState(s);
      else stObj = VX.Model.panelState(s);
      for (const ch of (stObj ? stObj.shapes || [] : [])) drawShape(c, ch, vp, opts);
      c.restore();
      return;
    }

    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    c.translate(cx, cy);
    if (s.angle) c.rotate(s.angle);
    const hw = s.w / 2, hh = s.h / 2;
    const st = s.style || {};
    const baseAlpha = st.opacity != null ? st.opacity : 1;
    c.globalAlpha = baseAlpha * extraAlpha;

    // 填充 + 轮廓
    const hasFill = st.fill && st.fill !== "transparent";
    const hasLine = st.line && st.line !== "transparent" && (st.lineWidth || 0) > 0;
    c.beginPath();
    if (s.type === "ellipse") {
      c.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    } else if (s.type === "path") {
      // 子路径为局部坐标（原点=包围盒中心）
      const subpaths = (s.path && s.path.subpaths) || [];
      for (const ring of subpaths) {
        for (let i = 0; i < ring.length; i++) {
          if (i) c.lineTo(ring[i].x, ring[i].y); else c.moveTo(ring[i].x, ring[i].y);
        }
        c.closePath();
      }
    } else {
      const r = Math.min(st.cornerRadius || 0, hw, hh);
      roundRectPath(c, -hw, -hh, s.w, s.h, r);
    }
    if (hasFill) { c.fillStyle = st.fill; c.fill(s.type === "path" && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd"); }
    if (hasLine) { c.strokeStyle = st.line; c.lineWidth = strokeWidth(st.lineWidth, vp.zoom); c.stroke(); }

    // 文本
    if (text) {
      const f = st.font || {};
      c.fillStyle = f.color || "#333333";
      c.font = fontString(f);
      const pad = 4;
      const lines = wrapText(text, s.w - pad * 2, (t) => c.measureText(t).width);
      const lh = (f.size || 14) * 1.3;
      const totalH = lines.length * lh;
      let ty = f.vAlign === "middle" ? -totalH / 2 + lh / 2
             : f.vAlign === "bottom" ? hh - pad - totalH + lh / 2
             : -hh + pad + lh / 2;
      c.textAlign = f.align === "center" ? "center" : f.align === "right" ? "right" : "left";
      const tx = f.align === "center" ? 0 : f.align === "right" ? hw - pad : -hw + pad;
      c.textBaseline = "middle";
      for (const line of lines) { c.fillText(line, tx, ty); ty += lh; }
      c.textAlign = "start";
    }
    c.restore();
  }

  // 形状层：世界坐标 → 视口变换
  function drawShapes(c, page, vp, opts) {
    c.save();
    c.translate(vp.ox, vp.oy);
    c.scale(vp.zoom, vp.zoom);
    const shapes = (page.shapes || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    // 单个形状绘制出错不能中断整帧（否则它之后的所有形状/选择框一起消失）
    for (const s of shapes) {
      c.save();
      try { drawShape(c, s, vp, opts); } catch (e) { console.error("draw shape failed:", s.id, s.type, e); }
      c.restore();
    }
    c.restore();
  }

  // 连接点：形状四边中点（与 routing.anchorOf 的 0=上/1=右/2=下/3=左 一致）
  // 显示时机：连接线工具激活（全部形状）/ 单选 / 悬停；吸附点高亮
  function canConnect(s) {
    return s && s.type !== "connector" && s.type !== "group" && VX.Hit.selectable(s);
  }

  function drawConnectionPoints(c, vp) {
    const st = VX.state;
    if (st.editing) return;
    const targets = [];
    const seen = new Set();
    const push = (s) => {
      if (!canConnect(s) || seen.has(s.id)) return;
      seen.add(s.id);
      targets.push(s);
    };
    if (st.tool === "connector" || st.connEndDrag) {
      const shapes = VX.Model.shapes();
      for (let i = 0; i < shapes.length && targets.length < 200; i++) push(shapes[i]);
    } else {
      if (st.selection.length === 1) push(VX.Model.shape(st.selection[0]));
      if (st.hoverShapeId) push(VX.Model.shape(st.hoverShapeId));
    }
    if (!targets.length) return;

    const ha = st.hoverAnchor;
    c.save();
    for (const s of targets) {
      for (let n = 0; n < 4; n++) {
        const a = VX.Routing.anchorOf(s, n);
        const p = vp.w2s(a.x, a.y);
        const active = !!(ha && ha.id === s.id && ha.index === n);
        const r = active ? 6 : 4;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fillStyle = active ? "#2f6fed" : "#ffffff";
        c.fill();
        c.lineWidth = active ? 2 : 1;
        c.strokeStyle = "#2f6fed";
        c.stroke();
        // 十字标记：强调“可连接点”（Office 风格）
        c.beginPath();
        c.strokeStyle = active ? "#ffffff" : "#2f6fed";
        c.lineWidth = 1;
        c.moveTo(p.x - 2, p.y + 0.5); c.lineTo(p.x + 2, p.y + 0.5);
        c.moveTo(p.x + 0.5, p.y - 2); c.lineTo(p.x + 0.5, p.y + 2);
        c.stroke();
      }
    }
    c.restore();
  }

  // 连接线端点手柄：悬停（未选中）时也显示，便于直接拖端点重新吸附
  function drawConnectorEnds(c, vp) {
    const st = VX.state;
    if (st.editing) return;
    const ids = [];
    if (st.hoverShapeId && !st.selection.includes(st.hoverShapeId)) ids.push(st.hoverShapeId);
    const hce = st.hoverConnEnd;
    if (hce && !st.selection.includes(hce.id) && ids.indexOf(hce.id) < 0) ids.push(hce.id);
    for (const id of ids) {
      const s = VX.Model.shape(id);
      if (!s || s.type !== "connector") continue;
      const pts = VX.Routing.pointsOf(s);
      if (!pts || pts.length < 2) continue;
      const ends = [[pts[0], "begin"], [pts[pts.length - 1], "end"]];
      for (const [p, which] of ends) {
        const q = vp.w2s(p.x, p.y);
        const active = !!(hce && hce.id === s.id && hce.which === which);
        c.beginPath();
        c.arc(q.x, q.y, active ? 6 : 4, 0, Math.PI * 2);
        c.fillStyle = active ? "#2f6fed" : "#ffffff";
        c.fill();
        c.strokeStyle = "#2f6fed";
        c.lineWidth = active ? 2 : 1;
        c.stroke();
      }
    }
  }

  function drawPage(c, pg, vp, opts) {
    const z = vp.zoom;
    const p0 = vp.w2s(0, 0);
    const pw = pg.size.w * z, ph = pg.size.h * z;

    // 页面阴影 + 白底
    c.save();
    c.shadowColor = "rgba(0,0,0,0.15)";
    c.shadowBlur = 12;
    c.shadowOffsetY = 3;
    c.fillStyle = "#ffffff";
    c.fillRect(p0.x, p0.y, pw, ph);
    c.restore();

    // 网格（页面内）；预览时由 opts.grid 关闭
    const showGrid = opts && opts.grid != null ? opts.grid : VX.state.grid;
    if (showGrid) {
      c.save();
      c.beginPath();
      c.rect(p0.x, p0.y, pw, ph);
      c.clip();
      c.strokeStyle = "#f0f2f5";
      c.lineWidth = 1;
      c.beginPath();
      const gs = VX.state.gridSize * z;
      const startX = p0.x, startY = p0.y;
      for (let x = startX; x <= startX + pw; x += gs) { c.moveTo(Math.round(x) + 0.5, startY); c.lineTo(Math.round(x) + 0.5, startY + ph); }
      for (let y = startY; y <= startY + ph; y += gs) { c.moveTo(startX, Math.round(y) + 0.5); c.lineTo(startX + pw, Math.round(y) + 0.5); }
      c.stroke();
      c.restore();
    }

    // 页面边框
    c.strokeStyle = "#d0d4da";
    c.lineWidth = 1;
    c.strokeRect(p0.x + 0.5, p0.y + 0.5, pw - 1, ph - 1);
  }

  function draw(c) {
    const vp = VX.Viewport;
    const dpr = window.devicePixelRatio || 1;
    const w = host ? host.clientWidth : canvas.clientWidth;
    const h = host ? host.clientHeight : canvas.clientHeight;
    // 同步 CSS 尺寸（canvas 默认 300×150，必须显式撑满容器）
    if (canvas.style.width !== w + "px") { canvas.style.width = w + "px"; canvas.style.height = h + "px"; }
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    c.fillStyle = "#e9ebee";
    c.fillRect(0, 0, w, h);

    const pg = VX.Model.page();
    if (!pg) return;
    drawPage(c, pg, vp, { grid: VX.state.grid });

    // 形状（z 升序）：世界坐标 → 视口（缩放 + 平移）
    drawShapes(c, pg, vp, { editor: true });

    // 连接点（悬停 / 单选 / 连接线工具）
    drawConnectionPoints(c, vp);
    // 连接线端点手柄（悬停时）
    drawConnectorEnds(c, vp);

    // 瞬态对齐线（吸附反馈）
    for (const line of VX.state.alignLines) {
      const a = vp.w2s(line.dir === "v" ? line.pos : 0, line.dir === "h" ? line.pos : 0);
      c.strokeStyle = "#e5484d";
      c.lineWidth = 1;
      c.beginPath();
      if (line.dir === "v") { c.moveTo(a.x + 0.5, 0); c.lineTo(a.x + 0.5, h); }
      else { c.moveTo(0, a.y + 0.5); c.lineTo(w, a.y + 0.5); }
      c.stroke();
    }

    // 框选矩形
    if (VX.state.marquee) {
      const m = VX.state.marquee;
      const p1 = vp.w2s(Math.min(m.x1, m.x2), Math.min(m.y1, m.y2));
      const p2 = vp.w2s(Math.max(m.x1, m.x2), Math.max(m.y1, m.y2));
      c.fillStyle = "rgba(47,111,237,0.08)";
      c.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      c.strokeStyle = "#2f6fed";
      c.lineWidth = 1;
      c.strokeRect(p1.x + 0.5, p1.y + 0.5, p2.x - p1.x - 1, p2.y - p1.y - 1);
    }

    // 参考线 + 选择覆盖层
    VX.Overlay.drawGuides(c, vp, pg, w, h);
    VX.Overlay.drawSelection(c, vp);

    // 连接线拖拽预览（虚线）
    if (VX.state.rubberConn) {
      const rc = VX.state.rubberConn;
      c.save();
      c.beginPath();
      c.moveTo(rc.begin.x, rc.begin.y);
      c.lineTo(rc.cur.x, rc.cur.y);
      c.strokeStyle = "#2f6fed";
      c.lineWidth = 1.5;
      c.setLineDash([5, 4]);
      c.stroke();
      c.restore();
    }
  }

  const Renderer = {
    attach(el) {
      canvas = el;
      host = el.parentElement;
      ctx = canvas.getContext("2d");
    },
    invalidate() { VX.state.dirty = true; },
    start() {
      const tick = () => {
        try {
          if (VX.state.dirty) {
            VX.state.dirty = false;
            draw(ctx);
            VX.Overlay.drawRulers();
          }
        } catch (e) {
          console.error("render error:", e);
          if (window.__tauricpp__) window.__tauricpp__.invoke("log_error", { message: "render: " + e.message + " @ " + (e.stack || "").split("\n")[1] });
          VX.state.dirty = false;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    wrapText,   // 供文本就地编辑测量复用

    // 预览/导出共用：把一页（可带交互覆盖）画到指定 2D 上下文
    drawScene(c, page, opts) {
      const vp = {
        zoom: opts.zoom, ox: opts.ox, oy: opts.oy,
        w2s(x, y) { return { x: x * this.zoom + this.ox, y: y * this.zoom + this.oy }; },
      };
      drawPage(c, page, vp, opts);
      drawShapes(c, page, vp, opts);
    },
  };

  VX.Renderer = Renderer;
})();
