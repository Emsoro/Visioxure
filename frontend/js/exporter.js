// exporter.js —— 导出接线层：产物生成 → 原生存盘对话框 → 后端写文件
// 三条链路的分工（CODEPLAN §2 职责边界：后端保持无状态）
//   1. 前端算产物：PNG/SVG/HTML/PDF 全部在前端生成（画布/离屏 canvas 只有前端有），交回 base64 或文本
//   2. file.save_dialog 只负责问路径（标题 / 扩展名过滤由调用方给）
//   3. export.write 收到 base64 解一次码写盘，不关心格式
// 无 Bridge（浏览器直开 / E2E 静态服务）时退化成 <a download>，方便脚本验收产物内容
"use strict";

(function () {
  const bridge = () => window.__tauricpp__;

  function status(msg) {
    const el = document.getElementById("status-msg");
    if (el) el.textContent = msg;
  }

  function fail(kind, e) {
    status(kind + "失败：" + (e && e.message ? e.message : e));
    console.error(kind + " failed:", e);
    if (bridge()) bridge().invoke("log_error", { message: kind + ": " + (e && e.stack ? e.stack : e) });
  }

  // 文档基础名（去掉 .vsdx），导出文件与工程同名
  function stem() {
    const p = VX.FileIO && VX.FileIO.path ? VX.FileIO.path() : null;
    const base = p ? p.replace(/^.*[\\/]/, "") : "未命名";
    return base.replace(/\.vsdx$/i, "") || "未命名";
  }

  function sanitize(name) {
    return String(name).replace(/[\\/:*?"<>|]/g, "_").trim() || "page";
  }

  const EXT = { png: ".png", svg: ".svg", html: ".html", pdf: ".pdf" };

  // ---------- 存盘 ----------
  async function askPath(kind, name) {
    const b = bridge();
    if (!b) return null;
    const r = await b.invoke("file.save_dialog", {
      title: "导出 " + kind.toUpperCase(),
      default_name: name,
      filters: [{ name: kind.toUpperCase() + " 文件", pattern: "*" + EXT[kind] }],
      extension: EXT[kind],
    });
    if (!r || !r.success || !r.path) return null;
    return r.path;
  }

  // 文本 → UTF-8 字节 → base64（btoa 只吃 Latin-1，中文 HTML/SVG 必须先编码）
  function b64FromText(text) {
    const u8 = new TextEncoder().encode(text);
    let bin = "";
    for (let i = 0; i < u8.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  async function write(kind, path, payload) {
    const b = bridge();
    const base64 = payload.base64 != null ? payload.base64 : b64FromText(payload.text);
    const byteLength = payload.byteLength != null ? payload.byteLength : Math.round(base64.length * 3 / 4);
    if (!b) { download(path, base64); return { success: true, path, size: byteLength, downloaded: true }; }
    const r = await b.invoke("export.write", { path, base64 });
    if (!r || !r.success) throw new Error(r && r.error ? r.error : "写入失败");
    return { path, size: r.size != null ? r.size : byteLength };
  }

  function download(path, base64) {
    const name = path.replace(/^.*[\\/]/, "");
    const bin = atob(base64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const mime = /\.svg$/i.test(name) ? "image/svg+xml" : /\.html$/i.test(name) ? "text/html"
      : /\.pdf$/i.test(name) ? "application/pdf" : "image/png";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([u8], { type: mime }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function report(kind, path, size) {
    status(`已导出${kind}：${path.replace(/^.*[\\/]/, "")}（${Math.max(1, Math.round(size / 1024))} KB）`);
  }

  // ---------- 四种产物 ----------
  async function toPng(scale, transparent) {
    const page = VX.Model.page();
    if (!page) throw new Error("没有可导出的页面");
    const r = VX.ExportPng.png(page, { scale, transparent });
    if (!r.base64) throw new Error("画布导出为空");
    const name = `${stem()}_${sanitize(page.name)}${transparent ? "_透明" : ""}_${scale}x.png`;
    const path = await askPath("png", name);
    if (!path) return;
    const w = await write("png", path, r);
    report(" PNG", w.path, w.size);
  }

  async function toSvg() {
    const page = VX.Model.page();
    if (!page) throw new Error("没有可导出的页面");
    const text = VX.ExportSvg.svg(page, {});
    const name = `${stem()}_${sanitize(page.name)}.svg`;
    const path = await askPath("svg", name);
    if (!path) return;
    const w = await write("svg", path, { text });
    report(" SVG", w.path, w.size);
  }

  async function toHtml() {
    const text = await VX.ExportHtml.build(VX.Model.serialize(), { title: stem() });
    const name = `${stem()}.html`;
    const path = await askPath("html", name);
    if (!path) return;
    const w = await write("html", path, { text });
    report(" HTML", w.path, w.size);
  }

  // 整个工程：逐页渲染 JPEG（跳过隐藏层已由 renderer 统一负责），再拼成多页 PDF
  async function toPdf() {
    const pages = VX.Model.doc.pages || [];
    if (!pages.length) throw new Error("没有可导出的页面");
    const shotScale = 2;            // 2x：文本与线条在打印时不发虚
    const done = [];
    for (const pg of pages) {
      const jpeg = VX.ExportPng.jpeg(pg, { scale: shotScale });
      done.push({ page: pg, jpeg });
      status(`正在导出 PDF：${done.length}/${pages.length} 页 …`);
      // 每页渲染是同步的大块工作，让出一帧避免整窗看起来卡死
      await new Promise((r) => requestAnimationFrame(r));
    }
    const r = VX.ExportPdf.pdf(done, { title: stem(), stamp: pdfDate(new Date()) });
    const name = `${stem()}.pdf`;
    const path = await askPath("pdf", name);
    if (!path) return;
    const w = await write("pdf", path, r);
    report(" PDF", w.path, w.size);
  }

  function pdfDate(d) {
    const p = (n, w) => String(n).padStart(w || 2, "0");
    return `${p(d.getFullYear(), 4)}${p(d.getMonth() + 1)}${p(d.getDate())}` +
      `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}Z`;
  }

  // ---------- 菜单 ----------
  const ACTIONS = {
    "export-png": () => toPng(1, false),
    "export-png-2x": () => toPng(2, false),
    "export-png-t": () => toPng(2, true),
    "export-svg": toSvg,
    "export-html": toHtml,
    "export-pdf": toPdf,
  };

  function initMenu() {
    const drop = document.getElementById("menu-export");
    if (!drop) return;
    drop.addEventListener("click", (e) => {
      const entry = e.target.closest(".menu-entry");
      if (!entry) return;
      const act = entry.dataset.act;
      if (!ACTIONS[act]) return;
      drop.classList.add("hidden");
      Promise.resolve()
        .then(() => ACTIONS[act]())
        .catch((err) => fail("导出", err));
    });
  }

  VX.Exporter = {
    init: initMenu,
    toPng, toSvg, toHtml, toPdf,
    // 不落盘直接取产物（验收脚本与调试用）：page 缺省为当前页
    raw: {
      png: (opt) => VX.ExportPng.png(opt && opt.page ? opt.page : VX.Model.page(), opt || {}),
      jpeg: (opt) => VX.ExportPng.jpeg(opt && opt.page ? opt.page : VX.Model.page(), opt || {}),
      svg: (opt) => VX.ExportSvg.svg(opt && opt.page ? opt.page : VX.Model.page(), opt || {}),
      pdf: (opt) => {
        const pages = VX.Model.doc.pages || [];
        return VX.ExportPdf.pdf(pages.map((pg) => ({ page: pg, jpeg: VX.ExportPng.jpeg(pg, { scale: (opt && opt.scale) || 1 }) })),
          { title: (opt && opt.title) || stem(), stamp: pdfDate(new Date()) });
      },
      html: (opt) => VX.ExportHtml.build(opt && opt.doc ? opt.doc : VX.Model.serialize(), opt || {}),
    },
    b64FromText,
    stem,
  };
})();
