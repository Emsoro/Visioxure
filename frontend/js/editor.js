// editor.js —— 编辑器胶水：输入事件 / 快捷键 / 页面页签 / 状态栏 / 标尺参考线创建（P1）
"use strict";

(function () {
  const S = () => VX.state;
  let canvas, scroll;
  let panDrag = null;     // {startX,startY,ox,oy}
  let guideCreate = null; // 从标尺拖出参考线 {dir, index}

  // ---------- 画布鼠标 ----------
  function bindCanvas() {
    canvas.addEventListener("mousedown", (e) => {
      if (S().editing) return;
      const sc = { x: e.offsetX, y: e.offsetY };
      const w = VX.Viewport.s2w(sc.x, sc.y);
      if (e.button === 1 || S().spaceDown) {
        panDrag = { sx: e.clientX, sy: e.clientY, ox: S().ox, oy: S().oy };
        e.preventDefault();
        return;
      }
      if (e.button === 0) VX.Tools.onMouseDown(w, sc, e);
    });

    window.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const sc = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      S().mouse = sc;

      if (guideCreate) {
        const w = VX.Viewport.s2w(sc.x, sc.y);
        const g = VX.Model.page().guides[guideCreate.index];
        if (g) g.pos = g.dir === "v" ? w.x : w.y;
        VX.Renderer.invalidate();
        return;
      }
      if (panDrag) {
        VX.Viewport.pan(e.clientX - panDrag.sx, e.clientY - panDrag.sy);
        panDrag.sx = e.clientX; panDrag.sy = e.clientY;
        return;
      }
      const w = VX.Viewport.s2w(sc.x, sc.y);
      VX.Tools.onMouseMove(w, sc, e);
      VX.Renderer.invalidate(); // 标尺鼠标指示
    });

    window.addEventListener("mouseup", (e) => {
      if (guideCreate) {
        const overRuler = guideCreate.dir === "v" ? e.clientY - canvas.getBoundingClientRect().top < 22
                                                  : e.clientX - canvas.getBoundingClientRect().left < 22;
        if (overRuler) VX.History.cancel();
        else VX.History.commit("添加参考线");
        guideCreate = null;
        return;
      }
      if (panDrag) { panDrag = null; return; }
      const rect = canvas.getBoundingClientRect();
      const sc = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const w = VX.Viewport.s2w(sc.x, sc.y);
      VX.Tools.onMouseUp(w, sc, e);
    });

    canvas.addEventListener("dblclick", (e) => {
      if (S().editing) return;
      const sc = { x: e.offsetX, y: e.offsetY };
      VX.Tools.onDoubleClick(VX.Viewport.s2w(sc.x, sc.y), sc, e);
    });

    scroll.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        VX.Viewport.setZoom(S().zoom * factor, cx, cy);
      } else {
        VX.Viewport.pan(-e.deltaX, -e.deltaY);
      }
    }, { passive: false });

    new ResizeObserver(() => VX.Renderer.invalidate()).observe(scroll);
  }

  // ---------- 标尺拖出参考线 ----------
  function bindRulers() {
    const top = document.getElementById("ruler-top");
    const left = document.getElementById("ruler-left");
    top.addEventListener("mousedown", (e) => {
      const w = VX.Viewport.s2w(e.offsetX, 0);
      VX.History.begin();
      const pg = VX.Model.page();
      pg.guides.push({ dir: "v", pos: w.x });
      guideCreate = { dir: "v", index: pg.guides.length - 1 };
      S().selGuides = [];
    });
    left.addEventListener("mousedown", (e) => {
      const w = VX.Viewport.s2w(0, e.offsetY);
      VX.History.begin();
      const pg = VX.Model.page();
      pg.guides.push({ dir: "h", pos: w.y });
      guideCreate = { dir: "h", index: pg.guides.length - 1 };
      S().selGuides = [];
    });
  }

  // ---------- 键盘 ----------
  function bindKeyboard() {
    window.addEventListener("keydown", (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "textarea" || tag === "input") return;

      if (e.key === " ") { S().spaceDown = true; e.preventDefault(); return; }

      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); VX.History.undo(); return; }
      if ((e.ctrlKey && e.key.toLowerCase() === "y") || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "z")) { e.preventDefault(); VX.History.redo(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateSelection(); return; }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); arrange("group"); return; }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") { e.preventDefault(); arrange("ungroup"); return; }

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === "Escape") {
        if (S().panelEdit) { S().panelEdit = null; VX.Events.emit("paneledit"); } // 先退出面板编辑
        else if (S().enterGroup) { S().enterGroup = null; } // 再退出组编辑
        S().selection = []; S().selGuides = [];
        VX.Events.emit("selection");
        VX.Tools.set("select");
        VX.Renderer.invalidate();
        return;
      }
      if (e.key === "F5") { e.preventDefault(); if (VX.Preview) VX.Preview.open(); return; }
      if (e.key === "F2" && S().selection.length === 1) {
        VX.Tools.openTextEditor(VX.Model.shape(S().selection[0]));
        return;
      }
      if (e.key.startsWith("Arrow") && S().selection.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        VX.History.run("微移", () => {
          for (const id of S().selection) {
            const s = VX.Model.shape(id);
            if (!s) continue;
            if (s.type === "group") VX.Model.moveShapeBy(s, dx, dy);
            else VX.Model.updateShape(id, { x: s.x + dx, y: s.y + dy });
          }
        });
        return;
      }

      // 工具热键
      const hotkeys = { v: "select", r: "rect", o: "ellipse", t: "text", c: "connector" };
      const tool = hotkeys[e.key.toLowerCase()];
      if (tool && !e.ctrlKey && !e.altKey) { VX.Tools.set(tool); }
    });
    window.addEventListener("keyup", (e) => { if (e.key === " ") S().spaceDown = false; });
  }

  function deleteSelection() {
    if (S().selGuides.length) {
      const pg = VX.Model.page();
      const idx = S().selGuides.slice().sort((a, b) => b - a);
      VX.History.run("删除参考线", () => idx.forEach((i) => pg.guides.splice(i, 1)));
      S().selGuides = [];
      return;
    }
    if (S().selection.length) {
      VX.History.run("删除", () => VX.Model.removeShapes(S().selection.slice()));
      VX.Events.emit("selection");
    }
  }

  function duplicateSelection() {
    if (!S().selection.length) return;
    VX.History.run("复制", () => {
      const newIds = S().selection.slice().map((id) => {
        const c = VX.Model.duplicateShape(id);
        return c ? c.id : null;
      }).filter(Boolean);
      S().selection = newIds;
    });
    VX.Events.emit("selection");
  }

  // ---------- 工具栏 / 缩放按钮 ----------
  function bindToolbar() {
    document.getElementById("btn-zoom-in").addEventListener("click", () => zoomCenter(1.2));
    document.getElementById("btn-zoom-out").addEventListener("click", () => zoomCenter(1 / 1.2));
    document.getElementById("btn-undo").addEventListener("click", () => VX.History.undo());
    document.getElementById("btn-redo").addEventListener("click", () => VX.History.redo());
  }

  function zoomCenter(factor) {
    const rect = canvas.getBoundingClientRect();
    VX.Viewport.setZoom(S().zoom * factor, rect.width / 2, rect.height / 2);
  }

  function syncToolButtons() {
    document.querySelectorAll("#tools .tool-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === S().tool);
    });
  }

  function syncUndoRedo() {
    const u = document.getElementById("btn-undo"), r = document.getElementById("btn-redo");
    if (u) u.style.opacity = VX.History.canUndo() ? "1" : "0.35";
    if (r) r.style.opacity = VX.History.canRedo() ? "1" : "0.35";
  }

  // ---------- 页面页签 ----------
  function bindPageTabs() {
    const bar = document.getElementById("page-tabs");
    bar.addEventListener("click", (e) => {
      if (e.target.classList.contains("page-tab-add")) {
        VX.History.run("新建页面", () => VX.Model.addPage());
        return;
      }
      const tab = e.target.closest(".page-tab");
      if (tab && tab.dataset.page) VX.Model.setCurrentPage(tab.dataset.page);
    });
    bar.addEventListener("dblclick", (e) => {
      const tab = e.target.closest(".page-tab");
      if (!tab || !tab.dataset.page) return;
      const input = document.createElement("input");
      input.value = VX.Model.page(tab.dataset.page).name;
      Object.assign(input.style, { width: "80px", fontSize: "12px", border: "1px solid #2f6fed", padding: "2px 4px" });
      tab.textContent = "";
      tab.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const name = input.value.trim();
        if (name && name !== VX.Model.page(tab.dataset.page).name) {
          VX.History.run("重命名页面", () => VX.Model.renamePage(tab.dataset.page, name));
        } else {
          renderPageTabs();
        }
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        ev.stopPropagation();
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") { input.value = VX.Model.page(tab.dataset.page).name; input.blur(); }
      });
    });
  }

  function renderPageTabs() {
    const bar = document.getElementById("page-tabs");
    bar.innerHTML = "";
    for (const p of VX.Model.doc.pages) {
      const tab = document.createElement("span");
      tab.className = "page-tab" + (p.id === VX.Model.currentPageId() ? " active" : "");
      tab.dataset.page = p.id;
      tab.textContent = p.name;
      bar.appendChild(tab);
    }
    const add = document.createElement("span");
    add.className = "page-tab-add";
    add.title = "新建页面";
    add.textContent = "+";
    bar.appendChild(add);
  }

  // ---------- 状态栏 ----------
  function bindStatusbar() {
    const grid = document.getElementById("status-grid");
    grid.style.cursor = "pointer";
    grid.addEventListener("click", () => {
      S().grid = !S().grid;
      updateStatus();
      VX.Renderer.invalidate();
    });
  }

  function updateStatus() {
    document.getElementById("status-zoom").textContent = Math.round(S().zoom * 100) + "%";
    document.getElementById("status-sel").textContent = String(S().selection.length);
    const g = document.getElementById("status-grid");
    if (g) g.textContent = S().grid ? "网格 开" : "网格 关";
    syncToolButtons();
  }

  // ---------- P2：排列动作（组合/解组/布尔/对齐） ----------
  function arrange(act) {
    const sel = S().selection;
    const label = { group: "组合", ungroup: "解除组合", union: "联合", intersect: "相交", subtract: "剪除",
      "align-left": "左对齐", "align-hcenter": "水平居中", "align-right": "右对齐",
      "align-top": "顶对齐", "align-vcenter": "垂直居中", "align-bottom": "底对齐" }[act] || act;
    VX.History.run(label, () => {
      if (act === "group") VX.Model.group(sel.slice());
      else if (act === "ungroup") VX.Model.ungroup(sel.slice());
      else if (act === "union" || act === "intersect" || act === "subtract") VX.Model.booleanOp(act);
      else if (act.startsWith("align-")) {
        const kind = act.slice(6);
        if (kind === "hcenter") VX.Model.align("hcenter");
        else if (kind === "vcenter") VX.Model.align("vcenter");
        else VX.Model.align(kind);
      }
    });
    VX.Events.emit("selection");
    VX.Renderer.invalidate();
  }

  // ---------- P2：排列菜单下拉 ----------
  function bindMenus() {
    const item = document.querySelector('[data-menu="arrange"]');
    const drop = document.getElementById("menu-arrange");
    if (!item || !drop) return;
    item.addEventListener("click", (e) => {
      if (e.target.closest(".menu-entry")) return;
      drop.classList.toggle("hidden");
    });
    drop.addEventListener("click", (e) => {
      const entry = e.target.closest(".menu-entry");
      if (!entry) return;
      drop.classList.add("hidden");
      arrange(entry.dataset.act);
    });
    document.addEventListener("mousedown", (e) => {
      if (!item.contains(e.target)) drop.classList.add("hidden");
    });
  }

  // ---------- P2：图层面板 ----------
  function renderLayers() {
    const root = document.getElementById("layer-panel");
    if (!root) return;
    const layers = VX.Model.layers() || [];
    root.innerHTML = "";
    // 倒序显示：上层在上
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      const row = document.createElement("div");
      row.className = "layer-row" + (S().currentLayer === l.id ? " active" : "");

      const eye = document.createElement("span");
      eye.className = "layer-ico" + (l.visible ? "" : " off");
      eye.textContent = "◉";
      eye.title = l.visible ? "点击隐藏" : "点击显示";
      eye.addEventListener("click", (e) => { e.stopPropagation(); VX.Model.toggleLayer(l.id, "visible"); });

      const lock = document.createElement("span");
      lock.className = "layer-ico" + (l.locked ? "" : " off");
      lock.textContent = l.locked ? "🔒" : "🔓";
      lock.title = l.locked ? "点击解锁" : "点击锁定";
      lock.addEventListener("click", (e) => { e.stopPropagation(); VX.Model.toggleLayer(l.id, "locked"); });

      const name = document.createElement("span");
      name.className = "layer-name";
      name.textContent = l.name;

      row.appendChild(eye);
      row.appendChild(name);
      row.appendChild(lock);
      row.addEventListener("click", () => { VX.Model.setCurrentLayer(l.id); renderLayers(); });
      root.appendChild(row);
    }
  }

  function bindLayers() {
    document.getElementById("btn-add-layer").addEventListener("click", () => {
      VX.History.run("新建图层", () => {
        const l = VX.Model.addLayer();
        VX.Model.setCurrentLayer(l.id);
      });
      renderLayers();
    });
    VX.Model.on("change", renderLayers);
    VX.Model.on("pagechange", renderLayers);
    VX.Model.on("layers", renderLayers);
  }

  const Editor = {
    init() {
      canvas = document.getElementById("canvas");
      scroll = document.getElementById("canvas-scroll");
      VX.Renderer.attach(canvas);
      VX.Overlay.attach(document.getElementById("ruler-top"), document.getElementById("ruler-left"));

      bindCanvas();
      bindRulers();
      bindKeyboard();
      bindToolbar();
      bindPageTabs();
      bindStatusbar();
      bindMenus();
      bindLayers();

      // 形状库面板
      const sp = document.getElementById("stencil-panel");
      if (sp && VX.Stencils) VX.Stencils.renderPanel(sp);

      VX.Model.on("pagechange", renderPageTabs);
      VX.Model.on("selection", updateStatus);
      VX.Events.on("zoom", updateStatus);
      VX.Events.on("history", syncUndoRedo);
      VX.Events.on("tool", syncToolButtons);

      renderPageTabs();
      renderLayers();
      updateStatus();
      syncUndoRedo();
      VX.Renderer.start();
    },
  };

  VX.Editor = Editor;
})();
