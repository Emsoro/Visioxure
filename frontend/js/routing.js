// routing.js —— 连接线布线（P2）
// 对齐 CODEPLAN.md §5：先直线，再直角折线（含锚点面朝向的出线段），A* 避障留待后续；
// 纯函数便于单测。连接点序号：0=上 1=右 2=下 3=左（四边中点）
"use strict";

(function () {
  const LEAD = 16; // 锚定后从形状边缘伸出的引导段长度（世界 px）

  const NORMALS = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

  // 形状第 n 个连接点的世界坐标（考虑旋转）
  function anchorOf(t, n) {
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    const pts = [
      { x: cx, y: t.y },          // 上
      { x: t.x + t.w, y: cy },    // 右
      { x: cx, y: t.y + t.h },    // 下
      { x: t.x, y: cy },          // 左
    ];
    return VX.Geometry.rot(cx, cy, t.angle || 0, pts[n & 3].x, pts[n & 3].y);
  }

  // connector 端点坐标：锚定形状优先，否则用存储的自由点
  function endpointOf(sh, which) {
    const glue = sh.glue && sh.glue[which];
    if (glue) {
      const idx = glue.indexOf(":");
      const t = VX.Model.shape(glue.slice(0, idx));
      if (t) return anchorOf(t, +glue.slice(idx + 1));
    }
    return sh[which]; // {x,y}
  }

  function glueNormal(sh, which) {
    const glue = sh.glue && sh.glue[which];
    if (!glue) return null;
    const idx = glue.indexOf(":");
    const t = VX.Model.shape(glue.slice(0, idx));
    if (!t) return null;
    const n = +glue.slice(idx + 1) & 3;
    const nv = NORMALS[n];
    if (!t.angle) return nv;
    const cos = Math.cos(t.angle), sin = Math.sin(t.angle);
    return { x: nv.x * cos - nv.y * sin, y: nv.x * sin + nv.y * cos };
  }

  // 正交折线：a → b（a 已按其法向出线；na/nb 为出线法向，null=自由端）
  function elbow(a, b, na, nb) {
    const pts = [];
    const midx = (a.x + b.x) / 2, midy = (a.y + b.y) / 2;
    const aH = na ? na.x !== 0 : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

    if (!na && !nb) {
      // 双自由端：L 形
      if (aH) { pts.push({ x: b.x, y: a.y }); }
      else { pts.push({ x: a.x, y: b.y }); }
      return pts;
    }

    if (aH) {
      // a 水平出线：先水平再垂直
      let x2;
      if (!nb) x2 = b.x;
      else if (nb.x !== 0) {
        // b 也水平出线：面对面（法向相对）直接对接，否则绕中轴
        const faceToFace = (na.x > 0 && nb.x < 0) || (na.x < 0 && nb.x > 0);
        const okDir = (na.x > 0 && b.x > a.x) || (na.x < 0 && b.x < a.x);
        x2 = (faceToFace && okDir) ? b.x : midx;
      } else {
        // b 垂直出线：直接对到 b.x（若与 a 出线方向不倒退），否则绕
        const okDir = (na.x > 0 && b.x > a.x) || (na.x < 0 && b.x < a.x);
        x2 = okDir ? b.x : midx;
      }
      pts.push({ x: x2, y: a.y });
      if (Math.abs(x2 - b.x) > 0.5) pts.push({ x: x2, y: b.y });
    } else {
      // a 垂直出线：先垂直再水平
      let y2;
      if (!nb) y2 = b.y;
      else if (nb.y !== 0) {
        const faceToFace = (na.y > 0 && nb.y < 0) || (na.y < 0 && nb.y > 0);
        const okDir = (na.y > 0 && b.y > a.y) || (na.y < 0 && b.y < a.y);
        y2 = (faceToFace && okDir) ? b.y : midy;
      } else {
        const okDir = (na.y > 0 && b.y > a.y) || (na.y < 0 && b.y < a.y);
        y2 = okDir ? b.y : midy;
      }
      pts.push({ x: a.x, y: y2 });
      if (Math.abs(y2 - b.y) > 0.5) pts.push({ x: b.x, y: y2 });
    }
    return pts;
  }

  // connector → 世界坐标折线点列（渲染/命中实时计算，移动形状自动跟随）
  function pointsOf(sh) {
    const A = endpointOf(sh, "begin");
    const B = endpointOf(sh, "end");
    if (!A || !B) return null;

    // 手动编辑过的折线：保留用户拖出的中间点，端点仍跟随粘附
    if (sh.route === "manual" && Array.isArray(sh.points) && sh.points.length >= 2) {
      const pts = sh.points.map((p) => ({ x: p.x, y: p.y }));
      pts[0] = { x: A.x, y: A.y };
      pts[pts.length - 1] = { x: B.x, y: B.y };
      return pts;
    }

    if (sh.route === "straight") return [A, B];

    const na = glueNormal(sh, "begin");
    const nb = glueNormal(sh, "end");
    const a = na ? { x: A.x + na.x * LEAD, y: A.y + na.y * LEAD } : A;
    const b = nb ? { x: B.x + nb.x * LEAD, y: B.y + nb.y * LEAD } : B;

    const pts = [A];
    if (na) pts.push(a);
    pts.push(...elbow(a, b, na, nb));
    if (nb) pts.push(b);
    pts.push(B);
    // 去除相邻重复点
    const out = [];
    for (const p of pts) {
      const q = out[out.length - 1];
      if (!q || Math.abs(q.x - p.x) > 0.01 || Math.abs(q.y - p.y) > 0.01) out.push(p);
    }
    return out;
  }

  // 点到 connector 折线的最短距离（世界坐标）
  function distTo(sh, wx, wy) {
    const pts = pointsOf(sh);
    if (!pts || pts.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distToSeg(wx, wy, pts[i], pts[i + 1]);
      if (d < best) best = d;
    }
    return best;
  }

  function distToSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return Math.hypot(px - a.x, py - a.y);
    let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  VX.Routing = { anchorOf, endpointOf, glueNormal, pointsOf, distTo, NORMALS, LEAD };
})();
