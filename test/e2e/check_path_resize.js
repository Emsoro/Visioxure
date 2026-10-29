// check_path_resize.js —— 纯路径形状随包围盒缩放回归（Playwright + 本机 Edge，无头）
// 背景：菱形/三角形/梯形的几何存在 path.subpaths（局部坐标，原点=包围盒中心）。
// 拖下边手柄只改 w/h、图形照原样画，于是「选框变低了、边框没变」。
// 现在局部坐标属于「设计尺寸 path.design」，绘制/命中/多边形化统一按 w/design 缩放。
// 判定同时用像素探针与内部 API 极值：两者都必须跟着包围盒走，缺一个就是口径又分家了。
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
  // 属性面板默认不展示，不先切到「属性」Tab 的话面板控件是隐形的
  await p.locator('[data-tabs] [data-tab="props"]').click();
  await p.waitForTimeout(60);

  // 世界坐标处是否画出了描边（网格线很淡，阈值 170 只吃墨色）
  const probe = (wx, wy, radius) => p.evaluate(({ wx, wy, radius }) => {
    const sp = VX.Viewport.w2s(wx, wy);
    const cv = document.getElementById("canvas");
    const ctx = cv.getContext("2d");
    const k = cv.width / cv.clientWidth;
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

  const reset = () => p.evaluate(() => {
    VX.Model.page().shapes.length = 0;
    VX.state.selection = [];
    VX.Model.emit("selection");
    VX.Renderer.invalidate();
  });

  // 探针前必须取消选中并移开鼠标：选框、下边手柄、悬停高亮外框都正好压在包围盒底边中点上，
  // 会把本来没画出来的边伪造成 PASS
  const deselect = async () => {
    await p.evaluate(() => {
      document.activeElement && document.activeElement.blur();
      VX.state.selection = [];
      VX.state.hoverShapeId = null;
      VX.state.hoverAnchor = null;
      VX.state.hoverConnEnd = null;
      VX.Model.emit("selection");
      VX.Renderer.invalidate();
    });
    const corner = await p.evaluate(() => {
      const r = document.getElementById("canvas").getBoundingClientRect();
      return { x: r.left + 4, y: r.top + 4 };
    });
    await p.mouse.move(corner.x, corner.y);
    await p.waitForTimeout(80);
  };

  const insert = async (name, keep) => {
    if (!keep) await reset();
    await p.locator("#stencil-panel .stencil-item")
      .filter({ has: p.locator(`.stencil-name:text-is("${name}")`) }).first().click();
    await p.waitForTimeout(80);
    return p.evaluate(() => VX.state.selection[0] || null);
  };

  // 世界坐标 → 页面鼠标坐标
  const mouseAt = (wx, wy) => p.evaluate(({ wx, wy }) => {
    const r = document.getElementById("canvas").getBoundingClientRect();
    const s = VX.Viewport.w2s(wx, wy);
    return { x: r.left + s.x, y: r.top + s.y };
  }, { wx, wy });

  const snap = (id) => p.evaluate((id) => {
    const s = VX.Model.shape(id);
    const d = (s.path && s.path.design) || null;
    return { x: s.x, y: s.y, w: s.w, h: s.h, dw: d && d.w, dh: d && d.h,
             cx: s.x + s.w / 2, cy: s.y + s.h / 2 };
  }, id);

  // ---------- 1. 拖下边手柄纵向压缩：图形必须跟着变矮 ----------
  for (const name of ["菱形", "三角形", "梯形"]) {
    const id = await insert(name);
    if (!id) { check(false, name + " 未能插入"); continue; }
    const a0 = await snap(id);
    check(!!a0.dw && !!a0.dh && Math.abs(a0.dw - a0.w) < 0.01 && Math.abs(a0.dh - a0.h) < 0.01,
      `${name}：插入时固化 path.design`, JSON.stringify(a0));

    // 真实拖拽：把下边中点手柄向上挪到包围盒中线（高度减半）
    const from = await mouseAt(a0.cx, a0.y + a0.h);
    const to = await mouseAt(a0.cx, a0.y + a0.h / 2);
    await p.mouse.move(from.x, from.y);
    await p.mouse.down();
    await p.mouse.move(to.x, to.y, { steps: 10 });
    await p.mouse.up();
    await p.waitForTimeout(120);

    const a1 = await snap(id);
    check(Math.abs(a1.h - a0.h / 2) < 2, `${name}：拖下边手柄后高减半`, `h=${a1.h.toFixed(1)}`);
    check(Math.abs(a1.dh - a0.h) < 0.01, `${name}：design 不随拖拽改变`, `design=${a1.dh}`);

    await deselect();
    // 底边：压缩后的位置有墨，压缩前的位置空了（三角形/梯形的底边中点同样在包围盒中线上）
    const atNew = await probe(a1.cx, a1.y + a1.h, 3);
    check(atNew.inked, `${name}：底边画在压缩后的位置`, "minLuma=" + atNew.minV);
    const atOld = await probe(a1.cx, a0.y + a0.h, 3);
    check(!atOld.inked, `${name}：压缩前的底边位置已无残留`, "minLuma=" + atOld.minV);

    // 多边形化（布尔运算口径）
    const ext = await p.evaluate((id) => {
      const s = VX.Model.shape(id);
      const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
      let ex = 0, ey = 0;
      for (const r of VX.Geometry.shapeToRings(s)) {
        for (const q of r) {
          ex = Math.max(ex, Math.abs(q.x - cx));
          ey = Math.max(ey, Math.abs(q.y - cy));
        }
      }
      return { ex, ey };
    }, id);
    check(Math.abs(ext.ex - a1.w / 2) < 1 && Math.abs(ext.ey - a1.h / 2) < 1,
      `${name}：shapeToRings 极值贴合包围盒`, `ext=${ext.ex.toFixed(1)}x${ext.ey.toFixed(1)}`);

    // 拉宽：最左顶点必须贴着加宽后的包围盒左边（几何不缩放时它停在 s.x + 90，
    // 既不贴边也探不到墨，命中也跟着露馅）
    const wide = await p.evaluate((id) => {
      const s = VX.Model.shape(id);
      s.w = 300;
      VX.Model.emit("change");
      VX.Renderer.invalidate();
      let vx = Infinity, vy = 0;
      for (const r of VX.Geometry.shapeToRings(s)) {
        for (const q of r) if (q.x < vx) { vx = q.x; vy = q.y; }
      }
      return { vx, vy, x: s.x, hit: VX.Hit.inShape(s, vx, vy) };
    }, id);
    await p.waitForTimeout(80);
    check(wide.hit && Math.abs(wide.vx - wide.x) < 1, `${name}：拉宽后最左顶点贴住包围盒`,
      `vx=${wide.vx.toFixed(1)} x=${wide.x.toFixed(1)} hit=${wide.hit}`);
    const wideInk = await probe(wide.vx, wide.vy, 3);
    check(wideInk.inked, `${name}：拉宽后最左顶点描边跟随`, "minLuma=" + wideInk.minV);
  }

  // ---------- 2. 属性面板改高：纯路径不再隐藏宽高 ----------
  const id2 = await insert("菱形");
  const b0 = await snap(id2);
  const hRow = p.locator("#props-panel .sp-row").filter({ has: p.locator('.sp-label:text-is("高")') });
  check(await hRow.count() === 1, "属性面板对纯路径显示「高」", "count=" + await hRow.count());
  await hRow.locator("input").click({ clickCount: 3 });
  await p.keyboard.type("40");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(120);
  const b1 = await snap(id2);
  check(b1.h === 40, "面板改高写入模型", String(b1.h));
  await deselect();
  const bProbe = await probe(b1.cx, b1.y + b1.h, 3);
  check(bProbe.inked, "面板改高后底顶点跟随", "minLuma=" + bProbe.minV);
  const bOld = await probe(b0.cx, b0.y + b0.h, 3);
  check(!bOld.inked, "面板改高后旧位置无残留", "minLuma=" + bOld.minV);

  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(120);
  const b2 = await snap(id2);
  check(Math.abs(b2.h - b0.h) < 0.01 && Math.abs(b2.dh - b0.h) < 0.01, "Ctrl+Z 回退高度且 design 不变",
    JSON.stringify(b2));
  await deselect();   // 撤销会回放选中，再清一次，否则选框会把墨迹判成通过
  const bUndo = await probe(b2.cx, b2.y + b2.h, 3);
  check(bUndo.inked, "撤销后底顶点回到原位置", "minLuma=" + bUndo.minV);

  // ---------- 3. 肉眼核对图：同一形状的原始 / 压扁 / 拉宽 ----------
  await reset();
  for (let i = 0; i < 3; i++) {
    const sid = await insert("菱形", true);   // keep：不清场，三个同时留在画布上
    await p.evaluate(({ sid, i }) => {
      const s = VX.Model.shape(sid);
      s.x = 80 + i * 200; s.y = 160;
      if (i === 1) s.h = 45;
      if (i === 2) s.w = 220;
      VX.state.selection = [];
      VX.Model.emit("selection");
      VX.Renderer.invalidate();
    }, { sid, i });
    await p.waitForTimeout(60);
  }
  const shotShapes = await p.evaluate(() => VX.Model.page().shapes.length);
  check(shotShapes === 3, "核对图上有三个菱形（原始/压扁/拉宽）", "n=" + shotShapes);
  const shots = require("path").join(__dirname, "..", "..", ".screenshots").replace(/\\/g, "/");
  await p.locator("#canvas").screenshot({ path: shots + "/path_resize.png" });

  check(errors.length === 0, "无 JS 异常", errors.join(" | "));

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
