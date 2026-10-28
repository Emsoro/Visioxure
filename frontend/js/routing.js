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

  const finite = (v) => typeof v === "number" && Number.isFinite(v);

  // connector 端点坐标：锚定形状优先，否则用存储的自由点
  // 全部校验有限值——一个 NaN 端点会让整条连接线（含箭头）画不出来，看起来像“消失了”
  function endpointOf(sh, which) {
    const glue = sh.glue && sh.glue[which];
    if (typeof glue === "string") {
      const idx = glue.indexOf(":");
      if (idx > 0) {
        const t = VX.Model.shape(glue.slice(0, idx));
        if (t && finite(t.x) && finite(t.y) && finite(t.w) && finite(t.h)) {
          const a = anchorOf(t, +glue.slice(idx + 1));
          if (finite(a.x) && finite(a.y)) return a;
        }
      }
    }
    const p = sh[which]; // {x,y}
    return p && finite(p.x) && finite(p.y) ? { x: p.x, y: p.y } : null;
  }

  function glueNormal(sh, which) {
    const glue = sh.glue && sh.glue[which];
    if (typeof glue !== "string") return null;
    const idx = glue.indexOf(":");
    if (idx <= 0) return null;
    const t = VX.Model.shape(glue.slice(0, idx));
    if (!t) return null;
    const n = +glue.slice(idx + 1) & 3;
    const nv = NORMALS[n];
    if (!t.angle) return nv;
    const cos = Math.cos(t.angle), sin = Math.sin(t.angle);
    return { x: nv.x * cos - nv.y * sin, y: nv.x * sin + nv.y * cos };
  }

  // 曲线：A→B 的三次贝塞尔控制点（锚定端沿出线法向拉出，自由端沿直线方向拉出）
  function curveOf(sh) {
    const A = endpointOf(sh, "begin");
    const B = endpointOf(sh, "end");
    if (!A || !B) return null;
    const na = glueNormal(sh, "begin");
    const nb = glueNormal(sh, "end");
    const d = Math.hypot(B.x - A.x, B.y - A.y) || 1;
    // 双自由端：给一个轻微弧度，避免“选了曲线却还是一条直线”
    if (!na && !nb) {
      const ux = (B.x - A.x) / d, uy = (B.y - A.y) / d;
      const bow = Math.min(d * 0.18, 80);
      const px = -uy * bow, py = ux * bow;
      return {
        A, B,
        c1: { x: A.x + ux * d * 0.25 + px, y: A.y + uy * d * 0.25 + py },
        c2: { x: A.x + ux * d * 0.75 + px, y: A.y + uy * d * 0.75 + py },
      };
    }
    const k = Math.max(30, Math.min(d * 0.5, 140));
    const c1 = na
      ? { x: A.x + na.x * k, y: A.y + na.y * k }
      : { x: A.x + (B.x - A.x) * 0.4, y: A.y + (B.y - A.y) * 0.4 };
    const c2 = nb
      ? { x: B.x + nb.x * k, y: B.y + nb.y * k }
      : { x: B.x - (B.x - A.x) * 0.4, y: B.y - (B.y - A.y) * 0.4 };
    return { A, B, c1, c2 };
  }

  // 三次贝塞尔采样（命中/手柄/标签定位复用）
  function sampleCurve(cv, n) {
    const out = [];
    const N = n || 24;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push({
        x: a * cv.A.x + b * cv.c1.x + c * cv.c2.x + d * cv.B.x,
        y: a * cv.A.y + b * cv.c1.y + c * cv.c2.y + d * cv.B.y,
      });
    }
    return out;
  }

  // 正交折线：a → b（a 已按其法向出线；na/nb 为出线法向，null=自由端）
  // 注意：一端自由一端粘附时 na 可能为 null，必须补出等价法向——
  // 直接读 na.x/na.y 会抛异常并中断整帧渲染，连接线“看起来消失”了
  function elbow(a, b, na, nb) {
    if (!a || !b) return [];
    const pts = [];
    const midx = (a.x + b.x) / 2, midy = (a.y + b.y) / 2;
    const aH = na ? na.x !== 0 : Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);

    if (!na && !nb) {
      // 双自由端：L 形
      if (aH) { pts.push({ x: b.x, y: a.y }); }
      else { pts.push({ x: a.x, y: b.y }); }
      return pts;
    }

    // 自由端按主方向推定法向，后续分支可安全使用 na
    if (!na) {
      na = aH ? { x: b.x >= a.x ? 1 : -1, y: 0 } : { x: 0, y: b.y >= a.y ? 1 : -1 };
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

  // 折线整理：去重、去“原路折返”、去非有限坐标
  // 折返（A→B→A）会让两段线完全重叠、箭头停在中间，视觉上像连接线断了/没了
  function tidy(pts) {
    const out = [];
    for (const p of pts || []) {
      if (!p || !finite(p.x) || !finite(p.y)) continue;
      const q = out[out.length - 1];
      if (q && Math.abs(q.x - p.x) < 0.01 && Math.abs(q.y - p.y) < 0.01) continue;
      out.push({ x: p.x, y: p.y });
    }
    for (let i = 0; i + 2 < out.length;) {
      const a = out[i], b = out[i + 1], c2 = out[i + 2];
      const abx = b.x - a.x, aby = b.y - a.y;
      const bcx = c2.x - b.x, bcy = c2.y - b.y;
      const cross = abx * bcy - aby * bcx;
      const dot = abx * bcx + aby * bcy;
      // 共线且反向 → 中间的 b 是折返点，直接去掉
      if (Math.abs(cross) < 0.01 && dot < 0) { out.splice(i + 1, 1); if (i > 0) i--; }
      else i++;
    }
    return out.length >= 2 ? out : null;
  }

  // connector → 世界坐标折线点列（渲染/命中实时计算，移动形状自动跟随）
  function pointsOf(sh) {
    const A = endpointOf(sh, "begin");
    const B = endpointOf(sh, "end");
    if (!A || !B) return null;

    // 曲线：返回采样折线，命中/端点/分段拖拽都与折线一致
    if (sh.route === "curve") {
      const cv = curveOf(sh);
      return cv ? sampleCurve(cv, 24) : [A, B];
    }

    // 手动编辑过的折线：保留用户拖出的中间点，端点仍跟随粘附
    if (sh.route === "manual" && Array.isArray(sh.points) && sh.points.length >= 2) {
      const pts = sh.points.map((p) => ({ x: p.x, y: p.y }));
      pts[0] = { x: A.x, y: A.y };
      pts[pts.length - 1] = { x: B.x, y: B.y };
      return tidy(pts) || [A, B];
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
    // 去除相邻重复点 + 折返点
    return tidy(pts) || [A, B];
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

  VX.Routing = { anchorOf, endpointOf, glueNormal, curveOf, sampleCurve, pointsOf, distTo, NORMALS, LEAD };
})();
