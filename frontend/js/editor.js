// editor.js —— 编辑器胶水：输入事件 / 快捷键 / 页面树 / 排列工具条 / 状态栏 / 标尺参考线创建（P1）
"use strict";

(function () {
  const S = () => VX.state;
  let canvas, scroll;
  let panDrag = null;     // {startX,startY,ox,oy}
  let guideCreate = null; // 从标尺拖出参考线 {dir, index}

  // ---------- 画布鼠标 ----------
  function clearHover() {
    const st = S();
    if (!st.hoverShapeId && !st.hoverAnchor && !st.hoverConnEnd) return;
    st.hoverShapeId = null;
    st.hoverAnchor = null;
    st.hoverConnEnd = null;
    VX.Renderer.invalidate();
  }

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
      const inside = sc.x >= 0 && sc.y >= 0 && sc.x <= canvas.clientWidth && sc.y <= canvas.clientHeight;
      if (inside || VX.Tools.isDragging()) VX.Tools.onMouseMove(w, sc, e);
      else clearHover();
      VX.Renderer.invalidate(); // 标尺鼠标指示
    });

    // 鼠标离开画布（且未在拖拽）：清理悬停连接点
    canvas.addEventListener("mouseleave", () => { if (!VX.Tools.isDragging()) clearHover(); });

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
      // 数字输入框（属性面板）：只放行文档级撤销/重做，其余按键留给输入框，
      // 否则改完数值不点画布按 Ctrl+Z 会被这里直接 return 掉
      const numberInput = tag === "input" && e.target.type === "number";
      if (tag === "textarea" || (tag === "input" && !numberInput)) return;
      if (numberInput && !(e.ctrlKey && (e.key.toLowerCase() === "z" || e.key.toLowerCase() === "y"))) return;

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
      const hotkeys = { v: "select", t: "text", c: "connector" };
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

  // ---------- 页面树 ----------
  let dragPageId = null;   // 正在拖拽的页面 id（null = 没在拖）

  function bindPageTree() {
    const box = document.getElementById("page-tree");
    const addBtn = document.getElementById("btn-page-add");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        VX.History.run("新建页面", () => VX.Model.addPage());
        // 新页追加在末尾：列表长了要确保刚建的那页看得见
        const active = box.querySelector(".tree-item.active");
        if (active) active.scrollIntoView({ block: "nearest" });
      });
    }
    box.addEventListener("click", (e) => {
      const item = e.target.closest(".tree-item");
      if (item && item.dataset.page) VX.Model.setCurrentPage(item.dataset.page);
    });
    box.addEventListener("dblclick", (e) => {
      const item = e.target.closest(".tree-item");
      if (item && item.dataset.page) startRenamePage(item);
    });
    box.addEventListener("contextmenu", (e) => {
      const item = e.target.closest(".tree-item");
      if (!item || !item.dataset.page) return;
      e.preventDefault();
      openPageMenu(e.clientX, e.clientY, item.dataset.page);
    });

    // 拖拽排序：把手是唯一的拖动源（行内点击选页、双击重命名照旧可用）
    box.addEventListener("dragstart", (e) => {
      const handle = e.target.closest(".drag-handle");
      const item = handle && handle.closest(".tree-item[data-page]");
      if (!item) return;
      dragPageId = item.dataset.page;
      item.classList.add("dragging");
      // 不塞数据的话部分内核（WebView2 / Firefox）不会真的开始拖
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragPageId);
      }
    });
    box.addEventListener("dragend", () => {
      dragPageId = null;
      clearPageDrop();
    });
    box.addEventListener("dragover", (e) => {
      if (!dragPageId) return;
      e.preventDefault();                       // 不 preventDefault 就收不到 drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      markPageDrop(pageDropIndex(e.clientY));
    });
    box.addEventListener("dragleave", (e) => {
      if (!box.contains(e.relatedTarget)) clearPageDrop();
    });
    box.addEventListener("drop", (e) => {
      if (!dragPageId) return;
      e.preventDefault();
      const id = dragPageId;
      const at = pageDropIndex(e.clientY);   // 插到第 at 条之前
      dragPageId = null;
      clearPageDrop();
      const from = VX.Model.doc.pages.findIndex((p) => p.id === id);
      // 先摘掉被拖的那条，后面的位置整体前移一格，所以 at 要减 1
      const to = at > from ? at - 1 : at;
      if (from < 0 || to === from) return;
      VX.History.run("移动页面", () => VX.Model.movePageTo(id, to));
    });

    document.addEventListener("mousedown", onCtxOutside, true);
    document.addEventListener("keydown", onCtxKey, true);
    window.addEventListener("blur", closeCtxMenu);
  }

  // 拖拽落点：按每行中线判定插到「第几条之前」，落在列表空白处算末尾
  function pageDropIndex(clientY) {
    const items = Array.from(document.querySelectorAll("#page-tree .tree-item[data-page]"));
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return items.length;
  }

  // 插入位置提示线（单独一个绝对定位的 div，跨行高统一）
  function markPageDrop(index) {
    const box = document.getElementById("page-tree");
    let line = box.querySelector(".page-drop-line");
    if (!line) {
      line = document.createElement("div");
      line.className = "page-drop-line";
      box.appendChild(line);
    }
    const items = Array.from(box.querySelectorAll(".tree-item[data-page]"));
    let y = 0;
    if (!items.length) y = 0;
    else if (index <= 0) y = items[0].offsetTop - 1;
    else if (index >= items.length) {
      const last = items[items.length - 1];
      y = last.offsetTop + last.offsetHeight - 1;
    } else y = items[index].offsetTop - 1;
    line.style.top = Math.max(0, y) + "px";
  }

  function clearPageDrop() {
    const box = document.getElementById("page-tree");
    const line = box.querySelector(".page-drop-line");
    if (line) line.remove();
    box.querySelectorAll(".tree-item.dragging").forEach((el) => el.classList.remove("dragging"));
  }

  function startRenamePage(item) {
    const page = VX.Model.page(item.dataset.page);
    if (!page) return;
    const input = document.createElement("input");
    input.value = page.name;
    Object.assign(input.style, { width: "96px", fontSize: "12px", border: "1px solid #2f6fed", padding: "2px 4px" });
    item.textContent = "";
    item.appendChild(input);
    input.focus();
    input.select();
    const commit = () => {
      const name = input.value.trim();
      if (name && name !== VX.Model.page(item.dataset.page).name) {
        VX.History.run("重命名页面", () => VX.Model.renamePage(item.dataset.page, name));
      } else {
        renderPageTree();
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") input.blur();
      if (ev.key === "Escape") { input.value = VX.Model.page(item.dataset.page).name; input.blur(); }
    });
  }

  // ---------- 页面右键菜单 ----------
  let ctxMenuEl = null;
  function closeCtxMenu() {
    if (ctxMenuEl) { ctxMenuEl.remove(); ctxMenuEl = null; }
  }

  function openPageMenu(x, y, pageId) {
    closeCtxMenu();
    const pages = VX.Model.doc.pages;
    const idx = pages.findIndex((p) => p.id === pageId);
    const items = [
      { text: "新增页面", act: () => VX.History.run("新建页面", () => VX.Model.addPage()) },
      { sep: true },
      {
        text: "重命名",
        act: () => {
          const item = document.querySelector('#page-tree .tree-item[data-page="' + pageId + '"]');
          if (item) startRenamePage(item);
        },
      },
      {
        text: "删除",
        disabled: pages.length <= 1,
        act: () => VX.History.run("删除页面", () => VX.Model.deletePage(pageId)),
      },
      { sep: true },
      {
        text: "上移",
        disabled: idx <= 0,
        act: () => VX.History.run("移动页面", () => VX.Model.movePage(pageId, -1)),
      },
      {
        text: "下移",
        disabled: idx < 0 || idx >= pages.length - 1,
        act: () => VX.History.run("移动页面", () => VX.Model.movePage(pageId, 1)),
      },
    ];

    const menu = document.createElement("div");
    menu.className = "ctx-menu";
    for (const it of items) {
      if (it.sep) {
        const sep = document.createElement("div");
        sep.className = "ctx-sep";
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement("div");
      row.className = "ctx-item" + (it.disabled ? " disabled" : "");
      row.textContent = it.text;
      if (!it.disabled) {
        row.addEventListener("click", () => { closeCtxMenu(); it.act(); });
      }
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";
    ctxMenuEl = menu;
  }

  function onCtxOutside(e) {
    if (ctxMenuEl && !ctxMenuEl.contains(e.target)) closeCtxMenu();
  }
  function onCtxKey(e) {
    if (e.key === "Escape") closeCtxMenu();
  }

  function renderPageTree() {
    const box = document.getElementById("page-tree");
    box.innerHTML = "";
    for (const p of VX.Model.doc.pages) {
      const item = document.createElement("div");
      item.className = "tree-item page-item" + (p.id === VX.Model.currentPageId() ? " active" : "");
      item.dataset.page = p.id;
      // 行首是拖拽把手（不是可勾选的页图标）：按住它上下拖动改页面顺序
      const handle = document.createElement("span");
      handle.className = "drag-handle";
      handle.title = "拖拽调整页面顺序";
      handle.draggable = true;
      handle.innerHTML = '<svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">' +
        '<g fill="currentColor">' +
        '<circle cx="3" cy="4" r="1.1"/><circle cx="7" cy="4" r="1.1"/>' +
        '<circle cx="3" cy="8" r="1.1"/><circle cx="7" cy="8" r="1.1"/>' +
        '<circle cx="3" cy="12" r="1.1"/><circle cx="7" cy="12" r="1.1"/>' +
        '</g></svg>';
      item.appendChild(handle);
      item.appendChild(document.createTextNode(p.name));
      box.appendChild(item);
    }
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
    // 当前页：点一下把左侧面板切回「页面树」，不用再去点页签
    const pageTag = document.getElementById("status-page");
    if (pageTag) {
      pageTag.addEventListener("click", () => {
        const tab = document.querySelector('#left-panel .panel-tab[data-tab="pages"]');
        if (tab) tab.click();
      });
    }
  }

  function updateStatus() {
    document.getElementById("status-zoom").textContent = Math.round(S().zoom * 100) + "%";
    document.getElementById("status-sel").textContent = String(S().selection.length);
    // 当前编辑的页面名：任何左侧页签下都能看到（切页 / 重命名 / 新建 / 删除都会刷新）
    const nameEl = document.getElementById("status-page-name");
    if (nameEl) {
      const pg = VX.Model.page();
      nameEl.textContent = pg ? pg.name : "—";
      nameEl.parentElement.title = pg
        ? "当前编辑的页面：" + pg.name + "（点击切到左侧「页面树」）"
        : "当前编辑的页面 · 点击切到左侧「页面树」";
    }
    const g = document.getElementById("status-grid");
    if (g) g.textContent = S().grid ? "网格 开" : "网格 关";
    syncToolButtons();
    syncArrangeTools();
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

  // ---------- P2：排列工具条（原「排列」菜单） ----------
  // 组合/布尔/对齐至少需要 2 个对象；解组需要选中的是组合
  function arrangeEnabled(act) {
    const sel = S().selection;
    if (act === "ungroup") {
      return sel.some((id) => { const s = VX.Model.shape(id); return s && s.type === "group"; });
    }
    return sel.length >= 2;
  }

  function syncArrangeTools() {
    document.querySelectorAll("#arrange-tools [data-arrange]").forEach((b) => {
      b.style.opacity = arrangeEnabled(b.dataset.arrange) ? "1" : "0.35";
    });
  }

  function bindArrangeTools() {
    const box = document.getElementById("arrange-tools");
    if (!box) return;
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-arrange]");
      if (!btn || !arrangeEnabled(btn.dataset.arrange)) return;
      arrange(btn.dataset.arrange);
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

  // ---------- 右侧面板折叠 ----------
  function bindRightPanelCollapse() {
    const main = document.getElementById("main");
    const panel = document.getElementById("right-panel");
    const btn = document.getElementById("btn-right-collapse");
    if (!main || !panel || !btn) return;
    const tabs = btn.parentElement;
    btn.addEventListener("click", () => {
      if (panel.classList.contains("collapsed")) {
        panel.classList.remove("collapsed");
        main.classList.remove("right-collapsed");
        tabs.style.height = "";
        btn.title = "折叠面板";
      } else {
        // 折叠前记录 tab 栏高度，折叠后沿用，避免变矮
        const h = Math.round(tabs.getBoundingClientRect().height);
        panel.classList.add("collapsed");
        main.classList.add("right-collapsed");
        tabs.style.height = h + "px";
        btn.title = "展开面板";
      }
    });
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
      bindPageTree();
      bindStatusbar();
      bindArrangeTools();
      bindLayers();
      bindRightPanelCollapse();

      // 形状库面板
      const sp = document.getElementById("stencil-panel");
      if (sp && VX.Stencils) VX.Stencils.renderPanel(sp);

      VX.Model.on("pagechange", renderPageTree);
      VX.Model.on("pagechange", updateStatus);   // 状态栏的当前页名跟着切页 / 改名刷新
      VX.Model.on("selection", updateStatus);
      VX.Events.on("zoom", updateStatus);
      VX.Events.on("history", syncUndoRedo);
      VX.Events.on("tool", syncToolButtons);

      renderPageTree();
      renderLayers();
      updateStatus();
      syncUndoRedo();
      VX.Renderer.start();
    },
  };

  VX.Editor = Editor;
})();
