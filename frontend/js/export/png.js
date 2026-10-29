// png.js —— 当前页面 → PNG / JPEG 位图（CODEPLAN §7-S1 / §6.7 #47）
// 不另写一套绘制：直接复用 VX.Renderer.drawScene（与画布、F5 预览同一份代码），
// 保证「PNG 与画布像素一致」这条验收标准能被守住：
//   · 线宽不吃编辑态的「最小 1 屏幕像素」下限（opts.exported），否则 2x/3x 的线会比 1x 细
//   · 页面投影与浅灰页框只在编辑器里画，导出产物不带
// scale 通过 zoom 实现（背板像素 = 页面 px × scale，dpr 固定 1，与 preview.js 的画法规程一致）
"use strict";

(function () {
  // 离屏画布：不能复用画布上的 #canvas，否则会把编辑区画花
  function makeCanvas(w, h) {
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w));
    cv.height = Math.max(1, Math.round(h));
    return cv;
  }

  // pad：页面外的留白（透明导出时把描边溢出与抗锯齿留出来）
  function renderPage(page, opt) {
    const scale = Math.max(0.1, opt.scale || 1);
    const pad = opt.transparent ? Math.ceil((opt.pad == null ? 4 : opt.pad) * scale) : 0;
    const w = Math.round(page.size.w * scale) + pad * 2;
    const h = Math.round(page.size.h * scale) + pad * 2;
    // 单张位图不超过 16384×16384：再大浏览器会给不出背板（与 renderer.draw 的尺寸防御同口径）
    if (w > 16384 || h > 16384) throw new Error("导出尺寸过大，请降低倍率或缩小页面");

    const cv = makeCanvas(w, h);
    const c = cv.getContext("2d");
    if (opt.transparent) {
      c.clearRect(0, 0, w, h);   // 透明底：只画形状，不铺页面背景
      VX.Renderer.drawScene(c, page, {
        zoom: scale, ox: pad, oy: pad, grid: false, exported: true, over: opt.over,
        // drawScene 先画页面再画形状：跳过背景由 renderer 里的 exported 分支负责
      });
    } else {
      c.fillStyle = page.background || "#ffffff";
      c.fillRect(0, 0, w, h);
      VX.Renderer.drawScene(c, page, {
        zoom: scale, ox: pad, oy: pad, grid: false, exported: true, over: opt.over,
      });
    }
    return { canvas: cv, width: w, height: h, pageWidth: page.size.w, pageHeight: page.size.h };
  }

  // dataURL → 纯 base64（后端 export.write 收到的就是这段，不再夹带 mime）
  function toBase64(dataUrl) {
    const i = dataUrl.indexOf(",");
    return i >= 0 ? dataUrl.slice(i + 1) : "";
  }

  function byteLengthOf(b64) {
    return Math.round(b64.length * 3 / 4);
  }

  function png(page, opt) {
    const o = opt || {};
    const r = renderPage(page, { scale: o.scale || 1, transparent: !!o.transparent, over: o.over, pad: o.pad });
    const b64 = toBase64(r.canvas.toDataURL("image/png"));
    return {
      base64: b64,
      byteLength: byteLengthOf(b64),
      mime: "image/png",
      width: r.width,
      height: r.height,
      dataUrl: r.canvas.toDataURL("image/png"),
    };
  }

  // JPEG：PDF 内嵌用（DCTDecode 直接吃 JPEG 码流）。不能有 alpha 通道，
  // 所以永远铺白底 —— 透明区域在 PDF 里按白处理是栅格 PDF 的固有取舍（矢量 PDF 见 CODEPLAN C3）
  function jpeg(page, opt) {
    const o = opt || {};
    const r = renderPage(page, { scale: o.scale || 1, transparent: false, over: o.over });
    const url = r.canvas.toDataURL("image/jpeg", o.quality == null ? 0.9 : o.quality);
    const b64 = toBase64(url);
    return { base64: b64, byteLength: byteLengthOf(b64), width: r.width, height: r.height, pageWidth: r.pageWidth, pageHeight: r.pageHeight };
  }

  VX.ExportPng = { png, jpeg, renderPage, toBase64, byteLengthOf };
})();
