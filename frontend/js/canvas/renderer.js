// renderer.js —— Canvas 2D 渲染器（P1）
// 脏标记 + rAF：仅在 dirty 时重绘（对齐 CODEPLAN.md §6 按需重绘策略）
"use strict";

(function () {
  let canvas = null, ctx = null, host = null; // host = #canvas-scroll，用于取容器尺寸

  function fontString(f) {
    return `${f.bold ? "bold " : ""}${f.size}px '${f.family}', 'Microsoft YaHei', sans-serif`;
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

  // 连接线：实时布线折线 + 端点箭头（世界坐标绘制）
  function drawConnector(c, s, label) {
    const pts = VX.Routing.pointsOf(s);
    if (!pts || pts.length < 2) return;
    const st = s.style || {};
    c.globalAlpha = st.opacity != null ? st.opacity : 1;
    c.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i) c.lineTo(pts[i].x, pts[i].y); else c.moveTo(pts[i].x, pts[i].y);
    }
    c.strokeStyle = st.line || "#37474f";
    c.lineWidth = st.lineWidth || 1.5;
    c.lineJoin = "round";
    c.stroke();
    if (st.arrowEnd !== false) drawArrowHead(c, pts[pts.length - 2], pts[pts.length - 1]);
    if (st.arrowBegin) drawArrowHead(c, pts[1], pts[0]);
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

  function drawArrowHead(c, from, to) {
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const size = 9;
    const a1 = ang + Math.PI * 0.85, a2 = ang - Math.PI * 0.85;
    c.beginPath();
    c.moveTo(to.x, to.y);
    c.lineTo(to.x + Math.cos(a1) * size, to.y + Math.sin(a1) * size);
    c.lineTo(to.x + Math.cos(a2) * size, to.y + Math.sin(a2) * size);
    c.closePath();
    c.fillStyle = c.strokeStyle;
    c.fill();
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
      c.roundRect(-hw, -hh, s.w, s.h, r);
    }
    if (hasFill) { c.fillStyle = st.fill; c.fill(s.type === "path" && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd"); }
    if (hasLine) { c.strokeStyle = st.line; c.lineWidth = st.lineWidth; c.stroke(); }

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
    for (const s of shapes) drawShape(c, s, vp, opts);
    c.restore();
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
