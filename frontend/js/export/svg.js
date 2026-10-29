// svg.js —— 当前页面 → 矢量 SVG（CODEPLAN §7-A1 提前接入：与 PNG/HTML 同为导出基础）
// 目标不是「差不多」而是与 Canvas 渲染同口径，因此几何全部照抄 renderer.js 的画法：
//   · 圆角矩形用 arcTo 展开成 A 段（不用 <rect rx>：Visio 允许圆角大于半边长，rx 语义不同）
//   · path 子路径按 path.design 相对包围盒缩放，开合由 path.closed[] 显式声明
//   · 箭头取端部切线，字形尺寸沿用 Visio lendN 的 ARROW_GLYPH 比例表
// 文本换行复用 VX.Renderer.wrapText + 离屏 2D 上下文测量：SVG 没有「按宽度折行」的原生能力，
// 只能在导出时算好行，写成多个 <text>（浏览器无需二次排版，缩放/打印都稳定）
"use strict";

(function () {
  const R3 = (v) => String(Math.round(v * 1000) / 1000);   // 去掉浮点尾巴，SVG 体积与可读性都更好

  // 与 renderer.fontString 同一条回退链：字体不一致会让文本宽度与画布差一截
  function fontCss(f) {
    f = f || {};
    return `${f.bold ? "bold " : ""}${f.size || 14}px '${f.family || "Segoe UI"}', Arial, Helvetica, 'Microsoft YaHei', sans-serif`;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // 测量用离屏上下文：只用来 measureText（与 renderer 里 fillText 的度量一致）
  let mctx = null;
  function measureCtx() {
    if (!mctx) mctx = document.createElement("canvas").getContext("2d");
    return mctx;
  }

  // 颜色：transparent / 空值 → SVG 里必须写成 none，否则会被当成黑色
  function paint(v, fallback) {
    if (!v || v === "transparent" || v === "none") return fallback || "none";
    return v;
  }

  const DASH_PATTERNS = {
    dash: [4, 3], dot: [1.2, 2.4], dashDot: [4, 2.4, 1.2, 2.4], dashDotDot: [4, 2.4, 1.2, 2.4, 1.2, 2.4],
  };
  function dashAttr(st, lw) {
    const pat = st && st.dash ? DASH_PATTERNS[st.dash] : null;
    if (!pat) return "";
    const k = Math.max(1, lw || 1);
    return ` stroke-dasharray="${pat.map((v) => R3(v * k)).join(" ")}"`;
  }

  // 圆角矩形 d 段：与 renderer.roundRectPath 的 arcTo 序列一一对应
  // arcTo(x1,y1,x2,y2,r) 在 SVG 里＝「当前点到 tangent1 上切点画圆弧」，
  // 这里按 canvas 的实现直接展开成 A 命令（半角 θ = 90°，切点距 = r·tan(45°)=r）
  function roundRectD(x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (!rad) return `M${R3(x)} ${R3(y)}H${R3(x + w)}V${R3(y + h)}H${R3(x)}Z`;
    return [
      `M${R3(x + rad)} ${R3(y)}`,
      `H${R3(x + w - rad)}`,
      `A${rad} ${rad} 0 0 1 ${R3(x + w)} ${R3(y + rad)}`,
      `V${R3(y + h - rad)}`,
      `A${rad} ${rad} 0 0 1 ${R3(x + w - rad)} ${R3(y + h)}`,
      `H${R3(x + rad)}`,
      `A${rad} ${rad} 0 0 1 ${R3(x)} ${R3(y + h - rad)}`,
      `V${R3(y + rad)}`,
      `A${rad} ${rad} 0 0 1 ${R3(x + rad)} ${R3(y)}`,
      "Z",
    ].join("");
  }

  // path 子路径 → d：局部坐标（原点=包围盒中心）按 design 缩放，闭合与否看 path.closed[]
  function pathD(s) {
    const ks = VX.Geometry.pathScale(s);
    const subpaths = (s.path && s.path.subpaths) || [];
    const flags = (s.path && Array.isArray(s.path.closed)) ? s.path.closed : null;
    let d = "";
    for (let k = 0; k < subpaths.length; k++) {
      const ring = subpaths[k];
      if (!ring || !ring.length) continue;
      for (let i = 0; i < ring.length; i++) {
        d += (i ? "L" : "M") + R3(ring[i].x * ks.kx) + " " + R3(ring[i].y * ks.ky) + " ";
      }
      if (!flags || flags[k] !== false) d += "Z";
    }
    return d.trim();
  }

  // ---- 箭头：与 renderer.drawArrow 同一套字形表，只是把变换算进坐标而不是 ctx.translate/rotate ----
  const ARROW_GLYPH = {
    open: { len: 1, half: 1 }, arrow: { len: 2, half: 1 }, triangle: { len: 3, half: 1 },
    bar: { len: 1, half: 1 }, dot: { len: 1.5, half: 0.75 }, square: { len: 1.5, half: 0.75 },
    diamond: { len: 4.5, half: 1.125 },
  };
  const ARROW_SIZE_SCALE = [0.55, 0.7, 1, 1.3, 1.6, 1.9, 2.2];
  function arrowScale(level) {
    if (typeof level !== "number" || !isFinite(level)) return 1;
    return ARROW_SIZE_SCALE[Math.max(0, Math.min(6, Math.round(level)))];
  }
  function arrowKind(kind, flag) {
    if (typeof kind === "string" && kind) return kind;
    return flag ? "arrow" : "none";
  }

  // 局部(x,y)（+x 朝尖端）→ 世界坐标
  function mkPt(tip, ang) {
    const cos = Math.cos(ang), sin = Math.sin(ang);
    return (lx, ly) => ({ x: tip.x + lx * cos - ly * sin, y: tip.y + lx * sin + ly * cos });
  }

  function arrowSvg(from, tip, kind, lw, sizeLevel, color) {
    if (!kind || kind === "none") return "";
    const dx = tip.x - from.x, dy = tip.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.001) return "";
    const ang = Math.atan2(dy, dx);
    const u = (Math.max(0.5, lw) + 2.5) * arrowScale(sizeLevel);
    const g = ARROW_GLYPH[kind] || ARROW_GLYPH.arrow;
    const L = u * g.len, H = u * g.half;
    const P = mkPt(tip, ang);
    const w = Math.max(1.2, lw);
    const pts = (arr) => arr.map((p) => R3(p.x) + "," + R3(p.y)).join(" ");

    if (kind === "dot") {
      // 圆点在局部坐标是 (x=-H, y=0) 的圆：旋转不改变圆，直接取圆心
      const c = P(-H, 0);
      return `<circle cx="${R3(c.x)}" cy="${R3(c.y)}" r="${R3(H)}" fill="${color}"/>`;
    }
    if (kind === "square") {
      // Visio 类型 11：以端点为心的实心方块（四角在局部坐标是 (±H, ±H)）
      const q = [P(H, -H), P(-H, -H), P(-H, H), P(H, H)];
      return `<polygon points="${pts(q)}" fill="${color}"/>`;
    }
    if (kind === "bar") {
      const a = P(H, -H), b = P(-H, H);
      return `<line x1="${R3(a.x)}" y1="${R3(a.y)}" x2="${R3(b.x)}" y2="${R3(b.y)}" stroke="${color}" stroke-width="${R3(w)}"/>`;
    }
    if (kind === "diamond") {
      const q = [P(0, 0), P(-L / 2, -H), P(-L, 0), P(-L / 2, H)];
      return `<polygon points="${pts(q)}" fill="none" stroke="${color}" stroke-width="${R3(w)}" stroke-linejoin="miter"/>`;
    }
    if (kind === "open") {
      const q = [P(-L, -H), P(0, 0), P(-L, H)];
      return `<polyline points="${pts(q)}" fill="none" stroke="${color}" stroke-width="${R3(w)}" stroke-linejoin="miter"/>`;
    }
    const tri = [P(0, 0), P(-L, -H), P(-L, H)];
    if (kind === "triangle") {
      return `<polygon points="${pts(tri)}" fill="none" stroke="${color}" stroke-width="${R3(w)}" stroke-linejoin="miter"/>`;
    }
    return `<polygon points="${pts(tri)}" fill="${color}"/>`;
  }

  // ---- 文本 ----
  function textSvg(s, st, hw, hh) {
    const text = s.text;
    if (text == null || text === "") return "";
    const f = st.font || {};
    const c = measureCtx();
    c.font = fontCss(f);
    const pad = 4;
    const lines = VX.Renderer.wrapText(text, s.w - pad * 2, (t) => c.measureText(t).width);
    const lh = (f.size || 14) * 1.3;
    const totalH = lines.length * lh;
    let ty = f.vAlign === "middle" ? -totalH / 2 + lh / 2
           : f.vAlign === "bottom" ? hh - pad - totalH + lh / 2
           : -hh + pad + lh / 2;
    const anchor = f.align === "center" ? "middle" : f.align === "right" ? "end" : "start";
    const tx = f.align === "center" ? 0 : f.align === "right" ? hw - pad : -hw + pad;
    // dominant-baseline=central ≈ canvas 的 textBaseline="middle"
    const bold = f.bold ? ' font-weight="bold"' : "";
    // 逐行一个 <text>：y 必须每次重新拼（不能先拼好再改属性）
    const head = "<text x=\"" + R3(tx) + "\"" +
      ' fill="' + paint(f.color, "#333333") + '"' +
      ' font-family="' + familyAttr(f) + '"' +
      ' font-size="' + (f.size || 14) + '"' + bold +
      ' text-anchor="' + anchor + '" dominant-baseline="central"';
    let out = "";
    for (const line of lines) {
      out += head + ' y="' + R3(ty) + '">' + esc(line) + "</text>";
      ty += lh;
    }
    return out;
  }

  // 字体栈：首选字体加双引号（名字含空格），回退用通用名
  const FONT_STACK = "Arial, Helvetica, Microsoft YaHei, sans-serif";
  function familyAttr(f) {
    return esc('"' + ((f && f.family) || "Segoe UI") + '", ' + FONT_STACK);
  }

  // ---- 单个形状 ----
  function shapeSvg(s, ctx) {
    const ov = ctx.over ? ctx.over(s) : null;
    if (ov && ov.visible === false) return "";
    const offX = (ov && ov.dx) || 0, offY = (ov && ov.dy) || 0;
    const extraAlpha = (ov && ov.opacity != null) ? ov.opacity : 1;
    const text = (ov && ov.text != null) ? ov.text : s.text;
    const tr = (offX || offY) ? ` transform="translate(${R3(offX)} ${R3(offY)})"` : "";

    if (s.type === "connector") {
      const st = s.style || {};
      const lw = st.lineWidth || 1.5;
      const color = paint(st.line, "#37474f");
      const pts = VX.Routing.pointsOf(s);
      if (!pts || pts.length < 2) return "";
      let body = "";
      let beginFrom = pts[1], endFrom = pts[pts.length - 2];
      if (s.route === "curve") {
        const cv = VX.Routing.curveOf(s);
        if (!cv) return "";
        body = `<path d="M${R3(cv.A.x)} ${R3(cv.A.y)}C${R3(cv.c1.x)} ${R3(cv.c1.y)} ${R3(cv.c2.x)} ${R3(cv.c2.y)} ${R3(cv.B.x)} ${R3(cv.B.y)}"` +
          ` fill="none" stroke="${color}" stroke-width="${R3(lw)}"${dashAttr(st, lw)} stroke-linecap="round"/>`;
        beginFrom = cv.c1; endFrom = cv.c2;
      } else {
        body = `<polyline points="${pts.map((p) => R3(p.x) + "," + R3(p.y)).join(" ")}"` +
          ` fill="none" stroke="${color}" stroke-width="${R3(lw)}"${dashAttr(st, lw)}` +
          ` stroke-linecap="${st.dash ? "butt" : "round"}" stroke-linejoin="round"/>`;
      }
      const a1 = arrowSvg(endFrom, pts[pts.length - 1], arrowKind(st.arrowEndKind, st.arrowEnd !== false), lw, st.arrowEndSize, color);
      const a0 = arrowSvg(beginFrom, pts[0], arrowKind(st.arrowBeginKind, !!st.arrowBegin), lw, st.arrowBeginSize, color);
      let label = "";
      if (text) {
        const f = (s.style && s.style.font) || {};
        const c = measureCtx();
        c.font = fontCss(f);
        let best = 0, bi = 0;
        for (let i = 0; i < pts.length - 1; i++) {
          const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
          if (len > best) { best = len; bi = i; }
        }
        const mx = (pts[bi].x + pts[bi + 1].x) / 2, my = (pts[bi].y + pts[bi + 1].y) / 2;
        const lines = VX.Renderer.wrapText(text, 240, (t) => c.measureText(t).width);
        const lh = (f.size || 12) * 1.25;
        let ty = my - (lines.length - 1) * lh / 2;
        const head = "<text x=\"" + R3(mx) + "\"" +
          ' fill="' + paint(f.color, "#333333") + '"' +
          ' font-family="' + familyAttr(f) + '"' +
          ' font-size="' + (f.size || 12) + '" text-anchor="middle" dominant-baseline="central">';
        for (const line of lines) {
          label += head + ' y="' + R3(ty) + '">' + esc(line) + "</text>";
          ty += lh;
        }
      }
      return `<g data-vx-id="${esc(s.id)}"${tr}>${body}${a0}${a1}${label}</g>`;
    }

    if (s.type === "group") {
      let inner = "";
      for (const ch of s.children || []) inner += shapeSvg(ch, ctx);
      return `<g data-vx-id="${esc(s.id)}"${tr}>${inner}</g>`;
    }

    if (s.type === "panel") {
      // 只画当前状态（编辑态的虚线示意边界属于编辑器，不进导出）
      let stObj = null;
      if (ov && ov.state) stObj = VX.Model.panelStateById(s, ov.state) || VX.Model.panelState(s);
      else stObj = VX.Model.panelState(s);
      let inner = "";
      for (const ch of (stObj ? stObj.shapes || [] : [])) inner += shapeSvg(ch, ctx);
      return `<g data-vx-id="${esc(s.id)}"${tr}>${inner}</g>`;
    }

    const st = s.style || {};
    const alpha = (st.opacity != null ? st.opacity : 1) * extraAlpha;
    const hw = s.w / 2, hh = s.h / 2;
    // 与 renderer 一致：平移到中心再旋转，几何用局部坐标
    const t = `translate(${R3(s.x + hw)} ${R3(s.y + hh)})${s.angle ? " rotate(" + R3((s.angle * 180) / Math.PI) + ")" : ""}`;
    const fill = paint(st.fill);
    const stroke = paint(st.line);
    const lw = st.lineWidth || 0;
    const hasLine = stroke !== "none" && lw > 0;
    const lineAttr = hasLine
      ? ` stroke="${stroke}" stroke-width="${R3(lw)}"${dashAttr(st, lw)} stroke-linejoin="miter"`
      : "";

    let geo = "";
    if (s.type === "ellipse") {
      geo = `<ellipse cx="0" cy="0" rx="${R3(hw)}" ry="${R3(hh)}" fill="${fill}"${lineAttr}/>`;
    } else if (s.type === "path") {
      const rule = s.path && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd";
      geo = `<path d="${pathD(s)}" fill="${fill}"${hasLine ? ` fill-rule="${rule}"` : ""}${lineAttr}/>`;
    } else {
      const r = Math.min(st.cornerRadius || 0, hw, hh);
      geo = `<path d="${roundRectD(-hw, -hh, s.w, s.h, r)}" fill="${fill}"${lineAttr}/>`;
    }
    const txt = text ? textSvg(Object.assign({}, s, { text }), st, hw, hh) : "";
    return `<g data-vx-id="${esc(s.id)}" transform="${t}"${alpha < 1 ? ` opacity="${R3(alpha)}"` : ""}>${geo}${txt}</g>`;
  }

  // 页面 → SVG 字符串
  // opt: { transparent: 不铺页面背景, over(shape): 交互覆盖（HTML 导出/预览用）, width/height: 覆盖输出尺寸 }
  function svg(page, opt) {
    const o = opt || {};
    const W = o.width || page.size.w, H = o.height || page.size.h;
    const parts = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>\n`);
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${R3(W)}" height="${R3(H)}"` +
      ` viewBox="0 0 ${R3(page.size.w)} ${R3(page.size.h)}">`);
    parts.push(`<desc>Visioxure export: ${esc(page.name || "")}</desc>`);
    if (!o.transparent) parts.push(`<rect x="0" y="0" width="${R3(page.size.w)}" height="${R3(page.size.h)}" fill="${paint(page.background, "#ffffff")}"/>`);
    const ctx = { over: o.over };
    const shapes = (page.shapes || [])
      .filter((s) => {
        if (!s.layer) return true;
        const lay = (page.layers || []).find((l) => l.id === s.layer);
        return !lay || lay.visible !== false;   // 与 renderer.drawShapes 同口径：隐藏层不导出
      })
      .slice().sort((a, b) => (a.z || 0) - (b.z || 0));
    for (const s of shapes) {
      try { parts.push(shapeSvg(s, ctx)); }
      catch (e) { console.error("svg shape failed:", s && s.id, s && s.type, e); }
    }
    parts.push("</svg>");
    return parts.join("");
  }

  VX.ExportSvg = { svg, pathD, roundRectD, fontCss, arrowSvg };
})();
