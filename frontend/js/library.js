// library.js —— 组件库（P6.5 / A3）
// 母版存在文档顶层 doc.library[]：{ id, name, w, h, shapes }（shapes 是「左上角=0,0」的局部坐标）
// 组件实例是 type="instance" 的形状，带 masterId + children（母版的深拷贝快照，世界坐标）。
//   · 改实例文本/样式只改快照，母版不受影响
//   · 「解除链接」把实例拆成独立形状（内部转成组合再解组）
//   · 插入/实例化时做环检测：母版（递归）引用自身即拒绝
"use strict";

window.VX = window.VX || {};

(function () {
  const S = () => VX.state;
  let root = null;
  let nextMaster = 1;
  let press = null, ghost = null, dragEndedAt = 0;
  const DRAG_THRESHOLD = 4;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function masters() {
    const doc = VX.Model.doc;
    if (!Array.isArray(doc.library)) doc.library = [];
    return doc.library;
  }

  function master(id) { return masters().find((m) => m.id === id) || null; }

  function nextMasterId() {
    let max = 0;
    for (const m of masters()) max = Math.max(max, parseInt(String(m.id).slice(1), 10) || 0);
    nextMaster = Math.max(nextMaster, max + 1);
    return "m" + nextMaster++;
  }

  // 子树里引用的母版 id
  function refsOf(shapes, out) {
    for (const s of shapes || []) {
      if (!s) continue;
      if (s.type === "instance" && s.masterId) out.push(s.masterId);
      refsOf(s.children, out);
      for (const st of (s.panel && s.panel.states) || []) refsOf(st.shapes, out);
    }
    return out;
  }

  // 环检测：把 shapes 展开后能否（递归）回到 masterId
  function wouldCycle(masterId, shapes) {
    const stack = refsOf(shapes, []);
    const seen = new Set();
    while (stack.length) {
      const id = stack.pop();
      if (id === masterId) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      const m = master(id);
      if (m) stack.push(...refsOf(m.shapes, []));
    }
    return false;
  }

  // 形状树重生成 id（母版快照与实例子形状都要求 id 唯一）
  function reidTree(arr) {
    for (const s of arr || []) {
      s.id = VX.Model.nextId();
      reidTree(s.children);
      for (const st of (s.panel && s.panel.states) || []) reidTree(st.shapes);
      for (const t of (s.repeater && s.repeater.template) || []) reidTree(t);
    }
    return arr;
  }

  // 形状包围盒（世界坐标）
  function bbox(shapes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const add = (s) => {
      if (!s) return;
      if (s.type === "connector") {
        for (const p of [s.begin, s.end]) {
          if (!p) continue;
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        }
        return;
      }
      if (s.type === "group" || s.type === "instance") { for (const c of s.children || []) add(c); return; }
      if (s.type === "panel") {
        for (const st of (s.panel && s.panel.states) || []) for (const c of st.shapes || []) add(c);
        return;
      }
      minX = Math.min(minX, s.x || 0); minY = Math.min(minY, s.y || 0);
      maxX = Math.max(maxX, (s.x || 0) + (s.w || 0)); maxY = Math.max(maxY, (s.y || 0) + (s.h || 0));
    };
    for (const s of shapes || []) add(s);
    if (minX === Infinity) return { x: 0, y: 0, w: 1, h: 1 };
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function offsetTree(s, dx, dy) {
    s.x = (s.x || 0) + dx;
    s.y = (s.y || 0) + dy;
    if (s.type === "connector") {
      if (s.begin) { s.begin.x += dx; s.begin.y += dy; }
      if (s.end) { s.end.x += dx; s.end.y += dy; }
    }
    for (const c of s.children || []) offsetTree(c, dx, dy);
    for (const st of (s.panel && s.panel.states) || []) for (const c of st.shapes || []) offsetTree(c, dx, dy);
    return s;
  }

  // 从选中形状创建母版：整体归一化到 (0,0) 起点
  function addFromSelection() {
    const ids = S().selection.slice();
    const shapes = ids.map((id) => VX.Model.shape(id)).filter(Boolean);
    if (!shapes.length) return null;
    const b = bbox(shapes);
    const local = clone(shapes);
    for (const s of local) offsetTree(s, -b.x, -b.y);
    reidTree(local);
    const m = {
      id: nextMasterId(),
      name: "组件 " + masters().length,
      w: Math.round(b.w),
      h: Math.round(b.h),
      shapes: local,
    };
    VX.History.run("创建组件", () => { masters().push(m); });
    S().dirty = true;
    VX.Events.emit("change");
    return m;
  }

  // 用母版生成实例（world 坐标点为中心），children 是母版快照
  function insert(masterId, wx, wy) {
    const m = master(masterId);
    if (!m) return null;
    if (wouldCycle(m.id, m.shapes)) {
      console.warn("组件 " + m.name + " 的母版引用了自身，已拒绝插入");
      return null;
    }
    const children = clone(m.shapes);
    offsetTree(children, Math.round(wx - m.w / 2), Math.round(wy - m.h / 2));
    reidTree(children);
    let inst = null;
    VX.History.run("插入组件", () => {
      inst = VX.Model.addShape("instance", {
        masterId: m.id,
        x: Math.round(wx - m.w / 2),
        y: Math.round(wy - m.h / 2),
        w: m.w, h: m.h,
        style: null,
        text: "",
        children,
      });
    });
    S().selection = inst ? [inst.id] : [];
    VX.Events.emit("selection");
    VX.Renderer.invalidate();
    return inst;
  }

  // 解除链接：实例 → 独立形状（先转组合再解组，与 Ctrl+Shift+G 的语义一致）
  function unlink(id) {
    const s = VX.Model.shape(id);
    if (!s || s.type !== "instance") return false;
    VX.History.run("解除组件链接", () => {
      s.type = "group";
      delete s.masterId;
      VX.Model.ungroup([s.id]);
    });
    VX.Events.emit("selection");
    VX.Renderer.invalidate();
    return true;
  }

  function deleteMaster(id) {
    VX.History.run("删除组件", () => {
      VX.Model.doc.library = masters().filter((m) => m.id !== id);
    });
    S().dirty = true;
    VX.Events.emit("change");
    renderPanel();
  }

  function insertAtCenter(id) {
    const c = document.getElementById("canvas");
    if (!c) return null;
    const w = VX.Viewport.s2w(c.clientWidth / 2, c.clientHeight / 2);
    return insert(id, w.x, w.y);
  }

  // ---------- 面板 ----------
  function renderPanel() {
    if (!root) return;
    root.innerHTML = "";
    const head = document.createElement("div");
    head.className = "lib-head";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-add";
    btn.textContent = "+ 用选中形状创建组件";
    btn.title = "把当前选中的形状打包成可复用母版";
    btn.addEventListener("click", () => {
      const m = addFromSelection();
      if (!m) VX.Model.emit("status", "先选中要打包的形状");
      renderPanel();
    });
    head.appendChild(btn);
    root.appendChild(head);

    const list = masters();
    if (!list.length) {
      const hint = document.createElement("div");
      hint.className = "panel-hint";
      hint.textContent = "暂无组件。选中若干形状后点上方按钮打包成母版，再拖入画布即可复用。";
      root.appendChild(hint);
      return;
    }

    for (const m of list) {
      const row = document.createElement("div");
      row.className = "lib-item";
      row.title = m.name + " · 拖到画布可生成实例";

      const info = document.createElement("div");
      info.className = "lib-info";
      const name = document.createElement("div");
      name.className = "lib-name";
      name.textContent = m.name;
      const dim = document.createElement("div");
      dim.className = "lib-dim";
      dim.textContent = Math.round(m.w) + " × " + Math.round(m.h);
      info.appendChild(name);
      info.appendChild(dim);

      const add = document.createElement("button");
      add.type = "button";
      add.className = "lib-btn";
      add.textContent = "插入";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        insertAtCenter(m.id);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "lib-btn lib-del";
      del.textContent = "×";
      del.title = "删除组件母版（已插入的实例不受影响）";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteMaster(m.id);
      });

      row.appendChild(info);
      row.appendChild(add);
      row.appendChild(del);
      row.addEventListener("mousedown", (e) => {
        if (e.button !== 0 || e.target.closest("button")) return;
        e.preventDefault();
        press = { master: m, sx: e.clientX, sy: e.clientY };
      });
      root.appendChild(row);
    }
  }

  // ---------- 拖拽到画布 ----------
  function canvasPoint(x, y) {
    const cv = document.getElementById("canvas");
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    return VX.Viewport.s2w(x - r.left, y - r.top);
  }

  function makeGhost(m) {
    const g = document.createElement("div");
    g.className = "lib-ghost";
    g.textContent = m.name;
    document.body.appendChild(g);
    return g;
  }

  function endDrag() {
    if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
    ghost = null;
    press = null;
    document.body.classList.remove("lib-dragging");
  }

  function bindDrag() {
    document.addEventListener("mousemove", (e) => {
      if (!press) return;
      if (!ghost) {
        if (Math.hypot(e.clientX - press.sx, e.clientY - press.sy) < DRAG_THRESHOLD) return;
        ghost = makeGhost(press.master);
        document.body.classList.add("lib-dragging");
      }
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
    });
    document.addEventListener("mouseup", (e) => {
      if (!press) return;
      const dragging = !!ghost;
      const m = press.master;
      endDrag();
      if (!dragging) return;
      dragEndedAt = Date.now();
      const w = canvasPoint(e.clientX, e.clientY);
      if (w) insert(m.id, w.x, w.y);
    });
    window.addEventListener("blur", endDrag);
  }

  const Library = {
    masters, master, addFromSelection, insert, unlink, deleteMaster,
    wouldCycle, refsOf,
    init(host) {
      root = host || document.getElementById("library-panel");
      bindDrag();
      if (!root) return;
      VX.Model.on("change", renderPanel);
      VX.Model.on("pagechange", renderPanel);
      renderPanel();
    },
    render: renderPanel,
    dragEndedAt: () => dragEndedAt,
  };

  VX.Library = Library;
})();
