// geometry.js —— 形状多边形化 + Clipper 布尔运算（联合/相交/剪除）（P2）
// 对齐 CODEPLAN.md §5：矩形/椭圆统一多边形化（椭圆 64 段）后走 Clipper；
// 结果生成 type=path 形状（子路径为设计尺寸下的局部坐标，原点=包围盒中心），继承底层形状样式
"use strict";

(function () {
  const SCALE = 1000;      // 浮点 → Clipper 整数坐标的放大倍数
  const ELLIPSE_SEG = 64;  // 椭圆多边形化段数

  function rot(cx, cy, a, x, y) {
    if (!a) return { x, y };
    const cos = Math.cos(a), sin = Math.sin(a);
    const dx = x - cx, dy = y - cy;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  }

  // path 几何的缩放系数：subpaths 记录的是「设计尺寸」下的局部坐标，
  // 拖拽手柄或改宽高只动 w/h，图形必须按 w/design.w 跟着缩放，
  // 否则菱形/三角形/梯形这类纯路径形状会出现选框变了、边框没变
  // 缺 design（旧文件、外来 vsdx、形状库定义）时系数为 1，与改动前行为一致
  function pathScale(s) {
    const d = s.path && s.path.design;
    const dw = d && d.w > 0 ? d.w : s.w;
    const dh = d && d.h > 0 ? d.h : s.h;
    return { kx: dw > 0 ? s.w / dw : 1, ky: dh > 0 ? s.h / dh : 1 };
  }

  // shape → 世界坐标多边形环数组；不支持布尔的类型返回 null
  function shapeToRings(s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = s.angle || 0;
    if (s.type === "rect" || s.type === "text") {
      const hw = s.w / 2, hh = s.h / 2;
      const pts = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
      return [pts.map((p) => rot(cx, cy, a, cx + p.x, cy + p.y))];
    }
    if (s.type === "ellipse") {
      const hw = s.w / 2, hh = s.h / 2;
      const pts = [];
      for (let i = 0; i < ELLIPSE_SEG; i++) {
        const t = (i / ELLIPSE_SEG) * Math.PI * 2;
        pts.push(rot(cx, cy, a, cx + hw * Math.cos(t), cy + hh * Math.sin(t)));
      }
      return [pts];
    }
    if (s.type === "path" && s.path && s.path.subpaths) {
      // 局部坐标（原点=中心）→ 世界，并按包围盒相对设计尺寸缩放
      const k = pathScale(s);
      return s.path.subpaths.map((ring) => ring.map((p) => rot(cx, cy, a, cx + p.x * k.kx, cy + p.y * k.ky)));
    }
    return null; // group/connector/image 等不参与布尔
  }

  function toClip(rings) {
    return rings.map((ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
  }
  function fromClip(paths) {
    return (paths || []).map((p) => p.map((pt) => ({ x: pt.X / SCALE, y: pt.Y / SCALE })));
  }

  // kind: 'union' | 'intersect' | 'subtract'（subject = shapes[0]，调用方按 z 升序传入）
  function booleanRings(kind, shapes) {
    if (typeof ClipperLib === "undefined") return null;
    const CT = ClipperLib.ClipType, PT = ClipperLib.PolyType, PFT = ClipperLib.PolyFillType;
    try {
      if (kind === "union") {
        const c = new ClipperLib.Clipper();
        for (const s of shapes) c.AddPaths(toClip(shapeToRings(s)), PT.ptSubject, true);
        const sol = new ClipperLib.Paths();
        c.Execute(CT.ctUnion, sol, PFT.pftNonZero, PFT.pftNonZero);
        return fromClip(sol);
      }
      if (kind === "intersect") {
        let acc = toClip(shapeToRings(shapes[0]));
        for (let i = 1; i < shapes.length; i++) {
          const c = new ClipperLib.Clipper();
          c.AddPaths(acc, PT.ptSubject, true);
          c.AddPaths(toClip(shapeToRings(shapes[i])), PT.ptClip, true);
          const sol = new ClipperLib.Paths();
          c.Execute(CT.ctIntersection, sol, PFT.pftNonZero, PFT.pftNonZero);
          acc = sol;
          if (!acc.length) break;
        }
        return fromClip(acc);
      }
      if (kind === "subtract") {
        const c = new ClipperLib.Clipper();
        c.AddPaths(toClip(shapeToRings(shapes[0])), PT.ptSubject, true);
        for (let i = 1; i < shapes.length; i++) c.AddPaths(toClip(shapeToRings(shapes[i])), PT.ptClip, true);
        const sol = new ClipperLib.Paths();
        c.Execute(CT.ctDifference, sol, PFT.pftNonZero, PFT.pftNonZero);
        return fromClip(sol);
      }
    } catch (e) {
      console.error("boolean error:", e);
      return null;
    }
    return null;
  }

  // 布尔结果 → path 形状属性（局部坐标原点=包围盒中心，angle=0）
  function booleanShape(kind, shapes) {
    const rings = booleanRings(kind, shapes);
    if (!rings || !rings.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of rings) {
      for (const p of ring) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const subpaths = rings
      .map((ring) => ring.map((p) => ({ x: +(p.x - cx).toFixed(3), y: +(p.y - cy).toFixed(3) })))
      .filter((ring) => ring.length >= 3);
    if (!subpaths.length) return null;
    const src = shapes[0]; // 继承底层（subject）样式
    return {
      type: "path",
      x: minX, y: minY,
      w: maxX - minX, h: maxY - minY,
      style: src ? JSON.parse(JSON.stringify(src.style)) : undefined,
      path: { subpaths, fillRule: "evenodd", design: { w: maxX - minX, h: maxY - minY } },
    };
  }

  VX.Geometry = { shapeToRings, booleanRings, booleanShape, rot, pathScale };
})();
