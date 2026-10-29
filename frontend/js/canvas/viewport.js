// viewport.js —— 视口：缩放/平移与坐标变换（P1）
// world = 页面坐标（0,0 = 页面左上角）；screen = 画布 CSS 像素
"use strict";

(function () {
  const MIN = 0.2, MAX = 4;

  const Viewport = {
    get zoom() { return VX.state.zoom; },
    get ox() { return VX.state.ox; },
    get oy() { return VX.state.oy; },

    w2s(x, y) { return { x: x * VX.state.zoom + VX.state.ox, y: y * VX.state.zoom + VX.state.oy }; },
    s2w(x, y) { return { x: (x - VX.state.ox) / VX.state.zoom, y: (y - VX.state.oy) / VX.state.zoom }; },

    // 围绕屏幕点 (cx,cy) 缩放
    setZoom(z, cx, cy) {
      z = Math.min(MAX, Math.max(MIN, z));
      const w = this.s2w(cx, cy);
      VX.state.zoom = z;
      VX.state.ox = cx - w.x * z;
      VX.state.oy = cy - w.y * z;
      VX.state.dirty = true;
      VX.Events.emit("zoom");
    },

    pan(dx, dy) {
      VX.state.ox += dx;
      VX.state.oy += dy;
      VX.state.dirty = true;
    },

    // 适应窗口：整页按窗口缩放到能放下，然后贴工作区左上角（打开文档 / 新建文档时调用）
    // 钉在左上角而不是居中：多出来的工作区全落在右侧与下方，页面不会随着窗口尺寸漂到中间
    fit(pageW, pageH) {
      const host = document.getElementById("canvas-scroll");
      if (!host || !pageW || !pageH) return;
      const pad = 32;
      const availW = Math.max(1, host.clientWidth - pad * 2);
      const availH = Math.max(1, host.clientHeight - pad * 2);
      const z = Math.min(MAX, Math.max(MIN, Math.min(availW / pageW, availH / pageH)));
      VX.state.zoom = z;
      // 左/上只留 pad（页面投影不被裁），其余空白留给右/下
      VX.state.ox = pad;
      VX.state.oy = pad;
      VX.state.dirty = true;
      VX.Events.emit("zoom");
    },
  };

  VX.Viewport = Viewport;
})();
