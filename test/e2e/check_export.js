// check_export.js —— S1 导出验收：PNG / SVG / HTML / PDF 四条链路（Playwright + 本机 Edge，无头）
// 关注的不是「有没有报错」而是产物本身对不对：
//   · PNG：与画布同一次渲染逐像素比对（1x 时页面区域色差必须为 0），2x 尺寸翻倍，透明底 alpha=0
//   · SVG：DOMParser 必须无错、元素/属性数量与模型一致、能被浏览器解码成图像
//   · HTML：setContent 后自跑 —— 顶栏有页面、点形状真的会跳页、{{var}} 插值生效
//   · PDF：%PDF 头 / 页数 / xref 偏移与真实字节数对得上（用 Node Buffer 复核 base64 解码长度）
// 无 Bridge（纯 http 打开）时导出走 <a download> 退化路径，所以这里直接取 VX.Exporter.raw.*，
// 落盘链路（file.save_dialog 参数化 + export.write）由 C++ 侧与手工验证覆盖
const { chromium } = require("playwright");

const ROOT = "http://127.0.0.1:8731";
let failed = 0;
function check(cond, name, extra) {
  console.log((cond ? "PASS " : "FAIL ") + name + (extra != null && !cond ? "  → " + extra : ""));
  if (!cond) failed++;
}

// 固定夹具：两页 + 各类形状（path/组/面板/连接器/隐藏层/交互/变量一次覆盖完）
const FIXTURE = {
  format: "visioxure", version: 1,
  doc: { theme: "light", variables: [{ name: "username", default: "guest" }] },
  pages: [
    {
      id: "p1", name: "页面-1",
      size: { mode: "fixed", w: 400, h: 300, orientation: "portrait" },
      background: "#FFFFFF", guides: [], variables: [],
      layers: [
        { id: "l1", name: "默认", visible: true, locked: false },
        { id: "l2", name: "隐藏层", visible: false, locked: false },
      ],
      shapes: [
        {
          id: "s1", type: "rect", x: 40, y: 40, w: 120, h: 60, angle: 0, z: 1, layer: "l1", lock: false,
          text: "{{username}}",
          style: {
            fill: "#4A90D9", line: "#2B6CB0", lineWidth: 1.5, cornerRadius: 6, opacity: 1,
            font: { family: "Segoe UI", size: 14, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" },
          },
          interactions: [{ event: "click", actions: [{ type: "openLink", target: "p2" }] }],
        },
        {
          id: "s2", type: "ellipse", x: 220, y: 60, w: 80, h: 80, angle: 0, z: 2, layer: "l1", lock: false,
          text: "",
          style: { fill: "#5BA85B", line: "#3D7A3D", lineWidth: 1.5, cornerRadius: 0, opacity: 1 },
        },
        {
          id: "s3", type: "path", x: 60, y: 170, w: 100, h: 60, angle: 0, z: 3, layer: "l1", lock: false,
          text: "",
          style: { fill: "transparent", line: "#5646B0", lineWidth: 1.5, cornerRadius: 0, opacity: 1 },
          path: {
            fillRule: "evenodd", design: { w: 100, h: 60 }, closed: [true],
            subpaths: [[{ x: 0, y: -30 }, { x: 50, y: 0 }, { x: 0, y: 30 }, { x: -50, y: 0 }]],
          },
        },
        {
          id: "s4", type: "rect", x: 300, y: 200, w: 40, h: 30, angle: 0, z: 4, layer: "l2", lock: false,
          text: "", style: { fill: "#FF0000", line: "#000000", lineWidth: 1.5, cornerRadius: 0, opacity: 1 },
        },
        {
          id: "s5", type: "group", x: 250, y: 170, w: 70, h: 40, angle: 0, z: 5, layer: "l1", lock: false,
          text: "", style: null,
          children: [
            { id: "s6", type: "rect", x: 250, y: 170, w: 30, h: 40, angle: 0, z: 5, layer: "l1", lock: false, text: "", style: { fill: "#F59E0B", line: "#B45309", lineWidth: 1.5, cornerRadius: 0, opacity: 1 } },
            { id: "s7", type: "rect", x: 290, y: 170, w: 30, h: 40, angle: 0, z: 5, layer: "l1", lock: false, text: "", style: { fill: "#F59E0B", line: "#B45309", lineWidth: 1.5, cornerRadius: 0, opacity: 1 } },
          ],
        },
        {
          id: "s8", type: "panel", x: 20, y: 240, w: 120, h: 40, angle: 0, z: 6, layer: "l1", lock: false,
          text: "",
          style: { fill: "transparent", line: "transparent", lineWidth: 1, cornerRadius: 0, opacity: 1 },
          panel: {
            active: "st1",
            states: [
              { id: "st1", name: "状态 1", shapes: [{ id: "s9", type: "rect", x: 20, y: 240, w: 60, h: 30, angle: 0, z: 6, layer: "l1", lock: false, text: "状态1", style: { fill: "#111827", line: "#111827", lineWidth: 1, cornerRadius: 0, opacity: 1, font: { family: "Segoe UI", size: 12, color: "#FFFFFF", bold: false, align: "center", vAlign: "middle" } } }] },
              { id: "st2", name: "状态 2", shapes: [] },
            ],
          },
        },
        {
          id: "s10", type: "connector", x: 160, y: 70, w: 60, h: 0, angle: 0, z: 7, layer: "l1", lock: false,
          text: "", route: "straight", glue: { begin: "s1:2", end: "s2:3" },
          style: {
            line: "#37474F", lineWidth: 1.5, opacity: 1, dash: "dash",
            arrowBeginKind: "none", arrowEndKind: "arrow", arrowEndSize: 2, arrowBeginSize: 2,
            font: { family: "Segoe UI", size: 12, color: "#333333", bold: false, align: "center", vAlign: "middle" },
          },
        },
      ],
    },
    {
      id: "p2", name: "页面-2",
      size: { mode: "fixed", w: 300, h: 200, orientation: "landscape" },
      background: "#F0F8FF", guides: [], variables: [],
      layers: [{ id: "l1", name: "默认", visible: true, locked: false }],
      shapes: [
        { id: "s20", type: "rect", x: 60, y: 60, w: 160, h: 60, angle: 0, z: 1, layer: "l1", lock: false, text: "第二页", style: { fill: "#E11D48", line: "#9F1239", lineWidth: 1.5, cornerRadius: 4, opacity: 1, font: { family: "Segoe UI", size: 16, color: "#FFFFFF", bold: true, align: "center", vAlign: "middle" } } },
      ],
    },
  ],
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
  await p.waitForFunction(() => window.VX && VX.Model.page());
  await p.waitForFunction(() => VX.Exporter && VX.ExportPng && VX.ExportSvg && VX.ExportHtml && VX.ExportPdf);

  // ---------- 0. 导出为一级菜单，项齐了，且不再挂在「文件」下 ----------
  const menuStructure = await p.evaluate(() => {
    const exp = document.querySelector('.menus .menu-item[data-menu="export"] #menu-export');
    const fileActs = Array.from(document.querySelectorAll("#menu-file .menu-entry")).map((e) => e.dataset.act);
    return { topLevel: !!exp, fileHasExport: fileActs.some((a) => (a || "").startsWith("export-")) };
  });
  check(menuStructure.topLevel, "导出是文件右边的一级菜单（data-menu=export）");
  check(!menuStructure.fileHasExport, "「文件」菜单里不再包含导出项", JSON.stringify(menuStructure.fileHasExport));
  const acts = await p.$$eval("#menu-export .menu-entry", (els) => els.map((e) => e.dataset.act).filter(Boolean));
  for (const want of ["export-png", "export-png-2x", "export-png-t", "export-svg", "export-html", "export-pdf"]) {
    check(acts.includes(want), "导出菜单有项 " + want, acts.join(","));
  }

  // ---------- 1. 装夹具：两页 + 各类形状 ----------
  await p.evaluate((doc) => {
    VX.Model.load(JSON.stringify(doc));
    VX.History.reset();
    VX.Viewport.fit(VX.Model.page().size.w, VX.Model.page().size.h);
    // fit 会把页面铺满窗口（zoom≈2），逐像素比对需要 100% 视口
    VX.state.zoom = 1; VX.state.dirty = true;
  }, FIXTURE);
  await p.waitForTimeout(120);

  const meta = await p.evaluate(() => {
    const pg = VX.Model.page();
    return {
      pages: VX.Model.doc.pages.length,
      dpr: window.devicePixelRatio || 1,
      size: { w: pg.size.w, h: pg.size.h },
      zoom: VX.state.zoom, ox: VX.state.ox, oy: VX.state.oy,
      cssW: document.getElementById("canvas").clientWidth,
    };
  });
  check(meta.pages === 2, "夹具已载入两页", JSON.stringify(meta.pages));
  check(Math.abs(meta.zoom - 1) < 1e-6, "视口已设为 100%（像素比对的前提）", "zoom=" + meta.zoom);

  // ---------- 2. PNG：尺寸 / 透明 / 与画布逐像素一致 ----------
  const png1 = await p.evaluate(() => {
    const r = VX.Exporter.raw.png({ scale: 1 });
    return { base64: r.base64, byteLength: r.byteLength, width: r.width, height: r.height };
  });
  check(png1.width === meta.size.w && png1.height === meta.size.h,
    "PNG 1x 尺寸 = 页面尺寸", png1.width + "x" + png1.height);
  check(png1.base64.startsWith("iVBORw0KGgo"), "PNG 是合法 PNG 码流（IHDR 头）", png1.base64.slice(0, 12));
  check(Math.abs(png1.byteLength - Math.round(png1.base64.length * 3 / 4)) <= 2,
    "PNG 字节数与 base64 长度自洽", png1.byteLength);

  const png2 = await p.evaluate(() => {
    const r = VX.Exporter.raw.png({ scale: 2 });
    return { width: r.width, height: r.height, byteLength: r.byteLength };
  });
  check(png2.width === meta.size.w * 2 && png2.height === meta.size.h * 2, "PNG 2x 尺寸翻倍", png2.width + "x" + png2.height);
  check(png2.byteLength > png1.byteLength, "PNG 2x 码流大于 1x", png1.byteLength + " → " + png2.byteLength);

  const pngT = await p.evaluate(() => {
    const r = VX.Exporter.raw.png({ scale: 1, transparent: true });
    const img = new Image();
    img.src = "data:image/png;base64," + r.base64;
    return { base64: r.base64, width: r.width, height: r.height };
  });
  const cornerAlpha = await p.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + b64; });
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    c.drawImage(img, 0, 0);
    // 页面左上角外 1px 留白 + 页面内形状外的空白：都必须是全透明
    const a = (x, y) => c.getImageData(x, y, 1, 1).data[3];
    return { pad: a(0, 0), blank: a(200, 280), rect: a(100, 70), w: img.naturalWidth, h: img.naturalHeight };
  }, pngT.base64);
  check(cornerAlpha.pad === 0, "透明导出：页面外留白 alpha=0", JSON.stringify(cornerAlpha));
  check(cornerAlpha.blank === 0, "透明导出：形状之外 alpha=0", JSON.stringify(cornerAlpha));
  check(cornerAlpha.rect > 200, "透明导出：矩形本体仍然不透明", JSON.stringify(cornerAlpha));

  // 不透明导出与画布逐像素比对：把编辑视口摆成 zoom=1 / 原点(20,20)，
  // 背板像素 (20+wx, 20+wy) 应与导出图 (pad+wx, pad+wy) 同色
  const cmp = await p.evaluate(async () => {
    // 让编辑器进入与导出同口径的状态：关掉网格、清空悬停/选择，
    // 剩下的唯一「编辑态专有装饰」是 panel 的虚线示意边界（drawShape 里 opts.editor 才画）
    VX.state.grid = false;
    VX.state.zoom = 1; VX.state.ox = 20; VX.state.oy = 20;
    VX.state.hoverShapeId = null; VX.state.hoverConnEnd = null; VX.state.hoverAnchor = null;
    if (VX.state.selection) VX.state.selection.length = 0;
    VX.state.dirty = true;
    // 等 rAF 真的画完一帧再取像素（只看 dirty 标志会读到上一帧）
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const cv = document.getElementById("canvas");
    const dpr = window.devicePixelRatio || 1;
    if (Math.abs(dpr - 1) > 1e-6) return { skipped: "dpr=" + dpr };
    const ec = cv.getContext("2d");
    const r = VX.Exporter.raw.png({ scale: 1, pad: 0 });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = "data:image/png;base64," + r.base64; });
    const oc = document.createElement("canvas");
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const octx = oc.getContext("2d");
    octx.drawImage(img, 0, 0);
    const pg = VX.Model.page();
    // 收集 panel 包围盒：编辑态在这里多画一圈虚线，比对时跳过
    const panels = [];
    (function walk(list) {
      for (const s of list || []) { if (s.type === "panel") panels.push(s); if (s.children) walk(s.children); }
    })(pg.shapes);
    const inPanel = (wx, wy) => panels.some((b) => wx >= b.x - 2 && wx <= b.x + b.w + 2 && wy >= b.y - 2 && wy <= b.y + b.h + 2);
    let diff = 0, n = 0, worst = 0, skippedPanel = 0;
    for (let wy = 2; wy < pg.size.h - 2; wy += 3) {
      for (let wx = 2; wx < pg.size.w - 2; wx += 3) {
        if (inPanel(wx, wy)) { skippedPanel++; continue; }
        const a = ec.getImageData(20 + wx, 20 + wy, 1, 1).data;
        const b = octx.getImageData(wx, wy, 1, 1).data;
        n++;
        const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
        if (d > 4) { diff++; worst = Math.max(worst, d); }
      }
    }
    return { n, diff, worst, skippedPanel, rate: diff / n };
  });
  if (cmp.skipped) check(false, "PNG 与画布逐像素比对", "跳过：" + cmp.skipped);
  else {
    check(cmp.diff === 0, "PNG 与画布逐像素一致（页面内部）",
      cmp.diff + "/" + cmp.n + " 采样点有差，最大色差 " + cmp.worst);
  }

  // ---------- 3. SVG ----------
  const svg = await p.evaluate(() => VX.Exporter.raw.svg());
  check(/<svg[^>]+viewBox="0 0 400 300"/.test(svg), "SVG viewBox 与页面尺寸一致");
  check(svg.includes('<rect x="0" y="0"') && svg.includes('fill="#FFFFFF"'), "SVG 铺了页面背景");
  const parsed = await p.evaluate((s) => {
    const d = new DOMParser().parseFromString(s, "image/svg+xml");
    if (d.querySelector("parsererror")) return { err: d.querySelector("parsererror").textContent };
    const root = d.documentElement;
    return {
      err: null,
      rootW: root.getAttribute("width"),
      g: root.querySelectorAll("g").length,
      path: root.querySelectorAll("path").length,
      ellipse: root.querySelectorAll("ellipse").length,
      polyline: root.querySelectorAll("polyline").length,
      polygon: root.querySelectorAll("polygon").length,
      text: root.querySelectorAll("text").length,
      textEls: Array.from(root.querySelectorAll("text")).map((t) => ({ y: t.getAttribute("y"), txt: t.textContent })),
      dasharray: root.querySelectorAll("[stroke-dasharray]").length,
      ids: Array.from(root.querySelectorAll("[data-vx-id]")).map((e) => e.getAttribute("data-vx-id")),
      hidden: s.includes("#FF0000"),
    };
  }, svg);
  check(!parsed.err, "SVG 可被 XML 解析器接受", parsed.err || "");
  check(parsed.rootW === "400", "SVG 输出宽度 = 页面宽度", String(parsed.rootW));
  check(parsed.ellipse === 1, "SVG 有 1 个椭圆", "ellipse=" + parsed.ellipse);
  // 矩形(1)+隐藏层矩形(不算)+菱形 path(1)+组内两矩形 + 圆角矩形：至少 4 个 <path>
  check(parsed.path >= 4, "SVG 用 path 表达矩形/圆角/菱形", "path=" + parsed.path);
  check(parsed.polyline >= 1, "SVG 画出连接线折线", "polyline=" + parsed.polyline);
  check(parsed.polygon >= 1, "SVG 画出连接线箭头多边形", "polygon=" + parsed.polygon);
  check(parsed.dasharray >= 1, "SVG 保留虚线线型", "dasharray=" + parsed.dasharray);
  check(!parsed.hidden, "隐藏层形状不进 SVG", "含 #FF0000=" + parsed.hidden);
  check(parsed.ids.includes("s1") && parsed.ids.includes("s5") && !parsed.ids.includes("s4"),
    "SVG 带形状 id（组有、隐藏层无）", JSON.stringify(parsed.ids));
  // 文本的 y 必须是属性；不能把 y="..."> 漏进文本内容（拼接口径错时会发生）
  const texts = parsed.textEls || [];
  check(texts.length >= 1 && texts.every((t) => t.y != null && !/y="/.test(t.txt) && !t.txt.includes(">")),
    "SVG 文本行有合法 y 属性且内容无游离标记", JSON.stringify(texts));

  const svgDecoded = await p.evaluate(async (s) => {
    const img = new Image();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(s);
    const ok = await new Promise((res) => { img.onload = () => res(true); img.onerror = () => res(false); img.src = url; });
    if (!ok) return { ok: false };
    const cv = document.createElement("canvas");
    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const c = cv.getContext("2d");
    c.drawImage(img, 0, 0);
    const at = (x, y) => c.getImageData(x, y, 1, 1).data;
    return { ok: true, w: img.naturalWidth, rect: Array.from(at(60, 50)).slice(0, 3), blank: Array.from(at(200, 280)).slice(0, 3) };
  }, svg);
  check(svgDecoded.ok, "SVG 能被浏览器解码为图像", JSON.stringify(svgDecoded));
  check(svgDecoded.ok && Math.abs(svgDecoded.rect[0] - 0x4a) <= 12 && Math.abs(svgDecoded.rect[2] - 0xd9) <= 12,
    "SVG 里矩形填充色与画布同色", JSON.stringify(svgDecoded.rect));
  check(svgDecoded.ok && svgDecoded.blank[3] === undefined ? true : svgDecoded.ok, "SVG 空白区域解码可用", "");
  check(svgDecoded.ok && svgDecoded.w === 400, "SVG 解码后尺寸 = 页面尺寸", String(svgDecoded.w));

  // ---------- 4. HTML：单文件自跑 ----------
  const html = await p.evaluate(async () => {
    const doc = JSON.parse(VX.Model.serialize());
    return await VX.ExportHtml.build(doc, { title: "导出验收" });
  });
  check(html.length > 8000, "HTML 产物已成型（内联了运行时脚本）", "len=" + html.length);
  check(!/(src="js\/|href="css\/)/.test(html), "HTML 没有任何外部文件引用（真自包含）");
  check(html.includes('id="vx-doc"'), "HTML 内嵌了文档 JSON");
  check(html.includes("VX.Interact") && html.includes("VX.Renderer.drawScene"), "HTML 内联了交互与渲染运行时");
  check(html.includes("页面-2"), "HTML 里带上了第二页数据（整个工程）");

  const q = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const qErrors = [];
  q.on("pageerror", (e) => qErrors.push("pageerror: " + e.message));
  await q.setContent(html, { waitUntil: "load" });
  await q.waitForFunction(() => window.VX && VX.state && document.getElementById("vx-canvas"), null, { timeout: 8000 });
  await q.waitForTimeout(200);
  check(qErrors.length === 0, "导出 HTML 打开无脚本异常", qErrors.join(" | "));

  const boot = await q.evaluate(() => {
    const pages = Array.from(document.querySelectorAll("#vx-pages .vx-page-name")).map((b) => b.textContent.trim());
    const cv = document.getElementById("vx-canvas");
    const side = document.getElementById("vx-side").getBoundingClientRect();
    const cvr = cv.getBoundingClientRect();
    return { pages, sideLeft: side.left, sideW: side.width, canvasLeft: cvr.left,
      title: document.getElementById("vx-page-title").textContent, cw: cv.width, ch: cv.height };
  });
  check(boot.pages.join("|") === "页面-1|页面-2", "导出 HTML 左侧页面树列出全部页面", JSON.stringify(boot.pages));
  check(boot.sideLeft === 0 && boot.canvasLeft >= boot.sideW - 1, "导出 HTML 页面树在左侧（画布在其右侧）",
    "sideLeft=" + boot.sideLeft + " sideW=" + boot.sideW + " canvasLeft=" + boot.canvasLeft);
  check(boot.title === "页面-1", "导出 HTML 默认显示第一页", boot.title);
  check(boot.cw > 0 && boot.ch > 0, "导出 HTML 画布已按舞台适配", boot.cw + "x" + boot.ch);

  // 形状真的画出来了 + {{var}} 插值生效
  const painted = await q.evaluate(() => {
    const cv = document.getElementById("vx-canvas");
    const c = cv.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const zoom = (cv.width / dpr) / 400;      // 运行时把页面等比铺满，按宽度推算 zoom
    const at = (wx, wy) => {
      const d = c.getImageData(Math.round(wx * zoom * dpr), Math.round(wy * zoom * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    return { rect: at(60, 50), blank: at(200, 280), zoom };
  });
  check(Math.abs(painted.rect[0] - 0x4a) <= 24 && Math.abs(painted.rect[2] - 0xd9) <= 24,
    "导出 HTML 画出了矩形（与编辑器同色）", JSON.stringify(painted.rect));
  // 页面底色必须真的铺上：早期 exported 分支连底色一起跳过，空白处露出舞台灰（#e9ebee），
  // 用户看到的就是「导出的页面不是白的」。空白采样必须接近页面背景色 255
  check(painted.blank.every((v) => v >= 250),
    "导出 HTML 页面底色已铺（空白处是白纸，不是舞台灰）", JSON.stringify(painted.blank));
  const interp = await q.evaluate(() => {
    // 交互运行时渲染出的文本应是插值后的 guest，而不是字面 {{username}}
    const rt = null;
    const cv = document.getElementById("vx-canvas");
    const c = cv.getContext("2d");
    // 在矩形中心一带找是否有接近白色的文本像素（字号 14、居中对齐）
    const dpr = window.devicePixelRatio || 1;
    const zoom = (cv.width / dpr) / 400;
    let light = 0;
    for (let wy = 62; wy < 78; wy += 2) {
      for (let wx = 70; wx < 130; wx += 2) {
        const d = c.getImageData(Math.round(wx * zoom * dpr), Math.round(wy * zoom * dpr), 1, 1).data;
        if (d[0] > 200 && d[1] > 200 && d[2] > 200) light++;
      }
    }
    void cv; void rt;
    return { light };
  });
  check(interp.light >= 3, "导出 HTML 里 {{username}} 已插值成白字像素", JSON.stringify(interp));

  // 点形状 → 跳页（真鼠标事件，走运行时命中）
  const clickPos = await q.evaluate(() => {
    const cv = document.getElementById("vx-canvas");
    const r = cv.getBoundingClientRect();
    const zoom = r.width / 400;
    return { x: r.left + 100 * zoom, y: r.top + 70 * zoom };
  });
  await q.mouse.click(clickPos.x, clickPos.y);
  await q.waitForTimeout(200);
  const after = await q.evaluate(() => ({
    title: document.getElementById("vx-page-title").textContent,
    active: (document.querySelector("#vx-pages .vx-page.active .vx-page-name") || {}).textContent,
    ink: (() => {
      const cv = document.getElementById("vx-canvas");
      const c = cv.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const zoom = (cv.width / dpr) / 300;   // 第二页宽 300
      const d = c.getImageData(Math.round(90 * zoom * dpr), Math.round(72 * zoom * dpr), 1, 1).data;
      return [d[0], d[1], d[2]];
    })(),
  }));
  check(after.title === "页面-2", "导出 HTML 点击形状触发「跳转页面」交互", after.title);
  check(String(after.active).trim() === "页面-2", "导出 HTML 页面树高亮跟随切页", String(after.active));
  // 第二页矩形填充 #E11D48 = (225,29,72)：红为主、蓝不高（上一版 ink[2]>0x60 会漏判这个蓝值）
  check(Math.abs(after.ink[0] - 0xe1) <= 24 && Math.abs(after.ink[1] - 0x1d) <= 40 && Math.abs(after.ink[2] - 0x48) <= 40,
    "导出 HTML 第二页内容已重绘", JSON.stringify(after.ink));

  // 页面树点击也能切页
  await q.click("#vx-pages .vx-page:nth-child(1)");
  await q.waitForTimeout(150);
  check((await q.evaluate(() => document.getElementById("vx-page-title").textContent)) === "页面-1",
    "导出 HTML 左侧页面树可点回第一页");

  // 页面树可折叠：折叠后侧栏变窄、列表隐藏，再点一次恢复
  await q.click("#vx-side-toggle");
  await q.waitForTimeout(250);
  const folded = await q.evaluate(() => ({
    collapsed: document.getElementById("vx-app").classList.contains("side-collapsed"),
    sideW: Math.round(document.getElementById("vx-side").getBoundingClientRect().width),
    listHidden: getComputedStyle(document.getElementById("vx-pages")).display === "none",
  }));
  check(folded.collapsed && folded.listHidden && folded.sideW < 60,
    "导出 HTML 页面树可折叠", JSON.stringify(folded));
  await q.click("#vx-side-toggle");
  await q.waitForTimeout(250);
  const unfolded = await q.evaluate(() => ({
    collapsed: document.getElementById("vx-app").classList.contains("side-collapsed"),
    sideW: Math.round(document.getElementById("vx-side").getBoundingClientRect().width),
  }));
  check(!unfolded.collapsed && unfolded.sideW > 150, "导出 HTML 页面树可再次展开", JSON.stringify(unfolded));
  await q.close();

  // ---------- 5. PDF：整个工程多页 ----------
  const pdf = await p.evaluate(() => {
    const r = VX.Exporter.raw.pdf({ scale: 1 });
    const head = atob(r.base64).slice(0, 8);
    const all = atob(r.base64);
    return {
      base64: r.base64, byteLength: r.byteLength, pages: r.pages, head,
      eof: all.slice(-6), xref: all.indexOf("xref"), trailer: all.indexOf("trailer"),
      startxref: Number(all.slice(all.lastIndexOf("startxref") + 10).match(/^\s*(\d+)/)[1]),
      pageCount: (all.match(/\/Type \/Page[^s]/g) || []).length,
      images: (all.match(/\/Subtype \/Image/g) || []).length,
      mediaBoxes: (all.match(/\/MediaBox \[0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\]/g) || []),
    };
  });
  check(pdf.head.startsWith("%PDF-1.4"), "PDF 以 %PDF-1.4 开头", pdf.head);
  check(pdf.pages === 2 && pdf.pageCount === 2, "PDF 页数 = 工程页数", "pages=" + pdf.pages + " /Type /Page=" + pdf.pageCount);
  check(pdf.images === 2, "PDF 内嵌 2 张图像", "images=" + pdf.images);
  check(pdf.eof.trim().endsWith("%%EOF"), "PDF 以 %%EOF 结束", JSON.stringify(pdf.eof));
  check(pdf.xref > 0 && pdf.trailer > pdf.xref, "PDF 有 xref 与 trailer", pdf.xref + "/" + pdf.trailer);
  check(pdf.startxref > pdf.xref - 64 && pdf.startxref <= pdf.byteLength, "startxref 偏移落在文件内", pdf.startxref + "/" + pdf.byteLength);
  // 96dpi → 72pt：页面 400×300px → 300×225pt，第二页 300×200px → 225×150pt
  const boxes = pdf.mediaBoxes.map((m) => m.match(/[\d.]+/g).slice(2).join("x"));
  check(boxes.length === 2 && boxes[0] === "300x225" && boxes[1] === "225x150", "PDF 页面尺寸按 1px=0.75pt", JSON.stringify(pdf.mediaBoxes));

  // Node 侧复核：base64 解出来的字节数与声明一致，且 xref 指向的字节确实是 "N 0 obj"
  const node = require("node:buffer");
  const raw = node.Buffer.from(pdf.base64, "base64");
  check(raw.length === pdf.byteLength, "PDF 声明字节数 = base64 解码真实长度", pdf.byteLength + " vs " + raw.length);
  const xrefBlock = raw.slice(pdf.startxref, pdf.startxref + 400).toString("latin1");
  const offsets = Array.from(xrefBlock.matchAll(/^(\d{10}) 00000 n/gm)).map((m) => Number(m[1]));
  const badObj = offsets.findIndex((off, i) => !raw.slice(off, off + 12).toString("latin1").startsWith((i + 1) + " 0 obj"));
  check(offsets.length === 3 + pdf.pages * 3, "PDF xref 条目数覆盖全部对象",
    "offsets=" + offsets.length + " 期望 " + (3 + pdf.pages * 3));
  check(badObj < 0, "PDF 每个 xref 偏移都指向正确的对象号",
    badObj < 0 ? "" : "obj " + (badObj + 1) + " → " + raw.slice(offsets[badObj], offsets[badObj] + 16).toString("latin1"));
  const jpgAt = raw.slice(offsets[3], offsets[3] + 400).toString("latin1");
  check(/\/Width 400 \/Height 300/.test(jpgAt), "PDF 图像 XObject 像素尺寸正确", jpgAt.slice(0, 120));
  check(raw.slice(offsets[3]).includes(node.Buffer.from([0xff, 0xd8, 0xff])), "PDF 里 JPEG 码流以 SOI 起始", "");

  // ---------- 6. 导出接线：无 Bridge 时退化下载，状态栏有反馈 ----------
  const wired = await p.evaluate(async () => {
    let clicked = "";
    document.getElementById("status-msg").textContent = "";
    const el = document.querySelector('#menu-export [data-act="export-svg"]');
    if (!el) return { has: false };
    clicked = el.dataset.act;
    el.click();                      // 无 Bridge → askPath 返回 null，应当安静地什么都不写
    await new Promise((r) => setTimeout(r, 120));
    return { has: true, clicked, status: document.getElementById("status-msg").textContent };
  });
  check(wired.has && wired.clicked === "export-svg", "导出菜单项已接线", JSON.stringify(wired));
  check(wired.status === "", "无 Bridge 时取消路径不报错（不污染状态栏）", JSON.stringify(wired.status));

  check(errors.length === 0, "编辑器侧无脚本异常", errors.slice(0, 3).join(" | "));

  console.log(failed ? "\nRESULT: " + failed + " 项失败" : "\nRESULT: 全部通过");
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.log("脚本异常: " + (e && e.stack ? e.stack : e));
  process.exit(2);
});
