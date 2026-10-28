// tools.js —— 交互工具（P1）：选择（移动/缩放/旋转/框选/参考线拖拽）/ 矩形 / 椭圆 / 文本
"use strict";

(function () {
  const S = () => VX.state;

  let drag = null; // 当前拖拽会话

  // ---------- 吸附 ----------
  function snapVal(v) {
    if (!S().grid) return v;
    const g = S().gridSize;
    return Math.round(v / g) * g;
  }

  // 移动吸附：网格 + 参考线（边缘/中心对齐参考线）
  function snapMove(sel, dx, dy) {
    const z = VX.Viewport.zoom;
    const tol = 5 / z;
    let best = null;

    const tryLine = (dir, pos, delta) => {
      if (Math.abs(delta) < tol && (!best || Math.abs(delta) < Math.abs(best.delta))) {
        best = { dir, pos, delta };
      }
    };

    const shapes = sel.map((id) => VX.Model.shape(id)).filter(Boolean);
    for (const s of shapes) {
      const b = rotatedBounds(s);
      const bx = b.x + dx, by = b.y + dy; // 拖拽后的实时位置（delta 相对当前位移计算，命中后 dx+=delta 恰好对齐）
      for (const g of VX.Model.page().guides) {
        if (g.dir === "v") {
          tryLine("v", g.pos, g.pos - bx);
          tryLine("v", g.pos, g.pos - (bx + b.w / 2));
          tryLine("v", g.pos, g.pos - (bx + b.w));
        } else {
          tryLine("h", g.pos, g.pos - by);
          tryLine("h", g.pos, g.pos - (by + b.h / 2));
          tryLine("h", g.pos, g.pos - (by + b.h));
        }
      }
    }

    if (best) {
      if (best.dir === "v") dx += best.delta; else dy += best.delta;
      S().alignLines = [{ dir: best.dir, pos: best.pos }];
    } else {
      S().alignLines = [];
      if (S().grid) {
        // 网格吸附：对第一个形状的左上角吸附
        const s0 = shapes[0];
        if (s0) {
          const gx = snapVal(s0.x + dx) - s0.x;
          const gy = snapVal(s0.y + dy) - s0.y;
          dx = gx; dy = gy;
        }
      }
    }
    return { dx, dy };
  }

  function snapResize(x, y, w, h) {
    if (!S().grid) return { x, y, w, h };
    return { x: snapVal(x), y: snapVal(y), w: Math.round(w / S().gridSize) * S().gridSize, h: Math.round(h / S().gridSize) * S().gridSize };
  }

  function rotatedBounds(s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const cos = Math.abs(Math.cos(s.angle || 0)), sin = Math.abs(Math.sin(s.angle || 0));
    const w = s.w * cos + s.h * sin, h = s.w * sin + s.h * cos;
    return { x: cx - w / 2, y: cy - h / 2, w, h };
  }

  // ---------- 文本就地编辑 ----------
  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");

  function openTextEditor(shape) {
    closeTextEditor(true);
    const vp = VX.Viewport;
    const scroll = document.getElementById("canvas-scroll");
    const ta = document.createElement("textarea");
    ta.id = "text-editor";
    ta.value = shape.text || "";

    const p = vp.w2s(shape.x, shape.y);
    const f = (shape.style && shape.style.font) || { size: 14, family: "Segoe UI", color: "#333", align: "left" };
    Object.assign(ta.style, {
      position: "absolute",
      left: p.x + "px",
      top: p.y + "px",
      width: shape.w * vp.zoom + "px",
      height: Math.max(shape.h * vp.zoom, f.size * vp.zoom * 1.6) + "px",
      font: `${f.bold ? "bold " : ""}${f.size * vp.zoom}px '${f.family}'`,
      color: f.color || "#333",
      textAlign: f.align || "left",
      lineHeight: "1.3",
      border: "1px solid #2f6fed",
      padding: "2px 4px",
      resize: "none",
      outline: "none",
      background: "#fff",
      boxSizing: "border-box",
    });
    scroll.appendChild(ta);
    ta.focus();
    S().editing = shape.id;

    const commit = (cancel) => {
      const id = S().editing;
      S().editing = null;
      ta.remove();
      if (cancel) { VX.Renderer.invalidate(); return; }
      const s = VX.Model.shape(id);
      if (!s) return;
      const text = ta.value;
      if (!text.trim()) {
        VX.History.run("删除文本", () => VX.Model.removeShapes([id]));
      } else {
        VX.History.run("编辑文本", () => {
          VX.Model.updateShape(id, { text });
          autosizeText(VX.Model.shape(id));
        });
      }
      VX.Events.emit("selection");
      VX.Renderer.invalidate();
    };

    ta.addEventListener("blur", () => { if (S().editing === shape.id) commit(false); });
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { ta.blur(); commit(true); }
      if (e.key === "Enter" && e.ctrlKey) { ta.blur(); }
    });
  }

  function closeTextEditor(commitIt) {
    const ta = document.getElementById("text-editor");
    if (ta) {
      if (commitIt) ta.blur();
      else ta.remove();
    }
  }

  function autosizeText(s) {
    if (!s || !s.text) return;
    const f = s.style.font;
    measureCtx.font = `${f.bold ? "bold " : ""}${f.size}px '${f.family}'`;
    const lines = VX.Renderer.wrapText(s.text, s.w - 8, (t) => measureCtx.measureText(t).width);
    const lh = f.size * 1.3;
    const need = lines.length * lh + 8;
    if (need > s.h || s.type === "text") s.h = Math.max(need, 20);
  }

  // ---------- 连接线分段拖拽 ----------
  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  // 命中连接线折线的第几段（-1 = 未命中）
  function connSegmentAt(s, w) {
    const pts = VX.Routing.pointsOf(s);
    if (!pts || pts.length < 2) return -1;
    const tol = 6 / VX.Viewport.zoom;
    let best = -1, bestD = tol;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSeg(w.x, w.y, pts[i], pts[i + 1]);
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // ---------- 选择工具 ----------
  const selectTool = {
    cursor: "default",
    down(w, sc, e) {
      closeTextEditor(true);
      // 1) 手柄命中（单选）
      if (S().selection.length === 1) {
        const s = VX.Model.shape(S().selection[0]);
        if (s) {
          const h = hitHandle(s, sc);
          if (h) {
            drag = h.id === "rot"
              ? { mode: "rotate", shape: s, cx: s.x + s.w / 2, cy: s.y + s.h / 2, startAngle: s.angle || 0 }
              : { mode: "resize", shape: s, handle: h.id, start: Object.assign({}, s) };
            return;
          }
        }
      }
      // 2) 参考线命中
      const g = VX.Hit.guideAt(w.x, w.y);
      if (g) {
        drag = { mode: "guide", index: g.index, startPos: VX.Model.page().guides[g.index].pos, moved: false, screenStart: sc };
        S().selGuides = [g.index];
        S().selection = [];
        VX.Events.emit("selection");
        return;
      }
      // 3) 形状命中 → 选中 + 准备移动
      const shape = VX.Hit.shapeAt(w.x, w.y);
      if (shape) {
        if (e.shiftKey) {
          const i = S().selection.indexOf(shape.id);
          if (i >= 0) S().selection.splice(i, 1); else S().selection.push(shape.id);
        } else if (!S().selection.includes(shape.id)) {
          S().selection = [shape.id];
        }
        S().selGuides = [];
        VX.Events.emit("selection");

        let ids = S().selection.slice();
        if (e.altKey) {
          // Alt 拖拽 = 复制后移动副本
          VX.History.run("复制", () => {
            ids = ids.map((id) => {
              const c = VX.Model.duplicateShape(id);
              return c ? c.id : null;
            }).filter(Boolean);
          });
          S().selection = ids;
        }
        if (shape.type === "connector") {
          const seg = connSegmentAt(shape, w);
          if (seg >= 0) {
            drag = {
              mode: "connseg",
              conn: shape,
              seg,
              pts: VX.Routing.pointsOf(shape).map((p) => ({ x: p.x, y: p.y })),
              startW: w,
              moved: false,
            };
            return;
          }
        }
        drag = {
          mode: "move",
          ids,
          start: ids.map((id) => { const s = VX.Model.shape(id); return { id, x: s.x, y: s.y }; }),
          startW: w,
          moved: false,
        };
        return;
      }
      // 4) 空白 → 框选（组编辑模式下点击组外空白则先退出组）
      if (S().enterGroup && !VX.Hit.inAABB(VX.Model.shape(S().enterGroup) || {}, w.x, w.y)) {
        S().enterGroup = null;
      }
      if (!e.shiftKey) { S().selection = []; S().selGuides = []; VX.Events.emit("selection"); }
      drag = { mode: "marquee", startW: w, additive: e.shiftKey, base: S().selection.slice() };
    },

    move(w, sc, e) {
      if (!drag) return;
      if (drag.mode === "move") {
        let dx = w.x - drag.startW.x, dy = w.y - drag.startW.y;
        const sn = snapMove(drag.ids, dx, dy);
        dx = sn.dx; dy = sn.dy;
        if (Math.abs(dx) + Math.abs(dy) > 0.01) drag.moved = true;
        if (drag.moved && !drag.begun) { VX.History.begin(); drag.begun = true; }
        for (const p of drag.start) {
          const s = VX.Model.shape(p.id);
          if (!s) continue;
          if (s.type === "group") {
            const ddx = p.x + dx - s.x, ddy = p.y + dy - s.y;
            VX.Model.moveShapeBy(s, ddx, ddy); // 组：递归平移子形状
          } else {
            VX.Model.updateShape(p.id, { x: p.x + dx, y: p.y + dy });
          }
        }
      } else if (drag.mode === "connseg") {
        const c = drag.conn;
        const a = drag.pts[drag.seg], b = drag.pts[drag.seg + 1];
        const horiz = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
        let dx = 0, dy = 0;
        if (horiz) {
          dy = w.y - drag.startW.y;
          if (S().grid) dy = snapVal(a.y + dy) - a.y;
        } else {
          dx = w.x - drag.startW.x;
          if (S().grid) dx = snapVal(a.x + dx) - a.x;
        }
        if (!dx && !dy) return;
        if (!drag.moved) { VX.History.begin(); drag.moved = true; }
        // 粘附端点保持不动，其余折点随该段平移
        const gluedBegin = !!(c.glue && c.glue.begin);
        const gluedEnd = !!(c.glue && c.glue.end);
        const pts = drag.pts.map((p, i) => {
          if (i !== drag.seg && i !== drag.seg + 1) return { x: p.x, y: p.y };
          if (i === 0 && gluedBegin) return { x: p.x, y: p.y };
          if (i === drag.pts.length - 1 && gluedEnd) return { x: p.x, y: p.y };
          return { x: p.x + dx, y: p.y + dy };
        });
        const upd = { route: "manual", points: pts };
        if (!gluedBegin) upd.begin = pts[0];
        if (!gluedEnd) upd.end = pts[pts.length - 1];
        VX.Model.updateShape(c.id, upd);
      } else if (drag.mode === "resize") {
        resizeShape(drag.shape, drag.handle, drag.start, w, e.shiftKey);
      } else if (drag.mode === "rotate") {
        let ang = Math.atan2(w.y - drag.cy, w.x - drag.cx) + Math.PI / 2;
        if (e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); // 15° 吸附
        VX.Model.updateShape(drag.shape.id, { angle: ang });
      } else if (drag.mode === "marquee") {
        S().marquee = { x1: drag.startW.x, y1: drag.startW.y, x2: w.x, y2: w.y };
      } else if (drag.mode === "guide") {
        const g = VX.Model.page().guides[drag.index];
        if (g) {
          const delta = g.dir === "v" ? w.x - drag.startPos : w.y - drag.startPos;
          if (Math.abs(delta) > 2 / VX.Viewport.zoom) drag.moved = true;
          g.pos = g.dir === "v" ? w.x : w.y;
        }
      } else if (drag.mode === "create") {
        const x = snapVal(Math.min(drag.startW.x, w.x));
        const y = snapVal(Math.min(drag.startW.y, w.y));
        const wi = Math.max(Math.abs(w.x - drag.startW.x), 1);
        const hi = Math.max(Math.abs(w.y - drag.startW.y), 1);
        VX.Model.updateShape(drag.shape.id, { x, y, w: snapVal(wi) || 1, h: snapVal(hi) || 1 });
      }
      VX.Renderer.invalidate();
    },

    up(w, sc, e) {
      if (!drag) return;
      if (drag.mode === "move" && drag.begun) {
        VX.History.commit("移动");
        S().alignLines = [];
      } else if (drag.mode === "connseg") {
        if (drag.moved) VX.History.commit("移动连接线段");
      } else if (drag.mode === "marquee") {
        const m = S().marquee;
        if (m) {
          const x1 = Math.min(m.x1, m.x2), x2 = Math.max(m.x1, m.x2);
          const y1 = Math.min(m.y1, m.y2), y2 = Math.max(m.y1, m.y2);
          const hits = VX.Model.shapes().filter((s) => {
            const b = rotatedBounds(s);
            return b.x < x2 && b.x + b.w > x1 && b.y < y2 && b.y + b.h > y1;
          }).map((s) => s.id);
          S().selection = drag.additive ? Array.from(new Set(drag.base.concat(hits))) : hits;
          VX.Events.emit("selection");
        }
        S().marquee = null;
      } else if (drag.mode === "guide") {
        // 拖回标尺区域 = 删除
        const onRuler = (drag.gDir === "v" && sc.y < 22) || (drag.gDir === "h" && sc.x < 22);
        const g = VX.Model.page().guides[drag.index];
        const onRulerNow = g ? (g.dir === "v" ? sc.y < 22 : sc.x < 22) : false;
        const g2 = drag.index;
        if (onRulerNow) {
          const dir = VX.Model.page().guides[g2].dir;
          VX.History.run("删除参考线", () => { VX.Model.page().guides.splice(g2, 1); });
          S().selGuides = [];
        } else if (!drag.moved) {
          // 单击选择参考线（不动模型，不入历史）
        } else {
          VX.History.commit("移动参考线");
        }
      } else if (drag.mode === "create") {
        const s = VX.Model.shape(drag.shape.id);
        if (s && s.w < 6 && s.h < 6) {
          VX.Model.updateShape(s.id, { x: snapVal(drag.startW.x), y: snapVal(drag.startW.y), w: 120, h: 80 });
        }
        VX.History.commit("创建" + drag.label);
        S().selection = [drag.shape.id];
        VX.Events.emit("selection");
        if (drag.toolAfter === "text") openTextEditor(VX.Model.shape(drag.shape.id));
      } else if (drag.mode === "guide2") { /* 未用 */ }
      drag = null;
      VX.Renderer.invalidate();
    },

    dblclick(w, sc, e) {
      const shape = VX.Hit.shapeAt(w.x, w.y);
      if (shape) {
        if (shape.type === "panel") {
          // 双击动态面板 → 进入当前状态编辑
          const st = VX.Model.panelState(shape);
          S().panelEdit = { panelId: shape.id, stateId: st ? st.id : null };
          S().enterGroup = null;
          S().selection = [];
          VX.Events.emit("selection");
          VX.Events.emit("paneledit");
          VX.Renderer.invalidate();
          return;
        }
        if (shape.type === "group") {
          // 双击组 → 进入组内编辑（组内模式下双击子组则逐层深入）
          S().enterGroup = shape.id;
          S().selection = [];
          VX.Events.emit("selection");
          VX.Renderer.invalidate();
          return;
        }
        S().selection = [shape.id];
        VX.Events.emit("selection");
        openTextEditor(shape);
      }
    },
  };

  function hitHandle(s, sc) {
    if (s.type === "connector") return null; // 连接线无缩放手柄
    const z = VX.Viewport.zoom;
    for (const h of VX.Overlay.handlesOf(s)) {
      if (s.type === "group" && h.id === "rot") continue; // 组不旋转
      const p = VX.Viewport.w2s(h.x, h.y);
      const r = h.id === "rot" ? 7 : 6;
      if (Math.abs(sc.x - p.x) <= r && Math.abs(sc.y - p.y) <= r) return h;
    }
    return null;
  }

  // 局部空间缩放（支持旋转形状；group 按包围盒比例缩放子形状）
  function resizeShape(s, handle, start, w, shift) {
    const cx = start.x + start.w / 2, cy = start.y + start.h / 2;
    const ang = start.angle || 0;
    const cos = Math.cos(-ang), sin = Math.sin(-ang);
    // 鼠标点 → 局部坐标（相对原中心）
    const dx = w.x - cx, dy = w.y - cy;
    const lx = dx * cos - dy * sin, ly = dx * sin + dy * cos;

    let x0 = -start.w / 2, y0 = -start.h / 2, x1 = start.w / 2, y1 = start.h / 2;
    if (handle.includes("w")) x0 = Math.min(lx, x1 - 4);
    if (handle.includes("e")) x1 = Math.max(lx, x0 + 4);
    if (handle.includes("n")) y0 = Math.min(ly, y1 - 4);
    if (handle.includes("s")) y1 = Math.max(ly, y0 + 4);

    if (shift && handle.length === 2) {
      const ratio = start.w / start.h;
      const h2 = (x1 - x0) / ratio;
      if (handle.includes("n")) y0 = y1 - h2; else y1 = y0 + h2;
    }

    const nw = x1 - x0, nh = y1 - y0;
    // 新中心（局部）→ 世界
    const ncx = (x0 + x1) / 2, ncy = (y0 + y1) / 2;
    const cos2 = Math.cos(ang), sin2 = Math.sin(ang);
    const wx = cx + ncx * cos2 - ncy * sin2;
    const wy = cy + ncx * sin2 + ncy * cos2;

    let x = wx - nw / 2, y = wy - nh / 2;
    if (!start.angle) {
      const sn = snapResize(x, y, nw, nh);
      x = sn.x; y = sn.y; // 吸附左上角，P1 可接受
    }
    VX.Model.updateShape(s.id, { x, y, w: nw, h: nh });

    // 组：子形状按旧包围盒 → 新包围盒线性映射
    if (s.type === "group" && start.w > 0.5 && start.h > 0.5) {
      const kx = nw / start.w, ky = nh / start.h;
      for (const ch of s.children || []) {
        ch.x = x + (ch.x - start.x) * kx;
        ch.y = y + (ch.y - start.y) * ky;
        if (ch.type !== "group") { ch.w = Math.max(4, ch.w * kx); ch.h = Math.max(4, ch.h * ky); }
      }
    }
  }

  // ---------- 创建工具（矩形/椭圆） ----------
  function makeCreateTool(type, label) {
    return {
      cursor: "crosshair",
      down(w, sc, e) {
        closeTextEditor(true);
        const x = snapVal(w.x), y = snapVal(w.y);
        VX.History.begin();
        const s = VX.Model.addShape(type, { x, y, w: 1, h: 1 });
        drag = { mode: "create", shape: s, startW: { x: w.x, y: w.y }, label, toolAfter: S().tool };
        S().selection = [s.id];
        VX.Events.emit("selection");
      },
      move(w, sc, e) { if (drag && drag.mode === "create") selectTool.move(w, sc, e); },
      up(w, sc, e) { if (drag && drag.mode === "create") selectTool.up(w, sc, e); },
      dblclick() {},
    };
  }

  // ---------- 文本工具 ----------
  const textTool = {
    cursor: "text",
    down(w, sc, e) {
      closeTextEditor(true);
      const x = snapVal(w.x), y = snapVal(w.y);
      VX.History.begin();
      const s = VX.Model.addShape("text", { x, y, w: 160, h: 28, text: "文本" });
      VX.History.commit("创建文本");
      S().selection = [s.id];
      VX.Events.emit("selection");
      openTextEditor(s);
    },
    move() {},
    up() {},
    dblclick() {},
  };

  // ---------- 连接线工具 ----------
  const connectorTool = {
    cursor: "crosshair",
    down(w, sc, e) {
      closeTextEditor(true);
      const hit = VX.Hit.shapeAndAnchor(w.x, w.y);
      const begin = hit ? VX.Routing.anchorOf(hit.shape, hit.anchor) : { x: w.x, y: w.y };
      drag = {
        mode: "conn",
        beginGlue: hit ? hit.shape.id + ":" + hit.anchor : null,
        begin,
        endGlue: null,
      };
      S().rubberConn = { begin, cur: begin };
    },
    move(w, sc, e) {
      if (!drag || drag.mode !== "conn") return;
      const hit = VX.Hit.shapeAndAnchor(w.x, w.y);
      drag.endGlue = hit ? hit.shape.id + ":" + hit.anchor : null;
      S().rubberConn = {
        begin: drag.begin,
        cur: hit ? VX.Routing.anchorOf(hit.shape, hit.anchor) : { x: w.x, y: w.y },
      };
    },
    up(w, sc, e) {
      if (!drag || drag.mode !== "conn") return;
      const hit = VX.Hit.shapeAndAnchor(w.x, w.y);
      const end = hit ? VX.Routing.anchorOf(hit.shape, hit.anchor) : { x: w.x, y: w.y };
      const moved = Math.hypot(end.x - drag.begin.x, end.y - drag.begin.y) > 3 / VX.Viewport.zoom;
      const props = {
        type: "connector",
        glue: { begin: drag.beginGlue, end: hit ? hit.shape.id + ":" + hit.anchor : null },
        begin: drag.begin,
        end,
        route: "ortho",
      };
      S().rubberConn = null;
      drag = null;
      if (moved) {
        let id;
        VX.History.run("创建连接线", () => { id = VX.Model.addShape("connector", props).id; });
        S().selection = [id];
        VX.Events.emit("selection");
      }
      VX.Tools.set("select");
    },
    dblclick() {},
  };

  const tools = {
    select: selectTool,
    rect: makeCreateTool("rect", "矩形"),
    ellipse: makeCreateTool("ellipse", "椭圆"),
    text: textTool,
    connector: connectorTool,
    image: selectTool,     // P3 接入图片插入
  };

  const Tools = {
    current() { return tools[S().tool] || selectTool; },
    set(name) { if (tools[name]) { S().tool = name; VX.Events.emit("tool"); } },
    openTextEditor,   // 供外部（快捷键 F2 等）使用
    closeTextEditor,
    beginHistory() { VX.History.begin(); },
    commitHistory(label) { VX.History.commit(label); },

    // 由 editor.js 转发的事件（screen 坐标基于画布）
    onMouseDown(w, sc, e) { this.current().down(w, sc, e); },
    onMouseMove(w, sc, e) { this.current().move(w, sc, e); },
    onMouseUp(w, sc, e) { this.current().up(w, sc, e); },
    onDoubleClick(w, sc, e) { this.current().dblclick(w, sc, e); },
  };

  VX.Tools = Tools;
})();
