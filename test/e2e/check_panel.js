// check_panel.js —— 动态面板专项验收（Playwright + 本机 Edge，无头）
// 用法：先起静态服务 python -m http.server 8731，再 node test/e2e/check_panel.js
// 覆盖：数据归一化 / 状态 CRUD / 几何联动 / 视口裁剪（Canvas·命中·SVG）/ 状态切换动作与事件 / 属性与交互面板
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = "http://127.0.0.1:8731";
let failed = 0;
function check(cond, name, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra != null && !cond ? "  → " + extra : ""));
  if (!cond) failed++;
}

const rect = (id, x, y, w, h, fill) => ({
  id, type: "rect", x, y, w, h, angle: 0, z: 1, layer: "l1", lock: false, text: "",
  style: {
    fill, line: fill, lineWidth: 1, cornerRadius: 0, opacity: 1,
    font: { family: "Segoe UI", size: 12, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" },
  },
});

const FIXTURE = {
  format: "visioxure", version: 1,
  doc: { theme: "light", variables: [] }, assets: [], library: [],
  pages: [{
    id: "p1", name: "页面-1",
    size: { mode: "fixed", w: 400, h: 300, orientation: "portrait" },
    background: "#FFFFFF", grid: "small", guides: [], variables: [],
    layers: [{ id: "l1", name: "默认", visible: true, locked: false }],
    shapes: [
      Object.assign(rect("pan1", 20, 20, 120, 80, "transparent"), {
        type: "panel", z: 1,
        style: { fill: "transparent", line: "transparent", lineWidth: 1, cornerRadius: 0, opacity: 1 },
        panel: {
          active: "st1", clip: true,
          states: [
            {
              id: "st1", name: "第一态", shapes: [
                rect("k1", 30, 30, 60, 40, "#123456"),
                rect("kOut", 150, 30, 60, 40, "#654321"),   // 视口外的溢出内容
                Object.assign(rect("pg1", 35, 35, 2, 2, "transparent"), {
                  interactions: [{ event: "pageload", actions: [{ type: "setVar", scope: "global", name: "seen", value: "active" }] }],
                }),
              ],
            },
            {
              id: "st2", name: "第二态", shapes: [
                rect("k2", 30, 30, 60, 40, "#00AA00"),
                Object.assign(rect("pg2", 35, 35, 2, 2, "transparent"), {
                  interactions: [{ event: "pageload", actions: [{ type: "setVar", scope: "global", name: "ghost", value: "hidden" }] }],
                }),
              ],
            },
            { id: "st3", name: "第三态", shapes: [rect("k3", 30, 30, 60, 40, "#0000AA")] },
          ],
        },
        interactions: [{ event: "statechange", actions: [{ type: "setVar", scope: "global", name: "lastState", value: "{{panelStateName}}" }] }],
      }),
      Object.assign(rect("btnNext", 200, 120, 80, 30, "#DDDDDD"), {
        z: 2, interactions: [{ event: "click", actions: [{ type: "setState", target: "pan1", state: "next", effect: "fade", duration: 100 }] }],
      }),
      Object.assign(rect("btnCycle", 200, 160, 80, 30, "#CCCCCC"), {
        z: 3, interactions: [{ event: "click", actions: [{ type: "setState", target: "pan1", state: "cycle", effect: "slide", direction: "up", duration: 80 }] }],
      }),
    ],
  }],
};

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text());
  });

  await p.goto(ROOT + "/frontend/index.html");
  await p.waitForFunction(() => window.VX && VX.Model.page() && VX.ExportSvg && VX.ExportHtml &&
    VX.History && VX.Tools && VX.DocTabs && document.getElementById("doc-tabs"));

  const loadFixture = () => p.evaluate((doc) => {
    VX.Model.load(JSON.stringify(doc));
    VX.History.reset();
    VX.state.grid = false;
    VX.state.zoom = 1; VX.state.ox = 40; VX.state.oy = 40;
    VX.Tools.set("select");
    VX.Renderer.invalidate();
  }, FIXTURE);

  // ---------- 1. 形状库插入 / 默认数据契约 ----------
  await p.evaluate(() => {
    VX.Model.page().shapes.length = 0;
    VX.state.selection = [];
    VX.Model.emit("selection");
  });
  await p.locator("#stencil-panel .stencil-item")
    .filter({ has: p.locator('.stencil-name:text-is("动态面板")') }).first().click();
  await p.waitForTimeout(80);
  const base = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    if (!s) return null;
    return { type: s.type, states: VX.Model.panelStates(s).length,
      active: s.panel.active, first: VX.Model.panelStates(s)[0].id,
      clip: VX.Model.panelClip(s), clipField: s.panel.clip };
  });
  check(base && base.type === "panel", "形状库可插入动态面板", JSON.stringify(base));
  check(base && base.states === 1 && base.active === base.first, "新建面板自带一个默认状态与 active", JSON.stringify(base));
  check(base && base.clip === true && base.clipField === true, "新建面板默认开启内容裁剪", JSON.stringify(base));

  // ---------- 2. 状态 CRUD / 复制 / 排序 / 几何联动 / 适应内容 ----------
  const crud = await p.evaluate(() => {
    const s = VX.Model.shape(VX.state.selection[0]);
    const st1 = VX.Model.panelState(s);
    st1.shapes.push(Object.assign({}, {
      id: "kidA", type: "rect", x: 50, y: 60, w: 40, h: 30, angle: 0, z: 1,
      layer: "l1", lock: false, text: "", style: { fill: "#112233", line: "#112233", lineWidth: 1, opacity: 1 },
    }));
    const st2 = VX.Model.addPanelState(s, "复制态", st1.id);
    const st3 = VX.Model.addPanelState(s);
    const copyOk = st2.shapes.length === 1 && st2.shapes[0].id !== "kidA" && st2.shapes[0].x === 50;
    const moved = VX.Model.movePanelState(s, st3.id, -1);
    const order = VX.Model.panelStates(s).map((x) => x.id);

    VX.Model.setPanelState(s, st1.id);
    const removed = VX.Model.removePanelState(s, st1.id);
    const activeOk = s.panel.active !== st1.id && !!VX.Model.panelStateById(s, s.panel.active);
    const before = VX.Model.panelStates(s).map((st) => st.shapes.map((k) => ({ id: k.id, x: k.x, y: k.y })));
    VX.Model.moveShapeBy(s, 10, 20);
    const after = VX.Model.panelStates(s).map((st) => st.shapes.map((k) => ({ id: k.id, x: k.x, y: k.y })));
    const allMoved = before.every((state, i) => state.every((k, j) =>
      after[i][j].x === k.x + 10 && after[i][j].y === k.y + 20));
    const bounds = VX.Model.panelContentBounds(s);
    const fit = VX.Model.fitPanelToContent(s);
    const ids = VX.Model.panelStates(s).map((x) => x.id);
    VX.Model.removePanelState(s, ids[0]);
    const lastRejected = VX.Model.removePanelState(s, ids[1]) === false && VX.Model.panelStates(s).length === 1;
    return {
      copyOk, moved, order, removed, activeOk, allMoved, fit, bounds, lastRejected,
      panel: { x: s.x, y: s.y, w: s.w, h: s.h, px: 10, py: 20 },
    };
  });
  check(crud.copyOk, "可复制状态并重新生成子形状 id");
  check(crud.moved && crud.order[1] !== "st1" && crud.order.length === 3, "状态可上移排序", JSON.stringify(crud.order));
  check(crud.removed && crud.activeOk, "删除当前状态后 active 自动落到有效状态");
  check(crud.allMoved, "平移面板带动全部状态的子形状", JSON.stringify(crud));
  check(crud.fit && crud.panel.x === crud.bounds.x && crud.panel.w === crud.bounds.w,
    "适应内容尺寸把视口对齐内容包围盒", JSON.stringify(crud));
  check(crud.lastRejected, "最后一个状态不允许删除");

  // 旧 schema（P4 之前的 {action,targets}）载入后必须归一化
  const legacy = await p.evaluate(() => {
    const doc = JSON.parse(VX.Model.serialize());
    doc.pages[0].shapes.push({
      id: "legacy", type: "panel", x: 0, y: 0, w: 80, h: 50,
      panel: { action: "toggle", targets: [] },
      style: { fill: "transparent", line: "transparent", lineWidth: 1, opacity: 1 },
    });
    VX.Model.load(JSON.stringify(doc));
    const s = VX.Model.shape("legacy");
    return { states: VX.Model.panelStates(s).length, active: s.panel.active,
      first: s.panel.states[0].id, shapes: Array.isArray(s.panel.states[0].shapes),
      clip: VX.Model.panelClip(s), name: VX.Model.panelName(s) };
  });
  check(legacy.states === 1 && legacy.active === legacy.first && legacy.shapes && !legacy.clip && !!legacy.name,
    "旧面板 schema 载入后归一化，并保持旧的「不裁剪」行为", JSON.stringify(legacy));

  const legacyRuntime = await p.evaluate(() => {
    const doc = JSON.parse(VX.Model.serialize());
    doc.pages[0].shapes.find((s) => s.id === "legacy").panel = { action: "toggle" };
    const run = VX.Interact.create(doc);
    const panel = run.findShape("legacy");
    return { states: VX.Model.panelStates(panel).length, clip: VX.Model.panelClip(panel) };
  });
  check(legacyRuntime.states === 1 && !legacyRuntime.clip,
    "交互运行时同样归一化旧面板数据（预览/HTML 导出）", JSON.stringify(legacyRuntime));

  // ---------- 3. 画布拖动：tools 层带动全部状态 ----------
  await loadFixture();
  const drag = await p.evaluate(() => {
    const w0 = { x: 60, y: 50 };
    const sc0 = VX.Viewport.w2s(w0.x, w0.y);
    VX.Tools.onMouseDown(w0, sc0, { shiftKey: false, altKey: false });
    const sel = VX.state.selection.slice();
    VX.Tools.onMouseMove({ x: 90, y: 70 }, VX.Viewport.w2s(90, 70), { shiftKey: false });
    VX.Tools.onMouseUp({ x: 90, y: 70 }, VX.Viewport.w2s(90, 70), { shiftKey: false });
    const panel = VX.Model.shape("pan1");
    const kids = VX.Model.panelStates(panel).map((st) => (st.shapes || []).map((k) => ({ id: k.id, x: k.x, y: k.y })));
    return { sel, panel: { x: panel.x, y: panel.y },
      all: kids.every((st) => st.every((k) => {
        const f = { k1: [30, 30], kOut: [150, 30], pg1: [35, 35], k2: [30, 30], pg2: [35, 35], k3: [30, 30] }[k.id];
        return f && k.x === f[0] + 30 && k.y === f[1] + 20;
      })) };
  });
  check(drag.sel.length === 1 && drag.sel[0] === "pan1", "画布可命中并选中面板", JSON.stringify(drag.sel));
  check(drag.panel.x === 50 && drag.panel.y === 40 && drag.all,
    "拖动面板时全部状态的子形状同步平移", JSON.stringify(drag));

  // ---------- 4. 视口裁剪：Canvas / 命中 / SVG ----------
  await loadFixture();
  const clip = await p.evaluate(async () => {
    const pg = VX.Model.page();
    const panel = VX.Model.shape("pan1");
    const cv = document.createElement("canvas");
    cv.width = pg.size.w; cv.height = pg.size.h;
    const c = cv.getContext("2d");
    const opts = { zoom: 1, ox: 0, oy: 0, grid: false, exported: true, paintBg: true };
    const at = (x, y) => Array.from(c.getImageData(x, y, 1, 1).data).slice(0, 3);
    const hit = () => { const s = VX.Hit.inPage(pg.shapes, 160, 40, { over: () => null }); return s ? s.id : null; };

    VX.Renderer.drawScene(c, pg, opts);
    const clipped = at(160, 40);
    const inside = at(40, 40);
    const hitClipped = hit();
    const svgClipped = VX.ExportSvg.svg(pg, {});

    panel.panel.clip = false;
    VX.Renderer.drawScene(c, pg, opts);
    const free = at(160, 40);
    const hitFree = hit();
    const svgFree = VX.ExportSvg.svg(pg, {});
    const parsed = new DOMParser().parseFromString(svgClipped, "image/svg+xml");
    const sampleSvg = async (text) => {
      const img = new Image();
      const ok = await new Promise((res) => {
        img.onload = () => res(true); img.onerror = () => res(false);
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
      });
      if (!ok) return null;
      const c2 = document.createElement("canvas");
      c2.width = img.naturalWidth; c2.height = img.naturalHeight;
      const ctx2 = c2.getContext("2d");
      ctx2.drawImage(img, 0, 0);
      return Array.from(ctx2.getImageData(160, 40, 1, 1).data).slice(0, 3);
    };
    const svgClippedPx = await sampleSvg(svgClipped);
    const svgFreePx = await sampleSvg(svgFree);
    return {
      clipped, inside, free, hitClipped, hitFree, svgClippedPx, svgFreePx,
      svgClip: svgClipped.includes('<clipPath id="vxpanelclip-pan1"') && svgClipped.includes('clip-path="url(#vxpanelclip-pan1)"'),
      svgFree: !svgFree.includes("vxpanelclip-pan1"),
      xmlOk: !parsed.querySelector("parsererror"),
    };
  });
  const white = (v) => v.every((x) => x >= 250);
  check(white(clip.clipped) && white(clip.free) === false, "Canvas：裁剪开启时框外内容不绘制，关闭后绘制",
    JSON.stringify(clip));
  check(clip.inside[0] === 0x12 && clip.inside[2] === 0x56, "Canvas：框内内容始终正常绘制", JSON.stringify(clip.inside));
  check(clip.hitClipped === null && clip.hitFree === "kOut", "命中：裁剪后框外内容不可点击", JSON.stringify(clip));
  check(clip.svgClip && clip.svgFree && clip.xmlOk, "SVG：裁剪用 clipPath 且可解析，关闭后不输出", JSON.stringify(clip));
  check(clip.svgClippedPx && white(clip.svgClippedPx) && clip.svgFreePx && !white(clip.svgFreePx),
    "SVG 解码后裁剪真实生效（框外内容被裁掉，关闭后出现）", JSON.stringify(clip));

  // ---------- 5. setState 动作：next/cycle、动效、OnStateChange、页面载入可见状态 ----------
  await loadFixture();
  const rt = await p.evaluate(() => {
    const doc = JSON.parse(VX.Model.serialize());
    const run = VX.Interact.create(doc);
    run.init();
    const panel = run.findShape("pan1");
    const next = run.findShape("btnNext");
    const cycle = run.findShape("btnCycle");
    const init = {
      seen: run.vars.global.seen, ghost: run.vars.global.ghost,
      lastState: run.vars.global.lastState,
    };
    run.dispatch(next, "click");
    const a = {
      state: run.over(panel).state,
      fx: run.over(panel).panelFx ? run.over(panel).panelFx.effect : null,
      lastState: run.vars.global.lastState,
    };
    run.dispatch(next, "click");
    run.dispatch(next, "click");
    const clamped = run.over(panel).state;
    run.dispatch(cycle, "click");
    const b = {
      state: run.over(panel).state,
      effect: run.over(panel).panelFx ? run.over(panel).panelFx.effect : null,
      dir: run.over(panel).panelFx ? run.over(panel).panelFx.dir : null,
      lastState: run.vars.global.lastState,
    };
    run.tick(200);
    const cleared = !run.over(panel).panelFx && run.tick(16) === false;
    return { init, a, clamped, b, cleared };
  });
  check(rt.init.seen === "active" && rt.init.ghost === undefined,
    "页面载入只派发激活状态（非激活状态不触发）", JSON.stringify(rt.init));
  check(rt.a.state === "st2" && rt.a.fx === "fade" && rt.a.lastState === "第二态",
    "next 切到下一状态 + 淡入淡出 + OnStateChange 变量插值", JSON.stringify(rt.a));
  check(rt.clamped === "st3", "next 到末尾停在最后一个状态", rt.clamped);
  check(rt.b.state === "st1" && rt.b.effect === "slide" && rt.b.dir === "up" && rt.b.lastState === "第一态",
    "cycle 从末尾循环回第一个状态 + 滑动动效", JSON.stringify(rt.b));
  check(rt.cleared, "动画播完自动清除过渡状态，运行时不再空转");

  // 状态改变里再切状态：递归深度必须有保护，不能栈溢出
  const loop = await p.evaluate(() => {
    const doc = JSON.parse(VX.Model.serialize());
    const panel = doc.pages[0].shapes.find((s) => s.id === "pan1");
    panel.interactions = [{ event: "statechange", actions: [{ type: "setState", target: "pan1", state: "cycle" }] }];
    const run = VX.Interact.create(doc);
    run.init();
    run.dispatch(run.findShape("btnNext"), "click");
    return { state: run.over(run.findShape("pan1")).state };
  });
  check(!!loop.state, "OnStateChange 里再切状态有递归保护", JSON.stringify(loop));

  // ---------- 6. 属性面板 / 交互面板 ----------
  await loadFixture();
  const ui = await p.evaluate(() => {
    VX.state.selection = ["pan1"];
    VX.Events.emit("selection");
    VX.Model.emit("change");
    VX.Props.render();
    VX.Inspect.render();
    const props = document.getElementById("props-panel").textContent;
    const inspect = document.getElementById("interact-panel").textContent;
    const fitBtn = Array.from(document.querySelectorAll("#props-panel button"))
      .some((b) => b.textContent.includes("适应内容尺寸"));
    const headEl = document.querySelector("#props-panel .sp-head");
    const head = headEl ? headEl.textContent : "";

    const btn = VX.Model.shape("btnNext");
    btn.interactions.push({ event: "click", actions: [
      { type: "setState", target: "pan1", state: "cycle", effect: "slide", direction: "up", duration: 250 },
    ] });
    VX.state.selection = ["btnNext"];
    VX.Events.emit("selection");
    VX.Inspect.render();
    const action = document.getElementById("interact-panel").textContent;
    const nums = Array.from(document.querySelectorAll("#interact-panel input[type=number]"))
      .map((i) => i.value);
    return {
      head, fitBtn, hasClip: props.includes("内容裁剪"), hasHint: props.includes("适应内容尺寸"),
      hasAdd: inspect.includes("+ 空白状态"), hasCopy: inspect.includes("+ 复制当前状态"),
      hasMove: inspect.includes("↑") && inspect.includes("↓"),
      hasCycle: action.includes("循环下一个"), hasFade: action.includes("淡入淡出"),
      hasDir: action.includes("向上"), nums,
    };
  });
  check(ui.head === "动态面板" && ui.hasClip && ui.fitBtn && ui.hasHint,
    "属性面板提供动态面板专用区（几何/裁剪/适应内容尺寸）", JSON.stringify(ui));
  check(ui.hasAdd && ui.hasCopy && ui.hasMove, "交互面板支持新增/复制/排序状态", JSON.stringify(ui));
  check(ui.hasCycle && ui.hasFade && ui.hasDir && ui.nums.includes("250"),
    "setState 动作可配置循环切换/动效/方向/时长", JSON.stringify(ui));

  // ---------- 7. HTML 导出内联的运行时同样带新面板逻辑 ----------
  const htmlOk = await p.evaluate(async () => {
    const text = await VX.ExportHtml.build(VX.Model.serialize(), { title: "面板验收" });
    return { len: text.length, clip: text.includes("panelClip"), fx: text.includes("panelFx"),
      walk: text.includes("rt.walk(p.shapes") };
  });
  check(htmlOk.len > 8000 && htmlOk.clip && htmlOk.fx && htmlOk.walk,
    "HTML 导出内联了裁剪/过渡/可见状态遍历逻辑", JSON.stringify(htmlOk));

  // ---------- 8. 状态编辑页签（画布上方，标题=面板名） ----------
  await loadFixture();
  const tab1 = await p.evaluate(() => {
    VX.Tools.onDoubleClick({ x: 60, y: 50 }, VX.Viewport.w2s(60, 50), {});
    const list = Array.from(document.querySelectorAll("#doc-tabs .doc-tab")).map((t) => ({
      id: t.dataset.panelId,
      label: t.querySelector(".doc-tab-label") ? t.querySelector(".doc-tab-label").textContent : t.textContent,
      state: t.querySelector(".doc-tab-state") ? t.querySelector(".doc-tab-state").textContent : "",
      active: t.classList.contains("active"),
    }));
    return { list, pe: VX.state.panelEdit, crumb: document.getElementById("status-page-name").textContent };
  });
  check(tab1.list.length === 2 && tab1.list[1].id === "pan1" && tab1.list[1].active &&
        tab1.list[1].label === "动态面板 1" && tab1.list[1].state === "第一态",
    "双击面板打开状态编辑页签，标题是面板名 + 状态名", JSON.stringify(tab1));
  check(tab1.pe && tab1.pe.panelId === "pan1" && tab1.crumb.includes("动态面板 1"),
    "状态编辑上下文与状态栏面包屑同步", JSON.stringify(tab1));

  const renamed = await p.evaluate(() => {
    VX.state.selection = ["pan1"];
    VX.Events.emit("selection");
    VX.Props.render();
    const inp = document.querySelector("#props-panel input.sp-text");
    if (!inp) return { found: false };
    inp.value = "订单面板";
    inp.dispatchEvent(new Event("change"));
    return {
      found: true, name: VX.Model.shape("pan1").name,
      labels: Array.from(document.querySelectorAll("#doc-tabs .doc-tab-label")).map((x) => x.textContent),
    };
  });
  check(renamed.found && renamed.name === "订单面板" && renamed.labels.includes("订单面板"),
    "属性面板可重命名动态面板，页签标题实时跟随", JSON.stringify(renamed));

  const switchRes = await p.evaluate(() => {
    document.querySelector("#doc-tabs .doc-tab-page").click();
    const back = { pe: VX.state.panelEdit, active: document.querySelector("#doc-tabs .doc-tab.active").dataset.panelId };
    document.querySelector('#doc-tabs .doc-tab[data-panel-id="pan1"]').click();
    const again = { pe: VX.state.panelEdit, active: document.querySelector("#doc-tabs .doc-tab.active").dataset.panelId };
    return { back, again, count: document.querySelectorAll("#doc-tabs .doc-tab").length };
  });
  check(switchRes.back.pe === null && switchRes.back.active === "" &&
        switchRes.again.pe && switchRes.again.pe.panelId === "pan1" && switchRes.again.active === "pan1",
    "页面页签 / 状态页签可来回切换编辑上下文", JSON.stringify(switchRes));

  const radioTab = await p.evaluate(() => {
    VX.state.selection = ["pan1"];
    VX.Events.emit("selection");
    VX.Inspect.render();
    const radios = document.querySelectorAll('#interact-panel input[type="radio"]');
    if (radios.length < 2) return { radios: radios.length };
    radios[1].click();
    const st = document.querySelector("#doc-tabs .doc-tab-state");
    return { radios: radios.length, state: st ? st.textContent : "", active: VX.Model.shape("pan1").panel.active };
  });
  check(radioTab.active === "st2" && radioTab.state === "第二态",
    "切换设计态后页签上的状态名同步", JSON.stringify(radioTab));

  const closed = await p.evaluate(() => {
    document.querySelector("#doc-tabs .doc-tab-close").click();
    return { count: document.querySelectorAll("#doc-tabs .doc-tab").length, pe: VX.state.panelEdit };
  });
  check(closed.count === 1 && closed.pe === null, "关闭状态页签回到页面编辑", JSON.stringify(closed));

  // ---------- 9. 预览里真实点击按钮切状态（不是只调 API） ----------
  await loadFixture();
  await p.evaluate(() => VX.Preview.open());
  await p.waitForTimeout(100);
  const btnPoint = await p.evaluate(() => {
    const r = document.getElementById("preview-canvas").getBoundingClientRect();
    const zoom = r.width / 400;
    return { x: r.left + 240 * zoom, y: r.top + 135 * zoom };
  });
  await p.mouse.click(btnPoint.x, btnPoint.y);
  await p.waitForTimeout(160);
  const previewState = await p.evaluate(() => (VX.Preview.debug().overrides.pan1 || {}).state);
  check(previewState === "st2", "预览里真实点击按钮能切换面板状态", String(previewState));
  await p.evaluate(() => VX.Preview.close());

  // ---------- 10. 状态编辑中点插形状落在面板视口内 ----------
  await loadFixture();
  await p.evaluate(() => VX.Tools.onDoubleClick({ x: 60, y: 50 }, VX.Viewport.w2s(60, 50), {}));
  await p.locator("#stencil-panel .stencil-item")
    .filter({ has: p.locator('.stencil-name:text-is("主按钮")') }).first().click();
  await p.waitForTimeout(80);
  const inserted = await p.evaluate(() => {
    const panel = VX.Model.shape("pan1");
    const st = VX.Model.panelStateById(panel, VX.state.panelEdit.stateId);
    const s = st.shapes[st.shapes.length - 1];
    return { count: st.shapes.length, x: s.x, y: s.y, w: s.w, h: s.h,
      px: panel.x, py: panel.y, pw: panel.w, ph: panel.h };
  });
  check(inserted.x >= inserted.px && inserted.y >= inserted.py &&
        inserted.x + inserted.w <= inserted.px + inserted.pw &&
        inserted.y + inserted.h <= inserted.py + inserted.ph,
    "状态编辑中点插的形状落在面板视口内（不会被裁剪隐藏）", JSON.stringify(inserted));

  // ---------- 11. 真实样本：旧文档 state:"" 迁移 + 导出 HTML 真实点击 ----------
  const samplePath = path.join(__dirname, "..", "sample", "动态面板测试.html");
  const sampleHtml = fs.readFileSync(samplePath, "utf8");
  const sampleDoc = JSON.parse(
    sampleHtml.match(/<script type="application\/json" id="vx-doc">([\s\S]*?)<\/script>/)[1]);
  // 不论样本文件是否已用新运行时重新导出，都按旧版配置（state 丢失成空串）来验证迁移
  const legacyAction = sampleDoc.pages[0].shapes.find((s) => s.id === "s15").interactions[0].actions[0];
  legacyAction.state = "";
  const migrated = await p.evaluate((d) => {
    VX.Model.load(JSON.stringify(d));
    const panel = VX.Model.shape("s1");
    return {
      a14: VX.Model.shape("s14").interactions[0].actions[0].state,
      a15: VX.Model.shape("s15").interactions[0].actions[0].state,
      first: VX.Model.panelStates(panel)[0].id,
      active: panel.panel.active,
    };
  }, sampleDoc);
  check(migrated.a15 === migrated.first && migrated.a14 === migrated.active,
    "样本：旧文档里丢失的 setState 状态载入时物化，已有状态保持不变", JSON.stringify(migrated));

  const freshHtml = await p.evaluate(async () =>
    await VX.ExportHtml.build(VX.Model.serialize(), { title: "动态面板测试" }));
  check(freshHtml.includes('content="panel-state-v2"'), "导出 HTML 带运行时指纹，可识别旧产物");

  const q = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const qErrs = [];
  q.on("pageerror", (e) => qErrs.push(e.message));
  await q.setContent(freshHtml, { waitUntil: "load" });
  await q.waitForFunction(() => window.VX && document.getElementById("vx-canvas"));
  await q.waitForTimeout(180);
  const geo = await q.evaluate(() => {
    const cv = document.getElementById("vx-canvas");
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return { left: r.left, top: r.top, zoom: (cv.width / dpr) / 800, dpr };
  });
  // (470,290) 只在状态 1 的深色卡片里；状态 2 的卡片只到 x=400，那里是白底
  const sample = () => q.evaluate(({ zoom, dpr }) => {
    const c = document.getElementById("vx-canvas").getContext("2d");
    return Array.from(c.getImageData(Math.round(470 * zoom * dpr), Math.round(290 * zoom * dpr), 1, 1).data).slice(0, 3);
  }, geo);
  const click = async (wx, wy) => {
    await q.mouse.click(geo.left + wx * geo.zoom, geo.top + wy * geo.zoom);
    await q.waitForTimeout(180);
  };
  const isDark = (v) => v[0] < 80 && v[2] < 120;
  const isWhite = (v) => v.every((x) => x >= 250);
  const px0 = await sample();
  await click(410, 430);   // s15：旧文件里 state:""，迁移后 = 第一个状态
  const px1 = await sample();
  await click(260, 430);   // s14：显式切回第二个状态
  const px2 = await sample();
  check(isWhite(px0) && isDark(px1) && isWhite(px2),
    "样本导出 HTML：两个按钮真实点击可在两个状态间来回切换", JSON.stringify({ px0, px1, px2 }));
  check(qErrs.length === 0, "样本导出 HTML 打开无脚本异常", qErrs.join(" | "));
  await q.close();

  check(errors.length === 0, "整个过程无 JS 异常", errors.join(" | "));

  await browser.close();
  console.log("\n" + (failed ? "RESULT: " + failed + " 项失败" : "RESULT: 全部通过"));
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("脚本异常:", e); process.exit(2); });
