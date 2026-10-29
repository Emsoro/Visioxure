// check_editor.js —— 编辑器主干交互回归（Playwright + 本机 Edge，无头）
// 覆盖：形状库点击插入 → 画布拖拽 → 面板回显 → Delete 删除 → Ctrl+Z 恢复且保留选中
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
    // 资源 404 单独统计（浏览器会自动请求 /favicon.ico），不当作脚本异常
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text());
  });
  const notFound = [];
  p.on("response", (r) => { if (r.status() === 404) notFound.push(r.url()); });

  await p.goto(ROOT + "/frontend/index.html");
  await p.waitForFunction(() => window.VX && VX.Props && VX.Model.page());
  await p.click('.panel-tab[data-tab="props"]');

  // 1. 形状库点击插入并自动选中
  const before = await p.evaluate(() => VX.Model.page().shapes.length);
  await p.locator("#stencil-panel .stencil-item").first().click();
  await p.waitForTimeout(120);
  const st = await p.evaluate(() => ({
    n: VX.Model.page().shapes.length,
    sel: VX.state.selection.slice(),
    type: (VX.Model.shape(VX.state.selection[0]) || {}).type,
  }));
  check(st.n === before + 1, "形状库点击插入一个形状", JSON.stringify(st));
  check(st.sel.length === 1 && st.type === "rect", "插入后自动选中", JSON.stringify(st));

  const row = (label) => p.locator("#props-panel .sp-row").filter({ has: p.locator(`.sp-label:text-is("${label}")`) });
  check((await p.locator("#props-panel .sp-head").innerText()) === "矩形", "属性面板标题为矩形");
  const x0 = await p.evaluate((id) => Math.round(VX.Model.shape(id).x), st.sel[0]);
  check(await row("X").locator("input").inputValue() === String(x0), "面板 X 与模型一致", `panel=${await row("X").locator("input").inputValue()} model=${x0}`);

  // 2. 画布拖拽移动
  const pt = await p.evaluate((id) => {
    const s = VX.Model.shape(id);
    const c = document.getElementById("canvas").getBoundingClientRect();
    const z = VX.state.zoom;
    return {
      cx: c.left + (s.x + s.w / 2) * z + VX.state.ox,
      cy: c.top + (s.y + s.h / 2) * z + VX.state.oy,
      zoom: z,
    };
  }, st.sel[0]);
  await p.mouse.move(pt.cx, pt.cy);
  await p.mouse.down();
  await p.mouse.move(pt.cx + 60, pt.cy + 30, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(150);
  const moved = await p.evaluate((id) => ({ x: VX.Model.shape(id).x, y: VX.Model.shape(id).y }), st.sel[0]);
  check(Math.abs(moved.x - x0 - 60 / pt.zoom) < 2, "拖拽后 X 增加", JSON.stringify(moved));
  check(await row("X").locator("input").inputValue() === String(Math.round(moved.x)),
    "拖拽结束面板回显", `panel=${await row("X").locator("input").inputValue()} model=${moved.x}`);

  // 3. 撤销拖拽（选中应保留）——只让输入框失焦，不能点画布（点空白会清空选中）
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(120);
  const undone = await p.evaluate((id) => ({
    x: VX.Model.shape(id).x,
    sel: VX.state.selection.slice(),
    page: VX.Model.currentPageId(),
  }), st.sel[0]);
  check(Math.abs(undone.x - x0) < 0.001, "Ctrl+Z 回退拖拽", JSON.stringify(undone));
  check(undone.sel.length === 1 && undone.sel[0] === st.sel[0], "撤销后保留选中", JSON.stringify(undone));

  // 4. Delete 删除 + 撤销恢复
  await p.keyboard.press("Delete");
  await p.waitForTimeout(100);
  check(await p.evaluate(() => VX.Model.page().shapes.length) === before, "Delete 删除形状");
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(120);
  const restored = await p.evaluate(() => ({ n: VX.Model.page().shapes.length, sel: VX.state.selection.slice() }));
  check(restored.n === before + 1, "撤销恢复被删除的形状", JSON.stringify(restored));
  check(restored.sel.length === 1, "恢复后重新选中", JSON.stringify(restored));

  // 5. 属性面板改宽度 → 可被撤销（VX.state.dirty 是重绘标志，文档修改由 fileio 比对快照）
  const w0 = await p.evaluate((id) => VX.Model.shape(id).w, restored.sel[0]);
  const wIn = row("宽").locator("input");
  await wIn.click({ clickCount: 3 });
  await p.keyboard.type("300");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(100);
  const wv = await p.evaluate((id) => VX.Model.shape(id).w, restored.sel[0]);
  check(wv === 300, "宽度写入模型", String(wv));
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(120);
  const wUndo = await p.evaluate((id) => VX.Model.shape(id).w, restored.sel[0]);
  check(wUndo === w0, "Ctrl+Z 回退宽度修改", `${wUndo} != ${w0}`);

  // 6. 多页：新建页 + 事务内加形状 → 撤销不跳页
  await p.evaluate(() => { VX.Model.addPage(); });
  await p.waitForTimeout(100);
  const pageId = await p.evaluate(() => VX.Model.currentPageId());
  check(pageId !== "p1", "addPage 后切到新页", pageId);
  await p.evaluate(() => {
    VX.History.run("test-add", () => {
      const s = VX.Model.addShape("ellipse", { x: 100, y: 100, w: 100, h: 100, text: "圆" });
      VX.state.selection = [s.id];
    });
    VX.Model.emit("selection");
  });
  await p.waitForTimeout(100);
  await p.evaluate(() => document.activeElement && document.activeElement.blur());
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(120);
  const after = await p.evaluate(() => ({ page: VX.Model.currentPageId(), n: VX.Model.page().shapes.length }));
  check(after.page === pageId, "撤销后仍在当前页", JSON.stringify(after));
  check(after.n === 0, "撤销移除新建的椭圆", JSON.stringify(after));

  check(errors.length === 0, "无 JS 异常", errors.join(" | "));
  if (notFound.length) console.log("INFO 404 资源: " + notFound.join(", "));

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
