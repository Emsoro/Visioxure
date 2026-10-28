// overlay.js —— 选择覆盖层 / 手柄 / 参考线 / 标尺（P1）
"use strict";

(function () {
  let rulerTop = null, rulerLeft = null;

  // 形状四角+边中+旋转柄（世界坐标，考虑旋转）
  function handlesOf(s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const cos = Math.cos(s.angle || 0), sin = Math.sin(s.angle || 0);
    const local = [
      ["nw", -s.w / 2, -s.h / 2], ["n", 0, -s.h / 2], ["ne", s.w / 2, -s.h / 2],
      ["e", s.w / 2, 0], ["se", s.w / 2, s.h / 2], ["s", 0, s.h / 2],
      ["sw", -s.w / 2, s.h / 2], ["w", -s.w / 2, 0],
    ];
    const out = local.map(([id, lx, ly]) => ({
      id, x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos,
    }));
    const rotOff = -s.h / 2 - 24 / Math.max(VX.Viewport.zoom, 0.5); // 旋转柄在上方 24 屏幕像素
    out.push({ id: "rot", x: cx - rotOff * sin, y: cy + rotOff * cos });
    return out;
  }

  function drawSelection(c, vp) {
    const sel = VX.state.selection;
    if (!sel.length) return;
    const z = vp.zoom;

    // 每个选中形状画外框
    for (const id of sel) {
      const s = VX.Model.shape(id);
      if (!s) continue;

      // 连接线：高亮布线折线 + 两端圆点（无缩放手柄）
      if (s.type === "connector") {
        const pts = VX.Routing.pointsOf(s);
        if (pts && pts.length > 1) {
          const isCurve = s.route === "curve";
          const cv = isCurve ? VX.Routing.curveOf(s) : null;
          c.save();
          c.beginPath();
          if (cv) {
            const a = vp.w2s(cv.A.x, cv.A.y), c1 = vp.w2s(cv.c1.x, cv.c1.y);
            const c2 = vp.w2s(cv.c2.x, cv.c2.y), b = vp.w2s(cv.B.x, cv.B.y);
            c.moveTo(a.x, a.y);
            c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y);
          } else {
            for (let i = 0; i < pts.length; i++) {
              const q = vp.w2s(pts[i].x, pts[i].y);
              if (i) c.lineTo(q.x, q.y); else c.moveTo(q.x, q.y);
            }
          }
          c.strokeStyle = "#2f6fed";
          c.lineWidth = 2;
          c.stroke();
          // 每段中点的小方块（可拖动整段）；曲线不显示，避免弧线上排满控制点
          if (!isCurve) {
            for (let i = 0; i < pts.length - 1; i++) {
              const q = vp.w2s((pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
              c.fillStyle = "#ffffff";
              c.fillRect(q.x - 3.5, q.y - 3.5, 7, 7);
              c.strokeStyle = "#2f6fed";
              c.lineWidth = 1;
              c.strokeRect(q.x - 3 + 0.5, q.y - 3 + 0.5, 6, 6);
            }
          }
          // 端点手柄：可拖拽重新吸附到其他形状的连接点（悬停/拖拽时放大高亮）
          const hce = VX.state.hoverConnEnd;
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
          c.restore();
        }
        continue;
      }

      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      c.save();
      c.translate(vp.w2s(cx, cy).x, vp.w2s(cx, cy).y);
      c.rotate(s.angle || 0);
      const hw = (s.w * z) / 2, hh = (s.h * z) / 2;
      c.strokeStyle = "#2f6fed";
      c.lineWidth = 1;
      c.strokeRect(-hw - 0.5, -hh - 0.5, hw * 2 + 1, hh * 2 + 1);
      // 单选时画手柄
      if (sel.length === 1) {
        c.fillStyle = "#ffffff";
        for (const h of handlesOf(s)) {
          if (s.type === "group" && h.id === "rot") continue; // 组不旋转
          const lp = { x: (h.x - cx) * z, y: (h.y - cy) * z }; // 相对中心的屏幕偏移（已含旋转，需反向旋转）
          const cos = Math.cos(-(s.angle || 0)), sin = Math.sin(-(s.angle || 0));
          const px = lp.x * cos - lp.y * sin, py = lp.x * sin + lp.y * cos;
          if (h.id === "rot") {
            c.beginPath();
            c.arc(px, py, 4.5, 0, Math.PI * 2);
            c.fill(); c.stroke();
          } else {
            c.fillRect(px - 4, py - 4, 8, 8);
            c.strokeRect(px - 4 + 0.5, py - 4 + 0.5, 7, 7);
          }
        }
      }
      c.restore();
    }

    // 多选：整体包围盒
    if (sel.length > 1) {
      const bounds = selectionBounds();
      if (bounds) {
        const p1 = vp.w2s(bounds.x, bounds.y);
        c.strokeStyle = "rgba(47,111,237,0.6)";
        c.setLineDash([4, 3]);
        c.strokeRect(p1.x + 0.5, p1.y + 0.5, bounds.w * z, bounds.h * z);
        c.setLineDash([]);
      }
    }
  }

  function selectionBounds() {
    const sel = VX.state.selection.map((id) => VX.Model.shape(id)).filter(Boolean);
    if (!sel.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const s of sel) {
      // 旋转后的包围盒
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      const cos = Math.abs(Math.cos(s.angle || 0)), sin = Math.abs(Math.sin(s.angle || 0));
      const w = s.w * cos + s.h * sin, h = s.w * sin + s.h * cos;
      x1 = Math.min(x1, cx - w / 2); y1 = Math.min(y1, cy - h / 2);
      x2 = Math.max(x2, cx + w / 2); y2 = Math.max(y2, cy + h / 2);
    }
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  function drawGuides(c, vp, pg, w, h) {
    const selSet = new Set(VX.state.selGuides);
    pg.guides.forEach((g, i) => {
      const a = vp.w2s(g.dir === "v" ? g.pos : 0, g.dir === "h" ? g.pos : 0);
      c.strokeStyle = selSet.has(i) ? "#2f6fed" : "#d645b8";
      c.lineWidth = 1;
      c.beginPath();
      if (g.dir === "v") { c.moveTo(a.x + 0.5, 0); c.lineTo(a.x + 0.5, h); }
      else { c.moveTo(0, a.y + 0.5); c.lineTo(w, a.y + 0.5); }
      c.stroke();
    });
  }

  // 标尺：刻度随缩放自适应档位 + 鼠标位置指示
  function drawRulers() {
    if (!rulerTop || !rulerLeft) return;
    const vp = VX.Viewport;
    const dpr = window.devicePixelRatio || 1;
    const m = VX.state.mouse;
    drawOne(rulerTop, true, dpr, vp, m);
    drawOne(rulerLeft, false, dpr, vp, m);
  }

  function drawOne(rc, horizontal, dpr, vp, mouse) {
    let cssW = horizontal ? rc.clientWidth : 22;
    let cssH = horizontal ? 22 : rc.clientHeight;
    // 尺寸防御：容器尺寸异常时跳过本帧，防止标尺背板膨胀拖垮渲染进程
    if (cssW < 1 || cssH < 1 || cssW > 16384 || cssH > 16384) return;
    if (rc.width !== Math.round(cssW * dpr) || rc.height !== Math.round(cssH * dpr)) {
      rc.width = Math.round(cssW * dpr);
      rc.height = Math.round(cssH * dpr);
    }
    const c = rc.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, cssW, cssH);

    const z = vp.zoom;
    // 自适应主刻度：主刻度间距 ≥ 60 屏幕像素，从 1/2/5×10^n 档位选
    let major = 1;
    while (major * z < 60) major *= (String(major)[0] === "1" ? 5 : 2);
    const minor = major / (String(major)[0] === "5" ? 5 : major % 10 === 0 ? (String(major / 10)[0] === "5" ? 5 : 2) : 5);
    const len = horizontal ? cssW : cssH;
    const origin = horizontal ? vp.ox : vp.oy; // 屏幕坐标下 world=0 的位置
    const axisLen = horizontal ? 22 : 22;

    c.strokeStyle = "#d8dbe0";
    c.beginPath();
    if (horizontal) { c.moveTo(0, axisLen - 0.5); c.lineTo(len, axisLen - 0.5); }
    else { c.moveTo(axisLen - 0.5, 0); c.lineTo(axisLen - 0.5, len); }
    c.stroke();

    c.fillStyle = "#9aa0a8";
    c.font = "9px 'Segoe UI'";
    c.strokeStyle = "#c9cdd3";

    const startWorld = Math.floor((0 - origin) / z / minor) * minor;
    const endWorld = (len - origin) / z;
    for (let wv = startWorld; wv <= endWorld; wv += minor) {
      const pos = Math.round(wv * z + origin) + 0.5;
      const isMajor = Math.abs(wv / major - Math.round(wv / major)) < 1e-6;
      c.beginPath();
      if (horizontal) {
        c.moveTo(pos, isMajor ? axisLen - 9 : axisLen - 4);
        c.lineTo(pos, axisLen);
      } else {
        c.moveTo(isMajor ? axisLen - 9 : axisLen - 4, pos);
        c.lineTo(axisLen, pos);
      }
      c.stroke();
      if (isMajor && wv >= 0) {
        const label = String(Math.round(wv));
        if (horizontal) c.fillText(label, pos + 2, 9);
        else { c.save(); c.translate(9, pos - 2); c.rotate(-Math.PI / 2); c.fillText(label, 0, 0); c.restore(); }
      }
    }

    // 鼠标位置指示
    if (mouse && ((horizontal && mouse.y > 22) || (!horizontal && mouse.x > 22))) {
      const wpos = horizontal ? mouse.x : mouse.y;
      c.fillStyle = "#2f6fed";
      if (horizontal) c.fillRect(wpos - 0.5, 0, 1.5, axisLen);
      else c.fillRect(0, wpos - 0.5, axisLen, 1.5);
    }
  }

  const Overlay = {
    handlesOf,
    selectionBounds,
    drawSelection,
    drawGuides,
    drawRulers,
    attach(top, left) { rulerTop = top; rulerLeft = left; },
  };

  VX.Overlay = Overlay;
})();
