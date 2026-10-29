// html.js —— 整个工程 → 自包含可交互 HTML（CODEPLAN §6.7 #46 · §7-S1）
// 思路：把「编辑器 + F5 预览」里已经跑通的那套运行时原样搬进单个 html 文件——
//   · 绘制复用 renderer.drawScene（与画布/PNG/PDF 同一份代码，导出的页面与编辑器所见一致）
//   · 交互复用 interact.js（事件→动作、三级变量、动态面板状态、动效），运行时壳与 preview.js 同构
// 依赖通过 fetch 相对路径取源码内联：编辑器页面本身就在 https://tauricpp.app/（或 dev 静态服务）下，
// 相对路径既能命中 exe 内嵌资源也能命中磁盘前端目录；只带运行时必需的 6 个文件，
// 不带 clipper.js（199KB，只有布尔运算需要）与 tools/editor/面板脚本（导出页没有编辑能力）
"use strict";

(function () {
  // 顺序即依赖顺序（与 index.html 里的引入顺序一致）
  const CLIENT_SCRIPTS = [
    "js/model.js",
    "js/geometry.js",
    "js/routing.js",
    "js/canvas/hit.js",
    "js/canvas/renderer.js",
    "js/interact.js",
  ];

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("读取 " + url + " 失败（HTTP " + r.status + "）");
    return r.text();
  }

  async function inlineBase() {
    const css = await fetchText("css/app.css");
    const mods = [];
    for (const p of CLIENT_SCRIPTS) mods.push(await fetchText(p));
    return { css, mods };
  }

  // 运行时壳：顶栏（页面切换 + 提示）+ 舞台 + 画布，逻辑与 preview.js 一致
  const RUNTIME = `
(function () {
  "use strict";
  var docData = JSON.parse(document.getElementById("vx-doc").textContent);
  // 渲染器取页面/面板状态都走 VX.Model，这里把文档灌进模型并把它的对象树交给交互运行时，
  // 保证「渲染看到的形状」与「交互改写的形状」是同一批对象
  VX.Model.doc.pages = docData.pages;
  VX.Model.doc.doc = docData.doc || VX.Model.doc.doc;
  var rt = VX.Interact.create(docData);
  VX.Model.doc.pages = rt.doc.pages;
  VX.Model.doc.doc = rt.doc.doc;

  var view = { zoom: 1, ox: 0, oy: 0 };
  var canvas = document.getElementById("vx-canvas");
  var stage = document.getElementById("vx-stage");
  var c = canvas.getContext("2d");
  var hoverId = null, dirty = true, raf = 0, lastT = 0;

  function pageName() { var p = rt.page(); return p ? p.name : ""; }

  // 页面等比铺满舞台：与 preview.js 的 fit 同一套算法（上限 2x，留 48px 边距）
  function fit() {
    var p = rt.page();
    if (!p) return;
    // 渲染器/命中测试里的连接线走 VX.Model.shape → VX.Model.page()，而导出运行时是直接
    // 给 VX.Model.doc.pages 赋值（没走 load），VX.Model 的当前页指针仍是 null。
    // 这里把它同步到当前活动页，否则连接器一命中就抛「reading 'shapes'」
    VX.Model.setCurrentPage(p.id);
    var availW = Math.max(80, stage.clientWidth - 48);
    var availH = Math.max(80, stage.clientHeight - 48);
    var z = Math.min(availW / p.size.w, availH / p.size.h, 2);
    view.zoom = Math.max(0.05, z);
    var cssW = Math.round(p.size.w * view.zoom), cssH = Math.round(p.size.h * view.zoom);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    view.ox = view.oy = 0;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#e9ebee";
    c.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    dirty = true;
    layoutTabs();
    document.getElementById("vx-page-title").textContent = pageName();
  }

  // 页面标签：导出页里可点击切换（交互里的「打开链接/跳转页面」也走同一套 goPage）
  function layoutTabs() {
    var box = document.getElementById("vx-tabs");
    box.innerHTML = "";
    (rt.doc.pages || []).forEach(function (p) {
      var b = document.createElement("button");
      b.className = "vx-tab" + (p.id === rt.pageId() ? " active" : "");
      b.textContent = p.name;
      b.onclick = function () { if (rt.goPage(p.id)) { fit(); } };
      box.appendChild(b);
    });
  }

  function render() {
    var p = rt.page();
    if (!p) return;
    var dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#e9ebee";
    c.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    VX.Renderer.drawScene(c, p, {
      zoom: view.zoom, ox: view.ox, oy: view.oy, grid: false, exported: true,
      over: function (s) { return rt.over(s); },
    });
  }

  function frame(t) {
    var dt = lastT ? Math.min(64, t - lastT) : 16;
    lastT = t;
    var active = rt.tick(dt);
    if (dirty || active) { render(); dirty = false; }
    raf = requestAnimationFrame(frame);
  }

  function worldAt(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.zoom, y: (e.clientY - r.top) / view.zoom };
  }
  function hitAt(w) {
    var p = rt.page();
    if (!p) return null;
    return VX.Hit.inPage(p.shapes, w.x, w.y, { over: function (s) { return rt.over(s); } });
  }
  // 交互派发后：重绘 + 刷新顶栏（标题/标签高亮），页面若切换且尺寸不同则重新适配。
  // 只看 dirty 重绘会让画布跳到新页但顶栏仍停旧页——预览的 afterDispatch 就是干这个的
  function after() {
    dirty = true;
    VX.Model.setCurrentPage(rt.pageId());
    document.getElementById("vx-page-title").textContent = pageName();
    layoutTabs();
    var p = rt.page();
    if (p && Math.abs(p.size.w * view.zoom - canvas.clientWidth) > 1) fit();
  }

  canvas.addEventListener("click", function (e) {
    var s = hitAt(worldAt(e));
    if (!s) return;
    rt.dispatch(s, "click");
    after();
  });
  canvas.addEventListener("dblclick", function (e) {
    var s = hitAt(worldAt(e));
    if (!s) return;
    rt.dispatch(s, "dblclick");
    after();
  });
  canvas.addEventListener("mousemove", function (e) {
    var s = hitAt(worldAt(e));
    var id = s ? s.id : null;
    if (id !== hoverId) {
      if (hoverId) { var prev = rt.findShape(hoverId); if (prev) rt.dispatch(prev, "mouseleave"); }
      hoverId = id;
      if (s) rt.dispatch(s, "mouseenter");
      canvas.style.cursor = s ? "pointer" : "";
      after();
    }
  });
  canvas.addEventListener("mouseleave", function () {
    if (hoverId) {
      var prev = rt.findShape(hoverId);
      if (prev) rt.dispatch(prev, "mouseleave");
      hoverId = null;
      after();
    }
  });
  // 键盘事件：派发给配置了 keydown 交互的形状（与 preview.js 同口径）
  window.addEventListener("keydown", function (e) {
    var p = rt.page();
    if (!p) return;
    var touched = false;
    VX.Interact.walk(p.shapes, function (s) {
      if ((s.interactions || []).some(function (i) { return i.event === "keydown"; })) {
        rt.dispatch(s, "keydown");
        touched = true;
      }
    });
    if (touched) after();
  });

  document.getElementById("vx-title").textContent =
    (docData.doc && docData.doc.name) || document.title || "原型";
  rt.init();
  fit();
  new ResizeObserver(fit).observe(stage);
  raf = requestAnimationFrame(frame);
})();
`;

  const STYLE = `
html, body { margin: 0; height: 100%; font-family: 'Segoe UI', 'Microsoft YaHei', sans-serif; }
#vx-app { display: flex; flex-direction: column; height: 100%; background: #e9ebee; }
#vx-bar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: #fff;
  border-bottom: 1px solid #dfe3e8; font-size: 12px; color: #5b6472; flex: 0 0 auto; }
#vx-title { font-weight: 600; color: #243044; }
#vx-tabs { display: flex; gap: 4px; flex: 1 1 auto; overflow: auto; }
.vx-tab { border: 1px solid #d6dae1; background: #f6f7f9; color: #3c4657; font-size: 12px;
  padding: 3px 10px; border-radius: 5px; cursor: pointer; white-space: nowrap; }
.vx-tab:hover { background: #eef2fb; }
.vx-tab.active { background: #2f6fed; border-color: #2f6fed; color: #fff; }
#vx-page-title { color: #243044; font-weight: 600; }
#vx-hint { color: #8b93a1; }
#vx-stage { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; overflow: hidden; }
#vx-canvas { box-shadow: 0 6px 22px rgba(0, 0, 0, .12); background: #fff; }
`;

  async function build(docJson, opt) {
    const o = opt || {};
    const base = await inlineBase();
    const title = o.title || "Visioxure 原型";
    const doc = typeof docJson === "string" ? docJson : JSON.stringify(docJson);
    const scripts = base.mods.map((src) => `<script>\n${src}\n</script>`).join("\n");
    // 文档 JSON 放在独立 <script type="application/json"> 里：
    // JSON.stringify 会把 </script> 里的 < 转义成 \u003c 之外还会保留字面 </，所以显式替换一次
    const safeDoc = doc.replace(/<\//g, "<\\/");
    return [
      "<!DOCTYPE html>",
      `<html lang="zh-CN">`,
      "<head>",
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      `<title>${escHtml(title)}</title>`,
      `<!-- 由 Visioxure 导出：形状渲染与交互运行时均取自编辑器同一份代码，勿手工改本文件 -->`,
      `<style>${base.css}</style>`,
      `<style>${STYLE}</style>`,
      "</head>",
      "<body>",
      '<div id="vx-app">',
      '  <div id="vx-bar">',
      '    <span id="vx-title"></span>',
      '    <span id="vx-tabs"></span>',
      '    <span id="vx-page-title"></span>',
      '    <span id="vx-hint">导出的原型 · 可直接点击交互</span>',
      "  </div>",
      '  <div id="vx-stage"><canvas id="vx-canvas"></canvas></div>',
      "</div>",
      `<script type="application/json" id="vx-doc">${safeDoc}</script>`,
      scripts,
      `<script>${RUNTIME}</script>`,
      "</body>",
      "</html>",
      "",
    ].join("\n");
  }

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  VX.ExportHtml = { build, CLIENT_SCRIPTS, fetchText, inlineBase };
})();
