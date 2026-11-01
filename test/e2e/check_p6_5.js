// check_p6_5.js —— P6.5 验收：A2 中继器（数据/模板/插值/动作）+ A3 组件库（母版/实例/解除链接/环检测）
// 用法：先起静态服务 python -m http.server 8731，再 node test/e2e/check_p6_5.js
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
  await p.waitForFunction(() => window.VX && VX.Repeater && VX.Library && VX.Model.page());

  const reset = () => p.evaluate(() => {
    VX.Model.page().shapes.length = 0;
    VX.state.selection = [];
    VX.Model.emit("selection");
    VX.Renderer.invalidate();
  });

  // ---------- A2：形状库插入中继器 ----------
  await reset();
  await p.locator("#stencil-panel .stencil-item")
    .filter({ has: p.locator('.stencil-name:text-is("中继器")') }).first().click();
  await p.waitForTimeout(80);
  const repInfo = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    if (!s) return null;
    return {
      type: s.type,
      rows: (s.repeater.dataset || []).length,
      cols: VX.Repeater.columns(s.repeater),
      items: VX.Repeater.items(s).length,
      tmpl: (s.repeater.template || []).length,
      ids: (s.repeater.template || []).every((t) => !!t.id),
    };
  });
  check(repInfo && repInfo.type === "repeater", "形状库可插入中继器", JSON.stringify(repInfo));
  check(repInfo && repInfo.rows === 3, "默认 3 条数据");
  check(repInfo && repInfo.items === 3, "渲染条目数 = 数据行数");
  check(repInfo && repInfo.tmpl === 3 && repInfo.ids, "模板 3 个形状且都有 id");

  // 模板文本插值：第一条数据应替换 {{标题}}
  const drawn = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    const inst = VX.Repeater.instantiate(s.repeater.template, s.repeater.dataset[0], s.x, s.y);
    const txt = inst.filter((t) => t.type === "text").map((t) => t.text);
    return { txt, x: s.x };
  });
  check(drawn.txt.includes("列表项一"), "模板 {{标题}} 已按首行插值", JSON.stringify(drawn.txt));
  check(drawn.txt.every((t) => !t.includes("{{")), "插值后不残留模板语法");

  // ---------- A2：CSV 编辑（属性面板） ----------
  const csvOk = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    const ta = document.querySelector("#props-panel textarea");
    if (!ta) return { found: false };
    ta.value = "标题,说明\n甲,第一\n乙,第二\n丙,第三\n丁,第四";
    ta.dispatchEvent(new Event("change"));
    const rep = VX.Model.shape(s.id).repeater;
    return {
      found: true,
      cols: VX.Repeater.columns(rep),
      rows: rep.dataset.length,
      first: rep.dataset[0]["标题"],
      h: VX.Model.shape(s.id).h,
      items: VX.Repeater.items(VX.Model.shape(s.id)).length,
    };
  });
  check(csvOk.found, "属性面板出现中继器 CSV 编辑框");
  check(csvOk.rows === 4 && csvOk.cols.length === 2, "CSV 改数据后 4 行 2 列", JSON.stringify(csvOk));
  check(csvOk.first === "甲", "CSV 首行数据正确");
  check(csvOk.items === 4, "画布条目数跟随数据");

  // ---------- A2：过滤 / 排序 / 分页 ----------
  const viewRes = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    const rep = s.repeater;
    rep.pageSize = 2;
    rep.view = { filter: { column: "说明", op: "contains", value: "第" }, page: 0 };
    const a = VX.Repeater.visibleRows(rep);
    rep.view.sort = { column: "标题", dir: "desc" };
    const b = VX.Repeater.visibleRows(rep);
    rep.view.filter = null;
    rep.view.sort = null;
    rep.view.page = 1;
    const c = VX.Repeater.visibleRows(rep);
    rep.view = {};
    rep.pageSize = 0;
    return {
      filtered: a.length, pages: a.pageCount,
      sortedFirst: b[0].row["标题"],
      page2First: c[0].row["标题"], page2Count: c.length,
    };
  });
  check(viewRes.filtered === 2 && viewRes.pages === 2, "过滤后 2 行 → 2 页", JSON.stringify(viewRes));
  check(viewRes.sortedFirst === "乙", "排序（说明含「第」+ 标题降序）首行正确", viewRes.sortedFirst);
  check(viewRes.page2First === "丙" && viewRes.page2Count === 2, "第 2 页内容正确", JSON.stringify(viewRes));

  // ---------- A2：交互动作（addRow / delRow / filter / sort / page） ----------
  const runtimeRes = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    // 把动作挂在中继器自己身上，模拟用户配置（click → 加行）
    s.interactions = [
      { event: "click", actions: [{ type: "repAddRow", target: s.id, row: '{"标题":"新加","说明":"x"}' }] },
      { event: "click", actions: [{ type: "repSort", target: s.id, column: "标题", dir: "desc" }] },
      { event: "click", actions: [{ type: "repPage", target: s.id, page: "next" }] },
    ];
    s.repeater.pageSize = 2;
    const doc = JSON.parse(VX.Model.serialize());
    const rt = VX.Interact.create(doc);
    const target = rt.findShape(s.id);
    rt.dispatch(target, "click");
    const rep = target.repeater;
    const rows = VX.Repeater.visibleRows(rep);
    return {
      rows: rep.dataset.length,
      added: rep.dataset[rep.dataset.length - 1]["标题"],
      page: rep.view.page,
      shown: rows.length,
    };
  });
  check(runtimeRes.rows === 5 && runtimeRes.added === "新加", "repAddRow 动作追加一行", JSON.stringify(runtimeRes));
  check(runtimeRes.page === 1 && runtimeRes.shown === 2, "repPage(next) 翻到第 2 页", JSON.stringify(runtimeRes));

  // ---------- A3：组件库 ----------
  const libRes = await p.evaluate(() => {
    const pg = VX.Model.page();
    pg.shapes.length = 0;
    VX.state.selection = [];
    const a = VX.Model.addShape("rect", { x: 40, y: 40, w: 120, h: 60, text: "母版" });
    const b = VX.Model.addShape("ellipse", { x: 180, y: 40, w: 60, h: 60 });
    VX.state.selection = [a.id, b.id];
    VX.Model.emit("selection");
    const m = VX.Library.addFromSelection();
    const before = JSON.stringify(VX.Library.master(m.id).shapes);
    const inst = VX.Library.insert(m.id, 400, 200);
    // 改实例内的文本（应不影响母版）
    const child = inst.children.find((c) => c.text);
    child.text = "实例内改了";
    return {
      masters: VX.Library.masters().length,
      masterId: m.id,
      instType: inst ? inst.type : null,
      instChildren: inst ? inst.children.length : 0,
      masterUnchanged: JSON.stringify(VX.Library.master(m.id).shapes) === before,
      childText: child.text,
      instId: inst ? inst.id : null,
    };
  });
  check(libRes.masters >= 1, "创建组件母版");
  check(libRes.instType === "instance" && libRes.instChildren === 2, "插入实例（2 个子形状）", JSON.stringify(libRes));
  check(libRes.masterUnchanged && libRes.childText === "实例内改了", "改实例不影响母版");

  // 解除链接 → 独立形状（group → ungroup 后成 2 个顶层形状）
  const unlinkRes = await p.evaluate((instId) => {
    const before = VX.Model.page().shapes.length;
    VX.state.selection = [instId];
    VX.Library.unlink(instId);
    const pg = VX.Model.page();
    return { before, after: pg.shapes.length, type: (VX.Model.shape(instId) || {}).type };
  }, libRes.instId);
  check(unlinkRes.type == null && unlinkRes.after === unlinkRes.before + 1,
    "解除链接后实例变为独立形状", JSON.stringify(unlinkRes));

  // 环检测：母版里嵌入引用自己的实例 → wouldCycle 为 true，插入被拒绝
  const cycleRes = await p.evaluate(() => {
    const m = VX.Library.masters()[0];
    const selfChild = { id: "self", type: "instance", masterId: m.id, x: 0, y: 0, w: 10, h: 10, children: [] };
    m.shapes.push(selfChild);
    const cycle = VX.Library.wouldCycle(m.id, m.shapes);
    const inst = VX.Library.insert(m.id, 800, 300);
    m.shapes = m.shapes.filter((s) => s.id !== "self");
    return { cycle, inserted: !!inst };
  });
  check(cycleRes.cycle === true, "环检测识别自引用母版");
  check(cycleRes.inserted === false, "自引用母版拒绝插入实例");

  // ---------- 导出 ----------
  const svgRes = await p.evaluate(() => {
    const pg = VX.Model.page();
    pg.shapes.length = 0;
    const rep = VX.Model.addShape("repeater", VX.Repeater.defaultShape());
    rep.x = 40; rep.y = 40;
    const svg = VX.ExportSvg.svg(pg);
    return { len: svg.length, rows: (svg.match(/data-vx-id=/g) || []).length, hasText: svg.includes("列表项一") };
  });
  check(svgRes.rows >= 3 + 1 && svgRes.hasText, "SVG 导出渲染中继器（多行 + 插值文字）", JSON.stringify(svgRes));

  check(errors.length === 0, "无 JS 异常", errors.join(" | "));

  const shots = require("path").join(__dirname, "..", "..", ".screenshots").replace(/\\/g, "/");
  await p.evaluate(() => { VX.state.selection = []; VX.Model.emit("selection"); VX.Renderer.invalidate(); });
  await p.waitForTimeout(80);
  await p.locator("#canvas").screenshot({ path: shots + "/p6_5.png" });

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
