// preview.js —— F5 全屏预览（P4）
// 复制当前文档 → 交互运行时 → 独立画布渲染；Esc 退出
"use strict";

(function () {
  let root = null, canvas = null, ctx = null, stage = null;
  let rt = null, raf = 0, lastT = 0, dirty = true;
  let hoverId = null;
  let view = { zoom: 1, ox: 0, oy: 0 };

  function pageName() {
    const p = rt && rt.page();
    return p ? p.name : "";
  }

  function updateBar() {
    const t = document.getElementById("preview-title");
    if (t) t.textContent = pageName();
  }

  // 页面等比适配舞台
  function fit() {
    const p = rt.page();
    if (!p || !stage) return;
    const availW = Math.max(80, stage.clientWidth - 48);
    const availH = Math.max(80, stage.clientHeight - 48);
    const z = Math.min(availW / p.size.w, availH / p.size.h, 2);
    view.zoom = Math.max(0.05, z);
    view.ox = 0;
    view.oy = 0;
    const cssW = Math.round(p.size.w * view.zoom);
    const cssH = Math.round(p.size.h * view.zoom);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    dirty = true;
  }

  function render() {
    if (!rt || !ctx) return;
    const p = rt.page();
    if (!p) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.fillStyle = "#e9ebee";
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    VX.Renderer.drawScene(ctx, p, {
      zoom: view.zoom, ox: view.ox, oy: view.oy, grid: false,
      over: (s) => rt.over(s),
    });
  }

  function frame(t) {
    const dt = lastT ? Math.min(64, t - lastT) : 16;
    lastT = t;
    const active = rt ? rt.tick(dt) : false;
    if (dirty || active) {
      render();
      dirty = false;
      if (active) {
        // 动画可能导致页面切换后尺寸变化（保持简单：不做逐帧 fit）
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function worldAt(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / view.zoom, y: (e.clientY - r.top) / view.zoom };
  }

  function hitAt(w) {
    const p = rt.page();
    if (!p) return null;
    return VX.Hit.inPage(p.shapes, w.x, w.y, { over: (s) => rt.over(s) });
  }

  function afterDispatch() {
    dirty = true;
    updateBar();
    // 页面若切换，重新适配
    const p = rt.page();
    if (p && Math.round(p.size.w * view.zoom) !== parseInt(canvas.style.width, 10)) fit();
  }

  function bind() {
    canvas.addEventListener("click", (e) => {
      const s = hitAt(worldAt(e));
      if (!s) return;
      rt.dispatch(s, "click");
      afterDispatch();
    });
    canvas.addEventListener("dblclick", (e) => {
      const s = hitAt(worldAt(e));
      if (!s) return;
      rt.dispatch(s, "dblclick");
      afterDispatch();
    });
    canvas.addEventListener("mousemove", (e) => {
      const s = hitAt(worldAt(e));
      const id = s ? s.id : null;
      if (id !== hoverId) {
        if (hoverId) {
          const prev = rt.findShape(hoverId);
          if (prev) rt.dispatch(prev, "mouseleave");
        }
        hoverId = id;
        if (s) rt.dispatch(s, "mouseenter");
        dirty = true;
      }
    });
    canvas.addEventListener("mouseleave", () => {
      if (hoverId) {
        const prev = rt.findShape(hoverId);
        if (prev) rt.dispatch(prev, "mouseleave");
        hoverId = null;
        dirty = true;
      }
    });
    window.addEventListener("keydown", onKey, true);
    new ResizeObserver(() => fit()).observe(stage);
  }

  function onKey(e) {
    if (!root) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "F5") { e.preventDefault(); return; }
    // 键盘事件：派发给配置了 keydown 交互的形状
    const p = rt && rt.page();
    if (!p) return;
    VX.Interact.walk(p.shapes, (s) => {
      if ((s.interactions || []).some((i) => i.event === "keydown")) rt.dispatch(s, "keydown");
    });
    afterDispatch();
  }

  function open() {
    if (root) return;
    let doc;
    try {
      doc = JSON.parse(VX.Model.serialize());
    } catch (e) {
      return;
    }
    rt = VX.Interact.create(doc);
    rt.init();

    root = document.createElement("div");
    root.id = "preview-root";
    root.innerHTML =
      '<div id="preview-bar"><span class="preview-dot"></span><span id="preview-title"></span>' +
      '<span id="preview-hint">按 Esc 退出预览</span></div>' +
      '<div id="preview-stage"><canvas id="preview-canvas"></canvas></div>';
    document.body.appendChild(root);
    stage = document.getElementById("preview-stage");
    canvas = document.getElementById("preview-canvas");
    ctx = canvas.getContext("2d");

    fit();
    bind();
    updateBar();
    lastT = 0;
    dirty = true;
    raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!root) return;
    cancelAnimationFrame(raf);
    raf = 0;
    window.removeEventListener("keydown", onKey, true);
    root.remove();
    root = null;
    canvas = null;
    ctx = null;
    stage = null;
    rt = null;
    hoverId = null;
    VX.Renderer.invalidate();
  }

  VX.Preview = {
    open,
    close,
    isOpen: () => !!root,
    goPage(id) {
      if (!rt) return;
      if (rt.goPage(id)) {
        fit();
        updateBar();
        dirty = true;
      }
    },
    // 调试/测试用：当前运行时快照
    debug() {
      if (!rt) return null;
      const ov = {};
      rt.overrides.forEach((v, k) => { ov[k] = JSON.parse(JSON.stringify(v)); });
      const p = rt.page();
      return {
        pageId: rt.pageId(),
        pageName: p ? p.name : "",
        vars: JSON.parse(JSON.stringify(rt.vars)),
        overrides: ov,
        zoom: view.zoom,
        rect: canvas ? (() => { const r = canvas.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })() : null,
      };
    },
    text(shapeId) {
      if (!rt) return "";
      const s = rt.findShape(shapeId);
      return s ? rt.displayText(s) : "";
    },
  };
})();
