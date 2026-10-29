// check_props.js —— S2 属性面板自动化验收（Playwright + 本机 Edge，无头）
// 用法：先起静态服务 python -m http.server 8731，再 node test/e2e/check_props.js
const { chromium } = require("playwright");
const path = require("path");

const ROOT = "http://127.0.0.1:8731";
const SHOTS = path.join(__dirname, "..", "..", ".screenshots").replace(/\\/g, "/");

let failed = 0;
function check(cond, name, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra != null && !cond ? "  → " + extra : ""));
  if (!cond) failed++;
}

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];

  // ---------- 1. 组件级测试页（不依赖编辑器外壳） ----------
  const t = await browser.newPage({ viewport: { width: 400, height: 1000 } });
  t.on("pageerror", (e) => errors.push("test-page pageerror: " + e.message));
  await t.goto(ROOT + "/test/e2e/props_test.html");
  await t.waitForSelector('body[data-ready="1"]', { timeout: 10000 });
  const title = await t.title();
  check(title === "PROPS PASS", "组件测试页自检", title);
  await t.locator("#right-panel").screenshot({ path: SHOTS + "/s2_props_test.png" });

  // ---------- 2. 真实编辑器 ----------
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  p.on("pageerror", (e) => errors.push("app pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("app console: " + m.text()); });
  await p.goto(ROOT + "/frontend/index.html");
  await p.waitForFunction(() => window.VX && VX.Props && VX.Model.page());

  // 插入一个带文字的圆角矩形并选中
  const sid = await p.evaluate(() => {
    const s = VX.Model.addShape("rect", { x: 120, y: 80, w: 200, h: 60, text: "主要按钮" });
    s.style.cornerRadius = 8;
    VX.state.selection = [s.id];
    VX.Model.emit("selection");
    VX.Renderer.invalidate();
    return s.id;
  });
  await p.click('.panel-tab[data-tab="props"]');
  await p.waitForTimeout(150);

  const row = (label) => p.locator("#props-panel .sp-row").filter({ has: p.locator(`.sp-label:text-is("${label}")`) });
  const seg = (label, text) => row(label).locator(`.sp-seg-btn:text-is("${text}")`);

  const panelText = await p.locator("#props-panel").innerText();
  console.log("---- 面板文本 ----\n" + panelText + "\n------------------");
  for (const label of ["位置与大小", "X", "Y", "宽", "高", "旋转", "圆角", "不透明度", "文本", "字体", "字号", "加粗", "字色", "水平", "垂直"]) {
    check(panelText.indexOf(label) >= 0, "面板包含「" + label + "」");
  }

  // 数值编辑：真实键盘输入 + 失焦（触发 change）
  const xIn = row("X").locator("input");
  await xIn.click({ clickCount: 3 });
  await p.keyboard.type("200");
  await p.keyboard.press("Tab");
  await p.waitForTimeout(80);
  let m = await p.evaluate((id) => { const s = VX.Model.shape(id); return { x: s.x, y: s.y, w: s.w, angle: s.angle, r: s.style.cornerRadius, o: s.style.opacity }; }, sid);
  check(m.x === 200, "X 输入生效", JSON.stringify(m));

  const wIn = row("宽").locator("input");
  await wIn.click({ clickCount: 3 });
  await p.keyboard.type("240");
  await p.keyboard.press("Tab");
  m = await p.evaluate((id) => VX.Model.shape(id).w, sid);
  check(m === 240, "宽 输入生效", String(m));

  // 旋转：度 → 弧度
  const aIn = row("旋转").locator("input");
  await aIn.click({ clickCount: 3 });
  await p.keyboard.type("90");
  await p.keyboard.press("Tab");
  const ang = await p.evaluate((id) => VX.Model.shape(id).angle, sid);
  check(Math.abs(ang - Math.PI / 2) < 1e-6, "旋转 90° → π/2", String(ang));

  // 圆角 / 不透明度
  const rIn = row("圆角").locator("input");
  await rIn.click({ clickCount: 3 });
  await p.keyboard.type("14");
  await p.keyboard.press("Tab");
  const rv = await p.evaluate((id) => VX.Model.shape(id).style.cornerRadius, sid);
  check(rv === 14, "圆角写入 style.cornerRadius", String(rv));

  const oIn = row("不透明度").locator("input");
  await oIn.click({ clickCount: 3 });
  await p.keyboard.type("60");
  await p.keyboard.press("Tab");
  const ov = await p.evaluate((id) => VX.Model.shape(id).style.opacity, sid);
  check(Math.abs(ov - 0.6) < 1e-9, "不透明度 60% → 0.6", String(ov));

  // 撤销一次 = 只回退最后一次修改
  await p.keyboard.press("Control+z");
  await p.waitForTimeout(80);
  const afterUndo = await p.evaluate((id) => {
    const s = VX.Model.shape(id);
    return { o: s.style.opacity, r: s.style.cornerRadius, x: s.x };
  }, sid);
  check(afterUndo.x === 200 && afterUndo.r === 14 && (afterUndo.o == null || Math.abs(afterUndo.o - 1) < 1e-9),
    "Ctrl+Z 只回退不透明度", JSON.stringify(afterUndo));

  // 文本样式
  const sIn = row("字号").locator("input");
  await sIn.click({ clickCount: 3 });
  await p.keyboard.type("20");
  await p.keyboard.press("Tab");
  await seg("加粗", "加粗").click();
  await seg("水平", "中").click();
  await seg("垂直", "中").click();
  await p.waitForTimeout(80);
  const font = await p.evaluate((id) => VX.Model.shape(id).style.font, sid);
  check(font.size === 20 && font.bold === true && font.align === "center" && font.vAlign === "middle",
    "文本样式写入（字号/加粗/居中）", JSON.stringify(font));

  // 选中态按钮高亮
  const boldActive = await seg("加粗", "加粗").evaluate((b) => b.classList.contains("active"));
  check(boldActive, "分段按钮同步选中态");

  // 多选：多个值
  await p.evaluate((id) => {
    const b = VX.Model.addShape("ellipse", { x: 400, y: 80, w: 120, h: 120, text: "圆" });
    VX.state.selection = [id, b.id];
    VX.Model.emit("selection");
  }, sid);
  await p.waitForTimeout(120);
  const headText = await p.locator("#props-panel .sp-head").innerText();
  const xVal = await row("X").locator("input").inputValue();
  const xPh = await row("X").locator("input").getAttribute("placeholder");
  check(headText.indexOf("2 个对象") === 0, "多选标题", headText);
  check(xVal === "" && xPh === "多个值", "多选 X 显示多个值", `value=${xVal} ph=${xPh}`);

  // 连接线：无位置与大小
  await p.evaluate(() => {
    const c = VX.Model.addShape("connector", { x: 120, y: 240, w: 200, h: 40, begin: { x: 120, y: 240 }, end: { x: 320, y: 280 } });
    VX.state.selection = [c.id];
    VX.Model.emit("selection");
  });
  await p.waitForTimeout(120);
  const connText = await p.locator("#props-panel").innerText();
  check(connText.indexOf("位置与大小") < 0, "连接线不显示位置与大小");
  check(connText.indexOf("文本") >= 0, "连接线保留文本样式");

  // 面板截图（回到单形状，方便肉眼核对排版）
  await p.evaluate((id) => { VX.state.selection = [id]; VX.Model.emit("selection"); }, sid);
  await p.waitForTimeout(150);
  await p.locator("#right-panel").screenshot({ path: SHOTS + "/s2_props_app.png" });

  // 页面无 JS 异常（Bridge 缺失提示不算异常）
  check(errors.length === 0, "无 JS 异常", errors.join(" | "));

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
