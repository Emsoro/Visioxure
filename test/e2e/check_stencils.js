// check_stencils.js —— 形状库 path 子路径闭合回归（Playwright + 本机 Edge，无头）
// 背景：commit 37dfae3 把渲染器的无条件 closePath 改成「有填充或首尾重合才闭合」，
// 而形状库基本形状按规范是「透明填充 + 描边」，导致三角形/梯形/菱形/箭头插入后缺一条闭合边。
// 现在闭合与否由 path.closed[] 显式声明，本脚本用像素探针双向验证：
//   1) 库里每个 path 条目的闭合边必须画出来；
//   2) 显式声明开放（closed:[false]）的折线不得多出闭合斜线。
const { chromium } = require("playwright");

const ROOT = "http://127.0.0.1:8731";
let failed = 0;
function check(cond, name, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra != null && !cond ? "  → " + extra : ""));
  if (!cond) failed++;
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text());
  });

  await p.goto(ROOT + "/frontend/index.html");
  await p.waitForFunction(() => window.VX && VX.Stencils && VX.Model.page());

  // 在指定世界坐标处探测是否画出了描边（网格线很淡，阈值 170 只吃墨色）
  const probe = (wx, wy, radius) => p.evaluate(({ wx, wy, radius }) => {
    const sp = VX.Viewport.w2s(wx, wy);
    const cv = document.getElementById("canvas");
    const ctx = cv.getContext("2d");
    const k = cv.width / cv.clientWidth;      // 背板像素 / CSS 像素
    const X = Math.round(sp.x * k), Y = Math.round(sp.y * k);
    let inked = false, minV = 999;
    for (let dy = -radius; dy <= radius && !inked; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = ctx.getImageData(X + dx, Y + dy, 1, 1).data;
        if (d[3] === 0) continue;
        const v = (d[0] + d[1] + d[2]) / 3;
        minV = Math.min(minV, v);
        if (v < 170) inked = true;
      }
    }
    return { inked, minV };
  }, { wx, wy, radius });

  // 清场 + 取消选中（选中框会压在形状边上，干扰像素判定）
  const reset = () => p.evaluate(() => {
    VX.Model.page().shapes.length = 0;
    VX.state.selection = [];
    VX.Model.emit("selection");
    VX.Renderer.invalidate();
  });

  // ---------- 1. 形状库所有 path 条目：闭合边必须画出 ----------
  const items = await p.evaluate(() => {
    const out = [];
    for (const cat of VX.Stencils.categories) {
      for (const it of cat.items) {
        if (it.def && it.def.type === "path" && it.def.path && it.def.path.subpaths && it.def.path.subpaths.length) {
          out.push({ cat: cat.name, name: it.name, ring: it.def.path.subpaths[0] });
        }
      }
    }
    return out;
  });
  check(items.length >= 4, "找到形状库 path 条目", "count=" + items.length);

  for (const it of items) {
    await reset();
    await p.locator("#stencil-panel .stencil-item")
      .filter({ has: p.locator(`.stencil-name:text-is("${it.name}")`) }).first().click();
    await p.waitForTimeout(60);
    const info = await p.evaluate(() => {
      const s = VX.Model.shape(VX.state.selection[0]);
      return s ? { x: s.x, y: s.y, w: s.w, h: s.h, n: (s.path.subpaths[0] || []).length } : null;
    });
    if (!info) { check(false, it.name + " 未能插入"); continue; }
    // 取消选中：选中框会压在包围盒边上，三角形底边这类闭合边会被选中框伪造成通过
    await p.evaluate(() => {
      VX.state.selection = [];
      VX.Model.emit("selection");
      VX.Renderer.invalidate();
    });
    await p.waitForTimeout(60);
    const ring = it.ring;
    const a = ring[ring.length - 1], b = ring[0];
    // 闭合边中点：世界坐标 = 包围盒中心 + 局部坐标
    const wx = info.x + info.w / 2 + (a.x + b.x) / 2;
    const wy = info.y + info.h / 2 + (a.y + b.y) / 2;
    const r = await probe(wx, wy, 3);
    check(r.inked, `「${it.cat}/${it.name}」闭合边已描边（${ring.length} 点）`, "minLuma=" + r.minV);
  }

  // ---------- 2. 显式开放折线：不得多出闭合斜线 ----------
  // 同一组点：不带 closed 字段 → 闭合（有斜线）；closed:[false] → 开放（无斜线）
  const pts = [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 0, y: 30 }];
  async function drawWithFlag(closedFlag) {
    await reset();
    const info = await p.evaluate(({ pts, closedFlag }) => {
      const path = { subpaths: [pts], fillRule: "evenodd" };
      if (closedFlag !== null) path.closed = [closedFlag];
      const s = VX.Model.addShape("path", {
        x: 300, y: 200, w: 100, h: 60, path,
        style: { fill: "transparent", line: "#39434F", lineWidth: 1.4 },
      });
      VX.state.selection = [];
      VX.Model.emit("selection");
      VX.Renderer.invalidate();
      return { x: s.x, y: s.y, w: s.w, h: s.h };
    }, { pts, closedFlag });
    await p.waitForTimeout(80);
    // 闭合边中点：末点 (0,30) → 首点 (-50,-30) 的中点 (-25, 0)
    const wx = info.x + info.w / 2 + (pts[2].x + pts[0].x) / 2;
    const wy = info.y + info.h / 2 + (pts[2].y + pts[0].y) / 2;
    return await probe(wx, wy, 2);
  }

  const defClosed = await drawWithFlag(null);
  check(defClosed.inked, "无 closed 字段 → 默认闭合", "minLuma=" + defClosed.minV);
  const flagOpen = await drawWithFlag(false);
  check(!flagOpen.inked, "closed:[false] → 开放折线不多出斜线", "minLuma=" + flagOpen.minV);
  const flagClosed = await drawWithFlag(true);
  check(flagClosed.inked, "closed:[true] → 显式闭合", "minLuma=" + flagClosed.minV);

  check(errors.length === 0, "无 JS 异常", errors.join(" | "));

  // ---------- 3. 留一张图供肉眼核对（把库里的 path 条目排开插入） ----------
  await reset();
  for (let i = 0; i < items.length; i++) {
    await p.locator("#stencil-panel .stencil-item")
      .filter({ has: p.locator(`.stencil-name:text-is("${items[i].name}")`) }).first().click();
    await p.evaluate(({ i }) => {
      const s = VX.Model.shape(VX.state.selection[0]);
      if (s) { s.x = 60 + i * 150; s.y = 180; }
      VX.state.selection = [];
      VX.Model.emit("selection");
      VX.Renderer.invalidate();
    }, { i });
    await p.waitForTimeout(40);
  }
  const shots = require("path").join(__dirname, "..", "..", ".screenshots").replace(/\\/g, "/");
  await p.locator("#canvas").screenshot({ path: shots + "/stencils_closed.png" });

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
