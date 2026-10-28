// hit.js —— 命中测试（P1/P2）
// P2：path 精确命中（Path2D）、group 递归、connector 折线距离、图层可见/锁定过滤
"use strict";

(function () {
  // 离屏 2D 上下文：仅用于 isPointInPath/isPointInStroke 判定
  const mctx = document.createElement("canvas").getContext("2d");

  // 点是否在旋转形状包围盒内（粗判，局部 AABB）
  function inAABB(s, wx, wy) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    let dx = wx - cx, dy = wy - cy;
    if (s.angle) {
      const cos = Math.cos(-s.angle), sin = Math.sin(-s.angle);
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      dx = rx; dy = ry;
    }
    return dx >= -s.w / 2 && dx <= s.w / 2 && dy >= -s.h / 2 && dy <= s.h / 2;
  }

  // 世界 → 形状局部坐标（原点=中心，逆旋转）
  function toLocal(s, wx, wy) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    let dx = wx - cx, dy = wy - cy;
    if (s.angle) {
      const cos = Math.cos(-s.angle), sin = Math.sin(-s.angle);
      const rx = dx * cos - dy * sin, ry = dx * sin + dy * cos;
      dx = rx; dy = ry;
    }
    return { x: dx, y: dy };
  }

  function buildPath2D(s) {
    const p2d = new Path2D();
    const subpaths = (s.path && s.path.subpaths) || [];
    for (const ring of subpaths) {
      for (let i = 0; i < ring.length; i++) {
        if (i) p2d.lineTo(ring[i].x, ring[i].y); else p2d.moveTo(ring[i].x, ring[i].y);
      }
      p2d.closePath();
    }
    return p2d;
  }

  function inShape(s, wx, wy) {
    if (s.type === "connector") {
      return VX.Routing.distTo(s, wx, wy) <= 6 / VX.state.zoom;
    }
    if (s.type === "group") {
      if (!inAABB(s, wx, wy)) return false;
      return (s.children || []).some((ch) => !ch.lock && inShape(ch, wx, wy));
    }
    if (s.type === "panel") {
      if (!inAABB(s, wx, wy)) return false;
      const st = VX.Model.panelState(s);
      return st ? (st.shapes || []).some((ch) => !ch.lock && inShape(ch, wx, wy)) : false;
    }
    if (!inAABB(s, wx, wy)) return false;
    if (s.type === "path") {
      const loc = toLocal(s, wx, wy);
      const p2d = buildPath2D(s);
      const rule = s.path && s.path.fillRule === "nonzero" ? "nonzero" : "evenodd";
      if (mctx.isPointInPath(p2d, loc.x, loc.y, rule)) return true;
      // 命中描边（线宽 + 容差）
      const lw = (s.style && s.style.lineWidth) || 1;
      mctx.lineWidth = lw + 4;
      if (mctx.isPointInStroke(p2d, loc.x, loc.y)) return true;
      return false;
    }
    return true; // rect/ellipse/text/image 等 AABB 即可
  }

  // 图层可见/锁定过滤：隐藏层不可见，锁定层不可选中
  function selectable(s) {
    if (s.lock) return false;
    const lay = (VX.Model.page().layers || []).find((l) => l.id === s.layer);
    if (lay && (!lay.visible || lay.locked)) return false;
    return true;
  }

  const Hit = {
    // 返回命中的最上层形状（按 z 降序）；enterGroupId 设置时进入该组内部选择子形状
    shapeAt(wx, wy) {
      const shapes = VX.Model.shapes();
      const enter = VX.state.enterGroup;
      const pe = VX.state.panelEdit;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (pe && s.id === pe.panelId) {
          // 面板状态编辑：只在该状态的形状中选择
          const st = VX.Model.panelStateById(s, pe.stateId) || VX.Model.panelState(s);
          const kids = st ? st.shapes || [] : [];
          for (let j = kids.length - 1; j >= 0; j--) {
            if (inShape(kids[j], wx, wy)) return kids[j];
          }
          return null;
        }
        if (enter && s.id === enter) {
          // 组内模式：只在该组 children 中选择
          const kids = s.children || [];
          for (let j = kids.length - 1; j >= 0; j--) {
            if (inShape(kids[j], wx, wy)) return kids[j];
          }
          return null;
        }
        if (pe && s.type === "panel") continue; // 面板编辑时其他面板按普通形状处理
        if (!selectable(s)) continue;
        if (inShape(s, wx, wy)) return s;
      }
      return null;
    },

    // 预览运行时用：按页面形状树 + 交互覆盖做命中（含面板当前状态、位移/隐藏覆盖）
    inPage(shapes, wx, wy, opts) {
      const arr = shapes || [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const s = arr[i];
        const ov = (opts && opts.over) ? opts.over(s) : null;
        if (ov && ov.visible === false) continue;
        const dx = (ov && ov.dx) || 0, dy = (ov && ov.dy) || 0;
        if (s.type === "panel") {
          const stateId = ov && ov.state;
          const st = stateId ? (VX.Model.panelStateById(s, stateId) || VX.Model.panelState(s)) : VX.Model.panelState(s);
          const hit = this.inPage(st ? st.shapes : [], wx - dx, wy - dy, opts);
          if (hit) return hit;
          continue;
        }
        if (s.type === "group") {
          if (!inAABB(s, wx - dx, wy - dy)) continue;
          const hit = this.inPage(s.children, wx - dx, wy - dy, opts);
          if (hit) return hit;
          continue;
        }
        if (inShape(s, wx - dx, wy - dy)) return s;
      }
      return null;
    },

    // connector 工具：命中形状并返回最近连接点序号（0..3），未命中返回 null
    shapeAndAnchor(wx, wy) {
      const shapes = VX.Model.shapes();
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i];
        if (s.type === "connector" || s.type === "group") continue;
        if (!selectable(s)) continue;
        if (inAABB(s, wx, wy)) {
          // 就近四边中点
          const cands = [];
          for (let n = 0; n < 4; n++) {
            const a = VX.Routing.anchorOf(s, n);
            cands.push({ n, d: Math.hypot(wx - a.x, wy - a.y) });
          }
          cands.sort((p, q) => p.d - q.d);
          return { shape: s, anchor: cands[0].n };
        }
      }
      return null;
    },

    guideAt(wx, wy) {
      const guides = VX.Model.page().guides;
      const tol = 4 / VX.state.zoom;
      for (let i = guides.length - 1; i >= 0; i--) {
        const g = guides[i];
        if (g.dir === "v" && Math.abs(wx - g.pos) < tol) return { index: i, dir: "v" };
        if (g.dir === "h" && Math.abs(wy - g.pos) < tol) return { index: i, dir: "h" };
      }
      return null;
    },

    inShape,
    inAABB,
    selectable,
  };

  VX.Hit = Hit;
})();
