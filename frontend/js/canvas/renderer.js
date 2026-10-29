// renderer.js —— Canvas 2D 渲染器（P1）
// 脏标记 + rAF：仅在 dirty 时重绘（对齐 CODEPLAN.md §6 按需重绘策略）
"use strict";

(function () {
  let canvas = null, ctx = null, host = null; // host = #canvas-scroll，用于取容器尺寸

  function fontString(f) {
    // 回退链：Visio 常用 Liberation Sans/Arial，本机没装时先退到 Arial 再退 CJK 字体；
    // 把中文字体排在前面会让拉丁字母的字距明显偏宽，文本行宽/换行位置跟不上 Visio
    return `${f.bold ? "bold " : ""}${f.size}px '${f.family}', Arial, Helvetica, 'Microsoft YaHei', sans-serif`;
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

  // 屏幕最小描边宽度：缩小视图时 1.5px 线条会淡到看不见。
  // 但这个「最小 1 屏幕像素」只属于编辑态：导出/预览的 scale 是靠 zoom 放大实现的，
  // 若照搬会让 2x/3x 导出和 PDF 的线比 1x 细（同样的世界线宽被不同的屏幕下限夹住），
  // 所以导出上下文（opts.exported）按真实世界线宽绘制
  function strokeWidth(w, zoom, exported) {
    if (exported) return Math.max(w || 0, 0.01);
    return Math.max(w || 0, 1 / (zoom || 1));
  }

  // 虚线样式 → Canvas 虚线数组：数值是世界单位，按线宽缩放（与 Visio 线型的观感一致）。
  // 对应 reader 的 style.dash（Visio LinePattern 2/3/4/5 及自定义图案）
  const DASH_PATTERNS = {
    dash: [4, 3],
    dot: [1.2, 2.4],
    dashDot: [4, 2.4, 1.2, 2.4],
    dashDotDot: [4, 2.4, 1.2, 2.4, 1.2, 2.4],
  };
  function applyDash(c, st, lw) {
    const pat = st && st.dash ? DASH_PATTERNS[st.dash] : null;
    if (!pat) return false;
    const k = Math.max(1, lw || 1);
    c.setLineDash(pat.map((v) => v * k));
    return true;
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
  function drawConnector(c, s, label, opts) {
    const st = s.style || {};
    const lw = strokeWidth(st.lineWidth || 1.5, opts && opts.zoom, opts && opts.exported);
    const color = st.line || "#37474f";
    const pts = VX.Routing.pointsOf(s);
    if (!pts || pts.length < 2) return;

    c.globalAlpha = st.opacity != null ? st.opacity : 1;
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.lineJoin = "round";
    c.lineCap = "round";
    // 虚线连接线（Visio LinePattern）：虚线用平头，否则圆头会把空隙补上
    const dashed = applyDash(c, st, lw);
    if (dashed) c.lineCap = "butt";

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

    if (dashed) c.setLineDash([]);
    drawArrow(c, endFrom, pts[pts.length - 1], arrowKind(st.arrowEndKind, st.arrowEnd !== false), lw, st.arrowEndSize);
    drawArrow(c, beginFrom, pts[0], arrowKind(st.arrowBeginKind, !!st.arrowBegin), lw, st.arrowBeginSize);

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
  // kind：none / arrow（实心）/ open（开口）/ triangle（空心三角）/ dot（圆点）/ diamond（菱形）/ square（方块）/ bar（斜线）
  function arrowKind(kind, flag) {
    if (typeof kind === "string" && kind) return kind;
    return flag ? "arrow" : "none";
  }

  // Visio 箭头尺寸级别 0~6 → 缩放系数（2 为默认/中等）
  const ARROW_SIZE_SCALE = [0.55, 0.7, 1, 1.3, 1.6, 1.9, 2.2];
  function arrowScale(level) {
    if (typeof level !== "number" || !isFinite(level)) return 1;
    return ARROW_SIZE_SCALE[Math.max(0, Math.min(6, Math.round(level)))];
  }

  // 各类型箭头字形（长 / 半宽，单位＝字形单位），取自 Visio SVG 导出里的 lendN 定义：
  // 开口箭头 1×1、实心箭头 2×1、空心三角 3×1、斜线 1×1、圆点/方块 1.5、空心菱形 4.5×1.125。
  // 统一按一个尺寸画会让开口箭头、圆点、方块明显偏大，三角形偏小
  const ARROW_GLYPH = {
    open: { len: 1, half: 1 },
    arrow: { len: 2, half: 1 },
    triangle: { len: 3, half: 1 },
    bar: { len: 1, half: 1 },
    dot: { len: 1.5, half: 0.75 },
    square: { len: 1.5, half: 0.75 },
    diamond: { len: 4.5, half: 1.125 },
  };

  // 在 tip 处按 from→tip 方向画箭头（局部坐标：+x 朝箭头尖，箭头体向 -x 延伸）
  function drawArrow(c, from, tip, kind, lw, sizeLevel) {
    if (!kind || kind === "none") return;
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return;
    const ang = Math.atan2(dy, dx);
    // 每字形单位 ≈ (线宽 + 2.5) px：线粗时箭头略大，但远不随线宽成比例膨胀
    const u = (Math.max(0.5, lw) + 2.5) * arrowScale(sizeLevel);
    const g = ARROW_GLYPH[kind] || ARROW_GLYPH.arrow;
    const L = u * g.len, H = u * g.half;
    const color = c.strokeStyle;
    c.save();
    c.translate(tip.x, tip.y);
    c.rotate(ang);
    c.lineWidth = Math.max(1.2, lw);
    c.lineJoin = "miter";
    c.lineCap = "butt";
    if (kind === "dot") {
      c.beginPath();
      c.arc(0, 0, H, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    } else if (kind === "square") {
      // Visio 类型 11：实心方块（以端点为心，随线段方向旋转）
      c.beginPath();
      c.rect(-H, -H, H * 2, H * 2);
      c.fillStyle = color;
      c.fill();
    } else if (kind === "bar") {
      // Visio 类型 9：45° 斜线，横跨线端
      c.beginPath();
      c.moveTo(H, -H);
      c.lineTo(-H, H);
      c.strokeStyle = color;
      c.stroke();
    } else if (kind === "diamond") {
      // Visio 类型 22：空心菱形（只描边）
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-L / 2, -H);
      c.lineTo(-L, 0);
      c.lineTo(-L / 2, H);
      c.closePath();
      c.strokeStyle = color;
      c.stroke();
    } else if (kind === "open") {
      c.beginPath();
      c.moveTo(-L, -H);
      c.lineTo(0, 0);
      c.lineTo(-L, H);
      c.strokeStyle = color;
      c.stroke();
    } else {
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(-L, -H);
      c.lineTo(-L, H);
      c.closePath();
      if (kind === "triangle") { c.strokeStyle = color; c.stroke(); }
      else { c.fillStyle = color; c.fill(); }
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
    if (s.type === "connector") { drawConnector(c, s, text, opts); c.restore(); return; }

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
      // 子路径为局部坐标（原点=包围盒中心），按包围盒相对设计尺寸缩放
      const subpaths = (s.path && s.path.subpaths) || [];
      const ks = VX.Geometry.pathScale(s);
      // 闭合与否由数据显式声明（`path.closed[i]`，由 reader 从 Visio 几何推导），
      // 默认闭合：形状库多边形、布尔运算结果都是无填充的闭合环，
      // 早先用「有填充或首尾重合」猜测会让透明填充的三角形/菱形缺一条闭合边
      const closedFlags = (s.path && Array.isArray(s.path.closed)) ? s.path.closed : null;
      for (let k = 0; k < subpaths.length; k++) {
        const ring = subpaths[k];
        if (!ring.length) continue;
        for (let i = 0; i < ring.length; i++) {
          if (i) c.lineTo(ring[i].x * ks.kx, ring[i].y * ks.ky); else c.moveTo(ring[i].x * ks.kx, ring[i].y * ks.ky);
        }
        // 开放折线（例：虚线引导线）不能闭合：闭合会凭空多出一条从终点回到起点的斜线
        if (!closedFlags || closedFlags[k] !== false) c.closePath();
      }
    } else {
      const r = Math.min(st.cornerRadius || 0, hw, hh);
      roundRectPath(c, -hw, -hh, s.w, s.h, r);
    }
    if (hasFill) { c.fillStyle = st.fill; c.fill(s.type === "path" && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd"); }
    if (hasLine) {
      c.strokeStyle = st.line;
      c.lineWidth = strokeWidth(st.lineWidth, vp.zoom, opts && opts.exported);
      const dashed = applyDash(c, st, c.lineWidth);
      c.stroke();
      if (dashed) c.setLineDash([]);
    }

    // 文本
    if (text) {
      const f = st.font || {};
      c.fillStyle = f.color || "#333333";
      c.font = fontString(f);
      // 文本内边距：默认 4px，表格单元格等紧凑网格用 font.padding 加宽
      const pad = f.padding != null ? f.padding : 4;
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
  // 图层可见性在这里过滤（而不是在绘制分支里）：隐藏的层既不显示也不应被导出，
  // 与 hit.selectable 的判定同源（锁定层仍然可见，只是不可选中）
  function layerVisible(page, s) {
    if (!s || !s.layer) return true;
    const lay = (page.layers || []).find((l) => l.id === s.layer);
    return !lay || lay.visible !== false;
  }

  function drawShapes(c, page, vp, opts) {
    c.save();
    c.translate(vp.ox, vp.oy);
    c.scale(vp.zoom, vp.zoom);
    const shapes = (page.shapes || []).filter((s) => layerVisible(page, s)).slice().sort((a, b) => (a.z || 0) - (b.z || 0));
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

    // 页面底色（页面设置里可改，默认白色）：编辑器里必画；导出时由调用方用 paintBg 决定——
    // PNG 透明导出要留空（默认跟 exported 走），HTML/原型运行时必须铺上，
    // 否则舞台那层灰（#e9ebee）会从页面里透出来，导出的页面看着就不是白的
    const exported = !!(opts && opts.exported);
    const paintBg = opts && opts.paintBg != null ? !!opts.paintBg : !exported;
    if (paintBg) {
      c.save();
      // 投影只是编辑器里把页面从灰底里浮出来，导出不带：投影会在页面四边糊出一圈灰边
      if (!exported) {
        c.shadowColor = "rgba(0,0,0,0.15)";
        c.shadowBlur = 12;
        c.shadowOffsetY = 3;
      }
      c.fillStyle = pg.background || "#ffffff";
      c.fillRect(p0.x, p0.y, pw, ph);
      c.restore();
    }

    // 网格（页面内）；预览与导出由 opts.grid 关闭
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

    // 页面边框：编辑器里靠它区分「页面」与「灰底」；导出产物不该带这圈浅灰框
    if (!exported) {
      c.strokeStyle = "#d0d4da";
      c.lineWidth = 1;
      c.strokeRect(p0.x + 0.5, p0.y + 0.5, pw - 1, ph - 1);
    }
  }

  function draw(c) {
    const vp = VX.Viewport;
    const dpr = window.devicePixelRatio || 1;
    const w = host ? host.clientWidth : canvas.clientWidth;
    const h = host ? host.clientHeight : canvas.clientHeight;
    // 尺寸防御：容器尺寸异常（布局未就绪/被内容反撑）时跳过本帧，避免背板像素爆炸导致渲染进程崩溃
    if (w < 1 || h < 1 || w > 16384 || h > 16384) return;
    // 同步 CSS 尺寸（canvas 为绝对定位，尺寸完全由此写入）
    if (canvas.style.width !== w + "px") canvas.style.width = w + "px";
    if (canvas.style.height !== h + "px") canvas.style.height = h + "px";
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
    // opts: { zoom, ox, oy, grid, over(shape), exported }
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
